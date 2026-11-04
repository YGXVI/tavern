// Правила движения и областей на сетке (D&D 5e 2014): расстояния, стены, местность, шаблоны.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cellOf, cellCenter, snapCenter, cellDistance, footprintGap, findPath, reachable, templateCells, freeSpots, moveBlocked, key, softSnap,
  pathClear, smoothPath, pathCost, cellsAlong, routeLeg, MAGNET_EXPLORE,
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

test('полупривязка: свободно, но у центра клетки — магнит', () => {
  const g = { size: 100 };
  // Далеко от центра — точка остаётся как есть.
  assert.deepEqual(softSnap(g, { x: 120, y: 160 }, 1), { x: 120, y: 160 });
  // В пределах 0.28 клетки от центра — ровно в центр.
  assert.deepEqual(softSnap(g, { x: 140, y: 160 }, 1), { x: 150, y: 150 });
  // Большой токен 2×2 магнитится к узлу сетки.
  assert.deepEqual(softSnap(g, { x: 210, y: 190 }, 2), { x: 200, y: 200 });
  // Жёсткая привязка (Shift) — всегда в клетку.
  assert.deepEqual(softSnap(g, { x: 120, y: 160 }, 1, true), { x: 150, y: 150 });
  // Вне боя (TASK-028) магнит срабатывает только у самого центра: 14 px от центра — уже свободно, 5 px — в центр.
  assert.deepEqual(softSnap(g, { x: 140, y: 160 }, 1, false, MAGNET_EXPLORE), { x: 140, y: 160 });
  assert.deepEqual(softSnap(g, { x: 146, y: 153 }, 1, false, MAGNET_EXPLORE), { x: 150, y: 150 });
  assert.deepEqual(softSnap(g, { x: 120, y: 160 }, 1, true, MAGNET_EXPLORE), { x: 150, y: 150 });
});

test('свободный путь: прямо, если ничто не мешает, и в обход стены иначе', () => {
  const g = { size: 10 };
  const a = { x: 5, y: 5 }, corner = { x: 45, y: 5 }, b = { x: 45, y: 45 };
  // Без стен — натягивается в один отрезок.
  assert.deepEqual(smoothPath([a, corner, b], (p, q) => pathClear(g, p, q)), [a, b]);
  // Стена поперёк диагонали — угол остаётся.
  const walls = [wall(10, 30, 40, 0)];
  const clear = (p, q) => pathClear(g, p, q, { walls });
  assert.equal(clear(a, b), false);
  assert.deepEqual(smoothPath([a, { x: 5, y: 45 }, b], clear), [a, { x: 5, y: 45 }, b]);
  // Непроходимая клетка на прямой мешает, а клетка старта — нет.
  assert.equal(pathClear(g, { x: 5, y: 5 }, { x: 35, y: 5 }, { blocked: new Set([key(2, 0)]) }), false);
  assert.equal(pathClear(g, { x: 5, y: 5 }, { x: 35, y: 5 }, { blocked: new Set([key(0, 0)]) }), true);
});

test('стоимость свободного пути по правилам 5e и местности', () => {
  const g = { size: 10 };
  assert.equal(pathCost(g, [{ x: 5, y: 5 }, { x: 35, y: 5 }]), 3);
  assert.equal(pathCost(g, [{ x: 5, y: 5 }, { x: 35, y: 35 }]), 3);
  assert.equal(pathCost(g, [{ x: 5, y: 5 }, { x: 35, y: 35 }], { rule: '5-10-5' }), 4);
  // Две из трёх клеток пути — труднопроходимые: 1 + 2 + 2 = 5 (половина первой и последней — по ½).
  const mud = pathCost(g, [{ x: 5, y: 5 }, { x: 35, y: 5 }], { difficult: new Set([key(1, 0), key(2, 0)]) });
  assert.ok(Math.abs(mud - 5) < 0.01, `mud ${mud}`);
  assert.deepEqual(cellsAlong(g, [{ x: 5, y: 5 }, { x: 25, y: 5 }]).map((c) => key(c.c, c.r)), ['0,0', '1,0', '2,0']);
});

