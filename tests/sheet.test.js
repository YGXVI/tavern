import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDB } from '../dist/js/data/demo.js';
import { readLegacyCharacter } from '../dist/js/views/table/sheet-model.js';
import { abilityModifier, parseSheetNumber, totalClassLevel, sheetProficiency, checkBonus, passiveCheck, spellNumbers, partyLevelHint } from '../dist/js/views/table/sheet-rules.js';
import { previewRest } from '../dist/js/views/table/sheet-rest.js';
import { previewSidekickGrowth } from '../dist/js/views/table/sheet-growth.js';

test('адаптер читает фактических демо-героев без мутации и сброса ресурсов', () => {
  const db = seedDB();
  for (const campaign of Object.values(db.campaigns)) for (const character of campaign.characters) {
    const original = structuredClone(character);
    const view = readLegacyCharacter(character);
    assert.deepEqual(view.source, original);
    assert.equal(view.hp.current, character.hp);
    assert.equal(view.hp.temp, character.tempHp);
    assert.equal(view.spells.legacyText, character.spells);
    for (const pool of view.slotPools) assert.equal(pool.spent, character.slots[pool.circle].used);
    assert.deepEqual(character, original);
  }
});

test('старый лист: неизвестные ключи, нули и свободный текст сохраняются отдельно от view', () => {
  const character = {
    id: 'old', level: 5, classId: 'wizard', stats: { str: 0, int: 16 }, hp: 0, hpMax: 22, tempHp: 0,
    hitDice: '5к6', conditions: ['unconscious'], deathSaves: { s: 2, f: 1 },
    slots: { 1: { max: 4, used: 3 } }, spells: 'Не удалять', inventory: 'Свиток', features: 'Своя способность',
    unknown: { keep: [1, { custom: true }] },
  };
  const view = readLegacyCharacter(character);
  assert.equal(view.hp.current, 0);
  assert.equal(view.saves.str.value, -5);
  assert.equal(view.saves.dex.value, null);
  assert.equal(view.hitDice[0].spent, null);
  assert.equal(view.slotPools[0].recovery, 'manual');
  assert.deepEqual(view.deathSaves, { successes: 2, failures: 1 });
  assert.equal(view.inventory.legacyText, 'Свиток');
  assert.equal(view.features.legacyText, 'Своя способность');
  view.source.unknown.keep[1].custom = false;
  view.conditions.push('prone');
  assert.equal(character.unknown.keep[1].custom, true);
  assert.deepEqual(character.conditions, ['unconscious']);
});

test('неполный лист не получает выдуманные 10 HP, характеристики или нулевой расход', () => {
  const view = readLegacyCharacter({ id: 'incomplete', notes: 'Описание' });
  assert.deepEqual(view.hp, { current: null, max: null, temp: null });
  assert.equal(view.abilities.str, null);
  assert.equal(view.initiative, null);
  assert.deepEqual(view.classes, []);
  assert.deepEqual(view.hitDice, []);
});

test('числовой ввод различает пустое значение, ноль и ошибку без coercion', () => {
  assert.deepEqual(parseSheetNumber(''), { valid: true, value: null });
  assert.deepEqual(parseSheetNumber(' 0 '), { valid: true, value: 0 });
  assert.deepEqual(parseSheetNumber('−2'), { valid: true, value: -2 });
  for (const input of ['1.5', '0x10', '1e3', 'Infinity', '2+3', 'NaN', null, true, {}]) assert.equal(parseSheetNumber(input).valid, false);
  assert.equal(parseSheetNumber('', { nullable: false }).valid, false);
  assert.equal(parseSheetNumber('4', { min: 0, max: 3 }).valid, false);
  assert.equal(parseSheetNumber('9007199254740992').valid, false);
  assert.deepEqual(parseSheetNumber('15.5', { integer: false, min: 0 }), { valid: true, value: 15.5 });
  assert.equal(readLegacyCharacter({ speed: 15.5 }).movement.walk, 15.5);
});

