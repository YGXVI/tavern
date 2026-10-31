// Рисунки и надписи как объекты (TASK-031): выделить, сдвинуть, перекрасить, изменить текст, удалить.
import { esc } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { templatePolygon, gridSize, pointInPolygon, distToSegment } from '../../rules/geometry.js';

/** Фигуры для рисования — те же, что у линейки, но остаются на карте (TASK-032). */
export const DRAW_SHAPES = [
  { id: 'seg', name: 'Прямая', icon: 'ruler' },
  { id: 'cone', name: 'Конус', icon: 'cone-01' },
  { id: 'line', name: 'Линия шириной в клетку', icon: 'straight-edge' },
  { id: 'cube', name: 'Куб', icon: 'square' },
  { id: 'sphere', name: 'Сфера', icon: 'circle' },
];

/** Точки фигуры в координатах карты: прямая — два конца, остальное — многоугольник шаблона. */
export function shapePoints(grid, d) {
  if (d.shape === 'seg') return [d.a, d.b];
  return templatePolygon(grid, { type: d.shape, origin: d.origin, angle: d.angle || 0, size: d.size });
}

/** Разметка фигуры (без зоны клика). cls — дополнительные классы. */
export function shapeMarkup(grid, d, cls = '', attr = '') {
  const pts = shapePoints(grid, d).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  if (d.shape === 'seg') return `<polyline points="${pts}" class="draw-line${cls}" stroke="${esc(d.color)}"${attr}/>`;
  return `<polygon points="${pts}" class="draw-shape${cls}" stroke="${esc(d.color)}" fill="${esc(d.color)}"${attr}/>`;
}

