// Витрина экранов героя (#203): форма объектов, на которые опираются экраны. Подключение настоящих данных
// должно сохранять эту форму (docs/hero-view.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIRA, TORIN, CORNERS, LEVEL_UP, CREATION, CREATION_LIVE, HERO_LIST, LSS_IMPORT } from '../dist/js/views/hero/fixture.js';

const sign = /^[+−]\d+$/;

test('лист героя: обязательные поля и числа со знаком', () => {
  for (const k of ['id', 'name', 'portrait', 'subtitle', 'vitals', 'abilities', 'skills', 'resources', 'actions', 'inventory', 'personality']) assert.ok(LIRA[k], k);
  assert.equal(LIRA.abilities.length, 6);
  for (const a of LIRA.abilities) { assert.match(a.mod, sign); assert.match(a.save, sign); assert.equal(typeof a.score, 'number'); }
  assert.equal(LIRA.skills.length, 18);
  for (const s of LIRA.skills) { assert.match(s.mod, sign); assert.ok(['none', 'prof', 'expert'].includes(s.prof)); }
  const { hp } = LIRA.vitals;
  assert.ok(hp.now >= 0 && hp.now <= hp.max);
  for (const r of LIRA.resources) assert.ok(r.left >= 0 && r.left <= r.total && ['slot', 'use'].includes(r.kind), r.id);
  for (const k of ['action', 'bonus', 'reaction', 'special']) assert.ok(Array.isArray(LIRA.actions[k]), k);
});

test('числа Лиры сходятся с правилами 2014: хиты, КД, Сл и подготовка', () => {
  const mod = (s) => Math.floor((s - 10) / 2);
  const ab = Object.fromEntries(LIRA.abilities.map((a) => [a.key, a.score]));
  assert.equal(LIRA.vitals.hp.max, 6 + mod(ab.con) + 4 * (4 + mod(ab.con))); // к6: максимум на 1 уровне, затем среднее
  assert.equal(LIRA.vitals.ac.value, 10 + mod(ab.dex));
  assert.equal(LIRA.spellcasting.dc, 8 + 3 + mod(ab.int));
  assert.equal(LIRA.spellcasting.prepared.max, mod(ab.int) + LIRA.level);
  const prepared = LIRA.spellcasting.spells.filter((s) => s.level > 0 && s.prepared).length;
  assert.equal(prepared, LIRA.spellcasting.prepared.now);
});

test('корнеры, чужой герой, повышение и импорт имеют свои поля', () => {
  assert.equal(CORNERS.down.vitals.hp.now, 0);
  assert.ok(CORNERS.concentration.concCheck.dc >= 10);
  assert.equal(CORNERS.noSlots.resources.find((r) => r.id === 'slot-3').left, 0);
  assert.ok(CORNERS.multiclass.classes.length > 1);
  assert.ok(CORNERS.unfinished.missing.tabs.length);
  assert.equal(TORIN.isMine, false);
  assert.ok(TORIN.shared.covers.length && TORIN.shared.hidden.length);
  assert.equal(LEVEL_UP.to, LEVEL_UP.from + 1);
  assert.deepEqual(LEVEL_UP.steps.map((s) => s.id), ['hp', 'new', 'spells', 'done']);
  assert.ok(LSS_IMPORT.issues.every((i) => ['warn', 'error'].includes(i.kind)));
});

test('мастер создания: 7 шагов, у каждого есть живой лист; варианты с картинками', () => {
  assert.equal(CREATION.steps.length, 7);
  for (const s of CREATION.steps) { assert.ok(s.title && s.hint, s.id); assert.ok(CREATION_LIVE[s.id], `живой лист ${s.id}`); }
  assert.equal(CREATION.races.length, 9);
  assert.equal(CREATION.classes.length, 12);
  for (const o of [...CREATION.races, ...CREATION.classes]) assert.match(o.img, /^assets\/hero\/.+\.webp$/);
  const { budget, list } = CREATION.abilities;
  assert.equal(list.reduce((s, a) => s + a.cost, 0), budget.spent);
  assert.equal(budget.of - budget.spent, budget.left);
  assert.equal(CREATION.quick.questions.length, 3);
  assert.ok(HERO_LIST.some((h) => h.status === 'draft'));
});
