// TASK-182: рисунки как в Owlbear Rodeo — фигуры по рамке, заливка и обводка, рамка с ручками.
// Старые рисунки (линии, прямые, шаблоны без новых полей) должны выглядеть как раньше.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  boxCorners, shapePoints, isClosed, styleOf, drawingMarkup, drawingFrame, transformEdit,
  shapeHandles, drawingsShift, shiftDrawing, zOf,
} from '../dist/js/views/table/drawings.js';
import { safeColor } from '../dist/js/views/table/draw-style.js';

const grid = { size: 70, feet: 5 };
const near = (a, b, eps = 0.06) => Math.abs(a - b) <= eps;

test('старые рисунки: линия без заливки, шаблон заливается своим цветом на 18 %', () => {
  const line = { id: 'l', type: 'line', pts: [{ x: 0, y: 0 }, { x: 70, y: 0 }], color: '#ff0000' };
  assert.equal(isClosed(line), false);
  assert.deepEqual(styleOf(line), { color: '#ff0000', width: 4, opacity: 1, dash: false, fill: 'none', fillOpacity: 1 });
  assert.match(drawingMarkup(grid, line), /^<polyline [^>]*class="draw-line"/);

  const cone = { id: 'c', type: 'shape', shape: 'cone', origin: { x: 0, y: 0 }, angle: 0, size: 15, color: '#00ff00' };
  const st = styleOf(cone);
  assert.equal(st.fill, '#00ff00');
  assert.equal(st.fillOpacity, 0.18);
  assert.match(drawingMarkup(grid, cone), /^<polygon [^>]*class="draw-shape"/);

  const seg = { id: 's', type: 'shape', shape: 'seg', a: { x: 0, y: 0 }, b: { x: 140, y: 0 }, color: '#0000ff' };
  assert.equal(isClosed(seg), false);
  assert.equal(styleOf(seg).fill, 'none');
});

