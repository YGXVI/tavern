// TASK-186 P4a prototype: create_character_sheet client and creationHitPoints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCharacterSheetClient, makeCreateRequest, SheetCommandError } from '../dist/js/server/character-sheet.js';
import { creationHitPoints } from '../dist/js/views/table/sheet-rules.js';

const characterId = '10000000-0000-4000-8000-000000000001', operationId = '10000000-0000-4000-8000-000000000002';
const input = () => ({ campaignId: 'c-test', characterId, operationId, data: { name: 'Лира', profile: 'pc', hp: 12, hpMax: 12 }, claim: true });
const ack = (replayed = false) => ({ data: { ok: true, operationId, replayed, sheet: { id: characterId, campaignId: 'c-test', version: '1', data: { name: 'Лира' } } }, error: null });

test('create request is frozen, keeps caller IDs and refuses server-owned fields', () => {
  const data = input(), request = makeCreateRequest(data);
  data.data.name = 'Другое';
  assert.equal(request.data.name, 'Лира');
  assert.ok(Object.isFrozen(request.data));
  assert.throws(() => makeCreateRequest({ ...input(), characterId: operationId }), /разные UUID/);
  assert.throws(() => makeCreateRequest({ ...input(), characterId: 'ch-1' }), /UUID/);
  assert.throws(() => makeCreateRequest({ ...input(), data: { ownerId: 'x' } }), /ownerId/);
});

test('lost answer: retry resends the identical create; duplicate ID and protocol errors are typed', async () => {
  const calls = [];
  let fail = true;
  const client = createCharacterSheetClient(async () => ({ rpc: async (name, args) => { calls.push({ name, args }); if (fail) { fail = false; throw new TypeError('lost'); } return ack(true); } }));
  let error;
  try { await client.create(input()); } catch (e) { error = e; }
  assert.equal(error.kind, 'network');
  const result = await client.retry(error);
  assert.equal(result.replayed, true);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].name, 'create_character_sheet');
  assert.equal(calls[0].args.p_claim, true);
  const dup = createCharacterSheetClient(async () => ({ rpc: async () => ({ data: null, error: { code: '23505' } }) }));
  await assert.rejects(dup.create(input()), e => e instanceof SheetCommandError && e.kind === 'duplicate' && !e.retryable);
  const odd = createCharacterSheetClient(async () => ({ rpc: async () => ({ data: { ok: true, operationId: 'other', replayed: false, sheet: {} }, error: null }) }));
  await assert.rejects(odd.create(input()), e => e.kind === 'protocol');
});

test('creationHitPoints matches the SQL fixtures (fixed average, Dwarven Toughness, Draconic Resilience, multiclass)', () => {
  const fixtures = JSON.parse(readFileSync(new URL('../supabase/tests/character_create_fixtures.json', import.meta.url)));
  const expected = { 'fighter1': 12, 'sorcerer3-draconic': 23, 'cleric5-hill-dwarf': 43, 'fighter2-wizard2': 32, 'barbarian20': 225 };
  for (const f of fixtures) assert.equal(f.data.hpMax, expected[f.name], f.name);
  assert.equal(creationHitPoints({ method: 'fixed_average', firstLevelHitDie: 10, hitDice: [{ classId: 'a', die: 10, count: 2 }, { classId: 'b', die: 6, count: 2 }], perLevelBonus: [], constitution: 14 }), 32);
  assert.equal(creationHitPoints({ method: 'fixed_average', firstLevelHitDie: 6, hitDice: [{ classId: 's', die: 6, count: 3 }], perLevelBonus: [{ perClassLevel: 's' }], constitution: 14 }), 23);
  assert.equal(creationHitPoints({ method: 'fixed_average', firstLevelHitDie: 8, hitDice: [{ classId: 'c', die: 8, count: 5 }], perLevelBonus: [{ perCharacterLevel: true }], constitution: 15 }), 43);
  assert.equal(creationHitPoints({ method: 'fixed_average', firstLevelHitDie: 8, hitDice: [{ classId: 'c', die: 8, count: 1 }], constitution: null }), null, 'unknown CON stays unknown');
  assert.equal(creationHitPoints({ method: 'rolled', firstLevelHitDie: 8, hitDice: [{ classId: 'c', die: 8, count: 1 }], constitution: 10 }), null);
});
