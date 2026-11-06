// Состояния в бросках стола (#193, этап 2): что творится с самим бросающим. Цель броска пока не учитывается: стол не знает,
// по кому идёт атака из листа; окно атаки существ считает это само.
import { rollPlan } from '../../rules/effects.js';
import { conditionInstances } from '../../rules/condition-recipes.js';

const ABILITY_WORD = { Сил: 'str', Лов: 'dex', Тел: 'con', Инт: 'int', Муд: 'wis', Хар: 'cha' };
// Навыки — по их характеристике в подписи броска нет, поэтому Ловкость определяем только у прямых проверок и спасбросков.
const abilityOf = (what) => { const w = /(Сил|Лов|Тел|Инт|Муд|Хар)/.exec(String(what))?.[1]; return ABILITY_WORD[w] || null; };

/** Метки броска: attack, save + save:dex, check + check:str. */
export function rollTags({ kind, what, ability = null }) {
  if (kind === 'attack') return ['attack'];
  const ab = ability || abilityOf(what), base = kind === 'save' ? 'save' : 'check';
  return ab ? [base, `${base}:${ab}`] : [base];
}

/**
 * Что состояния делают с броском.
 * Возвращает { adv: 'adv' | 'dis' | null, autoFail, why[] }.
 */
export function conditionRoll(creature, roll) {
  // Источник страха считаем в поле зрения: обычно так и есть, а спросить из листа пока негде.
  const plan = rollPlan({ tags: rollTags(roll) }, conditionInstances(creature || {}), { rel: { 'fear:in-sight': true } });
  return { adv: plan.mode === 'advantage' ? 'adv' : plan.mode === 'disadvantage' ? 'dis' : null, autoFail: plan.autoFail, why: plan.why };
}
