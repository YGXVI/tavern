// Объёмные кубы (TASK-092): геометрия, физика и WebGL — без сторонних библиотек.
// Число выпадения решает общий движок (rollPool). Здесь бросок сначала просчитывается без экрана,
// метки граней переставляются так, чтобы сверху оказалось нужное число, и запись проигрывается.
// Кубы, положенные в лоток до броска, падают и катятся вживую.

// ——— Векторы и кватернионы ———
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qnorm = (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
const qaxis = (axis, ang) => { const s = Math.sin(ang / 2); const a = norm(axis); return [a[0] * s, a[1] * s, a[2] * s, Math.cos(ang / 2)]; };
function qrot(q, v) {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
function qslerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = b.map((x) => -x); d = -d; }
  if (d > 0.9995) return qnorm(a.map((x, i) => x + (b[i] - x) * t));
  const th = Math.acos(d), s = Math.sin(th);
  const ka = Math.sin((1 - t) * th) / s, kb = Math.sin(t * th) / s;
  return a.map((x, i) => x * ka + b[i] * kb);
}
function randomQuat() {
  const u = Math.random(), v = Math.random(), w = Math.random();
  return [Math.sqrt(1 - u) * Math.sin(2 * Math.PI * v), Math.sqrt(1 - u) * Math.cos(2 * Math.PI * v), Math.sqrt(u) * Math.sin(2 * Math.PI * w), Math.sqrt(u) * Math.cos(2 * Math.PI * w)];
}

// ——— Геометрия кубов ———
const PHI = (1 + Math.sqrt(5)) / 2;
function rawVerts(kind) {
  const p = [];
  // к4 — кристалл (TASK-136): четырёхгранная призма вдоль оси y с заострёнными концами. Числа на длинных гранях;
  // на остриё кристалл не встаёт — центр тяжести выходит за грань острия, и он ложится на длинную грань.
  if (kind === 4) {
    const a = 0.5, h = 0.72, tip = 0.42;
    for (const y of [-h, h]) for (const [x, z] of [[a, a], [a, -a], [-a, -a], [-a, a]]) p.push([x, y, z]);
    p.push([0, h + tip, 0], [0, -h - tip, 0]);
    return p;
  }
  if (kind === 6) { for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) p.push([x, y, z]); return p; }
  if (kind === 8) return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  if (kind === 12) {
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) p.push([x, y, z]);
    for (const a of [-1, 1]) for (const b of [-1, 1]) { p.push([0, a / PHI, b * PHI]); p.push([a / PHI, b * PHI, 0]); p.push([a * PHI, 0, b / PHI]); }
    return p;
  }
  if (kind === 20) {
    for (const a of [-1, 1]) for (const b of [-1, 1]) { p.push([0, a, b * PHI]); p.push([a, b * PHI, 0]); p.push([a * PHI, 0, b]); }
    return p;
  }
  // к10 — пятиугольный трапецоэдр: вершина сверху, вершина снизу и пояс из десяти точек на двух высотах.
  const h = 0.105;
  for (let i = 0; i < 10; i++) { const a = (i * Math.PI) / 5; p.push([Math.cos(a), i % 2 ? -h : h, Math.sin(a)]); }
  const n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
  const apex = dot(n, p[0]) / n[1];
  p.push([0, Math.abs(apex), 0], [0, -Math.abs(apex), 0]);
  return p;
}

/** Грани выпуклого многогранника: плоскости, на которые опираются все вершины. */
function hullFaces(verts) {
  const faces = [], eps = 1e-6;
  const n = verts.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
    let nv = cross(sub(verts[j], verts[i]), sub(verts[k], verts[i]));
    if (len(nv) < 1e-9) continue;
    nv = norm(nv);
    let d = dot(nv, verts[i]);
    if (d < 0) { nv = mul(nv, -1); d = -d; }
    if (verts.some((v) => dot(nv, v) > d + 1e-5)) continue;
    if (faces.some((f) => dot(f.n, nv) > 1 - eps)) continue;
    const on = verts.map((v, idx) => [v, idx]).filter(([v]) => Math.abs(dot(nv, v) - d) < 1e-5).map(([, idx]) => idx);
    const c = mul(on.reduce((s, idx) => add(s, verts[idx]), [0, 0, 0]), 1 / on.length);
    const ref = norm(sub(verts[on[0]], c)), side = cross(nv, ref);
    on.sort((a, b) => {
      const va = sub(verts[a], c), vb = sub(verts[b], c);
      return Math.atan2(dot(va, side), dot(va, ref)) - Math.atan2(dot(vb, side), dot(vb, ref));
    });
    faces.push({ idx: on, n: nv, c, d });
  }
  return faces;
}

// Размер (радиус описанной сферы) в единицах лотка, по просьбам sol0139 (TASK-139, TASK-142) —
// радиус равного шара: к4 0,59, к8 0,62, к10 0,65, к6 0,66, к12 0,66, к20 0,76.
const SIZE = { 4: 0.9, 6: 0.92, 8: 0.91, 10: 0.84, 12: 0.76, 20: 0.9 };
const GEO = {};
function geometry(kind) {
  if (GEO[kind]) return GEO[kind];
  let v = rawVerts(kind);
  const r = Math.max(...v.map(len));
  v = v.map((p) => mul(p, SIZE[kind] / r));
  const faces = hullFaces(v);
  for (const f of faces) {
    // Направление «вверх» для числа на грани.
    const P = f.idx.map((i) => v[i]);
    let up;
    if (kind === 6) up = norm(sub(mul(add(P[0], P[1]), 0.5), f.c));
    else if (kind === 4 && Math.abs(f.n[1]) < 1e-6) up = [0, 1, 0]; // к4: число вдоль кристалла
    else if (kind === 10) { const far = P.reduce((a, b) => (len(sub(b, f.c)) > len(sub(a, f.c)) ? b : a)); up = norm(sub(far, f.c)); }
    else up = norm(sub(P[0], f.c));
    f.up = up; f.right = cross(up, f.n);
    f.R = Math.max(...P.map((p) => len(sub(p, f.c))));
    // Радиус вписанной окружности грани — для размера цифр.
    f.r = Math.min(...P.map((p, i) => { const q = P[(i + 1) % P.length]; const e = norm(sub(q, p)); const w = sub(f.c, p); return len(sub(w, mul(e, dot(w, e)))); }));
  }
  const R = Math.max(...v.map(len));
  // Грани с числами по порядку меток: у к4 — только длинные (острия без чисел), у остальных — все.
  const numbered = kind === 4 ? faces.map((f, i) => (Math.abs(f.n[1]) < 1e-6 ? i : -1)).filter((i) => i >= 0) : faces.map((_, i) => i);
  // Точки касания соседей: вершины и середины рёбер (TASK-139). Только вершины пропускали скрещённые рёбра —
  // кубы в куче проходили друг сквозь друга, особенно длинный к4 и к10.
  const seen = new Set(), probes = v.slice();
  for (const f of faces) f.idx.forEach((a, i) => {
    const b = f.idx[(i + 1) % f.idx.length], k = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (!seen.has(k)) { seen.add(k); probes.push(mul(add(v[a], v[b]), 0.5)); }
  });
  GEO[kind] = { verts: v, faces, numbered, probes, R, inertia: 0.4 * R * R };
  return GEO[kind];
}

/** Подписи граней по умолчанию. kind: 4 | 6 | 8 | 10 | 12 | 20 | 'd10u' (к100: единицы 0–9) | 'd10t' (к100: десятки 00–90). */
function defaultLabels(kind) {
  if (kind === 'd10u') return Array.from({ length: 10 }, (_, i) => i);
  if (kind === 'd10t') return Array.from({ length: 10 }, (_, i) => i * 10);
  const n = kind === 4 ? 4 : kind;
  return Array.from({ length: n }, (_, i) => i + 1);
}
const shapeOf = (kind) => (kind === 'd10u' || kind === 'd10t' ? 10 : kind);
const labelText = (kind, v) => (v === '?' ? '?' : kind === 'd10t' ? String(v).padStart(2, '0') : String(v));

// ——— Тело куба ———
let nextId = 1;
function makeBody(kind, opts = {}) {
  const shape = shapeOf(kind);
  const g = geometry(shape);
  return {
    id: nextId++, kind, shape, g,
    labels: defaultLabels(kind),
    x: opts.x || [0, 3, 0], v: opts.v || [0, 0, 0], q: opts.q || randomQuat(), w: opts.w || [0, 0, 0],
    asleep: false, still: 0, nudges: 0,
    skin: opts.skin || DEFAULT_SKIN, alpha: 1, glow: null, tex: null, texDirty: true, buf: null,
  };
}
// Материал по умолчанию — тёмный камень; наборы приходят из dice-art.js (поля light/base/dark/ink/spec/metal/lum).
const DEFAULT_SKIN = { id: 'obsidian', light: '#5d606e', base: '#2e3038', dark: '#16171c', ink: '#f2ead8', spec: 0.6, metal: 0.18, lum: 1 };

/** Номер метки, которую куб показывает сейчас: верхняя из граней с числами (у к4 — верхняя длинная грань). */
function topIndex(b) {
  let best = 0, bd = -Infinity;
  b.g.numbered.forEach((fi, i) => { const d = qrot(b.q, b.g.faces[fi].n)[1]; if (d > bd) { bd = d; best = i; } });
  return best;
}
/** Высота нижней вершины куба над дном при повороте q (0 — касается стола; заметно больше — лежит на соседе). */
function lowest(b, q = b.q) {
  return b.x[1] + Math.min(...b.g.verts.map((p) => qrot(q, p)[1]));
}
/** Насколько куб лежит на грани: косинус между нижней гранью и вертикалью (1 — ровно). */
function flatness(b) {
  return Math.max(...b.g.faces.map((f) => -qrot(b.q, f.n)[1]));
}
/** Поворот, после которого куб ровно лежит на ближайшей к низу грани (к4 — на длинной: на остриё не ложится). */
function alignedQuat(b) {
  let best = null, bd = -Infinity;
  for (const fi of b.g.numbered) { const n = qrot(b.q, b.g.faces[fi].n); if (-n[1] > bd) { bd = -n[1]; best = n; } }
  const down = [0, -1, 0];
  const axis = cross(best, down), s = len(axis), c = dot(best, down);
  if (s < 1e-7) return c > 0 ? b.q : qnorm(qmul(qaxis([1, 0, 0], Math.PI), b.q));
  return qnorm(qmul(qaxis(axis, Math.atan2(s, c)), b.q));
}

// ——— Физика ———
const G = -38, DT = 1 / 240, SUBSTEPS = 4;
const FLOOR = { e: 0.32, mu: 0.42 }, WALL = { e: 0.45, mu: 0.25 };

