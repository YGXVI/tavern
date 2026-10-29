// Импорт карт Universal VTT (Dungeondraft .dd2vtt).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUniversalVTT, scaleImport, lightPresetColor } from '../dist/js/rules/uvtt.js';

const sample = {
  format: 0.3,
  resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 10, y: 8 }, pixels_per_grid: 100 },
  line_of_sight: [[{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 4 }]],
  objects_line_of_sight: [[{ x: 7, y: 7 }, { x: 8, y: 7 }]],
  portals: [{ position: { x: 3, y: 4 }, bounds: [{ x: 2.5, y: 4 }, { x: 3.5, y: 4 }], closed: true }],
  lights: [{ position: { x: 2, y: 2 }, range: 6, intensity: 1, color: 'ffeccd8b' }, { position: { x: 6, y: 6 }, range: 2, color: 'ff6a8cff' }],
  image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
};

test('dd2vtt: размер, сетка, стены, двери, свет и картинка', () => {
  const r = parseUniversalVTT(sample, { feet: 5, uid: (() => { let i = 0; return () => String(i++); })() });
  assert.equal(r.width, 1000); assert.equal(r.height, 800); assert.equal(r.ppg, 100);
  assert.deepEqual(r.counts, { walls: 3, doors: 1, lights: 2 });
  assert.deepEqual(r.walls[0].a, { x: 100, y: 100 }); assert.deepEqual(r.walls[0].b, { x: 500, y: 100 });
  const door = r.walls.find((w) => w.kind === 'door');
  assert.deepEqual([door.a, door.b, door.open], [{ x: 250, y: 400 }, { x: 350, y: 400 }, false]);
  // Радиус 6 клеток = 30 фт: 15 ярко + 15 тускло.
  assert.deepEqual([r.lights[0].bright, r.lights[0].dim, r.lights[0].color], [15, 15, 'warm']);
  assert.equal(r.lights[1].color, 'cold');
  assert.equal(r.image.mime, 'image/png');
});

test('dd2vtt: уменьшение большой карты и ошибки', () => {
  const r = scaleImport(parseUniversalVTT(sample), 0.5);
  assert.equal(r.width, 500); assert.equal(r.ppg, 50); assert.deepEqual(r.walls[0].b, { x: 250, y: 50 });
  assert.throws(() => parseUniversalVTT({ hello: 1 }), /Universal VTT/);
  assert.equal(lightPresetColor('ffffffff'), 'warm');
});
