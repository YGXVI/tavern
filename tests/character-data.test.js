// TASK-186 P4 (library side): build → Character.data in the TASK-004 sheet vocabulary (#61 task186-p4-create-dto-answers-1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBuild, toCharacterData } from '../dist/js/rules/character-builder.js';
import { cats, context, draft, levels, autofill } from './helpers/builder-fixtures.js';

// `allowed` keys of character_command in #156 (supabase/migrations/20261030140100_character_edits.sql at
// cdaf58734f9e62bf33408b84aaf5ee1222ac651f) plus the agreed immutable `creation`.
const RULES_ALLOWED = ['name', 'portrait', 'profile', 'classId', 'className', 'raceId', 'raceName', 'level', 'classes', 'background', 'alignment', 'stats', 'saves', 'skills',
  'ac', 'hp', 'hpMax', 'tempHp', 'speed', 'darkvision', 'hitDice', 'hitDicePools', 'deathSaves', 'conditions', 'attacks', 'actions', 'bonusActions', 'reactions', 'slots', 'slotPools',
  'spells', 'spellSources', 'knownSpells', 'inventory', 'inventoryItems', 'features', 'featureEntries', 'resources', 'notes', 'initBonus', 'profBonus', 'light', 'aura',
  'sidekick', 'overrides', 'proficiencies', 'coins', 'movement', 'defenses', 'concentration', 'statblock'];

let counter = 0;
const makeId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
function build(cls, n, over = {}, ctxOver = {}) {
  const ctx = context({ startLevel: n, ...ctxOver }), d = draft(ctx, { levelHistory: levels([cls, n]), identity: { name: 'Тест', notes: '' }, ...over });
  const { ev } = autofill(ctx, d);
  assert.equal(ev.status, 'valid', JSON.stringify([...ev.errors, ...ev.missing].slice(0, 3)));
  return { ev, d };
}
/** Shape checks mirroring the sheet's validateDraft/SQL validator that the create command will run. */
function sheetShape(data) {
  for (const key of Object.keys(data)) assert.ok(RULES_ALLOWED.includes(key) || key === 'creation', `unknown key ${key}`);
  for (const key of ['ac', 'attacks', 'initBonus', 'profBonus']) assert.ok(!(key in data), `${key} is left to the sheet`);
  assert.ok(Number.isInteger(data.level) && data.level >= 1 && data.level <= 20);
  assert.equal(data.classes.reduce((n, c) => n + c.levels, 0), data.level);
  for (const a of ['str', 'dex', 'con', 'int', 'wis', 'cha']) assert.ok(Number.isInteger(data.stats[a]));
  for (const field of ['classes', 'hitDicePools', 'slotPools', 'resources', 'spellSources', 'knownSpells', 'inventoryItems', 'featureEntries']) {
    const ids = data[field].map(x => x.id);
    assert.equal(new Set(ids).size, ids.length, `unique ids in ${field}`);
    assert.ok(ids.every(Boolean), `ids in ${field}`);
  }
  for (const p of [...data.slotPools, ...data.resources]) assert.ok(p.spent <= p.max && ['short', 'long'].includes(p.recovery), p.id);
  for (const p of data.hitDicePools) assert.ok(p.spent <= p.total && [6, 8, 10, 12].includes(p.die));
  const sources = new Set(data.spellSources.map(s => s.id));
  for (const s of data.knownSpells) assert.ok(sources.has(s.sourceId) && /^dndsu:spell:\d+$/.test(s.ref), s.name);
  assert.ok(new TextEncoder().encode(JSON.stringify(data)).length < 262144, 'within the 256 KiB sheet limit');
}

test('fighter 1: legacy names, final stats, proficiencies, hit dice, opened packs, provenance; no derived sheet values', () => {
  const { ev, d } = build('fighter', 1);
  const { data, ids } = toCharacterData(ev, d, cats, { makeId });
  sheetShape(data);
  assert.deepEqual([data.classId, data.className, data.raceId, data.raceName, data.background], ['fighter', 'Воин', 'human', 'Человек', 'Прислужник']);
  assert.deepEqual(data.stats, ev.derivedInputs.abilityScores);
  assert.deepEqual(data.proficiencies.saves, { str: 1, con: 1 });
  assert.ok(data.proficiencies.skills.insight === 1 && data.proficiencies.skills.religion === 1, 'Acolyte skills');
  assert.match(data.proficiencies.tools, /Доспехи: лёгкие, средние, тяжёлые, щиты/);
  assert.match(data.proficiencies.languages, /Common/);
  assert.deepEqual(data.hitDicePools.map(({ die, total, spent }) => [die, total, spent]), [[10, 1, 0]]);
  assert.deepEqual([data.slotPools, data.knownSpells, data.spellSources], [[], [], []]);
  assert.equal(data.coins.gp, 15, 'Acolyte pouch');
  const pack = d.selections['srd51:class:fighter:starting:equipment:4'].alternative === 'a' ? 'srd51:equipment:dungeoneers-pack' : 'srd51:equipment:explorers-pack';
  assert.ok(data.inventoryItems.some(i => i.fromPack === pack && i.ref === 'srd51:equipment:backpack'), 'pack opened into items');
  assert.ok(!data.inventoryItems.some(i => i.ref === pack), 'the pack itself is not an item');
  assert.equal(data.hp, null, 'HP stays unknown without the sheet rules port');
  assert.ok(data.featureEntries.some(f => f.ref === 'srd51:feature:fighter:second-wind' && f.source === 'Воин, 1-й уровень'));
  assert.deepEqual(Object.keys(data.creation), ['schemaVersion', 'edition', 'verified', 'rulesRevision', 'policyRevision', 'ancestry', 'background', 'levelHistory', 'selections', 'abilityInput', 'rollReceipts', 'manualOverrides']);
  assert.equal(data.creation.verified, 'client');
  assert.deepEqual(data.creation.abilityInput.scores, d.baseScores, 'base scores kept as input, final ones in stats');
  assert.ok(Object.keys(ids).length >= data.featureEntries.length);
});