// ——— Звук ударов (TASK-145) ———
// Удары записываются при просчёте броска (кадр, вид, скорость) и звучат при проигрывании в тот же кадр.
// Звук синтезируется Web Audio — без файлов и чужих записей.
let hitLog = null; // { frame, byKey: Map } — во время просчёта
function noteHit(b, kind, v) {
  if (!hitLog || v < 1.3) return;
  const k = `${hitLog.frame}|${b.id}|${kind}`;
  const was = hitLog.byKey.get(k);
  if (!was || was.v < v) hitLog.byKey.set(k, { f: hitLog.frame, kind, v, die: b.shape });
}
let actx = null, noiseBuf = null, soundOn = true;
/** Звук кубов вкл/выкл (на эту вкладку). */
export function setDiceSound(on) { soundOn = !!on; }
export function diceSoundOn() { return soundOn; }
function audio() {
  if (!soundOn) return null;
  try {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
      noiseBuf = actx.createBuffer(1, Math.round(actx.sampleRate * 0.25), actx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    return actx.state === 'running' ? actx : null;
  } catch { return null; }
}
/**
 * Один удар: «щелчок» куба о куб — короткий и звонкий; о дно лотка (сукно на дереве) — глухой стук;
 * о борт — деревянный. Громкость — от скорости удара, высота чуть плавает, чтобы удары не звучали одинаково.
 */
function playHit(kind, v, vol = 1, die = 20) {
  const ac = audio(); if (!ac) return;
  const g0 = Math.min(1, Math.max(0, (v - 1.3) / 11)) ** 0.8 * vol;
  if (g0 < 0.02) return;
  const t = ac.currentTime + 0.005, r = () => 0.85 + Math.random() * 0.3;
  const small = die === 4 || die === 6 ? 1.12 : die === 20 || die === 12 ? 0.92 : 1;
  const out = ac.createGain(); out.connect(ac.destination);
  // Шум через полосовой фильтр — «тело» удара.
  const src = ac.createBufferSource(); src.buffer = noiseBuf;
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass';
  const ng = ac.createGain();
  let f, q, dec, peak;
  if (kind === 'dice') { f = 3200 * r() * small; q = 7; dec = 0.045; peak = 0.5; }
  else if (kind === 'wall') { f = 1300 * r(); q = 4; dec = 0.07; peak = 0.45; }
  else { f = 750 * r() * small; q = 2.2; dec = 0.09; peak = 0.6; }
  bp.frequency.value = f; bp.Q.value = q;
  ng.gain.setValueAtTime(peak * g0, t); ng.gain.exponentialRampToValueAtTime(0.0008, t + dec);
  src.connect(bp); bp.connect(ng); ng.connect(out);
  src.start(t, Math.random() * 0.15, dec + 0.02);
  // Короткий тон — «щёлк» кости или «тук» дерева.
  const osc = ac.createOscillator(); osc.type = 'triangle';
  const og = ac.createGain();
  const tone = kind === 'dice' ? 2400 * r() * small : kind === 'wall' ? 520 * r() : 210 * r() * small;
  osc.frequency.setValueAtTime(tone, t); osc.frequency.exponentialRampToValueAtTime(tone * 0.7, t + dec);
  og.gain.setValueAtTime((kind === 'dice' ? 0.18 : 0.35) * g0, t); og.gain.exponentialRampToValueAtTime(0.0008, t + dec * 0.8);
  osc.connect(og); og.connect(out);
  osc.start(t); osc.stop(t + dec + 0.02);
}

function applyImpulse(b, r, J) {
  b.v = add(b.v, J);
  b.w = add(b.w, mul(cross(r, J), 1 / b.g.inertia));
}

function contactPlane(b, n, off, mat, verts) {
  // Плоскость n·p >= off: последовательные импульсы с накоплением (как в PGS), трение по Кулону.
  let deepest = 0, hit = 0;
  const cs = [];
  for (const p of verts) {
    const pen = off - dot(n, p);
    if (pen <= 0) continue;
    if (pen > deepest) deepest = pen;
    const r = sub(p, b.x);
    const rn = cross(r, n);
    const vn0 = dot(add(b.v, cross(b.w, r)), n);
    if (-vn0 > hit) hit = -vn0;
    cs.push({ r, k: 1 + dot(rn, rn) / b.g.inertia, target: vn0 < -2 ? -mat.e * vn0 : 0, acc: 0, tacc: [0, 0, 0] });
  }
  if (!cs.length) return false;
  noteHit(b, mat === FLOOR ? 'floor' : 'wall', hit);
  for (let it = 0; it < 6; it++) for (const c of cs) {
    const vel = add(b.v, cross(b.w, c.r));
    const vn = dot(vel, n);
    let j = (c.target - vn) / c.k;
    const acc = Math.max(0, c.acc + j);
    j = acc - c.acc; c.acc = acc;
    if (j) applyImpulse(b, c.r, mul(n, j));
    const vel2 = add(b.v, cross(b.w, c.r));
    const vt = sub(vel2, mul(n, dot(vel2, n)));
    const vtl = len(vt);
    if (vtl > 1e-6) {
      const t = mul(vt, 1 / vtl);
      const rt = cross(c.r, t);
      const kt = 1 + dot(rt, rt) / b.g.inertia;
      const jt = Math.min(vtl / kt, mat.mu * c.acc);
      applyImpulse(b, c.r, mul(t, -jt));
    }
  }
  b.x = add(b.x, mul(n, deepest * 0.8));
  return true;
}

function worldVerts(b) { return b.g.verts.map((p) => add(b.x, qrot(b.q, p))); }
function worldProbes(b) { return b.g.probes.map((p) => add(b.x, qrot(b.q, p))); }
/** Насколько глубоко a вошёл в b: {pen, n} (n — наружу из b, мир) или null. */
function overlap(a, b) {
  const d = sub(b.x, a.x);
  if (dot(d, d) > (a.g.R + b.g.R) ** 2) return null;
  let best = null;
  for (const [A, B, sgn] of [[a, b, 1], [b, a, -1]]) {
    const qi = qinv(B.q);
    for (const p of worldProbes(A)) {
      const lp = qrot(qi, sub(p, B.x));
      let pen = Infinity, nf = null;
      for (const f of B.g.faces) { const k = f.d - dot(f.n, lp); if (k < 0) { pen = -1; break; } if (k < pen) { pen = k; nf = f.n; } }
      if (pen > 0 && nf && (!best || pen > best.pen)) best = { pen, n: mul(qrot(B.q, nf), sgn) };
    }
  }
  return best;
}
/** Вернуть куб внутрь стенок площадки и не ниже дна (по настоящим вершинам, без поворота). */
function keepInside(b, bounds) {
  const hw = bounds.w / 2 - 0.35, hd = bounds.d / 2 - 0.35;
  const vs = worldVerts(b);
  const lo = (k) => Math.min(...vs.map((p) => p[k])), hi = (k) => Math.max(...vs.map((p) => p[k]));
  const x0 = -hw + (bounds.left || 0), x1 = hw - (bounds.right || 0), z0 = -hd + (bounds.top || 0), z1 = hd - (bounds.bottom || 0);
  let dx = 0, dz = 0;
  if (lo(0) < x0) dx = x0 - lo(0); else if (hi(0) > x1) dx = x1 - hi(0);
  if (lo(2) < z0) dz = z0 - lo(2); else if (hi(2) > z1) dz = z1 - hi(2);
  const dy = Math.max(0, -lo(1));
  if (dx || dy || dz) b.x = [b.x[0] + dx, b.x[1] + dy, b.x[2] + dz];
}
/**
 * Развести кубы, вошедшие друг в друга к концу броска (куча в тесном лотке): сдвиг без поворота,
 * не ниже дна и не за стенки. Если места внизу нет, куб поднимается на соседей (TASK-146).
 */
function separate(list, bounds, iters = 120) {
  for (let it = 0; it < iters; it++) {
    let any = false;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const o = overlap(list[i], list[j]);
      if (!o || o.pen < 0.01) continue;
      any = true;
      // Под конец — чуть вверх тому, кто выше: кучу легче развести, подняв её, чем раздвинув по тесному дну.
      const k = Math.min(o.pen, 0.25) * 0.55, up = it > iters / 2 ? 0.25 : 0;
      const hiB = list[i].x[1] >= list[j].x[1] ? list[i] : list[j];
      list[i].x = add(list[i].x, mul(o.n, k)); list[j].x = sub(list[j].x, mul(o.n, k));
      if (up) hiB.x = [hiB.x[0], hiB.x[1] + k * up, hiB.x[2]];
    }
    for (const b of list) keepInside(b, bounds);
    if (!any) break;
  }
}
/** Касается ли куб соседа (в пределах eps): точка одного внутри другого или у самой его поверхности. */
function touching(a, b, eps = 0.05) {
  const d = sub(b.x, a.x);
  if (dot(d, d) > (a.g.R + b.g.R + eps) ** 2) return false;
  for (const [A, B] of [[a, b], [b, a]]) {
    const qi = qinv(B.q);
    for (const p of worldProbes(A)) {
      const lp = qrot(qi, sub(p, B.x));
      if (B.g.faces.every((f) => dot(f.n, lp) - f.d < eps)) return true;
    }
  }
  return false;
}

function collidePair(a, b) {
  const d = sub(b.x, a.x);
  if (dot(d, d) > (a.g.R + b.g.R) ** 2) return;
  for (const [A, B] of [[a, b], [b, a]]) {
    const qi = qinv(B.q);
    for (const p of worldProbes(A)) {
      const lp = qrot(qi, sub(p, B.x));
      let minPen = Infinity, nf = null;
      for (const f of B.g.faces) {
        const pen = f.d - dot(f.n, lp);
        if (pen < 0) { minPen = -1; break; }
        if (pen < minPen) { minPen = pen; nf = f.n; }
      }
      if (minPen <= 0 || !nf) continue;
      const n = qrot(B.q, nf); // наружу из B — толкает A
      A.touch = true; B.touch = true;
      // Спящий куб — как опора: не двигается и не получает импульса, пока его не ударят.
      const wa = A.asleep ? 0 : 1, wb = B.asleep ? 0 : 1;
      if (!wa && !wb) continue;
      const ra = sub(p, A.x), rb = sub(p, B.x);
      const vrel = sub(add(A.v, cross(A.w, ra)), add(B.v, cross(B.w, rb)));
      const vn = dot(vrel, n);
      if (vn < 0) {
        noteHit(A, 'dice', -vn);
        const ran = cross(ra, n), rbn = cross(rb, n);
        const k = wa * (1 + dot(ran, ran) / A.g.inertia) + wb * (1 + dot(rbn, rbn) / B.g.inertia);
        const j = (-(1 + 0.3) * vn) / k;
        if (wa) applyImpulse(A, ra, mul(n, j));
        if (wb) applyImpulse(B, rb, mul(n, -j));
        const vrel2 = sub(add(A.v, cross(A.w, ra)), add(B.v, cross(B.w, rb)));
        const vt = sub(vrel2, mul(n, dot(vrel2, n)));
        const vtl = len(vt);
        if (vtl > 1e-5) {
          const t = mul(vt, 1 / vtl);
          const jt = Math.min(vtl / k, 0.3 * j);
          if (wa) applyImpulse(A, ra, mul(t, -jt));
          if (wb) applyImpulse(B, rb, mul(t, jt));
        }
      }
      const push = Math.min(minPen, 0.2) * 0.8 / (wa + wb);
      if (wa) A.x = add(A.x, mul(n, push));
      if (wb) B.x = add(B.x, mul(n, -push));
      // Будим только от настоящего удара: куб, лежащий на соседе, не дрожит бесконечно.
      if (vn < -0.6) { A.asleep = false; B.asleep = false; }
    }
  }
}

