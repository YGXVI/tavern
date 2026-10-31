import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogueLibrary, privateCatalogueSnapshot } from '../dist/js/core/catalogue-library.js';
import { createServerCatalogueLibrary } from '../dist/js/server/catalogue-library.js';
import { normalizeManualCatalogueData } from '../dist/js/rules/catalogue.js';

const feature = () => normalizeManualCatalogueData('feature', { name: { ru: 'Личная способность' }, text: { ru: 'Проза из моей книги' } });
const item = () => normalizeManualCatalogueData('magic_item', { name: { ru: 'Личный предмет' }, description: { ru: 'Собственное описание' } });
const record = (extra = {}) => ({ id: 'same', kind: 'feature', ownerId: 'user-a', revision: 0, data: feature(), ...extra });
function sandbox() {
  let data = JSON.stringify({ version: 1, users: {}, campaigns: { c: { name: 'Кампания' } }, creatures: { x: { untouched: true } } });
  let userId = 'user-a', fail = false;
  const storage = { getItem: () => data, setItem: (key, value) => { if (fail) throw new Error('Storage full'); data = value; } };
  const api = createCatalogueLibrary({ storage, getContext: () => ({ userId }), now: () => 100, makeId: () => 'generated' });
  return { api, user: id => { userId = id; }, fail: () => { fail = true; }, read: () => JSON.parse(data), storage };
}

test('private sandbox uses owner-scoped IDs, preserves other root data and enforces CAS/delete', async () => {
  const s = sandbox();
  const a = await s.api.save(record());
  assert.equal(a.revision, 1); assert.equal(a.updatedAt, 100);
  assert.deepEqual(s.read().campaigns, { c: { name: 'Кампания' } });
  assert.deepEqual(s.read().creatures, { x: { untouched: true } });
  assert.equal(s.read().version, 1);
  a.data.text.ru = 'Не менять сохранённое';
  assert.equal((await s.api.list())[0].data.text.ru, 'Проза из моей книги');
  await assert.rejects(s.api.save(record()), e => e.code === 'CATALOGUE_CONFLICT');
  s.user('user-b'); assert.deepEqual(await s.api.list(), []);
  const b = await s.api.save(record({ ownerId: '', kind: 'magic_item', data: item() }));
  assert.equal(b.id, a.id);
  await assert.rejects(s.api.save(record()), /чужую/);
  await assert.rejects(s.api.remove(b.id, 2), e => e.code === 'CATALOGUE_CONFLICT');
  await s.api.remove(b.id, 1);
  s.user('user-a');
  const updated = await s.api.save(record({ revision: 1, data: { ...feature(), text: { ru: 'Новое', en: null } } }));
  assert.equal(updated.revision, 2);
  await assert.rejects(s.api.remove(a.id, 1), e => e.code === 'CATALOGUE_CONFLICT');
  assert.equal((await s.api.list({ kind: 'feature' }))[0].data.text.ru, 'Новое');
  assert.deepEqual(await s.api.list({ kind: 'magic_item' }), []);
});

