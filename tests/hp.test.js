// Ручной ввод хитов в токен-баре.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHpInput } from '../dist/js/rules/hp.js';

test('ввод хитов: число — поставить, минус — урон, плюс — лечение', () => {
  assert.deepEqual(parseHpInput('12'), { set: 12 });
  assert.deepEqual(parseHpInput(' 0 '), { set: 0 });
  assert.deepEqual(parseHpInput('-5'), { delta: -5 });
  assert.deepEqual(parseHpInput('−7'), { delta: -7 });
  assert.deepEqual(parseHpInput('+ 3'), { delta: 3 });
  assert.equal(parseHpInput(''), null);
  assert.equal(parseHpInput('abc'), null);
  assert.equal(parseHpInput('5-2'), null);
});
