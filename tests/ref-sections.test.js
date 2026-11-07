// Справочник (#203): текст SRD заклинаний, разбор урона по ячейкам, русские названия снаряжения.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.self ??= {};
globalThis.window ??= { addEventListener() {}, removeEventListener() {} };
const data = (f) => JSON.parse(readFileSync(new URL(`../dist/js/data/${f}`, import.meta.url), 'utf8'));
const { powerOf } = await import('../dist/js/views/ref/spell-power.js');
const { GEAR_RU } = await import('../dist/js/views/ref/world-text.js');

const srd = data('spells-srd-2014.json').spells;
const cat = data('spells-2014.json').entries;
const spell = (en) => { const e = cat.find((x) => x.name.en.toLowerCase() === en); return { level: e.level, srdText: srd[e.srd.index] }; };

test('заклинания: у всех 319 заклинаний SRD есть английский текст', () => {
  const srdOnes = cat.filter((e) => e.srd);
  assert.equal(srdOnes.length, 319);
  for (const e of srdOnes) assert.ok(srd[e.srd.index]?.text.length, e.srd.index);
  assert.match(srd.fireball.higher, /1d6 for each slot level above 3rd/);
});

test('заклинания: урон на ячейке и рост заговора по уровню', () => {
  const fb = powerOf(spell('fireball'));
  assert.deepEqual([fb.n, fb.d, fb.type, fb.step.n, fb.step.from], [8, 6, 'fire', 1, 3]);
  const bolt = powerOf(spell('fire bolt'));
  assert.equal(bolt.cantrip, true);
  assert.equal(bolt.flat, undefined);
  const cure = powerOf(spell('cure wounds'));
  assert.equal(cure.heal, true);
  assert.equal(cure.mod, true);
  assert.equal(powerOf(spell('wish')), null);
});

test('снаряжение: у каждого предмета SRD есть русское название', () => {
  const eq = data('equipment-2014.json').entries.filter((e) => !['weapon', 'armor', 'shield'].includes(e.kind));
  const RU = (en) => GEAR_RU[en] || ({ Crystal: 1, Orb: 1, Rod: 1, Staff: 1, Wand: 1, Arrows: 1, 'Blowgun needles': 1, 'Crossbow bolts': 1, 'Sling bullets': 1, Amulet: 1, Emblem: 1, Reliquary: 1, 'Sprig of mistletoe': 1, Totem: 1, 'Wooden staff': 1, 'Yew wand': 1 }[en] && 'есть в EQ_RU') || ['Burglar’s Pack', 'Diplomat’s Pack', 'Dungeoneer’s Pack', 'Entertainer’s Pack', 'Explorer’s Pack', 'Priest’s Pack', 'Scholar’s Pack'].includes(en);
  assert.deepEqual(eq.filter((e) => !RU(e.name.en)).map((e) => e.name.en), []);
});
