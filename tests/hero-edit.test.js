// Правка героя (#203): черновик и операции экрана edit.js → изменённые поля листа; лист после правки считает те же числа.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.self ??= {};
const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const { startEdit, editOp, finishEdit, applyEdit, changedSections, profLevel, initManual, SERVER_EDITABLE } = await import('../dist/js/views/hero/edit-model.js');
const { toHeroView, spellIndex } = await import('../dist/js/views/hero/adapter.js');
const { gearIndex } = await import('../dist/js/views/hero/gear.js');
const { seedDB } = await import('../dist/js/data/demo.js');

const gear = gearIndex(read('dist/js/data/equipment-2014.json'));
const spells = spellIndex({ spells: read('dist/js/data/spells-2014.json'), ref: read('dist/js/data/spells-ref-2014.json') });
const fx = read('supabase/tests/character_create_fixtures.json');
const hero = (name) => ({ ...structuredClone(fx.find((f) => f.name === name).data), id: name, ownerId: 'u1' });
const view = (ch) => toHeroView(ch, { userId: 'u1', gear, spells });
const edit = (ch) => { const s = startEdit(ch); return { ...s, op: (name, p) => editOp(s.draft, name, p, { gear }) }; };
const save = (ch, s, opts) => { const r = finishEdit(s.base, s.draft, opts); assert.ok(!r.error, r.error); return { r, ch: applyEdit(structuredClone(ch), r.patch) }; };

test('имя, характеристики и навыки: сохраняются только изменённые поля, лист считает новые числа', () => {
  const ch = hero('fighter1'), s = edit(ch);
  assert.ok(!('id' in s.draft) && !('ownerId' in s.draft), 'служебные поля не правятся');
  s.op('set', { path: 'name', value: '  Гром  ' });
  s.op('step', { id: 'dex', by: 2 });                       // 15 → 17: Ловкость +3, инициатива по Ловкости
  s.op('prof', { kind: 'skills', id: 'stealth' });           // нет → владение
  s.op('prof', { kind: 'skills', id: 'insight' });           // владение → компетентность
  s.op('prof', { kind: 'saves', id: 'str' });                // спасбросок СИЛ: снять
  assert.deepEqual(changedSections(s.base, s.draft).sort(), ['combat', 'skills', 'stats', 'who'].sort());
  const { r, ch: after } = save(ch, s);
  assert.deepEqual(r.changed.sort(), ['initBonus', 'name', 'overrides', 'proficiencies', 'stats'].sort());
  assert.equal(after.name, 'Гром');
  assert.equal(after.proficiencies.skills.insight, 2);
  assert.equal(after.proficiencies.skills.stealth, 1);
  assert.equal(after.proficiencies.saves.str, undefined);
  assert.equal(after.proficiencies.languages, ch.proficiencies.languages, 'языки не тронуты');
  const v = view(after);
  assert.equal(v.vitals.init, '+3');
  assert.equal(v.abilities.find((a) => a.key === 'str').saveProf, false);
  assert.equal(v.skills.find((k) => k.name === 'Проницательность').prof, 'expert');
});

test('навык по кругу: владение → компетентность → нет; старый список навыков листа обновляется', () => {
  const ch = { name: 'Старый', stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, skills: ['athletics'], saves: ['str'] }, s = edit(ch);
  s.op('prof', { kind: 'skills', id: 'athletics' });
  assert.equal(profLevel(s.draft, 'skills', 'athletics'), 2);
  s.op('prof', { kind: 'skills', id: 'athletics' });
  assert.equal(profLevel(s.draft, 'skills', 'athletics'), 0);
  assert.deepEqual(s.draft.skills, []);
  s.op('prof', { kind: 'saves', id: 'dex' });
  assert.deepEqual(s.draft.saves, ['str', 'dex']);
});

test('класс и уровень: уровень и кости хитов из классов, мультикласс, хиты не выше максимума', () => {
  const ch = hero('fighter1'), s = edit(ch);
  s.op('class', { i: 0, field: 'levels', value: 3 });
  s.op('class', { i: 0, field: 'subclass', value: 'Чемпион' });
  s.op('addClass');
  s.op('class', { i: 1, field: 'name', value: 'wizard' });
  s.op('class', { i: 1, field: 'levels', value: 2 });
  s.op('set', { path: 'hpMax', value: '9' });
  const { ch: after } = save(ch, s);
  assert.equal(after.level, 5);
  assert.equal(after.className, 'Воин');
  assert.equal(after.classId, 'fighter');
  assert.deepEqual(after.classes.map((c) => [c.name, c.levels, c.ref]), [['Воин', 3, 'srd51:class:fighter'], ['Волшебник', 2, 'srd51:class:wizard']]);
  assert.deepEqual(after.hitDicePools.map((p) => [p.die, p.total]), [[10, 3], [6, 2]]);
  assert.equal(after.hitDicePools[0].id, ch.hitDicePools[0].id, 'пул первого класса тот же');
  assert.equal(after.hpMax, 9);
  assert.equal(after.hp, 9, 'хиты не выше максимума');
  const v = view(after);
  assert.match(v.summary, /Воин 3 \/ Волшебник 2/);
  // Убрать класс можно, но не последний.
  const s2 = edit(after); s2.op('dropClass', { i: 1 }); s2.op('dropClass', { i: 0 });
  assert.equal(s2.draft.classes.length, 1);
});

