// Рисунки и надписи как объекты (TASK-031): выделить, сдвинуть, перекрасить, изменить текст, удалить.
// TASK-182: инструменты как в Owlbear Rodeo — фигуры, заливка и обводка, рамка с ручками размера и поворота.
import { esc, uid } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { templatePolygon, gridSize, pointInPolygon, distToSegment } from '../../rules/geometry.js';
import { safeColor, stylePopover, fillSwatch, strokeSwatch } from './draw-style.js';

/** Инструменты рисования (TASK-182). */
export const DRAW_TOOLS = [
  { id: 'select', name: 'Выделение · тянуть рисунок, ручки — размер и поворот', icon: 'cursor-01' },
  { id: 'poly', name: 'Многоугольник · щелчок — точка, по первой точке — замкнуть, двойной щелчок или Enter — закончить', icon: 'pen-tool-01' },
  { id: 'pen', name: 'Карандаш', icon: 'pencil-edit-02' },
  { id: 'brush', name: 'Кисть · фигура от руки, замыкается сама', icon: 'paint-roller' },
  { id: 'seg', name: 'Линия · Shift — по 5 фт', icon: 'slash' },
  { id: 'rect', name: 'Прямоугольник · углы к сетке, Alt — свободно, Shift — квадрат', icon: 'square' },
  { id: 'ellipse', name: 'Круг · Alt — свободно, Shift — ровный круг', icon: 'circle' },
  { id: 'tri', name: 'Треугольник · Alt — свободно, Shift — равносторонний', icon: 'triangle' },
  { id: 'hex', name: 'Шестиугольник · Alt — свободно, Shift — правильный', icon: 'hexagon' },
];
/** Фигуры по рамке: центр c, ширина w, высота h, поворот rot (°). */
export const BOX_SHAPES = ['rect', 'ellipse', 'tri', 'hex'];
/** Шаблоны заклинаний — те же, что у линейки, но остаются на карте (TASK-032). */
export const DRAW_TEMPLATES = [
  { id: 'cone', name: 'Конус', icon: 'cone-01' },
  { id: 'line', name: 'Линия шириной в клетку', icon: 'straight-edge' },
  { id: 'cube', name: 'Куб', icon: 'square' },
  { id: 'sphere', name: 'Сфера', icon: 'circle' },
];
/** Фигуры, которые тянут от точки (прямая и шаблоны). */
export const DRAW_SHAPES = [{ id: 'seg', name: 'Прямая', icon: 'slash' }, ...DRAW_TEMPLATES];

const RAD = Math.PI / 180;
/** Точки фигуры по рамке в её собственных осях (до поворота). Круг — многоугольником для попаданий и рамки. */
function boxLocal(shape, w, h) {
  const a = w / 2, b = h / 2;
  if (shape === 'rect') return [[-a, -b], [a, -b], [a, b], [-a, b]];
  if (shape === 'tri') return [[0, -b], [a, b], [-a, b]];
  if (shape === 'hex') return [[-a, 0], [-a / 2, -b], [a / 2, -b], [a, 0], [a / 2, b], [-a / 2, b]];
  return Array.from({ length: 40 }, (_, i) => { const t = (i / 40) * 2 * Math.PI; return [a * Math.cos(t), b * Math.sin(t)]; });
}
const rotAround = (c, deg) => { const r = deg * RAD, co = Math.cos(r), si = Math.sin(r); return ([x, y]) => ({ x: c.x + x * co - y * si, y: c.y + x * si + y * co }); };
/** Углы рамки фигуры (левый верх, правый верх, правый низ, левый низ) с поворотом. */
export function boxCorners(d) { return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => rotAround(d.c, d.rot || 0)([(sx * d.w) / 2, (sy * d.h) / 2])); }

