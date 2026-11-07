// Строки таблицы effects (#193) → экземпляры для весов. Рецепты браузер читает из effect-recipes.json.
import { conditionInstances } from './condition-recipes.js';

let recipes = {};
/** Рецепты подставляют снаружи: тесты и будущая полка мастера. */
export const setRecipes = (map) => { recipes = map || {}; };
export const recipeOf = (ref) => recipes[ref] || null;
export async function loadRecipes() {
  if (typeof location === 'undefined' || Object.keys(recipes).length) return;
  try { const r = await fetch(new URL('../data/effect-recipes.json', import.meta.url)); if (r.ok) recipes = (await r.json()).recipes || {}; } catch { /* без рецептов броски идут как обычно */ }
}

/** Что наложено на существо: сами рецепты и состояния, которые они дают. Черновик состояния не даёт. */
export function effectInstances(c, id) {
  const out = [];
  for (const row of c?.effects || []) {
    if (row.target !== id) continue;
    const recipe = recipeOf(row.ref);
    if (!recipe) continue;
    out.push({ ref: row.ref, recipe, cast: row.cast, by: row.by, level: row.level, slotLevel: row.slotLevel, option: row.option, since: row.since, off: row.off });
    if (recipe.status === 'draft') continue;
    for (const part of recipe.parts || []) if (part.grants?.condition) out.push(...conditionInstances({ conditions: [part.grants.condition] }));
  }
  return out;
}

/** Длительность рецепта в раундах боя: минута — 10 раундов. Нет длительности — null. */
export function roundsOf(duration) {
  if (!duration) return null;
  return (duration.rounds || 0) + (duration.minutes || 0) * 10 + (duration.hours || 0) * 600;
}

/**
 * Наложить: строки на каждую цель одной нитью cast. Новая концентрация того же заклинателя снимает прежнюю на всех целях.
 * Возвращает { rows: новый список строк кампании, added, dropped }.
 */
export function castRows(rows, { ref, targets, by, cast, round = null, ...data }) {
  const recipe = recipeOf(ref);
  const held = recipe?.concentration ? rows.filter((r) => r.by === by && recipeOf(r.ref)?.concentration) : [];
  const rounds = roundsOf(recipe?.duration);
  const added = targets.map((target, i) => ({ id: `${cast}-${i}`, target, ref, cast, by, visible: true, ...data, ...(round != null && rounds != null ? { until: round + rounds } : {}) }));
  return { rows: [...rows.filter((r) => !held.includes(r)), ...added], added, dropped: held };
}

/** Концентрация прервана: снять всю нить. */
export const endCast = (rows, cast) => rows.filter((r) => r.cast !== cast);

/** Что истекло к этому раунду боя. Без отметки until длительность не считается: снимает мастер. */
export const expired = (rows, round) => rows.filter((r) => Number.isFinite(r.until) && r.until <= round);
