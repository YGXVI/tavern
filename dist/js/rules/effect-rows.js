// Строки таблицы effects (#193) → экземпляры для весов. Рецепты браузер читает из effect-recipes.json.
import { conditionInstances } from './condition-recipes.js';
import { resistsDamage } from './effects.js';

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
    out.push({ ref: row.ref, recipe, cast: row.cast, by: row.by, casterMod: row.casterMod, level: row.level, slotLevel: row.slotLevel, option: row.option, since: row.since, off: row.off });
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

const who = (r) => r.from ?? r.by;
const isHeld = (ref) => !!recipeOf(ref)?.concentration;

/** Снять строки. Что оставляет последствия (Ускорение — вялость), добавляет их на цель; вне боя последствий нет. */
export function removeRows(rows, gone, round = null) {
  const after = [];
  for (const r of gone) {
    const then = recipeOf(r.ref)?.then, next = then && recipeOf(then);
    if (next && round != null) after.push({ id: `${r.id}-then`, target: r.target, ref: then, cast: `${r.cast}-then`, by: r.by, visible: r.visible, until: round + roundsOf(next.duration) });
  }
  return [...rows.filter((r) => !gone.includes(r)), ...after];
}

/**
 * Наложить: строки на каждую цель одной нитью cast. Новая концентрация того же заклинателя снимает прежнюю на всех целях;
 * Ярость снимает концентрацию, хотя сама её не требует. from — существо заклинателя, by — пользователь.
 * Возвращает { rows: новый список строк кампании, added, dropped }.
 */
export function castRows(rows, { ref, targets, by, cast, round = null, ...data }) {
  const recipe = recipeOf(ref);
  const breaks = recipe?.concentration || recipe?.breaks === 'concentration';
  const held = breaks ? rows.filter((r) => who(r) === (data.from ?? by) && isHeld(r.ref)) : [];
  const rounds = roundsOf(recipe?.duration);
  const added = targets.map((target, i) => ({ id: `${cast}-${i}`, target, ref, cast, by, visible: true, ...data, ...(round != null && rounds != null ? { until: round + rounds } : {}) }));
  return { rows: [...removeRows(rows, held, round), ...added], added, dropped: held };
}

/** Концентрация прервана: снять всю нить. */
export const endCast = (rows, cast, round = null) => removeRows(rows, rows.filter((r) => r.cast === cast), round);

/** Что истекло к этому раунду боя. Без отметки until длительность не считается: снимает мастер. */
export const expired = (rows, round) => rows.filter((r) => Number.isFinite(r.until) && r.until <= round);

/**
 * Что случается на смене хода. ended и started — существа, чей ход закончился и начался.
 * Длительность кончается в начале хода заклинателя, вялость — в конце хода цели.
 * Возвращает { expire: строки, tempHp: [{ target, value, row }], saves: [{ row, ability }] }.
 */
export function turnPlan(rows, { ended = [], started = [], round }) {
  const expire = [], tempHp = [], saves = [];
  for (const r of rows) {
    const recipe = recipeOf(r.ref);
    if (!recipe) continue;
    const late = Number.isFinite(r.until) && r.until <= round;
    if (late && (recipe.endsOn === 'turn-end' ? ended.includes(r.target) : started.includes(r.from ?? r.target))) { expire.push(r); continue; }
    if (recipe.status === 'draft') continue;
    for (const part of recipe.parts || []) {
      if (part.on === 'turn-start' && started.includes(r.target)) for (const e of part.effects || []) if (e.op === 'tempHp' && Number.isFinite(r.casterMod)) tempHp.push({ target: r.target, value: Math.max(0, r.casterMod), row: r });
      if (part.on === 'turn-end' && part.save && ended.includes(r.target)) saves.push({ row: r, ability: part.save.ability });
    }
  }
  return { expire, tempHp, saves };
}

const TYPES = [[/дроб|bludg/i, 'bludgeoning'], [/кол[юо]|pierc/i, 'piercing'], [/руб|slash/i, 'slashing']];
/** Отношение цели к урону от наложений: 'resist' или null. ids — токен и герой. */
export function damageRelation(c, ids, type) {
  const en = TYPES.find(([re]) => re.test(String(type || '')))?.[1];
  if (!en) return null;
  return ids.filter(Boolean).some((id) => resistsDamage(en, effectInstances(c, id))) ? 'resist' : null;
}

/** Есть ли сопротивления от наложений: окно ручного урона тип не знает и только напоминает. */
export const resistNote = (c, ids) => (TYPES.some(([, en]) => ids.filter(Boolean).some((id) => resistsDamage(en, effectInstances(c, id))))) ;
