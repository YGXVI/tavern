// Туман войны и освещение: что видят игроки.
// Обзор героев (стены перекрывают), источники света (стены тоже), тёмное зрение,
// ручное открытие/скрытие кистью мастера и «исследованные» клетки, которые остаются в полутьме.
import { visibilityPolygon, pointVisible } from '../../rules/vision.js';
import { gridDims, cellCenter, key, gridSize } from '../../rules/geometry.js';
import { tokenStats } from '../../core/campaign.js';
import { LIGHT_COLORS } from '../../data/rules.js';

const ftToPx = (scene, ft) => (ft / (scene.grid.feet || 5)) * gridSize(scene.grid);

/** Все источники света сцены, включая факелы на токенах. */
export function sceneLights(scene, positions = {}) {
  const out = scene.lights.map((l) => ({ ...l, x: l.x, y: l.y }));
  for (const t of scene.tokens) {
    if (!t.light || t.hidden && !positions.includeHidden) continue;
    const p = positions[t.id] || t;
    out.push({ id: `tok-${t.id}`, x: p.x, y: p.y, bright: t.light.bright, dim: t.light.dim, color: t.light.color || 'warm', flicker: t.light.flicker, fromToken: t.id });
  }
  return out;
}

/**
 * Посчитать, что видно.
 * eyes — токены-наблюдатели; positions — временные координаты (при перетаскивании).
 */
export function computeVision(c, scene, eyes, positions = {}) {
  const bounds = { x: 0, y: 0, w: scene.map.width, h: scene.map.height };
  const dark = scene.lighting === 'dark';
  const visions = eyes.map((t) => {
    const p = positions[t.id] || t;
    const st = tokenStats(c, t);
    return { x: p.x, y: p.y, poly: visibilityPolygon(p, scene.walls, bounds), darkvision: st.darkvision ? ftToPx(scene, st.darkvision) : 0, tokenId: t.id };
  });
  const lights = dark ? sceneLights(scene, positions).map((l) => {
    const radius = ftToPx(scene, (l.bright || 0) + (l.dim || 0));
    return { ...l, radius, brightR: ftToPx(scene, l.bright || 0), poly: visibilityPolygon(l, scene.walls, bounds, radius) };
  }) : [];
  const ops = scene.fog.ops || [];
  const revealed = ops.length ? (p) => opsAt(ops, p) : null;
  return { visions, lights, dark, revealed, bounds, mode: scene.fog.mode };
}

/** Результат ручных операций кисти в точке: true — открыто, false — скрыто, null — не трогали. */
function opsAt(ops, p) {
  let state = null;
  for (const op of ops) {
    if (hitOp(op, p)) state = op.type === 'reveal';
  }
  return state === true;
}

export function hiddenByOps(ops, p) {
  let state = null;
  for (const op of ops || []) if (hitOp(op, p)) state = op.type === 'reveal';
  return state === false;
}

function hitOp(op, p) {
  if (op.shape === 'rect') return p.x >= op.x && p.x <= op.x + op.w && p.y >= op.y && p.y <= op.y + op.h;
  for (const q of op.pts) if ((p.x - q.x) ** 2 + (p.y - q.y) ** 2 <= op.r * op.r) return true;
  return false;
}

/** Видит ли игрок точку (для токенов и исследованных клеток). */
export function isVisible(vis, p, scene) {
  if (hiddenByOps(scene.fog.ops, p)) return false;
  if (vis.mode === 'off' && !vis.dark) return true;
  if (vis.mode === 'manual' && !vis.dark) return !!vis.revealed?.(p);
  return pointVisible(p, vis);
}

/** Клетки, которые сейчас видны (для пополнения «исследованного»). */
export function visibleCells(vis, scene) {
  const { cols, rows } = gridDims(scene.grid, scene.map.width, scene.map.height);
  const out = [];
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    const p = cellCenter(scene.grid, c, r);
    if (isVisible(vis, p, scene)) out.push(key(c, r));
  }
  return out;
}