/** Попадает ли точка в фигуру (внутрь или на контур с допуском tol). */
export function nearShape(grid, d, p, tol) {
  const pts = shapePoints(grid, d);
  if (d.shape !== 'seg' && pointInPolygon(p, pts)) return true;
  const ring = d.shape === 'seg' ? pts : [...pts, pts[0]];
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
  const ring = d.type === 'shape' && d.shape !== 'seg' ? [...pts, pts[0]] : pts;
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

const POS_KEYS = ['pts', 'x', 'y', 'a', 'b', 'origin'];
/** Сдвиг группы рисунков: координаты до и после — для одной записи с отменой (TASK-169). */
export function drawingsShift(scene, ids, dx, dy) {
  const before = {}, after = {};
  for (const d of scene.drawings || []) {
    if (!ids.has(d.id)) continue;
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
  if (mv && (mv.id === d.id || mv.ids?.has(d.id))) return shiftDrawing(d, mv.dx, mv.dy);
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

/** Копия рисунка, сдвинутая на dx, dy. */
export function shiftDrawing(d, dx, dy) {
  const r = (v) => Math.round(v * 10) / 10;
  const out = { ...d };
  if (d.pts) out.pts = d.pts.map((p) => ({ x: r(p.x + dx), y: r(p.y + dy) }));
  if (d.x != null) { out.x = r(d.x + dx); out.y = r(d.y + dy); }
  if (d.a) out.a = { x: r(d.a.x + dx), y: r(d.a.y + dy) };
  if (d.origin) out.origin = { x: r(d.origin.x + dx), y: r(d.origin.y + dy) };
  if (d.b) out.b = { x: r(d.b.x + dx), y: r(d.b.y + dy) };
  return out;
}

function put(ctx, id, after, label) {
  const d0 = ctx.scene.drawings.find((x) => x.id === id); if (!d0) return;
  const before = Object.fromEntries(Object.keys(after).map((k) => [k, structuredClone(d0[k])]));
  const set = (v) => (s) => { const x = s.drawings.find((q) => q.id === id); if (x) Object.assign(x, structuredClone(v)); };
  ctx.mutateScene(set(after), { label, undo: set(before), redo: set(after) });
}

export function moveDrawing(ctx, id, dx, dy) {
  const d = ctx.scene.drawings.find((x) => x.id === id); if (!d || (!dx && !dy)) return;
  const s = shiftDrawing(d, dx, dy);
  const after = {};
  for (const k of ['pts', 'x', 'y', 'a', 'b', 'origin']) if (d[k] != null) after[k] = s[k];
  put(ctx, id, after, 'Сдвинуть рисунок');
}

export function updateDrawing(ctx, id, patch, label = 'Рисунок') { put(ctx, id, patch, label); }

export function deleteDrawing(ctx, id) {
  const d = ctx.scene.drawings.find((x) => x.id === id); if (!d) return;
  const copy = structuredClone(d);
  ctx.mutateScene((s) => { s.drawings = s.drawings.filter((x) => x.id !== id); },
    { label: d.type === 'text' ? 'Удалить надпись' : 'Удалить рисунок', undo: (s) => s.drawings.push(structuredClone(copy)), redo: (s) => { s.drawings = s.drawings.filter((x) => x.id !== id); } });
  if (ctx.ui.selDrawing === id) ctx.ui.selDrawing = null;
  ctx.ui.selDrawings?.delete(id);
}

/** Панель выделенного рисунка: цвет, (надпись: текст и размер), удалить. */
export function renderDrawBar(L, ctx, bbox) {
  const box = L.drawUi;
  const d0 = ctx.ui.selDrawing && !ctx.ui.drawMove ? ctx.scene.drawings.find((x) => x.id === ctx.ui.selDrawing) : null;
  if (!d0 || !bbox) { if (box.innerHTML) box.innerHTML = ''; return; }
  const d = liveDrawing(ctx, d0);
  // Ручки фигуры (TASK-042): тянуть кончик — поворот и размер; у прямой — концы.
  const handles = shapeHandles(ctx.scene.grid, d).map((h) => `<button class="gz-h sh-h" data-sh="${h.k}" style="left:${h.p.x}px;top:${h.p.y}px" aria-label="${h.k === 'tip' ? 'Повернуть и изменить размер' : 'Конец прямой'}" data-tip="${h.k === 'tip' ? 'Тянуть — поворот и размер · угол липнет к 45°, Shift — по 15° и 5 фт, Alt — свободно' : 'Тянуть конец'}">${icon(h.k === 'tip' ? 'rotate-clockwise' : 'arrow-all-direction', 16)}</button>`).join('');
  const ed = ctx.ui.shapeEdit?.id === d.id ? ctx.ui.shapeEdit : null;
  const hp = ed && shapeHandles(ctx.scene.grid, d).find((h) => h.k === ed.k);
  const val = ed && hp ? `<span class="sh-val" style="left:${hp.p.x}px;top:${hp.p.y}px">${esc(ed.label || '')}</span>` : '';
  if (ed) { box.innerHTML = handles + val; return; }
  const sw = DRAW_COLORS.map((c) => `<button class="db-sw ${d.color === c.id ? 'on' : ''}" data-db="color" data-v="${c.id}" style="--c:${c.id}" aria-label="${esc(c.name)}" data-tip="${esc(c.name)}"></button>`).join('');
  const text = d.type === 'text'
    ? `<span class="db-div"></span><button class="gz-b" data-db="edit" data-tip="Изменить текст" aria-label="Изменить текст">${icon('pencil-edit-02', 18)}</button><button class="gz-b" data-db="smaller" data-tip="Мельче" aria-label="Мельче">${icon('minus-sign', 18)}</button><button class="gz-b" data-db="bigger" data-tip="Крупнее" aria-label="Крупнее">${icon('plus-sign', 18)}</button>`
    : '';
  const mover = `<button class="gz-b db-move" data-db="move" data-tip="Тянуть — переместить" aria-label="Переместить">${icon('arrow-all-direction', 18)}</button><span class="db-div"></span>`;
  box.innerHTML = `${handles}<div class="db" style="transform: translate(${bbox.x + bbox.width / 2}px, ${bbox.y + bbox.height}px)"><div class="gz-bar db-bar">${mover}${sw}${text}<span class="db-div"></span><button class="gz-b danger" data-db="del" data-tip="Удалить · Del" aria-label="Удалить">${icon('delete-02', 18)}</button></div></div>`;
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
    if (k === 'color') updateDrawing(ctx, id, { color: b.dataset.v }, 'Цвет');
    if (k === 'bigger' || k === 'smaller') updateDrawing(ctx, id, { size: Math.max(8, Math.min(400, Math.round((d.size || 28) * (k === 'bigger' ? 1.25 : 0.8)))) }, 'Размер надписи');
    if (k === 'edit') { const r = b.getBoundingClientRect(); ctx.panels.textPrompt({ x: d.x, y: d.y }, { x: r.left + r.width / 2, y: r.top }, d); }
    if (k === 'del') deleteDrawing(ctx, id);
    ctx.invalidate('drawings');
  });
}

/** Тянуть ручку фигуры или кнопку «переместить» (TASK-042). Слушаем окно: разметка ручек перерисовывается на ходу. */
function dragHandle(ctx, e, kind) {
  e.stopPropagation(); e.preventDefault();
  const id = ctx.ui.selDrawing;
  const d0 = ctx.scene?.drawings.find((x) => x.id === id); if (!d0) return;
  const w0 = ctx.camera.toWorld(e.clientX, e.clientY);
  const grid = ctx.scene.grid;
  const move = (ev) => {
    const w = ctx.camera.toWorld(ev.clientX, ev.clientY);
    if (kind === 'move') ctx.ui.drawMove = { id, dx: Math.round((w.x - w0.x) * 10) / 10, dy: Math.round((w.y - w0.y) * 10) / 10 };
    else { const r = shapeEdit(grid, d0, kind, w, { shift: ev.shiftKey, alt: ev.altKey }); ctx.ui.shapeEdit = { id, k: kind, ...r }; }
    ctx.invalidate('drawings');
  };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    if (kind === 'move') { const mv = ctx.ui.drawMove; ctx.ui.drawMove = null; if (mv && (mv.dx || mv.dy)) moveDrawing(ctx, id, mv.dx, mv.dy); }
    else { const ed = ctx.ui.shapeEdit; ctx.ui.shapeEdit = null; if (ed) updateDrawing(ctx, id, ed.patch, 'Фигура'); }
    ctx.invalidate('drawings');
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
}
