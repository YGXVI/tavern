// TASK-186 P1: every normalized number is checked against the stored SRD 5.1 text
// (data/rules-2014/srd-5.1.json) or against the #176 feature texts, not only against itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCharacterOptions } from '../data/character-options/generate.mjs';
import { validateCharacterOption, resolveCharacterOptionRefs, predicateErrors, PREDICATE_OPERATORS } from '../dist/js/rules/character-options.js';
import { createCatalogueLoader, validatePublicCatalogue, PUBLIC_CATALOGUE_KINDS } from '../dist/js/core/catalogues.js';
import { CATALOGUE_KINDS } from '../dist/js/rules/catalogue.js';
import { CLASSES, RACES } from '../dist/js/data/rules.js';

const json = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url)));
const published = readFileSync(new URL('../dist/js/data/character-options-2014.json', import.meta.url), 'utf8');
const options = JSON.parse(published);
const source = json('data/character-options/srd51.json');
const srd = json('data/rules-2014/srd-5.1.json');
const features = json('dist/js/data/features-2014.json');
const spells = json('data/spells/spells-2014.json').spells;
const page = n => srd.pages[n - 1];
const byId = new Map(options.entries.map(e => [e.id, e]));
const featureText = id => features.entries.find(e => e.id === id).text.en.replace(/\s+/g, ' ');
const ORD = n => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
const ABILITY = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const SKILL = { animal: 'Animal Handling', sleight: 'Sleight of Hand' };
const skillName = id => SKILL[id] || id[0].toUpperCase() + id.slice(1);
const WORD = ['zero', 'one', 'two', 'three', 'four'];

/** Level rows of a class table: the first "<ordinal> +<PB>" line per level across the class pages.
 * Two-column extraction may put a table row after prose of the left column (Barbarian 15–18). */
function tableRows(classId) {
  const [from, to] = source.classes[classId].pages, rows = new Map();
  for (let n = from; n <= to; n++) for (const line of page(n).layout_text.split('\n')) {
    const m = line.match(/\b(\d+)(st|nd|rd|th)\s+\+(\d)\s+(.*)$/);
    if (m && !rows.has(Number(m[1]))) rows.set(Number(m[1]), { level: Number(m[1]), pb: Number(m[3]), tail: m[4], page: n });
  }
  return Array.from({ length: 20 }, (_, i) => rows.get(i + 1)).filter(Boolean);
}
/** Words of a phrase in order, each within ~150 chars of the previous one (columns interleave in extracted text). */
function nearby(text, phrase) {
  const words = phrase.toLowerCase().split(/\s+/), hay = text.toLowerCase().replace(/\s+/g, ' ');
  let at = hay.indexOf(words[0]);
  while (at >= 0) {
    let pos = at + words[0].length, ok = true;
    for (const w of words.slice(1)) { const next = hay.indexOf(w, pos); if (next < 0 || next - pos > 150) { ok = false; break; } pos = next + w.length; }
    if (ok) return true;
    at = hay.indexOf(words[0], at + 1);
  }
  return false;
}
const DASH = /^[̶—–-]$/;
function cells(tail) {
  const clean = tail.replace(/\([^)]*\)/g, ' ');
  return [...clean.matchAll(/\+\d+ ft\.|\d+d\d+|\+\d+|\d+(?:st|nd|rd|th)|\d+|Unlimited|[̶—]/g)].map(m => m[0]);
}
function expectedCells(classId, row) {
  const c = source.classes[classId], out = [];
  c.columns.forEach(col => {
    const v = row.values[col.id];
    if (v === null) out.push('-');
    else if (col.kind === 'feet_bonus') out.push(`+${v} ft.`);
    else if (col.kind === 'ordinal') out.push(ORD(v));
    else if (v === 'unlimited') out.push('Unlimited');
    else out.push(String(v));
  });
  if (c.spellcasting?.slots === 'full') out.push(...row.spellSlots.map(n => n ? String(n) : '-'));
  if (c.spellcasting?.slots === 'half') out.push(...row.spellSlots.slice(0, 5).map(n => n ? String(n) : '-'));
  return out;
}
// Index of the Features column among the numeric cells of each table (0 = before all numbers).
const FEATURE_COLUMN = { monk: 3, rogue: 1, sorcerer: 1 };

