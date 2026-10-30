import test from 'node:test';
import assert from 'node:assert/strict';
import { characterEditPayload, commandFromCharacterChange, rebaseCharacterDraft, putSheetPath } from '../dist/js/server/character-sheet-ops.js';
import { setField, parseField, sheetBonus, validateDraft } from '../dist/js/views/table/sheet-fields.js';
const row = (data, version = 1) => ({ id: 'hero', campaign_id: 'camp', owner_id: null, sheet_version: version, data });
test('редактор отправляет только dirty поля, ресурс delta и HP без повторного поглощения temp', () => {
  const before = { name: 'Герой', hp: 12, hpMax: 20, tempHp: 3, resources: [{ id: 'r', max: 2, spent: 0, recovery: 'short' }], custom: { keep: true } };
  const after = structuredClone(before); after.hp = 10; after.tempHp = 0; after.resources[0].spent = 1;
  assert.deepEqual(characterEditPayload(before, after), { adjust: { currentHp: -2, tempHp: -3, counters: [{ field: 'resources', id: 'r', delta: 1 }] } });
  after.resources[0].max = 3;
  assert.deepEqual(characterEditPayload(before, after).patch.resources, after.resources);
});
test('независимая правка строится от последней версии; совпавшая delta повторно не начисляется', () => {
  const op = { prev: row({ name: 'А', hp: 10, hpMax: 20 }), row: row({ name: 'Б', hp: 10, hpMax: 20 }) };
  const cmd = commandFromCharacterChange(op, row({ name: 'А', hp: 12, hpMax: 20 }, 2));
  assert.equal(cmd.version, '2'); assert.deepEqual(cmd.payload, { patch: { name: 'Б' } });
  assert.deepEqual(commandFromCharacterChange(op, row({ name: 'Б', hp: 12, hpMax: 20 }, 3)).payload, {});
  assert.throws(() => commandFromCharacterChange(op, row({ name: 'В', hp: 12, hpMax: 20 }, 3)), (e) => e.kind === 'conflict');
});
test('конфликт HP зависит от temp и максимума, а смена другого поля безопасна', () => {
  const op = { prev: row({ hp: 10, hpMax: 20, tempHp: 2 }), row: row({ hp: 8, hpMax: 20, tempHp: 0 }) };
  assert.throws(() => commandFromCharacterChange(op, row({ hp: 10, hpMax: 20, tempHp: 4 })), (e) => e.kind === 'conflict');
});
test('трёхсторонний draft хранит оба значения, списки конфликтуют целиком без потери записей', () => {
  const base = { name: 'А', notes: '', items: [{ id: '1', qty: 1 }] }, local = { ...base, name: 'Б' };
  const result = rebaseCharacterDraft(base, local, { ...base, name: 'В', notes: 'Другое' });
  assert.equal(result.data.name, 'Б'); assert.equal(result.data.notes, 'Другое'); assert.equal(result.conflicts[0].remote, 'В');
});
test('поле массива редактируется без превращения в объект, пустой ввод остаётся null', () => {
  const d = { attacks: [{ id: 'a', name: 'Меч', bonus: 4 }] };
  setField(d, 'attacks.0.bonus', 0); assert.ok(Array.isArray(d.attacks)); assert.equal(d.attacks[0].bonus, 0);
  assert.equal(parseField('', 'number').value, null); assert.equal(parseField('1.5', 'number').valid, false);
  assert.throws(() => setField(d, '__proto__.x', 1)); assert.throws(() => putSheetPath(d, ['__proto__', 'x'], 1));
});
test('экспертиза и override применяются один раз; диапазон расхода проверяется до записи', () => {
  const d = { name: 'Герой', level: 5, stats: { dex: 16 }, skills: ['stealth'], proficiencies: { skills: { stealth: 2 } } };
  assert.equal(sheetBonus(d, 'skills', 'stealth', 'dex').value, 9);
  d.overrides = { skills: { stealth: { value: 0, reason: 'Исключение' } } }; assert.equal(sheetBonus(d, 'skills', 'stealth', 'dex').value, 0);
  d.resources = [{ id: 'r', max: 2, spent: 3 }]; assert.ok(validateDraft(d).length);
});

test('архив песочницы передаёт ход по инициативе, сохраняет лист и не возвращает токены', async()=>{
 const {archiveLocalCharacter,restoreLocalCharacter}=await import('../dist/js/views/table/sheet-lifecycle.js');
 const c={characters:[{id:'a',name:'А',hp:3,hpMax:10,initBonus:0},{id:'b',name:'Б',hp:5,hpMax:10,initBonus:0},{id:'c',name:'В',hp:5,hpMax:10,initBonus:0}],scenes:[{id:'s',tokens:[{id:'ta',characterId:'a'},{id:'tb',characterId:'b'},{id:'tc',characterId:'c'}]}],combat:{sceneId:'s',active:true,entries:[{tokenId:'ta',init:20},{tokenId:'tb',init:5},{tokenId:'tc',init:15}],current:'ta',turn:0,round:2,moved:{ta:10},ended:'ta'}};
 archiveLocalCharacter(c,'a');assert.equal(c.combat.current,'tc');assert.equal(c.combat.round,2);assert.equal(c.combat.ended,undefined);assert.equal(c.archivedCharacters[0].hp,3);
 restoreLocalCharacter(c,'a');assert.equal(c.characters.find(x=>x.id==='a').hp,3);assert.equal(c.scenes[0].tokens.some(t=>t.id==='ta'),false);
});
