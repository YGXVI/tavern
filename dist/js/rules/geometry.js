// Геометрия сцены: сетка, расстояния по правилам 5e, стены, поиск пути, шаблоны областей.
// Мировые координаты — пиксели исходной картинки карты. Чистые функции, покрыты тестами.
import { sizeById } from '../data/rules.js';

export const key = (c, r) => `${c},${r}`;
export const unkey = (k) => { const [c, r] = k.split(',').map(Number); return { c, r }; };

export function gridSize(grid) { return Math.max(8, Number(grid?.size) || 70); }

export function cellOf(grid, x, y) {
  const s = gridSize(grid);
  return { c: Math.floor((x - (grid.offsetX || 0)) / s), r: Math.floor((y - (grid.offsetY || 0)) / s) };
}

export function cellCenter(grid, c, r) {
  const s = gridSize(grid);
  return { x: (grid.offsetX || 0) + (c + 0.5) * s, y: (grid.offsetY || 0) + (r + 0.5) * s };
}

export function gridDims(grid, width, height) {
  const s = gridSize(grid);
  return {
    cols: Math.max(1, Math.ceil((width - (grid.offsetX || 0)) / s)),
    rows: Math.max(1, Math.ceil((height - (grid.offsetY || 0)) / s)),
  };
}

/** Верхняя левая клетка токена размером n×n, центр которого в точке (x, y). */
export function footprintAt(grid, x, y, n = 1) {
  const s = gridSize(grid);
  return {
    c: Math.round((x - (grid.offsetX || 0)) / s - n / 2),
    r: Math.round((y - (grid.offsetY || 0)) / s - n / 2),
  };
}

/** Центр токена n×n, у которого верхняя левая клетка (c, r). */
export function footprintCenter(grid, c, r, n = 1) {
  const s = gridSize(grid);
  return { x: (grid.offsetX || 0) + (c + n / 2) * s, y: (grid.offsetY || 0) + (r + n / 2) * s };
}

/** Привязка центра токена к сетке: нечётный размер — центр клетки, чётный — узел. */
export function snapCenter(grid, x, y, n = 1) {
  const fp = footprintAt(grid, x, y, n);
  return footprintCenter(grid, fp.c, fp.r, n);
}

/** Доля клетки, в пределах которой токен примагничивается к своему месту на сетке. */
export const MAGNET = 0.28;

/**
 * Полупривязка: свободная точка, но рядом с центром клетки (для n×n — с узлом сетки)
 * токен встаёт ровно в него. hard — привязать всегда.
 */
export function softSnap(grid, p, n = 1, hard = false) {
  const c = snapCenter(grid, p.x, p.y, n);
  if (hard || Math.hypot(p.x - c.x, p.y - c.y) <= gridSize(grid) * MAGNET) return c;
  return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
}

export function footprintCells(c, r, n = 1) {
  const out = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push({ c: c + i, r: r + j });
  return out;
}

/**
 * Расстояние в клетках между клетками.
 * rule '5' — каждая клетка 5 фт, диагонали тоже (PHB по умолчанию);
 * rule '5-10-5' — каждая вторая диагональ стоит вдвое (вариант из DMG).
 */
export function cellDistance(a, b, rule = '5') {
  const dx = Math.abs(a.c - b.c), dy = Math.abs(a.r - b.r);
  const diag = Math.min(dx, dy), straight = Math.max(dx, dy) - diag;
  if (rule === '5-10-5') return straight + diag + Math.floor(diag / 2);
  return Math.max(dx, dy);
}

/** Расстояние между занятыми областями двух токенов (край к краю), в клетках. */
export function footprintGap(a, b, rule = '5') {
  const dx = Math.max(0, a.c - (b.c + b.n - 1), b.c - (a.c + a.n - 1));
  const dy = Math.max(0, a.r - (b.r + b.n - 1), b.r - (a.r + a.n - 1));
  return cellDistance({ c: 0, r: 0 }, { c: dx, r: dy }, rule);
}

// ——— Стены ———
export const WALL_KINDS = {
  wall: { name: 'Стена', move: true, sight: true },
  window: { name: 'Окно', move: true, sight: false },
  invisible: { name: 'Невидимая', move: true, sight: false },
  door: { name: 'Дверь', move: true, sight: true, door: true },
  secret: { name: 'Потайная', move: true, sight: true, door: true },
};

export function wallBlocksMove(w) {
  const k = WALL_KINDS[w.kind] || WALL_KINDS.wall;
  if (k.door) return !w.open;
  return k.move;
}

export function wallBlocksSight(w) {
  const k = WALL_KINDS[w.kind] || WALL_KINDS.wall;
  if (k.door) return !w.open;
  return k.sight;
}

function orient(ax, ay, bx, by, cx, cy) { return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax); }