/** Точки фигуры в координатах карты: прямая — два конца, рамочные — контур, многоугольник — его точки, шаблон — его контур. */
export function shapePoints(grid, d) {
  if (d.shape === 'seg') return [d.a, d.b];
  if (BOX_SHAPES.includes(d.shape)) return boxLocal(d.shape, d.w, d.h).map(rotAround(d.c, d.rot || 0));
  if (d.shape === 'poly') return d.pts || [];
  return templatePolygon(grid, { type: d.shape, origin: d.origin, angle: d.angle || 0, size: d.size });
}
/** Замкнутый ли контур: заливку получают только замкнутые. */
export function isClosed(d) {
  if (d.type === 'line') return !!d.closed;
  if (d.type !== 'shape') return false;
  if (d.shape === 'seg') return false;
  if (d.shape === 'poly') return !!d.closed;
  return true;
}
const isTemplate = (d) => d.type === 'shape' && DRAW_TEMPLATES.some((t) => t.id === d.shape);

/**
 * Стиль рисунка. Новые поля необязательны (TASK-182): width, opacity, dash, fill, fillOpacity.
 * Старые рисунки: обводка 4 px; шаблон без поля fill — заливка его цветом на 18 %, как было.
 */
export function styleOf(d) {
  const closed = isClosed(d), legacy = isTemplate(d) && d.fill == null;
  return {
    color: safeColor(d.color), width: d.width ?? 4, opacity: d.opacity ?? 1, dash: !!d.dash,
    fill: closed ? (legacy ? safeColor(d.color) : d.fill && d.fill !== 'none' ? safeColor(d.fill) : 'none') : 'none',
    fillOpacity: d.fillOpacity ?? (legacy ? 0.18 : 1),
  };
}
function styleCss(d) {
  const s = styleOf(d);
  return `stroke:${s.width > 0 ? s.color : 'none'};stroke-width:${s.width};stroke-opacity:${s.opacity};${s.dash ? `stroke-dasharray:${s.width * 2.5} ${s.width * 2};` : ''}fill:${s.fill};fill-opacity:${s.fillOpacity}`;
}

/** Разметка рисунка (не надписи). cls — классы, attr — атрибуты; hit — зона клика (прозрачная, шире линии). */
export function drawingMarkup(grid, d, cls = '', attr = '', hit = false) {
  const st = hit ? '' : ` style="${esc(styleCss(d))}"`;
  const closed = isClosed(d);
  // Зона клика: обводка всегда, середина — только у замкнутой фигуры в «Выделении» рисования (cls ' fillhit').
  const base = hit ? `draw-hit${closed && cls.includes('fillhit') ? ' fillhit' : ''}` : closed ? 'draw-shape' : 'draw-line';
  if (hit) cls = '';
  if (d.type === 'shape' && d.shape === 'ellipse' && !hit) {
    return `<ellipse cx="${d.c.x}" cy="${d.c.y}" rx="${d.w / 2}" ry="${d.h / 2}" transform="rotate(${d.rot || 0} ${d.c.x} ${d.c.y})" class="${base}${cls}"${st}${attr}/>`;
  }
  const pts = (d.type === 'shape' ? shapePoints(grid, d) : d.pts || []).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return `<${closed ? 'polygon' : 'polyline'} points="${pts}" class="${base}${cls}"${st}${attr}/>`;
}

/** Разметка фигуры (без зоны клика), например живой фигуры, пока её тянут. */
export function shapeMarkup(grid, d, cls = '', attr = '') { return drawingMarkup(grid, d, cls, attr); }

/** Попадает ли точка в фигуру (внутрь или на контур с допуском tol). */
export function nearShape(grid, d, p, tol) {
  const pts = shapePoints(grid, d);
  const closed = isClosed(d);
  if (closed && pointInPolygon(p, pts)) return true;
  const ring = closed ? [...pts, pts[0]] : pts;
  for (let i = 1; i < ring.length; i++) if (distToSegment(p, ring[i - 1], ring[i]) < tol) return true;
  return false;
}

/**
 * Угол и размер фигуры от точки origin до курсора (TASK-042): без привязки к клеткам — размер по 0,5 фт,
 * угол липнет к 45°; Shift — размер по 5 фт и угол по 15°; Alt — угол свободно.
 */
