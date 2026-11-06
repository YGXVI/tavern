// TASK-186 P2: pure build engine. Fixtures cover 12 classes × 20 levels and the plan r1 boundary/rejection cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBuild, defaultCreationContext, creationContextFromCampaign, proposeBuildChange, confirmBuildChange, toCreationProposal, evaluatePredicate } from '../dist/js/rules/character-builder.js';
import { buildSpellProjection, SRD_ALIASES } from '../data/spells/projection.mjs';
import { read, json, cats, defs, ARRAY, context, draft, levels, autofill } from './helpers/builder-fixtures.js';

test('defaults: SRD 2014, level 1, all ability methods (DEC-019), one class, packages; options off; campaign level applied', () => {
  const c = defaultCreationContext({ campaignId: 'c' });
  assert.deepEqual([c.edition, c.allowedSources, c.startLevel, c.allowedAbilityMethods, c.optionalRules, c.equipmentPolicy], ['5e-2014', ['srd51'], 1, ['standard_array', 'point_buy', 'rolled'], { feats: false, multiclass: false, flexibleRacialAsi: false }, 'packages']);
  const legacy = creationContextFromCampaign({ id: 'c', level: 5 });
  assert.equal(legacy.context.startLevel, 5);
  for (const bad of [0, NaN, 21]) assert.equal(creationContextFromCampaign({ id: 'c', level: bad }).errors[0].code, 'legacy_level_invalid');
  assert.deepEqual(creationContextFromCampaign({ id: 'c', level: 1 }).notices, []);
  assert.equal(creationContextFromCampaign({ id: 'c', level: 5 }, { ...c, startLevel: 5 }).context.startLevel, 5, 'master-confirmed policy');
  assert.ok(evaluateBuild(context({ optionalRules: { flexibleRacialAsi: true } }), cats, draft(context())).errors.some(e => e.code === 'unsupported_rule'));
});

test('12 classes × levels 1–20 build to valid characters with the right subclass/ASI gates, PB and slots', () => {
  let built = 0;
  for (const cls of defs.values()) if (cls.kind === 'class') for (let level = 1; level <= 20; level++) {
    const ctx = context({ startLevel: level }), d = draft(ctx, { levelHistory: levels([cls.id.split(':')[2], level]) });
    const { ev } = autofill(ctx, d);
    assert.equal(ev.status, 'valid', `${cls.id} ${level}: ${JSON.stringify([...ev.errors, ...ev.missing].slice(0, 3))}`);
    const ids = ev.choices.map(c => c.id);
    assert.equal(ids.some(id => id.endsWith(':subclass')), level >= cls.class.subclassLevel, `${cls.id} ${level} subclass gate`);
    assert.equal(ev.choices.filter(c => c.kind === 'asi_or_feat').length, cls.class.asiLevels.filter(l => l <= level).length, `${cls.id} ${level} ASI`);
    assert.equal(ev.derivedInputs.proficiencyBonus, cls.progression[level - 1].proficiencyBonus);
    if (cls.class.spellcasting?.slots === 'full' || cls.class.spellcasting?.slots === 'half') assert.deepEqual(ev.derivedInputs.spells.slots, cls.progression[level - 1].spellSlots);
    assert.deepEqual(ev.derivedInputs.classes.map(c => [c.classId, c.levels]), [[cls.id, level]]);
    built++;
  }
  assert.equal(built, 240);
});

test('subclass boundaries: Fighter 2 no / 3 yes, Wizard 1 no / 2 yes, Cleric 1 yes', () => {
  const has = (cls, n) => evaluateBuild(context({ startLevel: n }), cats, draft(context({ startLevel: n }), { levelHistory: levels([cls, n]) })).choices.some(c => c.kind === 'subclass');
  assert.deepEqual([has('fighter', 2), has('fighter', 3), has('wizard', 1), has('wizard', 2), has('cleric', 1)], [false, true, false, true, true]);
});

