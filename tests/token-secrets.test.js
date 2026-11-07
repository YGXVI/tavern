// Тайное мастера в токенах (аудит 04.11, #204, 20261105170000): мастер видит токен целиком, игрок — степень ранения.
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDB } from '../dist/js/data/demo.js';
import { viewToken, rowsFrom, applyChange, applyOps, assemble, explode, diffRows } from '../dist/js/server/model.js';

const demo = () => structuredClone(seedDB().campaigns['c-crypt']);
// Порядок колонок — как отдаёт сервер (owner_id добавлен позже остальных).
const pub = { id: 't-x', campaign_id: 'c-crypt', scene_id: null, character_id: null, hidden: false, ord: 1,
  data: { kind: 'foe', x: 1, y: 2, nameHidden: true, wound: 'bloodied', _s: ['hp', 'hpMax', 'name', 'disposition'] }, owner_id: null };
const secret = { token_id: 't-x', campaign_id: 'c-crypt', data: { hp: 8, hpMax: 20, name: 'Предатель', disposition: 'secret' } };

test('мастер: тайные поля подставлены, служебных нет', () => {
  const v = viewToken(pub, { master: true, secret });
  assert.deepEqual(v.data, { kind: 'foe', x: 1, y: 2, nameHidden: true, hp: 8, hpMax: 20, name: 'Предатель', disposition: 'secret' });
});

test('игрок: хиты по степени ранения, скрытый враг — союзник, имени нет', () => {
  const v = viewToken(pub, { master: false });
  assert.equal(v.data.hp, 40); assert.equal(v.data.hpMax, 100);
  assert.equal(v.data.disposition, 'friendly');
  assert.equal(v.data.name, undefined);
  assert.deepEqual(v.data._s, pub.data._s); // остаётся — строка из кампании совпадёт с кэшем
});

test('токен без тайного не меняется', () => {
  const row = { id: 't-y', data: { kind: 'hero', hp: 5 } };
  assert.equal(viewToken(row, { master: false }), row);
});

function loaded(master) {
  const c = demo(); const sid = c.scenes[0].id;
  const rows = explode(c);
  const tokens = [...rows.tokens.values(), { ...pub, scene_id: sid }];
  return rowsFrom({ campaign: rows.campaign, members: [...rows.members.values()], characters: [...rows.characters.values()], scenes: [...rows.scenes.values()],
    secrets: [...rows.secrets.values()], explored: [...rows.explored.values()], tokens, drawings: [...rows.drawings.values()],
    log: [], logSecrets: [], saves: [], portals: [], combat: rows.combat, tokenSecrets: master ? [secret] : [], master });
}

test('мастер: движение из реального времени не теряет секрет, новый секрет подставляется', () => {
  const rows = loaded(true);
  applyChange(rows, 'tokens', 'UPDATE', { ...rows.tokens.get('t-x'), data: { ...pub.data, x: 9, wound: 'critical' } });
  assert.equal(rows.tokens.get('t-x').data.x, 9);
  assert.equal(rows.tokens.get('t-x').data.hp, 8);
  applyChange(rows, 'token_secrets', 'UPDATE', { ...secret, data: { ...secret.data, hp: 3 } });
  assert.equal(rows.tokens.get('t-x').data.hp, 3);
  assert.equal(rows.tokens.get('t-x').data._s, undefined);
});

test('мастер: правка хитов уходит полными данными, без служебных полей', () => {
  const rows = loaded(true);
  const c = assemble(rows);
  const t = c.scenes[0].tokens.find((x) => x.id === 't-x');
  assert.equal(t.hp, 8);
  t.hp = 2;
  const ops = diffRows(rows, explode(c, rows), { isMaster: true }).filter((o) => o.table === 'tokens');
  assert.equal(ops.length, 1);
  assert.equal(ops[0].row.data.hp, 2);
  assert.ok(!('_s' in ops[0].row.data) && !('wound' in ops[0].row.data));
});

test('игрок: сборка и разборка без изменений не шлёт ничего, движение — только место', () => {
  const rows = loaded(false);
  const c = assemble(rows);
  assert.deepEqual(diffRows(rows, explode(c, rows)).filter((o) => o.table === 'tokens'), []);
  const t = c.scenes[0].tokens.find((x) => x.id === 't-x');
  t.x = 50;
  const ops = diffRows(rows, explode(c, rows)).filter((o) => o.table === 'tokens');
  assert.equal(ops.length, 1);
  assert.deepEqual(Object.keys(ops[0].row.data).filter((k) => JSON.stringify(ops[0].row.data[k]) !== JSON.stringify(ops[0].prev.data[k])), ['x']);
  applyOps(rows, ops);
  applyChange(rows, 'tokens', 'UPDATE', { ...pub, scene_id: rows.tokens.get('t-x').scene_id, data: { ...pub.data, x: 50 } });
  assert.equal(rows.tokens.get('t-x').data.hp, 40);
});