function pathPoly(ctx, poly) {
  ctx.beginPath();
  poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

function drawOps(ctx, ops, type, color = '#000') {
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const op of ops) {
    if (op.type !== type) continue;
    if (op.shape === 'rect') { ctx.fillRect(op.x, op.y, op.w, op.h); continue; }
    ctx.lineWidth = op.r * 2;
    ctx.beginPath();
    op.pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    if (op.pts.length === 1) { ctx.arc(op.pts[0].x, op.pts[0].y, op.r, 0, Math.PI * 2); ctx.fill(); } else ctx.stroke();
  }
}

// Туман мягкий, поэтому считаем его в уменьшенном холсте и растягиваем CSS — так он дешевле при перетаскивании.
const FOG_RES = 1100;
const FOG_RES_HI = 2400;
const GLOW_RES = 800;
const off = { a: null, b: null, c: null };
// Кэш исследованного слоя — по одному на разрешение (покой и перетаскивание).
const eCache = new Map();

function exploredLayer(scene, explored, ops, w, h, k) {
  const hide = ops.filter((o) => o.type === 'hide');
  const g = scene.grid;
  const sig = `${scene.id}|${explored.size}|${hide.map((o) => o.id).join(',')}|${g.size}|${g.offsetX}|${g.offsetY}|${w}x${h}`;
  const slot = eCache.get(`${w}x${h}`) || { key: '', cv: null };
  eCache.set(`${w}x${h}`, slot);
  if (eCache.size > 2) eCache.delete(eCache.keys().next().value);
  if (slot.key === sig && slot.cv) return slot.cv;
  const R = scratch('c', w, h);
  R.ctx.setTransform(k, 0, 0, k, 0, 0);
  R.ctx.fillStyle = '#000';
  R.ctx.beginPath();
  const s = gridSize(g), ox = g.offsetX || 0, oy = g.offsetY || 0;
  for (const kk of explored) { const [c, r] = kk.split(',').map(Number); R.ctx.rect(ox + c * s - 1, oy + r * s - 1, s + 2, s + 2); }
  R.ctx.fill();
  const cv = slot.cv || (slot.cv = document.createElement('canvas'));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = `blur(${Math.max(2, s * k * 0.18)}px)`;
  ctx.drawImage(R.cv, 0, 0);
  ctx.filter = 'none';
  if (hide.length) {
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    drawOps(ctx, hide, 'hide');
    ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  slot.key = sig;
  return cv;
}
function scratch(name, w, h) {
  let cv = off[name];
  if (!cv) cv = off[name] = document.createElement('canvas');
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  return { cv, ctx };
}

/**
 * Нарисовать туман на холсте размером с карту.
 * view: 'player' — как у игроков; 'master' — полупрозрачная подсказка мастеру; 'none'.
 */
export function drawFog(canvas, scene, vis, explored, view, opts = {}) {
  const W = scene.map.width, H = scene.map.height;
  // В покое туман рисуется чётко (до FOG_RES_HI), во время перетаскивания — грубее и быстрее.
  const k = Math.min(1, (opts.hi ? FOG_RES_HI : FOG_RES) / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (view === 'none') return;
  const fogOff = vis.mode === 'off' && !vis.dark;
  const hideOps = (scene.fog.ops || []).some((o) => o.type === 'hide');
  if (fogOff && !hideOps) return;

  // L — что видно сейчас (с учётом света).
  const L = scratch('a', w, h);
  L.ctx.setTransform(k, 0, 0, k, 0, 0);
  if (fogOff) { L.ctx.fillStyle = '#000'; L.ctx.fillRect(0, 0, W, H); }
  else if (vis.dark) {
    for (const l of vis.lights) {
      L.ctx.save(); pathPoly(L.ctx, l.poly); L.ctx.clip();
      const g = L.ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, Math.max(1, l.radius));
      const b = l.radius ? l.brightR / l.radius : 1;
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(Math.max(0, b - 0.04), 'rgba(0,0,0,1)');
      g.addColorStop(Math.min(1, b + 0.02), 'rgba(0,0,0,.62)');
      g.addColorStop(0.94, 'rgba(0,0,0,.5)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      L.ctx.fillStyle = g; L.ctx.beginPath(); L.ctx.arc(l.x, l.y, l.radius, 0, Math.PI * 2); L.ctx.fill();
      L.ctx.restore();
    }
    for (const v of vis.visions) {
      if (!v.darkvision) continue;
      L.ctx.save(); pathPoly(L.ctx, v.poly); L.ctx.clip();
      const g = L.ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, v.darkvision);
      g.addColorStop(0, 'rgba(0,0,0,.6)'); g.addColorStop(0.9, 'rgba(0,0,0,.52)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      L.ctx.fillStyle = g; L.ctx.beginPath(); L.ctx.arc(v.x, v.y, v.darkvision, 0, Math.PI * 2); L.ctx.fill();
      L.ctx.restore();
    }
    // Свет виден, только если он в поле зрения кого-то из героев.
    const V = scratch('b', w, h);
    V.ctx.setTransform(k, 0, 0, k, 0, 0);
    V.ctx.fillStyle = '#000';
    for (const v of vis.visions) { pathPoly(V.ctx, v.poly); V.ctx.fill(); }
    L.ctx.setTransform(1, 0, 0, 1, 0, 0);
    L.ctx.globalCompositeOperation = 'destination-in';
    L.ctx.drawImage(V.cv, 0, 0);
    L.ctx.globalCompositeOperation = 'source-over';
    L.ctx.setTransform(k, 0, 0, k, 0, 0);
  } else if (vis.mode === 'vision') {
    L.ctx.fillStyle = '#000';
    for (const v of vis.visions) { pathPoly(L.ctx, v.poly); L.ctx.fill(); }
  }
  // Ручные операции: открыть поверх, скрыть — вычесть.
  const ops = scene.fog.ops || [];
  if (ops.length) {
    drawOps(L.ctx, ops, 'reveal');
    L.ctx.globalCompositeOperation = 'destination-out';
    drawOps(L.ctx, ops, 'hide');
    L.ctx.globalCompositeOperation = 'source-over';
  }

  // E — исследованные клетки (полутьма). Слой кэшируется: он меняется редко, а размытие дорогое.
  const E = !fogOff && explored?.size ? exploredLayer(scene, explored, ops, w, h, k) : null;

  if (view === 'master') {
    // Мастер видит карту, но понимает, что скрыто от отряда.
    ctx.fillStyle = `rgba(8,10,18,${opts.strong ? 0.72 : 0.5})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-out';
    if (E) { ctx.globalAlpha = 0.35; ctx.drawImage(E, 0, 0); }
    ctx.globalAlpha = 1; ctx.drawImage(L.cv, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    return;
  }
  ctx.fillStyle = 'rgba(0,0,0,0.94)';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-out';
  if (E) { ctx.globalAlpha = 0.42; ctx.drawImage(E, 0, 0); }
  ctx.globalAlpha = 1; ctx.drawImage(L.cv, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
}

/** Тёплое свечение источников (рисуется под туманом, поверх карты). */
export function drawLightGlow(canvas, scene, vis) {
  const W = scene.map.width, H = scene.map.height;
  const k = Math.min(1, GLOW_RES / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!vis.dark) return;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  for (const l of vis.lights) {
    const rgb = (LIGHT_COLORS[l.color] || LIGHT_COLORS.warm).rgb.join(',');
    ctx.save(); pathPoly(ctx, l.poly); ctx.clip();
    const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, Math.max(1, l.radius));
    g.addColorStop(0, `rgba(${rgb},.6)`); g.addColorStop(0.45, `rgba(${rgb},.28)`); g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(l.x, l.y, l.radius, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

export { ftToPx };
