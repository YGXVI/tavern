// Обзор: стены закрывают, окна — нет, в темноте видно только свет и тёмное зрение.
import test from 'node:test';
import assert from 'node:assert/strict';
import { visibilityPolygon, pointVisible, inPolygon } from '../dist/js/rules/vision.js';

const bounds = { x: 0, y: 0, w: 100, h: 100 };
const wall = (x1, y1, x2, y2, kind = 'wall') => ({ a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, kind });

test('стена закрывает обзор, окно — нет', () => {
  const eye = { x: 20, y: 50 };
  const solid = visibilityPolygon(eye, [wall(50, 10, 50, 90)], bounds);
  assert.equal(inPolygon({ x: 80, y: 50 }, solid), false);
  assert.equal(inPolygon({ x: 40, y: 50 }, solid), true);
  const glass = visibilityPolygon(eye, [wall(50, 10, 50, 90, 'window')], bounds);
  assert.equal(inPolygon({ x: 80, y: 50 }, glass), true);
  const door = visibilityPolygon(eye, [{ ...wall(50, 10, 50, 90, 'door'), open: true }], bounds);
  assert.equal(inPolygon({ x: 80, y: 50 }, door), true);
});

test('в темноте видно освещённое и то, что в радиусе тёмного зрения', () => {
  const eye = { x: 10, y: 10 };
  const poly = visibilityPolygon(eye, [], bounds);
  const lightPoly = visibilityPolygon({ x: 80, y: 80 }, [], bounds, 15);
  const vis = { visions: [{ ...eye, poly, darkvision: 0 }], lights: [{ x: 80, y: 80, radius: 15, poly: lightPoly }], dark: true };
  assert.equal(pointVisible({ x: 85, y: 80 }, vis), true, 'у факела видно');
  assert.equal(pointVisible({ x: 40, y: 40 }, vis), false, 'в темноте без света не видно');
  vis.visions[0].darkvision = 50;
  assert.equal(pointVisible({ x: 40, y: 40 }, vis), true, 'тёмное зрение');
  vis.dark = false;
  assert.equal(pointVisible({ x: 95, y: 5 }, vis), true, 'светлая сцена — видно всё в обзоре');
});
