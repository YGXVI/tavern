// Спасброски от состояний, D&D 5e 2014, приложение A. Истощение требует уровня и здесь не вычисляется.
const AUTO = { paralyzed: 'парализован', stunned: 'ошеломлён', unconscious: 'без сознания', petrified: 'окаменел' };
export function saveRule(conditions = [], ability) {
  if (ability === 'str' || ability === 'dex') {
    const id = conditions.find((c) => AUTO[c]);
    if (id) return { autoFail: true, adv: null, why: `Автопровал — ${AUTO[id]}` };
  }
  if (ability === 'dex' && conditions.includes('restrained')) return { autoFail: false, adv: 'dis', why: 'С помехой — опутан' };
  return { autoFail: false, adv: null, why: '' };
}

/** Преимущество и помеха взаимно отменяются, несколько помех не складываются. */
export const saveAdvantage = (chosen, rule) => rule.adv === 'dis' ? (chosen === 'adv' ? null : 'dis') : chosen;

/** Только поля valid_save_result; автопровал не требует броска и не сравнивается со СЛ. */
export function saveResult(rule, roll, dc, by) {
  const total = rule.autoFail ? 0 : Math.max(-100, Math.min(1000, roll.total));
  return { total, nat: rule.autoFail ? null : roll.nat, ok: !rule.autoFail && roll.total >= dc, by,
    detail: [rule.why, rule.autoFail ? '' : roll.detail].filter(Boolean).join(' · ').slice(0, 500) };
}
