import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCharacterSnapshot, emptyRows, assemble, explode } from '../dist/js/server/model.js';

const snapshot = () => ({
  campaignId: 'c-test', id: 'ch-test', ownerId: 'u-player', version: '8', managed: true, archivedAt: null,
  data: { name: 'Герой', hp: 9, customLegacy: { keep: true } },
});

test('ACK листа обновляет кэш отдельно от JSONB и не делит объекты с ответом', () => {
  const rows = emptyRows();
  rows.campaign = { id: 'c-test', owner_id: 'u-master', name: 'Кампания', data: {} };
  const sheet = snapshot();
  applyCharacterSnapshot(rows, sheet);
  sheet.data.customLegacy.keep = false;
  assert.equal(rows.characters.get('ch-test').data.customLegacy.keep, true);
  assert.equal(rows.characters.get('ch-test').sheet_version, '8');
  const campaign = assemble(rows);
  const row = explode(campaign, rows).characters.get('ch-test');
  assert.deepEqual(row.data, { name: 'Герой', hp: 9, customLegacy: { keep: true } });
  assert.equal(row.data.sheet_version, undefined);
});

test('исторический ACK не откатывает новую версию и чужая кампания не изменяет кэш', () => {
  const rows = emptyRows();
  rows.campaign = { id: 'c-test', data: {} };
  applyCharacterSnapshot(rows, { ...snapshot(), version: '9007199254740993' });
  applyCharacterSnapshot(rows, snapshot());
  assert.equal(rows.characters.get('ch-test').sheet_version, '9007199254740993');
  assert.throws(() => applyCharacterSnapshot(rows, { ...snapshot(), campaignId: 'other' }));
  assert.equal(rows.characters.size, 1);
});

test('архив не возвращается в активный список и не удаляется при обычной записи кампании', () => {
  const rows = emptyRows(); rows.campaign = {id:'c-test',data:{}};
  applyCharacterSnapshot(rows,{...snapshot(),archivedAt:'2026-10-30T00:00:00Z'});
  const campaign=assemble(rows);assert.equal(campaign.characters.length,0);assert.equal(campaign.archivedCharacters.length,1);
  const roundtrip=explode(campaign,rows);assert.equal(roundtrip.characters.size,1);
  assert.equal(roundtrip.characters.get('ch-test').archived_at,'2026-10-30T00:00:00Z');
  assert.equal(roundtrip.characters.get('ch-test').sheet_managed,true);
  assert.equal(roundtrip.campaign.data.archivedCharacters,undefined);
});
