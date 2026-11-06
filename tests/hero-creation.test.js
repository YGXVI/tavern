// Мастер создания на настоящем конструкторе (#200/#202, P3): выборы окна → черновик → лист для create_character_sheet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indexCreation, newCreation, applyCreationChoice, creationModel, creationLiveModel, creationDoneModel, creationCharacter } from '../dist/js/views/hero/creation.js';
import { makeCreateRequest } from '../dist/js/server/character-sheet.js';
import { CREATION } from '../dist/js/views/hero/fixture.js';

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

test('витрина мастера той же формы, что образец', () => {
  const st = newCreation(ix, { campaign: { id: 'c1' } });
  const m = creationModel(ix, st);
  for (const k of ['campaign', 'paths', 'steps', 'races', 'classes', 'abilities', 'backgrounds', 'backgroundSkills', 'backgroundLangs', 'equipment', 'spells', 'look', 'done']) assert.ok(k in m, k);
  assert.equal(m.races.length, 9); assert.equal(m.classes.length, 12);
  for (const o of [...m.races, ...m.classes]) assert.match(o.img, /^assets\/hero\/.+\.webp$/);
  for (const k of Object.keys(CREATION.abilities)) assert.ok(k in m.abilities, `abilities.${k}`);
  assert.equal(m.status, 'incomplete');
  assert.equal(creationLiveModel(ix, st).stats.length, 6);
});

test('волшебник, жрец, воин: полный проход даёт лист, который принимает команда создания', () => {
  for (const [race, cls] of [['human', 'wizard'], ['dwarf', 'cleric'], ['half-orc', 'fighter']]) {
    const st = build(race, cls);
    const m = creationModel(ix, st);
    assert.equal(m.status, 'valid', `${race} ${cls}: ${JSON.stringify(m.missing)}`);
    assert.ok(m.done.checks.every((c) => c.ok), `${cls}: проверки`);
    const hero = creationCharacter(ix, st, { newId: uuid() });
    assert.equal(hero.data.creation.verified, 'client');
    assert.equal(hero.data.profile, 'pc');
    assert.ok(Number.isInteger(hero.data.hpMax) && hero.data.hpMax > 0);
    const req = makeCreateRequest({ campaignId: 'c1', characterId: hero.characterId, operationId: hero.operationId, data: hero.data, claim: true });
    assert.equal(req.data.name, 'Тест');
    // Повтор после обрыва: те же ID и те же данные.
    const again = creationCharacter(ix, st, { newId: uuid() });
    assert.equal(again.characterId, hero.characterId); assert.deepEqual(again.data, hero.data);
    assert.equal(creationDoneModel(ix, st).facts[0].value, String(hero.data.hpMax));
  }
});

test('все 9 рас × 12 классов SRD собираются окном до конца', () => {
  const races = ['human', 'dwarf', 'elf', 'halfling', 'dragonborn', 'gnome', 'half-elf', 'half-orc', 'tiefling'];
  const classes = ['barbarian', 'bard', 'cleric', 'druid', 'fighter', 'monk', 'paladin', 'ranger', 'rogue', 'sorcerer', 'warlock', 'wizard'];
  const bad = [];
  for (const r of races) for (const c of classes) { const m = creationModel(ix, build(r, c)); if (m.status !== 'valid') bad.push(`${r} ${c}: ${m.missing.map((x) => x.message).join(' ')}`); }
  assert.deepEqual(bad, []);
});

test('стандартный набор: стрелки меняют значения местами, лишний навык не берётся', () => {
  const st = newCreation(ix, { campaign: { id: 'c1' } });
  applyCreationChoice(ix, st, { step: 'class', id: 'wizard' });
  applyCreationChoice(ix, st, { step: 'abilities', id: 'auto' });
  assert.equal(st.draft.baseScores.int, 15);
  applyCreationChoice(ix, st, { step: 'abilities', id: 'abDec', value: 'int' });
  assert.equal(st.draft.baseScores.int, 14);
  assert.equal(Object.values(st.draft.baseScores).filter((v) => v === 15).length, 1, '15 перешло к другой характеристике');
  const m = creationModel(ix, st);
  const free = m.backgroundSkills.list.filter((x) => !x.from).map((x) => x.name);
  applyCreationChoice(ix, st, { step: 'background', id: 'skill', value: free[0] });
  applyCreationChoice(ix, st, { step: 'background', id: 'skill', value: free[1] });
  assert.match(applyCreationChoice(ix, st, { step: 'background', id: 'skill', value: free[2] }).title, /достаточно/);
  applyCreationChoice(ix, st, { step: 'background', id: 'skill', value: free[0] }); // снять
  assert.match(creationModel(ix, st).backgroundSkills.note, /выбрано 1 из 2/);
});