export function aimShape(grid, origin, to, mods = {}) {
  const s = gridSize(grid), feet = grid.feet || 5;
  const ft = (Math.hypot(to.x - origin.x, to.y - origin.y) / s) * feet;
  const size = mods.shift ? Math.max(5, Math.round(ft / 5) * 5) : Math.max(1, Math.round(ft * 2) / 2);
  let deg = (Math.atan2(to.y - origin.y, to.x - origin.x) * 180) / Math.PI;
  if (mods.shift) deg = Math.round(deg / 15) * 15;
  else if (!mods.alt) { const near = Math.round(deg / 45) * 45; if (Math.abs(deg - near) <= 9) deg = near; }
  return { size, angle: Math.round(((deg * Math.PI) / 180) * 1000) / 1000, deg: ((Math.round(deg) % 360) + 360) % 360 };
}

/** Фигура по жесту: от точки нажатия до курсора (свободно, см. aimShape). */
export function shapeFromDrag(grid, shape, from, to, color, mods = {}) {
  if (shape === 'seg') return { type: 'shape', shape, a: { ...from }, b: { ...to }, color };
  const { size, angle } = aimShape(grid, from, to, mods);
  return { type: 'shape', shape, origin: { ...from }, angle, size, color };
}

/** Ручки выделенной фигуры: концы прямой или «кончик» шаблона (тянуть — поворот и размер). */
export function shapeHandles(grid, d) {
  if (d?.type !== 'shape') return [];
  if (d.shape === 'seg') return [{ k: 'a', p: d.a }, { k: 'b', p: d.b }];
  if (!d.origin) return []; // фигуры по рамке и многоугольник — рамка с ручками (drawingFrame)
  const len = ((d.size || 5) / (grid.feet || 5)) * gridSize(grid), a = d.angle || 0;
  return [{ k: 'tip', p: { x: d.origin.x + Math.cos(a) * len, y: d.origin.y + Math.sin(a) * len } }];
}

/** Правка фигуры ручкой k к точке w. Возвращает {patch, label}. */
export function shapeEdit(grid, d, k, w, mods = {}) {
  const r = (v) => Math.round(v * 10) / 10;
  if (k === 'a' || k === 'b') {
    const other = k === 'a' ? d.b : d.a;
    const ft = Math.round((Math.hypot(w.x - other.x, w.y - other.y) / gridSize(grid)) * (grid.feet || 5) * 2) / 2;
    return { patch: { [k]: { x: r(w.x), y: r(w.y) } }, label: `${String(ft).replace('.', ',')} фт` };
  }
  const { size, angle, deg } = aimShape(grid, d.origin, w, mods);
  const ft = String(size).replace('.', ',');
  return { patch: { size, angle }, label: d.shape === 'sphere' ? `радиус ${ft} фт` : `${ft} фт · ${deg}°` };
}

/**
 * Касается ли рисунок рамки r = {x0, y0, x1, y1} (TASK-169, правило Figma): вершина внутри или отрезок пересекает край.
 * Надпись — по её прямоугольнику box (getBBox узла). Рамка целиком внутри фигуры фигуру не берёт.
 */
export function drawingTouchesRect(grid, d, r, box = null) {
  const inR = (p) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;
  if (d.type === 'text') {
    const b = box || { x: d.x, y: d.y - (d.size || 28), width: (d.size || 28) * 0.6 * String(d.text || '').length, height: d.size || 28 };
    return b.x <= r.x1 && b.x + b.width >= r.x0 && b.y <= r.y1 && b.y + b.height >= r.y0;
  }
  const pts = d.type === 'shape' ? shapePoints(grid, d) : d.pts || [];
  if (!pts.length) return false;
  if (pts.some(inR)) return true;
  const ring = isClosed(d) ? [...pts, pts[0]] : pts;
  const edges = [[{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }], [{ x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }], [{ x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }], [{ x: r.x0, y: r.y1 }, { x: r.x0, y: r.y0 }]];
  for (let i = 1; i < ring.length; i++) for (const [a, b] of edges) if (segmentsCross(ring[i - 1], ring[i], a, b)) return true;
  return false;
}
function segmentsCross(p1, p2, p3, p4) {
  const o = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const on = (a, b, c) => Math.min(a.x, b.x) <= c.x && c.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= c.y && c.y <= Math.max(a.y, b.y);
  const d1 = o(p3, p4, p1), d2 = o(p3, p4, p2), d3 = o(p1, p2, p3), d4 = o(p1, p2, p4);
  if (d1 !== d2 && d3 !== d4) return true;
  return (d1 === 0 && on(p3, p4, p1)) || (d2 === 0 && on(p3, p4, p2)) || (d3 === 0 && on(p1, p2, p3)) || (d4 === 0 && on(p1, p2, p4));
}

