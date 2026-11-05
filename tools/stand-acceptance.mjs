// Приёмка серверного режима на ТЕСТОВОМ стенде двумя аккаунтами (#204): мастер и игрок — анонимные пользователи
// тестового проекта Supabase (там включён анонимный вход). Проверяет права, частичные правки, хиты прибавкой с ключом
// повтора, постановку существа одной транзакцией и доставку изменений/удалений в реальном времени. Кампанию за собой
// удаляет. Боевую базу использовать отказывается.
//
//   npm i --no-save @supabase/supabase-js@2.118.0   (или SUPABASE_JS=/путь/к/supabase-js/dist/index.mjs)
//   TEST_SUPABASE_URL=https://<ref>.supabase.co TEST_SUPABASE_KEY=sb_publishable_… node tools/stand-acceptance.mjs
const PROD_REF = 'ilsuespohsuligyiqjsx';
const url = process.env.TEST_SUPABASE_URL, key = process.env.TEST_SUPABASE_KEY;
if (!url || !key) throw new Error('Нужны TEST_SUPABASE_URL и TEST_SUPABASE_KEY (publishable-ключ тестового проекта)');
if (url.includes(PROD_REF)) throw new Error('Это боевая база — приёмка только на тестовом проекте');
if (!/^sb_publishable_/.test(key)) throw new Error('Нужен publishable-ключ, не служебный');
const { createClient } = await import(process.env.SUPABASE_JS || '@supabase/supabase-js');

const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok: !!ok, info }); console.log(`${ok ? '✓' : '✗'} ${name}${info ? ` — ${info}` : ''}`); };
const tag = Math.random().toString(36).slice(2, 8);
const cid = `c-acc-${tag}`, sid = `s-acc-${tag}`;

async function user(nick) {
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signInAnonymously({ options: { data: { name: nick } } });
  if (error) throw new Error(`вход ${nick}: ${error.message}`);
  await sb.realtime.setAuth(data.session.access_token);
  return { sb, id: data.user.id };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Один канал кампании, как у стола: изменения токенов по фильтру и удаления без фильтра (TASK-168).
function listen(sb) {
  const events = [], deletes = [];
  const ch = sb.channel(`campaign:${cid}`, { config: { private: true } });
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'tokens', filter: `campaign_id=eq.${cid}` }, (p) => events.push(p));
  ch.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tokens' }, (p) => deletes.push(p));
  return new Promise((resolve, reject) => ch.subscribe((s, err) => {
    if (s === 'SUBSCRIBED') resolve({ ch, events, deletes });
    else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') reject(new Error(`канал: ${s} ${err?.message || ''}`));
  }));
}
async function until(pred, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { if (pred()) return true; await wait(200); } return false; }

