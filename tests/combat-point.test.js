// Аудит 04.11 (#204): игрок пишет бой и спасброски точечными функциями — уходит только своё.
import test from 'node:test';
import assert from 'node:assert/strict';
import { playerCombatDelta, playerSaveResults } from '../dist/js/server/model.js';

const rows = { tokens: new Map([
  ['t-p', { id: 't-p', hidden: false }], ['t-gob', { id: 't-gob', hidden: false }], ['t-ogre', { id: 't-ogre', hidden: true }],
]) };
const base = { entries: [{ tokenId: 't-gob', init: 15 }, { tokenId: 't-p', init: null }], moved: { 't-gob': 5 }, current: 't-p' };

test('бросок инициативы — только новые, округлённые', () => {
  const want = { ...base, entries: [{ tokenId: 't-gob', init: 3 }, { tokenId: 't-p', init: 12.4 }] };
  assert.deepEqual(playerCombatDelta(want, base, rows), { init: { 't-p': 12 }, moved: {}, ended: null });
});

test('пройденное — только изменённое и видимое', () => {
  const want = { ...base, moved: { 't-gob': 5, 't-p': 15, 't-ogre': 10 } };
  assert.deepEqual(playerCombatDelta(want, base, rows), { init: {}, moved: { 't-p': 15 }, ended: null });
});

test('конец хода и «ничего не поменял»', () => {
  assert.deepEqual(playerCombatDelta({ ...base, ended: 't-p' }, base, rows), { init: {}, moved: {}, ended: 't-p' });
  assert.equal(playerCombatDelta(base, base, rows), null);
});

test('спасбросок — только результаты, которых не было', () => {
  const o = { prev: { data: { results: { 't-q2': { total: 9 } } } }, row: { data: { results: { 't-q2': { total: 9 }, 't-p': { total: 13 } } } } };
  assert.deepEqual(playerSaveResults(o), { 't-p': { total: 13 } });
});