test('фигуры по рамке: углы с поворотом, круг — <ellipse>, треугольник и шестиугольник — контуры', () => {
  const rect = { type: 'shape', shape: 'rect', c: { x: 100, y: 100 }, w: 80, h: 40, rot: 0 };
  assert.deepEqual(boxCorners(rect), [{ x: 60, y: 80 }, { x: 140, y: 80 }, { x: 140, y: 120 }, { x: 60, y: 120 }]);
  const turned = boxCorners({ ...rect, rot: 90 });
  assert.ok(near(turned[0].x, 120) && near(turned[0].y, 60), 'левый верх после поворота на 90°');
  assert.equal(shapePoints(grid, { ...rect, shape: 'tri' }).length, 3);
  assert.equal(shapePoints(grid, { ...rect, shape: 'hex' }).length, 6);
  const ell = drawingMarkup(grid, { ...rect, shape: 'ellipse', rot: 30, fill: '#2f6bff', fillOpacity: 0.5 });
  assert.match(ell, /^<ellipse cx="100" cy="100" rx="40" ry="20" transform="rotate\(30 100 100\)"/);
  assert.match(ell, /fill:#2f6bff;fill-opacity:0.5/);
});

test('заливка только у замкнутых; обводка 0 — без обводки; пунктир', () => {
  const poly = { type: 'shape', shape: 'poly', pts: [{ x: 0, y: 0 }, { x: 70, y: 0 }, { x: 70, y: 70 }], fill: '#ef4444' };
  assert.equal(styleOf(poly).fill, 'none', 'незамкнутый многоугольник — ломаная без заливки');
  assert.equal(styleOf({ ...poly, closed: true }).fill, '#ef4444');
  const css = drawingMarkup(grid, { ...poly, closed: true, width: 0 });
  assert.match(css, /stroke:none;stroke-width:0/);
  assert.match(drawingMarkup(grid, { ...poly, closed: true, dash: true, width: 4 }), /stroke-dasharray:10 8/);
  const brush = { type: 'line', closed: true, pts: poly.pts, fill: '#ef4444' };
  assert.equal(isClosed(brush), true);
  assert.match(drawingMarkup(grid, brush), /^<polygon /);
});

test('цвет из данных не выходит за пределы style', () => {
  assert.equal(safeColor('#abc'), '#abc');
  assert.equal(safeColor('hsl(32 80% 65%)'), 'hsl(32 80% 65%)');
  assert.equal(safeColor('var(--brand-500)'), 'var(--brand-500)');
  assert.equal(safeColor('red;background:url(x)'), '#e9b052');
  assert.equal(safeColor('"><script>'), '#e9b052');
  const m = drawingMarkup(grid, { type: 'line', pts: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: '"/><script>', fill: 'x' });
  assert.ok(!m.includes('<script>'));
});

test('зона клика: середина ловится только в «Выделении» рисования, класс не дублируется', () => {
  const rect = { type: 'shape', shape: 'rect', c: { x: 0, y: 0 }, w: 70, h: 70, rot: 0 };
  assert.match(drawingMarkup(grid, rect, ' fillhit', ' data-drawing="r"', true), /class="draw-hit fillhit" data-drawing="r"/);
  assert.match(drawingMarkup(grid, rect, '', ' data-drawing="r"', true), /class="draw-hit" data-drawing="r"/);
  const open = { type: 'line', pts: [{ x: 0, y: 0 }, { x: 70, y: 0 }] };
  assert.match(drawingMarkup(grid, open, ' fillhit', '', true), /class="draw-hit"/);
});

test('у фигуры по рамке нет ручек шаблона — только рамка (регрессия: выделение прямоугольника падало)', () => {
  const rect = { type: 'shape', shape: 'rect', c: { x: 0, y: 0 }, w: 70, h: 70, rot: 0 };
  assert.deepEqual(shapeHandles(grid, rect), []);
  assert.deepEqual(shapeHandles(grid, { type: 'shape', shape: 'poly', pts: [] }), []);
  assert.equal(drawingFrame(grid, rect).box, true);
  assert.equal(drawingFrame(grid, { type: 'line', pts: [{ x: 0, y: 0 }, { x: 10, y: 20 }] }).box, false);
});

test('угол рамки: противоположный угол стоит, Shift — пропорционально, подпись в футах', () => {
  const rect = { type: 'shape', shape: 'rect', c: { x: 70, y: 35 }, w: 140, h: 70, rot: 0 };
  // Тянем правый нижний угол (k2) из (140,70) в (210,140): левый верх (0,0) на месте.
  const { patch, label } = transformEdit(grid, rect, 'k2', { x: 210, y: 140 });
  assert.deepEqual(patch, { c: { x: 105, y: 70 }, w: 210, h: 140 });
  assert.equal(label, '15×10 фт');
  const p2 = transformEdit(grid, rect, 'k2', { x: 280, y: 80 }, { shift: true }).patch;
  assert.equal(p2.w / p2.h, 2, 'Shift сохраняет пропорции');
  // Повёрнутая на 90° фигура: левый верх (k0) остаётся там же.
  const r90 = { ...rect, rot: 90 };
  const k0 = boxCorners(r90)[0];
  const moved = { ...r90, ...transformEdit(grid, r90, 'k2', { x: 0, y: 200 }).patch };
  const k0b = boxCorners(moved)[0];
  assert.ok(near(k0.x, k0b.x, 0.2) && near(k0.y, k0b.y, 0.2));
});

test('поворот: липнет к 45°, Shift — по 15°, Alt — свободно; точки рисунка от руки поворачиваются', () => {
  const rect = { type: 'shape', shape: 'rect', c: { x: 0, y: 0 }, w: 70, h: 70, rot: 0 };
  const at = (deg) => ({ x: Math.cos((deg - 90) * Math.PI / 180) * 100, y: Math.sin((deg - 90) * Math.PI / 180) * 100 });
  assert.equal(transformEdit(grid, rect, 'rot', at(41)).patch.rot, 45);
  assert.equal(transformEdit(grid, rect, 'rot', at(41), { alt: true }).patch.rot, 41);
  assert.equal(transformEdit(grid, rect, 'rot', at(37), { shift: true }).patch.rot, 30);
  assert.equal(transformEdit(grid, rect, 'rot', at(68)).patch.rot, 68);
  const line = { type: 'line', pts: [{ x: -50, y: 0 }, { x: 50, y: 0 }] };
  const p = transformEdit(grid, line, 'rot', at(90)).patch.pts;
  assert.ok(near(p[0].x, 0) && near(p[0].y, -50), 'горизонталь стала вертикалью');
});

test('сдвиг: фигура по рамке едет центром; закреплённый рисунок группа не двигает', () => {
  const rect = { id: 'a', type: 'shape', shape: 'rect', c: { x: 10, y: 10 }, w: 70, h: 70, rot: 0 };
  assert.deepEqual(shiftDrawing(rect, 5, -5).c, { x: 15, y: 5 });
  const scene = { drawings: [rect, { ...rect, id: 'b', locked: true }] };
  const { after } = drawingsShift(scene, new Set(['a', 'b']), 70, 0);
  assert.deepEqual(Object.keys(after), ['a']);
  assert.equal(zOf({}), 0);
  assert.equal(zOf({ z: -2 }), -2);
});
