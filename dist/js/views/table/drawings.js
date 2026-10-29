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

/** Фигура по жесту: от точки нажатия до курсора. Размер — по 5 фт (free — по 1 фт). */
export function shapeFromDrag(grid, shape, from, to, color, free = false) {
  if (shape === 'seg') return { type: 'shape', shape, a: { ...from }, b: { ...to }, color };
  const s = gridSize(grid), feet = grid.feet || 5;
  const ft = (Math.hypot(to.x - from.x, to.y - from.y) / s) * feet;
  const size = free ? Math.max(1, Math.round(ft)) : Math.max(5, Math.round(ft / 5) * 5);
  return { type: 'shape', shape, origin: { ...from }, angle: Math.atan2(to.y - from.y, to.x - from.x), size, color };
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
}

/** Панель выделенного рисунка: цвет, (надпись: текст и размер), удалить. */
export function renderDrawBar(L, ctx, bbox) {
  const box = L.drawUi;
  const d = ctx.ui.selDrawing && !ctx.ui.drawMove ? ctx.scene.drawings.find((x) => x.id === ctx.ui.selDrawing) : null;
  if (!d || !bbox) { if (box.innerHTML) box.innerHTML = ''; return; }
  const sw = DRAW_COLORS.map((c) => `<button class="db-sw ${d.color === c.id ? 'on' : ''}" data-db="color" data-v="${c.id}" style="--c:${c.id}" aria-label="${esc(c.name)}" data-tip="${esc(c.name)}"></button>`).join('');
  const text = d.type === 'text'
    ? `<span class="db-div"></span><button class="gz-b" data-db="edit" data-tip="Изменить текст" aria-label="Изменить текст">${icon('pencil-edit-02', 18)}</button><button class="gz-b" data-db="smaller" data-tip="Мельче" aria-label="Мельче">${icon('minus-sign', 18)}</button><button class="gz-b" data-db="bigger" data-tip="Крупнее" aria-label="Крупнее">${icon('plus-sign', 18)}</button>`
    : '';
  box.innerHTML = `<div class="db" style="transform: translate(${bbox.x + bbox.width / 2}px, ${bbox.y + bbox.height}px)"><div class="gz-bar db-bar">${sw}${text}<span class="db-div"></span><button class="gz-b danger" data-db="del" data-tip="Удалить · Del" aria-label="Удалить">${icon('delete-02', 18)}</button></div></div>`;
}

export function attachDrawBar(L, ctx) {
  const box = L.drawUi;
  box.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-db]') || e.target.closest('.db-bar')) e.stopPropagation(); });
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
