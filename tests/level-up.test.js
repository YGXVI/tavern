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

// ——— Запись повышения: тело команды и клиент ———
import { readFileSync } from 'node:fs';
import { levelUpPayload, GROWTH_FIELDS } from '../dist/js/rules/level-up.js';
import { createCharacterSheetClient, makeLevelUpRequest, SheetCommandError } from '../dist/js/server/character-sheet.js';
import { levelUpFixture } from '../tools/level-up-fixture.mjs';

function grown(cls, n, ctxOver = {}) {
  const ch = hero(cls, n, ctxOver);
  ch.hitDicePools = ch.hitDicePools.map(p => ({ ...p, spent: 1 }));
  ch.slotPools = (ch.slotPools || []).map(p => ({ ...p, spent: 1 }));
  const plan = levelUpPlan(ch, `srd51:class:${cls}`, cats);
  // Недобор списка (книга волшебника) окно закрывает выбором: добираем свободные варианты, как игрок.
  for (const c of plan.choices.filter(x => x.need && Array.isArray(plan.nextDraft.selections[x.id]))) {
    const have = plan.nextDraft.selections[c.id], taken = new Set(Object.values(plan.nextDraft.selections).flat());
    plan.nextDraft.selections[c.id] = [...have, ...c.options.filter(o => !taken.has(o) && !(c.unavailable || []).some(u => u.option === o))].slice(0, c.count);
  }
  const { d } = autofill(plan.context, plan.nextDraft);
  return { ch, plan: { ...plan, nextDraft: d } };
}

test('levelUpPayload: воин 3 → 4 — только поля сборки, история +1, хиты не передаются', () => {
  const { ch, plan } = grown('fighter', 3);
  const body = levelUpPayload(ch, plan, cats, { makeId });
  assert.deepEqual(Object.keys(body).sort(), ['creation', 'patch']);
  assert.ok(Object.keys(body.patch).every(k => GROWTH_FIELDS.includes(k)), Object.keys(body.patch).join());
  assert.equal(body.patch.level, 4);
  assert.equal(body.creation.levelHistory.length, 4);
  assert.deepEqual(body.creation.levelHistory.slice(0, 3), ch.creation.levelHistory);
  assert.deepEqual(body.creation.ancestry, ch.creation.ancestry);
  assert.ok(!('hp' in body.patch) && !('hpMax' in body.patch));
  // Кость хитов: прежний ID и потраченное сохраняются, всего — 4.
  assert.deepEqual(body.patch.hitDicePools.map(p => [p.id, p.total, p.spent]), [[ch.hitDicePools[0].id, 4, 1]]);
  // На 4-м уровне выбрано увеличение характеристик или черта — в истории выборов.
  assert.ok(Object.keys(body.creation.selections).length > Object.keys(ch.creation.selections).length);
});

test('levelUpPayload: волшебник 2 → 3 — источник магии и ячейки сохраняют ID, заклинания ссылаются на прежний источник', () => {
  const { ch, plan } = grown('wizard', 2);
  const body = levelUpPayload(ch, plan, cats, { makeId });
  const source = ch.spellSources[0].id;
  assert.equal((body.patch.spellSources || ch.spellSources)[0].id, source);
  assert.ok(body.patch.knownSpells.every(s => s.sourceId === source));
  const first = body.patch.slotPools.find(p => p.circle === 1), old = ch.slotPools.find(p => p.circle === 1);
  assert.deepEqual([first.id, first.spent], [old.id, 1]);
  assert.ok(body.patch.slotPools.some(p => p.circle === 2));
});

test('levelUpPayload: незавершённая сборка — ошибка с первым недостающим решением', () => {
  const ch = hero('fighter', 3);
  const plan = levelUpPlan(ch, 'srd51:class:fighter', cats);
  assert.throws(() => levelUpPayload(ch, plan, cats, { makeId }), /Не выбрано/);
  assert.throws(() => levelUpPayload(ch, { supported: false, reason: 'нет' }, cats, { makeId }), /нет/);
});

test('makeLevelUpRequest и клиент: запрос заморожен, повтор после потери ответа — тот же запрос', async () => {
  const input = () => ({ campaignId: 'c-test', characterId: 'ch-1', version: '3', operationId: '30000000-0000-4000-8000-000000000001', payload: { creation: { a: 1 }, patch: { level: 2 } } });
  const req = makeLevelUpRequest(input());
  assert.ok(Object.isFrozen(req.payload.patch));
  assert.throws(() => makeLevelUpRequest({ ...input(), payload: { creation: {}, patch: {}, hp: 3 } }), /creation и patch/);
  assert.throws(() => makeLevelUpRequest({ ...input(), operationId: 'x' }), /UUID/);
  const calls = []; let fail = true;
  const ack = { data: { ok: true, operationId: '30000000-0000-4000-8000-000000000001', replayed: true, hpGain: 8, sheet: { id: 'ch-1', campaignId: 'c-test', version: '4', data: {} } }, error: null };
  const client = createCharacterSheetClient(async () => ({ rpc: async (name, args) => { calls.push({ name, args }); if (fail) { fail = false; throw new TypeError('lost'); } return ack; } }));
  let error; try { await client.levelUp(input()); } catch (e) { error = e; }
  assert.equal(error.kind, 'network');
  assert.equal((await client.retry(error)).hpGain, 8);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].name, 'level_up_character');
  const conflict = createCharacterSheetClient(async () => ({ rpc: async () => ({ data: null, error: { code: '40001' } }) }));
  await assert.rejects(conflict.levelUp(input()), e => e instanceof SheetCommandError && e.kind === 'conflict');
});

test('фикстура SQL-проверок повышения совпадает с тем, что считает движок', () => {
  const file = JSON.parse(readFileSync(new URL('../supabase/tests/character_level_up_fixture.json', import.meta.url)));
  assert.deepEqual(file, JSON.parse(JSON.stringify(levelUpFixture())));
  assert.equal(file.hpGain, 8); // d10: 6 + Телосложение 14 (+2)
});
