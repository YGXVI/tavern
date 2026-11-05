// #197: атака и урон по правилам 5e 2014 — R1 (крит удваивает только кости), R2 (натуральная 1 — промах),
// R4 (спасброски от смерти: стабилен/мёртв не бросают, счётчики обнуляются), M1 (урон по лежащему), R5 (mod(0)).
import test from 'node:test';
import assert from 'node:assert/strict';
import { attackOutcome, isHit, critDamageFormula, deathSaveStep, heroDamage, isDead, isStable } from '../dist/js/rules/attack.js';
import { mod } from '../dist/js/data/rules.js';

test('R1/R2: исход атаки и удвоение костей', () => {
  assert.equal(attackOutcome(1, 5, 5), 'miss', 'натуральная 1 — промах при сумме ≥ КД');
  assert.equal(attackOutcome(20, 3, 30), 'crit');
  assert.equal(isHit(12, 15, 15), true);
  assert.equal(isHit(12, 14, 15), false);
  assert.equal(critDamageFormula('1d6+2'), '2d6+2', 'модификатор один раз');
  assert.equal(critDamageFormula('d8'), '2d8');
});

test('R4: спасброски от смерти', () => {
  assert.deepEqual(deathSaveStep({ s: 2, f: 1 }, 12), { ds: { s: 0, f: 0, stable: true }, out: 'stable' }, 'три успеха — стабилен, счётчики с нуля');
  assert.deepEqual(deathSaveStep({ s: 0, f: 2 }, 5), { ds: { s: 0, f: 3 }, out: 'dead' });
  assert.deepEqual(deathSaveStep({ s: 0, f: 1 }, 1), { ds: { s: 0, f: 3 }, out: 'dead' }, 'единица — два провала');
  assert.equal(deathSaveStep({ s: 0, f: 3 }, 20).out, 'no', 'мёртвый не приходит в себя от 20');
  assert.equal(deathSaveStep({ s: 0, f: 0, stable: true }, 15).out, 'no', 'стабильный не бросает');
  assert.deepEqual(deathSaveStep({ s: 1, f: 2 }, 20), { ds: { s: 0, f: 0 }, out: 'up' });
  assert.equal(isDead({ f: 3 }), true);
  assert.equal(isStable({ s: 0, f: 0, stable: true }), true);
});

test('M1: урон по герою', () => {
  assert.deepEqual(heroDamage({ hp: 0, hpMax: 20, deathSaves: { s: 1, f: 0 } }, 5), { hp: 0, tempHp: 0, deathSaves: { s: 1, f: 1 }, dropped: false, dead: false, dealt: 5 });
  assert.equal(heroDamage({ hp: 0, hpMax: 20, deathSaves: { s: 0, f: 1 } }, 5, { crit: true }).deathSaves.f, 3, 'крит по лежащему — два провала');
  assert.equal(heroDamage({ hp: 0, hpMax: 20, deathSaves: { s: 0, f: 0, stable: true } }, 1).deathSaves.stable, undefined, 'урон снимает стабильность');
  const drop = heroDamage({ hp: 5, hpMax: 20, tempHp: 2 }, 10);
  assert.deepEqual([drop.hp, drop.tempHp, drop.dropped, drop.dead], [0, 0, true, false]);
  assert.equal(heroDamage({ hp: 5, hpMax: 20 }, 25).dead, true, 'сверх оставшихся 20 = максимум — мгновенная смерть');
  assert.equal(heroDamage({ hp: 5, hpMax: 20 }, 24).dead, false);
  assert.equal(heroDamage({ hp: 0, hpMax: 20, deathSaves: { s: 0, f: 0 } }, 20).dead, true, 'по лежащему урон не меньше максимума — смерть');
});

test('R5: модификатор характеристики 0 — −5', () => {
  assert.equal(mod(0), -5);
  assert.equal(mod(1), -5);
  assert.equal(mod(10), 0);
  assert.equal(mod(null), 0);
  assert.equal(mod(''), 0);
});
