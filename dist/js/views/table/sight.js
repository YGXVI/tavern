// «Дать зрение игроку» (#190 C; макеты Figma 2.11 «_master 12», экраны 39·1–39·4).
// Мастер даёт герою отряда глаза существа — фамильяра, призыва, зачарованного врага. Зрение складывается:
// игрок видит и своими глазами, и глазами существа. Глаза существа ограничены дальностью от его края, стены их
// перекрывают; в темноте дальность работает как тёмное зрение — её задаёт мастер («в темноте дальность решаете вы»).
// Данные — у токена: `sight: [{to: characterId, ft}]`. Глаза закрыты, пока существо скрыто, погибло или без сознания.
import { tokenStats } from '../../core/campaign.js';
import { gridSize } from '../../rules/geometry.js';
import { sizeById } from '../../data/rules.js';

export const SIGHT_STEPS = [15, 30, 60, 120];
export const SIGHT_MAX = 1000;

const okGrant = (g) => !!g && typeof g.to === 'string' && !!g.to && Number.isFinite(g.ft) && g.ft > 0;
/** Выданные глаза токена (мусор отбрасывается). */
export const grantsOf = (t) => (Array.isArray(t?.sight) ? t.sight.filter(okGrant) : []);

/** Чьи глаза можно дать: существа, не предметы и не герои (у героев — «Общий обзор»). */
export const canGiveSight = (t) => !!t && !t.pending && t.kind !== 'item' && t.kind !== 'hero' && !t.characterId;

/** Дальность в футах: кратно 5, от 5 до SIGHT_MAX. */
export const clampFt = (ft) => Math.max(5, Math.min(SIGHT_MAX, Math.round((Number(ft) || 0) / 5) * 5));

/** Почему глаза сейчас закрыты: 'hidden' | 'dead' | 'down' — или null, если работают. */
export function sightBlocked(c, t) {
  if (t.hidden) return 'hidden';
  const st = tokenStats(c, t);
  if (st.hpMax > 0 && st.hp <= 0) return 'dead';
  if ((st.conditions || []).includes('unconscious')) return 'down';
  return null;
}

/**
 * Действующие глаза на сцене: [{t, ft, to: [characterId…]}] — по одному на существо, дальность — наибольшая
 * из выданных. to — Set id героев (null — все: мастер, общий обзор); off — Set id существ, отключённых игроком у себя.
 */
export function activeSight(c, scene, to = null, off = null) {
  const out = [];
  for (const t of scene?.tokens || []) {
    if (!t.sight || !canGiveSight(t) || off?.has(t.id)) continue;
    const gs = grantsOf(t).filter((g) => !to || to.has(g.to));
    if (!gs.length || sightBlocked(c, t)) continue;
    out.push({ t, ft: Math.max(...gs.map((g) => g.ft)), to: gs.map((g) => g.to) });
  }
  return out;
}

/** Радиус глаз в пикселях карты: дальность от края существа, как у аур. */
export function sightRadius(scene, t, ft) {
  const s = gridSize(scene.grid);
  return (ft / (scene.grid.feet || 5)) * s + (sizeById(t.size).cells * s) / 2;
}

// ——— Изменения (с отменой: откатывается только поле sight) ———
function editSight(ctx, id, label, next) {
  const t0 = ctx.scene?.tokens.find((t) => t.id === id);
  if (!t0) return false;
  const before = t0.sight ? structuredClone(t0.sight) : null;
  const after = next(grantsOf(t0));
  const put = (s, v) => { const t = s.tokens.find((x) => x.id === id); if (!t) return; if (v?.length) t.sight = structuredClone(v); else delete t.sight; };
  ctx.mutateScene((s) => put(s, after), { label, undo: (s) => put(s, before), redo: (s) => put(s, after) });
  return true;
}

/** Дать герою `to` глаза существа на `ft` футов (повторная выдача тому же герою меняет дальность). */
export function giveSight(ctx, id, to, ft) {
  const v = clampFt(ft);
  return editSight(ctx, id, 'Дать зрение', (gs) => [...gs.filter((g) => g.to !== to), { to, ft: v }]);
}

/** Забрать глаза у героя `to` (null — у всех). */
export function takeSight(ctx, id, to = null) {
  return editSight(ctx, id, 'Забрать зрение', (gs) => (to ? gs.filter((g) => g.to !== to) : []));
}