/** Один кадр (1/60 с) мира: несколько подшагов. */
function stepWorld(bodies, bounds) {
  for (const b of bodies) b.touch = false;
  for (let s = 0; s < SUBSTEPS; s++) {
    for (const b of bodies) {
      if (b.asleep) continue;
      b.v = [b.v[0] * 0.999, b.v[1] + G * DT, b.v[2] * 0.999];
      b.w = mul(b.w, 0.997);
      b.x = add(b.x, mul(b.v, DT));
      const wl = len(b.w);
      if (wl > 1e-6) b.q = qnorm(qmul(qaxis(b.w, wl * DT), b.q));
    }
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      if (bodies[i].asleep && bodies[j].asleep) continue;
      collidePair(bodies[i], bodies[j]);
    }
    for (const b of bodies) {
      if (b.asleep) continue;
      const wv = worldVerts(b);
      // На полу куб теряет вращение быстрее — сопротивление качению, чтобы бросок ложился за 2–3 секунды.
      if (contactPlane(b, [0, 1, 0], 0, FLOOR, wv)) { b.w = mul(b.w, 0.988); b.v = [b.v[0] * 0.994, b.v[1], b.v[2] * 0.994]; }
      // Стенки чуть внутри холста: в перспективе куб у стенки не обрезается краем.
      // Сверху — полоса под сумму и кнопки лотка (top): кубы туда не закатываются.
      // Слева и справа — поля (left/right): на столе кубы катаются ближе к середине, не под правой панелью (TASK-130).
      const hw = bounds.w / 2 - 0.35, hd = bounds.d / 2 - 0.35;
      contactPlane(b, [1, 0, 0], -hw + (bounds.left || 0), WALL, worldVerts(b));
      contactPlane(b, [-1, 0, 0], -hw + (bounds.right || 0), WALL, worldVerts(b));
      contactPlane(b, [0, 0, 1], -hd + (bounds.top || 0), WALL, worldVerts(b));
      contactPlane(b, [0, 0, -1], -hd + (bounds.bottom || 0), WALL, worldVerts(b));
    }
  }
  for (const b of bodies) {
    if (b.asleep) continue;
    // После секунды — «вязкость»: долгие перекаты затихают, бросок ложится за 1,5–3 секунды.
    b.age = (b.age || 0) + 1;
    if (b.age > 60) { const k = Math.min(0.06, (b.age - 60) * 0.0008); b.v = mul(b.v, 1 - k); b.w = mul(b.w, 1 - k * 1.5); }
    const slow = len(b.v) < 0.2 && len(b.w) < 0.35;
    b.still = slow ? b.still + 1 : 0;
    if (b.still > 12) {
      // Завис на ребре — подтолкнуть; опёрся на соседа — пусть лежит (в конце ляжет ровно).
      if (flatness(b) > 0.985 || b.touch || b.nudges > 2) { b.asleep = true; b.v = [0, 0, 0]; b.w = [0, 0, 0]; }
      else { b.nudges++; b.still = 0; b.v = [Math.random() - 0.5, 2.2, Math.random() - 0.5]; b.w = [(Math.random() - 0.5) * 8, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 8]; }
    }
  }
}

