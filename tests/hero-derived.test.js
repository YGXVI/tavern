// Числа боя героя на правилах 5e (#202, аудит 06.11: R1–R5, R7, R9, R10): лист и стол показывают одно и то же.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indexCreation, newCreation, applyCreationChoice, creationModel, creationDoneModel, creationCharacter } from '../dist/js/views/hero/creation.js';
import { toHeroView } from '../dist/js/views/hero/adapter.js';
import { gearIndex, weaponAttacks } from '../dist/js/views/hero/gear.js';
import { ARMOR_TABLE, heroAc, heroInit } from '../dist/js/rules/hero-derived.js';

globalThis.self ??= {};
globalThis.window ??= { addEventListener() {}, removeEventListener() {} };
const realInterval = globalThis.setInterval;
globalThis.setInterval = () => 0;
const { dmgFormula } = await import('../dist/js/views/hero/sheet.js');
const { tokenStats } = await import('../dist/js/core/campaign.js');
globalThis.setInterval = realInterval;

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const ix = indexCreation({ options: read('dist/js/data/character-options-2014.json'), spells: read('dist/js/data/spells-2014.json'),
  equipment: read('dist/js/data/equipment-2014.json'), features: read('dist/js/data/features-2014.json') }, read('dist/js/data/spells-ref-2014.json'));
const uuid = () => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; };

/** Пройти мастер так, как это делает окно: имена из витрины, а не ID. */
function build(race, cls) {
  const st = newCreation(ix, { campaign: { id: 'c1' }, newId: uuid() });
  const ch = (x) => applyCreationChoice(ix, st, x);
  ch({ step: 'race', id: race }); ch({ step: 'class', id: cls }); ch({ step: 'background', id: 'acolyte' });
  ch({ step: 'abilities', id: 'auto' });
  // «Ещё выбор» расы и класса — первые доступные варианты.
  for (let i = 0; i < 6; i += 1) {
    const box = [...creationModel(ix, st).extra.race, ...creationModel(ix, st).extra.class].find((b) => !/выбрано (\d+) из \1/.test(b.note));
    if (!box) break;
    for (const p of box.list) { const b = [...creationModel(ix, st).extra.race, ...creationModel(ix, st).extra.class].find((x) => x.choiceId === box.choiceId); if (/выбрано (\d+) из \1/.test(b.note)) break; ch({ step: 'class', id: 'extra', value: `${box.choiceId}|${p.value}` }); }
  }
  let m = creationModel(ix, st);
  const skillsLeft = () => creationModel(ix, st).backgroundSkills;
  for (const s of m.backgroundSkills.list.filter((x) => !x.from)) if (!/выбрано (\d+) из \1/.test(skillsLeft().note)) ch({ step: 'background', id: 'skill', value: s.name });
  for (const l of m.backgroundLangs.list.filter((x) => !x.from)) { m = creationModel(ix, st); if (/выбрано (\d+) из \1/.test(m.backgroundLangs.note)) break; ch({ step: 'background', id: 'lang', value: l.name }); }
  m = creationModel(ix, st);
  for (const g of m.equipment.groups) ch({ step: 'equipment', id: 'eq', value: `${g.title}|${g.options[0].name}` });
  ch({ step: 'spells', id: 'auto' });
  ch({ step: 'look', id: 'name', value: 'Тест' });
  return st;
}

const gear = gearIndex(read('dist/js/data/equipment-2014.json'));
const hero = (race, cls, hook) => { const st = build(race, cls); hook?.(st); return { ...creationCharacter(ix, st, { newId: uuid() }).data, id: 'x', ownerId: 'u1' }; };
const view = (h) => toHeroView(h, { userId: 'u1', gear });
const attack = (v, name) => v.actions.action.find((a) => a.name === name);
const STYLE = 'srd51:class:fighter:L1:fighting-style';
const pickStyle = (st, style) => {
  if (st.draft.selections[STYLE] !== `srd51:feature:fighter:${style}`) applyCreationChoice(ix, st, { step: 'class', id: 'extra', value: `${STYLE}|srd51:feature:fighter:${style}` });
};

test('таблица доспехов совпадает с каталогом', () => {
  for (const e of read('dist/js/data/equipment-2014.json').entries.filter((x) => x.kind === 'armor')) {
    assert.deepEqual(ARMOR_TABLE[e.id.split(':').pop()], [e.armor.baseAc, e.armor.addDex, e.armor.dexMax], e.id);
  }
});