test('центр токена: узкие двери проходимы, стыки стен — нет', () => {
  const g = { size: 10 };
  // Горизонтальная стена по линии сетки с дверью в одну клетку посередине.
  const line = (door) => [wall(0, 20, 20, 20), wall(20, 20, 30, 20, { kind: 'door', open: door }), wall(30, 20, 60, 20)];
  // Большой токен 2×2 (центр в узлах) проходит открытую дверь в одну клетку через её край.
  const big = findPath(g, { c: 1, r: 0 }, { c: 1, r: 2 }, { walls: line(true), cols: 6, rows: 5, n: 2 });
  assert.ok(big, 'крупный токен проходит открытую дверь');
  assert.equal(findPath(g, { c: 1, r: 0 }, { c: 1, r: 2 }, { walls: line(false), cols: 6, rows: 5, n: 2 }), null);
  // Узкая дверь не по сетке: прямо через проём — можно, рядом через стену — нельзя.
  const narrow = [wall(0, 20, 23, 20), wall(23, 20, 27, 20, { kind: 'door', open: true }), wall(27, 20, 60, 20)];
  assert.equal(moveBlocked({ x: 25, y: 10 }, { x: 25, y: 30 }, narrow), false);
  assert.equal(moveBlocked({ x: 15, y: 10 }, { x: 15, y: 30 }, narrow), true);
  // Конец одиночной стены можно обойти вплотную, а стык двух стен (угол) — не проскочить.
  assert.equal(moveBlocked({ x: 0, y: 0 }, { x: 20, y: 20 }, [wall(10, 10, 10, 0)]), false);
  const corner = [wall(10, 0, 10, 10), wall(0, 10, 10, 10)];
  assert.equal(moveBlocked({ x: 5, y: 5 }, { x: 10, y: 10 }, corner), true, 'нельзя встать в стык');
  assert.equal(moveBlocked({ x: 0, y: 20 }, { x: 20, y: 0 }, corner), false, 'снаружи угла — можно');
  // Остановиться на стене нельзя, уйти с неё — можно.
  assert.equal(moveBlocked({ x: 5, y: 5 }, { x: 5, y: 20 }, [wall(0, 20, 30, 20)]), true);
  assert.equal(moveBlocked({ x: 5, y: 20 }, { x: 5, y: 5 }, [wall(0, 20, 30, 20)]), false);
});

// TASK-026: стена режет клетку, токен стоит в этой клетке по одну сторону стены.
test('обход начинается из места токена: стена внутри клетки не перепрыгивается', () => {
  const g = { size: 70, feet: 5 };
  const cut = [wall(100, 0, 100, 300)]; // режет столбец клеток c=1 (70…140), центр клетки 105 — справа от стены
  const segOk = (pts, walls) => pts.every((p, i) => i === 0 || !moveBlocked(pts[i - 1], p, walls));
  const start = { x: 90, y: 105 }; // слева от стены, клетка (1,1)
  // Соседняя клетка справа: путь обязан обойти стену снизу.
  const r1 = routeLeg(g, start, { x: 175, y: 105 }, { walls: cut, cols: 6, rows: 8 });
  assert.ok(r1, 'обход есть');
  assert.ok(segOk(r1.pts, cut), 'ни один отрезок не пересекает стену');
  assert.ok(r1.pts.some((p) => p.y > 300), 'путь идёт вокруг конца стены');
  // Та же клетка, но за стеной (её центр) — тоже только в обход.
  const r2 = routeLeg(g, start, { x: 105, y: 105 }, { walls: cut, cols: 6, rows: 8 });
  assert.ok(r2 && segOk(r2.pts, cut) && r2.pts.some((p) => p.y > 300));
  // Стена во всю высоту — пройти нельзя.
  const full = [wall(100, 0, 100, 560)];
  assert.equal(routeLeg(g, start, { x: 175, y: 105 }, { walls: full, cols: 6, rows: 8 }), null);
  assert.equal(routeLeg(g, start, { x: 105, y: 105 }, { walls: full, cols: 6, rows: 8 }), null);
  // Своя сторона стены — прямой путь.
  assert.deepEqual(routeLeg(g, start, { x: 40, y: 300 }, { walls: full, cols: 6, rows: 8 }).pts, [start, { x: 40, y: 300 }]);
});

test('обход без origin ведёт себя как раньше', () => {
  const g = { size: 10 };
  assert.deepEqual(findPath(g, { c: 1, r: 1 }, { c: 1, r: 1 }, { cols: 3, rows: 3 }), { cells: [{ c: 1, r: 1 }], cost: 0 });
  const p = findPath(g, { c: 0, r: 0 }, { c: 2, r: 0 }, { cols: 3, rows: 1, origin: { x: 3, y: 5 } });
  assert.deepEqual(p.cells, [{ c: 1, r: 0 }, { c: 2, r: 0 }]);
});