// ——— Текстура граней ———
const CELL = 128;
function seeded(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ——— Нарисованные грани (набор с полем art, TASK-127) ———
// Лист: 10 ячеек 128 px в ряд, грань в ячейке — ровно та же фигура, что строит to2() ниже (к4/к8/к20 — треугольник
// вершиной вверх, к6 — квадрат, к10 — дельтоид, к12 — пятиугольник вершиной вверх). Порядок ячеек:
const ART_LAYOUT = { frame4: 0, glyph: 1, d6: 11, d8: 17, d10: 25, d10t: 35, d12: 45, d20: 57, frame: { 6: 77, 8: 78, 10: 79, 12: 80, 20: 81 } };
const ART_COLS = 10;
const artImgs = new Map(); // адрес → Image
const artWaiters = new Set(); // сцены, которые перерисуют кубы, когда лист догрузится
function artImage(src) {
  let im = artImgs.get(src);
  if (!im) {
    im = new Image(); im.decoding = 'async';
    im.onload = () => { for (const f of artWaiters) f(); };
    im.src = src; artImgs.set(src, im);
  }
  return im.complete && im.naturalWidth ? im : null;
}
/** Ячейка листа для подписи грани; null — нарисованной грани нет (например, «?»). */
function artCell(kind, v) {
  if (v === '?') return null;
  const n = Number(v);
  if (kind === 'd10t') return ART_LAYOUT.d10t + n / 10;
  if (kind === 'd10u' || kind === 10) return ART_LAYOUT.d10 + (n % 10); // к10: «10» нарисовано как «0», как на настоящем кубе
  const base = ART_LAYOUT[`d${kind}`];
  return base === undefined ? null : base + n - 1;
}
function drawArtAtlas(b, cv, x, img) {
  const faces = b.g.faces, cols = cv.width / CELL;
  const cell = (i, ox, oy, w = CELL) => x.drawImage(img, (i % ART_COLS) * CELL, Math.floor(i / ART_COLS) * CELL, CELL, CELL, ox, oy, w, w);
  x.fillStyle = b.skin.dark; x.fillRect(0, 0, cv.width, cv.height);
  b.uv = [];
  faces.forEach((f, fi) => {
    const ox = (fi % cols) * CELL, oy = Math.floor(fi / cols) * CELL;
    const sc = (CELL * 0.44) / f.R;
    const to2 = (p) => { const d = sub(p, f.c); return [ox + CELL / 2 + dot(d, f.right) * sc, oy + CELL / 2 - dot(d, f.up) * sc]; };
    const P = f.idx.map((i) => to2(b.g.verts[i]));
    b.uv.push(P.map(([u, v]) => [u / cv.width, v / cv.height]));
    const fs = Math.max(18, f.r * sc * (b.shape === 10 ? 0.95 : 1.12));
    const text = (txt, cx, cy, ang) => {
      x.save(); x.translate(cx, cy); x.rotate(ang); x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = `600 ${fs}px Unbounded, Inter, system-ui, sans-serif`; x.fillStyle = b.skin.ink; x.fillText(txt, 0, 0); x.restore();
    };
    if (b.shape === 4) {
      // к4-кристалл (TASK-136): граней такой формы в листе нет — грань светлая с каймой цвета набора,
      // на длинной грани — цифра из листа (глифы 0–9), острия без чисел.
      x.save(); x.beginPath(); P.forEach(([u, w], i) => (i ? x.lineTo(u, w) : x.moveTo(u, w))); x.closePath(); x.clip();
      x.fillStyle = b.skin.light; x.fill();
      x.lineJoin = 'round'; x.strokeStyle = b.skin.dark; x.lineWidth = 9; x.stroke();
      x.restore();
      const li = b.g.numbered.indexOf(fi);
      if (li < 0) return;
      const v = b.labels[li];
      if (v === '?') { text('?', ox + CELL / 2, oy + CELL / 2, 0); return; }
      // Ячейка глифа берётся с полем в 4 px — иначе на грани проступает край соседней ячейки.
      const w = CELL * (fs * 0.9) / 96, gi = ART_LAYOUT.glyph + Number(v), pad = 4, k = w / CELL; // в ячейке цифра высотой 96 px
      x.drawImage(img, (gi % ART_COLS) * CELL + pad, Math.floor(gi / ART_COLS) * CELL + pad, CELL - 2 * pad, CELL - 2 * pad,
        ox + CELL / 2 - w / 2 + pad * k, oy + CELL / 2 - w / 2 + pad * k, w - 2 * pad * k, w - 2 * pad * k);
      return;
    }
    const v = b.labels[fi];
    const i = artCell(b.kind, v);
    if (i !== null) { cell(i, ox, oy); return; }
    cell(ART_LAYOUT.frame[b.shape], ox, oy);
    text(labelText(b.kind, v), ox + CELL / 2, oy + CELL / 2, 0);
  });
}

// ——— Набор «Воронёная сталь» (TASK-148): грани рисует код ———
// Тёмный металл с серебряными шипами-листьями у вершин и рёбер, в центре грани — синий эмалевый медальон
// в серебряной оправе, цифра — серебро. Основа (металл, шипы, медальон) рисуется один раз на форму куба,
// перед броском поверх неё ставятся только цифры.
const filigreeBase = new Map(); // форма → холст основы
function faceCells(b, cv) {
  const cols = cv.width / CELL;
  return b.g.faces.map((f, fi) => {
    const ox = (fi % cols) * CELL, oy = Math.floor(fi / cols) * CELL;
    const sc = (CELL * 0.44) / f.R;
    const to2 = (p) => { const d = sub(p, f.c); return [ox + CELL / 2 + dot(d, f.right) * sc, oy + CELL / 2 - dot(d, f.up) * sc]; };
    return { f, fi, ox, oy, sc, P: f.idx.map((i) => to2(b.g.verts[i])), cx: ox + CELL / 2, cy: oy + CELL / 2, rr: f.r * sc };
  });
}
/** Радиус медальона на грани: у к4 — по узкой стороне длинной грани; на остриях к4 медальона нет. */
function medalR(b, fc) {
  if (b.shape === 4) return b.g.numbered.includes(fc.fi) ? fc.rr * 0.78 : 0;
  return fc.rr * (b.shape === 12 ? 0.6 : b.shape === 10 ? 0.62 : 0.66);
}
function leaf(x, ax, ay, bx, by, w) {
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
  const mx = ax + dx * 0.42, my = ay + dy * 0.42;
  const g = x.createLinearGradient(ax, ay, bx, by);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#c6ccd6'); g.addColorStop(1, '#5d6470');
  x.fillStyle = g;
  x.beginPath(); x.moveTo(ax, ay);
  x.quadraticCurveTo(mx + nx * w, my + ny * w, bx, by);
  x.quadraticCurveTo(mx - nx * w, my - ny * w, ax, ay);
  x.closePath(); x.fill(); x.stroke();
}
function filigreeBaseCanvas(b, w, h) {
  const key = `${b.shape}|${w}x${h}`;
  if (filigreeBase.has(key)) return filigreeBase.get(key);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const x = cv.getContext('2d');
  const rnd = seeded(b.shape * 131);
  x.fillStyle = '#0d0f13'; x.fillRect(0, 0, w, h);
  for (const fc of faceCells(b, cv)) {
    const { P, cx, cy } = fc;
    x.save();
    x.beginPath(); P.forEach(([u, v], i) => (i ? x.lineTo(u, v) : x.moveTo(u, v))); x.closePath(); x.clip();
    // Воронёный металл: тёмный градиент, мелкие светлые риски.
    const mg = x.createLinearGradient(fc.ox, fc.oy, fc.ox + CELL, fc.oy + CELL);
    mg.addColorStop(0, '#454c58'); mg.addColorStop(0.5, '#23272f'); mg.addColorStop(1, '#0e1014');
    x.fillStyle = mg; x.fillRect(fc.ox, fc.oy, CELL, CELL);
    x.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      x.strokeStyle = `rgba(210,220,235,${0.03 + rnd() * 0.06})`; x.lineWidth = 0.6 + rnd();
      const a = rnd() * Math.PI, l = 8 + rnd() * 30, px = fc.ox + rnd() * CELL, py = fc.oy + rnd() * CELL;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
    }
    // Кромка грани — серебряный валик с тёмным швом по самому ребру.
    x.beginPath(); P.forEach(([u, v], i) => (i ? x.lineTo(u, v) : x.moveTo(u, v))); x.closePath();
    const rg = x.createLinearGradient(fc.ox, fc.oy, fc.ox + CELL, fc.oy + CELL);
    rg.addColorStop(0, '#f4f6fa'); rg.addColorStop(0.5, '#8d95a2'); rg.addColorStop(1, '#3a404a');
    x.strokeStyle = rg; x.lineWidth = 12; x.stroke();
    x.strokeStyle = 'rgba(5,6,9,.9)'; x.lineWidth = 3; x.stroke();
    // Шипы-листья: большой от каждой вершины к центру и по два боковых; маленький — от середины ребра.
    x.lineJoin = 'round'; x.strokeStyle = 'rgba(5,6,9,.9)'; x.lineWidth = 1.4;
    const reach = b.shape === 12 ? 0.42 : b.shape === 4 ? 0.34 : 0.5;
    P.forEach(([vx, vy], i) => {
      const dx = cx - vx, dy = cy - vy, D = Math.hypot(dx, dy) || 1, ux = dx / D, uy = dy / D;
      for (const sgn of [-1, 1]) {
        const a = Math.atan2(uy, ux) + sgn * 0.7, bx0 = vx + dx * 0.1, by0 = vy + dy * 0.1, L = D * 0.27;
        leaf(x, bx0, by0, bx0 + Math.cos(a) * L, by0 + Math.sin(a) * L, L * 0.27);
      }
      leaf(x, vx + dx * 0.02, vy + dy * 0.02, vx + dx * reach, vy + dy * reach, D * 0.1);
      const [qx, qy] = P[(i + 1) % P.length], mx = (vx + qx) / 2, my = (vy + qy) / 2;
      const ex = cx - mx, ey = cy - my;
      leaf(x, mx, my, mx + ex * 0.32, my + ey * 0.32, Math.hypot(ex, ey) * 0.09);
    });
    // Медальон: синяя эмаль с разводами в серебряной оправе.
    const R = medalR(b, fc);
    if (R > 0) {
      x.beginPath(); x.arc(cx, cy, R * 1.18, 0, Math.PI * 2);
      x.fillStyle = 'rgba(0,0,0,.55)'; x.fill();
      // Лепестки вокруг оправы.
      const petals = R > 22 ? 8 : 6;
      for (let k = 0; k < petals; k++) {
        const a = (k / petals) * Math.PI * 2 + Math.PI / petals;
        leaf(x, cx + Math.cos(a) * R * 1.05, cy + Math.sin(a) * R * 1.05, cx + Math.cos(a) * R * 1.5, cy + Math.sin(a) * R * 1.5, R * 0.13);
      }
      const ring = x.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      ring.addColorStop(0, '#ffffff'); ring.addColorStop(0.45, '#b9c0cc'); ring.addColorStop(1, '#3d434d');
      x.beginPath(); x.arc(cx, cy, R * 1.17, 0, Math.PI * 2); x.fillStyle = ring; x.fill();
      x.strokeStyle = 'rgba(5,6,9,.9)'; x.lineWidth = 1.4; x.stroke();
      const en = x.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.1, cx, cy, R);
      en.addColorStop(0, '#7cc2ff'); en.addColorStop(0.45, '#2a74e6'); en.addColorStop(1, '#0a2766');
      x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.fillStyle = en; x.fill();
      x.save(); x.clip();
      for (let i = 0; i < 7; i++) {
        x.strokeStyle = `rgba(150,205,255,${0.12 + rnd() * 0.18})`; x.lineWidth = 1 + rnd() * 1.6;
        const a0 = rnd() * Math.PI * 2, rr = R * (0.35 + rnd() * 0.6);
        x.beginPath(); x.arc(cx + (rnd() - 0.5) * R * 0.5, cy + (rnd() - 0.5) * R * 0.5, rr, a0, a0 + 1.2 + rnd() * 1.6); x.stroke();
      }
      x.restore();
      x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.strokeStyle = 'rgba(4,10,25,.8)'; x.lineWidth = 2; x.stroke();
    }
    x.restore();
  }
  filigreeBase.set(key, cv);
  return cv;
}
function drawFiligreeAtlas(b, cv, x) {
  x.drawImage(filigreeBaseCanvas(b, cv.width, cv.height), 0, 0);
  b.uv = [];
  for (const fc of faceCells(b, cv)) {
    b.uv.push(fc.P.map(([u, v]) => [u / cv.width, v / cv.height]));
    const li = b.g.numbered.indexOf(fc.fi);
    if (li < 0) continue;
    const R = medalR(b, fc);
    const v = b.labels[li];
    // Как на настоящем к10: «10» — это «0».
    const txt = v === '?' ? '?' : b.kind === 10 && Number(v) === 10 ? '0' : labelText(b.kind, v);
    const size = R * (txt.length > 1 ? 0.95 : 1.3);
    x.save(); x.translate(fc.cx, fc.cy + R * 0.04);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `700 ${size}px Unbounded, Inter, system-ui, sans-serif`;
    x.lineJoin = 'round'; x.strokeStyle = 'rgba(3,8,20,.9)'; x.lineWidth = Math.max(2, size * 0.12); x.strokeText(txt, 0, 0);
    const sg = x.createLinearGradient(0, -size / 2, 0, size / 2);
    sg.addColorStop(0, '#ffffff'); sg.addColorStop(0.55, '#dfe5ee'); sg.addColorStop(1, '#9aa4b3');
    x.fillStyle = sg; x.fillText(txt, 0, 0);
    if (txt === '6' || txt === '9') { x.fillRect(-size * 0.22, size * 0.44, size * 0.44, Math.max(2, size * 0.07)); }
    x.restore();
  }
}

