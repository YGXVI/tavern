// Хранилище «на этом устройстве» для кампании (#203): вступление и черновики раздаток мастера, встречи.
// Только localStorage этого браузера — на сервер не уходит и между устройствами не переносится (docs/data.md).
const KEY = {
  secret: (cid, uid) => `rasputye-book-secret:${cid}:${uid}`,   // мастер: вступление, черновики раздаток
  enc: (cid, uid) => `rasputye-encounters:${cid}:${uid}`,       // мастер: встречи
};

function read(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v && typeof v === 'object' ? v : fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
const listeners = new Set();
export const onLocal = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => { for (const fn of [...listeners]) { try { fn(); } catch (e) { console.error(e); } } };
globalThis.addEventListener?.('storage', (e) => { if (/^rasputye-(book|encounters)/.test(e.key || '')) notify(); });

const DEF = {
  secret: () => ({ intro: '', handouts: [] }),
  enc: () => ({ list: [] }),
};
/** Прочитать: kind — secret | enc. */
export function local(kind, cid, uid) { return { ...DEF[kind](), ...read(KEY[kind](cid, uid), {}) }; }
/** Изменить: fn(value) правит объект на месте. */
export function updateLocal(kind, cid, uid, fn) {
  const v = local(kind, cid, uid);
  const r = fn(v);
  write(KEY[kind](cid, uid), v);
  notify();
  return r;
}
