// TASK-092: объёмные кубы — геометрия, подмена меток под нужное число, физика ложится за разумное время.
import test from 'node:test';
import assert from 'node:assert/strict';
import { _test as T, splitD100 } from '../dist/js/views/table/dice3d.js';

const KINDS = [4, 6, 8, 10, 12, 20, 'd10t', 'd10u'];

test('многогранники: число граней и вершин как у настоящих кубов', () => {
  const want = { 4: [4, 4, 3], 6: [8, 6, 4], 8: [6, 8, 3], 10: [12, 10, 4], 12: [20, 12, 5], 20: [12, 20, 3] };
  for (const [k, [v, f, sides]] of Object.entries(want)) {
    const g = T.geometry(Number(k));
    assert.equal(g.verts.length, v, `к${k}: вершины`);
    assert.equal(g.faces.length, f, `к${k}: грани`);
    assert.ok(g.faces.every((x) => x.idx.length === sides), `к${k}: вершин у грани`);
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
