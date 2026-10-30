// Серверный режим (TASK-002): загрузка кампаний, отправка изменений, реальное время,
// мгновенные события (Broadcast) и присутствие (Presence) на приватном канале campaign:<id>.
//
// Источник правды — кэш строк каждой кампании (rows). Изменение пользователя: снимок «до/после» →
// diffRows → операции применяются к кэшу сразу (оптимистично) и уходят на сервер по очереди.
// Отказ сервера → сообщение и перезагрузка кампании с сервера. События других участников приходят
// изменениями таблиц → кэш → сборка кампании → setDB.
import { supabase } from './client.js';
import { assemble, explode, diffRows, applyOps, applyChange, rowsFrom, emptyRows, EMPTY_COMBAT } from './model.js';
import { advanceTurn, turnTokenId, initiativeOrder } from '../views/table/combat.js';

const CAMPAIGN_TABLES = ['campaign_members', 'campaign_invites', 'characters', 'scenes', 'scene_secrets', 'scene_explored', 'tokens', 'drawings', 'log_entries', 'log_secrets', 'save_requests', 'portal_requests', 'combats'];
const PK = { campaigns: ['id'], campaign_invites: ['campaign_id'], campaign_members: ['campaign_id', 'user_id'], scene_secrets: ['scene_id'], combats: ['campaign_id'] };
const pkOf = (table, row) => Object.fromEntries((PK[table] || ['id']).map((k) => [k, row[k]]));
const HIDDEN_VIS = new Set(['gm', 'blind', 'self']);
const AUTHORED = new Set(['log_entries', 'log_secrets', 'portal_requests']);

let sb = null;
let me = null;
let store = null; // {getDB, setDB, deliver, emitLocal, commit}
const cache = new Map();       // cid → rows
const channels = new Map();    // cid → RealtimeChannel
const presence = new Map();    // cid → Map<key, info>
const queues = new Map();      // cid → Promise (очередь отправки)
const reassembleTimers = new Map();
let myPresence = null;
let userChannel = null;

export const serverUserId = () => me;

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
  for (const p of data) db.users[p.id] = { id: p.id, name: p.name, handle: p.handle || p.name, hue: p.hue, avatar: p.avatar_url || null, provider: 'discord' };
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
    const [campaign, members, invite, characters, scenes, secrets, explored, tokens, drawings, log, saves, portals, combat] = await Promise.all([
      sb.from('campaigns').select('*').eq('id', cid).maybeSingle(),
      q('campaign_members'), sb.from('campaign_invites').select('*').eq('campaign_id', cid).maybeSingle(),
      q('characters'), q('scenes'), q('scene_secrets'), q('scene_explored'), q('tokens'), q('drawings'),
      sb.from('log_entries').select('*').eq('campaign_id', cid).order('at', { ascending: false }).limit(120),
      q('save_requests'), q('portal_requests'), sb.from('combats').select('*').eq('campaign_id', cid).maybeSingle(),
    ]);
    const logRows = must(log);
    const ids = logRows.filter((e) => HIDDEN_VIS.has(e.vis)).map((e) => e.id);
    const logSecrets = ids.length ? must(await sb.from('log_secrets').select('*').in('id', ids)) : [];
    rows = rowsFrom({
      campaign: must(campaign), members: must(members), invite: must(invite), characters: must(characters), scenes: must(scenes),
      secrets: must(secrets), explored: must(explored), tokens: must(tokens), drawings: must(drawings), log: logRows, logSecrets,
      saves: must(saves), portals: must(portals), combat: must(combat),
    });
  } finally {
    ld.n -= 1;
    if (!ld.n) loading.delete(cid);
  }
  for (const e of ld.events) applyChange(rows, e.table, e.type, e.row);
  if (!ld.n) ld.events.length = 0;
  cache.set(cid, rows);
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
    const a = explode(b0, rows), b = explode(a0, rows);
    let ops = diffRows(a, b, { isMaster: master });
    if (!master) ops = playerCombatOps(ops, rows);
    ops = stamp(ops);
    if (!ops.length) continue;
    // Мастер скрыл токены — игрокам изменение не придёт (RLS), поэтому сообщаем id отдельно.
    const hiddenNow = ops.filter((o) => o.table === 'tokens' && o.op === 'update' && o.row.hidden && !o.prev?.hidden).map((o) => o.key);
    applyOps(rows, ops);
    enqueue(cid, () => send(cid, ops).then(() => { if (hiddenNow.length) broadcast(cid, 'hidden-ids', { ids: hiddenNow }); }));
  }
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
  const tokens = [...rows.tokens.values()];
  const heroes = new Set(tokens.filter((t) => t.character_id).map((t) => t.id));
  const visible = new Set(tokens.filter((t) => !t.hidden).map((t) => t.id));
  const next = structuredClone(server);
  (next.entries || []).forEach((e, k) => {
    const w = (want.entries || []).find((x) => x.tokenId === e.tokenId);
    if (heroes.has(e.tokenId) && e.init == null && w && w.init != null) next.entries[k] = { ...e, init: w.init };
  });
  for (const id of visible) if (want.moved?.[id] !== undefined && want.moved[id] !== server.moved?.[id]) next.moved = { ...(next.moved || {}), [id]: want.moved[id] };
  if ((want.turn !== server.turn || want.round !== server.round) && heroes.has(server.current)) next.ended = server.current;
  const out = ops.filter((_, k) => k !== i);
  if (JSON.stringify(next) !== JSON.stringify(server)) out.push({ ...ops[i], row: { ...ops[i].row, data: next } });
  return out;
}

