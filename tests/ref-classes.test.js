// Справочник, классы (#203): модель дороги 1→20, русские пересказы всех умений SRD, склейка текста SRD.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.self ??= {};
globalThis.window ??= { addEventListener() {}, removeEventListener() {} };
const data = (f) => JSON.parse(readFileSync(new URL(`../dist/js/data/${f}`, import.meta.url), 'utf8'));
const { classItems } = await import('../dist/js/views/ref/data.js');
const { modelOf, PICK } = await import('../dist/js/views/ref/classes.js');
const { SUM, CLASS_META, reflow } = await import('../dist/js/views/ref/class-text.js');

const items = classItems(data('character-options-2014.json'), data('features-2014.json'), data('equipment-2014.json'));
const byId = Object.fromEntries(items.map((it) => [it.id, it]));

test('классы: двенадцать классов, у каждого паспорт, цвет и по подклассу SRD', () => {
  assert.equal(items.length, 12);
  for (const it of items) {
    assert.ok(CLASS_META[it.id], `нет паспорта: ${it.id}`);
    assert.equal(it.rows.length, 20, it.id);
    assert.equal(it.subs.length, 1, it.id);
  }
});

test('классы: у каждого умения класса и подкласса есть русская суть', () => {
  const missing = [];
  for (const it of items) {
    for (const f of [...it.feats, ...it.subs.flatMap((s) => s.feats)]) {
      if (/:ability-score-improvement$/.test(f.key)) continue;
      if (!SUM[f.key]) missing.push(f.key);
    }
  }
  assert.deepEqual(missing, []);
});

test('дорога: развилка на уровне подкласса, рост характеристик, усиления и числа', () => {
  const wiz = modelOf(byId.wizard);
  assert.equal(wiz.lv[1].fork?.key, 'wizard:arcane-tradition');
  assert.equal(wiz.lv[3].asi, true);
  assert.deepEqual(wiz.subLevels, [2, 6, 10, 14]);
  assert.ok(wiz.lv[4].chips.includes('Заклинания 3-го круга'));
  assert.ok(wiz.lv[4].chips.includes('Мастерство +3'));
  const fig = modelOf(byId.fighter);
  assert.deepEqual(fig.extra.levels, [5, 11, 20]);
  assert.ok(fig.lv[10].ups.some((u) => u.note === 'три атаки'));
  const barb = modelOf(byId.barbarian);
  assert.ok(barb.lv[2].chips.includes('Ярость: 3'));
  assert.ok(barb.lv[19].chips.includes('Ярость: ∞'));
  const rogue = modelOf(byId.rogue);
  assert.ok(rogue.lv[4].chips.includes('Скрытая атака: 3к6'));
  const lock = modelOf(byId.warlock);
  assert.equal(lock.lv[0].fork?.key, 'warlock:otherworldly-patron');
});

test('подбор класса: без магии и для первой игры — варвар, воин, плут', () => {
  const pick = items.filter((it) => PICK.mag(it, 'none') && PICK.easy(it)).map((it) => it.id).sort();
  assert.deepEqual(pick, ['barbarian', 'fighter', 'rogue']);
  assert.ok(PICK.want(byId.cleric, 'help'));
  assert.ok(!PICK.want(byId.barbarian, 'magic'));
});

test('текст SRD из PDF склеивается в абзацы, переносы и подзаголовки сохраняются', () => {
  const out = reflow('As a student of arcane magic, you have a spellbook\ncontaining spells.\nCantrips\nAt 1st level, you know three cantrips of your choice\nfrom the 1st-\nlevel list.');
  assert.deepEqual(out, [
    { p: 'As a student of arcane magic, you have a spellbook containing spells.' },
    { h: 'Cantrips' },
    { p: 'At 1st level, you know three cantrips of your choice from the 1st-level list.' },
  ]);
});
