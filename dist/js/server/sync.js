// Серверный режим (TASK-002): загрузка кампаний, отправка изменений, реальное время,
// мгновенные события (Broadcast) и присутствие (Presence) на приватном канале campaign:<id>.
//
// Источник правды — кэш строк каждой кампании (rows). Изменение пользователя: снимок «до/после» →
// diffRows → операции применяются к кэшу сразу (оптимистично) и уходят на сервер по очереди.
// Отказ сервера → сообщение и перезагрузка кампании с сервера. События других участников приходят
// изменениями таблиц → кэш → сборка кампании → setDB.
import { supabase } from './client.js';
import { assemble, explode, diffRows, applyOps, applyChange, rowsFrom, emptyRows, EMPTY_COMBAT, applyCharacterSnapshot, tokenPatch, groupTokenMoves, groupPlacements, playerCombatDelta, playerSaveResults, UNFILTERED_DELETES, ownsDeleted } from './model.js';
import { createCharacterSheetClient, SheetCommandError } from './character-sheet.js';
import { commandFromCharacterChange, sameSheetValue, rebaseCharacterDraft } from './character-sheet-ops.js';
import { advanceTurn, turnTokenId, initiativeOrder, turnIndexOf } from '../views/table/combat.js';

const CAMPAIGN_TABLES = ['campaign_members', 'campaign_invites', 'characters', 'scenes', 'scene_secrets', 'scene_explored', 'tokens', 'drawings', 'log_entries', 'log_secrets', 'combat_public', 'save_requests', 'portal_requests', 'combats'];
const PK = { campaigns: ['id'], campaign_invites: ['campaign_id'], campaign_members: ['campaign_id', 'user_id'], scene_secrets: ['scene_id'], combats: ['campaign_id'], campaign_creatures: ['campaign_id', 'id'] };
const pkOf = (table, row) => Object.fromEntries((PK[table] || ['id']).map((k) => [k, row[k]]));
const HIDDEN_VIS = new Set(['gm', 'blind', 'self']);
const AUTHORED = new Set(['log_entries', 'log_secrets', 'portal_requests']);

let sb = null;
let me = null;
let guest = false; // вошли гостем (#194): анонимная сессия Supabase
let store = null; // {getDB, setDB, deliver, emitLocal, commit}
const cache = new Map();       // cid → rows
const channels = new Map();    // cid → RealtimeChannel
const presence = new Map();    // cid → Map<key, info>
const queues = new Map();      // cid → Promise (очередь отправки)
const confirmedSheets = new Map(); // cid → Map(id → подтверждённая строка)
const pendingSheets = new Map(); // cid → Map(id → число отправляемых изменений)
const reassembleTimers = new Map();
let myPresence = null;
let userChannel = null;

export const serverUserId = () => me;
export function characterSheetMeta(cid, id) {
  const row = confirmedSheets.get(cid)?.get(id) || cache.get(cid)?.characters.get(id);
  return row?.sheet_version === undefined ? null : { version: String(row.sheet_version), managed: !!row.sheet_managed, archivedAt: row.archived_at || null };
}

function rememberSheet(cid, row) {
  if (row?.sheet_version === undefined) return;
  if (!confirmedSheets.has(cid)) confirmedSheets.set(cid, new Map());
  const old = confirmedSheets.get(cid).get(row.id);
  if (!old || BigInt(row.sheet_version) >= BigInt(old.sheet_version)) confirmedSheets.get(cid).set(row.id, structuredClone(row));
}

const sheets = createCharacterSheetClient(async () => {
  if (!sb || !me) throw new Error('Нет серверной сессии');
  return sb;
});

/** Явный путь листа; optimistic commit не является подтверждением этого запроса. */
export async function readCharacterSheet(cid, characterId) {
  if (!sb || !me) throw new SheetCommandError('forbidden');
  await whenSynced(cid);
  const snapshot = await sheets.read(cid, characterId);
  const rows = cache.get(cid);
  if (rows) { applyCharacterSnapshot(rows, snapshot); rememberSheet(cid, rows.characters.get(characterId)); scheduleAssemble(cid); }
  return snapshot;
}

export async function submitCharacterCommand(request) {
  if (!sb || !me) throw new SheetCommandError('forbidden', { request });
  await whenSynced(request.campaignId);
  const result = await sheets.execute(request);
  const rows = cache.get(request.campaignId);
  if (rows) applyCharacterSnapshot(rows, result.sheet);
  // Архив затрагивает токены/бой; перечитываем транзакцию целиком, не показываем частичный ACK.
  try { await loadCampaign(request.campaignId); }
  catch (cause) {
    const error = new SheetCommandError('network', { request, cause });
    error.acknowledged = result; // запись уже подтверждена; ошибка относится к перечитыванию кампании
    throw error;
  }
  return result;
}

/**
 * Новый герой из конструктора (P4a, create_character_sheet): лист, история create и, если claim, выбор героя игроком —
 * одной транзакцией. characterId и operationId вызывающий хранит до ответа: повтор после обрыва шлёт тот же запрос.
 */
export async function createHeroSheet(cid, { characterId, operationId, data }, claim = false) {
  if (!sb || !me) throw new SheetCommandError('forbidden');
  await whenSynced(cid);
  const checked = await viaBuildCheck('create', { p_campaign: cid, p_character: characterId, p_operation: operationId, p_payload: data, p_claim: claim });
  const result = checked.ok ? checked.data : await sheets.create({ campaignId: cid, characterId, operationId, data, claim });
  await loadCampaign(cid);
  return { ...result, verified: !!checked.ok, buildErrors: checked.errors || [] };
}

/**
 * Проверка сборки сервером (P4b): Edge Function считает сборку заново и сама вызывает команду листа. Функции нет, нет связи
 * или сервер отказал — обычная команда: сборка останется «проверена в браузере», а ошибку команды получит вызывающий.
 * Повтор безопасен: у команды тот же ID операции. Возвращает {ok, data} или {ok: false, errors?}.
 */
let buildCheckRpc = true;
async function viaBuildCheck(kind, args) {
  if (!buildCheckRpc) return { ok: false };
  try {
    const { data, error } = await sb.functions.invoke('validate-build', { body: { kind, args } });
    if (!error) return { ok: true, data };
    const status = error.context?.status;
    if (status === 422) return { ok: false, errors: (await error.context.json().catch(() => ({}))).errors || [] };
    if (status === 404) buildCheckRpc = false;
  } catch (e) { console.warn('Проверка сборки недоступна', e); }
  return { ok: false };
}

/** «Мои герои» в базе (DEC-019 D1): свои строки таблицы heroes. Нет связи — null, работаем с копией устройства. */
export async function loadHeroRows() {
  if (!sb || !me) return null;
  const { data, error } = await sb.from('heroes').select('id,data,archived_at');
  return error ? null : data;
}
/** Записать героя в базу; ошибка (лимит, нет связи) не мешает: копия на устройстве цела, уйдёт при следующем сведении. */
export async function pushHeroRow(hero, archived = false) {
  if (!sb || !me) return false;
  const { id, ownerId, ...data } = hero;
  const { error } = await sb.from('heroes').upsert({ id, owner_id: me, data, archived_at: archived ? new Date(hero.archivedAt || Date.now()).toISOString() : null });
  return !error;
}

/** Шесть бросков 4к6 от функции проверки: результат подписан, игрок его не подменит. Функции нет — null, кубы бросит браузер. */
export async function rollAbilityDice() {
  if (!sb || !me || !buildCheckRpc) return null;
  const { data, error } = await sb.functions.invoke('validate-build', { body: { kind: 'roll' } });
  return error ? null : data?.receipts || null;
}

