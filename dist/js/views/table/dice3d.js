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
  if (kind === 4) return [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
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

// Размер (радиус описанной сферы) в единицах лотка — на глаз, чтобы кубы были соразмерны.
const SIZE = { 4: 1.04, 6: 0.78, 8: 0.86, 10: 0.84, 12: 0.86, 20: 0.9 };
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
    else if (kind === 10) { const far = P.reduce((a, b) => (len(sub(b, f.c)) > len(sub(a, f.c)) ? b : a)); up = norm(sub(far, f.c)); }
    else up = norm(sub(P[0], f.c));
    f.up = up; f.right = cross(up, f.n);
    f.R = Math.max(...P.map((p) => len(sub(p, f.c))));
    // Радиус вписанной окружности грани — для размера цифр.
    f.r = Math.min(...P.map((p, i) => { const q = P[(i + 1) % P.length]; const e = norm(sub(q, p)); const w = sub(f.c, p); return len(sub(w, mul(e, dot(w, e)))); }));
  }
  const R = Math.max(...v.map(len));
  GEO[kind] = { verts: v, faces, R, inertia: 0.4 * R * R };
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
    hue: opts.hue ?? 230, alpha: 1, glow: null, tex: null, texDirty: true, buf: null,
  };
}

/** Значение, которое показывает куб сейчас (к4 — вершина сверху, остальные — верхняя грань). */
function topIndex(b) {
  if (b.shape === 4) {
    let best = 0, by = -Infinity;
    b.g.verts.forEach((p, i) => { const y = qrot(b.q, p)[1]; if (y > by) { by = y; best = i; } });
    return best;
  }
  let best = 0, bd = -Infinity;
  b.g.faces.forEach((f, i) => { const d = qrot(b.q, f.n)[1]; if (d > bd) { bd = d; best = i; } });
  return best;
}
/** Насколько куб лежит на грани: косинус между нижней гранью и вертикалью (1 — ровно). */
function flatness(b) {
  return Math.max(...b.g.faces.map((f) => -qrot(b.q, f.n)[1]));
}
/** Поворот, после которого куб ровно лежит на ближайшей к низу грани. */
function alignedQuat(b) {
  let best = null, bd = -Infinity;
  for (const f of b.g.faces) { const n = qrot(b.q, f.n); if (-n[1] > bd) { bd = -n[1]; best = n; } }
  const down = [0, -1, 0];
  const axis = cross(best, down), s = len(axis), c = dot(best, down);
  if (s < 1e-7) return c > 0 ? b.q : qnorm(qmul(qaxis([1, 0, 0], Math.PI), b.q));
  return qnorm(qmul(qaxis(axis, Math.atan2(s, c)), b.q));
}

// ——— Физика ———
const G = -38, DT = 1 / 240, SUBSTEPS = 4;
const FLOOR = { e: 0.32, mu: 0.42 }, WALL = { e: 0.45, mu: 0.25 };

function applyImpulse(b, r, J) {
  b.v = add(b.v, J);
  b.w = add(b.w, mul(cross(r, J), 1 / b.g.inertia));
}