test('КД и инициатива: вручную и обратно по снаряжению / Ловкости', () => {
  const ch = hero('fighter1'), s = edit(ch);
  const auto = view(ch).vitals.ac.value;
  s.op('acMode', { manual: true, value: 21 });
  s.op('initMode', { manual: true });
  s.op('initValue', { value: '+7' });
  let { ch: after } = save(ch, s);
  assert.equal(view(after).vitals.ac.value, 21);
  assert.equal(view(after).vitals.init, '+7');
  assert.ok(initManual(after));
  const s2 = edit(after);
  s2.op('acMode', { manual: false });
  s2.op('initMode', { manual: false });
  ({ ch: after } = save(after, s2));
  assert.equal(view(after).vitals.ac.value, auto);
  assert.equal(view(after).vitals.init, '+2');
  // Включили «вручную» и выключили, ничего не сохранив, — это не правка.
  const s3 = edit(ch); s3.op('acMode', { manual: true, value: 12 }); s3.op('acMode', { manual: false });
  assert.deepEqual(finishEdit(s3.base, s3.draft).changed, []);
});

test('своя атака не прячет оружие героя из конструктора и считает бонус по характеристике', () => {
  const ch = hero('fighter1'), s = edit(ch);
  s.op('add', { list: 'attacks' });
  const id = s.draft.attacks[0].id;
  s.op('item', { list: 'attacks', id, field: 'name', value: 'Удар щитом' });
  s.op('item', { list: 'attacks', id, field: 'damage', value: '1к4+3' });
  const { ch: after } = save(ch, s);
  const rows = view(after).actions.action;
  const own = rows.find((a) => a.name === 'Удар щитом');
  assert.equal(own.hit, '+5', 'СИЛ +3 и мастерство +2');
  assert.ok(rows.some((a) => a.name === 'Боевой топор'), 'атака оружием осталась');
  // Атака с именем оружия заменяет его строку.
  const s2 = edit(after); s2.op('item', { list: 'attacks', id, field: 'name', value: 'Боевой топор' }); s2.op('item', { list: 'attacks', id, field: 'bonus', value: '9' });
  const rows2 = view(save(after, s2).ch).actions.action.filter((a) => a.name === 'Боевой топор');
  assert.deepEqual(rows2.map((a) => a.hit), ['+9']);
});

test('сумка: надеть и снять начинается со стартового комплекта, новый предмет — списком', () => {
  const ch = hero('fighter1'), s = edit(ch);
  const mail = s.draft.inventoryItems.find((x) => x.ref === 'srd51:equipment:chain-mail');
  s.op('equip', { id: mail.id });                        // кольчуга была надета по умолчанию — теперь снята
  assert.equal(s.draft.inventoryItems.find((x) => x.id === mail.id).equipped, false);
  assert.ok(s.draft.inventoryItems.some((x) => x.equipped), 'остальной комплект записан надетым');
  s.op('add', { list: 'inventoryItems' });
  const it = s.draft.inventoryItems.at(-1);
  s.op('item', { list: 'inventoryItems', id: it.id, field: 'name', value: 'Фляга с элем' });
  s.op('item', { list: 'inventoryItems', id: it.id, field: 'quantity', value: '2' });
  s.op('set', { path: 'coins.gp', value: '40' });
  const { ch: after } = save(ch, s);
  const v = view(after);
  assert.ok(v.vitals.ac.value < view(ch).vitals.ac.value, 'без кольчуги КД ниже');
  assert.ok(v.inventory.pack.some((x) => x.name === 'Фляга с элем' && x.qty === 2));
  assert.equal(v.inventory.coins.gp, 40);
});

test('старый лист: сумка и умения строкой становятся списком при первой правке, монеты — отдельно', () => {
  const db = seedDB();
  const ch = structuredClone(db.campaigns['c-crypt'].characters.find((x) => x.name === 'Торин'));
  ch.inventory = 'Кольчуга, щит, боевой топор, 23 зм';
  const s = edit(ch);
  s.op('add', { list: 'inventoryItems' });
  const names = s.draft.inventoryItems.map((x) => x.name);
  assert.deepEqual(names.slice(0, 3), ['Кольчуга', 'Щит', 'Боевой топор']);
  assert.equal(s.draft.coins.gp, 23);
  assert.equal(s.draft.inventory, ch.inventory, 'старая строка не тронута');
  assert.ok(s.draft.inventoryItems.every((x) => x.id && !x.id.startsWith('legacy-')));
});

test('сервер: черты характера не уходят командой edit, остальное уходит; пустое имя не сохраняется', () => {
  const ch = hero('fighter1'), s = edit(ch);
  s.op('set', { path: 'personality.traits', value: 'Шутит не к месту' });
  s.op('set', { path: 'notes', value: 'Должен гному' });
  const srv = finishEdit(s.base, s.draft, { server: true });
  assert.deepEqual(srv.changed, ['notes']);
  assert.deepEqual(srv.dropped, ['personality']);
  assert.ok(srv.changed.every((k) => SERVER_EDITABLE.has(k)));
  assert.deepEqual(finishEdit(s.base, s.draft).changed.sort(), ['notes', 'personality']);
  s.op('set', { path: 'name', value: '   ' });
  assert.ok(finishEdit(s.base, s.draft).error);
});

test('ячейки любому герою: круг добавляется и убирается; странные пути не пишутся', () => {
  const ch = hero('fighter1'), s = edit(ch);
  s.op('slots', { circle: 1, value: '2' });
  assert.deepEqual(s.draft.slotPools.map((p) => [p.circle, p.max, p.spent]), [[1, 2, 0]]);
  s.op('slots', { circle: 1, value: '0' });
  assert.deepEqual(s.draft.slotPools, []);
  s.op('set', { path: '__proto__.polluted', value: 'x' });
  s.op('set', { path: 'id', value: 'чужой' });
  s.op('set', { path: 'stats.str', value: '99' });
  assert.equal(({}).polluted, undefined);
  assert.equal(s.draft.id, undefined);
  assert.equal(s.draft.stats.str, 30, 'характеристика не выше 30');
});
