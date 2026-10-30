// TASK-083: бестиарий SRD 2014 на столе — форма записей и догрузка.
import test from 'node:test';
import assert from 'node:assert/strict';
import SRD from '../dist/js/data/bestiary-srd.js';
import { BESTIARY, monsterById, loadSrdBestiary, srdLoaded } from '../dist/js/data/bestiary.js';

// Та же запись, что понимает кнопка броска урона на столе (dice.js parseFormula).
const DICE = /^(\d{0,3})d(4|6|8|10|12|20|100)([+-]\d{1,3})?$/i;
const SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
const ABS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ru = (s) => /[а-яё]/i.test(s);

test('SRD-существа: уникальные id srd:*, русские имена, числа статблока', () => {
  assert.ok(SRD.length >= 320, `существ: ${SRD.length}`);
  const ids = new Set();
  for (const m of SRD) {
    assert.match(m.id, /^srd:[a-z0-9-]+$/);
    assert.ok(!ids.has(m.id), `дубль ${m.id}`); ids.add(m.id);
    assert.ok(ru(m.name), `${m.id}: имя не по-русски`);
    assert.ok(m.en && !ru(m.en), `${m.id}: нет английского имени`);
    assert.ok(ru(m.type), `${m.id}: тип ${m.type}`);
    assert.ok(SIZES.includes(m.size), `${m.id}: размер ${m.size}`);
    assert.ok(Number.isInteger(m.ac) && m.ac > 0 && Number.isInteger(m.hp) && m.hp > 0, `${m.id}: КД/хиты`);
    assert.match(m.hpDice, DICE, `${m.id}: кость хитов ${m.hpDice}`);
    for (const a of ABS) assert.ok(Number.isInteger(m.stats[a]), `${m.id}: ${a}`);
    assert.equal(m.init, Math.floor((m.stats.dex - 10) / 2));
    assert.equal(m.img, `ini:${m.name}`);
    assert.equal(m.srd, true);
  }
});

test('SRD-существа: названия действий и особенностей по-русски, описания SRD — по-английски, урон бросается', () => {
  for (const m of SRD) {
    for (const x of [...m.traits, ...(m.reactions || [])]) {
      assert.ok(ru(x.name), `${m.id}: ${x.en}`);
      assert.equal(typeof x.desc, 'string');
    }
    for (const a of [...m.actions, ...(m.legendary || [])]) {
      assert.ok(ru(a.name), `${m.id}: действие ${a.name}`);
      assert.ok(a.desc && !ru(a.desc), `${m.id}: ${a.name} без описания SRD`);
      assert.equal(typeof a.bonus, 'number');
      if (a.damage) assert.ok(DICE.test(a.damage) || /^\d+$/.test(a.damage), `${m.id}: урон ${a.damage}`);
    }
  }
  const dragon = SRD.find((m) => m.id === 'srd:adult-red-dragon');
  assert.equal(dragon.name, 'Взрослый красный дракон');
  assert.deepEqual([dragon.cr, dragon.ac, dragon.hp, dragon.size, dragon.darkvision], ['17', 19, 256, 'huge', 120]);
  assert.equal(dragon.saves.con, 13);
  const bite = dragon.actions.find((a) => a.name === 'Укус');
  assert.deepEqual([bite.bonus, bite.damage, bite.type], [14, '2d10+8', 'колющий']);
  assert.ok(dragon.legendary.some((a) => a.name === 'Атака крыльями (2 действия)' && a.damage === '2d6+8'));
});

test('ручные существа не дублируются; SRD догружается один раз, список по алфавиту', async () => {
  const hand = BESTIARY.map((m) => m.id);
  assert.ok(hand.includes('goblin') && hand.every((id) => !id.startsWith('srd:')));
  for (const id of hand) assert.ok(!SRD.some((m) => m.en && m.id === `srd:${id}`), `дубль ручного ${id}`);
  assert.equal(srdLoaded(), false);
  assert.equal(monsterById('srd:adult-red-dragon'), undefined);
  const n = await loadSrdBestiary();
  assert.equal(n, hand.length + SRD.length);
  assert.equal(await loadSrdBestiary(), n, 'повторная загрузка не добавляет копий');
  assert.equal(srdLoaded(), true);
  assert.equal(monsterById('srd:adult-red-dragon').hp, 256);
  assert.equal(monsterById('goblin').name, 'Гоблин');
  const names = BESTIARY.map((m) => m.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'ru')));
});

// TASK-119: генератор берёт только статблоки SRD 5.1. Не-SRD (другой source) в общий каталог сайта не попадают,
// даже если у записи есть slug и полный статблок (решение #116: не-SRD — только личная библиотека мастера).
test('Генератор: в каталог стола идут только статблоки SRD', async () => {
  const { readFileSync, writeFileSync, mkdtempSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const root = new URL('../', import.meta.url);
  const data = JSON.parse(readFileSync(new URL('data/bestiary/bestiary-2014.json', root), 'utf8'));
  const srd = data.monsters.find((m) => m.stat_block?.source === 'srd_api_2014' && !['cultist', 'goblin'].includes(m.identity?.srd_index));
  assert.ok(srd, 'в каталоге есть SRD-статблок');
  const other = structuredClone(srd);
  other.id = 'test:non-srd'; other.identity = { ...other.identity, srd_index: null, slug: 'not-srd-creature' };
  other.stat_block = { ...other.stat_block, source: 'dndsu_public_technical_fields' };
  const dir = mkdtempSync(join(tmpdir(), 'bestiary-'));
  const inFile = join(dir, 'in.json'), outFile = join(dir, 'out.js');
  writeFileSync(inFile, JSON.stringify({ ...data, monsters: [srd, other] }));
  execFileSync(process.execPath, [new URL('tools/bestiary-srd.mjs', root).pathname, inFile, outFile], { stdio: 'pipe' });
  const { default: list } = await import(pathToFileURL(outFile).href);
  assert.deepEqual(list.map((m) => m.id), [`srd:${srd.identity.srd_index || srd.identity.slug}`]);
});
