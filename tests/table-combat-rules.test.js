// #197 M2–M5: состояния, спасброски, порядок урона и реакция до начала собственного хода.
import test from 'node:test';
import assert from 'node:assert/strict';
import { heroHpConditions, heroDamage, adjustDamage, opportunityAttack } from '../dist/js/rules/attack.js';
import { saveRule, saveAdvantage, saveResult } from '../dist/js/rules/saves.js';

test('M2: падение снимает концентрацию и добавляет оба состояния без дубликатов', () => {
  const before = ['concentration', 'poisoned', 'prone'];
  assert.deepEqual(heroHpConditions(before, 4, 0), ['poisoned', 'prone', 'unconscious']);
  assert.deepEqual(before, ['concentration', 'poisoned', 'prone']);
  assert.deepEqual(heroHpConditions(['unconscious', 'prone', 'poisoned'], 0, 3), ['prone', 'poisoned']);
  assert.deepEqual(heroHpConditions(['concentration'], 4, 2), ['concentration']);
});
test('M2: временные хиты не дают упасть, лечение не заставляет встать', () => {
  const r = heroDamage({ hp: 2, hpMax: 10, tempHp: 5 }, 5);
  assert.deepEqual(heroHpConditions([], 2, r.hp), []);
  const drop = heroDamage(r, 3);
  const conditions = heroHpConditions([], r.hp, drop.hp);
  assert.deepEqual(conditions, ['unconscious', 'prone']);
  assert.deepEqual(heroHpConditions(conditions, 0, 1), ['prone']);
});
test('M3: четыре состояния автоматически проваливают только СИЛ и ЛОВ', () => {
  for (const id of ['paralyzed', 'stunned', 'unconscious', 'petrified']) {
    for (const ab of ['str', 'dex']) assert.equal(saveRule([id], ab).autoFail, true);
    for (const ab of ['con', 'int', 'wis', 'cha']) assert.deepEqual(saveRule([id], ab), { autoFail: false, adv: null, why: '' });
  }
});
test('M3: опутан — помеха только ЛОВ, автопровал старше помехи', () => {
  const rule = saveRule(['restrained'], 'dex');
  assert.deepEqual(rule, { autoFail: false, adv: 'dis', why: 'С помехой — опутан' });
  assert.equal(saveRule(['restrained'], 'str').adv, null);
  assert.equal(saveRule(['restrained', 'stunned'], 'dex').autoFail, true);
  assert.equal(saveAdvantage(null, rule), 'dis');
  assert.equal(saveAdvantage('dis', rule), 'dis');
  assert.equal(saveAdvantage('adv', rule), null);
  assert.equal(saveRule(['exhaustion'], 'dex').adv, null);
});
test('M3: автопровал без кубика и строго в схеме valid_save_result', () => {
  const r = saveResult(saveRule(['paralyzed'], 'str'), null, -5, 'player');
  assert.deepEqual(r, { total: 0, nat: null, ok: false, by: 'player', detail: 'Автопровал — парализован' });
  const normal = saveResult(saveRule(['restrained'], 'dex'), { total: 15, nat: 12, detail: 'к20: 12' }, 14, 'master');
  assert.deepEqual(Object.keys(normal).sort(), ['by', 'detail', 'nat', 'ok', 'total']);
  assert.equal(normal.ok, true);
  assert.match(normal.detail, /С помехой/);
  for (const total of [-200, 2000]) {
    const result = saveResult(saveRule([], 'wis'), { total, nat: 10, detail: 'x'.repeat(700) }, 10, 'player');
    assert.ok(result.total >= -100 && result.total <= 1000);
    assert.equal(result.detail.length, 500);
  }
});
test('M4: сперва половина спасброска, затем отношение к урону, потом временные хиты', () => {
  assert.equal(adjustDamage(7, 'resist', true), 1);
  assert.equal(adjustDamage(7, 'vuln', true), 6, 'сначала округление вниз, потом удвоение');
  assert.equal(adjustDamage(7, 'immune', true), 0);
  assert.equal(adjustDamage(7, null), 7);
  const r = heroDamage({ hp: 10, hpMax: 10, tempHp: 2 }, adjustDamage(15, 'resist', true));
  assert.equal(r.hp, 9); assert.equal(r.tempHp, 0);
});
test('M5: только рукопашная атака, включая +0 и метательное оружие', () => {
  const ranged = { bonus: 4, desc: 'Ranged Weapon Attack' };
  const melee = { bonus: 0, desc: 'Melee Weapon Attack' };
  assert.equal(opportunityAttack([ranged, melee]).action, melee);
  const typed = { attack: { bonus: 0, reach: 5, range: { normal: 20 } } };
  assert.equal(opportunityAttack([typed]).action, typed);
  assert.equal(opportunityAttack([{ bonus: 2, ru: 'Рукопашная атака' }]).action.bonus, 2);
  assert.match(opportunityAttack([ranged]).why, /Нет рукопашной/);
  assert.equal(opportunityAttack([{ desc: 'Melee Weapon Attack' }]).action, null);
});
test('M5: потраченная реакция запрещает даже подходящую атаку', () => {
  assert.deepEqual(opportunityAttack([{ bonus: 5, desc: 'Melee' }], true), { action: null, why: 'Реакция уже потрачена' });
});

globalThis.self ??= {};
globalThis.window ??= { addEventListener() {}, removeEventListener() {} };
const interval = globalThis.setInterval;
globalThis.setInterval = () => 0;
const { advanceTurn, startCombat, endCombat } = await import('../dist/js/views/table/combat.js');
const { applyHits, adjust } = await import('../dist/js/views/table/mob-attack.js');
globalThis.setInterval = interval;

test('M2/M4: атака толпой использует общие состояния и старый экспорт adjust', () => {
  assert.equal(adjust, adjustDamage);
  const result = applyHits({ hp: 2, hpMax: 10, conditions: ['concentration'] }, [{ damage: 5 }], null, true);
  assert.deepEqual(result.state.conditions, ['unconscious', 'prone']);
});
test('M5: реакции сбрасываются у всей начинающей ход пачки, чужие сохраняются', () => {
  const scene = { id: 's', tokens: ['a', 'b', 'c'].map(id => ({ id, name: id, kind: 'hero', hp: 10, hpMax: 10 })) };
  const c = { characters: [], combat: { active: true, round: 1, turn: 0, moved: {}, reacted: { a: true, b: true, c: true }, entries: [
    { tokenId: 'a', init: 20 }, { tokenId: 'b', init: 10, group: 'bc' }, { tokenId: 'c', init: 10, group: 'bc' },
  ] } };
  advanceTurn(c, scene);
  assert.deepEqual(c.combat.reacted, { a: true });
  advanceTurn(c, scene);
  assert.deepEqual(c.combat.reacted, {});
});
test('M5: начало и конец боя очищают реакции; старый бой без поля совместим', () => {
  const scene = { id: 's', tokens: [{ id: 'a', name: 'a', kind: 'hero', hp: 10, hpMax: 10 }] };
  const c = { characters: [], log: [], combat: { reacted: { a: true } } };
  startCombat(c, scene, ['a'], { a: 10 });
  assert.deepEqual(c.combat.reacted, {});
  delete c.combat.reacted; advanceTurn(c, scene);
  c.combat.reacted = { a: true }; endCombat(c);
  assert.deepEqual(c.combat.reacted, {});
});