const M = await user(`Мастер-${tag}`), P = await user(`Игрок-${tag}`);
try {
  // Кампания, сцена, приглашение без одобрения.
  let r = await M.sb.from('campaigns').insert({ id: cid, owner_id: M.id, name: `Приёмка ${tag}`, data: { seats: 4 } });
  check('мастер создаёт кампанию', !r.error, r.error?.message);
  r = await M.sb.from('scenes').insert({ id: sid, campaign_id: cid, data: { name: 'Поляна' } });
  check('мастер создаёт сцену', !r.error, r.error?.message);
  const code = `RSP-${tag.toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(6, 'Q').slice(0, 6)}`;
  r = await M.sb.from('campaign_invites').insert({ campaign_id: cid, code, manual: false });
  check('мастер создаёт приглашение', !r.error, r.error?.message);
  r = await P.sb.rpc('join_campaign', { p_code: code });
  check('игрок входит по приглашению', !r.error, r.error?.message);

  // Токены: открытый враг мастера и свой призыв игрока.
  r = await M.sb.from('tokens').insert({ id: `t-gob-${tag}`, campaign_id: cid, scene_id: sid, ord: 1, data: { kind: 'foe', name: 'Гоблин', x: 100, y: 100, hp: 7, hpMax: 7 } });
  check('мастер ставит гоблина', !r.error, r.error?.message);
  r = await P.sb.from('tokens').insert({ id: `t-own-${tag}`, campaign_id: cid, scene_id: sid, owner_id: P.id, ord: 2, data: { kind: 'custom', name: 'Волк игрока', x: 50, y: 50, hp: 11, hpMax: 11 } });
  check('игрок ставит свой токен', !r.error, r.error?.message);

  // Реальное время: игрок видит правку мастера.
  const live = await listen(P.sb);
  await wait(1500); // подписка на изменения базы встаёт чуть позже SUBSCRIBED
  r = await M.sb.rpc('patch_token', { p_id: `t-gob-${tag}`, p_set: { x: 140 }, p_unset: [] });
  check('мастер двигает гоблина (patch_token)', !r.error, r.error?.message);
  check('игрок получил движение в реальном времени', await until(() => live.events.some((e) => e.new?.id === `t-gob-${tag}` && e.new?.data?.x === 140)));

  // Права: игрок не правит хиты чужого врага, но двигает видимого.
  r = await P.sb.rpc('patch_token', { p_id: `t-gob-${tag}`, p_set: { hp: 1 }, p_unset: [] });
  check('игрок не меняет хиты врага', !!r.error, r.error?.message);
  r = await P.sb.rpc('patch_token', { p_id: `t-own-${tag}`, p_set: { x: 70 }, p_unset: [] });
  check('игрок двигает свой токен', !r.error, r.error?.message);

  // Хиты прибавкой с ключом повтора (мастер по врагу).
  const op = crypto.randomUUID();
  r = await M.sb.rpc('adjust_token_once', { p_id: `t-gob-${tag}`, p_deltas: { hp: -3 }, p_operation: op });
  const again = await M.sb.rpc('adjust_token_once', { p_id: `t-gob-${tag}`, p_deltas: { hp: -3 }, p_operation: op });
  const hp = (await M.sb.from('tokens').select('data').eq('id', `t-gob-${tag}`).single()).data?.data?.hp;
  check('урон прибавкой применён один раз при повторе', !r.error && again.data?.replayed === true && hp === 4, `hp=${hp} ${r.error?.message || ''}`);

  // Бой: игрок пишет только своё точечной функцией, прямая правка строки — у мастера (аудит 04.11).
  r = await M.sb.from('combats').insert({ campaign_id: cid, data: { active: true, round: 1, turn: 0, current: `t-own-${tag}`, entries: [{ tokenId: `t-gob-${tag}`, init: 15 }, { tokenId: `t-own-${tag}`, init: null }], moved: {} } });
  check('мастер начинает бой', !r.error, r.error?.message);
  r = await P.sb.from('combats').update({ data: { active: false } }).eq('campaign_id', cid).select('campaign_id');
  check('игрок не правит строку боя напрямую', !r.error && r.data.length === 0, r.error?.message || `строк: ${r.data?.length}`);
  r = await P.sb.rpc('combat_player', { p_campaign: cid, p_init: { [`t-own-${tag}`]: 12 }, p_moved: { [`t-own-${tag}`]: 15 }, p_ended: `t-own-${tag}` });
  check('игрок бросает инициативу, идёт и заканчивает ход (combat_player)', !r.error && r.data?.entries?.[1]?.init === 12 && r.data?.ended === `t-own-${tag}`, r.error?.message);
  r = await P.sb.rpc('combat_player', { p_campaign: cid, p_init: { [`t-gob-${tag}`]: 1 } });
  check('инициативу врага функция не трогает', !r.error && r.data?.entries?.[0]?.init === 15, r.error?.message);

  // Существо одной транзакцией.
  r = await M.sb.rpc('place_creature', {
    p_creature: { campaign_id: cid, id: `cr-${tag}`, owner_id: M.id, data: { name: 'Страж', source: 'manual' } },
    p_token: { id: `t-cr-${tag}`, campaign_id: cid, scene_id: sid, ord: 3, data: { kind: 'foe', name: 'Страж', monsterId: `lib:cr-${tag}`, x: 10, y: 10 } },
  });
  check('мастер ставит своё существо одной транзакцией', !r.error, r.error?.message);
  const seen = await P.sb.from('campaign_creatures').select('id').eq('campaign_id', cid);
  check('игрок не видит закрытый снимок мастера', !seen.error && seen.data.length === 0, `видно: ${seen.data?.length}`);

  // Удаление доходит без фильтра (TASK-168): слушаем DELETE по таблице.
  const dels = live.deletes;
  r = await M.sb.from('tokens').delete().eq('id', `t-gob-${tag}`);
  check('мастер удаляет гоблина', !r.error, r.error?.message);
  check('игрок получил удаление в реальном времени', await until(() => dels.some((e) => e.old?.id === `t-gob-${tag}`)));
  r = await P.sb.rpc('adjust_token_once', { p_id: `t-gob-${tag}`, p_deltas: { hp: -1 }, p_operation: crypto.randomUUID() });
  check('правка удалённого токена — «Токен удалён мастером»', r.error?.code === 'P0002', r.error?.message);

  // Посторонний ничего не видит.
  const X = await user(`Чужой-${tag}`);
  const xs = await X.sb.from('tokens').select('id').eq('campaign_id', cid);
  check('посторонний не видит токены кампании', !xs.error && xs.data.length === 0, `видно: ${xs.data?.length}`);
  const xv = await X.sb.rpc('visible_token_ids', { c: cid });
  check('посторонний не перечисляет токены через функцию', !!xv.error, xv.error?.message);
} finally {
  const r = await M.sb.from('campaigns').delete().eq('id', cid);
  console.log(r.error ? `кампания ${cid} не удалена: ${r.error.message}` : `кампания ${cid} удалена`);
  M.sb.removeAllChannels(); P.sb.removeAllChannels();
}
const failed = results.filter((x) => !x.ok);
console.log(`\nИтого: ${results.length - failed.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