test('multiclass: off by default; prerequisites at the event; Fighter 2 / Wizard 2 gives no ASI at character level 4', () => {
  const four = levels(['fighter', 2], ['wizard', 2]);
  assert.ok(evaluateBuild(context({ startLevel: 4 }), cats, draft(context({ startLevel: 4 }), { levelHistory: four })).errors.some(e => e.code === 'multiclass_disabled'));
  const ctx = context({ startLevel: 4, optionalRules: { multiclass: true } });
  const weak = evaluateBuild(ctx, cats, draft(ctx, { levelHistory: four, baseScores: { ...ARRAY, int: 8, wis: 12 } }));
  assert.ok(weak.errors.some(e => e.code === 'multiclass_prerequisite' && /Интеллект 13/.test(e.message)), JSON.stringify(weak.errors));
  const { ev } = autofill(ctx, draft(ctx, { levelHistory: four, baseScores: { str: 15, dex: 8, con: 13, int: 14, wis: 10, cha: 12 } }));
  assert.equal(ev.status, 'valid', JSON.stringify([...ev.errors, ...ev.missing]));
  assert.equal(ev.choices.filter(c => c.kind === 'asi_or_feat').length, 0, 'ASI follows class level, not character level');
  assert.ok(!ev.choices.some(c => c.id === 'srd51:class:wizard:skills'), 'multiclass gains no class level-1 skill package');
  assert.ok(ev.choices.some(c => c.id === 'srd51:class:wizard:spells:spellbook'));
  assert.deepEqual(ev.derivedInputs.hitPointInputs.hitDice, [{ classId: 'srd51:class:fighter', die: 10, count: 2 }, { classId: 'srd51:class:wizard', die: 6, count: 2 }]);
});

test('extra ASI levels: Fighter 6 and 14, Rogue 10', () => {
  const asi = (cls, n) => evaluateBuild(context({ startLevel: n }), cats, draft(context({ startLevel: n }), { levelHistory: levels([cls, n]) })).choices.filter(c => c.kind === 'asi_or_feat').map(c => c.origin.classLevel);
  assert.deepEqual(asi('fighter', 14), [4, 6, 8, 12, 14]);
  assert.deepEqual(asi('rogue', 10), [4, 8, 10]);
  assert.deepEqual(asi('wizard', 10), [4, 8]);
});

test('feats: only when the master allows them, only in place of an ASI, prerequisites before that ASI, no repeat', () => {
  const take = (ctx, base, extra = {}, method = 'standard_array') => {
    const d = draft(ctx, { levelHistory: levels(['fighter', 8]), baseScores: base, abilityMethod: method });
    return autofill(ctx, d, { 'srd51:class:fighter:L4:asi': { type: 'feat', featId: 'srd51:feat:grappler' }, ...extra }).ev;
  };
  const off = context({ startLevel: 8 }), on = context({ startLevel: 8, allowedAbilityMethods: ['standard_array', 'point_buy'], optionalRules: { feats: true } });
  assert.ok(take(off, { ...ARRAY }).errors.some(e => e.code === 'feats_disabled'));
  // Human +1: Strength 12 + 1 = 13 at level 4 → allowed.
  const fine = take(on, { ...ARRAY, str: 12, int: 15 });
  assert.equal(fine.status, 'valid', JSON.stringify(fine.errors));
  assert.ok(fine.derivedInputs.features.some(f => f.ref === 'srd51:feature:feats:grappler'));
  // Strength 11 + 1 = 12: a later +2 cannot be borrowed for the level-4 prerequisite.
  const early = take(on, { str: 11, dex: 15, con: 14, int: 8, wis: 10, cha: 12 }, { 'srd51:class:fighter:L6:asi': { type: 'asi', increases: { str: 2 } } }, 'point_buy');
  assert.ok(early.errors.some(e => e.code === 'feat_prerequisite' && /Сила 13/.test(e.message)), JSON.stringify(early.errors));
  const twice = take(on, { ...ARRAY }, { 'srd51:class:fighter:L6:asi': { type: 'feat', featId: 'srd51:feat:grappler' } });
  assert.ok(twice.errors.some(e => e.code === 'feat_repeat'));
  assert.equal(evaluatePredicate({ eval: 'true' }, { scores: {}, classLevels: new Map(), characterLevel: 1, features: new Set(), spells: new Set(), enabled: new Set() }), 'unknown');
});