test('generator is deterministic and the published file is its exact output', () => {
  const again = JSON.stringify(buildCharacterOptions()) + '\n';
  assert.equal(again, published);
  assert.equal(JSON.stringify(buildCharacterOptions()) + '\n', again);
  assert.equal(options.catalogueKind, 'character_option');
  assert.deepEqual(validatePublicCatalogue('character_option', structuredClone(options)).entries.length, options.entries.length);
});

test('declared SRD package only: 12 classes × 20 rows, 12 subclasses, 9 races, 4 subraces, Acolyte, Grappler', () => {
  const c = options.coverage;
  assert.deepEqual([c.classes, c.progressionRows, c.subclasses, c.races, c.subraces, c.backgrounds, c.feats], [12, 240, 12, 9, 4, 1, 1]);
  assert.equal(c.entries, options.entries.length);
  assert.match(options.scope, /Not the full PHB/);
  for (const e of options.entries) assert.equal(validateCharacterOption(e).valid, true, e.id);
  assert.deepEqual(resolveCharacterOptionRefs(options, { featureIds: new Set(features.entries.map(e => e.id)), spellIds: new Set(spells.map(s => s.id)) }), []);
  assert.ok(!JSON.stringify(options).includes('2024'), 'no 2024 material');
});

test('all 240 class table rows match the SRD text: proficiency bonus and every numeric cell', () => {
  let checked = 0;
  for (const cid of Object.keys(source.classes)) {
    const rows = tableRows(cid), def = byId.get(`srd51:class:${cid}`);
    assert.equal(rows.length, 20, `${cid}: 20 table rows in SRD`);
    rows.forEach((srcRow, i) => {
      const row = def.progression[i];
      assert.equal(row.proficiencyBonus, srcRow.pb, `${cid} ${row.level} PB`);
      let got = cells(srcRow.tail).map(t => (DASH.test(t) ? '-' : t));
      const want = expectedCells(cid, row), at = FEATURE_COLUMN[cid] ?? 0;
      // An empty Features cell is printed as a dash; feature names themselves carry no numbers.
      if (got[at] === '-' && got.length > want.length) got.splice(at, 1);
      if (cid === 'rogue' || cid === 'monk') got = got.slice(0, want.length); // prose of the next column follows
      assert.deepEqual(got.slice(0, want.length), want, `${cid} level ${row.level} p.${srcRow.page}: "${srcRow.tail.slice(0, 70)}"`);
      checked++;
    });
  }
  assert.equal(checked, 240);
});

test('ASI levels and subclass selection levels match class texts; feats are never a level-1 grant', () => {
  for (const [cid, c] of Object.entries(source.classes)) {
    const asiText = featureText(`srd51:feature:${cid}:ability-score-improvement`);
    const levels = [...asiText.matchAll(/(\d+)(?:st|nd|rd|th)/g)].map(m => Number(m[1])).filter(n => n > 1 && n <= 20);
    assert.deepEqual([...new Set(levels)].sort((a, b) => a - b), c.asi, `${cid} ASI from "${asiText.slice(0, 120)}"`);
    const def = byId.get(`srd51:class:${cid}`), asiRows = def.progression.filter(r => r.choices.some(x => x.kind === 'asi_or_feat')).map(r => r.level);
    assert.deepEqual(asiRows, c.asi);
    assert.ok(!def.progression[0].choices.some(x => x.kind === 'asi_or_feat'));
    const rows = tableRows(cid);
    for (const level of c.asi) assert.match(rows[level - 1].tail, /Ability Score/, `${cid} table row ${level}`);
    const subclassRow = def.progression.find(r => r.choices.some(x => x.kind === 'subclass'));
    assert.equal(subclassRow.level, c.subclass.level, cid);
    const label = features.entries.find(e => e.id === `srd51:feature:${c.subclass.featureRef}`).name.en.split(' ')[0];
    assert.match(rows[c.subclass.level - 1].tail, new RegExp(label), `${cid} subclass at ${c.subclass.level}`);
  }
  const expected = { cleric: 1, sorcerer: 1, warlock: 1, druid: 2, wizard: 2 };
  for (const cid of Object.keys(source.classes)) assert.equal(source.classes[cid].subclass.level, expected[cid] ?? 3, cid);
  assert.deepEqual(source.classes.fighter.asi, [4, 6, 8, 12, 14, 16, 19]);
  assert.deepEqual(source.classes.rogue.asi, [4, 8, 10, 12, 16, 19]);
});