const POS_KEYS = ['pts', 'x', 'y', 'a', 'b', 'origin', 'c'];
/** Сдвиг группы рисунков: координаты до и после — для одной записи с отменой (TASK-169). */
export function drawingsShift(scene, ids, dx, dy) {
  const before = {}, after = {};
  for (const d of scene.drawings || []) {
    if (!ids.has(d.id) || d.locked) continue; // закреплённый стоит на месте и в группе (TASK-182)
    const s = shiftDrawing(d, dx, dy);
    before[d.id] = {}; after[d.id] = {};
    for (const k of POS_KEYS) if (d[k] != null) { before[d.id][k] = structuredClone(d[k]); after[d.id][k] = s[k]; }
  }
  return { before, after };
}
/** Применить координаты из drawingsShift к сцене. */
export function applyDrawingPos(s, map) {
  for (const d of s.drawings || []) if (map[d.id]) Object.assign(d, structuredClone(map[d.id]));
}

/** Рисунок с учётом того, что сейчас тянут (сдвиг одного или группы, правка ручкой). */
export function liveDrawing(ctx, d) {
  const mv = ctx?.ui.drawMove, ed = ctx?.ui.shapeEdit;
  if (mv && !d.locked && (mv.id === d.id || mv.ids?.has(d.id))) return shiftDrawing(d, mv.dx, mv.dy);
  if (ed?.id === d.id) return { ...d, ...ed.patch };
  return d;
}

export const DRAW_COLORS = [
  { id: '#e9b052', name: 'Золото' },
  { id: '#e5584f', name: 'Кровь' },
  { id: '#5aa9e6', name: 'Лёд' },
  { id: '#6cc070', name: 'Мох' },
  { id: '#f2efe8', name: 'Мел' },
];

/** Кто может трогать рисунок: мастер — любой, игрок — свой. */
export function canEditDrawing(ctx, d) {
  return ctx.isMasterView || d.author === ctx.userId;
}
/** Можно ли двигать, тянуть ручки и стирать: свой и не закреплённый (TASK-182). */
export function canMoveDrawing(ctx, d) { return canEditDrawing(ctx, d) && !d.locked; }

/** Копия рисунка, сдвинутая на dx, dy. */
export function shiftDrawing(d, dx, dy) {
  const r = (v) => Math.round(v * 10) / 10;
  const out = { ...d };
  if (d.pts) out.pts = d.pts.map((p) => ({ x: r(p.x + dx), y: r(p.y + dy) }));
  if (d.x != null) { out.x = r(d.x + dx); out.y = r(d.y + dy); }
  if (d.a) out.a = { x: r(d.a.x + dx), y: r(d.a.y + dy) };
  if (d.origin) out.origin = { x: r(d.origin.x + dx), y: r(d.origin.y + dy) };
  if (d.b) out.b = { x: r(d.b.x + dx), y: r(d.b.y + dy) };
  if (d.c) out.c = { x: r(d.c.x + dx), y: r(d.c.y + dy) };
  return out;
}

function put(ctx, id, after, label, merge = '') {
  const d0 = ctx.scene.drawings.find((x) => x.id === id); if (!d0) return;
  const set = (v) => (s) => { const x = s.drawings.find((q) => q.id === id); if (x) Object.assign(x, structuredClone(v)); };
  // Правки стиля одного рисунка подряд (в течение 2 с) — одна запись отмены (TASK-182).
  const last = ctx.history.done.at(-1), now = Date.now();
  if (merge && last?.merge === `${id}:${merge}` && now - last.at < 2000 && ctx.history.undone.length === 0) {
    const all = { ...last.after, ...structuredClone(after) };
    for (const k of Object.keys(after)) if (!(k in last.before)) last.before[k] = structuredClone(d0[k]);
    ctx.mutateScene(set(after));
    last.after = all; last.redo = set(all); last.undo = set(last.before); last.at = now;
    return;
  }
  const before = Object.fromEntries(Object.keys(after).map((k) => [k, structuredClone(d0[k])]));
  ctx.mutateScene(set(after), { label, undo: set(before), redo: set(after), ...(merge ? { merge: `${id}:${merge}`, at: now, before, after: structuredClone(after) } : {}) });
}

