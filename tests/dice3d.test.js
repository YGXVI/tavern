// TASK-092, TASK-105: объёмные кубы — геометрия, подмена меток под нужное число, физика ложится за разумное время,
// высота нижней вершины и глухой звук удара (TASK-155).
import test from 'node:test';
import assert from 'node:assert/strict';
import { _test as T, splitD100 } from '../dist/js/views/table/dice3d.js';

const KINDS = [4, 6, 8, 10, 12, 20, 'd10t', 'd10u'];

test('многогранники: число граней и вершин как у настоящих кубов', () => {
  // к4 — кристалл (TASK-136): 4 длинные грани с числами и по 4 треугольника на каждом острие.
  const want = { 4: [10, { 3: 8, 4: 4 }, 4], 6: [8, { 4: 6 }, 6], 8: [6, { 3: 8 }, 8], 10: [12, { 4: 10 }, 10], 12: [20, { 5: 12 }, 12], 20: [12, { 3: 20 }, 20] };
  for (const [k, [v, sides, numbered]] of Object.entries(want)) {
    const g = T.geometry(Number(k));
    assert.equal(g.verts.length, v, `к${k}: вершины`);
    const got = {};
    for (const x of g.faces) got[x.idx.length] = (got[x.idx.length] || 0) + 1;
    assert.deepEqual(got, sides, `к${k}: грани по числу вершин`);
    assert.equal(g.numbered.length, numbered, `к${k}: граней с числами`);
    // Нормали наружу, грани плоские.
    for (const x of g.faces) for (const i of x.idx) assert.ok(Math.abs(x.n[0] * g.verts[i][0] + x.n[1] * g.verts[i][1] + x.n[2] * g.verts[i][2] - x.d) < 1e-6);
  }
});

test('сверху всегда выпадает число, которое решил движок', () => {
  for (const k of KINDS) {
    for (let i = 0; i < 60; i++) {
      const b = T.makeBody(k);
      b.q = T.alignedQuat(b);
      const want = b.labels[Math.floor(Math.random() * b.labels.length)];
      T.forceTop(b, want);
      assert.equal(b.labels[T.topIndex(b)], want, `${k}: ${want}`);
      assert.ok(T.flatness(b) > 0.9999, `${k}: лежит ровно`);
      assert.equal(new Set(b.labels).size, b.labels.length, `${k}: метки не повторяются`);
    }
  }
});

test('к100 — две к10: десятки и единицы', () => {
  assert.deepEqual(splitD100(47).map((x) => x.value), [40, 7]);
  assert.deepEqual(splitD100(7).map((x) => x.value), [0, 7]);
  assert.deepEqual(splitD100(10).map((x) => x.value), [10, 0]);
  assert.deepEqual(splitD100(100).map((x) => x.value), [0, 0]);
  assert.deepEqual(splitD100(null).map((x) => x.kind), ['d10t', 'd10u']);
});

test('брошенные кубы ложатся за несколько секунд и не вылетают из лотка', () => {
  const bounds = { w: 284 / 42, d: 504 / 42, top: 64 / 42 };
  const frames = [];
  for (let trial = 0; trial < 25; trial++) {
    const bodies = KINDS.map((k, i) => {
      const speed = 8 + Math.random() * 9, ang = (Math.random() - 0.5) * 0.9;
      return T.makeBody(k, {
        x: [((i % 3) - 1) * 1.9, 1.8, bounds.d / 2 - 1.3 - Math.floor(i / 3) * 1.9],
        v: [Math.sin(ang) * speed, 3 + Math.random() * 4, -Math.cos(ang) * speed],
        w: [(Math.random() - 0.5) * 34, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 34],
      });
    });
    let f = 0;
    for (; f < 60 * 7 && bodies.some((b) => !b.asleep); f++) T.stepWorld(bodies, bounds);
    frames.push(f);
    for (const b of bodies) {
      assert.ok(Math.abs(b.x[0]) < bounds.w / 2, `${b.kind} внутри по ширине`);
      assert.ok(b.x[2] > -bounds.d / 2 + bounds.top - 0.5 && b.x[2] < bounds.d / 2, `${b.kind} внутри по длине`);
      assert.ok(b.x[1] > -0.05 && b.x[1] < 4, `${b.kind} на дне: y=${b.x[1].toFixed(2)} asleep=${b.asleep}`);
    }
  }
  frames.sort((a, b) => a - b);
  assert.ok(frames[Math.floor(frames.length / 2)] < 60 * 4, `медиана ${frames[Math.floor(frames.length / 2)]} кадров`);
});

test('нижняя вершина: куб на дне касается стола, поднятый — висит', () => {
  for (const k of KINDS) {
    const b = T.makeBody(k, { x: [0, 0, 0] });
    b.q = T.alignedQuat(b);
    b.x[1] -= T.lowest(b); // опустить на дно
    assert.ok(Math.abs(T.lowest(b)) < 1e-9, `${k}: на дне ≈ 0`);
    b.x[1] += 0.5;
    assert.ok(Math.abs(T.lowest(b) - 0.5) < 1e-9, `${k}: поднят на 0,5`);
  }
});

test('звук удара глухой: срез верхов и низкий тон, без звона выше 1,5 кГц', () => {
  // Минимальная подмена Web Audio: записываем, какие узлы и с какими параметрами создал hitVoice.
  const nodes = [];
  const param = () => ({ value: 0, setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
  const node = (k) => { const n = { k, connect: (x) => x, disconnect() {}, start() {}, stop() {}, frequency: param(), Q: param(), gain: param(), detune: param(), playbackRate: param() }; nodes.push(n); return n; };
  const ac = {
    currentTime: 0, sampleRate: 44100,
    createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n), length: n, duration: n / 44100 }),
    createBufferSource: () => node('src'), createBiquadFilter: () => node('biquad'), createGain: () => node('gain'), createOscillator: () => node('osc'),
  };
  const dest = node('dest');
  for (const kind of ['dice', 'wall', 'floor']) {
    nodes.length = 0;
    T.hitVoice(ac, dest, 0, kind, 5, 1, 20, () => 0.5);
    assert.ok(nodes.some((n) => n.k === 'biquad' && n.type === 'lowpass'), `${kind}: есть срез верхов`);
    assert.ok(nodes.some((n) => n.k === 'osc'), `${kind}: есть тон`);
    // Удар без «звона»: ни одна частота фильтра или тона не выше 1,5 кГц.
    const freqs = nodes.filter((n) => n.k === 'biquad' || n.k === 'osc').map((n) => n.frequency.value).filter((f) => f > 0);
    assert.ok(freqs.length && freqs.every((f) => f <= 1500), `${kind}: частоты ${freqs.join(', ')} Гц`);
  }
});
