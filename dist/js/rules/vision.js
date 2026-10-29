// Обзор и свет: многоугольник видимости из точки с учётом стен (алгоритм лучей к концам отрезков).
import { wallBlocksSight, pointInPolygon } from './geometry.js';

function raySegment(ox, oy, dx, dy, s) {
  // Луч O + t*D, отрезок A + u*(B-A); t >= 0, 0 <= u <= 1
  const sx = s.b.x - s.a.x, sy = s.b.y - s.a.y;
  const den = dx * sy - dy * sx;
  if (Math.abs(den) < 1e-12) return Infinity;
  const ax = s.a.x - ox, ay = s.a.y - oy;
  const t = (ax * sy - ay * sx) / den;
  const u = (ax * dy - ay * dx) / den;
  if (t < 0 || u < -1e-9 || u > 1 + 1e-9) return Infinity;
  return t;
}

/**
 * Многоугольник видимости.
 * walls — стены сцены; bounds — {x, y, w, h} (обычно размер карты); radius — ограничение (необязательно).
 * Возвращает массив точек по углу.
 */
export function visibilityPolygon(origin, walls, bounds, radius = Infinity) {
  const segs = walls.filter(wallBlocksSight).map((w) => ({ a: w.a, b: w.b }));
  const { x = 0, y = 0, w, h } = bounds;
  const pad = 2;
  const box = [
    { x: x - pad, y: y - pad }, { x: x + w + pad, y: y - pad },
    { x: x + w + pad, y: y + h + pad }, { x: x - pad, y: y + h + pad },
  ];
  for (let i = 0; i < 4; i++) segs.push({ a: box[i], b: box[(i + 1) % 4] });
  if (Number.isFinite(radius)) {
    // Отсекаем лишние стены далеко за радиусом — ускоряет большие сцены.
    const r2 = (radius * 1.5) ** 2;
    for (let i = segs.length - 5; i >= 0; i--) {
      const s = segs[i];
      const near = (p) => (p.x - origin.x) ** 2 + (p.y - origin.y) ** 2 < r2;
      if (!near(s.a) && !near(s.b) && distPointSeg(origin, s.a, s.b) ** 2 > r2) segs.splice(i, 1);
    }
  }
  const angles = new Set();
  for (const s of segs) {
    for (const p of [s.a, s.b]) {
      const a = Math.atan2(p.y - origin.y, p.x - origin.x);
      angles.add(a - 1e-5); angles.add(a); angles.add(a + 1e-5);
    }
  }
  if (Number.isFinite(radius)) for (let i = 0; i < 32; i++) angles.add(-Math.PI + (i / 32) * Math.PI * 2);
  const pts = [];
  for (const a of [...angles].sort((p, q) => p - q)) {
    const dx = Math.cos(a), dy = Math.sin(a);
    let best = Infinity;
    for (const s of segs) { const t = raySegment(origin.x, origin.y, dx, dy, s); if (t < best) best = t; }
    if (!Number.isFinite(best)) continue;
    if (best > radius) best = radius;
    pts.push({ x: origin.x + dx * best, y: origin.y + dy * best, a });
  }
  return pts;
}

function distPointSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function inPolygon(p, poly) { return poly && poly.length > 2 && pointInPolygon(p, poly); }

/**
 * Видна ли точка игрокам сцены.
 * ctx: {visions:[{poly, darkvision(px)}], lights:[{poly, x, y, radius(px)}], dark:boolean, revealed:(p)=>bool}
 */
export function pointVisible(p, ctx) {
  if (ctx.revealed?.(p)) return true;
  const seen = ctx.visions.some((v) => inPolygon(p, v.poly));
  if (!seen) return false;
  if (!ctx.dark) return true;
  if (ctx.visions.some((v) => v.darkvision > 0 && Math.hypot(p.x - v.x, p.y - v.y) <= v.darkvision && inPolygon(p, v.poly))) return true;
  return ctx.lights.some((l) => Math.hypot(p.x - l.x, p.y - l.y) <= l.radius && inPolygon(p, l.poly));
}
