// TASK-187 (план TASK-097, п. 3.5 и 2.2): слои токенов, порядок наложения с ездой, движение ездового со всадниками.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenLayer, stackOrder, expandRideMoves, ridersOf } from '../dist/js/views/table/riding.js';

const top = (order) => [...order.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);

test('слой: предмет 0, ездовое 1, остальные 2; ручной слой сильнее', () => {
  assert.equal(tokenLayer({ kind: 'item' }), 0);
  assert.equal(tokenLayer({ kind: 'foe', mount: true }), 1);
  assert.equal(tokenLayer({ kind: 'hero' }), 2);
  assert.equal(tokenLayer({ kind: 'foe', layer: 0 }), 0);
  assert.equal(tokenLayer({ kind: 'item', layer: 2 }), 2);
  assert.equal(tokenLayer({ kind: 'foe', layer: 7 }), 2, 'мусор в слое — по виду');
});

test('порядок без слоёв и езды — как раньше: двигали последним — выше, иначе по порядку на сцене', () => {
  const o = stackOrder([{ id: 'a' }, { id: 'b', movedAt: 5 }, { id: 'c' }, { id: 'd', movedAt: 2 }]);
  assert.deepEqual(top(o), ['b', 'd', 'c', 'a']);
});

test('огр на культисте, предмет под всеми, ездовое ниже существ', () => {
  const o = stackOrder([{ id: 'chest', kind: 'item', movedAt: 99 }, { id: 'horse', kind: 'foe', mount: true, movedAt: 50 }, { id: 'cultist', kind: 'foe', movedAt: 1 }, { id: 'ogre', kind: 'foe', movedAt: 2 }]);
  assert.deepEqual(top(o), ['ogre', 'cultist', 'horse', 'chest']);
});

test('всадник — сразу над своим ездовым, даже если ездовое сдвинули позже', () => {
  const tokens = [{ id: 'horse', kind: 'foe', mount: true, layer: 2, movedAt: 30 }, { id: 'torin', kind: 'hero', riding: 'horse', movedAt: 10 }, { id: 'ogre', kind: 'foe', movedAt: 20 }];
  const o = stackOrder(tokens);
  assert.ok(o.get('torin') > o.get('horse'), 'Торин над конём');
  assert.deepEqual(top(o), ['torin', 'horse', 'ogre']);
  // Стоит рядом, но не сел: обычный порядок по времени.
  const o2 = stackOrder([{ id: 'horse', kind: 'foe', mount: true, layer: 2, movedAt: 30 }, { id: 'torin', kind: 'hero', movedAt: 10 }]);
  assert.ok(o2.get('horse') > o2.get('torin'));
});

test('тянут ездовое — всадник едет в ту же точку; тянут всадника — он спешивается', () => {
  const scene = { tokens: [{ id: 'horse', x: 10, y: 10, mount: true }, { id: 'torin', x: 10, y: 10, riding: 'horse' }, { id: 'lyra', x: 50, y: 50 }] };
  const a = expandRideMoves(scene, [{ id: 'horse', from: { x: 10, y: 10 }, to: { x: 40, y: 10 } }]);
  assert.deepEqual(a.map((m) => [m.id, m.to.x, !!m.carried, !!m.dismount]), [['horse', 40, false, false], ['torin', 40, true, false]]);
  const b = expandRideMoves(scene, [{ id: 'torin', from: { x: 10, y: 10 }, to: { x: 70, y: 10 } }]);
  assert.deepEqual(b.map((m) => [m.id, m.to.x, !!m.dismount]), [['torin', 70, true]]);
  // Оба в группе — всадник встаёт в точку ездового, а не на своё смещение.
  const c = expandRideMoves(scene, [{ id: 'torin', from: { x: 10, y: 10 }, to: { x: 99, y: 99 } }, { id: 'horse', from: { x: 10, y: 10 }, to: { x: 40, y: 10 } }]);
  assert.deepEqual(c.map((m) => [m.id, m.to.x, m.to.y, !!m.dismount]), [['torin', 40, 10, false], ['horse', 40, 10, false]]);
  assert.deepEqual(ridersOf(scene, 'horse').map((t) => t.id), ['torin']);
  assert.equal(scene.tokens[1].riding, 'horse', 'исходная сцена не меняется');
});
