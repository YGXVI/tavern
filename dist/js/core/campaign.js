// Доступ к данным кампании: выборки и изменения. Роль — в конкретной кампании (DEC-005).
// В демо проверка роли только в интерфейсе; настоящая проверка — задача сервера (TASK-002/003).
import { getDB, commit } from './store.js';
import { monsterById } from '../data/bestiary.js';
import { toMonster } from '../rules/creature.js';
import { sizeById } from '../data/rules.js';
import { uid } from './dom.js';

export const getCampaign = (id) => getDB().campaigns[id] || null;

export function membership(c, userId) {
  return c?.members.find((m) => m.userId === userId) || null;
}

export function roleIn(c, userId) {
  const m = membership(c, userId);
  return m && m.status === 'active' ? m.role : null;
}

export const isMasterOf = (c, userId) => roleIn(c, userId) === 'master';

export function campaignsFor(userId) {
  return Object.values(getDB().campaigns)
    .filter((c) => c.members.some((m) => m.userId === userId))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export const sceneOf = (c, id) => c?.scenes.find((s) => s.id === id) || null;

/** Сцена, которую сейчас видит участник: у отделившегося героя — своя, иначе общая. */
export function sceneIdFor(c, userId) {
  const m = membership(c, userId);
  if (m?.role === 'player' && m.sceneId && sceneOf(c, m.sceneId)) return m.sceneId;
  return c.activeSceneId;
}

export const characterOf = (c, id) => c?.characters.find((ch) => ch.id === id) || null;

export function myCharacter(c, userId) {
  const m = membership(c, userId);
  return m?.characterId ? characterOf(c, m.characterId) : null;
}

export function userById(id) { return getDB().users[id] || null; }

export function ownerOfCharacter(c, ch) {
  if (!ch) return null;
  const m = c.members.find((mm) => mm.characterId === ch.id && mm.status === 'active');
  return m ? userById(m.userId) : null;
}

/** Числа токена: у героя — из листа, у существа — с токена. */
export function tokenStats(c, t) {
  if (t.characterId) {
    const ch = characterOf(c, t.characterId);
    if (ch) {
      return {
        name: ch.name, hp: ch.hp, hpMax: ch.hpMax, tempHp: ch.tempHp || 0, ac: ch.ac, speed: ch.speed,
        initBonus: ch.initBonus ?? 0, darkvision: ch.darkvision || 0, conditions: ch.conditions || [],
        deathSaves: ch.deathSaves, subtitle: `${ch.className} ${ch.level} ур.`, character: ch,
      };
    }
  }
  const m = t.monsterId ? monsterOf(c, t.monsterId) : null;
  return {
    name: t.name, hp: t.hp ?? 0, hpMax: t.hpMax ?? 0, tempHp: t.tempHp || 0, ac: t.ac ?? 10, speed: t.speed ?? 30,
    initBonus: t.initBonus ?? 0, darkvision: t.darkvision || 0, conditions: t.conditions || [],
    subtitle: m ? `${m.type} · КО ${m.cr}` : t.kind === 'hero' ? 'Герой' : 'Существо', monster: m,
  };
}

export const tokenCells = (t) => sizeById(t.size).cells;

/**
 * Может ли пользователь двигать токен (интерфейсная проверка демо).
 * Мастер — любой; игрок — своего героя, а при открытом перемещении (по умолчанию) — любой видимый токен.
 * Править хиты, состояния и лист чужого токена это не разрешает.
 */
export function canControlToken(c, userId, t) {
  if (!t) return false;
  if (isMasterOf(c, userId)) return true;
  const m = membership(c, userId);
  if (!m || m.status !== 'active') return false;
  if (t.characterId && t.characterId === m.characterId) return true;
  return openMovement(c) && !t.hidden;
}

/** Открытое перемещение: игроки двигают любые видимые токены (настройка кампании, по умолчанию включена). */
export const openMovement = (c) => c?.settings?.openMovement !== false;

// ——— Изменения ———
export function updateCampaign(cid, fn) {
  return commit((db) => { const c = db.campaigns[cid]; if (c) return fn(c, db); });
}

export function updateScene(cid, sid, fn) {
  return updateCampaign(cid, (c) => { const s = c.scenes.find((x) => x.id === sid); if (s) return fn(s, c); });
}

/** Изменить хиты/состояния: героям — в листе, существам — на токене. */
export function patchTokenStats(c, s, tokenId, patch) {
  const t = s.tokens.find((x) => x.id === tokenId);
  if (!t) return;
  const target = t.characterId ? c.characters.find((ch) => ch.id === t.characterId) || t : t;
  Object.assign(target, typeof patch === 'function' ? patch(target) : patch);
}

export function addLog(c, entry) {
  c.log.unshift({ id: uid('r-'), at: Date.now(), ...entry });
  c.log = c.log.slice(0, 120);
}

export function nextTokenName(scene, base) {
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: (\\d+))?$`);
  let max = 0;
  for (const t of scene.tokens) { const m = t.name.match(re); if (m) max = Math.max(max, Number(m[1] || 1)); }
  return `${base} ${max + 1}`;
}

/**
 * Статблок существа токена (TASK-179, TASK-097 п. 4.3): «srd:…» и ручные — из бестиария, «lib:<id>» — из копии
 * личного существа в кампании `c.creatures[id]` (её видит мастер и владелец призыва; у остальных — null).
 * Копия не связана с библиотекой: правка шаблона не меняет поставленных существ.
 */
const libMonsters = new WeakMap();
export function monsterOf(c, id) {
  if (!id) return null;
  if (!String(id).startsWith('lib:')) return monsterById(id);
  const x = c?.creatures?.[id.slice(4)];
  if (!x) return null;
  if (!libMonsters.has(x)) {
    let m = null;
    try { m = toMonster(x); } catch { /* повреждённая копия — как неизвестное существо */ }
    libMonsters.set(x, m);
  }
  return libMonsters.get(x);
}