test('ability methods: standard array, point buy 8–15/27 before racial increases, recorded rolls without re-rolling', () => {
  const ev = (over, ctx = context({ allowedAbilityMethods: ['standard_array', 'point_buy', 'rolled'] })) => evaluateBuild(ctx, cats, draft(ctx, { levelHistory: levels(['fighter', 1]), ...over }));
  assert.ok(ev({ baseScores: { ...ARRAY, cha: 15 } }).errors.some(e => e.code === 'standard_array'));
  assert.ok(ev({ abilityMethod: 'point_buy' }, context({ allowedAbilityMethods: ['standard_array'] })).errors.some(e => e.code === 'ability_method'), 'the master can close a method');
  assert.ok(!ev({ abilityMethod: 'point_buy', baseScores: { str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 } }).errors.length);
  assert.ok(ev({ abilityMethod: 'point_buy', baseScores: { str: 16, dex: 8, con: 8, int: 8, wis: 8, cha: 8 } }).errors.some(e => e.code === 'point_buy_range'));
  assert.ok(ev({ abilityMethod: 'point_buy', baseScores: { str: 15, dex: 15, con: 15, int: 9, wis: 8, cha: 8 } }).errors.some(e => e.code === 'point_buy_budget'));
  const receipts = [[6, 6, 6, 1], [5, 5, 4, 2], [3, 3, 3, 3], [6, 5, 4, 3], [2, 2, 2, 2], [1, 1, 1, 6]].map(dice => ({ dice, source: 'manual' }));
  const rolled = ev({ abilityMethod: 'rolled', rollReceipts: receipts, baseScores: { str: 18, dex: 14, con: 9, int: 15, wis: 6, cha: 8 } });
  assert.deepEqual(rolled.errors, []);
  assert.ok(rolled.warnings.some(w => w.code === 'manual_rolls'));
  assert.ok(ev({ abilityMethod: 'rolled', rollReceipts: receipts, baseScores: { str: 18, dex: 14, con: 9, int: 15, wis: 6, cha: 9 } }).errors.some(e => e.code === 'rolled_scores'));
  const missing = ev({ baseScores: { ...ARRAY, str: null } });
  assert.ok(missing.missing.some(m => m.code === 'abilities') && missing.derivedInputs.abilityScores.str === null, 'unknown stays null, not 0');
});

test('duplicate proficiencies: chosen skill already held is rejected; fixed duplicate gets a same-kind replacement', () => {
  const ctx = context();
  const ev = evaluateBuild(ctx, cats, draft(ctx, { levelHistory: levels(['cleric', 1]), selections: { 'srd51:class:cleric:skills': ['insight', 'history'] } }));
  assert.ok(ev.errors.some(e => e.code === 'duplicate_proficiency' && e.choiceId === 'srd51:class:cleric:skills'));
  assert.ok(ev.choices.find(c => c.id === 'srd51:class:cleric:skills').unavailable.some(u => u.option === 'insight'));
  const patched = structuredClone(cats); const elf = patched.options.entries.find(e => e.id === 'srd51:race:elf');
  elf.grants.push({ id: 'srd51:race:elf:proficiency:skill:insight', kind: 'proficiency', category: 'skill', value: 'insight' });
  const dup = evaluateBuild(ctx, patched, draft(ctx, { ancestry: { raceId: 'srd51:race:elf', subraceId: 'srd51:subrace:elf:high-elf' }, levelHistory: levels(['fighter', 1]) }));
  const replacement = dup.choices.find(c => c.replaces === 'insight');
  assert.ok(replacement && replacement.kind === 'skill' && replacement.options.includes('arcana'), 'replacement of the same kind');
  assert.equal(dup.derivedInputs.proficiencies.skills.filter(s => s === 'insight').length, 1, 'no doubled bonus');
});