test('воин 5: владение, экспертиза, половина PB, passive и нулевой override', () => {
  const proficiency = sheetProficiency(5);
  assert.equal(checkBonus({ score: 16, proficiency, multiplier: 0 }).value, 3);
  assert.equal(checkBonus({ score: 16, proficiency, multiplier: 1 }).value, 6);
  assert.equal(checkBonus({ score: 16, proficiency, multiplier: 2 }).value, 9);
  assert.equal(checkBonus({ score: 16, proficiency, multiplier: 0.5 }).value, 4);
  const overridden = checkBonus({ score: 16, proficiency, multiplier: 1, override: { value: 0, reason: 'Ручное исключение' } });
  assert.equal(overridden.value, 0);
  assert.equal(overridden.calculated, 6);
  assert.equal(overridden.overridden, true);
  assert.equal(passiveCheck(6).value, 16);
  assert.equal(abilityModifier(null), null);
  assert.equal(abilityModifier('16'), null);
  assert.equal(abilityModifier(0), -5);
  assert.equal(checkBonus({ score: null, proficiency, multiplier: 1 }).value, null);
  assert.equal(checkBonus({ score: 16, proficiency: null, multiplier: 0 }).value, 3);
  assert.equal(checkBonus({ score: 16, proficiency, adjustments: [null] }).value, null);
  assert.equal(checkBonus({ score: 16, proficiency: Number.MAX_SAFE_INTEGER, multiplier: 2 }).value, null);
  assert.equal(abilityModifier(-Number.MAX_SAFE_INTEGER), null);
});

test('мультикласс и магия: PB по сумме, DC по выбранному источнику', () => {
  const level = totalClassLevel([{ classId: 'fighter', levels: 1 }, { classId: 'wizard', levels: 4 }]);
  assert.equal(level, 5);
  const proficiency = sheetProficiency(level);
  const wizard = spellNumbers({ score: 16, proficiency });
  const other = spellNumbers({ score: 12, proficiency });
  assert.equal(wizard.attack.value, 6);
  assert.equal(wizard.dc.value, 14);
  assert.equal(other.dc.value, 12);
  assert.equal(totalClassLevel([{ levels: 1 }, { levels: null }]), null);
  assert.equal(sheetProficiency(21), null);
  assert.equal(spellNumbers({ score: null, proficiency }).dc.value, null);
});

test('среднее учитывает только выбранных героев и не округляет дробь', () => {
  const party = [{ id: 'a', level: 4 }, { id: 'b', level: 5 }, { id: 'same-owner', level: 20 }, { id: 'sk', profile: 'sidekick', level: 4 }];
  const original = structuredClone(party);
  assert.equal(partyLevelHint(party, ['a', 'b', 'a']).average, 4.5);
  assert.equal(partyLevelHint(party, []).average, null);
  assert.deepEqual(partyLevelHint(party, ['missing']).missingIds, ['missing']);
  assert.deepEqual(partyLevelHint(party, ['sk']).invalidIds, ['sk']);
  assert.equal(partyLevelHint([{ id: 'a', level: 4 }, { id: 'a', level: 5 }], ['a']).average, null);
  assert.deepEqual(party, original);
});

const restedSheet = () => ({
  abilities: { con: 14 }, hp: { current: 10, max: 30, temp: 5 },
  hitDice: [{ id: 'fighter', die: 10, total: 1, spent: 1 }, { id: 'wizard', die: 6, total: 4, spent: 2 }],
  slotPools: [
    { id: 'spellcasting-1', max: 4, spent: 3, recovery: 'long' },
    { id: 'pact', max: 2, spent: 1, recovery: 'both' },
  ],
  resources: [{ id: 'unknown', max: 3, spent: 2, recovery: 'manual' }],
  conditions: ['poisoned'],
});

