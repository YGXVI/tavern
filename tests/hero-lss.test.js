// Перенос героя из Long Story Short (#203): разбор по форме настоящих выгрузок с сайта и конвертера Foundry → LSS.
// Образцы — tests/fixtures/lss (содержимое выдуманное, форма — как в настоящих файлах, README там же).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.self ??= {};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const json = (p) => JSON.parse(read(p));
const { parseLss, lssText, lssEntries, lssParas } = await import('../dist/js/views/hero/lss.js');
const { toHeroView, spellIndex } = await import('../dist/js/views/hero/adapter.js');
const { gearIndex } = await import('../dist/js/views/hero/gear.js');
const gear = gearIndex(json('dist/js/data/equipment-2014.json'));
const spells = spellIndex({ spells: json('dist/js/data/spells-2014.json'), ref: json('dist/js/data/spells-ref-2014.json'), srd: json('dist/js/data/spells-srd-2014.json') });
const parse = (name) => parseLss(read(`tests/fixtures/lss/${name}`), { fileName: name, spellNames: spells.byName, gear });
const view = (h) => toHeroView({ ...h, id: 'x', ownerId: 'u1' }, { userId: 'u1', gear, spells });
const issue = (r, re) => r.issues.find((i) => re.test(`${i.title} ${i.text}`));

test('воин с сайта: подкласс, атака с [STR] и поправкой, вещи из блока «Атаки», настройка, черты, карточки, общий счёт', () => {
  const r = parse('knight-site-export.json'), h = r.hero;
  assert.equal(h.classes[0].subclass, 'Рыцарь Эха');
  assert.deepEqual([h.attacks[0].bonus, h.attacks[0].damage], [8, '1d10+5'], 'СИЛ +4, мастерство +3, bonuses +1; [STR] — модификатором');
  assert.equal(h.stats.int, 19, 'Повязка интеллекта задаёт 19');
  assert.ok(issue(r, /Интеллект 19.*Без неё 9/));
  const items = h.inventoryItems.map((x) => x.name);
  assert.ok(items.includes('Рационы на 5 дней') && items.includes('Карта старого тракта'), 'строки «Атак» без бонуса и кости — в сумку');
  assert.ok(h.inventoryItems.find((x) => x.name === 'Зелье лечения').quantity === 2);
  assert.ok(h.inventoryItems.find((x) => x.name === 'Плащ защиты').attuned, 'attunementsList — настроенные предметы');
  assert.ok(h.featureEntries.some((f) => f.name === 'Мастер древкового оружия' && f.source === 'Черта'));
  assert.ok(h.featureEntries.some((f) => f.name === 'Боевой стиль' && f.description === 'Защита'));
  assert.ok(h.featureEntries.find((f) => f.name === 'Шёпот эха').description.includes('2 - вы оглохли'), 'строки таблицы — в умение');
  assert.ok(issue(r, /6 заклинаний карточками/), 'уникальные номера по prepared и granted');
  assert.equal(h.coins.gp, 640); assert.ok(issue(r, /общим счётом/));
  for (const n of ['Заметка первой страницы', 'Заметка второй страницы', 'Заметка пятой страницы', 'Найти пропавшего брата', 'Орден Серебряного щита']) assert.ok(h.notes.includes(n), n);
  assert.equal(h.proficiencies.languages, 'Общий, Дварфийский');
  assert.match(h.proficiencies.tools, /^Доспехи: .*Тяжёлые доспехи, Щиты\nОружие: Простое оружие, Воинское оружие/);
  assert.ok(!h.featureEntries.some((f) => f.name === 'Сопротивления'), '«Сопротивление к: Нет» не переносим');
  assert.equal(r.matched.of - r.matched.ok, 2, 'магия и деньги — с замечаниями');
  assert.ok(r.avatar);
  const v = view(h);
  assert.equal(v.actions.action.find((a) => a.name === 'Алебарда').hit, '+8');
  assert.ok(v.proficiencies.armor.heavy && v.proficiencies.weapons.martial);
});

test('чародей с сайта: потраченные ячейки, свои значения навыков и спасброска, щит с mod 0 и поправка КД', () => {
  const r = parse('sorcerer-site-export.json'), h = r.hero;
  assert.equal(h.classId, 'sorcerer', 'класс со строчной буквы');
  assert.deepEqual(h.slotPools.map((p) => [p.circle, p.max, p.spent]), [[1, 4, 1], [2, 3, 2], [3, 2, 0]], 'filled — потрачено');
  assert.equal(h.overrides.skills.acrobatics.value, 2);
  assert.equal(h.overrides.saves.dex.value, 2);
  assert.ok(!h.overrides.skills.arcana, 'своё значение, равное расчёту, не записываем');
  assert.equal(h.initBonus, 2);
  assert.equal(h.ac, 15, '13 + щит с mod 0 + «Щит предков» +2');
  assert.deepEqual(h.inventoryItems.map((x) => x.name), ['2 свитка опознания', 'Щит предков', '5 мантий с серебряной вышивкой'], 'снаряжение через запятые');
  assert.equal(h.attacks.length, 1, 'пустое оружие пропущено');
  assert.deepEqual([h.attacks[0].bonus, h.attacks[0].damage, h.attacks[0].type], [3, '1d4+2', 'колющий'], '«+0» — не задано, урон без порчи слов');
  const f = Object.fromEntries(h.featureEntries.map((x) => [x.name, x]));
  assert.ok(f['Источник магии'] && f['Быстрое заклинание'] && f['Осторожное заклинание'], 'умения: «Имя. Текст», жирное и простое название');
  assert.equal(f['Божественная искра'].source, '1-й уровень, умение подкласса');
  assert.ok(f['Осторожное заклинание'].description.endsWith('3/5'), 'счётчик — к предыдущему умению');
  assert.equal(h.tempHp, 4); assert.equal(h.deathSaves.f, 1); assert.equal(h.darkvision, 60); assert.ok(h.inspiration);
  assert.match(h.personality.appearance, /Возраст 120, рост 180, вес 75, глаза серые\nСветлые перья/);
  const v = view(h);
  assert.equal(v.skills.find((s) => s.name === 'Акробатика').mod, '+2');
  assert.equal(v.vitals.init, '+2');
  assert.equal(v.resources.find((x) => x.circle === 2).left, 1);
});

