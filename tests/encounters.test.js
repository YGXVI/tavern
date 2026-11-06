import test from 'node:test';
import assert from 'node:assert/strict';
import { newEncounter, addToEncounter, encounterById, encounterCreature } from '../dist/js/views/camp/encounters.js';
const values = new Map();
globalThis.localStorage = { getItem: (k) => values.get(k) || null, setItem: (k, v) => values.set(k, v) };

test('встреча хранит копию личного существа, объединяет только одинаковые id и ограничивает количество', () => {
  const e = newEncounter('c', 'gm');
  const c = { id: 'own-1', name: 'Страж', hp: 12, cr: '1', actions: [{ name: 'Копьё' }] };
  addToEncounter('c', 'gm', e.id, 'libsrc:own-1', 2, c);
  c.actions[0].name = 'Изменено';
  addToEncounter('c', 'gm', e.id, 'libsrc:own-1', 40, c);
  addToEncounter('c', 'gm', e.id, 'goblin', 1);
  const saved = encounterById('c', 'gm', e.id);
  assert.equal(saved.monsters.length, 2);
  assert.equal(saved.monsters[0].count, 40);
  assert.equal(saved.monsters[0].creature.actions[0].name, 'Копьё');
  assert.equal(encounterById('c', 'other', e.id), null);
});

test('личное существо: актуальный шаблон, затем сохранённая копия; пропавшее без копии явно недоступно', () => {
  const row = { id: 'libsrc:own', creature: { id: 'own', name: 'Раньше', hp: 10 } };
  assert.equal(encounterCreature(row, [{ id: 'own', name: 'Сейчас', hp: 20 }]).hp, 20);
  assert.equal(encounterCreature(row, []).name, 'Раньше');
  assert.equal(encounterCreature({ id: 'libsrc:deleted' }, []), null);
});

test('прежний формат встречи с id бестиария продолжает работать', () => {
  const m = encounterCreature({ id: 'goblin', count: 2 });
  assert.equal(m.id, 'goblin');
  assert.ok(m.name);
});

test('серверный повтор ждёт подтверждения и при отказе остаётся доступен для повтора', async () => {
  globalThis.self ??= {};
  globalThis.window ??= { addEventListener() {}, removeEventListener() {} };
  const interval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  const { History } = await import('../dist/js/views/table/history.js');
  globalThis.setInterval = interval;
  const h = new History(), notifications = [];
  let settle;
  const entry = { label: 'Встреча', redoRemote: () => new Promise((resolve, reject) => { settle = { resolve, reject }; }) };
  h.undone.push(entry);
  const ctx = { toast: (v) => notifications.push(v.title), invalidate() {} };
  h.redo(ctx);
  await Promise.resolve();
  assert.equal(h.canUndo, false); assert.equal(h.canRedo, false);
  assert.equal(h.redo(ctx), null, 'повторный клик не запускает вторую операцию');
  settle.reject(new Error('Нет связи'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(h.canRedo, true); assert.equal(h.canUndo, false);
  h.redo(ctx); await Promise.resolve(); settle.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(h.canUndo, true); assert.equal(h.canRedo, false);
  assert.deepEqual(notifications, ['Не удалось повторить', 'Повторено: Встреча']);
});