test('expertise needs proficiency; warhammer/chain mail "if proficient" follow real proficiencies', () => {
  const ctx = context();
  const rogue = evaluateBuild(ctx, cats, draft(ctx, { levelHistory: levels(['rogue', 1]), selections: { 'srd51:class:rogue:skills': ['stealth', 'acrobatics', 'deception', 'perception'], 'srd51:class:rogue:L1:expertise': ['stealth', 'arcana'] } }));
  assert.ok(rogue.errors.some(e => e.code === 'expertise'));
  const human = evaluateBuild(ctx, cats, draft(ctx, { levelHistory: levels(['cleric', 1]) })).choices.find(c => c.id === 'srd51:class:cleric:starting:equipment:1');
  assert.deepEqual(human.unavailable, [{ option: 'b', reason: 'нет владения' }]);
  const dwarf = evaluateBuild(ctx, cats, draft(ctx, { ancestry: { raceId: 'srd51:race:dwarf', subraceId: 'srd51:subrace:dwarf:hill-dwarf' }, levelHistory: levels(['cleric', 1]), selections: { 'srd51:class:cleric:L1:subclass': 'srd51:subclass:cleric:life' } }));
  assert.deepEqual(dwarf.choices.find(c => c.id === 'srd51:class:cleric:starting:equipment:1').unavailable, [], 'dwarven combat training: warhammer');
  assert.deepEqual(dwarf.choices.find(c => c.id === 'srd51:class:cleric:starting:equipment:2').unavailable, [], 'Life domain: heavy armor');
  const picks = evaluateBuild(ctx, cats, draft(ctx, { levelHistory: levels(['fighter', 1]), selections: { 'srd51:class:fighter:starting:equipment:2': { alternative: 'b', picks: [['srd51:equipment:longsword', 'srd51:equipment:club']] } } }));
  assert.ok(picks.errors.some(e => e.code === 'equipment_pick'), 'a club is not a martial weapon');
});

test('magic: own class level limits spell level, shared multiclass slots do not; pact, racial and land spells are separate', () => {
  const ctx = context({ startLevel: 6, optionalRules: { multiclass: true } });
  const fireball = cats.spells.entries.find(s => s.srd?.index === 'fireball').id;
  const d = draft(ctx, { levelHistory: levels(['cleric', 5], ['wizard', 1]), baseScores: { str: 8, dex: 12, con: 13, int: 14, wis: 15, cha: 10 } });
  const { ev } = autofill(ctx, d);
  assert.equal(ev.status, 'valid', JSON.stringify([...ev.errors, ...ev.missing].slice(0, 3)));
  assert.deepEqual(ev.derivedInputs.spells.slots, [4, 3, 3, 0, 0, 0, 0, 0, 0], 'caster level 6 → 3rd-level slots');
  d.selections['srd51:class:wizard:spells:spellbook'] = [fireball, ...d.selections['srd51:class:wizard:spells:spellbook'].slice(1)];
  assert.ok(evaluateBuild(ctx, cats, d).errors.some(e => e.code === 'spell_option' && /Огненный шар|Fireball/i.test(e.message)), 'wizard 1 cannot learn fireball');
  const warlock = autofill(context({ startLevel: 5 }), draft(context({ startLevel: 5 }), { levelHistory: levels(['warlock', 5]) })).ev;
  assert.deepEqual(warlock.derivedInputs.spells.pact, { slots: 2, slotLevel: 3 });
  assert.equal(warlock.derivedInputs.spells.slots, null);
  const tiefling = n => evaluateBuild(context({ startLevel: n }), cats, draft(context({ startLevel: n }), { ancestry: { raceId: 'srd51:race:tiefling', subraceId: null }, levelHistory: levels(['fighter', n]) })).derivedInputs.spells.granted.length;
  assert.deepEqual([tiefling(1), tiefling(3), tiefling(5)], [1, 2, 3]);
  const land = (terrain) => evaluateBuild(context({ startLevel: 3 }), cats, draft(context({ startLevel: 3 }), { levelHistory: levels(['druid', 3]), selections: { 'srd51:class:druid:L2:subclass': 'srd51:subclass:druid:land', 'srd51:subclass:druid:land:L2:land': [`srd51:feature:druid:land:${terrain}`] } })).derivedInputs.spells.granted.map(g => g.ref);
  assert.equal(land('arctic').length, 2);
  assert.notDeepEqual(land('arctic'), land('coast'));
});