test('паладин с сайта: КД по кольчуге и щиту, характер HTML-строками, иммунитет, заметки всех страниц', () => {
  const r = parse('paladin-site-export.json'), h = r.hero;
  assert.equal(h.ac, undefined, 'КД 10 в LSS не записываем — посчитает лист');
  assert.ok(issue(r, /КД 18 — по снаряжению/));
  assert.equal(view(h).vitals.ac.value, 18);
  assert.equal(h.personality.backstory, 'Типаж: Разведчик\nВойна научила держать строй.');
  assert.equal(h.personality.ideals, 'Честь. Слово дороже золота.');
  assert.ok(h.featureEntries.some((f) => f.name === 'Иммунитеты' && f.description === 'Болезням'));
  assert.ok(!h.featureEntries.some((f) => f.name === 'Сопротивления'));
  assert.match(h.notes, /Наложение рук: Запас/); assert.match(h.notes, /Союзники и организации:\nОтряд/);
  assert.match(h.proficiencies.tools, /Транспорт \(сухопутный\)/);
  assert.equal(view(h).spellcasting.dc, 13, 'паладин 5 ур. колдует Харизмой');
});

test('жрец с сайта: свой бонус атаки заклинанием, итог атаки оружием в modBonus, универсальное оружие, предметы', () => {
  const r = parse('cleric-site-export.json'), h = r.hero;
  assert.equal(h.spellSources[0].attackOverride, 8);
  const v = view(h);
  assert.equal(v.spellcasting.attack, '+8');
  assert.deepEqual([h.attacks[0].bonus, h.attacks[0].damage], [6, '1d8+3']);
  assert.match(h.attacks[0].note, /двумя руками 1к10\+3/);
  assert.equal(h.ac, 18, '16 + щит +2');
  assert.deepEqual(h.coins, { gp: 120, sp: 30 }, 'устаревший total не трогаем');
  assert.equal(h.slotPools.find((p) => p.circle === 2).spent, 1);
  const items = Object.fromEntries(h.inventoryItems.map((x) => [x.name, x]));
  assert.match(items['Рукавицы силы огра'].description, /Сила равна 19/);
  assert.ok(items['Глаза, клыки и шкура волка'], 'запятые в заметках не делят вещь');
  assert.equal(items['Метательные копья'].quantity, 10);
  assert.ok(h.featureEntries.some((f) => f.name === 'Камень удачи' && f.description === 'плюс 1 к попаданию заклинанием'));
  assert.ok(h.featureEntries.some((f) => f.name === 'Исследователь' && /библиотека/.test(f.description)));
});

test('конвертер Foundry → LSS: мультикласс, атаки текстом, ресурсы, кости multiclass, items вместе с equipment', () => {
  const t = parse('torin-multi.json').hero;
  assert.deepEqual(t.classes.map((c) => [c.name, c.levels]), [['Воин', 3], ['Жрец', 2]]);
  assert.equal(t.level, 5);
  assert.deepEqual(t.hitDicePools.map((p) => [p.die, p.total]), [[10, 3], [8, 2]]);
  assert.ok(t.attacks.some((a) => a.name === 'Боевой топор' && a.bonus === 6 && a.damage === '1d8+4'), '«Боевой топор +6 1к8+4» из text.attacks');
  assert.equal(t.spellSources[0].ability, 'wis', 'spellsInfo.base.code');
  const tv = view(t);
  assert.equal(tv.subtitle.split(' · ')[0], 'Воин 3 / Жрец 2');
  const l = parse('lira-converter.json').hero;
  assert.ok(l.resources.some((x) => x.name === 'Магическое восстановление' && x.recovery === 'long'));
  assert.ok(l.inventoryItems.some((x) => x.name === 'Зелье лечения') && l.inventoryItems.some((x) => x.name === 'Книга заклинаний'), 'items + equipment');
  assert.ok(l.attacks.some((a) => a.name === 'Кинжал' && a.damage === '1d4+3' && a.type === 'колющий'), '«колющий» цел');
  assert.equal(l.tempHp, 5);
  const c = parse('lira-cards.json');
  assert.ok(issue(c, /4 заклинания карточками/));
});

test('текст LSS: документ, HTML и строка; записи из абзацев; ошибки файла', () => {
  assert.equal(lssText('строка'), 'строка');
  assert.equal(lssText({ value: { data: '<p>Раз</p><p>Два &amp; три</p>' } }), 'Раз\nДва & три');
  const doc = { value: { data: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'Ярость.' }, { type: 'text', text: ' Бонусным действием.' }] }, { type: 'paragraph' }, { type: 'paragraph', content: [{ type: 'text', text: 'Верёвка - 50 футов' }] }] } } };
  assert.deepEqual(lssEntries(lssParas(doc)).map((e) => [e.name, e.description]), [['Ярость', 'Бонусным действием.'], ['Верёвка', '50 футов']]);
  assert.throws(() => parseLss('{"foo": 1}'), /Long Story Short/);
  assert.throws(() => parseLss('не json'), /Это не JSON/);
});