function contactPlane(b, n, off, mat, verts) {
  // Плоскость n·p >= off: последовательные импульсы с накоплением (как в PGS), трение по Кулону.
  let deepest = 0;
  const cs = [];
  for (const p of verts) {
    const pen = off - dot(n, p);
    if (pen <= 0) continue;
    if (pen > deepest) deepest = pen;
    const r = sub(p, b.x);
    const rn = cross(r, n);
    const vn0 = dot(add(b.v, cross(b.w, r)), n);
    cs.push({ r, k: 1 + dot(rn, rn) / b.g.inertia, target: vn0 < -2 ? -mat.e * vn0 : 0, acc: 0, tacc: [0, 0, 0] });
  }
  if (!cs.length) return false;
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

function collidePair(a, b) {
  const d = sub(b.x, a.x);
  if (dot(d, d) > (a.g.R + b.g.R) ** 2) return;
  for (const [A, B] of [[a, b], [b, a]]) {
    const qi = qinv(B.q);
    for (const p of worldVerts(A)) {
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
      const hw = bounds.w / 2 - 0.35, hd = bounds.d / 2 - 0.35;
      contactPlane(b, [1, 0, 0], -hw, WALL, worldVerts(b));
      contactPlane(b, [-1, 0, 0], -hw, WALL, worldVerts(b));
      contactPlane(b, [0, 0, 1], -hd + (bounds.top || 0), WALL, worldVerts(b));
      contactPlane(b, [0, 0, -1], -hd, WALL, worldVerts(b));
    }
  }
  for (const b of bodies) {
    if (b.asleep) continue;
    // После двух секунд — «вязкость»: долгие перекаты затихают, бросок ложится за 2–4 секунды.
    b.age = (b.age || 0) + 1;
    if (b.age > 120) { const k = Math.min(0.06, (b.age - 120) * 0.0008); b.v = mul(b.v, 1 - k); b.w = mul(b.w, 1 - k * 1.5); }
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

function drawAtlas(b) {
  const faces = b.g.faces;
  const cols = Math.ceil(Math.sqrt(faces.length));
  const rows = Math.ceil(faces.length / cols);
  const cv = b.atlas || document.createElement('canvas');
  cv.width = cols * CELL; cv.height = rows * CELL;
  const x = cv.getContext('2d');
  const rnd = seeded(b.id * 7919);
  const hue = b.hue;
  // Дымчатый камень: тёмная основа, мягкие светлые прожилки.
  x.fillStyle = `hsl(${hue} 14% 19%)`;
  x.fillRect(0, 0, cv.width, cv.height);
  for (let i = 0; i < 60; i++) {
    const cx = rnd() * cv.width, cy = rnd() * cv.height, r = 10 + rnd() * 60;
    const gr = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    const l = 26 + rnd() * 22;
    gr.addColorStop(0, `hsla(${hue} 12% ${l}% / ${0.16 + rnd() * 0.18})`);
    gr.addColorStop(1, `hsla(${hue} 12% ${l}% / 0)`);
    x.fillStyle = gr; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
  }
  x.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    x.strokeStyle = `hsla(${hue} 10% ${55 + rnd() * 25}% / ${0.05 + rnd() * 0.08})`;
    x.lineWidth = 0.6 + rnd() * 1.6;
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
    x.strokeStyle = 'rgba(0,0,0,.55)'; x.lineWidth = 7; x.stroke();
    x.strokeStyle = 'rgba(255,255,255,.07)'; x.lineWidth = 16; x.stroke();
    x.restore();
    // Цифры.
    const ink = b.ink || '#f2ead8';
    const fs = Math.max(18, f.r * sc * (b.shape === 4 ? 0.95 : b.shape === 10 ? 0.95 : 1.12));
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `600 ${fs}px Unbounded, Inter, system-ui, sans-serif`;
    const put = (txt, cx, cy, ang, size = fs) => {
      x.save(); x.translate(cx, cy); x.rotate(ang);
      x.font = `600 ${size}px Unbounded, Inter, system-ui, sans-serif`;
      x.fillStyle = 'rgba(0,0,0,.55)'; x.fillText(txt, 0, 1.6);
      x.fillStyle = ink; x.fillText(txt, 0, 0);
      if (txt === '6' || txt === '9') { x.fillRect(-size * 0.22, size * 0.42, size * 0.44, Math.max(2, size * 0.07)); }
      x.restore();
    };
    if (b.shape === 4) {
      // к4: у каждой вершины грани — её число, повёрнутое к вершине.
      f.idx.forEach((vi, k) => {
        const [px, py] = P[k];
        const cx = ox + CELL / 2, cy = oy + CELL / 2;
        const tx = cx + (px - cx) * 0.6, ty = cy + (py - cy) * 0.6;
        const ang = Math.atan2(px - cx, -(py - cy));
        put(labelText(b.kind, b.labels[vi]), tx, ty, ang);
      });
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
uniform sampler2D uTex; uniform vec3 uEye; uniform vec3 uGlow; uniform float uAlpha;
varying vec3 vN; varying vec2 vUv; varying vec3 vW;
void main(){
  vec3 N = normalize(vN); vec3 V = normalize(uEye - vW);
  // Ключевой свет слева сверху, тёплый; холодная подсветка справа; блик только у граней, повёрнутых к свету.
  vec3 L1 = normalize(vec3(-0.6, 0.75, 0.42)); vec3 L2 = normalize(vec3(0.65, 0.45, -0.6));
  vec4 t = texture2D(uTex, vUv);
  float k1 = max(dot(N, L1), 0.0), k2 = max(dot(N, L2), 0.0);
  vec3 dif = vec3(1.0, 0.95, 0.86) * k1 * 1.05 + vec3(0.55, 0.62, 0.8) * k2 * 0.35;
  vec3 H = normalize(L1 + V);
  float sp = pow(max(dot(N, H), 0.0), 110.0) * 0.5 + pow(max(dot(N, normalize(L2 + V)), 0.0), 40.0) * 0.08;
  float fr = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 R = reflect(-V, N);
  vec3 env = mix(vec3(0.02, 0.02, 0.03), vec3(0.7, 0.58, 0.42), smoothstep(0.2, 1.0, R.y));
  vec3 col = t.rgb * (0.2 + dif) + sp + env * (0.04 + 0.22 * fr) + uGlow * (0.3 + 1.4 * fr);
  gl_FragColor = vec4(col * uAlpha, uAlpha);
}`;
const SVS = `attribute vec2 aQ; uniform mat4 uPV; uniform vec3 uC; uniform float uR; varying vec2 vQ;
void main(){ vQ = aQ; gl_Position = uPV * vec4(uC + vec3(aQ.x * uR, 0.0, aQ.y * uR), 1.0); }`;
const SFS = `precision mediump float; uniform float uK; varying vec2 vQ;
void main(){ float r = length(vQ); float a = (1.0 - smoothstep(0.25, 1.0, r)) * uK; gl_FragColor = vec4(0.0, 0.0, 0.0, a); }`;

function compile(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
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
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
  return o;
}
function modelMatrix(q, p) {
  const [x, y, z, w] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0, 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, p[0], p[1], p[2], 1];
}

const FOV = (30 * Math.PI) / 180;
export const PX_PER_UNIT = 42;

/**
 * Сцена с кубами на холсте. Возвращает API:
 *  add(kind, opts) — положить куб в лоток (падает вживую); remove(kind) — убрать последний такой;
 *  throw(targets, opts) → Promise — бросить: targets [{kind, value}], существующие кубы берутся первыми;
 *  clear(); resize(); destroy(); size.
 */
export function createDiceStage(canvas, { onSettle, insetTop = 0 } = {}) {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true });
  if (!gl) return null;
  const prog = compile(gl, VS, FS), sprog = compile(gl, SVS, SFS);
  const loc = (p, n) => gl.getUniformLocation(p, n);
  const U = { pv: loc(prog, 'uPV'), model: loc(prog, 'uModel'), tex: loc(prog, 'uTex'), eye: loc(prog, 'uEye'), glow: loc(prog, 'uGlow'), alpha: loc(prog, 'uAlpha') };
  const SU = { pv: loc(sprog, 'uPV'), c: loc(sprog, 'uC'), r: loc(sprog, 'uR'), k: loc(sprog, 'uK') };
  const A = { pos: gl.getAttribLocation(prog, 'aPos'), norm: gl.getAttribLocation(prog, 'aNorm'), uv: gl.getAttribLocation(prog, 'aUv'), q: gl.getAttribLocation(sprog, 'aQ') };
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  let bodies = [], frames = null, frameAt = 0, raf = 0, bounds = { w: 9, d: 14 }, camH = 20, pv = null, dpr = 1;
  let destroyed = false, settleCb = null;

  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    const w = canvas.clientWidth || 300, h = canvas.clientHeight || 480;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    bounds = { w: w / PX_PER_UNIT, d: h / PX_PER_UNIT, top: insetTop / PX_PER_UNIT };
    camH = bounds.d / 2 / Math.tan(FOV / 2);
    const proj = perspective(FOV, w / h, 1, camH + 10);
    // Камера над центром лотка смотрит вниз; «вверх» экрана — к −z.
    const view = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, -camH, 1];
    pv = mat4mul(proj, view);
    for (const b of bodies) { b.x[0] = Math.max(-bounds.w / 2 + 0.6, Math.min(bounds.w / 2 - 0.6, b.x[0])); b.x[2] = Math.max(-bounds.d / 2 + 0.6 + bounds.top, Math.min(bounds.d / 2 - 0.6, b.x[2])); b.asleep = false; }
    kick();
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
  /** Освободить текстуру и буфер куба, который ушёл из лотка (иначе каждый бросок копил бы память видеокарты). */
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
    // Тени на дне лотка.
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
      gl.uniform1f(SU.k, (0.55 / (1 + hgt * 0.35)) * b.alpha);
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
    for (const b of [...bodies].sort((a, c) => c.alpha - a.alpha)) {
      prepare(b);
      gl.bindTexture(gl.TEXTURE_2D, b.tex);
      gl.uniformMatrix4fv(U.model, false, modelMatrix(b.q, b.x));
      const gw = b.glow || [0, 0, 0];
      gl.uniform3f(U.glow, gw[0], gw[1], gw[2]);
      gl.uniform1f(U.alpha, b.alpha);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
      gl.enableVertexAttribArray(A.pos); gl.vertexAttribPointer(A.pos, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(A.norm); gl.vertexAttribPointer(A.norm, 3, gl.FLOAT, false, 32, 12);
      gl.enableVertexAttribArray(A.uv); gl.vertexAttribPointer(A.uv, 2, gl.FLOAT, false, 32, 24);
      gl.drawArrays(gl.TRIANGLES, 0, b.count);
    }
  }

  let playStart = 0, liveAt = 0;
  function loop(now = performance.now()) {
    raf = 0;
    if (destroyed) return;
    if (frames) {
      // Проигрывание просчитанного броска — по времени, а не по кадрам: на медленном устройстве кадры пропускаются.
      if (!playStart) playStart = now;
      frameAt = Math.floor((now - playStart) / (1000 / 60));
      const f = frames[Math.min(frameAt, frames.length - 1)];
      for (const [b, x, q] of f) { b.x = x; b.q = q; }
      if (frameAt >= frames.length - 1) {
        playStart = 0;
        frames = null;
        for (const b of bodies) { b.asleep = true; b.v = [0, 0, 0]; b.w = [0, 0, 0]; }
        render();
        const cb = settleCb; settleCb = null; cb?.();
        return;
      }
    } else if (bodies.some((b) => !b.asleep)) {
      // Живые кубы (положенные в лоток): шаги мира догоняют реальное время, не больше трёх за кадр.
      const n = liveAt ? Math.min(3, Math.max(1, Math.round((now - liveAt) / (1000 / 60)))) : 1;
      liveAt = now;
      for (let i = 0; i < n; i++) stepWorld(bodies, bounds);
    } else { liveAt = 0; render(); return; }
    render();
    raf = requestAnimationFrame(loop);
  }
  function kick() { if (!raf && !destroyed) raf = requestAnimationFrame(loop); }

  function spawnPoint() {
    const x = (Math.random() - 0.5) * (bounds.w - 2.4), z = (Math.random() - 0.5) * (bounds.d - 3 - bounds.top) + bounds.top / 2;
    return [x, 5 + Math.random() * 2, z];
  }

  /** Положить куб в лоток: падает сверху и укатывается. */
  function addDie(kind, opts = {}) {
    const b = makeBody(kind, { x: spawnPoint(), v: [(Math.random() - 0.5) * 3, -2, (Math.random() - 0.5) * 3], w: [(Math.random() - 0.5) * 14, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 14], hue: opts.hue, ...opts });
    if (opts.ink) b.ink = opts.ink;
    bodies.push(b);
    kick();
    return b;
  }
  function removeDie(kind) {
    for (let i = bodies.length - 1; i >= 0; i--) if (bodies[i].kind === kind) { dispose(bodies.splice(i, 1)); break; }
    kick();
  }

  /**
   * Бросок. targets: [{kind, value, dropped?}]. Кубы того же вида, уже лежащие в лотке, летят первыми;
   * недостающие вылетают из нижнего края. Возвращает Promise, который разрешается, когда всё легло.
   */
  function throwDice(targets, opts = {}) {
    frames = null;
    const pool = [...bodies];
    const used = [];
    const next = [];
    targets.forEach((t, i) => {
      const k = pool.findIndex((b) => b.kind === t.kind);
      let b;
      if (k >= 0 && !opts.fresh) { b = pool.splice(k, 1)[0]; }
      else {
        // Новые кубы вылетают из-под нижнего края рядами, не налезая друг на друга.
        const cols = Math.max(1, Math.floor((bounds.w - 1.4) / 1.9));
        const n = Math.min(targets.length, cols), col = i % cols, row = Math.floor(i / cols);
        const x = (col + 0.5 - n / 2) * 1.9 + (Math.random() - 0.5) * 0.3;
        b = makeBody(t.kind, { x: [x, 1.4 + Math.random() * 0.8 + row * 0.4, bounds.d / 2 - 1.3 - row * 1.9], hue: opts.hue });
        if (opts.ink) b.ink = opts.ink;
      }
      b.labels = defaultLabels(t.kind); b.labelsDirty = true; b.glow = null; b.alpha = 1;
      b.asleep = false; b.still = 0; b.nudges = 0; b.age = 0;
      // Бросок вверх по лотку: от нижнего края к центру и дальше, с закруткой.
      const speed = 8 + Math.random() * 9;
      const ang = (Math.random() - 0.5) * 0.9 - (b.x[0] / bounds.w) * 0.5;
      b.v = [Math.sin(ang) * speed, 3 + Math.random() * 4, -Math.cos(ang) * speed];
      if (b.x[2] < 0) b.v[2] = -b.v[2] * 0.6; // кубы в верхней половине летят вниз, навстречу
      b.x = [b.x[0], Math.max(b.x[1], 1.4), b.x[2]];
      b.w = [(Math.random() - 0.5) * 34, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 34];
      used.push(b); next.push({ b, t });
    });
    if (!opts.keep) dispose(pool);
    bodies = used.concat(opts.keep ? pool : []);
    // Просчёт без экрана.
    const sim = bodies.map((b) => ({ ...b, x: [...b.x], v: [...b.v], q: [...b.q], w: [...b.w] }));
    const map = new Map(sim.map((s, i) => [s, bodies[i]]));
    const rec = [];
    for (let f = 0; f < 60 * 7 && sim.some((s) => !s.asleep); f++) {
      stepWorld(sim, bounds);
      rec.push(sim.map((s) => [map.get(s), [...s.x], [...s.q]]));
    }
    // Доводка: лечь ровно на грань.
    const finalQ = sim.map((s) => alignedQuat(s));
    const last = rec[rec.length - 1] || sim.map((s) => [map.get(s), [...s.x], [...s.q]]);
    for (let k = 1; k <= 8; k++) {
      rec.push(last.map(([b, x, q], i) => [b, x, qslerp(q, finalQ[i], k / 8)]));
    }
    // Метки: сверху — нужное число.
    sim.forEach((s, i) => {
      const b = map.get(s);
      const t = next.find((n) => n.b === b)?.t;
      if (!t) return;
      const probe = { ...s, q: finalQ[i] };
      // Бросок вслепую: число не знает даже бросающий — на всех гранях «?».
      if (t.value == null) { b.labels = defaultLabels(t.kind).map(() => '?'); b.labelsDirty = true; return; }
      b.labels = defaultLabels(t.kind);
      const tmp = { ...probe, labels: b.labels };
      forceTop(tmp, t.value);
      b.labels = tmp.labels; b.labelsDirty = true;
    });
    // Текстуры с новыми метками готовим до старта: тяжёлый первый кадр не съедает начало полёта.
    for (const b of bodies) prepare(b);
    frames = rec; frameAt = 0; playStart = 0;
    return new Promise((resolve) => {
      settleCb = () => {
        for (const { b, t } of next) {
          if (t.dropped) b.alpha = 0.4;
          if (t.glow) b.glow = t.glow;
        }
        render();
        resolve();
        onSettle?.();
      };
      kick();
    });
  }

  /** Без анимации: кубы сразу лежат нужной гранью вверх (prefers-reduced-motion). */
  function placeDice(targets, opts = {}) {
    frames = null;
    dispose(bodies);
    bodies = targets.map((t, i) => {
      const n = targets.length, cols = Math.min(n, Math.max(1, Math.floor(bounds.w / 2)));
      const x = ((i % cols) + 0.5 - cols / 2) * 2, z = (Math.floor(i / cols) - (Math.ceil(n / cols) - 1) / 2) * 2 + bounds.top / 2;
      const b = makeBody(t.kind, { x: [x, 0, z], hue: opts.hue });
      if (opts.ink) b.ink = opts.ink;
      b.q = alignedQuat(b);
      const low = Math.min(...b.g.verts.map((p) => qrot(b.q, p)[1]));
      b.x[1] = -low; b.asleep = true;
      if (t.value == null) b.labels = b.labels.map(() => '?'); else forceTop(b, t.value);
      b.labelsDirty = true;
      if (t.dropped) b.alpha = 0.4;
      if (t.glow) b.glow = t.glow;
      return b;
    });
    render();
    return Promise.resolve();
  }

  resize();
  return {
    add: addDie, remove: removeDie, throw: throwDice, place: placeDice, resize,
    clear() { dispose(bodies); bodies = []; frames = null; render(); },
    get count() { return bodies.length; },
    kinds: () => bodies.map((b) => b.kind),
    destroy() { destroyed = true; cancelAnimationFrame(raf); gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
}

/** Куб к100 — две к10: десятки (00–90) и единицы (0–9). 100 — это 00 и 0. */
export function splitD100(value) {
  if (value == null) return [{ kind: 'd10t', value: null }, { kind: 'd10u', value: null }];
  const v = value % 100;
  return [{ kind: 'd10t', value: Math.floor(v / 10) * 10 }, { kind: 'd10u', value: v % 10 }];
}

// Для проверок в Node: чистые функции геометрии.
export const _test = { geometry, hullFaces, topIndex, forceTop, makeBody, alignedQuat, defaultLabels, stepWorld, flatness };