test('features are granted at the level stated in their own #176 text; null levels are normalized only by the table', () => {
  const firstGrant = new Map();
  for (const e of options.entries) for (const row of e.progression || []) for (const g of row.grants) if (g.kind === 'feature' && !firstGrant.has(g.ref)) firstGrant.set(g.ref, row.level);
  let compared = 0;
  for (const f of features.entries) if (f.level !== null && firstGrant.has(f.id) && f.kind !== 'option') {
    assert.equal(firstGrant.get(f.id), f.level, f.id); compared++;
  }
  assert.ok(compared >= 120, `compared ${compared}`);
  // Examples from the plan: cleric domain and sorcerer origin are level-1 although #176 has level=null.
  assert.equal(firstGrant.get('srd51:feature:cleric:divine-domain'), 1);
  assert.equal(firstGrant.get('srd51:feature:sorcerer:sorcerous-origin'), 1);
  for (const [key, sc] of Object.entries(source.subclasses)) {
    const cls = source.classes[key.split(':')[0]];
    for (const level of Object.keys(sc.features).map(Number)) assert.ok(cls.subclass.featureLevels.includes(level), `${key} feature at ${level}`);
    for (const level of cls.subclass.featureLevels) assert.ok(sc.features[level], `${key} has a feature at ${level}`);
  }
});

test('subclass spell lists name SRD spells on their page, resolve to existing IDs and have the right spell level', () => {
  const spellById = new Map(spells.map(s => [s.id, s]));
  const half = { 3: 1, 5: 2, 9: 3, 13: 4, 17: 5 };
  for (const [key, sc] of Object.entries(source.subclasses)) {
    const lists = sc.spellList ? [sc.spellList.spells] : sc.terrainSpells ? Object.values(sc.terrainSpells.lands) : [];
    const text = [sc.page, sc.pageEnd ?? sc.page].map(n => page(n).search_text).join(' ').toLowerCase().replace(/\s+/g, ' ');
    const def = byId.get(`srd51:subclass:${key}`);
    const grants = def.progression.flatMap(r => r.grants.map(g => ({ ...g, level: r.level }))).filter(g => g.kind === 'spell' || g.kind === 'spell_list_addition');
    for (const table of lists) for (const [lvl, list] of Object.entries(table)) for (const index of list) {
      const name = spellById.get(grants.find(g => g.id.endsWith(`:spell:${index}`) || g.id.endsWith(`spell-list:${index}`)).ref).name.en.toLowerCase();
      assert.ok(nearby(text, index.replace(/-/g, ' ').replace('blindness deafness', 'blindness/deafness')), `${key}: ${index} in SRD text`);
      const spellLevel = spellById.get(grants.find(g => g.id.endsWith(index)).ref).level;
      const n = Number(lvl);
      const want = sc.spellList?.levelKind === 'spell' ? n : key.startsWith('paladin') ? half[n] : Math.ceil(n / 2);
      assert.equal(spellLevel, want, `${key} ${index} (${name})`);
    }
  }
  const land = byId.get('srd51:subclass:druid:land');
  const arctic = land.progression[2].grants.filter(g => g.prerequisites?.hasFeature === 'srd51:feature:druid:land:arctic');
  assert.equal(arctic.length, 2, 'circle spells depend on the chosen land');
});

