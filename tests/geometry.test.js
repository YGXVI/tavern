// Правила движения и областей на сетке (D&D 5e 2014): расстояния, стены, местность, шаблоны.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cellOf, cellCenter, snapCenter, cellDistance, footprintGap, findPath, reachable, templateCells, freeSpots, moveBlocked, key,
} from '../dist/js/rules/geometry.js';

const grid = { size: 50, offsetX: 10, offsetY: 20, feet: 5 };
const wall = (x1, y1, x2, y2, extra = {}) => ({ a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, kind: 'wall', ...extra });

test('клетка и её центр с учётом смещения сетки', () => {
  assert.deepEqual(cellOf(grid, 10, 20), { c: 0, r: 0 });
  assert.deepEqual(cellOf(grid, 9, 19), { c: -1, r: -1 });
  assert.deepEqual(cellCenter(grid, 2, 3), { x: 135, y: 195 });
  // Средний токен встаёт в центр клетки, большой (2×2) — на узел сетки.
  assert.deepEqual(snapCenter(grid, 140, 190, 1), { x: 135, y: 195 });
  assert.deepEqual(snapCenter(grid, 140, 190, 2), { x: 160, y: 170 });
});

test('диагонали: 5 фт по Книге игрока и 5-10-5 по варианту мастера', () => {
  assert.equal(cellDistance({ c: 0, r: 0 }, { c: 3, r: 4 }), 4);
  assert.equal(cellDistance({ c: 0, r: 0 }, { c: 3, r: 3 }, '5-10-5'), 4);
  assert.equal(cellDistance({ c: 0, r: 0 }, { c: 1, r: 1 }, '5-10-5'), 1);
  // Досягаемость между краями: соседние клетки — 1, существо 2×2 рядом — тоже 1.
  assert.equal(footprintGap({ c: 0, r: 0, n: 1 }, { c: 1, r: 1, n: 1 }), 1);
  assert.equal(footprintGap({ c: 0, r: 0, n: 1 }, { c: 2, r: 0, n: 2 }), 2);
  assert.equal(footprintGap({ c: 0, r: 0, n: 1 }, { c: 1, r: -1, n: 2 }), 1);
});

test('путь обходит стену, а сквозь неё — нет', () => {
  const g = { size: 10 };
  // Вертикальная стена между столбцами 1 и 2 от верха до r=3.
  const walls = [wall(20, 0, 20, 40)];
  assert.equal(moveBlocked({ x: 15, y: 5 }, { x: 25, y: 5 }, walls), true);
  const p = findPath(g, { c: 1, r: 0 }, { c: 2, r: 0 }, { walls, cols: 6, rows: 6 });
  assert.ok(p, 'путь существует');
  assert.ok(p.cost > 1, 'идём в обход');
  assert.ok(p.cells.some((x) => x.r >= 4), 'обход ниже стены');
  // Открытая дверь пропускает, закрытая — нет.
  const door = [wall(20, 0, 20, 60, { kind: 'door', open: false })];
  assert.equal(findPath(g, { c: 1, r: 0 }, { c: 2, r: 0 }, { walls: door, cols: 3, rows: 6 }), null);
  const open = [wall(20, 0, 20, 60, { kind: 'door', open: true })];
  assert.equal(findPath(g, { c: 1, r: 0 }, { c: 2, r: 0 }, { walls: open, cols: 3, rows: 6 }).cost, 1);
});

test('нельзя срезать угол стены по диагонали', () => {
  const g = { size: 10 };
  // Угол: стена справа от (0,0) и снизу от (0,0).
  const walls = [wall(10, 0, 10, 10), wall(0, 10, 10, 10)];
  const p = findPath(g, { c: 0, r: 0 }, { c: 1, r: 1 }, { walls, cols: 3, rows: 3 });
  assert.equal(p, null);
});

test('труднопроходимая местность стоит вдвое, непроходимая — недоступна', () => {
  const g = { size: 10 };
  const straight = findPath(g, { c: 0, r: 0 }, { c: 3, r: 0 }, { cols: 4, rows: 1 });
  assert.equal(straight.cost, 3);
  const mud = findPath(g, { c: 0, r: 0 }, { c: 3, r: 0 }, { cols: 4, rows: 1, difficult: new Set([key(1, 0), key(2, 0)]) });
  assert.equal(mud.cost, 5);
  const pit = findPath(g, { c: 0, r: 0 }, { c: 3, r: 0 }, { cols: 4, rows: 1, blocked: new Set([key(2, 0)]) });
  assert.equal(pit, null);
  // Скорость 30 фт = 6 клеток: дальше не уходим.
  const reach = reachable(g, { c: 0, r: 0 }, 6, { cols: 20, rows: 1 });
  assert.ok(reach.has(key(6, 0)));
  assert.ok(!reach.has(key(7, 0)));
});

test('шаблоны: сфера 20 фт и линия 30 фт', () => {
  const g = { size: 10, feet: 5 };
  // Сфера радиусом 4 клетки из узла сетки покрывает круг из центров клеток.
  const sphere = templateCells(g, { type: 'sphere', origin: { x: 50, y: 50 }, size: 20 }, 10, 10);
  assert.ok(sphere.some((c) => c.c === 4 && c.r === 4));
  assert.ok(sphere.some((c) => c.c === 1 && c.r === 4));
  assert.ok(!sphere.some((c) => c.c === 0 && c.r === 0));
  // Линия вправо: ровно 6 клеток в одном ряду.
  const line = templateCells(g, { type: 'line', origin: { x: 0, y: 25 }, angle: 0, size: 30 }, 10, 10);
  assert.deepEqual(line.map((c) => `${c.c},${c.r}`).sort(), ['0,2', '1,2', '2,2', '3,2', '4,2', '5,2']);
});

test('свободные клетки не занимают чужие и непроходимые', () => {
  const scene = {
    grid: { size: 10 }, map: { width: 50, height: 50 },
    terrain: { blocked: [key(2, 3)] },
    tokens: [{ id: 'a', x: 25, y: 25, size: 'medium' }],
  };
  const spots = freeSpots(scene, { x: 25, y: 25 }, 3, 1);
  assert.equal(spots.length, 3);
  for (const p of spots) {
    assert.notDeepEqual(p, { x: 25, y: 25 });
    assert.notDeepEqual(p, { x: 25, y: 35 });
  }
});