/** Дождаться, пока уйдут все изменения кампании (например, перед загрузкой обложки). */
export function whenSynced(cid) { return queues.get(cid) || Promise.resolve(); }

function enqueue(cid, job) {
  const p = (queues.get(cid) || Promise.resolve()).then(job).catch((err) => failed(cid, err));
  queues.set(cid, p);
  return p;
}

async function createCampaign(c) {
  const rows0 = emptyRows();
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

/** Отправить операции по одной. Обрыв сети — ждём и повторяем ту же операцию; отказ сервера — ошибка. */
async function send(cid, ops) {
  for (const o of ops) {
    for (let attempt = 0; ; attempt++) {
      try { await sendOne(cid, o, attempt); break; }
      catch (err) {
        if (!isNetwork(err) || attempt >= 8) throw err;
        netState(cid, false);
        await new Promise((r) => setTimeout(r, Math.min(15000, 700 * 2 ** attempt)));
      }
    }
  }
  netState(cid, true);
}

async function sendOne(cid, o, attempt) {
  const t = sb.from(o.table);
  let res;
  if (o.op === 'rpc') res = await sb.rpc('add_explored', o.row);
  else if (o.op === 'delete') res = await t.delete().match(pkOf(o.table, o.prev));
  else if (o.op === 'insert') {
    res = await t.insert(o.row);
    // Повтор после обрыва: строка уже успела записаться — это успех.
    if (attempt && res.error?.code === '23505') return;
  }
  else if (['campaign_invites', 'combats', 'scene_secrets'].includes(o.table) && isMasterOf(cid)) res = await t.upsert(o.row);
  else {
    res = await t.update(o.row).match(pkOf(o.table, o.row)).select(PK[o.table]?.[0] || 'id');
    if (!res.error && !res.data?.length) throw new Error('нет доступа к изменению');
  }
  if (res.error) throw res.error;
}

/** Ошибка сети (нет интернета, сервер не ответил), а не отказ базы. */
const isNetwork = (e) => !e?.code && /fetch|network|load failed|timed? ?out|aborted/i.test(String(e?.message || e || ''));

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
  store.emitLocal('storage-error', { message: `Сервер не принял изменение${msg ? `: ${msg}` : ''}. Показываем, как сейчас на сервере.` });
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
  ch.on('broadcast', { event: 'bus' }, ({ payload }) => onBus(cid, payload));
  ch.on('presence', { event: 'sync' }, () => {
    const map = new Map();
    for (const [key, metas] of Object.entries(ch.presenceState())) map.set(key, metas[0]);
    presence.set(cid, map);
    store.deliver('presence-change', {});
  });
  ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
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
  const row = p.eventType === 'DELETE' ? p.old : p.new;
  if (p.eventType === 'DELETE') {
    // Удаления Realtime не фильтрует по кампании и присылает только ключ строки — чужие отсекаем сами.
    if (table === 'campaigns' && row?.id !== cid) return;
    if (['campaign_members', 'campaign_invites', 'combats'].includes(table) && row?.campaign_id !== cid) return;
    if (table === 'campaign_members' && row.user_id === me) { removed(cid); return; }
  }
  loading.get(cid)?.events.push({ table, type: p.eventType, row });
  applyChange(rows, table, p.eventType, row);
  if (table === 'campaign_members' && p.eventType !== 'DELETE' && !store.getDB().users[row.user_id]) loadProfiles().catch(() => {});
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
    const i = initiativeOrder(c, sc).findIndex((e) => e.tokenId === cb.current);
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

function removed(cid) {
  const ch = channels.get(cid); if (ch) { sb.removeChannel(ch); channels.delete(cid); }
  cache.delete(cid);
  const db = store.getDB();
  const name = db.campaigns[cid]?.name;
  delete db.campaigns[cid];
  store.emitLocal('storage-error', { message: `Вы больше не в кампании «${name || ''}».` });
  store.setDB(db, { remote: true });
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
    for (const id of msg.payload.ids || []) rows.tokens.delete(id);
    scheduleAssemble(cid); return;
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

export async function resolveSigned(ref) {
  const hit = signedUrl(ref); if (hit) return hit;
  if (!sb) return '';
  const { data, error } = await sb.storage.from('maps').createSignedUrl(ref.slice(3), 3600 * 6);
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

function prefetchAssets(c) {
  if (!c) return;
  const refs = new Set([c.cover, ...c.scenes.map((s) => s.map?.src)].filter((r) => r?.startsWith('sb:') && !signedUrl(r)));
  if (!refs.size) return;
  Promise.all([...refs].map(resolveSigned)).then(() => store.setDB(store.getDB(), { remote: true, assets: true }));
}
