// TASK-186 P1b: SRD 5.1 equipment projection and starting equipment, checked against the stored SRD text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEquipment, slug } from '../data/equipment/generate.mjs';
import { validateEquipmentEntry } from '../dist/js/rules/equipment.js';
import { validatePublicCatalogue, createCatalogueLoader } from '../dist/js/core/catalogues.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const published = read('dist/js/data/equipment-2014.json');
const equipment = JSON.parse(published);
const options = JSON.parse(read('dist/js/data/character-options-2014.json'));
const source = JSON.parse(read('data/character-options/srd51.json'));
const srd = JSON.parse(read('data/rules-2014/srd-5.1.json'));
const text = n => srd.pages[n - 1].search_text.replace(/\s+/g, ' ');
const byId = new Map(equipment.entries.map(e => [e.id, e]));
const get = s => byId.get(`srd51:equipment:${s}`);
const flat = s => s.toLowerCase().replace(/[‐-]+/g, '-').replace(/[’']/g, '’');
function nearby(hay, phrase, gap = 60) {
  const words = flat(phrase).split(/\s+/), h = flat(hay);
  for (let at = h.indexOf(words[0]); at >= 0; at = h.indexOf(words[0], at + 1)) {
    let pos = at + words[0].length, ok = true;
    for (const w of words.slice(1)) { const next = h.indexOf(w, pos); if (next < 0 || next - pos > gap) { ok = false; break; } pos = next + w.length; }
    if (ok) return true;
  }
  return false;
}

test('equipment projection is deterministic, valid and loads as a public catalogue', async () => {
  assert.equal(JSON.stringify(buildEquipment()) + '\n', published);
  validatePublicCatalogue('equipment', structuredClone(equipment));
  for (const e of equipment.entries) assert.equal(validateEquipmentEntry(e).valid, true, e.id);
  const loader = createCatalogueLoader({ urls: { equipment: 'x' }, fetcher: async () => ({ ok: true, json: async () => JSON.parse(published) }) });
  assert.equal((await loader.load('equipment')).entries.length, equipment.entries.length);
  const broken = JSON.parse(published); broken.entries.find(e => e.kind === 'pack').contents[0].ref = 'srd51:equipment:nope';
  assert.throws(() => validatePublicCatalogue('equipment', broken), /Неверная ссылка набора/);
});

test('every priced row of the SRD armor, weapon, gear and tool tables is parsed exactly once', () => {
  const kinds = k => equipment.entries.filter(e => e.kind === k);
  const weapons = kinds('weapon'), armor = kinds('armor');
  assert.deepEqual(['simple:melee', 'simple:ranged', 'martial:melee', 'martial:ranged'].map(g => weapons.filter(w => `${w.weapon.category}:${w.weapon.range}` === g).length), [10, 4, 18, 5]);
  assert.deepEqual(['light', 'medium', 'heavy'].map(c => armor.filter(a => a.armor.category === c).length), [3, 5, 4]);
  assert.equal(kinds('shield').length, 1);
  assert.equal(kinds('tool').length, 35);
  assert.equal(kinds('pack').length, 7);
  // Page 69 (adventuring gear): one parsed item per "<cost> gp|sp|cp" token in the table.
  const p69 = srd.pages[68].layout_text.match(/\b[\d,]+ (gp|sp|cp)\b/g).length;
  assert.equal(equipment.entries.filter(e => e.source.pages[0] === 69).length, p69);
  const weaponRows = [65, 66].flatMap(n => srd.pages[n - 1].layout_text.split('\n')).filter(l => /^ {2}\S.*\s[\d,]+ (gp|sp|cp)\s+(\d+d\d+ \w+|\d+ \w+|—)/.test(l)).length;
  assert.equal(weaponRows, 37);
  assert.equal(equipment.coverage.unpriced, 10);
  for (const e of equipment.entries.filter(x => x.review.required)) assert.equal(e.cost, null, e.id);
});

test('spot values match the SRD tables, with exact units and no rounding', () => {
  assert.deepEqual(get('chain-mail').armor, { category: 'heavy', baseAc: 16, addDex: false, dexMax: null, strength: 13, stealthDisadvantage: true });
  assert.deepEqual(get('chain-mail').cost, { value: 75, unit: 'gp', cp: 7500 });
  assert.deepEqual(get('studded-leather').armor, { category: 'light', baseAc: 12, addDex: true, dexMax: null, strength: null, stealthDisadvantage: false });
  assert.equal(get('plate').cost.cp, 150000);
  assert.deepEqual(get('shield').armor, { category: 'shield', baseAc: 2, addDex: false, dexMax: null, strength: null, stealthDisadvantage: false });
  assert.deepEqual(get('longbow').weapon, { category: 'martial', range: 'ranged', damage: { dice: '1d8', type: 'piercing' }, properties: ['ammunition', 'heavy', 'two-handed'], normalRange: 150, longRange: 600, versatileDice: null });
  assert.deepEqual(get('longsword').weapon.properties, ['versatile']);
  assert.equal(get('longsword').weapon.versatileDice, '1d10');
  assert.deepEqual(get('blowgun').weapon.damage, { dice: '1', type: 'piercing' });
  assert.equal(get('net').weapon.damage, null);
  assert.deepEqual(get('dart').cost, { value: 5, unit: 'cp', cp: 5 });
  assert.equal(get('dart').weight.lb, 0.25);
  assert.equal(get('crossbow-bolts').weight.lb, 1.5);
  assert.equal(get('crossbow-bolts').bundleSize, 20);
  assert.equal(get('sling').weight, null, '— is not 0');
  assert.deepEqual(get('waterskin').weight, { lb: 5, note: 'full' });
  assert.equal(get('spyglass').cost.value, 1000);
  assert.equal(get('ball-bearings').bundleSize, 1000);
  assert.equal(get('arcane-focus-orb').group, 'arcane-focus');
  assert.equal(get('holy-symbol-emblem').kind, 'focus');
  assert.equal(get('lute').group, 'musical-instrument');
  assert.equal(slug('Crossbow, light'), 'crossbow-light');
});

const PACK_WORDS = { 'ball-bearings': 'ball bearings', 'lantern-hooded': 'hooded lantern', 'rope-hempen': 'hempen rope', 'case-map-or-scroll': 'cases for maps', 'clothes-fine': 'fine clothes',
  'ink-pen': 'ink pen', 'sealing-wax': 'sealing wax', 'clothes-costume': 'costumes', 'disguise-kit': 'disguise kit', 'mess-kit': 'mess kit', 'alms-box': 'alms box', 'incense-block': 'blocks of incense', 'sand-bag': 'bag of sand', 'small-knife': 'small knife', rations: 'rations', oil: 'oil' };
test('equipment pack contents and prices match the pack text on page 70', () => {
  const t = text(70);
  for (const pack of equipment.entries.filter(e => e.kind === 'pack')) {
    const start = t.indexOf(`${pack.name.en} (${pack.cost.value} gp)`);
    assert.ok(start >= 0, pack.id);
    const rest = t.slice(start + 10), next = rest.search(/[A-Z][a-z]+’s Pack \(\d+ gp\)/), para = rest.slice(0, next < 0 ? 700 : next);
    // Completeness: drop interleaved Tools-table rows, then count the listed items.
    const prose = para.replace(/[A-Z][a-z’']*(?: [a-z’']+)*? [\d,]+ (gp|sp|cp) ([\d½/]+ lb\.|—) ?/g, '');
    const includes = prose.match(/Includes (.*?)\.(?: |$)/)[1];
    // "cases for maps and scrolls" is one item whose name contains "and".
    const listed = includes.replace(/(\d),(\d)/g, '$1$2').replace('maps and scrolls', 'maps/scrolls').split(/,\s*(?:and\s+)?|\s+and\s+/).filter(Boolean).length + (/The pack also has/.test(prose) ? 1 : 0);
    assert.equal(pack.contents.length, listed, `${pack.id}: "${includes}"`);
    for (const c of pack.contents) {
      const word = PACK_WORDS[c.ref.split(':')[2]] || byId.get(c.ref).name.en.toLowerCase();
      assert.ok(nearby(para, word, 40), `${pack.id}: ${word}`);
      if (c.quantity > 1) assert.ok(nearby(para, `${c.quantity} ${word.split(' ')[0].slice(0, 4)}`, 60), `${pack.id}: ${c.quantity} ${word}`);
    }
  }
});

const PHRASE = { 'crossbow-light': 'light crossbow', 'crossbow-bolts': 'bolts', 'scale-mail': 'scale mail', 'chain-mail': 'chain mail', leather: 'leather armor', 'thieves-tools': 'thieves’ tools', 'component-pouch': 'component pouch',
  'priests-pack': 'priest’s pack', 'explorers-pack': 'explorer’s pack', 'dungeoneers-pack': 'dungeoneer’s pack', 'diplomats-pack': 'diplomat’s pack', 'entertainers-pack': 'entertainer’s pack', 'burglars-pack': 'burglar’s pack', 'scholars-pack': 'scholar’s pack',
  'prayer-book': 'prayer book', 'prayer-wheel': 'prayer wheel', 'incense-stick': 'incense', 'clothes-common': 'common clothes', arrows: 'arrows', handaxe: 'handax', javelin: 'javelin', dart: 'dart', dagger: 'dagger', shortsword: 'shortsword' };
const filterPhrase = f => f.kind === 'weapon' ? `${f.category} ${f.range ? `${f.range} ` : ''}weapon` : f.group.replace(/-/g, ' ');
test('starting equipment trees of 12 classes and Acolyte follow their SRD equipment text', () => {
  const blocks = [...Object.entries(source.classes).map(([id, c]) => [`srd51:class:${id}`, c.pages[0], 'You start with the following equipment']), ['srd51:background:acolyte', 61, 'Equipment:']];
  for (const [id, page, marker] of blocks) {
    const t = text(page), at = t.indexOf(marker);
    assert.ok(at >= 0, id);
    // Columns interleave with Hit Points/Proficiencies text, so the block is wider than the list itself.
    const block = t.slice(at, at + (id.includes('background') ? 600 : 900));
    const def = options.entries.find(e => e.id === id), se = def.startingEquipment;
    const alternatives = se.choices.reduce((n, c) => n + c.alternatives.length, 0);
    // Only bullets with a real choice: the SRD prints a lone "(a)" on the Rogue's fixed line.
    const markers = block.split('•').filter(b => b.includes('(b)')).reduce((n, b) => n + (b.match(/\([abc]\)/g) || []).length, 0);
    if (id.includes('class')) assert.equal(alternatives, markers, `${id}: ${markers} (a)/(b)/(c) in "${block.slice(0, 160)}"`);
    assert.equal(se.choices.flatMap(c => c.alternatives).filter(a => a.requiresProficiency).length, (block.match(/if proficient/g) || []).length, `${id} if proficient`);
    const items = [...se.grants.filter(g => g.kind === 'item'), ...se.choices.flatMap(c => c.alternatives.flatMap(a => a.items))];
    for (const item of items) {
      const phrase = item.ref ? (PHRASE[item.ref.split(':')[2]] || byId.get(item.ref).name.en.toLowerCase()) : filterPhrase(item.filter);
      assert.ok(nearby(block, phrase, 90), `${id}: "${phrase}"`);
    }
  }
  const acolyte = options.entries.find(e => e.id === 'srd51:background:acolyte').startingEquipment;
  assert.deepEqual(acolyte.grants.find(g => g.kind === 'currency'), { id: 'srd51:background:acolyte:starting:currency:gp', kind: 'currency', unit: 'gp', value: 15 });
  assert.match(text(61), /a pouch containing 15 gp/);
});

test('class and race proficiency values name real weapons/tools or categories', () => {
  const weapons = new Set(equipment.entries.filter(e => e.kind === 'weapon').map(e => e.id.split(':')[2]));
  const tools = new Set(equipment.entries.filter(e => e.kind === 'tool').map(e => e.id.split(':')[2]));
  for (const e of options.entries) for (const g of [...e.grants, ...(e.class?.multiclass.grants || [])]) {
    if (g.kind === 'proficiency' && g.category === 'weapon') assert.ok(['simple', 'martial'].includes(g.value) || weapons.has(g.value), `${e.id}: ${g.value}`);
    if (g.kind === 'proficiency' && g.category === 'tool') assert.ok(tools.has(g.value), `${e.id}: ${g.value}`);
  }
  for (const e of options.entries) for (const c of e.choices) if (c.kind === 'tool') for (const o of c.options) assert.ok(tools.has(o), `${e.id}: ${o}`);
});