test('invocation prerequisites are checked at the level they are taken', () => {
  const ctx = context({ startLevel: 2 });
  const blast = cats.spells.entries.find(s => s.srd?.index === 'eldritch-blast').id;
  const base = { 'srd51:class:warlock:L1:subclass': 'srd51:subclass:warlock:fiend' };
  const ev = sel => evaluateBuild(ctx, cats, draft(ctx, { levelHistory: levels(['warlock', 2]), selections: { ...base, ...sel } }));
  assert.ok(ev({ 'srd51:class:warlock:L2:eldritch-invocations': ['srd51:feature:warlock:lifedrinker', 'srd51:feature:warlock:armor-of-shadows'] }).errors.some(e => e.code === 'option_prerequisite' && /12-го уровня/.test(e.message)));
  assert.ok(ev({ 'srd51:class:warlock:L2:eldritch-invocations': ['srd51:feature:warlock:agonizing-blast', 'srd51:feature:warlock:armor-of-shadows'] }).errors.some(e => e.code === 'option_prerequisite'));
  const ok = ev({ 'srd51:class:warlock:L2:eldritch-invocations': ['srd51:feature:warlock:agonizing-blast', 'srd51:feature:warlock:armor-of-shadows'], 'srd51:class:warlock:spells:cantrips': [blast, cats.spells.entries.find(s => s.srd?.index === 'chill-touch').id] });
  assert.ok(!ok.errors.some(e => e.code === 'option_prerequisite'), JSON.stringify(ok.errors));
});

test('changing race previews invalidated choices, keeps identity/scores, and logs instead of deleting silently', () => {
  const ctx = context();
  const d = draft(ctx, { ancestry: { raceId: 'srd51:race:elf', subraceId: 'srd51:subrace:elf:high-elf' }, levelHistory: levels(['wizard', 1]), identity: { name: 'Лира', notes: 'заметки' } });
  const filled = autofill(ctx, d).d;
  const proposal = proposeBuildChange(filled, { type: 'setRace', raceId: 'srd51:race:dwarf' }, ctx, cats);
  const gone = proposal.invalidated.map(i => i.choiceId);
  assert.ok(gone.includes('srd51:subrace:elf:high-elf:cantrip') && gone.includes('srd51:subrace:elf:high-elf:language'), JSON.stringify(gone));
  assert.ok(proposal.preservedInputs.includes('identity') && proposal.preservedInputs.includes('baseScores'));
  assert.ok(proposal.nextDraft.selections['srd51:subrace:elf:high-elf:cantrip'], 'not deleted before confirmation');
  const confirmed = confirmBuildChange(proposal);
  assert.equal(confirmed.selections['srd51:subrace:elf:high-elf:cantrip'], undefined);
  assert.ok(confirmed.invalidationLog.some(l => l.choiceId === 'srd51:subrace:elf:high-elf:cantrip' && l.previousValue));
  assert.equal(confirmed.identity.name, 'Лира');
  assert.deepEqual(filled.selections['srd51:subrace:elf:high-elf:cantrip'] !== undefined, true, 'input draft untouched');
});

