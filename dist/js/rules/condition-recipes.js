// Состояния как рецепты эффектов (#193, этап 2), SRD 5.1 приложение PH-A. Модуль, а не JSON: стол считает их синхронно.
// side: 'target' — часть работает у того, кто действует против этого существа.
const part = (effects, extra = {}) => ({ mode: 'auto', effects, ...extra });
const note = (label, extra = {}) => ({ mode: 'note', label, ...extra });
const attackFrom = (op) => part([{ op, to: ['attack'] }], { side: 'target', when: { all: ['attack'] } });
const own = (op, to) => part([{ op, to }]);
const autoFail = part([{ op: 'autoFail', to: ['save:str', 'save:dex'] }]);
const still = part([{ op: 'set', stat: 'speed', value: 0 }]);
const critClose = part([{ op: 'autoCrit', to: ['attack'] }], { side: 'target', when: { all: ['attack', 'within:5'] } });
const noActions = note('Не может совершать действия и реакции.');

export const CONDITION_RECIPES = Object.freeze({
  blinded: { label: 'Ослеплён', parts: [attackFrom('advantage'), own('disadvantage', ['attack']), note('Проваливает проверки, где нужно зрение.')] },
  charmed: { label: 'Очарован', parts: [note('Не может атаковать очаровавшего. Тот получает преимущество на проверки общения.')] },
  deafened: { label: 'Оглох', parts: [note('Проваливает проверки, где нужен слух.')] },
  frightened: { label: 'Испуган', parts: [part([{ op: 'disadvantage', to: ['attack', 'check'] }], { when: { rel: ['fear:in-sight'] } }), note('Не может по своей воле приближаться к источнику страха.')] },
  grappled: { label: 'Схвачен', parts: [still] },
  incapacitated: { label: 'Недееспособен', parts: [noActions] },
  invisible: { label: 'Невидим', parts: [attackFrom('disadvantage'), own('advantage', ['attack'])] },
  paralyzed: { label: 'Парализован', parts: [noActions, still, autoFail, attackFrom('advantage'), critClose] },
  petrified: { label: 'Окаменел', parts: [noActions, still, autoFail, attackFrom('advantage'), note('Сопротивление всему урону, иммунитет к яду и болезням.')] },
  poisoned: { label: 'Отравлен', parts: [own('disadvantage', ['attack', 'check'])] },
  prone: { label: 'Сбит с ног', parts: [own('disadvantage', ['attack']),
    part([{ op: 'advantage', to: ['attack'] }], { side: 'target', when: { all: ['attack', 'within:5'] } }),
    part([{ op: 'disadvantage', to: ['attack'] }], { side: 'target', when: { all: ['attack'], none: ['within:5'] } }), note('Двигается только ползком.')] },
  restrained: { label: 'Опутан', parts: [still, attackFrom('advantage'), own('disadvantage', ['attack', 'save:dex'])] },
  stunned: { label: 'Ошеломлён', parts: [noActions, still, autoFail, attackFrom('advantage')] },
  unconscious: { label: 'Без сознания', parts: [noActions, still, autoFail, attackFrom('advantage'), critClose, note('Роняет всё и падает.')] },
  // Степени истощения: действуют эта и все меньшие.
  exhaustion: { label: 'Истощение', parts: [
    part([{ op: 'disadvantage', to: ['check'] }], { minLevel: 1 }),
    part([{ op: 'halve', stat: 'speed' }], { minLevel: 2 }),
    part([{ op: 'disadvantage', to: ['attack', 'save'] }], { minLevel: 3 }),
    note('Максимум хитов уменьшен вдвое.', { minLevel: 4 }),
    part([{ op: 'set', stat: 'speed', value: 0 }], { minLevel: 5 }),
    note('Смерть.', { minLevel: 6 })] },
});

/** Состояния существа как экземпляры для весов. Одинаковые не усиливаются: один ключ. conditions — id или { id }. */
export function conditionInstances({ conditions = [], exhaustion = 0 } = {}) {
  const ids = new Set(conditions.map((c) => c?.id ?? c));
  // Падая без сознания, существо ещё и ничком; сами недееспособные части идут из рецепта.
  const level = Number.isInteger(exhaustion) && exhaustion > 0 ? exhaustion : ids.has('exhaustion') ? 1 : 0;
  const out = [...ids].filter((id) => id !== 'exhaustion' && CONDITION_RECIPES[id]).map((id) => ({ ref: `condition:${id}`, recipe: CONDITION_RECIPES[id] }));
  if (level) out.push({ ref: 'condition:exhaustion', recipe: CONDITION_RECIPES.exhaustion, level });
  return out;
}