test('retry keeps the payload: the same ids map gives identical data and no new IDs', () => {
  const { ev, d } = build('cleric', 5);
  const first = toCharacterData(ev, d, cats, { makeId });
  let calls = 0;
  const again = toCharacterData(evaluateBuild(context({ startLevel: 5 }), cats, structuredClone(d)), structuredClone(d), cats, { ids: first.ids, makeId: () => { calls++; return 'x'; } });
  assert.equal(calls, 0);
  assert.equal(JSON.stringify(again.data), JSON.stringify(first.data));
});

test('casters: shared slots, pact pool, domain spells always prepared, wizard book with prepared flags, innate magic', () => {
  const cleric = build('cleric', 5), c = toCharacterData(cleric.ev, cleric.d, cats, { makeId }).data;
  sheetShape(c);
  assert.deepEqual(c.slotPools.map(p => [p.circle, p.max, p.kind, p.recovery]), [[1, 4, 'spellcasting', 'long'], [2, 3, 'spellcasting', 'long'], [3, 2, 'spellcasting', 'long']]);
  assert.deepEqual(c.spellSources.map(s => [s.name, s.ability, s.kind]), [['Жрец', 'wis', 'подготовленные']]);
  const bless = cats.spells.entries.find(s => s.srd?.index === 'bless').id;
  assert.ok(c.knownSpells.find(s => s.ref === bless)?.prepared, 'Life domain spell is prepared');
  const warlock = build('warlock', 5), w = toCharacterData(warlock.ev, warlock.d, cats, { makeId }).data;
  assert.deepEqual(w.slotPools.map(p => [p.circle, p.max, p.kind, p.recovery]), [[3, 2, 'pact', 'short']]);
  assert.equal(w.spellSources[0].kind, 'магия договора');
  const wizard = build('wizard', 3), book = wizard.d.selections['srd51:class:wizard:spells:spellbook'];
  wizard.d.selections['srd51:class:wizard:spells:prepared'] = book.slice(0, 2); // preparation is optional, so set it explicitly
  const wizardEv = evaluateBuild(context({ startLevel: 3 }), cats, wizard.d);
  assert.equal(wizardEv.status, 'valid', JSON.stringify(wizardEv.errors));
  const z = toCharacterData(wizardEv, wizard.d, cats, { makeId }).data;
  assert.deepEqual(book.map(ref => z.knownSpells.find(s => s.ref === ref).prepared), book.map((_, i) => i < 2), 'spellbook entries carry their prepared flag');
  assert.equal(z.knownSpells.filter(s => s.circle >= 1).length, book.length, 'preparing does not duplicate book spells');
  const tiefling = build('fighter', 5, { ancestry: { raceId: 'srd51:race:tiefling', subraceId: null } }), t = toCharacterData(tiefling.ev, tiefling.d, cats, { makeId }).data;
  assert.deepEqual(t.spellSources.map(s => [s.name, s.ability, s.kind]), [['Тифлинг', 'cha', 'врождённые']]);
  assert.equal(t.knownSpells.length, 3);
  const elf = build('fighter', 1, { ancestry: { raceId: 'srd51:race:elf', subraceId: 'srd51:subrace:elf:high-elf' } }), e = toCharacterData(elf.ev, elf.d, cats, { makeId }).data;
  assert.deepEqual(e.spellSources.map(s => s.ability), ['int'], 'high elf cantrip uses Intelligence');
});

test('resources from class tables; unlimited rages are not turned into a number; HP from the injected sheet formula', () => {
  const monk = build('monk', 5), m = toCharacterData(monk.ev, monk.d, cats, { makeId }).data;
  assert.deepEqual(m.resources.map(r => [r.name, r.max, r.recovery]), [['Ки', 5, 'short']]);
  const barb = build('barbarian', 20), b = toCharacterData(barb.ev, barb.d, cats, { makeId }).data;
  assert.ok(!b.resources.some(r => r.name === 'Ярость'), 'Barbarian 20: unlimited rages are not a counter');
  sheetShape(b);
  const seen = [];
  const withHp = toCharacterData(monk.ev, monk.d, cats, { makeId }, { abilityModifier: () => 0, creationHitPoints: input => { seen.push(input); return 33; } }).data;
  assert.deepEqual([withHp.hp, withHp.hpMax], [33, 33]);
  assert.equal(seen[0].firstLevelHitDie, 8);
  assert.equal(seen[0].constitution, monk.ev.derivedInputs.abilityScores.con);
});

test('expertise doubles the multiplier; only a valid build converts', () => {
  const rogue = build('rogue', 1), r = toCharacterData(rogue.ev, rogue.d, cats, { makeId }).data;
  const expert = rogue.d.selections['srd51:class:rogue:L1:expertise'].filter(x => x !== 'thieves-tools');
  for (const s of expert) assert.equal(r.proficiencies.skills[s], 2);
  assert.match(r.proficiencies.tools, /Thieves’ tools/);
  const incomplete = evaluateBuild(context(), cats, draft(context(), { levelHistory: levels(['rogue', 1]) }));
  assert.throws(() => toCharacterData(incomplete, draft(context()), cats, { makeId }), /не завершена/);
  assert.throws(() => toCharacterData(rogue.ev, rogue.d, cats, {}), /генератор ID/);
});
