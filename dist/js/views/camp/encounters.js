// Встречи мастера (#203, макет 62): заготовки существ для сцены. Живут на устройстве мастера — игроки их не видят.
import { uid } from '../../core/dom.js';
import { monsterById } from '../../data/bestiary.js';
import { local, updateLocal } from './local.js';

export const encounters = (cid, userId) => local('enc', cid, userId).list || [];
export const encounterById = (cid, userId, id) => encounters(cid, userId).find((e) => e.id === id) || null;

export function saveEncounter(cid, userId, enc) {
  return updateLocal('enc', cid, userId, (v) => {
    v.list ||= [];
    const i = v.list.findIndex((e) => e.id === enc.id);
    if (i >= 0) v.list[i] = enc; else v.list.push(enc);
    return enc;
  });
}
export function newEncounter(cid, userId, patch = {}) {
  return saveEncounter(cid, userId, { id: uid('enc-'), name: patch.name || 'Новая встреча', sceneId: patch.sceneId || null, monsters: patch.monsters || [], opts: { hidden: true, combat: false, pack: true }, createdAt: Date.now() });
}
export function deleteEncounter(cid, userId, id) {
  updateLocal('enc', cid, userId, (v) => { v.list = (v.list || []).filter((e) => e.id !== id); });
}
/** Добавить существо (id бестиария или libsrc:) во встречу: тот же — +1 к количеству. */
export function addToEncounter(cid, userId, encId, monsterId, count = 1, creature = null) {
  const enc = encounterById(cid, userId, encId); if (!enc) return null;
  const row = enc.monsters.find((m) => m.id === monsterId);
  if (row) row.count = Math.min(40, row.count + count); else enc.monsters.push({ id: monsterId, count: Math.min(40, count), ...(creature ? { creature: structuredClone(creature) } : {}) });
  return saveEncounter(cid, userId, enc);
}

/** Снимок личного существа сохраняется вместе со встречей; справочник остаётся по id. */
export const encounterCreature = (row, library = []) => String(row.id).startsWith('libsrc:')
  ? library.find((c) => c.id === row.id.slice(7)) || row.creature || null : monsterById(row.id);
