// Локальное хранилище демо-версии и «имитация онлайна» между вкладками одного браузера.
// Это НЕ сервер и НЕ защита данных: всё лежит в localStorage этого устройства (см. docs/data.md).
// Вкладки синхронизируются событием storage (данные) и BroadcastChannel (мгновенные события:
// пинг, перетаскивание, линейка, присутствие).

export const DB_KEY = 'rasputye-v2-db';
export const SCHEMA = 1;

let db = null;
const listeners = new Set();
// Серверный режим (TASK-002): данные приходят с Supabase, изменения уходят туда же (server/sync.js).
// API для экранов и стола не меняется: getDB, commit, subscribe, bus, setPresence, onlineUsers.
let backend = null;
export const isServerMode = () => !!backend;
export const backendUserId = () => backend?.userId() || null;
const tabId = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
const channel = 'BroadcastChannel' in self ? new BroadcastChannel('rasputye-v2') : null;

function read() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && v.version === SCHEMA ? v : null;
  } catch { return null; }
}

function write(value) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error(err);
    emitLocal('storage-error', { message: 'Хранилище браузера заполнено — изменения не сохранились.' });
    return false;
  }
}

export function initStore(seed) {
  db = read();
  if (!db) { db = seed(); write(db); }
  window.addEventListener('storage', (e) => {
    if (e.key !== DB_KEY) return;
    const fresh = read();
    if (fresh) { db = fresh; notify({ remote: true }); }
  });
  return db;
}

export const getDB = () => db;

/** Включить серверный режим: пустая база, которую наполнит sync.js. */
export function useServerBackend(b) {
  backend = b;
  db = { version: SCHEMA, rev: 0, users: {}, campaigns: {}, server: true };
  channel?.close();
  return db;
}

/** Серверный режим: новые данные с сервера (загрузка, изменения других участников). */
export function setDB(next, meta = {}) { db = next; db.rev = (db.rev || 0) + 1; notify(meta); }

/** Серверный режим: мгновенное событие от другого участника — тем же обработчикам, что и BroadcastChannel. */
export function deliver(type, payload, meta = {}) {
  for (const fn of [...(busHandlers.get(type) || [])]) { try { fn(payload, { ...meta, tab: 'remote' }); } catch (err) { console.error(err); } }
}

/**
 * Изменить данные. Перед изменением перечитываем свежую версию — так две вкладки
 * реже затирают друг друга (последняя запись всё равно побеждает).
 */
export function commit(mutator, meta = {}) {
  if (backend) {
    const before = { campaigns: structuredClone(db.campaigns) };
    const result = mutator(db);
    db.rev = (db.rev || 0) + 1;
    db.updatedAt = Date.now();
    try { backend.afterCommit(before, db, meta); } catch (err) { console.error(err); }
    notify(meta);
    return result;
  }
  const fresh = read();
  if (fresh && fresh.rev >= db.rev) db = fresh;
  const result = mutator(db);
  db.rev = (db.rev || 0) + 1;
  db.updatedAt = Date.now();
  write(db);
  notify(meta);
  return result;
}

/** Полная замена (сброс демо). */
export function replaceDB(value) { db = value; write(db); notify({ reset: true }); }

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify(meta) { for (const fn of [...listeners]) { try { fn(db, meta); } catch (e) { console.error(e); } } }

// ——— Мгновенные события между вкладками ———
const busHandlers = new Map();
export const bus = {
  tabId,
  send(type, payload = {}) {
    if (backend) { if (!type.startsWith('presence')) backend.send(type, payload); return; }
    const msg = { type, payload, tab: tabId, at: Date.now() };
    channel?.postMessage(msg);
  },
  on(type, fn) {
    if (!busHandlers.has(type)) busHandlers.set(type, new Set());
    busHandlers.get(type).add(fn);
    return () => busHandlers.get(type)?.delete(fn);
  },
};
function emitLocal(type, payload) { for (const fn of busHandlers.get(type) || []) fn(payload, { tab: tabId, local: true }); }
export { emitLocal };
channel?.addEventListener('message', (e) => {
  const m = e.data;
  if (!m || m.tab === tabId) return;
  for (const fn of busHandlers.get(m.type) || []) { try { fn(m.payload, m); } catch (err) { console.error(err); } }
});

// ——— Присутствие: кто сейчас открыл стол ———
const presence = new Map(); // tab -> {userId, campaignId, sceneId, at}
let me = null;
export function setPresence(info) {
  if (backend) { backend.setPresence(info); return; }
  me = info ? { ...info, tab: tabId } : null;
  beat();
}
function beat() {
  if (backend) return;
  if (me) { presence.set(tabId, { ...me, at: Date.now() }); bus.send('presence', me); }
  else bus.send('presence-bye', {});
}
bus.on('presence', (p, m) => { presence.set(m.tab, { ...p, at: Date.now() }); emitLocal('presence-change', {}); });
bus.on('presence-bye', (_, m) => { presence.delete(m.tab); emitLocal('presence-change', {}); });
bus.on('presence-ask', () => beat());
setInterval(beat, 4000);
setInterval(() => {
  const now = Date.now(); let changed = false;
  for (const [t, p] of presence) if (t !== tabId && now - p.at > 11000) { presence.delete(t); changed = true; }
  if (changed) emitLocal('presence-change', {});
}, 3000);
window.addEventListener('pagehide', () => { if (!backend) bus.send('presence-bye', {}); });
bus.send('presence-ask', {});

/** Пользователи, у которых открыта вкладка с этой кампанией (включая текущую). */
export function onlineUsers(campaignId) {
  if (backend) return backend.online(campaignId);
  const ids = new Set();
  for (const p of presence.values()) if (!campaignId || p.campaignId === campaignId) ids.add(p.userId);
  return ids;
}