test('class proficiencies, hit dice, saves and skill choices match the SRD class pages', () => {
  for (const [cid, c] of Object.entries(source.classes)) {
    const text = page(c.pages[0]).search_text.replace(/\s+/g, ' ');
    assert.match(text, new RegExp(`Hit Dice: 1d${c.hitDie} per ${cid} level`), cid);
    assert.match(text, new RegExp(`Saving Throws: ${ABILITY[c.savingThrows[0]]}, ${ABILITY[c.savingThrows[1]]}`), cid);
    const skills = c.skills.any ? null : c.skills.from.map(skillName);
    assert.match(text, new RegExp(`Skills: Choose (any )?${WORD[c.skills.count]}`), cid);
    if (skills) for (const s of skills) assert.ok(nearby(text, s), `${cid} skill ${s}`);
    const def = byId.get(`srd51:class:${cid}`);
    assert.equal(def.choices.find(x => x.kind === 'skill').count, c.skills.count);
    assert.equal(def.class.hitDie, c.hitDie);
  }
  const mc = page(56).layout_text.replace(/\s+/g, ' ');
  const phrase = p => p.abilityMinimum ? `${ABILITY[p.abilityMinimum.ability]} ${p.abilityMinimum.min}` : (p.any || p.all).map(phrase).join(p.any ? ' or ' : ' and ');
  for (const [cid, c] of Object.entries(source.classes)) assert.ok(mc.includes(`${cid[0].toUpperCase() + cid.slice(1)} ${phrase(c.multiclass.prerequisites)}`), `multiclass ${cid}`);
});

test('race and subrace grants match their own #176 trait texts', () => {
  for (const [rid, r] of Object.entries(source.races)) {
    const t = slug => featureText(`srd51:feature:${rid}:${slug}`);
    const asi = t('ability-score-increase');
    for (const [ability, value] of Object.entries(r.asi)) {
      if (rid === 'human') assert.match(asi, new RegExp(`ability scores each increase by ${value}`));
      else assert.match(asi, new RegExp(`${ABILITY[ability]} score (increases|increase) by ${value}|${ABILITY[ability]} score increases by ${value}`), `${rid} ${ability}`);
    }
    assert.match(t('size'), new RegExp(`your size is ${r.size}`, 'i'), rid);
    assert.match(t('speed'), new RegExp(`walking speed is ${r.speed} feet`), rid);
    if (r.darkvision) assert.match(t('darkvision'), new RegExp(`within ${r.darkvision} feet`), rid);
    const langs = t('languages'), names = { ...source.vocabularies.languages.standard, ...source.vocabularies.languages.exotic };
    for (const l of r.languages) assert.ok(langs.includes(names[l]), `${rid} speaks ${l}`);
    const def = byId.get(`srd51:race:${rid}`);
    assert.equal(def.grants.filter(g => g.kind === 'feature').length, features.entries.filter(e => e.kind === 'racial_trait' && e.scope.raceId === rid && !e.scope.subraceId).length);
  }
  assert.match(featureText('srd51:feature:dwarf:dwarven-combat-training'), /battleaxe, handaxe, light hammer, and warhammer/);
  assert.match(featureText('srd51:feature:dwarf:tool-proficiency'), /smith’s tools, brewer’s supplies, or mason’s tools/);
  assert.match(featureText('srd51:feature:elf:keen-senses'), /Perception/);
  assert.match(featureText('srd51:feature:half-orc:menacing'), /Intimidation/);
  assert.match(featureText('srd51:feature:half-elf:ability-score-increase'), /two other ability scores of your choice increase by 1/);
  assert.match(featureText('srd51:feature:half-elf:skill-versatility'), /two skills of your choice/);
  assert.match(featureText('srd51:feature:tiefling:hellish-resistance'), /resistance to fire damage/);
  assert.match(featureText('srd51:feature:dwarf:dwarven-resilience'), /resistance against poison damage/);
  const legacy = featureText('srd51:feature:tiefling:infernal-legacy');
  for (const s of source.races.tiefling.racialSpells.spells) {
    const name = s.spell.replace(/-/g, ' ');
    if (s.characterLevel === 1) assert.ok(legacy.includes(`You know the ${name} cantrip`), name);
    else assert.ok(legacy.includes(`When you reach ${ORD(s.characterLevel)} level, you can cast the ${name} spell${s.castLevel ? ` as a ${ORD(s.castLevel)}-level spell` : ''}`), name);
    if (s.uses === '1/long_rest') assert.ok(nearby(legacy.slice(legacy.indexOf(name)), 'once with this trait and regain the ability to do so when you finish a long rest'), name);
  }
  assert.match(legacy, /Charisma is your spellcasting ability/);
  assert.equal(source.races.tiefling.racialSpells.ability, 'cha');
  for (const [key, sr] of Object.entries(source.subraces)) for (const [ability, value] of Object.entries(sr.asi))
    assert.match(featureText(`srd51:feature:${key}:ability-score-increase`), new RegExp(`${ABILITY[ability]} score increases by ${value}`), key);
  assert.match(featureText('srd51:feature:dwarf:hill-dwarf:dwarven-toughness'), /hit point maximum increases by 1/);
  assert.match(featureText('srd51:feature:elf:high-elf:elf-weapon-training'), /longsword, shortsword, shortbow, and longbow/);
  assert.match(featureText('srd51:feature:elf:high-elf:cantrip'), /wizard spell list.*Intelligence/);
  const ancestry = page(5).layout_text.replace(/[ \t]+/g, ' ');
  for (const [color, [type, shape, a, b, save]] of Object.entries(source.races.dragonborn.ancestry)) {
    const area = shape === 'line' ? `${a} by ${b} ft. line` : `${b} ft. cone`;
    assert.ok(ancestry.includes(`${color[0].toUpperCase() + color.slice(1)} ${type[0].toUpperCase() + type.slice(1)} ${area} (${save[0].toUpperCase() + save.slice(1)}. save)`), color);
  }
});