test('R1: стол видит те же КД и инициативу, что лист, у всех классов', () => {
  for (const cls of ['barbarian', 'bard', 'cleric', 'druid', 'fighter', 'monk', 'paladin', 'ranger', 'rogue', 'sorcerer', 'warlock', 'wizard']) {
    const h = hero('human', cls), v = view(h);
    assert.equal(heroAc(h), v.vitals.ac.value, cls);
    const st = tokenStats({ characters: [h], members: [] }, { characterId: h.id });
    assert.equal(st.ac, v.vitals.ac.value, `${cls}: КД токена`);
    assert.equal(`+${st.initBonus}`, v.vitals.init, `${cls}: инициатива токена`);
  }
  assert.equal(heroAc({ ac: 15 }), 15, 'записанный КД важнее');
  assert.equal(heroInit({ stats: { dex: 16 } }), 3);
  assert.equal(heroInit({ stats: { dex: 16 }, initBonus: 1 }), 1);
});

test('R2: владение оружием, названным поимённо', () => {
  assert.equal(attack(view(hero('human', 'rogue')), 'Рапира').hit, '+5');
  assert.equal(attack(view(hero('human', 'bard')), 'Рапира').hit, '+4');
  assert.equal(attack(view(hero('human', 'wizard')), 'Боевой посох').hit, '+3');
  assert.equal(attack(view(hero('human', 'sorcerer')), 'Кинжал').hit, '+4');
  assert.equal(attack(view(hero('human', 'druid')), 'Скимитар').hit, '+4');
});

test('R3: драконья стойкость', () => {
  const v = view(hero('human', 'sorcerer'));
  assert.equal(v.vitals.ac.value, 15);
  assert.equal(v.vitals.ac.note, 'Драконья стойкость');
});

test('R4: боевые стили', () => {
  assert.equal(view(hero('human', 'fighter', (st) => pickStyle(st, 'defense'))).vitals.ac.value, 19);
  const archer = view(hero('human', 'fighter', (st) => pickStyle(st, 'archery')));
  assert.equal(attack(archer, 'Лёгкий арбалет').hit, '+6');
  assert.equal(archer.vitals.ac.value, 18);
  const st = build('human', 'fighter'); pickStyle(st, 'defense');
  assert.equal(creationDoneModel(ix, st).facts.find((f) => f.label === 'Класс доспеха').value, '19', 'итог мастера как на листе');
});

test('R5: безоружный удар и боевые искусства', () => {
  const f = attack(view(hero('human', 'fighter')), 'Безоружный удар');
  assert.equal(f.hit, '+5'); assert.equal(f.dmg, '4');
  assert.equal(dmgFormula(f.dmg), '4+0', 'постоянный урон не бросается как к20');
  const v = view(hero('human', 'monk')), m = attack(v, 'Безоружный удар');
  assert.equal(m.hit, '+5'); assert.equal(m.dmg, '1к4+3');
  assert.ok(v.actions.bonus.some((a) => a.name === 'Безоружный удар'), 'бонусное действие монаха');
  assert.equal(attack(v, 'Короткий меч').hit, '+5');
});

test('R7: маленькие расы', () => {
  assert.equal(view(hero('gnome', 'wizard')).vitals.size, 'Маленький');
  assert.equal(view(hero('halfling', 'rogue')).vitals.size, 'Маленький');
  assert.equal(view(hero('dwarf', 'fighter')).vitals.size, 'Средний');
});

test('R9: предел подготовленных; заклинания домена в него не входят', () => {
  assert.deepEqual(view(hero('human', 'wizard')).spellcasting.prepared, { now: 4, max: 4 });
  const h = hero('human', 'cleric');
  assert.deepEqual(view(h).spellcasting.prepared, { now: 4, max: 4 });
  assert.equal(h.knownSpells.filter((s) => s.alwaysPrepared).length, 2);
  assert.equal(h.knownSpells.filter((s) => s.circle > 0).length, 6, 'домен сверх выбранных');
});

test('R10: дротик — лучшее из Силы и Ловкости', () => {
  const list = [{ equipped: true, g: { id: 'd', ru: 'Дротик', en: 'Dart', weapon: { category: 'simple', range: 'ranged', properties: ['finesse', 'thrown'], damage: { dice: '1d4', type: 'piercing' }, normalRange: 20, longRange: 60 } } }];
  assert.equal(weaponAttacks(list, { str: 3, dex: 1 }, 2, 'Оружие: простое')[0].hit, '+5');
});