test('evaluation is deterministic and repeat/back does not add grants twice; no clock, RNG, DOM or eval in the engine', () => {
  const ctx = context({ startLevel: 5 }), { d } = autofill(ctx, draft(ctx, { levelHistory: levels(['paladin', 5]) }));
  const a = evaluateBuild(ctx, cats, d), b = evaluateBuild(ctx, cats, structuredClone(d));
  assert.deepEqual(a, b);
  assert.equal(new Set(a.grants.map(g => g.id)).size, a.grants.length);
  const back = proposeBuildChange(d, { type: 'setLevelHistory', levelHistory: levels(['paladin', 5]) }, ctx, cats);
  assert.deepEqual(back.invalidated, []);
  assert.equal(back.evaluation.grants.length, a.grants.length);
  const source = read('dist/js/rules/character-builder.js');
  for (const banned of ['Math.random', 'Date.now', 'new Date', 'eval(', 'Function(', 'document.', 'localStorage', 'fetch(', 'store.js']) assert.ok(!source.includes(banned), banned);
});

test('stale policy/rules block creation until rebased; proposal DTO keeps caller IDs and no derived values', () => {
  const ctx = context(), { d } = autofill(ctx, draft(ctx, { levelHistory: levels(['fighter', 1]) }));
  const ev = evaluateBuild(ctx, cats, d);
  assert.equal(ev.status, 'valid');
  const dto = toCreationProposal(ev, d, { operationId: 'op-1', characterId: 'ch-1' });
  assert.deepEqual(Object.keys(dto), ['operationId', 'characterId', 'campaignId', 'contextRevision', 'rulesRevision', 'identity', 'build', 'abilityInput', 'rollReceipts', 'manualOverrides']);
  assert.equal(dto.abilityInput.scores.str, 15, 'base scores, not computed ones');
  assert.ok(!JSON.stringify(dto).includes('proficiencyBonus'));
  const moved = { ...ctx, policyRevision: 'v2' };
  const stale = evaluateBuild(moved, cats, d);
  assert.ok(stale.errors.some(e => e.code === 'stale_policy'));
  assert.throws(() => toCreationProposal(stale, d, { operationId: 'op-1', characterId: 'ch-1' }), /не завершена/);
  const rebased = confirmBuildChange(proposeBuildChange(d, { type: 'rebase', policyRevision: 'v2', rulesRevision: cats.options.revision }, moved, cats));
  assert.equal(evaluateBuild(moved, cats, rebased).status, 'valid');
  assert.throws(() => toCreationProposal(ev, d, {}), /operationId/);
  assert.equal(evaluateBuild(ctx, cats, { ...d, schemaVersion: 2 }).errors[0].code, 'draft_schema');
});

test('spell projection: same 524 IDs, 319 SRD spells, 11 reviewed aliases with equal level/school/ritual', () => {
  const published = read('dist/js/data/spells-2014.json');
  assert.equal(JSON.stringify(buildSpellProjection()) + '\n', published);
  const source = json('data/spells/spells-2014.json').spells, srd = json('modules/spell-damage/srd-2014.json').spells;
  assert.deepEqual(cats.spells.entries.map(s => s.id).sort(), source.map(s => s.id).sort());
  assert.equal(cats.spells.coverage.srd, 319);
  assert.equal(new Set(cats.spells.entries.filter(s => s.srd).map(s => s.srd.index)).size, srd.length);
  for (const [index, id] of Object.entries(SRD_ALIASES)) {
    const s = cats.spells.entries.find(x => x.id === id), ref = srd.find(x => x.index === index);
    assert.deepEqual([s.level, s.school, s.ritual, s.srd.via], [ref.level, ref.school.index, ref.ritual, 'alias'], index);
  }
});
