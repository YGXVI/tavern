// TASK-186: shared build fixtures for engine and Character-data tests (not a test file itself).
import { readFileSync } from 'node:fs';
import { evaluateBuild, defaultCreationContext, createDraft } from '../../dist/js/rules/character-builder.js';

export const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
export const json = p => JSON.parse(read(p));
export const cats = { options: json('dist/js/data/character-options-2014.json'), spells: json('dist/js/data/spells-2014.json'), equipment: json('dist/js/data/equipment-2014.json'), features: json('dist/js/data/features-2014.json') };
export const defs = new Map(cats.options.entries.map(e => [e.id, e]));
export const equipment = cats.equipment.entries;
export const ARRAY = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };

export function context(over = {}) { return { ...defaultCreationContext({ campaignId: 'c1' }), ...over, optionalRules: { ...defaultCreationContext().optionalRules, ...(over.optionalRules || {}) } }; }
export function draft(ctx, over = {}) {
  return Object.assign(createDraft({ draftId: 'd1', accountScope: 'u1', mode: 'sandbox', context: ctx, rulesRevision: cats.options.revision }),
    { baseScores: { ...ARRAY }, ancestry: { raceId: 'srd51:race:human', subraceId: null }, background: { backgroundId: 'srd51:background:acolyte' } }, over);
}
export const levels = (...spec) => spec.flatMap(([cls, n]) => Array.from({ length: n }, () => ({ classId: `srd51:class:${cls}` })));

/** Fill every missing decision with the first valid option, the way a careful player would. */
export function autofill(ctx, d, prefer = {}) {
  for (let round = 0; round < 40; round++) {
    const ev = evaluateBuild(ctx, cats, d);
    const todo = ev.missing.filter(m => m.choiceId);
    if (!todo.length) return { ev, d };
    // One ASI per round: the next pick must see the scores the previous one produced.
    const kindOf = m => ev.choices.find(x => x.id === m.choiceId).kind;
    const asi = todo.filter(m => kindOf(m) === 'asi_or_feat').slice(1).map(m => m.choiceId);
    // Expertise waits until the skills it builds on are chosen.
    if (todo.some(m => kindOf(m) === 'skill')) asi.push(...todo.filter(m => kindOf(m) === 'expertise').map(m => m.choiceId));
    for (const { choiceId } of todo.filter(m => !asi.includes(m.choiceId))) {
      const c = ev.choices.find(x => x.id === choiceId);
      d.selections[choiceId] = prefer[choiceId] ?? pick(c, ev, d);
    }
  }
  const last = evaluateBuild(ctx, cats, d);
  throw new Error(`autofill did not converge: ${d.levelHistory.length}× ${d.levelHistory[0]?.classId} ${JSON.stringify(last.missing.slice(0, 2))} ${JSON.stringify(last.errors.slice(0, 2))}`);
}
function pick(c, ev, d) {
  // Same-kind selections elsewhere are taken; expertise re-uses proficient skills by design.
  // Spell Mastery/Signature Spells pick from the spellbook itself.
  const reuse = c.kind === 'expertise' || c.dependsOnSpellbook;
  const sameKind = ev.choices.filter(x => x.kind === c.kind && x.id !== c.id && Boolean(x.dependsOnSpellbook) === Boolean(c.dependsOnSpellbook)).map(x => d.selections[x.id]);
  const used = new Set((reuse ? sameKind : Object.values(d.selections)).flat().filter(v => typeof v === 'string'));
  const blocked = new Set((c.unavailable || []).map(u => u.option));
  const free = (c.options || []).filter(o => !blocked.has(o) && !used.has(o));
  if (c.kind === 'subclass') return c.options[0];
  if (c.kind === 'asi_or_feat') {
    const s = ev.derivedInputs.abilityScores, low = Object.keys(s).filter(k => s[k] <= 18).sort((a, b) => s[a] - s[b] || a.localeCompare(b))[0];
    return { type: 'asi', increases: { [low]: 2 } };
  }
  if (c.kind === 'equipment') {
    const alt = c.alternatives.find(a => !blocked.has(a.id));
    return { alternative: alt.id, picks: alt.items.map(item => item.ref ? undefined : equipment.filter(e => Object.entries(item.filter).every(([k, v]) => k === 'exclude' ? !v.includes(e.id) : k === 'kind' ? e.kind === v : k === 'group' ? e.group === v : e.weapon?.[k] === v)).slice(0, item.quantity).map(e => e.id)) };
  }
  if (c.kind === 'spell') return free.slice(0, c.count);
  return free.slice(0, c.count);
}