test('короткий отдых расходует только выбранные кости и не восстанавливает обычные ячейки', () => {
  const sheet = restedSheet(), original = structuredClone(sheet);
  const preview = previewRest(sheet, { kind: 'short', eligible: true, hitDieRolls: [{ poolId: 'wizard', roll: 4 }] });
  assert.deepEqual(preview.errors, []);
  assert.ok(preview.changes.some((c) => c.target.field === 'current' && c.to === 16));
  assert.ok(preview.changes.some((c) => c.target.id === 'wizard' && c.to === 3));
  assert.ok(preview.changes.some((c) => c.target.id === 'pact' && c.to === 0));
  assert.ok(!preview.changes.some((c) => c.target.id === 'spellcasting-1'));
  assert.ok(preview.manual.some((c) => c.target.id === 'unknown'));
  assert.deepEqual(sheet, original);
});

test('продолжительный отдых возвращает две из пяти костей и не снимает неизвестные состояния/temp HP', () => {
  const sheet = restedSheet(), original = structuredClone(sheet);
  const preview = previewRest(sheet, { kind: 'long', eligible: true, recoverDice: { fighter: 1, wizard: 1 } });
  assert.deepEqual(preview.errors, []);
  assert.ok(preview.changes.some((c) => c.target.field === 'current' && c.to === 30));
  assert.ok(preview.changes.some((c) => c.target.id === 'fighter' && c.from === 1 && c.to === 0));
  assert.ok(preview.changes.some((c) => c.target.id === 'wizard' && c.from === 2 && c.to === 1));
  assert.ok(preview.changes.some((c) => c.target.id === 'spellcasting-1' && c.to === 0));
  assert.ok(preview.manual.some((c) => c.target.field === 'temp'));
  assert.ok(!preview.changes.some((c) => c.target.section === 'conditions'));
  assert.deepEqual(sheet, original);
  assert.deepEqual(previewRest(sheet, { kind: 'long', eligible: true, recoverDice: { fighter: 1, wizard: 2 } }).changes, []);
});

test('предпросмотр отдыха не выдаёт частичный результат при неверном расходе или неподтверждённых условиях', () => {
  const sheet = restedSheet();
  assert.deepEqual(previewRest(sheet, { kind: 'long' }).changes, []);
  const bad = previewRest(sheet, { kind: 'short', eligible: true, hitDieRolls: [{ poolId: 'fighter', roll: 8 }] });
  assert.ok(bad.errors.length);
  assert.deepEqual(bad.changes, []);
  const unknown = readLegacyCharacter({ hp: 4, hpMax: 10, hitDice: '5к6', stats: { con: 14 } });
  assert.ok(previewRest(unknown, { kind: 'long', eligible: true }).manual.some((c) => c.target.section === 'hitDice'));
});

test('один оставшийся тип костей выбирается автоматически, несколько требуют выбора', () => {
  const sheet = restedSheet();
  assert.ok(previewRest(sheet, { kind: 'long', eligible: true }).manual.some((c) => c.target.section === 'hitDice'));
  sheet.hitDice[0].spent = 0;
  const preview = previewRest(sheet, { kind: 'long', eligible: true });
  assert.ok(preview.changes.some((c) => c.target.id === 'wizard' && c.to === 0));
  sheet.hp.tempExpiresOnLongRest = true;
  assert.ok(previewRest(sheet, { kind: 'long', eligible: true }).changes.some((c) => c.target.field === 'temp' && c.to === 0));
});

test('неизвестный ID или расход костей не даёт частично применимого отдыха', () => {
  const sheet = restedSheet();
  for (const recoverDice of [{ missing: 1 }, { fighter: -1 }, { fighter: 2 }, []]) {
    const preview = previewRest(sheet, { kind: 'long', eligible: true, recoverDice });
    assert.ok(preview.errors.length);
    assert.deepEqual(preview.changes, []);
  }
  sheet.hitDice[0].spent = null;
  assert.ok(previewRest(sheet, { kind: 'long', eligible: true, recoverDice: { fighter: 1 } }).errors.length);
  sheet.hitDice = [];
  assert.ok(previewRest(sheet, { kind: 'long', eligible: true, recoverDice: { fighter: 1 } }).errors.length);
});

