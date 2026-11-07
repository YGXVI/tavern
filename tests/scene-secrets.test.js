// Тайное мастера в сценах (аудит 04.11, #204, 20261106160000): мастер видит сцену целиком, игрок — публичную строку.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDB } from '../dist/js/data/demo.js';
import { viewScene, rowsFrom, applyChange, assemble, explode, diffRows } from '../dist/js/server/model.js';

const pub = { id: 's-x', campaign_id: 'c-crypt', ord: 9, data: { name: 'Логово', walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 9, y: 0 }, kind: 'wall' }, { id: 'w2', a: { x: 1, y: 1 }, b: { x: 2, y: 2 }, kind: 'door' }] }, revealed: true };
const hidden = { scene_id: 's-x', campaign_id: 'c-crypt', data: { note: 'Засада', walls: { w1: { kind: 'secret', lockDc: 18, name: 'За гобеленом' }, w2: { lockDc: 12 } } } };

test('мастер: скрытое подставлено; колонка revealed в кэш не попадает', () => {
  const v = viewScene(pub, { master: true, hidden });
  assert.equal(v.data.note, 'Засада');
  assert.deepEqual(v.data.walls[0], { id: 'w1', a: { x: 0, y: 0 }, b: { x: 9, y: 0 }, kind: 'secret', lockDc: 18, name: 'За гобеленом' });
  assert.equal(v.data.walls[1].lockDc, 12);
  assert.ok(!('revealed' in v));
});

test('игрок: публичная строка без подстановок', () => {
  const v = viewScene(pub, { master: false });
  assert.equal(v.data.walls[0].kind, 'wall');
  assert.equal(v.data.note, undefined);
  assert.ok(!('revealed' in v));
});

function loaded(master) {
  const r = explode(structuredClone(seedDB().campaigns['c-crypt']));
  return rowsFrom({ campaign: r.campaign, members: [...r.members.values()], characters: [...r.characters.values()], scenes: [...r.scenes.values(), pub], secrets: [...r.secrets.values()],
    explored: [...r.explored.values()], tokens: [...r.tokens.values()], drawings: [...r.drawings.values()], log: [], logSecrets: [], saves: [], portals: [], combat: r.combat, sceneHidden: master ? [hidden] : [], master });
}

test('мастер: дверь игрока из реального времени не теряет скрытое, новое скрытое подставляется', () => {
  const rows = loaded(true);
  applyChange(rows, 'scenes', 'UPDATE', { ...pub, data: { ...pub.data, walls: [pub.data.walls[0], { ...pub.data.walls[1], open: true }] } });
  const s = rows.scenes.get('s-x');
  assert.equal(s.data.walls[1].open, true); assert.equal(s.data.walls[1].lockDc, 12); assert.equal(s.data.walls[0].kind, 'secret');
  applyChange(rows, 'scene_hidden', 'UPDATE', { ...hidden, data: { ...hidden.data, note: 'Пусто' } });
  assert.equal(rows.scenes.get('s-x').data.note, 'Пусто');
});

test('событие раньше скрытого: мастер не теряет потайную дверь', () => {
  const rows = loaded(true);
  rows.sceneHidden.delete('s-x');
  applyChange(rows, 'scenes', 'UPDATE', pub);
  assert.equal(rows.scenes.get('s-x').data.walls[0].kind, 'secret');
  assert.equal(rows.scenes.get('s-x').data.note, 'Засада');
});

test('как при commit: чужая правка сцены не трогает, правка мастера уходит с потайной дверью целиком', () => {
  for (const master of [true, false]) {
    const rows = loaded(master);
    const before = assemble(rows), after = structuredClone(before);
    after.name = 'Другое имя';
    const ops = diffRows(explode(before, rows), explode(after, rows), { isMaster: master }).filter((o) => o.table === 'scenes');
    assert.deepEqual(ops, [], master ? 'мастер' : 'игрок');
  }
  const rows = loaded(true);
  const before = assemble(rows), after = structuredClone(before);
  after.scenes.find((x) => x.id === 's-x').note = 'Новая заметка';
  const [op] = diffRows(explode(before, rows), explode(after, rows), { isMaster: true }).filter((o) => o.table === 'scenes');
  assert.equal(op.row.data.note, 'Новая заметка');
  assert.equal(op.row.data.walls[0].kind, 'secret');
  assert.equal(op.row.data.walls[0].lockDc, 18);
});
