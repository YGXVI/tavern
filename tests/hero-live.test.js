// Экраны героя на настоящих данных (#202): переводчик Character → HeroView и действия листа.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toHeroView, toHeroCard, spellIndex, signed } from '../dist/js/views/hero/adapter.js';
import { applyHeroAction, rollFormula } from '../dist/js/views/hero/actions.js';
import { LIRA } from '../dist/js/views/hero/fixture.js';
import { seedDB } from '../dist/js/data/demo.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const heroes = read('supabase/tests/character_create_fixtures.json').map((f) => ({ ...f.data, id: f.name, ownerId: 'u1' }));
const spells = spellIndex({ spells: read('dist/js/data/spells-2014.json'), ref: read('dist/js/data/spells-ref-2014.json') });
const sign = /^[+−]\d+$/;
const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };

// Форма та же, что у образца: ключи верхнего уровня и жизненных показателей.
function sameShape(v, name) {
  for (const k of Object.keys(LIRA)) assert.ok(k in v, `${name}: нет поля ${k}`);
  for (const k of Object.keys(LIRA.vitals)) assert.ok(k in v.vitals, `${name}: нет vitals.${k}`);
  for (const k of Object.keys(LIRA.inventory)) assert.ok(k in v.inventory, `${name}: нет inventory.${k}`);
  for (const k of ['action', 'bonus', 'reaction', 'special']) assert.ok(Array.isArray(v.actions[k]), `${name}: actions.${k}`);
  assert.equal(v.abilities.length, 6); assert.equal(v.skills.length, 18);
  for (const a of v.abilities) { assert.match(a.mod, sign); assert.match(a.save, sign); }
  for (const s of v.skills) { assert.match(s.mod, sign); assert.ok(['none', 'prof', 'expert'].includes(s.prof)); }
  for (const r of v.resources) assert.ok(r.left >= 0 && r.left <= r.total && ['slot', 'use'].includes(r.kind), `${name}: ${r.name}`);
}

test('герои конструктора: лист той же формы, что образец', () => {
  for (const h of heroes) sameShape(toHeroView(h, { userId: 'u1', spells }), h.id);
});

test('чародей 3: класс, спасброски, ячейки, СЛ и заклинания из справочника', () => {
  const h = heroes.find((x) => x.id === 'sorcerer3-draconic');
  const v = toHeroView(h, { userId: 'u1', spells, campaign: { id: 'c1', name: 'Склеп', live: false } });
  assert.equal(v.level, 3);
  assert.equal(v.classes[0].hitDie, 'к6');
  assert.equal(v.vitals.prof, '+2');
  assert.equal(v.abilities.find((a) => a.key === 'cha').save, signed(-1 + 2)); // Хар 9, владение спасброском
  assert.ok(v.abilities.find((a) => a.key === 'cha').saveProf);
  assert.deepEqual(v.resources.filter((r) => r.kind === 'slot').map((r) => [r.total, r.left]), [[4, 4], [2, 2]]);
  assert.equal(v.spellcasting.dc, 8 + 2 - 1);
  assert.ok(v.spellcasting.spells.length > 0);
  assert.ok(v.spellcasting.spells.some((s) => s.time && s.range), 'время и дистанция из справочника');
  assert.equal(v.isMine, true);
  assert.equal(toHeroCard(h, { userId: 'u1', campaign: { id: 'c1', name: 'Склеп' } }).summary.endsWith('Склеп'), true);
});

test('старый герой песочницы: лист без конструктора не падает', () => {
  const lira = seedDB().campaigns['c-crypt'].characters.find((c) => c.id === 'ch-lira');
  const v = toHeroView(lira, { userId: lira.ownerId });
  sameShape(v, 'ch-lira');
  assert.equal(v.vitals.hp.max, lira.hpMax);
  assert.ok(v.actions.action.some((a) => a.icon === 'weapon' && a.hit === '+5'));
  // Текст старого листа: заклинания по кругам (со справочником), сумка и умения.
  const lv = toHeroView(lira, { userId: lira.ownerId, spells });
  assert.ok(lv.spellcasting.spells.some((x) => x.level === 3), 'есть 3 круг');
  assert.ok(lv.spellcasting.spells.some((x) => x.name === 'Огненный снаряд' && x.level === 0 && x.range), 'заговор найден в справочнике');
  assert.ok(lv.inventory.pack.length > 1);
  assert.equal(lv.features.length, 1);
});