/** Пересекаются ли отрезки p1p2 и p3p4 (касание концом тоже считается). */
export function segmentsIntersect(p1, p2, p3, p4, eps = 1e-9) {
  const d1 = orient(p3.x, p3.y, p4.x, p4.y, p1.x, p1.y);
  const d2 = orient(p3.x, p3.y, p4.x, p4.y, p2.x, p2.y);
  const d3 = orient(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
  const d4 = orient(p1.x, p1.y, p2.x, p2.y, p4.x, p4.y);
  if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) return true;
  const on = (a, b, c) => Math.min(a.x, b.x) - 1e-6 <= c.x && c.x <= Math.max(a.x, b.x) + 1e-6 && Math.min(a.y, b.y) - 1e-6 <= c.y && c.y <= Math.max(a.y, b.y) + 1e-6;
  if (Math.abs(d1) <= eps && on(p3, p4, p1)) return true;
  if (Math.abs(d2) <= eps && on(p3, p4, p2)) return true;
  if (Math.abs(d3) <= eps && on(p1, p2, p3)) return true;
  if (Math.abs(d4) <= eps && on(p1, p2, p4)) return true;
  return false;
}

export function moveBlocked(p, q, walls = []) {
  for (const w of walls) if (wallBlocksMove(w) && segmentsIntersect(p, q, w.a, w.b)) return true;
  return false;
}

export function sightBlocked(p, q, walls = []) {
  for (const w of walls) if (wallBlocksSight(w) && segmentsIntersect(p, q, w.a, w.b)) return true;
  return false;
}

/** Расстояние от точки до отрезка. */
export function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// ——— Поиск пути ———
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

class Heap {
  constructor() { this.a = []; }
  push(x) { const a = this.a; a.push(x); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a; const top = a[0]; const last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}

/**
 * Обход клеток по правилам движения: 8 направлений, стены, труднопроходимая местность (×2),
 * непроходимые клетки. Возвращает стоимость в клетках-шагах (умножьте на grid.feet).
 * opts: {walls, difficult:Set<key>, blocked:Set<key>, cols, rows, n (размер токена), rule, limit, target}
 */
function explore(grid, start, opts) {
  const { walls = [], difficult = new Set(), blocked = new Set(), cols = 200, rows = 200, n = 1, rule = '5', limit = Infinity, target = null } = opts;
  const startKey = `${start.c},${start.r},0`;
  const best = new Map([[startKey, 0]]);
  const prev = new Map();
  const cellBest = new Map([[key(start.c, start.r), 0]]);
  const heap = new Heap();
  const h = (c, r) => (target ? Math.max(Math.abs(target.c - c), Math.abs(target.r - r)) : 0);
  heap.push({ c: start.c, r: start.r, p: 0, g: 0, f: h(start.c, start.r) });
  const fpDifficult = (c, r) => { for (const x of footprintCells(c, r, n)) if (difficult.has(key(x.c, x.r))) return true; return false; };
  const fpBlocked = (c, r) => {
    if (c < 0 || r < 0 || c + n > cols || r + n > rows) return true;
    for (const x of footprintCells(c, r, n)) if (blocked.has(key(x.c, x.r))) return true;
    return false;
  };
  let found = null;
  while (heap.size) {
    const cur = heap.pop();
    const ck = `${cur.c},${cur.r},${cur.p}`;
    if (cur.g > (best.get(ck) ?? Infinity)) continue;
    if (target && cur.c === target.c && cur.r === target.r) { found = ck; break; }
    const from = footprintCenter(grid, cur.c, cur.r, n);
    for (const [dc, dr] of DIRS) {
      const nc = cur.c + dc, nr = cur.r + dr;
      if (fpBlocked(nc, nr)) continue;
      const to = footprintCenter(grid, nc, nr, n);
      if (moveBlocked(from, to, walls)) continue;
      const diagonal = dc !== 0 && dr !== 0;
      if (diagonal) {
        // Нельзя «срезать» угол стены по диагонали.
        const side1 = footprintCenter(grid, cur.c + dc, cur.r, n), side2 = footprintCenter(grid, cur.c, cur.r + dr, n);
        if (moveBlocked(from, side1, walls) && moveBlocked(from, side2, walls)) continue;
      }
      let step = 1, parity = cur.p;
      if (diagonal && rule === '5-10-5') { step = cur.p ? 2 : 1; parity = cur.p ? 0 : 1; }
      if (fpDifficult(nc, nr)) step *= 2;
      const g = cur.g + step;
      if (g > limit) continue;
      const nk = `${nc},${nr},${parity}`;
      if (g < (best.get(nk) ?? Infinity)) {
        best.set(nk, g);
        prev.set(nk, ck);
        const cellK = key(nc, nr);
        if (g < (cellBest.get(cellK) ?? Infinity)) cellBest.set(cellK, g);
        heap.push({ c: nc, r: nr, p: parity, g, f: g + h(nc, nr) });
      }
    }
  }
  return { cellBest, prev, best, found, startKey };
}

/** Кратчайший путь клетка → клетка. null, если не дойти. */
export function findPath(grid, start, target, opts = {}) {
  if (start.c === target.c && start.r === target.r) return { cells: [{ ...start }], cost: 0 };
  const res = explore(grid, start, { ...opts, target });
  if (!res.found) return null;
  const cells = [];
  let k = res.found;
  while (k) { const [c, r] = k.split(',').map(Number); cells.unshift({ c, r }); k = res.prev.get(k); }
  return { cells, cost: res.best.get(res.found) };
}

/** Все клетки, куда можно дойти не дороже limit шагов. Map<key, стоимость>. */
export function reachable(grid, start, limit, opts = {}) {
  return explore(grid, start, { ...opts, limit }).cellBest;
}

// ——— Шаблоны областей ———
/** Клетки, центр которых попадает в область. shape: {type, origin:{x,y}, angle(рад), size(фт)}. */
export function templateCells(grid, shape, cols, rows) {
  const s = gridSize(grid), feet = grid.feet || 5;
  const len = (shape.size / feet) * s;
  const { origin, angle = 0 } = shape;
  const out = [];
  const half = Math.atan(0.5) + 0.02; // конус: ширина равна длине
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const p = cellCenter(grid, c, r);
      const dx = p.x - origin.x, dy = p.y - origin.y;
      let inside = false;
      if (shape.type === 'sphere') inside = Math.hypot(dx, dy) <= len + 0.5;
      else if (shape.type === 'cone') {
        const d = Math.hypot(dx, dy);
        if (d > 0.5 && d <= len + 0.5) {
          let da = Math.atan2(dy, dx) - angle;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          inside = Math.abs(da) <= half;
        }
      } else if (shape.type === 'line') {
        const t = dx * dir.x + dy * dir.y;
        const perp = Math.abs(-dx * dir.y + dy * dir.x);
        inside = t >= 0 && t <= len + 0.5 && perp <= s / 2;
      } else if (shape.type === 'cube') {
        const poly = templatePolygon(grid, shape);
        inside = pointInPolygon(p, poly);
      }
      if (inside) out.push({ c, r });
    }
  }
  return out;
}