test('смена класса сбрасывает выборы прежнего класса и ID отправки', () => {
  const st = build('human', 'wizard');
  creationCharacter(ix, st, { newId: uuid() });
  assert.ok(st.characterId);
  applyCreationChoice(ix, st, { step: 'class', id: 'fighter' });
  assert.equal(st.characterId, null);
  assert.equal(creationModel(ix, st).status, 'incomplete');
});

test('черты с шага «Образ» попадают в личность героя, пустые не пишутся', () => {
  const st = build('human', 'wizard');
  applyCreationChoice(ix, st, { step: 'look', id: 'traits', value: ' Шутит не к месту ' });
  applyCreationChoice(ix, st, { step: 'look', id: 'ideals', value: '' });
  assert.deepEqual(creationCharacter(ix, st, { newId: uuid() }).data.personality, { traits: 'Шутит не к месту' });
  assert.equal(creationCharacter(ix, build('human', 'wizard'), { newId: uuid() }).data.personality, undefined);
  const first = creationCharacter(ix, st, { newId: () => '10000000-0000-4000-8000-000000000001' });
  assert.equal(creationCharacter(ix, st).operationId, first.operationId, 'без правок — тот же запрос');
  applyCreationChoice(ix, st, { step: 'look', id: 'flaws', value: 'Боится воды' });
  assert.notEqual(creationCharacter(ix, st).operationId, first.operationId, 'образ изменился — новый запрос');
});

test('характеристики: герою без кампании открыта покупка очков, набор выбирается числом из списка (#203)', () => {
  // Кампания по умолчанию — только стандартный набор (D3); герой «Моих героев» — оба способа.
  const camp = newCreation(ix, { campaign: { id: 'c1' }, newId: uuid() });
  assert.deepEqual(camp.context.allowedAbilityMethods, ['standard_array']);
  assert.ok(applyCreationChoice(ix, camp, { step: 'abilities', id: 'abMode', value: 'buy' }), 'в кампании покупка закрыта');
  const st = newCreation(ix, { campaign: null, newId: uuid() });
  assert.equal(st.draft.abilityMethod, 'standard_array', 'по умолчанию — набор');
  assert.ok(creationModel(ix, st).abilities.modes.find((m) => m.id === 'buy').disabled === false);
  const ch = (x) => applyCreationChoice(ix, st, x);
  ch({ step: 'class', id: 'fighter' });
  // Покупка: все восьмёрки, 27 очков; «+» гаснет, когда очков не хватает.
  assert.equal(ch({ step: 'abilities', id: 'abMode', value: 'buy' }), null);
  assert.deepEqual(Object.values(st.draft.baseScores), [8, 8, 8, 8, 8, 8]);
  for (let i = 0; i < 7; i += 1) ch({ step: 'abilities', id: 'abInc', value: 'str' });
  for (let i = 0; i < 7; i += 1) ch({ step: 'abilities', id: 'abInc', value: 'con' });
  let ab = creationModel(ix, st).abilities;
  assert.equal(st.draft.baseScores.str, 15);
  assert.equal(ab.budget.left, 9);
  assert.equal(ab.list.find((a) => a.key === 'str').canUp, false, '15 — потолок покупки');
  for (let i = 0; i < 5; i += 1) ch({ step: 'abilities', id: 'abInc', value: 'dex' }); // 13: ещё 5 очков
  for (let i = 0; i < 3; i += 1) ch({ step: 'abilities', id: 'abInc', value: 'wis' }); // 11: ещё 3
  ab = creationModel(ix, st).abilities;
  assert.equal(ab.budget.left, 1);
  assert.equal(ab.list.find((a) => a.key === 'dex').canUp, false, 'следующая единица дороже остатка');
  assert.equal(creationModel(ix, st).done.checks.find((c) => c.step === 'abilities').ok, true);
  // Набор: число в характеристику; занятое меняется местами, пустое место уступает число.
  ch({ step: 'abilities', id: 'abMode', value: 'array' });
  assert.deepEqual(Object.values(st.draft.baseScores), [null, null, null, null, null, null]);
  ch({ step: 'abilities', id: 'abSet', value: 'str|15' });
  ch({ step: 'abilities', id: 'abSet', value: 'dex|14' });
  const swap = ch({ step: 'abilities', id: 'abSet', value: 'str|14' });
  assert.equal(swap.title, 'Поменялись местами');
  assert.deepEqual([st.draft.baseScores.str, st.draft.baseScores.dex], [14, 15]);
  const took = ch({ step: 'abilities', id: 'abSet', value: 'con|15' });
  assert.match(took.body, /Ловкость/);
  assert.deepEqual([st.draft.baseScores.dex, st.draft.baseScores.con], [null, 15]);
  ch({ step: 'abilities', id: 'abSet', value: 'con|' });
  assert.equal(st.draft.baseScores.con, null, 'можно снять число');
  assert.equal(ch({ step: 'abilities', id: 'abSet', value: 'int|17' }), null);
  assert.equal(st.draft.baseScores.int, null, 'числа не из набора не ставятся');
});
