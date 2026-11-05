// Атака, урон и спасброски от смерти по правилам D&D 5e 2014 (PHB, гл. 9) — общие функции аудита #197:
// атака по возможности, атака толпой (#198), урон по лежащему герою, бросок спасброска от смерти.

/** Исход броска атаки: натуральная 20 — крит, натуральная 1 — промах, иначе итог против КД. */
export const attackOutcome = (nat, total, ac) => (nat === 20 ? 'crit' : nat === 1 ? 'miss' : total >= ac ? 'hit' : 'miss');
export const isHit = (nat, total, ac) => attackOutcome(nat, total, ac) !== 'miss';

/** Крит удваивает только кости урона, модификатор — один раз: «1d6+2» → «2d6+2», «2к8 + 1d6 + 3» → «4d8 + 2d6 + 3». */
export const critDamageFormula = (f) => String(f).replace(/(\d*)\s*[dк](\d+)/gi, (_, n, m) => `${(Number(n) || 1) * 2}d${m}`);

const ds0 = (ds) => ({ s: ds?.s || 0, f: ds?.f || 0, ...(ds?.stable ? { stable: true } : {}) });
export const isDead = (ds) => (ds?.f || 0) >= 3;
export const isStable = (ds) => !!ds?.stable && !isDead(ds);

/**
 * Спасбросок от смерти: 20 — 1 хит и счётчики с нуля ('up'); 1 — два провала; 10+ — успех, иначе провал.
 * Три успеха — стабилен, счётчики обнуляются ('stable'); три провала — смерть ('dead'). Мёртвый и стабильный не бросают
 * ('no'). Возвращает {ds, out}.
 */
export function deathSaveStep(ds, nat) {
  const d = ds0(ds);
  if (isDead(d) || isStable(d)) return { ds: d, out: 'no' };
  if (nat === 20) return { ds: { s: 0, f: 0 }, out: 'up' };
  if (nat === 1) d.f = Math.min(3, d.f + 2);
  else if (nat >= 10) d.s += 1;
  else d.f += 1;
  if (d.f >= 3) return { ds: { s: d.s, f: 3 }, out: 'dead' };
  if (d.s >= 3) return { ds: { s: 0, f: 0, stable: true }, out: 'stable' };
  return { ds: { s: d.s, f: d.f }, out: 'roll' };
}

/**
 * Урон по герою: сначала временные хиты. Упал до 0 — мгновенная смерть, если урон сверх оставшихся хитов не меньше
 * максимума. Урон при 0 хитов — провал спасброска от смерти (крит — два), стабильность пропадает; урон не меньше
 * максимума — смерть. s = {hp, hpMax, tempHp, deathSaves}. Возвращает {hp, tempHp, deathSaves, dropped, dead, dealt}.
 */
export function heroDamage(s, dmg, { crit = false } = {}) {
  let temp = s.tempHp || 0, hp = s.hp ?? 0;
  let ds = ds0(s.deathSaves);
  const max = s.hpMax > 0 ? s.hpMax : Infinity;
  const absorbed = Math.min(temp, dmg);
  temp -= absorbed;
  const rest = dmg - absorbed;
  let dropped = false;
  if (rest > 0) {
    if (hp > 0) {
      const over = rest - hp;
      hp = Math.max(0, hp - rest);
      if (hp === 0) { dropped = true; ds = over >= max ? { s: 0, f: 3 } : { s: 0, f: 0 }; }
    } else if (!isDead(ds)) {
      ds = rest >= max ? { s: ds.s, f: 3 } : { s: ds.s, f: Math.min(3, ds.f + (crit ? 2 : 1)) };
    }
  }
  return { hp, tempHp: temp, deathSaves: ds, dropped, dead: isDead(ds), dealt: dmg };
}

/** Состояния героя при переходе через 0 хитов; вставать после лечения игрок решает сам. */
export function heroHpConditions(conditions, before, after) {
  const out = new Set(conditions || []);
  if (before > 0 && after === 0) {
    out.add('unconscious'); out.add('prone'); out.delete('concentration');
  } else if (before === 0 && after > 0) out.delete('unconscious');
  return [...out];
}

/** Сначала половина при спасброске, затем отношение к урону; каждое деление округляется вниз. */
export function adjustDamage(damage, relation, half = false) {
  const dmg = half ? Math.floor(damage / 2) : damage;
  return relation === 'resist' ? Math.floor(dmg / 2) : relation === 'vuln' ? dmg * 2 : relation === 'immune' ? 0 : dmg;
}

/** По возможности подходит только рукопашная атака с известным бонусом (в том числе +0). */
export function opportunityAttack(actions, reacted = false) {
  if (reacted) return { action: null, why: 'Реакция уже потрачена' };
  const action = (actions || []).find((a) => Number.isFinite(a.attack?.bonus ?? a.bonus)
    && (Number.isFinite(a.attack?.reach) || /melee|рукопашн/i.test(`${a.desc || ''} ${a.ru || ''} ${a.text || ''}`)));
  return { action: action || null, why: action ? '' : 'Нет рукопашной атаки в статблоке' };
}