export function moveDrawing(ctx, id, dx, dy) {
  const d = ctx.scene.drawings.find((x) => x.id === id); if (!d || (!dx && !dy)) return;
  const s = shiftDrawing(d, dx, dy);
  const after = {};
  for (const k of POS_KEYS) if (d[k] != null) after[k] = s[k];
  put(ctx, id, after, 'Сдвинуть рисунок');
}

export function updateDrawing(ctx, id, patch, label = 'Рисунок', merge = '') { put(ctx, id, patch, label, merge); }

/** Порядок наложения (TASK-182): поле z, по умолчанию 0 — порядок списка. Поле, а не перестановка, — чтобы дошло до сервера. */
export const zOf = (d) => d.z ?? 0;
export function bringDrawing(ctx, id, front) {
  const zs = ctx.scene.drawings.filter((x) => x.id !== id).map(zOf);
  const z = front ? Math.max(0, ...zs) + 1 : Math.min(0, ...zs) - 1;
  put(ctx, id, { z }, front ? 'Рисунок выше всех' : 'Рисунок ниже всех');
}
/** Копия рисунка на клетку правее и ниже, выделяется она. */
export function duplicateDrawing(ctx, id) {
  const d = ctx.scene.drawings.find((x) => x.id === id); if (!d) return;
  const s = gridSize(ctx.scene.grid);
  const copy = { ...structuredClone(shiftDrawing(d, s, s)), id: uid('d-'), author: ctx.userId };
  delete copy.locked;
  ctx.mutateScene((sc) => { sc.drawings.push(structuredClone(copy)); }, { label: 'Дублировать рисунок', undo: (sc) => { sc.drawings = sc.drawings.filter((x) => x.id !== copy.id); }, redo: (sc) => { sc.drawings.push(structuredClone(copy)); } });
  ctx.selectDrawing(copy.id);
}

export function deleteDrawing(ctx, id) {
  const d = ctx.scene.drawings.find((x) => x.id === id); if (!d) return;
  const copy = structuredClone(d);
  ctx.mutateScene((s) => { s.drawings = s.drawings.filter((x) => x.id !== id); },
    { label: d.type === 'text' ? 'Удалить надпись' : 'Удалить рисунок', undo: (s) => s.drawings.push(structuredClone(copy)), redo: (s) => { s.drawings = s.drawings.filter((x) => x.id !== id); } });
  if (ctx.ui.selDrawing === id) ctx.ui.selDrawing = null;
  ctx.ui.selDrawings?.delete(id);
}

const r1 = (v) => Math.round(v * 10) / 10;
const rp = (p) => ({ x: r1(p.x), y: r1(p.y) });
const ftOf = (grid, px) => Math.round((px / gridSize(grid)) * (grid.feet || 5) * 2) / 2;
const fmt = (v) => String(v).replace('.', ',');

/**
 * Рамка трансформации (TASK-182): у фигур по рамке — повёрнутая рамка, у рисунков от руки и многоугольников —
 * прямоугольник по точкам. У прямой, шаблонов и надписей рамки нет (у них свои ручки).
 */
export function drawingFrame(grid, d) {
  if (d.type === 'shape' && BOX_SHAPES.includes(d.shape)) return { box: true, c: d.c, rot: d.rot || 0, corners: boxCorners(d) };
  const pts = d.type === 'line' || (d.type === 'shape' && d.shape === 'poly') ? d.pts : null;
  if (!pts?.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { box: false, c: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, rot: 0, corners: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] };
}
/** Где ручка поворота: над серединой верхней стороны рамки, на off единиц карты. */
function rotHandle(f, off) {
  const [a, b] = f.corners, r = f.rot * RAD;
  return { x: (a.x + b.x) / 2 + Math.sin(r) * off, y: (a.y + b.y) / 2 - Math.cos(r) * off };
}

/**
 * Правка рамкой: kind 'k0'…'k3' — угол (противоположный стоит; Shift — пропорционально), 'rot' — поворот
 * (липнет к 45°, Shift — по 15°, Alt — свободно). Возвращает {patch, label}.
 */
