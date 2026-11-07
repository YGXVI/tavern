// «Мои герои» вне кампаний (#203, 06.11 — sol0139: «герой создаётся отдельно, а потом предлагается его добавление в
// кампанию»). Мастер создания, быстрый герой и перенос из LSS кладут героя сюда; в кампанию уходит его копия
// (contract.bringToCampaign → placeHero), как при «Привести в кампанию».
// Хранилище — localStorage по пользователю: в песочнице это и есть база героев; на сервере — копия таблицы heroes (DEC-019 D1):
// правки уходят в базу через setLibrarySink, а mergeLibrary при входе сводит устройство с базой по времени правки.
// Старый комментарий: на сервере — пока на устройстве, до
// таблицы личных героев (#202). Удалённые лежат рядом и возвращаются.
const KEY = 'rasputye-heroes-v1';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const write = (all) => { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* приватный режим */ } };
const box = (all, userId) => (all[userId] ||= { heroes: [], archived: [] });
const changed = () => { try { window.dispatchEvent(new CustomEvent('hero:changed')); } catch { /* вне браузера */ } };
let sink = null;
/** Куда отправлять правки (сервер): fn(hero, archived). Сбой не мешает работе — герой уйдёт при следующем сведении. */
export const setLibrarySink = (fn) => { sink = fn; };
const push = (h, archived = false) => { try { sink?.(structuredClone(h), archived); } catch { /* уйдёт при следующем сведении */ } };

/**
 * Свести устройство с базой: rows — [{ id, data, archived_at }]. Новее — то, что правили позже (updatedAt).
 * Возвращает [{ hero, archived }], что надо отправить в базу: герои, которых там нет, и более свежие.
 */
export function mergeLibrary(userId, rows) {
  const all = read(), b = box(all, userId), up = [];
  const local = new Map([...b.heroes.map((h) => [h.id, { h, archived: false }]), ...b.archived.map((h) => [h.id, { h, archived: true }])]);
  for (const r of rows) {
    const mine = local.get(r.id), theirs = { ...r.data, id: r.id, ownerId: userId }, gone = !!r.archived_at;
    local.delete(r.id);
    if (mine && (mine.h.updatedAt || 0) > (theirs.updatedAt || 0)) { up.push({ hero: mine.h, archived: mine.archived }); continue; }
    if (mine && (mine.h.updatedAt || 0) === (theirs.updatedAt || 0) && mine.archived === gone) continue;
    b.heroes = b.heroes.filter((x) => x.id !== r.id); b.archived = b.archived.filter((x) => x.id !== r.id);
    (gone ? b.archived : b.heroes).unshift(theirs);
  }
  for (const { h, archived } of local.values()) up.push({ hero: h, archived });
  write(all); changed();
  return structuredClone(up);
}

/** Свои герои пользователя: [{ ...данные листа, id, ownerId }]. */
export const libraryHeroes = (userId) => (userId ? structuredClone(read()[userId]?.heroes || []) : []);
/** Удалённые свои герои (можно вернуть). */
export const archivedLibraryHeroes = (userId) => (userId ? structuredClone(read()[userId]?.archived || []) : []);
export const libraryHero = (userId, id) => libraryHeroes(userId).find((h) => h.id === id) || null;

/** Положить героя в «Мои герои» (новый или заменить с тем же id). */
export function saveLibraryHero(userId, hero) {
  if (!userId || !hero?.id) return null;
  const all = read(), b = box(all, userId);
  const h = { ...structuredClone(hero), ownerId: userId, updatedAt: Date.now() };
  const at = b.heroes.findIndex((x) => x.id === h.id);
  if (at >= 0) b.heroes[at] = h; else b.heroes.unshift(h);
  write(all); changed(); push(h);
  return h;
}
/** Изменить героя на месте: fn(hero) возвращает подсказку действия (как applyHeroAction). */
export function updateLibraryHero(userId, id, fn) {
  const all = read(), h = box(all, userId).heroes.find((x) => x.id === id);
  if (!h) return null;
  const note = fn(h);
  h.updatedAt = Date.now();
  write(all); changed(); push(h);
  return note ?? null;
}
export function archiveLibraryHero(userId, id) {
  const all = read(), b = box(all, userId), h = b.heroes.find((x) => x.id === id);
  if (!h) return null;
  const gone = { ...h, archivedAt: Date.now(), updatedAt: Date.now() };
  b.heroes = b.heroes.filter((x) => x !== h); b.archived.unshift(gone);
  write(all); changed(); push(gone, true);
  return h;
}
export function restoreLibraryHero(userId, id) {
  const all = read(), b = box(all, userId), h = b.archived.find((x) => x.id === id);
  if (!h) return null;
  b.archived = b.archived.filter((x) => x !== h); delete h.archivedAt; h.updatedAt = Date.now(); b.heroes.unshift(h);
  write(all); changed(); push(h);
  return h;
}
/** Ключ героя из «Моих героев» в адресе листа: lib~<id> (у героя кампании — <кампания>~<id>). */
export const LIB = 'lib';
export const isLibKey = (key) => String(key || '').startsWith(`${LIB}~`);
