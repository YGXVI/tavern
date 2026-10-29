/** Pure 2014 damage formulas. Does not roll dice, apply HP, saves or class features. */
const integer = (n, lo, hi, name) => {
  if (!Number.isInteger(n) || n < lo || n > hi) throw new RangeError(name);
  return n;
};
export function formula(terms, multiplier = 1) {
  integer(multiplier, 0, 10000, 'multiplier');
  const dice = new Map(); let constant = 0;
  for (const expression of terms) {
    if (!/^(?:\d+d\d+|[+-]?\d+)(?:[+]\d+d\d+|[+-]\d+)*$/.test(expression)) throw new TypeError("Invalid formula");
    for (const term of expression.match(/\d+d\d+|[+-]?\d+/g)) {
    if (!/^(?:\d+d\d+|[+-]?\d+)$/.test(term)) throw new TypeError('Unsupported dice expression');
    if (term.includes('d')) {
      const [n, sides] = term.split('d').map(Number);
      integer(n, 1, 10000, 'dice'); integer(sides, 2, 100, 'sides');
      dice.set(sides, (dice.get(sides) || 0) + n * multiplier);
    } else constant += Number(term) * multiplier;
  }
  }
  const pieces = [...dice].sort((a,b)=>a[0]-b[0]).filter(([,n])=>n).map(([s,n])=>`${n}d${s}`);
  let result = pieces.join('+');
  if (constant) result += `${constant > 0 && result ? '+' : ''}${constant}`;
  return result || '0';
}
export function calculate(entry, {slotLevel, characterLevel, spellModifier, storm = false} = {}) {
  if (entry.status !== 'supported') return {id:entry.id, status:'manual_review', reason:entry.reason};
  const base = entry.baseLevel;
  if (base === 0) {
    if (slotLevel !== undefined) throw new RangeError('Cantrips do not use slots');
    integer(characterLevel, 1, 20, 'characterLevel');
  } else {
    if (characterLevel !== undefined) throw new RangeError('Use slotLevel for a leveled spell');
    integer(slotLevel, base, 9, 'slotLevel');
  }
  const tier = base === 0 ? [5,11,17].filter(x=>characterLevel>=x).length : 0;
  const delta = base === 0 ? 0 : slotLevel-base;
  const units = entry.units ? entry.units.base + (entry.units.perSlot || 0)*delta + (entry.units.perTier || 0)*tier : 1;
  const components = entry.components.map(c=> {
    const steps = c.scaling === 'character' ? tier : c.scaling === 'slot' ? Math.floor(delta/(c.every || 1)) : 0;
    const terms = [c.base, ...Array(steps).fill(c.increment)].filter(Boolean);
    if (typeof storm !== 'boolean') throw new TypeError('storm');
    if (c.stormBonus && storm) terms.push(c.stormBonus);
    if (c.modifier && spellModifier !== undefined) terms.push(String(integer(spellModifier,-10,20,'spellModifier')));
    return {key:c.key, type:c.type, formula:formula(terms)+(c.modifier && spellModifier === undefined ? "+MOD" : ""), scope:c.scope, event:c.event, condition:c.condition || null};
  });
  const targetLimit=entry.targetLimit ? entry.targetLimit.base+(entry.targetLimit.perSlot||0)*delta : null;
  return {id:entry.id,status:'supported', targetLimit, slotLevel:base ? slotLevel : null,characterLevel:base ? null : characterLevel,concentration:entry.concentration,units,unitKind:entry.units?.kind || 'target_event',components, constraints:entry.constraints};
}
/** Explicit occurrence counts only: no assumption that every attack hits or every round triggers damage. */
export function aggregate(result, counts) {
  if (result.status !== 'supported') throw new TypeError('Unreviewed damage');
  if (!counts || Object.keys(counts).some(k=>!result.components.some(c=>c.key===k))) throw new TypeError('Unknown component');
  return result.components.map(c=> {
    const count = integer(counts[c.key],0,10000,'Explicit count required for every component');
    if (c.scope === 'per_unit' && count > result.units) throw new RangeError('More hits/darts than available units');
    // Expand the already-normalized dice expression without evaluating it.
    if (c.formula.includes('MOD')) throw new TypeError('Supply spellModifier before aggregation');
    const terms = c.formula.match(/\d+d\d+|[+-]?\d+/g);
    return {key:c.key,type:c.type,count,scope:'sum_of_explicit_occurrences',formula:formula(terms,count),condition:c.condition};
  });
}
export function allLevels(entry) {
  if (entry.status !== 'supported') return [];
  return entry.baseLevel === 0 ? [1,5,11,17].map(characterLevel=>({characterLevel})) : Array.from({length:10-entry.baseLevel},(_,i)=>({slotLevel:entry.baseLevel+i}));
}