export function transformEdit(grid, d, kind, w, mods = {}) {
  const f = drawingFrame(grid, d); if (!f) return { patch: {}, label: '' };
  if (kind === 'rot') {
    let deg = Math.atan2(w.y - f.c.y, w.x - f.c.x) / RAD + 90;
    if (mods.shift) deg = Math.round(deg / 15) * 15;
    else if (!mods.alt) { const n = Math.round(deg / 45) * 45; if (Math.abs(deg - n) <= 6) deg = n; }
    deg = ((Math.round(deg) % 360) + 360) % 360;
    if (f.box) return { patch: { rot: deg }, label: `${deg}°` };
    const turn = rotAround(f.c, deg);
    return { patch: { pts: d.pts.map((p) => rp(turn([p.x - f.c.x, p.y - f.c.y]))) }, label: `${deg}°` };
  }
  const k = Number(kind.slice(1)), min = gridSize(grid) * 0.1;
  if (f.box) {
    const SG = [[-1, -1], [1, -1], [1, 1], [-1, 1]][k];
    const r = -(d.rot || 0) * RAD, co = Math.cos(r), si = Math.sin(r);
    const lx = w.x - d.c.x, ly = w.y - d.c.y;
    const F = [(-SG[0] * d.w) / 2, (-SG[1] * d.h) / 2];
    const P = [lx * co - ly * si, lx * si + ly * co];
    let dx = P[0] - F[0], dy = P[1] - F[1];
    if (mods.shift) { const m = Math.max(Math.abs(dx) / d.w, Math.abs(dy) / d.h); dx = (Math.sign(dx) || SG[0]) * d.w * m; dy = (Math.sign(dy) || SG[1]) * d.h * m; }
    const nw = Math.max(min, Math.abs(dx)), nh = Math.max(min, Math.abs(dy));
    const mid = [F[0] + ((Math.sign(dx) || SG[0]) * nw) / 2, F[1] + ((Math.sign(dy) || SG[1]) * nh) / 2];
    return { patch: { c: rp(rotAround(d.c, d.rot || 0)(mid)), w: r1(nw), h: r1(nh) }, label: `${fmt(ftOf(grid, nw))}×${fmt(ftOf(grid, nh))} фт` };
  }
  const H = f.corners[k], F = f.corners[(k + 2) % 4];
  const bw = H.x - F.x, bh = H.y - F.y;
  let sx = bw ? (w.x - F.x) / bw : 1, sy = bh ? (w.y - F.y) / bh : 1;
  if (mods.shift) { const m = Math.max(Math.abs(sx), Math.abs(sy)); sx = (Math.sign(sx) || 1) * m; sy = (Math.sign(sy) || 1) * m; }
  const clampS = (v, len) => (Math.abs(v * len) < min && len ? (Math.sign(v) || 1) * (min / Math.abs(len)) : v);
  sx = clampS(sx, bw); sy = clampS(sy, bh);
  return { patch: { pts: d.pts.map((p) => rp({ x: F.x + (p.x - F.x) * sx, y: F.y + (p.y - F.y) * sy })) }, label: `${fmt(ftOf(grid, Math.abs(bw * sx)))}×${fmt(ftOf(grid, Math.abs(bh * sy)))} фт` };
}