test('Acolyte, Grappler, vocabularies and Basic Rules facts', () => {
  const bg = page(61).search_text.replace(/\s+/g, ' ');
  assert.match(bg, /Skill Proficiencies: Insight, Religion/);
  assert.match(bg, /Languages: Two of your choice/);
  const acolyte = byId.get('srd51:background:acolyte');
  assert.equal(acolyte.review.required, true, 'pending Shelter of the Faithful/equipment are visible');
  assert.equal(acolyte.choices[0].count, 2);
  const grappler = byId.get('srd51:feat:grappler');
  assert.equal(features.entries.find(e => e.id === 'srd51:feature:feats:grappler').prerequisiteText, 'Strength 13 or higher');
  assert.deepEqual(grappler.prerequisites, { abilityMinimum: { ability: 'str', min: 13 } });
  assert.deepEqual(grappler.availability, { sourceEnabled: 'rule:feats' });
  assert.equal(grappler.repeatable, false);
  const v = source.vocabularies;
  const has = (pages, name) => pages.some(n => page(n).search_text.replace(/\s+/g, ' ').toLowerCase().includes(name.toLowerCase().replace(/'/g, '’')) || page(n).search_text.toLowerCase().includes(name.toLowerCase()));
  for (const group of ['standard', 'exotic']) for (const name of Object.values(v.languages[group])) assert.ok(has(v.languages.pages, name), name);
  for (const group of ['artisan', 'musical_instrument', 'other']) for (const name of Object.values(v.tools[group])) assert.ok(has([...v.tools.pages, 39, 19], name), name);
  for (const name of Object.values(v.favoredEnemies.types)) assert.ok(has(v.favoredEnemies.pages, name.split(' ').pop()), name);
  for (const name of Object.values(v.terrains.types)) assert.ok(has(v.terrains.pages, name), name);
  const m = options.abilityMethods;
  assert.deepEqual(m.standardArray, [15, 14, 13, 12, 10, 8]);
  assert.equal(m.pointBuy.budget, 27);
  assert.equal(m.pointBuy.cost['15'] * 3, 27, '15/15/15/8/8/8 spends exactly 27');
  assert.match(m.source.note, /no prose/);
});

test('legacy class/race IDs have explicit aliases; no fuzzy join by name', () => {
  for (const c of CLASSES) assert.ok(options.entries.some(e => e.kind === 'class' && e.aliases.includes(c.id)), c.id);
  for (const r of RACES) assert.ok(options.entries.some(e => e.kind === 'race' && e.aliases.includes(r.id)), r.id);
  assert.ok(byId.get('srd51:race:half-elf').aliases.includes('halfelf'));
  assert.ok(byId.get('srd51:race:half-orc').aliases.includes('halforc'));
  assert.equal(byId.get('srd51:class:wizard').class.spellcasting.listRef, 'dndsu:class:21');
  assert.equal(byId.get('srd51:class:fighter').class.spellcasting, null);
});

test('validator rejects unknown operators/kinds, executable-looking input, gaps and dangling refs', () => {
  const base = structuredClone(byId.get('srd51:class:fighter'));
  const bad = mutate => { const v = structuredClone(base); mutate(v); return validateCharacterOption(v).valid; };
  assert.equal(bad(() => {}), true);
  assert.equal(bad(v => { v.progression.pop(); }), false, '19 rows');
  assert.equal(bad(v => { v.progression[3].level = 5; }), false, 'gap');
  assert.equal(bad(v => { v.grants.push({ id: 'x', kind: 'teleport' }); }), false, 'unknown grant');
  assert.equal(bad(v => { v.choices.push({ id: 'y', kind: 'skill', count: 0, options: ['arcana'] }); }), false, 'count 0');
  assert.equal(bad(v => { v.choices[0].count = 99; }), false, 'more than options');
  assert.equal(bad(v => { v.grants.push(structuredClone(v.grants[0])); }), false, 'duplicate grant id');
  assert.equal(bad(v => { v.class.multiclass.prerequisites = { js: 'return true' }; v.prerequisites = { js: 'return true' }; }), false, 'no code predicates');
  assert.equal(bad(v => { v.progression[0].proficiencyBonus = null; }), false, 'null is not a number');
  assert.ok(predicateErrors({ eval: 'x' }).length);
  assert.ok(predicateErrors({ all: [] }).length);
  assert.ok(predicateErrors({ abilityMinimum: { ability: 'luck', min: 13 } }).length);
  assert.deepEqual(predicateErrors({ all: [{ abilityMinimum: { ability: 'str', min: 13 } }, { not: { sourceEnabled: 'rule:multiclass' } }] }), []);
  assert.deepEqual(PREDICATE_OPERATORS, ['all', 'any', 'not', 'classLevel', 'characterLevel', 'abilityMinimum', 'hasFeature', 'hasSpell', 'sourceEnabled', 'unique']);
  const dangling = { entries: [{ ...structuredClone(base), featureRefs: ['srd51:feature:fighter:nope'] }] };
  assert.equal(resolveCharacterOptionRefs(dangling, { featureIds: new Set(), spellIds: new Set() })[0].ref, 'srd51:feature:fighter:nope');
});

test('public loader serves character_option; private template kinds are unchanged', async () => {
  assert.deepEqual(CATALOGUE_KINDS, ['feature', 'magic_item']);
  assert.ok(PUBLIC_CATALOGUE_KINDS.includes('character_option'));
  let calls = 0;
  const loader = createCatalogueLoader({ urls: { character_option: 'x' }, fetcher: async (_, init) => { calls++; assert.equal(init.credentials, 'omit'); return { ok: true, json: async () => JSON.parse(published) }; } });
  const [a, b] = await Promise.all([loader.load('character_option'), loader.load('character_option')]);
  assert.equal(a, b); assert.equal(calls, 1); assert.ok(Object.isFrozen(a.entries[0]));
  const broken = JSON.parse(published); broken.entries.find(e => e.kind === 'subclass').classId = 'srd51:class:nope';
  const failing = createCatalogueLoader({ urls: { character_option: 'x' }, fetcher: async () => ({ ok: true, json: async () => broken }) });
  await assert.rejects(failing.load('character_option'), /Неверная ссылка/);
  await assert.rejects(loader.load('spellbook'), /Неизвестный вид/);
});
