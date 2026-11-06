// «Мои герои» вне кампаний (#203, 06.11 — sol0139: «герой создаётся отдельно, а потом предлагается его добавление в
// кампанию»). Мастер создания, быстрый герой и перенос из LSS кладут героя сюда; в кампанию уходит его копия
// (contract.bringToCampaign → placeHero), как при «Привести в кампанию».
// Хранилище — localStorage по пользователю: в песочнице это и есть база героев; на сервере — пока на устройстве, до
// таблицы личных героев (#202). Удалённые лежат рядом и возвращаются.
const KEY = 'rasputye-heroes-v1';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const write = (all) => { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* приватный режим */ } };
const box = (all, userId) => (all[userId] ||= { heroes: [], archived: [] });
const changed = () => { try { window.dispatchEvent(new CustomEvent('hero:changed')); } catch { /* вне браузера */ } };

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
  write(all); changed();
  return h;
}
/** Изменить героя на месте: fn(hero) возвращает подсказку действия (как applyHeroAction). */
export function updateLibraryHero(userId, id, fn) {
  const all = read(), h = box(all, userId).heroes.find((x) => x.id === id);
  if (!h) return null;
  const note = fn(h);
  h.updatedAt = Date.now();
  write(all); changed();
  return note ?? null;
}
export function archiveLibraryHero(userId, id) {
  const all = read(), b = box(all, userId), h = b.heroes.find((x) => x.id === id);
  if (!h) return null;
  b.heroes = b.heroes.filter((x) => x !== h); b.archived.unshift({ ...h, archivedAt: Date.now() });
  write(all); changed();
  return h;
}
export function restoreLibraryHero(userId, id) {
  const all = read(), b = box(all, userId), h = b.archived.find((x) => x.id === id);
  if (!h) return null;
  b.archived = b.archived.filter((x) => x !== h); delete h.archivedAt; b.heroes.unshift(h);
  write(all); changed();
  return h;
}
/** Ключ героя из «Моих героев» в адресе листа: lib~<id> (у героя кампании — <кампания>~<id>). */
export const LIB = 'lib';
export const isLibKey = (key) => String(key || '').startsWith(`${LIB}~`);