/** Панель выделенного рисунка (TASK-182, как в Owlbear): переместить, заливка, обводка, выше/ниже, дублировать, закрепить, удалить. */
export function renderDrawBar(L, ctx, bbox) {
  const box = L.drawUi;
  const d0 = ctx.ui.selDrawing && !ctx.ui.drawMove ? ctx.scene.drawings.find((x) => x.id === ctx.ui.selDrawing) : null;
  if (!d0 || !bbox || !canEditDrawing(ctx, d0)) { if (box.innerHTML) box.innerHTML = ''; return; }
  const d = liveDrawing(ctx, d0);
  const grid = ctx.scene.grid, z = ctx.camera?.z || 1;
  const free = !d.locked;
  // Ручки прямой и шаблона (TASK-042): тянуть кончик — поворот и размер; у прямой — концы.
  let handles = free ? shapeHandles(grid, d).map((h) => `<button class="gz-h sh-h" data-sh="${h.k}" style="left:${h.p.x}px;top:${h.p.y}px" aria-label="${h.k === 'tip' ? 'Повернуть и изменить размер' : 'Конец прямой'}" data-tip="${h.k === 'tip' ? 'Тянуть — поворот и размер · угол липнет к 45°, Shift — по 15° и 5 фт, Alt — свободно' : 'Тянуть конец'}">${icon(h.k === 'tip' ? 'rotate-clockwise' : 'arrow-all-direction', 16)}</button>`).join('') : '';
  // Рамка с ручками (TASK-182): углы — размер, круглая — поворот.
  const f = free ? drawingFrame(grid, d) : null;
  if (f) {
    const rh = rotHandle(f, 30 / z);
    handles += f.corners.map((p, k) => `<button class="tf-h" data-sh="k${k}" style="left:${p.x}px;top:${p.y}px" aria-label="Размер" data-tip="Тянуть — размер · Shift — пропорционально"></button>`).join('')
      + `<button class="gz-h tf-rot" data-sh="rot" style="left:${rh.x}px;top:${rh.y}px" aria-label="Повернуть" data-tip="Тянуть — поворот · липнет к 45°, Shift — по 15°, Alt — свободно">${icon('rotate-clockwise', 16)}</button>`;
  }
  const ed = ctx.ui.shapeEdit?.id === d.id ? ctx.ui.shapeEdit : null;
  if (ed) {
    const hp = ed.at || shapeHandles(grid, d).find((h) => h.k === ed.k)?.p;
    box.innerHTML = handles + (hp ? `<span class="sh-val" style="left:${hp.x}px;top:${hp.y}px">${esc(ed.label || '')}</span>` : '');
    return;
  }
  const b = (k, ic, tip, extra = '') => `<button class="gz-b ${extra}" data-db="${k}" data-tip="${esc(tip)}" aria-label="${esc(tip)}">${ic}</button>`;
  let inner;
  if (d.locked) inner = b('lock', icon('square-lock-02', 18), 'Закреплён · нажмите, чтобы открепить', 'on');
  else if (d.type === 'text') {
    inner = `<button class="gz-b db-move" data-db="move" data-tip="Тянуть — переместить" aria-label="Переместить">${icon('arrow-all-direction', 18)}</button><span class="db-div"></span>`
      + b('color', fillSwatch(safeColor(d.color)), 'Цвет') + '<span class="db-div"></span>'
      + b('edit', icon('pencil-edit-02', 18), 'Изменить текст') + b('smaller', icon('minus-sign', 18), 'Мельче') + b('bigger', icon('plus-sign', 18), 'Крупнее')
      + '<span class="db-div"></span>' + b('dup', icon('copy-01', 18), 'Дублировать') + b('lock', icon('square-unlock-02', 18), 'Закрепить') + b('del', icon('delete-02', 18), 'Удалить · Del', 'danger');
  } else {
    const st = styleOf(d);
    inner = `<button class="gz-b db-move" data-db="move" data-tip="Тянуть — переместить" aria-label="Переместить">${icon('arrow-all-direction', 18)}</button><span class="db-div"></span>`
      + (isClosed(d) ? b('fill', fillSwatch(st.fill, st.fillOpacity), 'Заливка') : '') + b('stroke', strokeSwatch(st.color, st.width, st.dash), 'Обводка')
      + '<span class="db-div"></span>' + b('front', icon('bring-to-front', 18), 'Выше всех') + b('back', icon('send-to-back', 18), 'Ниже всех')
      + b('dup', icon('copy-01', 18), 'Дублировать') + b('lock', icon('square-unlock-02', 18), 'Закрепить')
      + '<span class="db-div"></span>' + b('del', icon('delete-02', 18), 'Удалить · Del', 'danger');
  }
  box.innerHTML = `${handles}<div class="db" style="transform: translate(${bbox.x + bbox.width / 2}px, ${bbox.y + bbox.height}px)"><div class="gz-bar db-bar">${inner}</div></div>`;
  fitDrawBar(L, ctx);
}