test('500 quota covers both private types; failures and concurrent stale revisions stay visible', async () => {
  const s = sandbox(), db = s.read(); db.catalogueEntries = {};
  for (let i = 0; i < 499; i++) {
    const r = record({ id: `c-${i}`, revision: 1, kind: i % 2 ? 'magic_item' : 'feature', data: i % 2 ? item() : feature() });
    db.catalogueEntries[JSON.stringify(['user-a', r.id])] = r;
  }
  s.storage.setItem('', JSON.stringify(db));
  const last = await s.api.save(record());
  await assert.rejects(s.api.save(record({ id: 'extra' })), /500/);
  const writes = await Promise.allSettled([s.api.save({ ...last, data: feature() }), s.api.save({ ...last, data: feature() })]);
  assert.equal(writes.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(writes.find(r => r.status === 'rejected').reason.code, 'CATALOGUE_CONFLICT');
  s.fail(); await assert.rejects(s.api.remove('same', 2), /Storage full/);
  assert.equal((await s.api.list()).length, 500);
});

test('manual validation, malformed storage and type switches cannot silently replace records', async () => {
  const s = sandbox();
  await assert.rejects(s.api.save(record({ revision: null })), e => e.errors.some(e => e.path === 'revision'));
  await assert.rejects(s.api.save(record({ data: { ...feature(), source: { kind: 'srd51' } } })), e => e.errors.some(e => e.path === 'data.source'));
  await s.api.save(record());
  await assert.rejects(s.api.save(record({ revision: 1, kind: 'magic_item', data: item() })), e => e.code === 'CATALOGUE_CONFLICT');
  s.storage.setItem('', '{broken');
  await assert.rejects(s.api.list(), SyntaxError);
  await assert.rejects(s.api.save(record()), SyntaxError);
  assert.equal(s.storage.getItem(''), '{broken');
});

test('server private records never enter sandbox and async results are dropped after user/mode change', async () => {
  let finish, ctx = { userId: 'user-a', server: { list: () => new Promise(resolve => { finish = resolve; }) } };
  const api = createCatalogueLibrary({ getContext: () => ctx, storage: { getItem() { throw new Error('No private server read from localStorage'); }, setItem() { throw new Error('No server data write to localStorage'); } } });
  const pending = api.list(); await new Promise(resolve => setImmediate(resolve));
  ctx = { userId: 'user-b' }; finish([record({ revision: 1 })]);
  await assert.rejects(pending, /изменился/);
  ctx = { userId: null }; await assert.rejects(api.list(), /Войдите/);
});

test('private preview detaches one saved template without a Character or side effects', async () => {
  const s = sandbox(), saved = await s.api.save(record());
  const snapshot = privateCatalogueSnapshot(saved);
  assert.deepEqual(snapshot.catalogueRef, { kind: 'feature', id: 'user:user-a:same', revision: '1' });
  snapshot.data.text.ru = 'Экземпляр';
  assert.equal((await s.api.list())[0].data.text.ru, 'Проза из моей книги');
  assert.throws(() => privateCatalogueSnapshot(record()), /Сначала сохраните/);
  assert.equal(snapshot.data.id, undefined);
});

function transport(responses = []) {
  const calls = []; let userId = 'user-a';
  return { calls, user: id => { userId = id; }, client: {
    auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
    async rpc(name, args) { calls.push({ rpc: name, args }); return responses.shift() || {}; },
    from(table) {
      const call = { table, steps: [] }; calls.push(call);
      const query = new Proxy({}, { get: (_, method) => method === 'then'
        ? (ok, bad) => Promise.resolve(responses.shift() || {}).then(ok, bad)
        : (...args) => { call.steps.push([method, ...args]); return query; } });
      return query;
    },
  } };
}
const row = (revision = 1, owner_id = 'user-a') => ({ id: 'same', owner_id, revision, kind: 'feature', data: feature(), updated_at: '2026-10-31T01:00:00Z' });

test('server writes use CAS RPC, exact ACKs and owner-scoped list, never direct table patches', async () => {
  const t = transport([{ data: [row()] }, { data: [row()] }, { data: 'same' }]);
  const api = createServerCatalogueLibrary(t.client, 'user-a');
  assert.equal((await api.save(record())).revision, 1);
  assert.equal((await api.list({ kind: 'feature' })).length, 1);
  assert.equal(await api.remove('same', 1), true);
  assert.equal(t.calls[0].rpc, 'save_catalogue_entry');
  assert.equal(t.calls[0].args.p_revision, 0);
  assert.equal(t.calls[0].args.p_owner, 'user-a', 'RPC guards an account switch after getUser and before the request');
  assert.equal(t.calls[0].args.p_data.ownerId, undefined);
  assert.equal(t.calls[1].table, 'user_catalogue_entries');
  assert.ok(t.calls[1].steps.some(s => s[0] === 'eq' && s[1] === 'owner_id' && s[2] === 'user-a'));
  assert.equal(t.calls[2].rpc, 'delete_catalogue_entry');
  assert.equal(t.calls[2].args.p_revision, 1);
  assert.equal(t.calls[2].args.p_owner, 'user-a');
});

test('server conflicts, malformed/foreign ACKs, auth changes and diagnostic prose are not accepted', async () => {
  const t = transport([{ error: { code: '40001' } }, { data: [row(99)] }, { data: [row(1, 'user-b')] }, { data: [] }, { error: { code: '23514', message: 'CHECK failed', details: 'PRIVATE BOOK PROSE' } }]);
  const api = createServerCatalogueLibrary(t.client, 'user-a');
  await assert.rejects(api.save(record()), e => e.code === 'CATALOGUE_CONFLICT');
  await assert.rejects(api.save(record()), /подтверждение/);
  await assert.rejects(api.save(record()), /недоступна/);
  await assert.rejects(api.remove('same', 1), /не подтверждено/);
  await assert.rejects(api.save(record()), e => e.code === 'CATALOGUE_SERVER_ERROR' && !JSON.stringify(e).includes('PRIVATE') && !e.message.includes('PRIVATE'));
  t.user('user-b'); await assert.rejects(api.list(), /изменился/);
});
