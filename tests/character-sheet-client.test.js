import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacterSheetClient, makeSheetCommand, SheetCommandError } from '../dist/js/server/character-sheet.js';

const operationId = '50000000-0000-0000-0000-000000000001';
const input = () => ({ campaignId: 'c-test', characterId: 'ch-test', version: '7', kind: 'adjust', payload: { hp: -5 }, operationId });
const sheet = (version = '8') => ({ id: 'ch-test', campaignId: 'c-test', version, data: { hp: 9 }, controllers: [], archivedAt: null });
const ack = (replayed = false) => ({ data: { ok: true, operationId, replayed, sheet: sheet() }, error: null });

test('команда фиксирует UUID, ожидаемую версию и копию payload до сетевого запроса', () => {
  const data = input();
  const command = makeSheetCommand(data);
  data.payload.hp = -50;
  assert.equal(command.payload.hp, -5);
  assert.equal(command.version, '7');
  assert.ok(Object.isFrozen(command.payload));
  for (const version of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '', null]) assert.throws(() => makeSheetCommand({ ...input(), version }));
  assert.equal(makeSheetCommand({ ...input(), version: '9007199254740993' }).version, '9007199254740993');
  assert.equal(makeSheetCommand({ ...input(), operationId: 'ABCDEF00-0000-0000-0000-000000000001' }).operationId, 'abcdef00-0000-0000-0000-000000000001');
  assert.throws(() => makeSheetCommand({ ...input(), payload: { hp: NaN } }));
  assert.throws(() => makeSheetCommand({ ...input(), payload: { missing: undefined } }));
});

test('сетевой отказ сохраняет ту же команду для явного повтора, без автоматического второго расхода', async () => {
  const calls = [];
  const client = createCharacterSheetClient(async () => ({ rpc: async (name, args) => {
    calls.push({ name, args });
    if (calls.length === 1) throw new TypeError('network lost');
    return ack();
  } }));
  let failed;
  try { await client.execute(makeSheetCommand(input())); } catch (error) { failed = error; }
  assert.ok(failed instanceof SheetCommandError);
  assert.equal(failed.kind, 'network');
  assert.equal(calls.length, 1);
  const result = await client.retry(failed);
  assert.equal(result.appliedVersion, '8');
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[1].args.p_expected_version, '7');
  assert.equal(calls[1].args.p_operation, operationId);
});

test('конфликт не повторяется сам и сохраняет ввод с актуальной версией из отказа', async () => {
  let count = 0;
  const client = createCharacterSheetClient(async () => ({ rpc: async () => {
    count++;
    return { error: { code: '40001', details: '{"version":"12"}' }, data: null };
  } }));
  await assert.rejects(client.execute(input()), (error) => {
    assert.equal(error.kind, 'conflict');
    assert.deepEqual(error.details, { version: '12' });
    assert.equal(error.request.payload.hp, -5);
    assert.equal(error.retryable, false);
    return true;
  });
  assert.equal(count, 1);
});

test('повтор старого ACK перечитывает лист и не возвращает исторический снимок как актуальный', async () => {
  const calls = [];
  const client = createCharacterSheetClient(async () => ({ rpc: async (name, args) => {
    calls.push({ name, args });
    return name === 'character_command' ? ack(true) : { data: sheet('15'), error: null };
  } }));
  const result = await client.execute(input());
  assert.equal(result.appliedVersion, '8');
  assert.equal(result.sheet.version, '15');
  assert.equal(calls[1].name, 'read_character_sheet');
});

test('отказ прав и отсутствие миграции — разные ошибки; некорректный ACK не означает сохранение', async () => {
  for (const [code, kind] of [['42501', 'forbidden'], ['42883', 'unavailable'], ['PGRST202', 'unavailable'], ['PGRST301', 'forbidden'], ['22023', 'validation'], ['P0001', 'archived']]) {
    const client = createCharacterSheetClient(async () => ({ rpc: async () => ({ error: { code } }) }));
    await assert.rejects(client.execute(input()), (e) => e.kind === kind);
  }
  const client = createCharacterSheetClient(async () => ({ rpc: async () => ({ data: { ok: true } }) }));
  await assert.rejects(client.execute(input()), (e) => e.kind === 'protocol' && e.request.operationId === operationId);
});
