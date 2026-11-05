// TASK-097 (остаток): своё существо на карту — снимок и токен одной операцией place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupPlacements } from '../dist/js/server/model.js';

const creature = (id, cid = 'c1') => ({ table: 'campaign_creatures', op: 'insert', key: id, row: { campaign_id: cid, id, data: { name: 'Волк', source: 'manual' } } });
const token = (id, monsterId, cid = 'c1') => ({ table: 'tokens', op: 'insert', key: id, row: { id, campaign_id: cid, scene_id: 's', data: { monsterId } } });

test('снимок и токен на него — одна операция place на месте снимка', () => {
  const log = { table: 'log_entries', op: 'insert', key: 'l1', row: {} };
  const out = groupPlacements([creature('cr1'), log, token('t1', 'lib:cr1')]);
  assert.deepEqual(out.map((o) => o.op), ['place', 'insert']);
  assert.equal(out[0].creature.id, 'cr1');
  assert.equal(out[0].token.id, 't1');
  assert.equal(out[0].parts.length, 2);
  assert.equal(out[1], log);
});

test('второй токен того же существа и чужие ссылки остаются отдельными вставками', () => {
  const out = groupPlacements([creature('cr1'), token('t1', 'lib:cr1'), token('t2', 'lib:cr1'), token('t3', 'srd:wolf'), creature('cr2', 'c2'), token('t4', 'lib:cr2', 'c1')]);
  assert.deepEqual(out.map((o) => `${o.op}:${o.key}`), ['place:t1', 'insert:t2', 'insert:t3', 'insert:cr2', 'insert:t4']);
});

test('без снимка — ничего не группируется', () => {
  const ops = [token('t1', 'lib:cr1')];
  assert.deepEqual(groupPlacements(ops), ops);
});