test('урон: сначала временные хиты, на 0 — без сознания; лечение поднимает и снимает', () => {
  const h = { name: 'Г', hp: 5, hpMax: 10, tempHp: 3, conditions: [], deathSaves: { s: 0, f: 0 } };
  applyHeroAction(h, 'setHp', { delta: -4 });
  assert.deepEqual([h.hp, h.tempHp], [4, 0]);
  const note = applyHeroAction(h, 'setHp', { delta: -4 });
  assert.equal(h.hp, 0); assert.ok(h.conditions.includes('unconscious')); assert.match(note.title, /без сознания/);
  applyHeroAction(h, 'setHp', { delta: 20 });
  assert.equal(h.hp, 10); assert.ok(!h.conditions.includes('unconscious'));
});

test('спасбросок от смерти и 20 — встаёт с 1 хитом', () => {
  const h = { name: 'Г', hp: 0, hpMax: 10, conditions: ['unconscious'], deathSaves: { s: 0, f: 0 } };
  applyHeroAction(h, 'deathSave', {}, { random: () => 0.5 }); // 11 — успех
  assert.equal(h.deathSaves.s, 1);
  applyHeroAction(h, 'deathSave', {}, { random: () => 0.999 }); // 20
  assert.equal(h.hp, 1); assert.ok(!h.conditions.includes('unconscious'));
  assert.match(applyHeroAction(h, 'deathSave', {}).title, /только при 0/);
});

test('ячейки, заклинания и отдых', () => {
  const h = structuredClone(heroes.find((x) => x.id === 'sorcerer3-draconic'));
  const s1 = h.knownSpells.find((s) => s.circle === 1);
  applyHeroAction(h, 'cast', { spellId: s1.id });
  assert.equal(h.slotPools.find((p) => p.circle === 1).spent, 1);
  applyHeroAction(h, 'useResource', { id: h.resources[0].id });
  assert.equal(h.resources[0].spent, 1);
  h.hp = 5; h.hitDicePools[0].spent = 2;
  applyHeroAction(h, 'rest', { kind: 'short', hitDice: 1 }, { random: seq(0.5) });
  assert.equal(h.hitDicePools[0].spent, 3);
  assert.equal(h.hp, 5 + 4 + 2); // к6 выпало 4, Телосложение 14 → +2
  applyHeroAction(h, 'rest', { kind: 'long' });
  assert.equal(h.hp, h.hpMax);
  assert.equal(h.slotPools.every((p) => p.spent === 0), true);
  assert.equal(h.resources[0].spent, 0);
  assert.equal(h.hitDicePools[0].spent, 2); // вернулась одна кость из трёх (половина, не меньше одной)
});

test('старый лист: ячейки slots тратятся и восстанавливаются', () => {
  const h = structuredClone(seedDB().campaigns['c-crypt'].characters.find((c) => c.id === 'ch-lira'));
  const before = h.slots[1].used;
  applyHeroAction(h, 'useResource', { id: 'legacy-slot-1' });
  assert.equal(h.slots[1].used, before + 1);
  applyHeroAction(h, 'rest', { kind: 'long' });
  assert.equal(h.slots[1].used, 0);
});

test('бросок по формуле', () => {
  assert.deepEqual(rollFormula('2к6+3', seq(0, 0.99)), { total: 1 + 6 + 3, detail: '2к6 [1, 6] +3' });
  assert.equal(rollFormula('+5', () => 0.5).total, 11 + 5);
  assert.equal(rollFormula('бред'), null);
});