/** Панель рисунка не уходит за край стола (узкий экран, рисунок у края). Зовётся и при движении камеры. */
export function fitDrawBar(L, ctx) {
  const bar = L.drawUi.querySelector('.db-bar'); if (!bar) return;
  bar.style.setProperty('--dx', '0px');
  const r = bar.getBoundingClientRect(), v = ctx.viewport.getBoundingClientRect(), m = 8;
  const dx = r.left < v.left + m || r.width > v.width - 2 * m ? v.left + m - r.left : r.right > v.right - m ? v.right - m - r.right : 0;
  if (dx) bar.style.setProperty('--dx', `${Math.round(dx)}px`);
}

export function attachDrawBar(L, ctx) {
  const box = L.drawUi;
  box.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('[data-sh], [data-db="move"]');
    if (h) { dragHandle(ctx, e, h.dataset.sh || 'move'); return; }
    if (e.target.closest('[data-db]') || e.target.closest('.db-bar')) e.stopPropagation();
  });
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-db]'); if (!b) return;
    e.stopPropagation();
    const id = ctx.ui.selDrawing; const d = ctx.scene.drawings.find((x) => x.id === id); if (!d) return;
    const k = b.dataset.db;
    const styled = (patch) => { updateDrawing(ctx, id, patch, 'Стиль рисунка', 'style'); ctx.invalidate('drawings'); };
    if (k === 'fill' || k === 'stroke') stylePopover(b, k, styleOf(d), styled);
    if (k === 'color') stylePopover(b, 'color', { color: safeColor(d.color) }, styled);
    if (k === 'front' || k === 'back') bringDrawing(ctx, id, k === 'front');
    if (k === 'dup') duplicateDrawing(ctx, id);
    if (k === 'lock') updateDrawing(ctx, id, { locked: d.locked ? undefined : true }, d.locked ? 'Открепить рисунок' : 'Закрепить рисунок');
    if (k === 'bigger' || k === 'smaller') updateDrawing(ctx, id, { size: Math.max(8, Math.min(400, Math.round((d.size || 28) * (k === 'bigger' ? 1.25 : 0.8)))) }, 'Размер надписи');
    if (k === 'edit') { const r = b.getBoundingClientRect(); ctx.panels.textPrompt({ x: d.x, y: d.y }, { x: r.left + r.width / 2, y: r.top }, d); }
    if (k === 'del') deleteDrawing(ctx, id);
    ctx.invalidate('drawings');
  });
}

/** Тянуть ручку или кнопку «переместить» (TASK-042, TASK-182). Слушаем окно: разметка ручек перерисовывается на ходу. */
function dragHandle(ctx, e, kind) {
  e.stopPropagation(); e.preventDefault();
  const id = ctx.ui.selDrawing;
  const d0 = ctx.scene?.drawings.find((x) => x.id === id); if (!d0 || d0.locked) return;
  const w0 = ctx.camera.toWorld(e.clientX, e.clientY);
  const grid = ctx.scene.grid;
  const frame = kind === 'rot' || /^k\d$/.test(kind);
  const move = (ev) => {
    const w = ctx.camera.toWorld(ev.clientX, ev.clientY);
    const mods = { shift: ev.shiftKey, alt: ev.altKey };
    if (kind === 'move') ctx.ui.drawMove = { id, dx: Math.round((w.x - w0.x) * 10) / 10, dy: Math.round((w.y - w0.y) * 10) / 10 };
    else if (frame) ctx.ui.shapeEdit = { id, k: kind, at: w, ...transformEdit(grid, d0, kind, w, mods) };
    else ctx.ui.shapeEdit = { id, k: kind, ...shapeEdit(grid, d0, kind, w, mods) };
    ctx.invalidate('drawings');
  };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    if (kind === 'move') { const mv = ctx.ui.drawMove; ctx.ui.drawMove = null; if (mv && (mv.dx || mv.dy)) moveDrawing(ctx, id, mv.dx, mv.dy); }
    else { const ed = ctx.ui.shapeEdit; ctx.ui.shapeEdit = null; if (ed && Object.keys(ed.patch).length) updateDrawing(ctx, id, ed.patch, kind === 'rot' ? 'Поворот рисунка' : frame ? 'Размер рисунка' : 'Фигура'); }
    ctx.invalidate('drawings');
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
}
