// Состояния в бросках стола (#193, этап 2): что творится с самим бросающим. Цель броска пока не учитывается: стол не знает,
// по кому идёт атака из листа; окно атаки существ считает это само.
import { rollPlan, damagePlan, speedOf, hpMaxOf, ignoredConditions, castingBlocked } from '../../rules/effects.js';
import { conditionInstances } from '../../rules/condition-recipes.js';
import { loadRecipes } from '../../rules/effect-rows.js';

loadRecipes();

const ABILITY_WORD = { Сил: 'str', Лов: 'dex', Тел: 'con', Инт: 'int', Муд: 'wis', Хар: 'cha' };
// Навыки — по их характеристике в подписи броска нет, поэтому Ловкость определяем только у прямых проверок и спасбросков.
const abilityOf = (what) => { const w = /(Сил|Лов|Тел|Инт|Муд|Хар)/.exec(String(what))?.[1]; return ABILITY_WORD[w] || null; };

/** Метки броска: attack, save + save:dex, check + check:str. */
export function rollTags({ kind, what, ability = null }) {
  if (kind === 'attack') return ['attack'];
  const ab = ability || abilityOf(what), base = kind === 'save' ? 'save' : 'check';
  return ab ? [base, `${base}:${ab}`] : [base];
}

const SIDES = /^(-?)(\d+)d(\d+)$/;
const INCAPACITATED = ['incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious'];
const has = (creature, ids) => (creature?.conditions || []).some((x) => ids.includes(x?.id || x));

/** Всё на существе для весов: состояния и наложения, кроме отменённых наложением. */
function allOn(creature, effects) {
  const list = [...conditionInstances(creature || {}), ...effects];
  const ignored = ignoredConditions(list);
  return ignored.size ? list.filter((x) => !ignored.has(String(x.ref).replace('condition:', ''))) : list;
}
/** Что существо знает о себе для живых требований: недееспособность, скорость 0. */
function stateOf(creature, list) {
  return [...(has(creature, INCAPACITATED) ? ['incapacitated'] : []), ...(speedOf(30, list) === 0 ? ['speed:0'] : [])];
}
const splitDice = (rows) => {
  const dice = {}, minus = [];
  for (const d of rows) {
    const [, sign, n, sides] = SIDES.exec(d.dice) || [];
    if (!sides) continue;
    if (sign || d.sign < 0) for (let i = 0; i < Number(n); i++) minus.push({ sides: Number(sides), label: d.label });
    else dice[sides] = (dice[sides] || 0) + Number(n);
  }
  return { dice, minus };
};

/** Что состояния и наложения делают с броском к20: { adv, autoFail, why[], dice, mod, minus }. effects — экземпляры из effectInstances. */
export function conditionRoll(creature, roll, effects = []) {
  const list = allOn(creature, effects);
  // Источник страха считаем в поле зрения: обычно так и есть, а спросить из листа пока негде.
  const plan = rollPlan({ tags: rollTags(roll) }, list, { rel: { 'fear:in-sight': true }, state: stateOf(creature, list) });
  return { adv: plan.mode === 'advantage' ? 'adv' : plan.mode === 'disadvantage' ? 'dis' : null, autoFail: plan.autoFail, why: [...plan.why, ...plan.dice.map((d) => d.label), ...plan.lines.map((l) => l.label)], ...splitDice(plan.dice), mod: plan.lines.reduce((n, l) => n + l.value, 0) };
}

/** Что наложения добавляют к броску урона: { dice, mod, minus, min }. tags — метки атаки: attack:melee, ability:str, weapon:finesse. */
export function effectDamage(creature, tags, effects = []) {
  const list = allOn(creature, effects);
  // Оружие в руках растёт и уменьшается вместе с существом, поэтому метка стоит на всяком оружии.
  const all = ['damage', ...tags, ...(tags.includes('damage:weapon') ? ['weapon:enlarged'] : [])];
  const plan = damagePlan({ tags: all }, list, { state: stateOf(creature, list) });
  return { ...splitDice(plan.dice.map((dice) => ({ dice, label: 'Эффект' }))), mod: plan.flat, min: plan.min };
}

/** Сложить кубы формулы и кубы эффектов. */
export const mergeDice = (a, b) => { const out = { ...a }; for (const [k, n] of Object.entries(b)) out[k] = (out[k] || 0) + n; return out; };

/** Числа на листе героя с наложениями и состояниями: КД, скорость, максимум хитов. */
export function sheetWithEffects(v, creature, ac, effects) {
  const speed = parseInt(v.vitals.speed, 10);
  if (!effects.length && !(creature?.conditions || []).length && !creature?.exhaustion) return v;
  const list = allOn(creature, effects);
  return { ...v, noCast: castingBlocked(list), vitals: { ...v.vitals, ac: { ...v.vitals.ac, value: ac(v.vitals.ac.value) },
    speed: Number.isFinite(speed) ? String(v.vitals.speed).replace(String(speed), String(speedOf(speed, list))) : v.vitals.speed,
    hp: { ...v.vitals.hp, max: hpMaxOf(v.vitals.hp.max, effects) } } };
}
