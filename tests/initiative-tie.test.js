// #197 S1: при равной инициативе порядок задаёт мастер (по RAW решают мастер и игроки), бонус — только по умолчанию.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.self ??= {};
globalThis.window ??= { addEventListener() {}, removeEventListener() {} };
const realInterval = globalThis.setInterval;
globalThis.setInterval = () => 0;
const { initiativeOrder, tiedMoves, moveTied } = await import('../dist/js/views/table/combat.js');
globalThis.setInterval = realInterval;

const foe = (id, initBonus) => ({ id, kind: 'foe', name: id, hp: 7, hpMax: 7, initBonus, x: 0, y: 0 });
const mk = () => ({
  scene: { id: 's', tokens: [foe('a', 1), foe('b', 3), foe('c', 0), foe('d', 5)] },
  c: { characters: [], creatures: {}, log: [], combat: { active: true, sceneId: 's', round: 1, turn: 0, moved: {}, entries: [
    { tokenId: 'a', init: 12 }, { tokenId: 'b', init: 12 }, { tokenId: 'c', init: 12 }, { tokenId: 'd', init: 7 },
  ] } },
});
const ids = (c, s) => initiativeOrder(c, s).map((r) => r.tokenId);

test('без решения мастера ничья — по бонусу инициативы', () => {
  const { c, scene } = mk();
  assert.deepEqual(ids(c, scene), ['b', 'a', 'c', 'd']);
});

test('мастер поднимает и опускает участника среди равных; бонус больше не решает', () => {
  const { c, scene } = mk();
  const order = initiativeOrder(c, scene), slotOf = (id) => order.find((r) => r.tokenId === id).slot;
  assert.deepEqual(tiedMoves(order, slotOf('b')), { up: false, down: true });
  assert.deepEqual(tiedMoves(order, slotOf('c')), { up: true, down: false });
  assert.deepEqual(tiedMoves(order, slotOf('d')), { up: false, down: false });
  assert.equal(moveTied(c, scene, 'c', -1), true);
  assert.deepEqual(ids(c, scene), ['b', 'c', 'a', 'd']);
  assert.equal(moveTied(c, scene, 'c', -1), true);
  assert.deepEqual(ids(c, scene), ['c', 'b', 'a', 'd']);
  // Выше некуда, а d с другой инициативой не меняется местами с a.
  assert.equal(moveTied(c, scene, 'c', -1), false);
  assert.equal(moveTied(c, scene, 'a', 1), false);
  assert.deepEqual(c.combat.entries.filter((e) => e.init === 12).map((e) => [e.tokenId, e.tie]).sort(), [['a', 2], ['b', 1], ['c', 0]]);
});

test('новая инициатива снимает ничью: другой результат ставит по числу', () => {
  const { c, scene } = mk();
  moveTied(c, scene, 'c', -1);
  c.combat.entries.find((e) => e.tokenId === 'c').init = 20;
  assert.deepEqual(ids(c, scene), ['c', 'b', 'a', 'd']);
});