/**
 * Повышение уровня (level_up_character): ровно +1 уровень, хиты прибавляет сервер. Ожидаемая версия — подтверждённая
 * версия листа; operationId и payload вызывающий хранит до ответа (повтор шлёт тот же запрос).
 */
export async function levelUpHeroSheet(cid, characterId, { operationId, payload }) {
  if (!sb || !me) throw new SheetCommandError('forbidden');
  await whenSynced(cid);
  const meta = characterSheetMeta(cid, characterId);
  if (!meta) throw new SheetCommandError('unavailable');
  const checked = payload.creation ? await viaBuildCheck('level_up', { p_campaign: cid, p_character: characterId, p_expected_version: Number(meta.version), p_operation: operationId, p_payload: payload }) : { ok: false };
  const result = checked.ok ? checked.data : await sheets.levelUp({ campaignId: cid, characterId, version: meta.version, operationId, payload });
  await loadCampaign(cid);
  return { ...result, verified: !!checked.ok, buildErrors: checked.errors || [] };
}

/** Создание отдельного экземпляра; ID сохраняется вызывающим до ответа для безопасного повтора. */
export async function createCharacterSheet(cid, character) {
  if(!sb||!me)throw new SheetCommandError('forbidden');
  await whenSynced(cid);
  const {id,ownerId,...data}=structuredClone(character);
  const result=await sb.from('characters').insert({id,campaign_id:cid,owner_id:ownerId,data}).select('*').single();
  if(result.error&&result.error.code!=='23505')throw result.error;
  // Повтор после потери ответа не делает вторую копию. Существующую строку не перезаписываем.
  const snapshot=await sheets.read(cid,id);
  if(snapshot.ownerId!==ownerId)throw new SheetCommandError('conflict');
  await loadCampaign(cid);
  return snapshot;
}

/** Объект для store.useServerBackend: как хранилище говорит с сервером. */
export const backend = {
  userId: () => me,
  afterCommit: (before, after) => afterCommit(before, after),
  send: (type, payload) => broadcast(payload?.cid || myPresence?.campaignId, type, payload),
  setPresence: (info) => setServerPresence(info),
  online: (cid) => serverOnline(cid),
};

/**
 * Войти по сессии (если есть) и загрузить кампании. Возвращает {user, error}.
 * Обрабатывает возврат из Discord: ?code=… (обмен на сессию делает supabase-js) или ?error=….
 */