test('Sidekick 4 → 5: подтверждаемый HP/PB, без лечения и выдуманных зависимостей', () => {
  const input = { level: 4, targetLevel: 5, hpMax: 25, constitution: 12, hitDie: 8, rolls: [5], proficiencyLinks: [
    { id: 'bite', value: 4, dependsOnProficiency: true }, { id: 'unknown', value: 5 },
  ] };
  const original = structuredClone(input);
  const preview = previewSidekickGrowth(input);
  assert.deepEqual(preview.errors, []);
  assert.ok(preview.changes.some((c) => c.field === 'hpMax' && c.to === 31));
  assert.ok(preview.changes.some((c) => c.field === 'proficiency' && c.from === 2 && c.to === 3));
  assert.ok(preview.changes.some((c) => c.id === 'bite' && c.to === 5));
  assert.ok(!preview.changes.some((c) => c.field === 'hp' || c.id === 'unknown'));
  assert.ok(preview.manual.some((c) => c.id === 'unknown'));
  assert.deepEqual(input, original);
  assert.deepEqual(previewSidekickGrowth(input), preview);
});

test('Sidekick требует результата каждого уровня, не выполняет снижение и не принимает произвольные формулы', () => {
  const input = { level: 4, targetLevel: 6, hpMax: 25, constitution: 12, hitDie: 8, rolls: [5] };
  assert.ok(previewSidekickGrowth(input).errors.length);
  assert.deepEqual(previewSidekickGrowth(input).changes, []);
  assert.ok(previewSidekickGrowth({ ...input, targetLevel: 3, rolls: [] }).errors.length);
  assert.ok(previewSidekickGrowth({ ...input, rolls: ['1d8+1', 3] }).errors.length);
  const minimum = previewSidekickGrowth({ ...input, targetLevel: 5, constitution: 1, rolls: [1] });
  assert.ok(minimum.changes.some((c) => c.field === 'hpMax' && c.to === 26));
});

test('рост Sidekick сохраняет override и различает владение/экспертизу/половину PB', () => {
  const preview = previewSidekickGrowth({ level: 4, targetLevel: 5, hpMax: 25, constitution: 12, hitDie: 8, rolls: [5], proficiencyLinks: [
    { id: 'expertise', value: 7, multiplier: 2, dependsOnProficiency: true },
    { id: 'half', value: 2, multiplier: 0.5, dependsOnProficiency: true },
    { id: 'manual', value: 0, dependsOnProficiency: true, overridden: true },
  ] });
  assert.deepEqual(preview.errors, []);
  assert.ok(preview.changes.some((c) => c.id === 'expertise' && c.to === 9));
  assert.ok(!preview.changes.some((c) => c.id === 'half' || c.id === 'manual'));
  assert.ok(preview.manual.some((c) => c.id === 'manual'));
});

test('структурированный лист читается без перезаписи старого текста и неизвестных полей', async () => {
  const { readCharacter }=await import('../dist/js/views/table/sheet-model.js');
  const ch={id:'new',level:1,name:'Мультикласс',stats:{int:16,dex:14},classes:[{id:'f',name:'Воин',levels:1},{id:'w',name:'Волшебник',levels:4}],hitDicePools:[{id:'f',die:10,total:1,spent:0},{id:'w',die:6,total:4,spent:2}],slotPools:[{id:'pact',max:2,spent:1,recovery:'short'}],inventory:'Старая запись',inventoryItems:[{id:'a',name:'Свой предмет'}],skills:['arcana'],proficiencies:{skills:{arcana:2}},custom:{keep:true}};
  const original=structuredClone(ch),view=readCharacter(ch);assert.equal(view.level,5);assert.equal(view.proficiency,3);assert.equal(view.skills.arcana.value,9);assert.equal(view.inventory.legacyText,'Старая запись');assert.equal(view.inventory.entries[0].name,'Свой предмет');assert.equal(view.hitDice[1].spent,2);assert.deepEqual(ch,original);
});