/** Контур шаблона для отрисовки. */
export function templatePolygon(grid, shape) {
  const s = gridSize(grid), feet = grid.feet || 5;
  const len = (shape.size / feet) * s;
  const { origin, angle = 0 } = shape;
  const rot = (x, y) => ({ x: origin.x + x * Math.cos(angle) - y * Math.sin(angle), y: origin.y + x * Math.sin(angle) + y * Math.cos(angle) });
  if (shape.type === 'cone') return [rot(0, 0), rot(len, -len / 2), rot(len, len / 2)];
  if (shape.type === 'line') return [rot(0, -s / 2), rot(len, -s / 2), rot(len, s / 2), rot(0, s / 2)];
  if (shape.type === 'cube') {
    // Куб: одна грань на точке приложения, растёт в сторону курсора.
    return [rot(0, -len / 2), rot(len, -len / 2), rot(len, len / 2), rot(0, len / 2)];
  }
  const pts = [];
  for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; pts.push({ x: origin.x + Math.cos(a) * len, y: origin.y + Math.sin(a) * len }); }
  return pts;
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Клетки, которые занимает токен. token: {x, y, size cells n}. */
export function tokenFootprint(grid, token, n = 1) {
  const fp = footprintAt(grid, token.x, token.y, n);
  return { c: fp.c, r: fp.r, n };
}

/** Свободные клетки рядом с точкой: не заняты токенами, не непроходимы, в пределах карты. */
export function freeSpots(scene, near, count, n = 1, ignore = new Set()) {
  const g = scene.grid;
  const { cols, rows } = gridDims(g, scene.map.width, scene.map.height);
  const taken = new Set(scene.terrain?.blocked || []);
  for (const t of scene.tokens) {
    if (ignore.has(t.id)) continue;
    const tn = sizeById(t.size).cells;
    const fp = footprintAt(g, t.x, t.y, tn);
    for (const x of footprintCells(fp.c, fp.r, tn)) taken.add(key(x.c, x.r));
  }
  const start = footprintAt(g, near.x, near.y, n);
  const out = [];
  const fits = (c, r) => c >= 0 && r >= 0 && c + n <= cols && r + n <= rows && footprintCells(c, r, n).every((x) => !taken.has(key(x.c, x.r)));
  for (let ring = 0; ring < Math.max(cols, rows) && out.length < count; ring++) {
    for (let dr = -ring; dr <= ring && out.length < count; dr++) {
      for (let dc = -ring; dc <= ring && out.length < count; dc++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;
        const c = start.c + dc * n, r = start.r + dr * n;
        if (!fits(c, r)) continue;
        out.push(footprintCenter(g, c, r, n));
        for (const x of footprintCells(c, r, n)) taken.add(key(x.c, x.r));
      }
    }
  }
  while (out.length < count) out.push(footprintCenter(g, start.c, start.r, n));
  return out;
}