export async function startServer(api) {
  store = api;
  const params = new URLSearchParams(location.search);
  const oauthError = params.get('error_description') || params.get('error');
  sb = await supabase();
  const { data: { session } } = await sb.auth.getSession();
  if (params.has('code') || params.has('error') || params.has('error_description')) {
    params.delete('code'); params.delete('error'); params.delete('error_code'); params.delete('error_description');
    const q = params.toString();
    history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`);
  }
  if (!session) return { user: null, error: oauthError ? 'Вход через Discord отменён' : null };
  me = session.user.id;
  guest = !!session.user.is_anonymous;
  sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') location.reload(); });
  await sb.realtime.setAuth?.(session.access_token);
  await loadAll();
  listenToMe();
  return { user: store.getDB().users[me] };
}

export async function signInWithDiscord(returnHash = location.hash) {
  try { sessionStorage.setItem('rasputye-v2-return', returnHash || '#/campaigns'); } catch { /* */ }
  const client = await supabase();
  const { error } = await client.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo: `${location.origin}${location.pathname}`, scopes: 'identify' } });
  if (error) throw error;
}

/**
 * Вход гостем (#194): анонимная сессия Supabase с ником в метаданных — профиль создаёт триггер profile_from_auth.
 * После входа вызывающий перезагружает страницу: startServer подхватит сессию и вернёт на returnHash.
 */
export async function signInAsGuest(name, returnHash = location.hash) {
  const nick = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (nick.length < 2) throw new Error('Ник — хотя бы две буквы');
  try { sessionStorage.setItem('rasputye-v2-return', returnHash || '#/campaigns'); } catch { /* */ }
  const client = await supabase();
  const { error } = await client.auth.signInAnonymously({ options: { data: { name: nick } } });
  if (error) throw /anonymous/i.test(error.message || '') ? new Error('Гостевой вход выключен в Supabase (Auth → Allow anonymous sign-ins)') : error;
}

export function takeReturnHash() {
  try { const h = sessionStorage.getItem('rasputye-v2-return'); sessionStorage.removeItem('rasputye-v2-return'); return h; } catch { return null; }
}

export async function signOutServer() {
  for (const ch of channels.values()) sb?.removeChannel(ch);
  if (userChannel) sb?.removeChannel(userChannel);
  await sb?.auth.signOut();
}

// ——— Загрузка ———
async function loadProfiles() {
  const { data, error } = await sb.from('profiles').select('id,name,handle,avatar_url,hue');
  if (error) throw error;
  const db = store.getDB();
  for (const p of data) db.users[p.id] = { id: p.id, name: p.name, handle: p.handle || p.name, hue: p.hue, avatar: p.avatar_url || null, provider: p.id === me && guest ? 'guest' : 'discord' };
}

async function loadAll() {
  const db = store.getDB();
  const { data: mine, error } = await sb.from('campaign_members').select('campaign_id').eq('user_id', me);
  if (error) throw error;
  await loadProfiles();
  await Promise.all(mine.map((m) => loadCampaign(m.campaign_id, { silent: true })));
  for (const cid of Object.keys(db.campaigns)) if (!mine.some((m) => m.campaign_id === cid)) delete db.campaigns[cid];
  store.setDB(db, { remote: true, load: true });
}

const must = (r) => { if (r.error) throw r.error; return r.data; };

const loading = new Map(); // cid → {events, n}: изменения, пришедшие, пока кампания грузится
let hasSceneHidden = false; // таблица scene_hidden есть на сервере (миграция 20261106160000)
let hasTokenSecrets = false; // таблица token_secrets есть на сервере (миграция 20261105170000)
let hasCreatures = false; // таблица campaign_creatures есть на сервере (видно по первой загрузке)

/**
 * Загрузить кампанию целиком (то, что сервер разрешает видеть) и подписаться на её изменения.
 * Сначала ждёт, пока уйдут свои изменения (иначе загрузка их не увидит и затрёт кэш); изменения других,
 * пришедшие во время загрузки, применяются поверх. afterFailure — вызов из обработчика отказа (очередь уже стоит).
 */
export async function loadCampaign(cid, { silent = false, afterFailure = false } = {}) {
  if (!afterFailure) await whenSynced(cid);
  const ld = loading.get(cid) || { events: [], n: 0 };
  ld.n += 1; loading.set(cid, ld);
  let rows;
  try {
    const q = (t) => sb.from(t).select('*').eq('campaign_id', cid);
    const [campaign, members, invite, characters, scenes, secrets, explored, tokens, drawings, log, saves, portals, combat, combatPublic, creatures, tokenSecrets, sceneHidden] = await Promise.all([
      sb.from('campaigns').select('*').eq('id', cid).maybeSingle(),
      q('campaign_members'), sb.from('campaign_invites').select('*').eq('campaign_id', cid).maybeSingle(),
      q('characters'), q('scenes'), q('scene_secrets'), q('scene_explored'), q('tokens'), q('drawings'),
      sb.from('log_entries').select('*').eq('campaign_id', cid).order('at', { ascending: false }).limit(120),
      q('save_requests'), q('portal_requests'), sb.from('combats').select('*').eq('campaign_id', cid).maybeSingle(), sb.from('combat_public').select('*').eq('campaign_id', cid).maybeSingle(),
      q('campaign_creatures'), q('token_secrets'), q('scene_hidden'),
    ]);
    const logRows = must(log);
    const ids = logRows.filter((e) => HIDDEN_VIS.has(e.vis)).map((e) => e.id);
    const logSecrets = ids.length ? must(await sb.from('log_secrets').select('*').in('id', ids)) : [];
    rows = rowsFrom({
      campaign: must(campaign), members: must(members), invite: must(invite), characters: must(characters), scenes: must(scenes),
      secrets: must(secrets), explored: must(explored), tokens: must(tokens), drawings: must(drawings), log: logRows, logSecrets,
      saves: must(saves), portals: must(portals), combat: must(combat) || must(combatPublic), // полная строка боя — только мастеру (DEC-019 D4)
      // Снимки существ (TASK-179): таблицы ещё нет на живой базе (миграция #150 не применена) — кампания грузится без них.
      creatures: noTable(creatures.error) ? null : (hasCreatures = true, must(creatures)),
      // Тайное мастера в токенах: игроку RLS отдаёт пустой список; до миграции таблицы нет — токены как раньше.
      tokenSecrets: noTable(tokenSecrets.error) ? [] : (hasTokenSecrets = true, must(tokenSecrets)),
      sceneHidden: noTable(sceneHidden.error) ? [] : (hasSceneHidden = true, must(sceneHidden)),
      master: must(members).some((m) => m.user_id === me && m.status === 'active' && m.role === 'master'),
    });
  } finally {
    ld.n -= 1;
    if (!ld.n) loading.delete(cid);
  }
  for (const e of ld.events) applyChange(rows, e.table, e.type, e.row);
  if (!ld.n) ld.events.length = 0;
  cache.set(cid, rows);
  confirmedSheets.set(cid, new Map());
  for (const row of rows.characters.values()) rememberSheet(cid, row);
  const db = store.getDB();
  const c = assemble(rows);
  if (c) db.campaigns[cid] = c; else delete db.campaigns[cid];
  const unknown = (c?.members || []).filter((m) => !db.users[m.userId]);
  if (unknown.length) await loadProfiles();
  if (c && isActiveMember(cid)) subscribe(cid);
  prefetchAssets(c);
  if (!silent) store.setDB(db, { remote: true });
  return c;
}

function isActiveMember(cid) {
  const m = cache.get(cid)?.members.get(me);
  return m?.status === 'active';
}
const isMasterOf = (cid) => { const m = cache.get(cid)?.members.get(me); return m?.status === 'active' && m.role === 'master'; };

// ——— Отправка изменений ———
/** Вызывается хранилищем после каждого commit: before/after — снимки базы. */
export function afterCommit(before, after) {
  const ids = new Set([...Object.keys(before.campaigns || {}), ...Object.keys(after.campaigns || {})]);
  for (const cid of ids) {
    const b0 = before.campaigns[cid], a0 = after.campaigns[cid];
    if (b0 && a0 && JSON.stringify(b0) === JSON.stringify(a0)) continue;
    if (!b0 && a0) { enqueue(cid, () => createCampaign(a0)); continue; }
    if (b0 && !a0) { enqueue(cid, () => send(cid, [{ table: 'campaigns', op: 'delete', key: cid, prev: { id: cid } }])); continue; }
    const rows = cache.get(cid);
    if (!rows) continue;
    const master = isMasterOf(cid);
    if (master && a0.combat?.active) {
      const sc = a0.scenes.find((s) => s.id === a0.combat.sceneId) || a0.scenes.find((s) => s.id === a0.activeSceneId);
      a0.combat.current = turnTokenId(a0, sc);
    }
    // Одно «сейчас» на обе раскладки: иначе ord нового токена в них разный и уходит лишняя правка (review C14).
    const now = Date.now();
    const a = explode(b0, rows, now), b = explode(a0, rows, now);
    let ops = diffRows(a, b, { isMaster: master });
    if (!master) ops = playerCombatOps(ops, rows);
    ops = stamp(ops);
    if (!ops.length) continue;
    const groupedMembers = new Set();
    for (const op of ops) if (op.table === 'characters' && op.op === 'update' && op.prev?.sheet_version !== undefined) {
      op.sheetCommand = true;
      if (!pendingSheets.has(cid)) pendingSheets.set(cid, new Map());
      const pending = pendingSheets.get(cid); pending.set(op.key, (pending.get(op.key) || 0) + 1);
      if (op.prev.owner_id !== op.row.owner_id) {
        op.membershipChanges = ops.filter((m) => m.table === 'campaign_members' && m.op === 'update'
          && [op.prev.owner_id, op.row.owner_id].includes(m.row.user_id)
          && ((m.prev.character_id === op.key && !m.row.character_id) || (!m.prev.character_id && m.row.character_id === op.key))
          && sameSheetValue({ ...m.prev, character_id: null }, { ...m.row, character_id: null }))
          .map((m) => { groupedMembers.add(m); return { userId: m.row.user_id, before: m.prev.character_id || null, after: m.row.character_id || null }; });
      }
    }
    ops = ops.filter((o) => !groupedMembers.has(o));
    // Мастер скрыл токены — игрокам изменение не придёт (RLS), поэтому сообщаем id отдельно.
    const hiddenNow = ops.filter((o) => o.table === 'tokens' && o.op === 'update' && o.row.hidden && !o.prev?.hidden).map((o) => o.key);
    applyOps(rows, ops);
    // Пока изменение в очереди, эхо прежней своей записи из Realtime не должно его стереть (review C3).
    const mark = holdInflight(cid, ops);
    // Перемещение нескольких токенов одним действием — один вызов move_tokens (TASK-173).
    const out = groupPlacements(groupTokenMoves(ops));
    enqueue(cid, () => { mark.started = true; return send(cid, out).then(() => { if (hiddenNow.length) broadcast(cid, 'hidden-ids', { ids: hiddenNow }); }).finally(() => releaseInflight(cid, mark)); });
  }
}

// ——— Неподтверждённые изменения (review C3) ———
// Своё изменение уже в кэше, но ещё не дошло до сервера. Событие Realtime о предыдущей записи той же строки кладёт в
// кэш её старую версию — без наложения очередь «забывала» бы следующую правку, а новый commit строился бы от неё.
const inflight = new Map(); // cid → [{id, ops}]
let inflightSeq = 0;
function holdInflight(cid, ops) {
  // Журнал только добавляется; бой и спасброски игрока сверяются с сервером сами (rebasePlayerRow) — их не накладываем.
  const skip = (o) => o.table === 'log_entries' || o.table === 'log_secrets' || o.want || (o.table === 'save_requests' && !isMasterOf(cid));
  const mark = { id: ++inflightSeq, started: false, ops: structuredClone(ops.filter((o) => !skip(o))) };
  if (!inflight.has(cid)) inflight.set(cid, []);
  inflight.get(cid).push(mark);
  return mark;
}
function releaseInflight(cid, mark) {
  const list = inflight.get(cid); if (!list) return;
  const i = list.indexOf(mark); if (i >= 0) list.splice(i, 1);
  if (!list.length) inflight.delete(cid);
}
const opKey = (o) => `${o.table}|${o.table === 'campaigns' || o.table === 'campaign_invites' || o.table === 'combats' ? '' : o.key}`;
const changeKey = (table, row) => `${table}|${table === 'campaigns' || table === 'campaign_invites' || table === 'combats' ? '' : table === 'campaign_members' ? row?.user_id : table === 'scene_secrets' || table === 'scene_explored' ? row?.scene_id : row?.id}`;
/**
 * Наложить свои неподтверждённые операции этой строки поверх пришедшей версии. Токены — только ещё не отправленные:
 * их пишут частичной правкой, и эхо уже отправляемой содержит нашу правку вместе с чужими, слитыми сервером; другие
 * таблицы пишутся целой строкой — наша версия и есть то, что окажется на сервере.
 */
function reapplyInflight(cid, rows, table, row) {
  const list = inflight.get(cid); if (!list?.length) return;
  const k = changeKey(table, row);
  const ops = list.filter((x) => !x.started || table !== 'tokens').flatMap((x) => x.ops).filter((o) => opKey(o) === k);
  if (ops.length) applyOps(rows, ops);
}

/** Служебные записи («Ася за столом», «принят в кампанию») пишет тот, кто сделал действие: сервер требует author = я. */
function stamp(ops) {
  for (const o of ops) if (o.op === 'insert' && AUTHORED.has(o.table) && !o.row.author) o.row = { ...o.row, author: me };
  return ops;
}

/**
 * Игрок в бою меняет только разрешённое (решение 30.10 09:19 — можно играть за товарища, который сидит с телефона):
 * инициативу любого героя, пока она не брошена; движение любого видимого токена; «конец хода» (ended), если ходит герой.
 * Очередь, раунд и монстров ведёт мастер — его клиент передаёт ход, увидев ended.
 */
function playerCombatOps(ops, rows) {
  const i = ops.findIndex((o) => o.table === 'combats');
  if (i < 0) return ops;
  const server = rows.combat?.data || EMPTY_COMBAT();
  const want = ops[i].row.data;
  // Что игрок поменял сам — относительно его же «до» (prev), а не кэша: кэш мог уже обновиться чужим (review C1).
  const base = ops[i].prev?.data || server;
  const next = mergePlayerCombat(server, want, base, rows);
  const out = ops.filter((_, k) => k !== i);
  if (JSON.stringify(next) !== JSON.stringify(server)) out.push({ ...ops[i], row: { ...ops[i].row, data: next }, want, base });
  return out;
}

/** Наложить на строку боя server только разрешённые игроку изменения want (относительно его base). */
function mergePlayerCombat(server, want, base, rows) {
  const tokens = [...rows.tokens.values()];
  // За кого игрок может действовать — как actors в guard_combat: любой герой и свои токены (призывы, TASK-123).
  const actors = new Set(tokens.filter((t) => t.character_id || (me && t.owner_id === me)).map((t) => t.id));
  const visible = new Set(tokens.filter((t) => !t.hidden).map((t) => t.id));
  const next = structuredClone(server);
  (next.entries || []).forEach((e, k) => {
    const w = (want.entries || []).find((x) => x.tokenId === e.tokenId);
    const b = (base.entries || []).find((x) => x.tokenId === e.tokenId);
    const v = w ? Number(w.init) : NaN;
    if (actors.has(e.tokenId) && e.init == null && b?.init == null && w?.init != null && Number.isFinite(v)) next.entries[k] = { ...e, init: Math.round(v) };
  });
  for (const id of visible) {
    const v = want.moved?.[id];
    if (v !== undefined && v !== base.moved?.[id] && Number.isFinite(Number(v))) next.moved = { ...(next.moved || {}), [id]: Number(v) };
  }
  // «Закончить ход» — явная отметка ended у того, кто ходит (panels.endTurn); по номеру хода не угадываем:
  // поздний бросок инициативы пересортирует очередь у игрока и закончил бы чужой ход.
  if (want.ended && want.ended !== base.ended && want.ended === server.current && server.ended !== server.current && actors.has(server.current)) next.ended = server.current;
  return next;
}

/**
 * Игрок пишет строку боя или запроса спасброска целиком. Если кто-то записал раньше (два броска инициативы, два
 * результата спасброска разом), сервер отклонит устаревшую строку — перечитываем её и накладываем своё ещё раз
 * (review C2; точечные функции сервера — отдельное решение).
 */
async function rebasePlayerRow(cid, o, err) {
  const rows = cache.get(cid);
  if (!rows || isNetwork(err)) throw err;
  if (o.table === 'combats') {
    const fresh = must(await sb.from('combat_public').select('*').eq('campaign_id', cid).maybeSingle());
    if (!fresh) throw err;
    const next = mergePlayerCombat(fresh.data || EMPTY_COMBAT(), o.want, o.base, rows);
    const row = { ...fresh, data: next };
    if (JSON.stringify(next) !== JSON.stringify(fresh.data)) await updateRow(cid, { ...o, row });
    // Кэш — как теперь на сервере: эха может не быть (своё уже записали другие, писать нечего).
    applyChange(rows, 'combats', 'UPDATE', row); scheduleAssemble(cid);
    return;
  }
  const fresh = must(await sb.from('save_requests').select('*').eq('id', o.key).maybeSingle());
  if (!fresh) throw err;
  const was = o.prev?.data?.results || {}, mine = o.row.data?.results || {};
  const results = { ...(fresh.data?.results || {}) };
  let n = 0;
  for (const [k, v] of Object.entries(mine)) if (!(k in was) && !(k in results)) { results[k] = v; n++; }
  const row = { ...fresh, data: { ...fresh.data, results } };
  if (n) await updateRow(cid, { ...o, row });
  applyChange(rows, 'save_requests', 'UPDATE', row); scheduleAssemble(cid);
}

/**
 * Бой и спасбросок игрока — точечными функциями сервера (combat_player, save_result; аудит 04.11): уходит только
 * своё, сервер вносит его в текущую строку под блокировкой, ответ — строка после записи. Без функций на сервере
 * (миграция не применена) — false, и игрок пишет строку целиком, как раньше.
 */
let pointRpc = true;
async function sendPlayerPoint(cid, o) {
  if (!pointRpc) return false;
  const rows = cache.get(cid);
  if (!rows) return false;
  let res;
  if (o.table === 'combats') {
    const d = playerCombatDelta(o.want, o.base, rows);
    if (!d) return true;
    res = await sb.rpc('combat_player', { p_campaign: cid, p_init: d.init, p_moved: d.moved, p_ended: d.ended });
  } else {
    const results = playerSaveResults(o);
    if (!Object.keys(results).length) return true;
    res = await sb.rpc('save_result', { p_request: o.key, p_results: results });
  }
  if (res.error) {
    if (missingFn(res.error)) { pointRpc = false; return false; }
    throw res.error;
  }
  const table = o.table === 'combats' ? 'combats' : 'save_requests';
  const prev = table === 'combats' ? rows.combat : rows.saves.get(o.key);
  if (prev) { applyChange(rows, table, 'UPDATE', { ...prev, data: res.data }); scheduleAssemble(cid); }
  return true;
}

/** Дождаться, пока уйдут все изменения кампании (например, перед загрузкой обложки). */
export function whenSynced(cid) { return queues.get(cid) || Promise.resolve(); }

/** Новое существо показываем после подтверждения сервера, вместе со снимком и готовой картинкой. */
export async function persistCreatureTokens(cid, sceneId, tokens, creature = null) {
  const actor = me;
  const copies = Array.isArray(creature) ? creature : creature ? [creature] : [];
  const copyIds = new Set(copies.map((x) => x.id));
  const job = (queues.get(cid) || Promise.resolve()).then(async () => {
    if (!actor || actor !== me || !isActiveMember(cid)) throw new Error('Войдите в кампанию заново');
    const rows = cache.get(cid);
    if (!rows || (copies.length && !rows.creatures)) throw new Error('Кампания ещё не загружена');
    const c = assemble(rows), scene = c.scenes.find((s) => s.id === sceneId);
    if (!scene) throw new Error('Сцена удалена');
    for (const copy of copies) (c.creatures ||= {})[copy.id] = structuredClone(copy);
    scene.tokens.push(...structuredClone(tokens));
    const ids = new Set(tokens.map((t) => t.id));
    const ops = diffRows(rows, explode(c, rows), { isMaster: isMasterOf(cid) }).filter((o) => o.op === 'insert'
      && ((o.table === 'tokens' && ids.has(o.key)) || (o.table === 'campaign_creatures' && copyIds.has(o.key))));
    await send(cid, groupPlacements(ops));
    if (actor !== me) return;
    applyOps(rows, ops);
  });
  queues.set(cid, job.catch((err) => failed(cid, err)));
  await job;
  if (actor === me) await loadCampaign(cid);
}

function enqueue(cid, job) {
  const p = (queues.get(cid) || Promise.resolve()).then(job).catch((err) => failed(cid, err));
  queues.set(cid, p);
  return p;
}

async function createCampaign(c) {
  // Таблица снимков существ есть на сервере — новая кампания сразу с ней, а не «после обновления базы» (review C8).
  if (!hasCreatures) {
    const probe = await sb.from('campaign_creatures').select('id').limit(1);
    if (!noTable(probe.error)) { must(probe); hasCreatures = true; }
  }
  if (!hasSceneHidden) {
    const probe = await sb.from('scene_hidden').select('scene_id').limit(1);
    if (!noTable(probe.error)) { must(probe); hasSceneHidden = true; }
  }
  if (!hasTokenSecrets) {
    const probe = await sb.from('token_secrets').select('token_id').limit(1);
    if (!noTable(probe.error)) { must(probe); hasTokenSecrets = true; }
  }
  const rows0 = emptyRows(hasCreatures);
  rows0.master = true;
  const exploded = explode(c, rows0);
  // Кэш — до вставки: событие «вы мастер новой кампании» из личного канала не должно перезагружать её посреди отправки.
  rows0.campaign = structuredClone(exploded.campaign);
  rows0.members.set(me, exploded.members.get(me) || { campaign_id: c.id, user_id: me, role: 'master', status: 'active', character_id: null, scene_id: null });
  cache.set(c.id, rows0);
  await send(c.id, [{ table: 'campaigns', op: 'insert', key: c.id, row: { ...exploded.campaign, owner_id: me } }]);
  const ops = stamp(diffRows(rows0, exploded, { isMaster: true }).filter((o) => o.table !== 'campaign_members'));
  applyOps(rows0, ops);
  await send(c.id, ops);
  subscribe(c.id);
}

/**
 * Отправить операции по одной. Обрыв сети — ждём и повторяем ту же операцию (до получаса: раньше через минуту без
 * сети правка считалась отказом сервера и молча пропадала, review C10); отказ сервера — ошибка.
 */
async function send(cid, ops) {
  for (const [index, o] of ops.entries()) {
    for (let attempt = 0; ; attempt++) {
      try { await sendOne(cid, o, attempt); break; }
      catch (err) {
        if (!isNetwork(err) || attempt >= 130) { err.sheetOperations = ops.slice(index).filter((op) => op.sheetCommand); throw err; }
        netState(cid, false);
        await new Promise((r) => setTimeout(r, Math.min(15000, 700 * 2 ** attempt)));
      }
    }
  }
  netState(cid, true);
}

/**
 * Токены частичной правкой (TASK-097 п. 2.5, TASK-173): функции patch_token и move_tokens из миграции own_tokens (#126).
 * Пока миграция не применена на сервере, функций нет — вкладка переходит на прежнюю отправку целой строки (со старыми
 * ограничениями B1/B5) до перезагрузки страницы: после применения миграции частичная правка включится с новой загрузкой.
 */
let tokenRpc = true;
const missingFn = (e) => e?.code === 'PGRST202' || e?.code === '42883' || /could not find the function/i.test(String(e?.message || ''));

/**
 * Группа перемещений одной сцены: все или никто. Функция сервера берёт до 50 токенов — большую группу отклоняем
 * целиком до первой записи, иначе часть осталась бы на месте (review #174). Повтор после обрыва ставит то же место;
 * если между попытками кто-то успел подвинуть тот же токен, повтор вернёт наше место — порядка команд пока нет.
 */
const MOVE_MAX = 50;
async function sendMoves(cid, o, attempt) {
  if (tokenRpc) {
    if (o.moves.length > MOVE_MAX) throw new Error(`за раз сервер двигает не больше ${MOVE_MAX} токенов — выделите меньше`);
    const { error } = await sb.rpc('move_tokens', { p_scene: o.scene, p_moves: o.moves });
    if (!error) return;
    if (!missingFn(error)) throw error;
    tokenRpc = false;
  }
  for (const p of o.parts) await sendOne(cid, p, attempt);
}

/**
 * Правка токена — только то, что изменилось:
 * - только колонки (скрыт, сцена, герой, владелец, порядок) — UPDATE только их, старое data не уходит (review #174);
 * - только поля data — patch_token: двигающий не затирает хиты, правящий хиты — место;
 * - колонки и data вместе (редко: например, переход на другую сцену) — одной строкой целиком, как раньше: обе части
 *   проходят проверку сервера вместе, без половинчатого состояния; чужое поле data тут ещё может перезаписаться.
 * Повтор после обрыва ставит те же значения: другие поля не трогает, но более новую чужую правку того же поля
 * вернёт назад — версий и порядка команд пока нет. Хиты прибавкой (adjust_token) не используются: повтор применил
 * бы дельту дважды (аудит #57).
 */
/** Хиты прибавкой (TASK-097 2.6): только hp/tempHp числами у токена не-героя — разница к серверу, не итог. */
let hpRpc = true;
function hpDeltas(o, cols, set, unset) {
  if (!hpRpc || Object.keys(cols).length || unset.length || o.row.character_id) return null;
  const keys = Object.keys(set);
  if (!keys.length || keys.some((k) => !['hp', 'tempHp'].includes(k))) return null;
  const d = {};
  for (const k of keys) {
    const a = o.prev?.data?.[k], b = o.row.data?.[k];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    d[k] = b - a;
  }
  return d;
}

/** Ни одна строка не изменилась: токен удалили или нет прав — различаем, чтобы сказать игроку по-человечески. */
async function noRowsError(o) {
  if (o.table === 'tokens') {
    const r = await sb.from('tokens').select('id').match({ id: o.key });
    if (!r.error && !r.data?.length) return Object.assign(new Error('Токен удалён мастером'), { code: 'P0002' });
  }
  return new Error('нет доступа к изменению');
}

async function sendTokenPatch(cid, o) {
  const { cols, set, unset } = tokenPatch(o.prev, o.row);
  const hasCols = Object.keys(cols).length > 0, hasData = Object.keys(set).length > 0 || unset.length > 0;
  if (!hasCols && !hasData) return;
  if (!hasData) {
    const res = await sb.from('tokens').update(cols).match({ id: o.key }).select('id');
    if (res.error) throw res.error;
    if (!res.data?.length) throw await noRowsError(o);
    return;
  }
  // Урон и лечение складываются с чужими: прибавка с ключом повтора — повтор после обрыва не применит её дважды.
  const deltas = hpDeltas(o, cols, set, unset);
  if (deltas) {
    o.operationId ||= crypto.randomUUID();
    const { error } = await sb.rpc('adjust_token_once', { p_id: o.key, p_deltas: deltas, p_operation: o.operationId });
    if (!error) return;
    if (!missingFn(error)) throw error;
    hpRpc = false;
  }
  if (hasCols || !tokenRpc) return updateRow(cid, o);
  const { error } = await sb.rpc('patch_token', { p_id: o.key, p_set: set, p_unset: unset });
  if (!error) return;
  if (!missingFn(error)) throw error;
  tokenRpc = false;
  return updateRow(cid, o);
}

async function updateRow(cid, o) {
  const res = await sb.from(o.table).update(o.row).match(pkOf(o.table, o.row)).select(PK[o.table]?.[0] || 'id');
  if (res.error) throw res.error;
  if (!res.data?.length) throw await noRowsError(o);
}

/** Своё существо на карту одной транзакцией (place_creature); без функции на сервере — двумя вставками, как раньше. */
let placeRpc = true;
async function sendPlacement(cid, o, attempt) {
  if (placeRpc) {
    const { error } = await sb.rpc('place_creature', { p_creature: o.creature, p_token: o.token });
    if (!error || (attempt && error.code === '23505')) return; // повтор после обрыва: токен уже стоит
    if (!missingFn(error)) throw error;
    placeRpc = false;
  }
  for (const p of o.parts) await sendOne(cid, p, attempt);
}

/**
 * Картинка удалённого токена (TASK-097): файл своего бакета tokens убираем, если на него больше ничто в кампании
 * не ссылается (токены, снимки существ, листы). Удаляет мастер или хозяин папки; отказ не мешает удалению токена.
 */
async function dropTokenImage(cid, row) {
  const ref = row?.data?.img;
  if (typeof ref !== 'string' || !ref.startsWith(TOKEN_REF)) return;
  const rows = cache.get(cid);
  const used = (m) => [...(m?.values() || [])].some((r) => JSON.stringify(r.data || {}).includes(ref));
  if (!rows || used(rows.tokens) || used(rows.creatures) || used(rows.characters)) return;
  const path = ref.slice(TOKEN_REF.length);
  if (!isMasterOf(cid) && path.split('/')[1] !== me) return;
  const { error } = await sb.storage.from('tokens').remove([path]);
  if (error) console.warn('Картинка токена осталась в хранилище', error);
}

async function sendOne(cid, o, attempt) {
  if (o.sheetCommand || (o.table === 'characters' && o.op === 'update' && confirmedSheets.get(cid)?.has(o.key))) {
    o.sheetCommand = true;
    if (!o.sheetRequest) {
      const confirmed = confirmedSheets.get(cid)?.get(o.key);
      if (!confirmed) throw new SheetCommandError('conflict');
      o.sheetRequest = commandFromCharacterChange(o, confirmed);
    }
    const result = await sheets.execute(o.sheetRequest);
    const holder = { campaign: { id: cid }, characters: new Map() };
    applyCharacterSnapshot(holder, result.sheet);
    rememberSheet(cid, holder.characters.get(o.key));
    const pending = pendingSheets.get(cid); pending?.set(o.key, Math.max(0, (pending.get(o.key) || 1) - 1));
    const rows = cache.get(cid);
    if (rows && !pending?.get(o.key)) rows.characters.set(o.key, structuredClone(confirmedSheets.get(cid).get(o.key)));
    for (const m of o.membershipChanges || []) {
      const row = rows?.members.get(m.userId);
      if (row) rows.members.set(m.userId, { ...row, character_id: m.after });
    }
    scheduleAssemble(cid);
    return;
  }
  if (o.op === 'move') return sendMoves(cid, o, attempt);
  if (o.op === 'place') return sendPlacement(cid, o, attempt);
  if (o.table === 'tokens' && o.op === 'update' && o.prev) return sendTokenPatch(cid, o);
  const t = sb.from(o.table);
  let res;
  if (o.op === 'rpc') res = await sb.rpc('add_explored', o.row);
  else if (o.op === 'replace') res = await t.upsert(o.row);
  else if (o.op === 'delete') {
    res = await t.delete().match(pkOf(o.table, o.prev));
    if (!res.error && o.table === 'tokens') dropTokenImage(cid, o.prev).catch((e) => console.warn(e));
  }
  else if (o.op === 'insert') {
    res = o.table === 'characters' ? await t.insert(o.row).select('*') : await t.insert(o.row);
    if (!res.error && o.table === 'characters' && res.data?.[0]) rememberSheet(cid, res.data[0]);
    // Повтор после обрыва: строка уже успела записаться — это успех.
    if (attempt && res.error?.code === '23505') return;
  }
  else if (['campaign_invites', 'combats', 'scene_secrets'].includes(o.table) && isMasterOf(cid)) res = await t.upsert(o.row);
  else if ((o.table === 'combats' && o.want) || (o.table === 'save_requests' && o.op === 'update' && !isMasterOf(cid))) {
    if (await sendPlayerPoint(cid, o)) return;
    try { return await updateRow(cid, o); } catch (err) { return rebasePlayerRow(cid, o, err); }
  }
  else return updateRow(cid, o);
  if (res.error) throw res.error;
}

/** Таблицы нет на сервере (миграция не применена): PostgREST PGRST205 / Postgres 42P01. */
const noTable = (e) => !!e && (e.code === 'PGRST205' || e.code === '42P01' || /could not find the table|does not exist/i.test(String(e.message || '')));

/** Ошибка сети (нет интернета, сервер не ответил), а не отказ базы. */
const isNetwork = (e) => e?.kind === 'network' || (!e?.code && /fetch|network|load failed|timed? ?out|aborted/i.test(String(e?.message || e || '')));

/** Связь с сервером: стол показывает «нет связи», пока изменения ждут сети или канал переподключается. */
const down = new Set();
function netState(cid, ok) {
  if (ok ? !down.has(cid) : down.has(cid)) return;
  if (ok) down.delete(cid); else down.add(cid);
  store.deliver('connection', { cid, ok });
}

async function failed(cid, err) {
  console.warn('Сервер отклонил изменение', err);
  const msg = String(err?.message || err || '').replace(/^.*?: /, '');
  // Правили токен, который мастер уже убрал (TASK-097 2.4): не «отказ сервера», а понятная причина.
  const gone = err?.code === 'P0002' && /Токен удалён/.test(msg);
  store.emitLocal('storage-error', { message: gone ? 'Токен удалён мастером — ваша правка не сохранена.' : `Сервер не принял изменение${msg ? `: ${msg}` : ''}. Показываем, как сейчас на сервере.` });
  for (const op of err.sheetOperations || []) {
    // Отклонённый ввод сохраняется и без открытого окна листа.
    try {
      const key = `rasputye:sheet-draft:server:${me}:${cid}:${op.key}`;
      const existing = JSON.parse(sessionStorage.getItem(key) || 'null');
      const draft = existing?.draft ? rebaseCharacterDraft(existing.base, existing.draft, op.row.data).data : op.row.data;
      sessionStorage.setItem(key, JSON.stringify({ base: op.prev.data, draft, invalid: existing?.invalid || [],
        pending: err.retryable && op.sheetRequest ? { request: op.sheetRequest, sent: op.row.data } : null }));
    } catch { /* недоступное хранилище не мешает показать ошибку и откатить оптимистический кэш */ }
    store.emitLocal('sheet-write-error', { cid, characterId: op.key, before: op.prev.data, after: op.row.data, kind: err.kind || 'server', request: op.sheetRequest });
  }
  pendingSheets.delete(cid);
  try { await loadCampaign(cid, { afterFailure: true }); } catch (e) { console.warn(e); }
}

/** Вызвать функцию сервера (вступление, выбор героя). */
export async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data;
}

export async function deleteMembership(cid, userId = me) {
  must(await sb.from('campaign_members').delete().match({ campaign_id: cid, user_id: userId }));
}

// ——— Реальное время ———
function subscribe(cid) {
  if (channels.has(cid)) return;
  const ch = sb.channel(`campaign:${cid}`, { config: { private: true, broadcast: { self: false }, presence: { key: `${me}:${Math.random().toString(36).slice(2, 8)}` } } });
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'campaigns', filter: `id=eq.${cid}` }, (p) => onChange(cid, 'campaigns', p));
  for (const t of CAMPAIGN_TABLES) ch.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: `campaign_id=eq.${cid}` }, (p) => onChange(cid, t, p));
  // Удаления этих таблиц по фильтру не приходят (TASK-168): слушаем без фильтра, применяем только ключи своей кампании.
  // Пока кампания грузится, событие копится и применяется к свежим строкам — чужой ключ там ничего не удалит.
  for (const t of UNFILTERED_DELETES) ch.on('postgres_changes', { event: 'DELETE', schema: 'public', table: t }, (p) => {
    if (loading.has(cid) || ownsDeleted(cache.get(cid), t, p.old)) onChange(cid, t, p);
  });
  // Снимки существ кампании (TASK-097): только если таблица есть на сервере — подписка на несуществующую ломает канал.
  // Ключ удаления содержит campaign_id, поэтому удаление фильтруем сами.
  if (hasCreatures) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_creatures', filter: `campaign_id=eq.${cid}` }, (p) => onChange(cid, 'campaign_creatures', p));
    ch.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'campaign_creatures' }, (p) => { if (p.old?.campaign_id === cid) onChange(cid, 'campaign_creatures', p); });
  }
  // Секреты токенов (только мастеру по RLS). Удаление приходит без фильтра — своё узнаём по ключу в кэше.
  if (hasSceneHidden) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'scene_hidden', filter: `campaign_id=eq.${cid}` }, (p) => onChange(cid, 'scene_hidden', p));
    ch.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'scene_hidden' }, (p) => { if (cache.get(cid)?.sceneHidden?.has(p.old?.scene_id)) onChange(cid, 'scene_hidden', p); });
  }
  if (hasTokenSecrets) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'token_secrets', filter: `campaign_id=eq.${cid}` }, (p) => onChange(cid, 'token_secrets', p));
    ch.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'token_secrets' }, (p) => { if (cache.get(cid)?.tokenSecrets?.has(p.old?.token_id)) onChange(cid, 'token_secrets', p); });
  }
  ch.on('broadcast', { event: 'bus' }, ({ payload }) => onBus(cid, payload));
  ch.on('presence', { event: 'sync' }, () => {
    const map = new Map();
    for (const [key, metas] of Object.entries(ch.presenceState())) map.set(key, metas[0]);
    presence.set(cid, map);
    store.deliver('presence-change', {});
  });
  // Аудит #57 (B2): кампанию читают до подписки — изменения между чтением и SUBSCRIBED иначе потерялись бы.
  // После первой подписки перечитываем: события, пришедшие во время чтения, копятся и накладываются (loading).
  let fresh = true;
  ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      if (fresh) { fresh = false; loadCampaign(cid, { silent: true }).catch(() => {}); }
      if (myPresence?.campaignId === cid) ch.track(myPresence);
      if (ch.__wasDown) { ch.__wasDown = false; netState(cid, true); loadCampaign(cid).catch(() => {}); }
    }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      if (!ch.__wasDown) { ch.__wasDown = true; netState(cid, false); }
    }
  });
  channels.set(cid, ch);
}

function onChange(cid, table, p) {
  const rows = cache.get(cid); if (!rows) return;
  // Игроку бой приходит очищенной копией; мастер живёт полной строкой и копию пропускает.
  if (table === 'combat_public') { if (rows.master) return; table = 'combats'; }
  const row = p.eventType === 'DELETE' ? p.old : p.new;
  if (p.eventType === 'DELETE') {
    // Удаления Realtime не фильтрует по кампании и присылает только ключ строки — чужие отсекаем сами.
    if (table === 'campaigns' && row?.id !== cid) return;
    if (['campaign_members', 'campaign_invites', 'combats'].includes(table) && row?.campaign_id !== cid) return;
    if (table === 'campaign_members' && row.user_id === me) { removed(cid); return; }
  }
  loading.get(cid)?.events.push({ table, type: p.eventType, row });
  // Игроку открылась новая сцена: её токены и рисунки событиями не придут — они не менялись. Перечитываем кампанию.
  const opened = table === 'scenes' && p.eventType !== 'DELETE' && !rows.master && !rows.scenes.has(row?.id);
  if (table === 'characters' && p.eventType !== 'DELETE') {
    rememberSheet(cid, row);
    if (pendingSheets.get(cid)?.get(row.id)) { scheduleAssemble(cid); return; }
    const confirmed = confirmedSheets.get(cid)?.get(row.id);
    applyChange(rows, table, p.eventType, confirmed || row);
  } else {
    applyChange(rows, table, p.eventType, row);
    // Листы ведут свою очередь подтверждённых версий (confirmedSheets/pendingSheets) — повторно не накладываем.
    reapplyInflight(cid, rows, table, row);
  }
  if (table === 'campaign_members' && p.eventType !== 'DELETE' && !store.getDB().users[row.user_id]) loadProfiles().catch(() => {});
  if (opened) loadCampaign(cid, { silent: true }).catch(() => {});
  scheduleAssemble(cid);
}

function scheduleAssemble(cid) {
  if (reassembleTimers.has(cid)) return;
  reassembleTimers.set(cid, setTimeout(() => {
    reassembleTimers.delete(cid);
    const rows = cache.get(cid); if (!rows) return;
    const db = store.getDB();
    const c = assemble(rows);
    if (!c) { delete db.campaigns[cid]; store.setDB(db, { remote: true }); return; }
    db.campaigns[cid] = c;
    store.setDB(db, { remote: true });
    prefetchAssets(c); // новая картинка своего токена у собеседника (TASK-183)
    masterDuties(cid, c);
  }, 30));
}

/** Клиент мастера выполняет то, чего не может игрок: передаёт ход по «конец хода». */
function masterDuties(cid, c) {
  if (!isMasterOf(cid)) return;
  const cb = c.combat;
  if (cb?.active && cb.current && !cb.ended) {
    // Инициатива игрока пересортировала очередь: номер хода догоняет того, кто ходит (current), иначе
    // следующий commit мастера передал бы ход не тому.
    const sc = c.scenes.find((s) => s.id === cb.sceneId) || c.scenes.find((s) => s.id === c.activeSceneId);
    const i = turnIndexOf(initiativeOrder(c, sc), cb.current); // у пачки — начало её слота (#198)
    if (i >= 0 && i !== cb.turn) store.commit((db) => { const cc = db.campaigns[cid]; if (cc?.combat?.active) cc.combat.turn = i; });
  }
  if (cb?.active && cb.ended && cb.ended === cb.current) {
    store.commit((db) => {
      const cc = db.campaigns[cid]; if (!cc) return;
      const sc = cc.scenes.find((s) => s.id === cc.combat.sceneId);
      cc.combat.current = cc.combat.current ?? null;
      advanceTurn(cc, sc, 1);
      delete cc.combat.ended;
    });
  }
}

function removed(cid, { quiet = false } = {}) {
  const ch = channels.get(cid); if (ch) { sb.removeChannel(ch); channels.delete(cid); }
  cache.delete(cid);
  // Аудит #57: после исключения в вкладке не остаётся ничего из кампании — очереди, подтверждённые листы, черновики.
  inflight.delete(cid); loading.delete(cid); confirmedSheets.delete(cid); pendingSheets.delete(cid);
  try {
    const prefix = `rasputye:sheet-draft:server:${me}:${cid}:`;
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(prefix)) sessionStorage.removeItem(k);
  } catch { /* хранилище недоступно — чистить нечего */ }
  const db = store.getDB();
  const name = db.campaigns[cid]?.name;
  if (!db.campaigns[cid]) return;
  delete db.campaigns[cid];
  if (!quiet) store.emitLocal('storage-error', { message: `Вы больше не в кампании «${name || ''}».` });
  store.setDB(db, { remote: true });
}

/**
 * Уйти из кампании самому (игрок; заявка — отменить): служебная запись — пока ещё участник, затем удаление своего
 * членства. Лист героя не трогаем — владельца меняет мастер, а освободившийся герой и так свободен (claim_character).
 * Кампания убирается только отсюда: удалить её строку игрок не может, и commit с удалением кампании не нужен.
 */
export async function leaveCampaign(cid) {
  await whenSynced(cid);
  await deleteMembership(cid);
  removed(cid, { quiet: true });
}

/** Личный канал: ждущий одобрения узнаёт, что его приняли; новые кампании подхватываются. */
function listenToMe() {
  userChannel = sb.channel(`user:${me}`, { config: { private: true } });
  userChannel.on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_members', filter: `user_id=eq.${me}` }, (p) => {
    const row = p.eventType === 'DELETE' ? p.old : p.new;
    if (!row?.campaign_id) return;
    if (p.eventType === 'DELETE') { if (cache.has(row.campaign_id)) removed(row.campaign_id); return; }
    // Уже сижу за столом этой кампании — её канал сам привезёт изменение. Грузим только новое: вступление, одобрение.
    if (row.status === 'active' && cache.get(row.campaign_id)?.members.get(me)?.status === 'active') return;
    loadCampaign(row.campaign_id).catch((e) => console.warn(e));
  });
  userChannel.subscribe();
}

// ——— Мгновенные события ———
/** Отправить мгновенное событие участникам кампании (перетаскивание, пинг, линейка, бросок…). */
export function broadcast(cid, type, payload = {}) {
  const ch = channels.get(cid); if (!ch) return;
  let p = payload;
  // Скрытый бросок: в канал уходит только факт броска — сумму мастер получит из log_secrets.
  if (type === 'roll' && p.entry && HIDDEN_VIS.has(p.entry.vis || (p.entry.hidden ? 'gm' : 'all'))) {
    const { label, total, detail, nat, dice, results, ...rest } = p.entry;
    p = { ...p, entry: { ...rest, hidden: true, redacted: true } };
  }
  ch.send({ type: 'broadcast', event: 'bus', payload: { type, payload: p, from: me } });
}

function onBus(cid, msg) {
  if (!msg?.type) return;
  if (msg.type === 'hidden-ids') {
    const rows = cache.get(cid); if (!rows || isMasterOf(cid)) return;
    // Сообщение может прислать любой участник — убираем только то, чего сервер нам правда больше не отдаёт (review C11).
    const ids = (msg.payload?.ids || []).filter((id) => typeof id === 'string' && rows.tokens.has(id)).slice(0, 200);
    if (!ids.length) return;
    sb.from('tokens').select('id').eq('campaign_id', cid).in('id', ids).then(({ data, error }) => {
      if (error) return;
      const still = new Set((data || []).map((r) => r.id));
      const r2 = cache.get(cid); if (!r2) return;
      let n = 0;
      for (const id of ids) if (!still.has(id) && r2.tokens.delete(id)) n++;
      if (n) scheduleAssemble(cid);
    });
    return;
  }
  if (msg.type === 'roll' && msg.payload?.entry?.redacted) {
    // Тайная часть броска приходит изменением log_secrets — подождём её, если она нам положена.
    setTimeout(() => {
      const e = store.getDB().campaigns[cid]?.log.find((x) => x.id === msg.payload.entry.id);
      store.deliver('roll', { ...msg.payload, entry: e && !e.redacted ? e : msg.payload.entry }, { remote: true });
    }, 450);
    return;
  }
  store.deliver(msg.type, msg.payload, { remote: true, from: msg.from });
}

// ——— Присутствие ———
export function setServerPresence(info) {
  const prev = myPresence;
  myPresence = info ? { userId: me, campaignId: info.campaignId, sceneId: info.sceneId } : null;
  if (prev && (!info || prev.campaignId !== info.campaignId)) channels.get(prev.campaignId)?.untrack();
  if (myPresence) channels.get(myPresence.campaignId)?.track(myPresence);
}

export function serverOnline(campaignId) {
  const ids = new Set();
  for (const [cid, map] of presence) if (!campaignId || cid === campaignId) for (const p of map.values()) if (p?.userId) ids.add(p.userId);
  if (myPresence && (!campaignId || myPresence.campaignId === campaignId)) ids.add(me);
  return ids;
}

// ——— Картинки из хранилища ———
const signed = new Map(); // 'sb:<путь>' → {url, until}

export function signedUrl(ref) {
  const s = signed.get(ref);
  return s && s.until > Date.now() ? s.url : '';
}

// 'sb:<путь>' — бакет карт; 'sb:@tokens/<путь>' — картинки своих токенов игроков (бакет tokens, TASK-183).
const TOKEN_REF = 'sb:@tokens/';
const bucketOf = (ref) => (ref.startsWith(TOKEN_REF) ? ['tokens', ref.slice(TOKEN_REF.length)] : ['maps', ref.slice(3)]);

export async function resolveSigned(ref) {
  const hit = signedUrl(ref); if (hit) return hit;
  if (!sb) return '';
  const [bucket, path] = bucketOf(ref);
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, 3600 * 6);
  if (error || !data?.signedUrl) return '';
  signed.set(ref, { url: data.signedUrl, until: Date.now() + 3600 * 6 * 1000 - 60000 });
  return data.signedUrl;
}

/** Загрузить картинку карты в хранилище кампании. Возвращает ссылку 'sb:<cid>/<uuid>.<ext>'. */
export async function uploadImage(cid, blob) {
  const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' })[blob.type] || 'webp';
  const path = `${cid}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from('maps').upload(path, blob, { contentType: blob.type || 'image/webp', upsert: false });
  if (error) throw new Error(error.message?.includes('row-level') ? 'Загружать карты в кампанию может только мастер' : error.message);
  const ref = `sb:${path}`;
  signed.set(ref, { url: URL.createObjectURL(blob), until: Date.now() + 3600 * 1000 });
  return ref;
}

/**
 * Картинка своего токена игрока (TASK-183): PNG, JPEG или WebP до 5 МБ в бакет tokens, путь <кампания>/<игрок>/<файл>.
 * Возвращает ссылку 'sb:@tokens/<путь>'. Читают её участники кампании (RLS бакета).
 */
export async function uploadTokenImage(cid, blob) {
  const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' })[blob?.type];
  if (!ext || blob.size > 5 * 1024 * 1024) throw new Error('Нужна картинка PNG, JPEG или WebP до 5 МБ');
  if (!sb || !me) throw new Error('Нет связи с сервером');
  const path = `${cid}/${me}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from('tokens').upload(path, blob, { contentType: blob.type, upsert: false });
  if (error) {
    const msg = String(error.message || '');
    throw new Error(/bucket not found/i.test(msg) ? 'Картинки своих токенов появятся после обновления базы' : /row-level/i.test(msg) ? 'Картинку можно загрузить только в свою кампанию' : msg);
  }
  const ref = `${TOKEN_REF}${path}`;
  signed.set(ref, { url: URL.createObjectURL(blob), until: Date.now() + 3600 * 1000 });
  return ref;
}

const asked = new Map(); // ссылка → время последней попытки: недоступную картинку не спрашиваем на каждое событие
function prefetchAssets(c) {
  if (!c) return;
  const toks = c.scenes.flatMap((s) => (s.tokens || []).map((t) => t.img));
  const pictures = Object.values(c.creatures || {}).flatMap((x) => [x.img, x.statblockImage]);
  const now = Date.now();
  const refs = new Set([c.cover, ...c.scenes.map((s) => s.map?.src), ...toks, ...pictures].filter((r) => r?.startsWith('sb:') && !signedUrl(r) && now - (asked.get(r) || 0) > 60000));
  if (!refs.size) return;
  for (const r of refs) asked.set(r, now);
  Promise.all([...refs].map(resolveSigned)).then(() => store.setDB(store.getDB(), { remote: true, assets: true }));
}
