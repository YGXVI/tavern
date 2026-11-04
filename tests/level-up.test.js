// #202 / TASK-186: levelUpPlan — «что поднимать этому герою» поверх движка конструктора.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toCharacterData, proposeBuildChange, confirmBuildChange, evaluateBuild } from '../dist/js/rules/character-builder.js';
import { levelUpPlan, draftFromCreation } from '../dist/js/rules/level-up.js';
import { cats, context, draft, levels, autofill } from './helpers/builder-fixtures.js';

let counter = 0;
const makeId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
function hero(cls, n, ctxOver = {}) {
  const ctx = context({ startLevel: n, ...ctxOver });
  const { ev, d } = autofill(ctx, draft(ctx, { levelHistory: levels([cls, n]), identity: { name: 'Тест', notes: '' } }));
  assert.equal(ev.status, 'valid');
  return toCharacterData(ev, d, cats, { makeId }).data;
}

test('levelUpPlan: воин 3 → 4 — характеристики или черта, хиты d10 в среднем', () => {
  const ch = hero('fighter', 3);
  const plan = levelUpPlan(ch, 'srd51:class:fighter', cats);
  assert.equal(plan.supported, true);
  assert.deepEqual([plan.fromLevel, plan.toLevel, plan.classLevel, plan.hitDie], [3, 4, 4, 10]);
  assert.deepEqual(plan.errors, []);
  const kinds = plan.choices.map(c => c.kind);
  assert.ok(kinds.includes('asi_or_feat'), JSON.stringify(kinds));
  // Средние хиты: 10/2+1 = 6, плюс модификатор Телосложения (13 и +1 человека = 14 → +2).
  assert.equal(plan.evaluation.derivedInputs.abilityScores.con, 14);
  assert.equal(plan.hp.gain, 8);
  assert.equal(plan.hp.maxAfter, 36); // 10+2 + 2×(6+2) = 28 на 3-м, +8 на 4-м
  // Прежние выборы не повторяются: только решения 4-го уровня.
  assert.ok(plan.choices.every(c => c.origin?.characterLevel === 4), JSON.stringify(plan.choices.map(c => c.origin)));
});

test('levelUpPlan: принятые решения доводят сборку до валидной и тем же путём, что окно создания', () => {
  const ch = hero('fighter', 3);
  const plan = levelUpPlan(ch, 'srd51:class:fighter', cats);
  const ctx = context({ startLevel: 4 });
  const { ev } = autofill(ctx, plan.nextDraft);
  assert.equal(ev.status, 'valid', JSON.stringify(ev.missing));
  assert.equal(ev.derivedInputs.characterLevel, 4);
});

test('levelUpPlan: волшебник 1 → 2 — школа (подкласс) и новые заклинания книги', () => {
  const ch = hero('wizard', 1);
  const plan = levelUpPlan(ch, 'srd51:class:wizard', cats);
  assert.equal(plan.supported, true);
  assert.equal(plan.hitDie, 6);
  const kinds = new Set(plan.choices.map(c => c.kind));
  const book = plan.choices.find(c => c.id === 'srd51:class:wizard:spells:spellbook');
  assert.ok(book, JSON.stringify([...kinds]));
  assert.equal(book.count, 8);
  assert.match(book.need, /нужно 8, выбрано 6/);
  assert.deepEqual(plan.errors, []);
  assert.ok(plan.choices.some(c => /subclass/.test(c.kind) || /subclass/.test(c.id)), JSON.stringify(plan.choices.map(c => c.id)));
});

test('levelUpPlan: новый класс без разрешённого мультикласса — ошибка, с разрешением — без неё', () => {
  const ch = hero('fighter', 2);
  const off = levelUpPlan(ch, 'srd51:class:rogue', cats);
  assert.equal(off.errors[0]?.code, 'multiclass_disabled');
  const on = levelUpPlan(ch, 'srd51:class:rogue', cats, { policy: context({ optionalRules: { multiclass: true } }) });
  assert.ok(!on.errors.some(e => e.code === 'multiclass_disabled'));
  assert.equal(on.classLevel, 1);
  assert.equal(on.hitDie, 8);
});

test('levelUpPlan: герой без конструктора, 20-й уровень и неизвестный класс — понятный отказ', () => {
  assert.equal(levelUpPlan({ name: 'Старый', level: 3 }, 'srd51:class:fighter', cats).supported, false);
  const ch = hero('fighter', 1);
  assert.equal(levelUpPlan(ch, 'srd51:class:nope', cats).supported, false);
  const max = structuredClone(ch);
  max.creation.levelHistory = Array.from({ length: 20 }, () => ({ classId: 'srd51:class:fighter' }));
  assert.match(levelUpPlan(max, 'srd51:class:fighter', cats).reason, /20/);
});

test('draftFromCreation: черновик из creation совпадает с исходной сборкой', () => {
  const ch = hero('cleric', 2);
  const d = draftFromCreation(ch.creation);
  const ev = evaluateBuild(context({ startLevel: 2 }), cats, d);
  assert.equal(ev.status, 'valid', JSON.stringify(ev.missing));
  // Через proposeBuildChange/confirmBuildChange окно меняет nextDraft тем же путём, что и при создании.
  const p = proposeBuildChange(d, { type: 'setIdentity', identity: { name: 'Новое имя' } }, context({ startLevel: 2 }), cats);
  assert.equal(confirmBuildChange(p).identity.name, 'Новое имя');
});