// ——— Набор «Кровавое железо» (TASK-152): грани рисует код ———
// Тёмное железо с красными прожилками, по рёбрам — светлая стальная рамка с гравировкой, на вершинах — пирамидки
// заклёпок, вокруг цифры — гравированное кольцо, брызги и потёки крови. Основа — один раз на форму куба, цифры поверх.
const bloodBase = new Map(); // форма → холст основы
const polyPath = (x, P) => { x.beginPath(); P.forEach(([u, v], i) => (i ? x.lineTo(u, v) : x.moveTo(u, v))); x.closePath(); };
const shrink = (P, cx, cy, k) => P.map(([u, v]) => [cx + (u - cx) * k, cy + (v - cy) * k]);
/** Радиус гравированного кольца и цифры: у к4 — только на длинных гранях. */
function bloodR(b, fc) {
  if (b.shape === 4) return b.g.numbered.includes(fc.fi) ? fc.rr * 0.7 : 0;
  return fc.rr * (b.shape === 10 ? 0.6 : b.shape === 12 ? 0.62 : 0.66);
}
function bloodBaseCanvas(b, w, h) {
  const key = `${b.shape}|${w}x${h}`;
  if (bloodBase.has(key)) return bloodBase.get(key);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const x = cv.getContext('2d');
  const rnd = seeded(b.shape * 977 + 5);
  x.fillStyle = '#0a0707'; x.fillRect(0, 0, w, h);
  x.lineCap = 'round'; x.lineJoin = 'round';
  for (const fc of faceCells(b, cv)) {
    const { P, cx, cy, rr } = fc;
    const band = Math.max(5, rr * 0.2);
    x.save(); polyPath(x, P); x.clip();
    // Железо: тёмный градиент, ржаво-красные пятна, тонкие кровяные прожилки.
    const mg = x.createLinearGradient(fc.ox, fc.oy, fc.ox + CELL, fc.oy + CELL);
    mg.addColorStop(0, '#3a2c2d'); mg.addColorStop(0.5, '#1c1515'); mg.addColorStop(1, '#0b0808');
    x.fillStyle = mg; x.fillRect(fc.ox, fc.oy, CELL, CELL);
    for (let i = 0; i < 9; i++) {
      const px = fc.ox + rnd() * CELL, py = fc.oy + rnd() * CELL, r = 8 + rnd() * 26;
      const gr = x.createRadialGradient(px, py, 0, px, py, r);
      const tone = rnd(); // кровь, копоть или светлый металл
      gr.addColorStop(0, `rgba(${tone > 0.55 ? '125,18,24' : tone > 0.25 ? '0,0,0' : '120,100,100'},${0.16 + rnd() * 0.22})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = gr; x.fillRect(px - r, py - r, r * 2, r * 2);
    }
    for (let i = 0; i < 7; i++) {
      x.strokeStyle = `rgba(150,18,26,${0.3 + rnd() * 0.3})`; x.lineWidth = 0.6 + rnd() * 1.4;
      let px = fc.ox + rnd() * CELL, py = fc.oy + rnd() * CELL;
      x.beginPath(); x.moveTo(px, py);
      for (let k = 0; k < 4; k++) { const nx = px + (rnd() - 0.5) * 34, ny = py + (rnd() - 0.5) * 34; x.quadraticCurveTo((px + nx) / 2 + (rnd() - 0.5) * 12, (py + ny) / 2 + (rnd() - 0.5) * 12, nx, ny); px = nx; py = ny; }
      x.stroke();
    }
    // Рамка по рёбрам: светлая сталь с розоватым отливом, паз и насечки гравировки.
    polyPath(x, P);
    const fg = x.createLinearGradient(fc.ox, fc.oy, fc.ox + CELL, fc.oy + CELL);
    fg.addColorStop(0, '#f6e9e6'); fg.addColorStop(0.45, '#a88e8a'); fg.addColorStop(1, '#3f2e2e');
    x.strokeStyle = fg; x.lineWidth = band * 2; x.stroke();
    x.strokeStyle = 'rgba(8,3,3,.95)'; x.lineWidth = 2.5; x.stroke();
    const k1 = Math.max(0.3, 1 - band / rr), kMid = Math.max(0.3, 1 - band * 0.5 / rr);
    polyPath(x, shrink(P, cx, cy, kMid));
    x.setLineDash([1.5, 4.5]); x.strokeStyle = 'rgba(30,14,14,.7)'; x.lineWidth = band * 0.32; x.stroke(); x.setLineDash([]);
    polyPath(x, shrink(P, cx, cy, k1));
    x.strokeStyle = 'rgba(8,3,3,.9)'; x.lineWidth = 2.6; x.stroke();
    polyPath(x, shrink(P, cx, cy, k1 - 1.6 / rr));
    x.strokeStyle = 'rgba(240,215,210,.35)'; x.lineWidth = 1; x.stroke();
    // Ржавчина и кровь на рамке.
    x.globalCompositeOperation = 'multiply';
    for (let i = 0; i < 6; i++) {
      const [vx, vy] = P[Math.floor(rnd() * P.length)], [qx, qy] = P[Math.floor(rnd() * P.length)], t = rnd();
      const px = vx + (qx - vx) * t, py = vy + (qy - vy) * t, r = 6 + rnd() * 14;
      const gr = x.createRadialGradient(px, py, 0, px, py, r);
      gr.addColorStop(0, 'rgba(190,60,62,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = gr; x.fillRect(px - r, py - r, r * 2, r * 2);
    }
    x.globalCompositeOperation = 'source-over';
    // Гравированное кольцо вокруг цифры.
    const R = bloodR(b, fc);
    if (R > 0) {
      x.beginPath(); x.arc(cx, cy, R * 1.12, 0, Math.PI * 2); x.fillStyle = 'rgba(0,0,0,.35)'; x.fill();
      x.beginPath(); x.arc(cx, cy, R * 1.04, 0, Math.PI * 2);
      x.setLineDash([R * 0.05, R * 0.09]); x.strokeStyle = 'rgba(200,170,166,.55)'; x.lineWidth = R * 0.11; x.stroke(); x.setLineDash([]);
      for (const rq of [R * 1.13, R * 0.95]) {
        x.beginPath(); x.arc(cx, cy, rq, 0, Math.PI * 2);
        x.strokeStyle = 'rgba(8,3,3,.9)'; x.lineWidth = 2.4; x.stroke();
        x.strokeStyle = 'rgba(232,206,201,.75)'; x.lineWidth = 1; x.stroke();
      }
    }
    // Заклёпки-пирамидки на вершинах: каждая грань рисует свою часть, на кубе они складываются в одну.
    P.forEach(([vx, vy]) => {
      const th = Math.atan2(cy - vy, cx - vx), s = Math.max(7, rr * 0.44);
      const C = [0, 1, 2, 3].map((q) => [vx + Math.cos(th + Math.PI / 4 + q * Math.PI / 2) * s, vy + Math.sin(th + Math.PI / 4 + q * Math.PI / 2) * s]);
      x.beginPath(); x.arc(vx, vy, s * 1.25, 0, Math.PI * 2); x.fillStyle = 'rgba(0,0,0,.5)'; x.fill();
      const tones = ['#fff4f1', '#c2a6a2', '#3e2c2c', '#86696a'];
      C.forEach((c, q) => {
        const d = C[(q + 1) % 4];
        x.beginPath(); x.moveTo(vx, vy); x.lineTo(c[0], c[1]); x.lineTo(d[0], d[1]); x.closePath();
        x.fillStyle = tones[q]; x.fill(); x.strokeStyle = 'rgba(8,3,3,.8)'; x.lineWidth = 0.8; x.stroke();
      });
      x.beginPath(); x.arc(vx + Math.cos(th) * s * 0.18, vy + Math.sin(th) * s * 0.18, s * 0.12, 0, Math.PI * 2); x.fillStyle = 'rgba(255,255,255,.7)'; x.fill();
    });
    // Брызги и потёки крови.
    for (let i = 0; i < 6; i++) {
      const [vx, vy] = P[Math.floor(rnd() * P.length)], [qx, qy] = P[Math.floor(rnd() * P.length)], t = 0.15 + rnd() * 0.7, inn = 0.8 + rnd() * 0.18;
      const px = cx + (vx + (qx - vx) * t - cx) * inn, py = cy + (vy + (qy - vy) * t - cy) * inn, r = 1 + rnd() * 2.2;
      x.fillStyle = `rgba(120,6,14,${0.55 + rnd() * 0.3})`;
      for (let k = 0; k < 4; k++) { // неровная клякса из нескольких капель
        const a = rnd() * Math.PI * 2, d = rnd() * r * 1.4, q = r * (0.35 + rnd() * 0.6);
        x.beginPath(); x.arc(px + Math.cos(a) * d, py + Math.sin(a) * d, q, 0, Math.PI * 2); x.fill();
      }
      if (rnd() > 0.65) { // потёк: сужается к концу
        const L = 5 + rnd() * 11, a = Math.atan2(cy - py, cx - px) + (rnd() - 0.5) * 0.5, nx = -Math.sin(a), ny = Math.cos(a);
        x.beginPath(); x.moveTo(px + nx * r * 0.6, py + ny * r * 0.6); x.lineTo(px + Math.cos(a) * L, py + Math.sin(a) * L); x.lineTo(px - nx * r * 0.6, py - ny * r * 0.6); x.closePath(); x.fill();
      }
    }
    x.restore();
  }
  bloodBase.set(key, cv);
  return cv;
}
function drawBloodAtlas(b, cv, x) {
  x.drawImage(bloodBaseCanvas(b, cv.width, cv.height), 0, 0);
  b.uv = [];
  for (const fc of faceCells(b, cv)) {
    b.uv.push(fc.P.map(([u, v]) => [u / cv.width, v / cv.height]));
    const li = b.g.numbered.indexOf(fc.fi);
    if (li < 0) continue;
    const R = bloodR(b, fc), txt = labelText(b.kind, b.labels[li]);
    const size = R * (txt.length > 1 ? 1.12 : 1.6);
    x.save(); x.translate(fc.cx, fc.cy + R * 0.05);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `700 ${size}px Unbounded, Inter, system-ui, sans-serif`;
    x.lineJoin = 'round';
    x.fillStyle = 'rgba(0,0,0,.6)'; x.fillText(txt, size * 0.03, size * 0.07);
    x.strokeStyle = 'rgba(14,4,5,.95)'; x.lineWidth = Math.max(2, size * 0.15); x.strokeText(txt, 0, 0);
    const sg = x.createLinearGradient(0, -size / 2, 0, size / 2);
    sg.addColorStop(0, '#fff6f3'); sg.addColorStop(0.5, '#e6d0cc'); sg.addColorStop(1, '#9a7773');
    x.fillStyle = sg; x.fillText(txt, 0, 0);
    if (txt === '6' || txt === '9') { x.fillRect(-size * 0.22, size * 0.44, size * 0.44, Math.max(2, size * 0.07)); }
    x.restore();
  }
}

function drawAtlas(b) {
  const faces = b.g.faces;
  const cols = Math.ceil(Math.sqrt(faces.length));
  const rows = Math.ceil(faces.length / cols);
  const cv = b.atlas || document.createElement('canvas');
  cv.width = cols * CELL; cv.height = rows * CELL;
  const x = cv.getContext('2d');
  const rnd = seeded(b.id * 7919);
  const sk = b.skin;
  // Набор с нарисованными гранями: лист готов — рисуем им; нет — камнем в цветах набора, перерисуем по загрузке.
  const art = sk.art ? artImage(sk.art) : null;
  b.artPending = !!sk.art && !art;
  if (art) { drawArtAtlas(b, cv, x, art); b.atlas = cv; b.texDirty = true; return; }
  if (sk.paint === 'filigree') { drawFiligreeAtlas(b, cv, x); b.atlas = cv; b.texDirty = true; return; }
  if (sk.paint === 'bloodiron') { drawBloodAtlas(b, cv, x); b.atlas = cv; b.texDirty = true; return; }
  // Камень набора: основа, мягкие пятна светлого и тёмного тона, тонкие прожилки.
  x.fillStyle = sk.base;
  x.fillRect(0, 0, cv.width, cv.height);
  for (let i = 0; i < 70; i++) {
    const cx = rnd() * cv.width, cy = rnd() * cv.height, r = 10 + rnd() * 60;
    const gr = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    const tone = rnd() > 0.5 ? sk.light : sk.dark;
    gr.addColorStop(0, rgba(tone, 0.1 + rnd() * 0.16));
    gr.addColorStop(1, rgba(tone, 0));
    x.fillStyle = gr; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
  }
  x.lineCap = 'round';
  for (let i = 0; i < 22; i++) {
    x.strokeStyle = rgba(sk.light, 0.05 + rnd() * 0.09);
    x.lineWidth = 0.6 + rnd() * 1.5;
    x.beginPath();
    let px = rnd() * cv.width, py = rnd() * cv.height;
    x.moveTo(px, py);
    for (let k = 0; k < 5; k++) { px += (rnd() - 0.5) * 70; py += (rnd() - 0.5) * 70; x.lineTo(px, py); }
    x.stroke();
  }
  b.uv = [];
  faces.forEach((f, fi) => {
    const ox = (fi % cols) * CELL, oy = Math.floor(fi / cols) * CELL;
    const sc = (CELL * 0.44) / f.R;
    const to2 = (p) => { const d = sub(p, f.c); return [ox + CELL / 2 + dot(d, f.right) * sc, oy + CELL / 2 - dot(d, f.up) * sc]; };
    const P = f.idx.map((i) => to2(b.g.verts[i]));
    b.uv.push(P.map(([u, v]) => [u / cv.width, v / cv.height]));
    // Скос грани: тёмная кромка и светлый блик внутри.
    x.save();
    x.beginPath(); P.forEach(([u, v], i) => (i ? x.lineTo(u, v) : x.moveTo(u, v))); x.closePath();
    x.clip();
    x.lineJoin = 'round';
    x.strokeStyle = rgba(sk.dark, 0.85); x.lineWidth = 7; x.stroke();
    x.strokeStyle = rgba(sk.light, 0.16); x.lineWidth = 16; x.stroke();
    x.restore();
    // Цифры: на светлых наборах вдавлены (тёмные с бликом снизу), на тёмных — светлые с тенью.
    const fs = Math.max(18, f.r * sc * (b.shape === 10 ? 0.95 : 1.12));
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const put = (txt, cx, cy, ang, size = fs) => {
      x.save(); x.translate(cx, cy); x.rotate(ang);
      x.font = `600 ${size}px Unbounded, Inter, system-ui, sans-serif`;
      x.fillStyle = sk.engrave ? rgba(sk.light, 0.7) : 'rgba(0,0,0,.55)'; x.fillText(txt, 0, sk.engrave ? 1.4 : 1.6);
      x.fillStyle = sk.ink; x.fillText(txt, 0, 0);
      if (txt === '6' || txt === '9') { x.fillRect(-size * 0.22, size * 0.42, size * 0.44, Math.max(2, size * 0.07)); }
      x.restore();
    };
    if (b.shape === 4) {
      // к4-кристалл: число по центру длинной грани, вдоль кристалла; острия без чисел.
      const li = b.g.numbered.indexOf(fi);
      if (li >= 0) put(labelText(b.kind, b.labels[li]), ox + CELL / 2, oy + CELL / 2, 0);
    } else {
      const shift = b.shape === 10 ? f.r * sc * 0.12 : 0;
      put(labelText(b.kind, b.labels[fi]), ox + CELL / 2, oy + CELL / 2 + shift, 0);
    }
  });
  b.atlas = cv;
  b.texDirty = true;
}

/** Переставить метки так, чтобы сверху оказалось value (после того как известна верхняя грань). */
function forceTop(b, value) {
  const top = topIndex(b);
  const want = b.labels.indexOf(value);
  if (want < 0 || want === top) return;
  [b.labels[top], b.labels[want]] = [b.labels[want], b.labels[top]];
}

// ——— WebGL ———
const VS = `attribute vec3 aPos; attribute vec3 aNorm; attribute vec2 aUv;
uniform mat4 uPV; uniform mat4 uModel; varying vec3 vN; varying vec2 vUv; varying vec3 vW;
void main(){ vec4 w = uModel * vec4(aPos, 1.0); vW = w.xyz; vN = mat3(uModel) * aNorm; vUv = aUv; gl_Position = uPV * w; }`;
const FS = `precision mediump float;
uniform sampler2D uTex; uniform vec3 uEye; uniform vec3 uGlow; uniform float uAlpha; uniform float uSpec; uniform float uMetal; uniform float uLum;
varying vec3 vN; varying vec2 vUv; varying vec3 vW;
void main(){
  vec3 N = normalize(vN); vec3 V = normalize(uEye - vW);
  // Ключевой свет слева сверху, тёплый; холодная подсветка справа; блик только у граней, повёрнутых к свету.
  vec3 L1 = normalize(vec3(-0.6, 0.75, 0.42)); vec3 L2 = normalize(vec3(0.65, 0.45, -0.6));
  vec4 t = texture2D(uTex, vUv);
  float k1 = max(dot(N, L1), 0.0), k2 = max(dot(N, L2), 0.0);
  vec3 dif = (vec3(1.0, 0.95, 0.86) * k1 * 1.05 + vec3(0.55, 0.62, 0.8) * k2 * 0.35) * uLum;
  vec3 H = normalize(L1 + V);
  float sp = (pow(max(dot(N, H), 0.0), 110.0) * 0.8 + pow(max(dot(N, normalize(L2 + V)), 0.0), 40.0) * 0.12) * uSpec;
  float fr = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 R = reflect(-V, N);
  vec3 env = mix(vec3(0.02, 0.02, 0.03), vec3(0.75, 0.62, 0.45), smoothstep(0.2, 1.0, R.y));
  vec3 col = t.rgb * (0.2 * uLum + dif) + sp * mix(vec3(1.0), t.rgb * 1.6, uMetal) + env * (0.04 + 0.22 * fr) * (1.0 + 3.0 * uMetal) * mix(vec3(1.0), t.rgb, uMetal) + uGlow * (0.3 + 1.4 * fr);
  gl_FragColor = vec4(col * uAlpha, uAlpha);
}`;
const SVS = `attribute vec2 aQ; uniform mat4 uPV; uniform vec3 uC; uniform float uR; varying vec2 vQ;
void main(){ vQ = aQ; gl_Position = uPV * vec4(uC + vec3(aQ.x * uR, 0.0, aQ.y * uR), 1.0); }`;
const SFS = `precision mediump float; uniform float uK; varying vec2 vQ;
void main(){ float r = length(vQ); float a = (1.0 - smoothstep(0.25, 1.0, r)) * uK; gl_FragColor = vec4(0.0, 0.0, 0.0, a); }`;

function compile(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    gl.attachShader(p, sh);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function mat4mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let sum = 0; for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = sum; }
  return o;
}
function modelMatrix(q, p) {
  const [x, y, z, w] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0, 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, p[0], p[1], p[2], 1];
}

const FOV = (30 * Math.PI) / 180;
export const PX_PER_UNIT = 42;
const FADE_MS = 650;

/**
 * Сцена с кубами на холсте. insetTop/insetBottom/insetLeft/insetRight — полосы (px), куда кубы не закатываются
 * (шапка лотка, панели стола); на столе их меняет setInsets() перед броском — площадка ближе к середине (TASK-130).
 * hover — кубы до броска висят в воздухе и трясутся, как в кулаке (лоток); иначе падают и укатываются.
 * API: add(kind, opts) — положить куб; remove(kind); throw(targets, opts) → Promise<{center, top, dice}> (px; dice — каждый куб);
 *      place(targets, opts) — без анимации; fade(group, delay); setInsets({top, bottom, left, right}); clear(); resize(); destroy().
 * targets: [{kind, value, glow?, dropped?}]. opts: {skin, fresh, keep, group}.
 */
export function createDiceStage(canvas, { insetTop = 0, insetBottom = 0, insetLeft = 0, insetRight = 0, maxDpr = 2, hover = false, sound = 1 } = {}) {
  const inset = { top: insetTop, bottom: insetBottom, left: insetLeft, right: insetRight };
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true });
  if (!gl) return null;
  const prog = compile(gl, VS, FS), sprog = compile(gl, SVS, SFS);
  const loc = (p, n) => gl.getUniformLocation(p, n);
  const U = { pv: loc(prog, 'uPV'), model: loc(prog, 'uModel'), tex: loc(prog, 'uTex'), eye: loc(prog, 'uEye'), glow: loc(prog, 'uGlow'), alpha: loc(prog, 'uAlpha'), spec: loc(prog, 'uSpec'), metal: loc(prog, 'uMetal'), lum: loc(prog, 'uLum') };
  const SU = { pv: loc(sprog, 'uPV'), c: loc(sprog, 'uC'), r: loc(sprog, 'uR'), k: loc(sprog, 'uK') };
  const A = { pos: gl.getAttribLocation(prog, 'aPos'), norm: gl.getAttribLocation(prog, 'aNorm'), uv: gl.getAttribLocation(prog, 'aUv'), q: gl.getAttribLocation(sprog, 'aQ') };
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  let bodies = [], frames = null, frameAt = 0, raf = 0, bounds = { w: 9, d: 14 }, camH = 20, pv = null, dpr = 1;
  let destroyed = false, pending = [], playStart = 0, liveAt = 0;
  let sounds = null, soundAt = -1; // удары просчитанного броска по кадрам
  const onArt = () => { let any = false; for (const b of bodies) if (b.artPending) { b.labelsDirty = true; any = true; } if (any) { render(); kick(); } };
  artWaiters.add(onArt);

  function resize() {
    dpr = Math.min(maxDpr, devicePixelRatio || 1);
    const w = canvas.clientWidth || 300, h = canvas.clientHeight || 480;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    bounds = { w: w / PX_PER_UNIT, d: h / PX_PER_UNIT, px: [w, h] };
    applyInsets();
    camH = bounds.d / 2 / Math.tan(FOV / 2);
    const proj = perspective(FOV, w / h, 1, camH + 10);
    // Камера над центром смотрит вниз; «вверх» экрана — к −z.
    const view = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, -camH, 1];
    pv = mat4mul(proj, view);
    for (const b of bodies) {
      const p = b.hover ? b.hover.base : b.x;
      p[0] = Math.max(-bounds.w / 2 + 0.6, Math.min(bounds.w / 2 - 0.6, p[0]));
      p[2] = Math.max(-bounds.d / 2 + 0.6 + bounds.top, Math.min(bounds.d / 2 - 0.6 - bounds.bottom, p[2]));
      if (!b.hover) b.asleep = false;
    }
    kick();
  }

  /** Поля площадки в единицах сцены; cx — середина площадки по ширине (туда бросок и целится). */
  function applyInsets() {
    const u = PX_PER_UNIT, maxSide = Math.max(0, bounds.w - 3);
    bounds.top = inset.top / u; bounds.bottom = inset.bottom / u;
    bounds.left = Math.min(maxSide, Math.max(0, inset.left / u));
    bounds.right = Math.min(maxSide - bounds.left, Math.max(0, inset.right / u));
    bounds.cx = (bounds.left - bounds.right) / 2;
    bounds.aw = bounds.w - bounds.left - bounds.right;
  }
  function setInsets(next = {}) {
    for (const k of ['top', 'bottom', 'left', 'right']) if (Number.isFinite(next[k])) inset[k] = Math.max(0, next[k]);
    applyInsets();
  }

  function buildBuffer(b) {
    const data = [];
    b.g.faces.forEach((f, fi) => {
      const uv = b.uv[fi];
      for (let k = 1; k < f.idx.length - 1; k++) for (const j of [0, k, k + 1]) {
        const p = b.g.verts[f.idx[j]];
        data.push(p[0], p[1], p[2], f.n[0], f.n[1], f.n[2], uv[j][0], uv[j][1]);
      }
    });
    if (!b.buf) b.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    b.count = data.length / 8;
  }
  function uploadTex(b) {
    if (!b.tex) b.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, b.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, b.atlas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    b.texDirty = false;
  }
  /** Освободить текстуру и буфер куба, который ушёл со сцены (иначе каждый бросок копил бы память видеокарты). */
  function dispose(list) {
    for (const b of list) { if (b.tex) gl.deleteTexture(b.tex); if (b.buf) gl.deleteBuffer(b.buf); b.tex = null; b.buf = null; }
  }
  function prepare(b) {
    if (!b.atlas || b.labelsDirty) { drawAtlas(b); buildBuffer(b); b.labelsDirty = false; }
    if (b.texDirty) uploadTex(b);
  }

  function render() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!bodies.length) return;
    // Тени на дне.
    gl.useProgram(sprog);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.uniformMatrix4fv(SU.pv, false, pv);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(A.q); gl.vertexAttribPointer(A.q, 2, gl.FLOAT, false, 0, 0);
    for (const b of bodies) {
      const hgt = Math.max(0, b.x[1] - b.g.R * 0.7);
      gl.uniform3f(SU.c, b.x[0] + hgt * 0.18, 0.001, b.x[2] - hgt * 0.1);
      gl.uniform1f(SU.r, b.g.R * (1.25 + hgt * 0.12));
      gl.uniform1f(SU.k, (0.55 / (1 + hgt * 0.35)) * b.alpha * (b.fade ?? 1));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.disableVertexAttribArray(A.q);
    // Кубы.
    gl.useProgram(prog);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.uniformMatrix4fv(U.pv, false, pv);
    gl.uniform3f(U.eye, 0, camH, 0);
    gl.uniform1i(U.tex, 0);
    gl.activeTexture(gl.TEXTURE0);
    for (const b of [...bodies].sort((a, c) => c.alpha * (c.fade ?? 1) - a.alpha * (a.fade ?? 1))) {
      prepare(b);
      gl.bindTexture(gl.TEXTURE_2D, b.tex);
      gl.uniformMatrix4fv(U.model, false, modelMatrix(b.q, b.x));
      const gw = b.glow || [0, 0, 0];
      gl.uniform3f(U.glow, gw[0], gw[1], gw[2]);
      gl.uniform1f(U.alpha, b.alpha * (b.fade ?? 1));
      gl.uniform1f(U.spec, b.skin.spec ?? 0.6);
      gl.uniform1f(U.metal, b.skin.metal ?? 0.15);
      gl.uniform1f(U.lum, b.skin.lum ?? 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
      gl.enableVertexAttribArray(A.pos); gl.vertexAttribPointer(A.pos, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(A.norm); gl.vertexAttribPointer(A.norm, 3, gl.FLOAT, false, 32, 12);
      gl.enableVertexAttribArray(A.uv); gl.vertexAttribPointer(A.uv, 2, gl.FLOAT, false, 32, 24);
      gl.drawArrays(gl.TRIANGLES, 0, b.count);
    }
  }

  /** Угасание групп кубов (бросок на столе): по времени, затем куб уходит со сцены. */
  function stepFades(now) {
    let any = false;
    const gone = [];
    for (const b of bodies) {
      if (b.fadeAt == null) continue;
      if (now < b.fadeAt) { any = true; continue; }
      b.fade = Math.max(0, 1 - (now - b.fadeAt) / FADE_MS);
      if (b.fade <= 0) gone.push(b); else any = true;
    }
    if (gone.length) { dispose(gone); bodies = bodies.filter((b) => !gone.includes(b)); }
    return any;
  }

  function loop(now = performance.now()) {
    raf = 0;
    if (destroyed) return;
    // Спрятанный лоток не рисуется: кубы замирают до показа (resize → kick).
    if (!frames && !canvas.getClientRects().length) { liveAt = 0; return; }
    let busy = stepFades(now);
    if (stepHover(now)) busy = true;
    if (frames) {
      // Проигрывание просчитанного броска — по времени: на медленном устройстве кадры пропускаются.
      if (!playStart) playStart = now;
      frameAt = Math.floor((now - playStart) / (1000 / 60));
      applyFrame(frames[Math.min(frameAt, frames.length - 1)]);
      // Удары — в те же кадры; если кадры пропущены, за раз звучит не больше шести самых громких.
      if (sounds && frameAt > soundAt) {
        const due = [];
        for (let f = soundAt + 1; f <= Math.min(frameAt, frames.length - 1); f++) for (const h of sounds.get(f) || []) due.push(h);
        soundAt = frameAt;
        due.sort((a, b) => b.v - a.v).slice(0, 6).forEach((h) => playHit(h.kind, h.v, sound, h.die));
      }
      if (frameAt >= frames.length - 1) {
        frames = null; playStart = 0; sounds = null;
        for (const b of bodies) { b.asleep = true; b.v = [0, 0, 0]; b.w = [0, 0, 0]; }
        for (const b of bodies) if (b.settled) { b.settled(b); b.settled = null; }
        render();
        const done = pending; pending = [];
        for (const r of done) r();
        busy = busy || bodies.some((b) => b.fadeAt != null);
        if (busy) raf = requestAnimationFrame(loop);
        return;
      }
      busy = true;
    } else if (bodies.some((b) => !b.asleep)) {
      // Живые кубы (положенные в лоток): шаги мира догоняют реальное время, не больше трёх за кадр.
      const n = liveAt ? Math.min(3, Math.max(1, Math.round((now - liveAt) / (1000 / 60)))) : 1;
      liveAt = now;
      for (let i = 0; i < n; i++) stepWorld(bodies, bounds);
      busy = true;
    } else liveAt = 0;
    render();
    if (busy) raf = requestAnimationFrame(loop);
  }
  function kick() { if (!raf && !destroyed) raf = requestAnimationFrame(loop); }
  function applyFrame(f) { if (f) for (const [b, x, q, v, w] of f) { b.x = x; b.q = q; b.v = v; b.w = w; } }

  function spawnPoint() {
    const x = (Math.random() - 0.5) * (bounds.w - 2.4);
    const z = (Math.random() - 0.5) * (bounds.d - 3 - bounds.top - bounds.bottom) + (bounds.top - bounds.bottom) / 2;
    return [x, 5 + Math.random() * 2, z];
  }

  // ——— Кубы в воздухе до броска ———
  const still = () => matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  /** Место куба над дном: подальше от соседей и от кнопки броска в центре (выбор лучшего из случайных). */
  function hoverSlot() {
    const taken = bodies.filter((b) => b.hover).map((b) => b.hover.base);
    // Висящий куб ближе к камере — на экране он крупнее и дальше от центра: поля с запасом на перспективу.
    // Много кубов в одном слое не помещается — следующие висят слоем выше, не внутри соседей (TASK-146).
    const r = 0.95, gap = 2;
    const k0 = camH / (camH - 3.1);
    const cap = Math.max(2, Math.floor((2 * ((bounds.w / 2 - 0.25) / k0 - r)) / gap) * Math.floor(((bounds.d - bounds.top - bounds.bottom) / k0 - 2 * r) / gap) - 2);
    const extra = gap * Math.floor(taken.length / cap);
    let best = null, bestD = -1;
    for (let i = 0; i < 60; i++) {
      const y = 2.5 + Math.random() * (0.5 + extra);
      const k = camH / (camH - y - 0.6);
      const xr = Math.max(0.5, (bounds.w / 2 - 0.25) / k - r);
      const z0 = (-bounds.d / 2 + bounds.top + 0.15) / k + r, z1 = (bounds.d / 2 - bounds.bottom - 0.15) / k - r;
      const p = [(Math.random() * 2 - 1) * xr, y, z0 + Math.random() * Math.max(0, z1 - z0)];
      if (Math.abs(p[2]) < 1.35 && Math.abs(p[0]) < 2.6 && p[1] < 3.2) continue; // кнопка «Бросить»
      const d = taken.length ? Math.min(...taken.map((t) => Math.hypot(t[0] - p[0], t[1] - p[1], t[2] - p[2]))) : 9;
      if (d > bestD) { bestD = d; best = p; }
    }
    return best || [0, 2.6, (-bounds.d / 2 + bounds.top + 0.15) / k0 + r];
  }
  /**
   * Тряска: кубы плавно покачиваются в воздухе и медленно кувыркаются, а раз в две-три секунды все разом
   * мягко встряхиваются — как в ладонях перед броском. Появившийся куб взлетает со дна к своему месту.
   */
  function stepHover(now) {
    const list = bodies.filter((b) => b.hover);
    if (!list.length) return false;
    const calm = still(), t = now / 1000;
    const rattle = calm ? 0 : 0.25 + 0.75 * Math.max(0, Math.sin(t * 2.4)) ** 3;
    let moving = false;
    for (const b of list) {
      const h = b.hover;
      const dt = h.last ? Math.min(0.05, t - h.last) : 0;
      h.last = t;
      const rise = calm ? 1 : Math.min(1, (now - h.born) / 380);
      const e = 1 - (1 - rise) ** 3;
      if (rise < 1) moving = true;
      if (!calm) h.qb = qnorm(qmul(qaxis(h.axis, h.spin * dt), h.qb));
      const a = 0.05 * rattle;
      const bob = calm ? 0 : Math.sin(t * 1.1 + h.ph) * 0.1;
      b.x = [
        h.base[0] + Math.sin(t * 11 + h.ph * 3) * a,
        h.base[1] * e + bob + Math.sin(t * 9 + h.ph) * a * 0.6,
        h.base[2] + Math.sin(t * 13 + h.ph * 2) * a,
      ];
      b.q = calm ? h.qb : qmul(qaxis(h.jaxis, Math.sin(t * 8 + h.ph) * 0.09 * rattle), h.qb);
    }
    return moving || !calm;
  }

  /** Положить куб в лоток: в воздух (hover) или падает сверху и укатывается. */
  function addDie(kind, opts = {}) {
    if (hover) {
      const base = hoverSlot();
      const b = makeBody(kind, { x: [base[0], 0, base[2]], skin: opts.skin });
      b.asleep = true; // физика его не двигает, пока висит
      b.hover = {
        base, born: performance.now(), ph: Math.random() * Math.PI * 2, qb: b.q,
        axis: norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]),
        jaxis: norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]),
        spin: (0.3 + Math.random() * 0.35) * (Math.random() < 0.5 ? -1 : 1),
      };
      bodies.push(b);
      kick();
      return b;
    }
    const b = makeBody(kind, { x: spawnPoint(), v: [(Math.random() - 0.5) * 3, -2, (Math.random() - 0.5) * 3], w: [(Math.random() - 0.5) * 14, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 14], skin: opts.skin });
    bodies.push(b);
    kick();
    return b;
  }
  function removeDie(kind) {
    for (let i = bodies.length - 1; i >= 0; i--) if (bodies[i].kind === kind && bodies[i].target == null) { dispose(bodies.splice(i, 1)); break; }
    kick();
  }

  /**
   * Замах: вверх по столу от нижнего края к центру и дальше, с закруткой.
   * Куб из воздуха (лоток) с силой брошен вниз и в сторону — отскакивает от дна и стенок.
   */
  function launch(b, k = 1) {
    if (b.fromAir) {
      const ang = Math.random() * Math.PI * 2, sp = k * (4 + Math.random() * 5);
      b.v = [Math.cos(ang) * sp - (b.x[0] - (bounds.cx || 0)) * 0.6, -(3 + Math.random() * 3), Math.sin(ang) * sp - b.x[2] * 0.4];
      b.w = [(Math.random() - 0.5) * 40, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 40];
      return;
    }
    const speed = k * (8 + Math.random() * 9);
    const ang = (Math.random() - 0.5) * 0.9 - ((b.x[0] - (bounds.cx || 0)) / (bounds.aw || bounds.w)) * 0.5;
    b.v = [Math.sin(ang) * speed, 3 + Math.random() * 4, -Math.cos(ang) * speed];
    if (b.x[2] < 0) b.v[2] = -b.v[2] * 0.6; // кубы в верхней половине летят вниз, навстречу
    b.w = [(Math.random() - 0.5) * 34, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 34];
  }
  /**
   * Бросок. Кубы того же вида, уже лежащие (висящие) в лотке, летят первыми (если не fresh); недостающие вылетают
   * из-под нижнего края. keep — прежние кубы остаются на сцене (стол: броски разных участников).
   * Новый бросок во время полёта прежнего продолжает его физику — метки прежних кубов пересчитываются.
   */
  function throwDice(targets, opts = {}) {
    if (frames) { applyFrame(frames[Math.min(frameAt, frames.length - 1)]); for (const b of bodies) if (b.target != null && !b.done) b.asleep = false; frames = null; playStart = 0; }
    const pool = opts.fresh ? [] : bodies.filter((b) => b.target == null);
    const used = [];
    // Новые кубы вылетают снизу сеткой с шагом STEP, которая помещается между стенками (не больше трёх рядов);
    // не влезли — следующим слоем выше, как горсть, высыпанная из руки (TASK-146: раньше ряды уходили за верхнюю
    // стенку и кубы начинали бросок друг в друге).
    const STEP = 2;
    const fresh = targets.filter((t) => !pool.some((b) => b.kind === t.kind)).length;
    const cols = Math.max(1, Math.floor((bounds.aw - 1.2) / STEP));
    const rows = Math.max(1, Math.min(3, Math.floor((bounds.d - bounds.top - bounds.bottom - 1.2) / STEP)));
    const lane = opts.lane ?? 0; // смещение ряда вылета по ширине (−0.5…0.5): у разных бросков — разные места
    let ni = 0;
    targets.forEach((t) => {
      const k = pool.findIndex((b) => b.kind === t.kind);
      let b;
      if (k >= 0) b = pool.splice(k, 1)[0];
      else {
        const n = Math.min(fresh, cols), col = ni % cols, row = Math.floor(ni / cols) % rows, layer = Math.floor(ni / (cols * rows));
        ni++;
        const x = bounds.cx + (col + 0.5 - n / 2) * STEP + lane * Math.max(0, bounds.aw - 1.2 - n * STEP) + (Math.random() - 0.5) * 0.2;
        const z = bounds.d / 2 - bounds.bottom - 1.1 - row * STEP;
        b = makeBody(t.kind, { x: [x, 1.3 + layer * STEP + Math.random() * 0.3, z], skin: opts.skin });
        bodies.push(b);
      }
      b.skin = opts.skin || b.skin;
      b.fromAir = !!b.hover; b.hover = null;
      b.target = t; b.group = opts.group ?? null; b.done = false; b.fadeAt = null; b.fade = 1;
      b.labels = defaultLabels(t.kind); b.labelsDirty = true; b.glow = null; b.alpha = 1;
      b.asleep = false; b.still = 0; b.nudges = 0; b.age = 0;
      b.x = [b.x[0], Math.max(b.x[1], b.fromAir ? 0.8 : 1.4), b.x[2]];
      launch(b, opts.speed);
      used.push(b);
    });
    // Кубы лотка, не вошедшие в бросок, уходят (стол хранит прежние броски до угасания).
    if (!opts.keep) { dispose(bodies.filter((b) => !used.includes(b))); bodies = used.slice(); }
    // Просчёт без экрана: все кубы сцены (спящие — опоры). Кубы, как настоящие, могут лечь кучей друг на друга
    // и чуть наискось (TASK-139); число читается с грани, которая смотрит вверх сильнее остальных.
    const sim = bodies.map((b) => ({ ...b, x: [...b.x], v: [...b.v], q: [...b.q], w: [...b.w] }));
    const map = new Map(sim.map((s, i) => [s, bodies[i]]));
    const rec = [];
    hitLog = { frame: 0, byKey: new Map() };
    let hits;
    try {
      for (let f = 0; f < 60 * 7 && sim.some((s) => !s.asleep); f++) {
        hitLog.frame = f;
        stepWorld(sim, bounds);
        rec.push(sim.map((s) => [map.get(s), [...s.x], [...s.q], [...s.v], [...s.w]]));
      }
    } finally { hits = hitLog ? [...hitLog.byKey.values()] : []; hitLog = null; }
    // Звук по кадрам: в одном кадре — не больше пяти самых сильных ударов.
    const byFrame = new Map();
    for (const h of hits) { const l = byFrame.get(h.f) || []; l.push(h); byFrame.set(h.f, l); }
    for (const [f, l] of byFrame) byFrame.set(f, l.sort((a, b) => b.v - a.v).slice(0, 5));
    // Доводка — только у кубов, что лежат на дне сами по себе: ровно на грань и до дна. Куб на соседе или
    // впритык к нему остаётся как лёг: выравнивание вдавило бы его в соседа.
    const free = sim.map((s) => lowest(s) < 0.06 && !sim.some((o) => o !== s && touching(s, o, 0.12)));
    const finalQ = sim.map((s, i) => (free[i] ? alignedQuat(s) : s.q));
    const last = rec[rec.length - 1] || sim.map((s) => [map.get(s), [...s.x], [...s.q], [0, 0, 0], [0, 0, 0]]);
    const drop = sim.map((s, i) => { if (!free[i]) return 0; const low = lowest(s, finalQ[i]); return Math.abs(low) < 0.3 ? low : 0; });
    // Итоговые места: после выравнивания кубы, вошедшие друг в друга, разводятся — сквозь соседа не лежит никто.
    const fin = sim.map((s, i) => ({ g: s.g, x: [s.x[0], s.x[1] - drop[i], s.x[2]], q: finalQ[i] }));
    separate(fin, bounds);
    for (let k = 1; k <= 8; k++) {
      const t = k / 8;
      rec.push(last.map(([b, x, q], i) => [b, [x[0] + (fin[i].x[0] - x[0]) * t, x[1] + (fin[i].x[1] - x[1]) * t, x[2] + (fin[i].x[2] - x[2]) * t], qslerp(q, finalQ[i], t), [0, 0, 0], [0, 0, 0]]));
    }
    // Метки: сверху — нужное число у каждого брошенного куба (и у задетых прежних).
    sim.forEach((s, i) => {
      const b = map.get(s);
      const t = b.target;
      if (!t) return;
      // Бросок вслепую: число не знает даже бросающий — на всех гранях «?».
      if (t.value == null) { b.labels = defaultLabels(t.kind).map(() => '?'); b.labelsDirty = true; return; }
      const tmp = { ...s, q: finalQ[i], labels: defaultLabels(t.kind) };
      forceTop(tmp, t.value);
      b.labels = tmp.labels; b.labelsDirty = true;
    });
    // Текстуры с новыми метками готовим до старта: тяжёлый первый кадр не съедает начало полёта.
    for (const b of bodies) prepare(b);
    for (const b of used) b.settled = (x) => { x.done = true; if (x.target.dropped) x.alpha = 0.4; if (x.target.glow) x.glow = x.target.glow; };
    frames = rec; frameAt = 0; playStart = 0; sounds = sound > 0 ? byFrame : null; soundAt = -1;
    return new Promise((resolve) => {
      pending.push(() => {
        const cx = used.reduce((a, b) => a + b.x[0], 0) / (used.length || 1), cz = used.reduce((a, b) => a + b.x[2], 0) / (used.length || 1);
        const top = Math.min(...used.map((b) => b.x[2])) - 1;
        resolve({ center: toPx(cx, cz), top: toPx(cx, top), dice: used.map((b) => toPx(b.x[0], b.x[2])) });
      });
      kick();
    });
  }
  /** Точка дна сцены → пиксели холста (по CSS). */
  function toPx(x, z) { return [(x / bounds.w + 0.5) * bounds.px[0], (z / bounds.d + 0.5) * bounds.px[1]]; }

  /** Без анимации: кубы сразу лежат нужной гранью вверх (prefers-reduced-motion). */
  function placeDice(targets, opts = {}) {
    frames = null;
    if (!opts.keep) { dispose(bodies); bodies = []; }
    const n = targets.length, cols = Math.min(n, Math.max(1, Math.floor(bounds.aw / 2)));
    const lane = opts.lane ?? 0;
    const placed = targets.map((t, i) => {
      const x = bounds.cx + ((i % cols) + 0.5 - cols / 2) * 2 + lane * Math.max(0, bounds.aw - cols * 2);
      const z = (Math.floor(i / cols) - (Math.ceil(n / cols) - 1) / 2) * 2 + (bounds.top - bounds.bottom) / 2;
      const b = makeBody(t.kind, { x: [x, 0, z], skin: opts.skin });
      b.q = alignedQuat(b);
      const low = Math.min(...b.g.verts.map((p) => qrot(b.q, p)[1]));
      b.x[1] = -low; b.asleep = true; b.target = t; b.group = opts.group ?? null; b.done = true;
      if (t.value == null) b.labels = b.labels.map(() => '?'); else forceTop(b, t.value);
      b.labelsDirty = true;
      if (t.dropped) b.alpha = 0.4;
      if (t.glow) b.glow = t.glow;
      return b;
    });
    bodies.push(...placed);
    render();
    const cx = placed.reduce((a, b) => a + b.x[0], 0) / (placed.length || 1), cz = placed.reduce((a, b) => a + b.x[2], 0) / (placed.length || 1);
    return Promise.resolve({ center: toPx(cx, cz), top: toPx(cx, Math.min(...placed.map((b) => b.x[2])) - 1), dice: placed.map((b) => toPx(b.x[0], b.x[2])) });
  }

  /** Угаснуть группе кубов через delay мс (бросок на столе). */
  function fadeGroup(group, delay = 0) {
    const at = performance.now() + delay;
    for (const b of bodies) if (b.group === group && b.fadeAt == null) b.fadeAt = at;
    kick();
  }

  resize();
  return {
    add: addDie, remove: removeDie, throw: throwDice, place: placeDice, fade: fadeGroup, setInsets, resize,
    clear() { dispose(bodies); bodies = []; frames = null; const done = pending; pending = []; for (const r of done) r(); render(); },
    /** Кубы, лежащие в лотке до броска. */
    kinds: () => bodies.filter((b) => b.target == null).map((b) => b.kind),
    get count() { return bodies.length; },
    get playing() { return !!frames; },
    destroy() { destroyed = true; artWaiters.delete(onArt); cancelAnimationFrame(raf); dispose(bodies); gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
}

/** Куб к100 — две к10: десятки (00–90) и единицы (0–9). 100 — это 00 и 0. */
export function splitD100(value) {
  if (value == null) return [{ kind: 'd10t', value: null }, { kind: 'd10u', value: null }];
  const v = value % 100;
  return [{ kind: 'd10t', value: Math.floor(v / 10) * 10 }, { kind: 'd10u', value: v % 10 }];
}

// Для проверок в Node: чистые функции геометрии.
export const _test = { geometry, hullFaces, topIndex, forceTop, makeBody, alignedQuat, defaultLabels, stepWorld, flatness, lowest };
