// #190 E: числа карточки своего существа — пустое не пишется, хиты формулой бросаются, поправки мастера видны игроку.
import test from 'node:test';
import assert from 'node:assert/strict';
import { intOrNull, parseHp, tokenFields, diffNumbers } from '../dist/js/views/table/own-creature-num.js';

test('числа: пусто — не задано, «+2» — 2, мусор — ошибка', () => {
  assert.equal(intOrNull(''), null);
  assert.equal(intOrNull(' 13 '), 13);
  assert.equal(intOrNull('+2'), 2);
  assert.equal(intOrNull('−1'), -1);
  assert.ok(Number.isNaN(intOrNull('десять')));
});

test('хиты: число, формула с броском (к и d), мусор', () => {
  assert.deepEqual(parseHp('9'), { hp: 9, formula: '' });
  assert.equal(parseHp(''), null);
  const r = parseHp('2к8 + 2', () => 0.999);
  assert.deepEqual(r, { hp: 18, formula: '2d8+2' }, 'максимум на двух к8 + 2');
  assert.equal(parseHp('1d4-5', () => 0).hp, 1, 'не меньше 1');
  assert.ok(Number.isNaN(parseHp('много')));
});

test('поля токена: только заданное, в разумных пределах', () => {
  assert.deepEqual(tokenFields({ ac: '', hp: '', speed: '', fly: '', init: '' }), {}, 'пустая карточка — мастер заполнит');
  assert.deepEqual(tokenFields({ ac: '13', hp: '4', speed: '20', fly: '30', init: '+2' }), { ac: 13, hp: 4, hpMax: 4, speed: 20, fly: 30, initBonus: 2 });
  assert.equal(tokenFields({ ac: '99' }).ac, 40);
  assert.equal('fly' in tokenFields({ fly: '0' }), false);
});

test('что поправил мастер', () => {
  assert.equal(diffNumbers({ ac: 13, hpMax: 4 }, { ac: 12, hpMax: 6 }), 'КД 13 → 12, хиты 4 → 6');
  assert.equal(diffNumbers({ ac: 13 }, { ac: 13 }), '');
  assert.equal(diffNumbers({}, { speed: 30 }), 'скорость — → 30');
});
