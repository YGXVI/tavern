// Состояния в бросках стола (#193, этап 2): что творится с самим бросающим. Цель броска пока не учитывается: стол не знает,
// по кому идёт атака из листа; окно атаки существ считает это само.
import { rollPlan } from '../../rules/effects.js';
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

const SIDES = /^(\d+)d(\d+)$/;
/** Что состояния и наложения делают с броском: { adv, autoFail, why[], dice, mod, minus }. effects — экземпляры из effectInstances. */
export function conditionRoll(creature, roll, effects = []) {
  // Источник страха считаем в поле зрения: обычно так и есть, а спросить из листа пока негде.
  const plan = rollPlan({ tags: rollTags(roll) }, [...conditionInstances(creature || {}), ...effects], { rel: { 'fear:in-sight': true } });
  const dice = {}, minus = [];
  for (const d of plan.dice) {
    const [, n, sides] = SIDES.exec(d.dice) || [];
    if (!sides) continue;
    if (d.sign < 0) for (let i = 0; i < Number(n); i++) minus.push({ sides: Number(sides), label: d.label });
    else dice[sides] = (dice[sides] || 0) + Number(n);
  }
  return { adv: plan.mode === 'advantage' ? 'adv' : plan.mode === 'disadvantage' ? 'dis' : null, autoFail: plan.autoFail, why: [...plan.why, ...plan.dice.map((d) => d.label), ...plan.lines.map((l) => l.label)], dice, mod: plan.lines.reduce((n, l) => n + l.value, 0), minus };
}
