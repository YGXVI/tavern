import test from 'node:test';
import assert from 'node:assert/strict';
import { createLibrary } from '../dist/js/core/library.js';
import { createServerLibrary, validateLibraryImage, LIBRARY_IMAGE_MAX_BYTES } from '../dist/js/server/library.js';
import { normalizeCreature } from '../dist/js/rules/creature.js';
import SRD from '../dist/js/data/bestiary-srd.js';

const creature = extra => normalizeCreature({ id: 'cr-1', ownerId: 'user-a', name: 'Страж', ...extra });
function sandbox() {
  let data = JSON.stringify({ version: 1, rev: 8, users: { 'user-a': {}, 'user-b': {} }, campaigns: { c: { name: 'Не потерять' } } });
  let userId = 'user-a', fail = false;
  const storage = { getItem: () => data, setItem: (key, value) => { if (fail) throw new Error('Storage full'); data = value; } };
  const api = createLibrary({ getContext: () => ({ userId }), storage, makeId: () => 'new-id', now: () => 10 });
  return { api, storage, read: () => JSON.parse(data), user: id => { userId = id; }, fail: () => { fail = true; } };
}

test('sandbox CRUD preserves campaigns/version and returns detached personal data', async () => {
  const s = sandbox();
  await assert.rejects(s.api.save(null), /объектом/);
  await assert.rejects(s.api.save(creature({ id: 0 })), e => e.errors.some(x => x.path === 'id'));
  const saved = await s.api.save(creature()); saved.stats.dex = 20;
  assert.equal(s.read().creatures[JSON.stringify(['user-a', 'cr-1'])].stats.dex, null);
  assert.equal(s.read().version, 1); assert.equal(s.read().campaigns.c.name, 'Не потерять');
  assert.equal((await s.api.list()).length, 1);
  s.user('user-b'); assert.deepEqual(await s.api.list(), []);
  await assert.rejects(s.api.save(creature()), /чужую/);
  await assert.rejects(s.api.remove('cr-1'), /недоступна/);
  s.user('user-a'); assert.equal(await s.api.remove('cr-1'), true);
  assert.deepEqual(await s.api.list(), []);
});

test('copy SRD assigns new identity/owner, preserves source and never writes a public catalogue', async () => {
  const s = sandbox(), original = structuredClone(SRD[0]);
  const c = await s.api.copyFromSrd(SRD[0]);
  assert.equal(c.id, 'new-id'); assert.equal(c.ownerId, 'user-a');
  assert.equal(c.provenance.id, SRD[0].id); assert.equal(c.updatedAt, 10);
  assert.deepEqual(SRD[0], original);
});

test('same ID belongs independently to two sandbox users, including legacy flat keys', async () => {
  const s = sandbox(), db = s.read();
  db.creatures = { 'cr-1': creature({ name: 'Старый A' }) };
  s.storage.setItem('', JSON.stringify(db));
  s.user('user-b');
  const b = await s.api.save(creature({ ownerId: '', name: 'Новый B' }));
  assert.equal(b.id, 'cr-1');
  assert.equal((await s.api.list())[0].name, 'Новый B');
  assert.equal(s.read().creatures['cr-1'].name, 'Старый A');
  s.user('user-a');
  assert.equal((await s.api.list())[0].name, 'Старый A');
  await s.api.save(creature({ name: 'Обновлён A' }));
  assert.equal(Object.hasOwn(s.read().creatures, 'cr-1'), false, 'only A legacy key is upgraded');
  assert.equal(s.read().creatures[JSON.stringify(['user-b', 'cr-1'])].name, 'Новый B');
  await s.api.remove('cr-1');
  assert.deepEqual(await s.api.list(), []);
  s.user('user-b');
  assert.equal((await s.api.list())[0].name, 'Новый B');
  await s.api.remove('cr-1');
  assert.deepEqual(s.read().creatures, {});
  assert.deepEqual(s.read().campaigns, db.campaigns);
  assert.equal(s.read().version, 1);
});

test('legacy and scoped copies of one sandbox entry consume one quota slot', async () => {
  const s = sandbox(), db = s.read(); db.creatures = {};
  for (let i = 0; i < 499; i++) db.creatures[`c-${i}`] = creature({ id: `c-${i}` });
  db.creatures[JSON.stringify(['user-a', 'c-1'])] = creature({ id: 'c-1', name: 'Актуальный' });
  s.storage.setItem('', JSON.stringify(db));
  assert.equal((await s.api.list()).length, 499);
  assert.equal((await s.api.list()).find(c => c.id === 'c-1').name, 'Актуальный');
  await s.api.save(creature({ id: 'last' }));
  assert.equal((await s.api.list()).length, 500);
  await assert.rejects(s.api.save(creature({ id: 'too-many' })), /500/);
  await s.api.remove('c-1');
  assert.equal(Object.hasOwn(s.read().creatures, 'c-1'), false);
  assert.equal(Object.hasOwn(s.read().creatures, JSON.stringify(['user-a', 'c-1'])), false);
});

test('sandbox quota is per owner; update is allowed at 500 and failed writes stay failed', async () => {
  const s = sandbox(), db = s.read(); db.creatures = {};
  for (let i = 0; i < 500; i++) db.creatures[`c-${i}`] = creature({ id: `c-${i}` });
  s.storage.setItem('', JSON.stringify(db));
  await assert.rejects(s.api.save(creature({ id: 'extra' })), /500/);
  await s.api.save(creature({ id: 'c-1', name: 'Обновлён' }));
  assert.equal(s.read().creatures[JSON.stringify(['user-a', 'c-1'])].name, 'Обновлён');
  await s.api.remove('c-1'); await s.api.save(creature({ id: 'extra' }));
  assert.equal(Object.keys(s.read().creatures).length, 500);
  s.user('user-b'); await s.api.save(creature({ id: 'other', ownerId: '' }));
  assert.equal((await s.api.list()).length, 1);
  s.fail(); await assert.rejects(s.api.remove('other'), /Storage full/);
  assert.equal(s.read().creatures[JSON.stringify(['user-b', 'other'])].ownerId, 'user-b');
});

test('malformed sandbox data and invalid statblocks are reported without destructive reset', async () => {
  const s = sandbox();
  await assert.rejects(s.api.save(creature({ actions: [{ name: 'A', text: '', save: { ability: 'con', dc: 10 } }] })), e => e.errors.some(x => x.path === 'actions.0.save.who'));
  s.storage.setItem('', '{broken');
  await assert.rejects(s.api.list(), SyntaxError);
  await assert.rejects(s.api.save(creature()), SyntaxError);
  assert.equal(s.storage.getItem(''), '{broken');
});

test('async response from previous user/mode is not returned; server data never enters sandbox', async () => {
  let finish, ctx = { userId: 'user-a', server: { list: () => new Promise(resolve => { finish = resolve; }) } };
  const api = createLibrary({ getContext: () => ctx, storage: { getItem() { throw new Error('No local read in server mode'); }, setItem() { throw new Error('No local write in server mode'); } } });
  const pending = api.list(); await new Promise(resolve => setImmediate(resolve));
  ctx = { userId: 'user-b' }; finish([creature()]);
  await assert.rejects(pending, /изменился/);
  ctx = { userId: null }; await assert.rejects(api.list(), /Войдите/);
  ctx = { userId: 'user-a', server: { list: () => new Promise(resolve => { finish = resolve; }) } };
  const modeChanged = api.list(); await new Promise(resolve => setImmediate(resolve));
  ctx = { userId: 'user-a' }; finish([creature()]);
  await assert.rejects(modeChanged, /режим изменился/);
});

// A transport fake asserts requests/ACKs; actual RLS is tested on PostgreSQL separately.
function transport(responses = []) {
  const calls = []; let user = 'user-a';
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: user } }, error: null }) },
    async rpc(name) { calls.push({ rpc: name }); return responses.shift() || { data: [], error: null }; },
    from(table) {
      const call = { table, steps: [] }; calls.push(call);
      const query = new Proxy({}, { get: (_, method) => method === 'then'
        ? (ok, bad) => Promise.resolve(responses.shift() || { data: [], error: null }).then(ok, bad)
        : (...args) => { call.steps.push([method, ...args]); return query; } });
      return query;
    },
    storage: { from(bucket) { return {
      async upload(path, file, options) { calls.push({ bucket, upload: path, options }); return responses.shift() || { error: null }; },
      async createSignedUrl(path, seconds) { calls.push({ bucket, path, seconds }); return responses.shift() || { data: { signedUrl: 'https://private.example/signed' }, error: null }; },
      async remove(paths) { calls.push({ bucket, remove: paths }); return responses.shift() || { data: paths.map(name => ({ name })), error: null }; },
    }; } },
  };
  return { client, calls, user: id => { user = id; } };
}
const row = (data = {}, owner = 'user-a') => ({ id: 'cr-1', owner_id: owner, data: { name: 'Страж', source: 'manual', ...data }, updated_at: '2026-10-30T10:00:00Z' });

test('server save waits for returned row; list/delete filter by owner and metadata stays in columns', async () => {
  const t = transport([{ data: row({ hp: 22 }), error: null }, { data: [row()], error: null }, { data: [{ id: 'cr-1' }], error: null }]);
  const api = createServerLibrary(t.client, 'user-a');
  const saved = await api.save(creature({ hp: 21 }));
  assert.equal(saved.hp, 22, 'return the acknowledged server value, not optimistic input');
  const payload = t.calls[0].steps.find(s => s[0] === 'upsert')[1];
  assert.equal(payload.owner_id, 'user-a');
  assert.deepEqual(t.calls[0].steps.find(s => s[0] === 'upsert')[2], { onConflict: 'owner_id,id' });
  assert.equal(payload.data.id, undefined); assert.equal(payload.data.ownerId, undefined); assert.equal(payload.data.updatedAt, undefined);
  assert.equal((await api.list())[0].ownerId, 'user-a');
  assert.equal(await api.remove('cr-1'), true);
  for (const call of t.calls.slice(1)) assert.ok(call.steps.some(s => s[0] === 'eq' && s[1] === 'owner_id' && s[2] === 'user-a'));
});

test('server errors, missing rows, foreign ACKs and auth changes are not treated as success', async () => {
  const failure = new Error('Quota rejected');
  const t = transport([{ error: failure }, { data: [], error: null }, { data: [row({}, 'user-b')], error: null }]);
  const api = createServerLibrary(t.client, 'user-a');
  await assert.rejects(api.save(creature()), /Quota rejected/);
  await assert.rejects(api.remove('absent'), /не найдена/);
  await assert.rejects(api.list(), /недоступна/);
  t.user('user-b'); await assert.rejects(api.list(), /изменился/);
  const quota = transport([{ error: { code: '23514', message: 'creature_library_quota_used_check' } }]);
  await assert.rejects(createServerLibrary(quota.client, 'user-a').save(creature()), /500 существ/);
});

const png = () => new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });
test('image validation checks size, allowlist and header, including exact 5 MiB', async () => {
  assert.equal(await validateLibraryImage(png()), 'png');
  const jpeg = new Blob([Uint8Array.from([255,216,255])], { type: 'image/jpeg' });
  assert.equal(await validateLibraryImage(jpeg), 'jpg');
  const webp = new Blob([Uint8Array.from([82,73,70,70,0,0,0,0,87,69,66,80])], { type: 'image/webp' });
  assert.equal(await validateLibraryImage(webp), 'webp');
  await assert.rejects(validateLibraryImage(new Blob(['<svg/>'], { type: 'image/svg+xml' })), /PNG/);
  await assert.rejects(validateLibraryImage(new Blob(['<svg/>'], { type: 'image/png' })), /Содержимое/);
  assert.equal(await validateLibraryImage({ type: 'image/png', size: LIBRARY_IMAGE_MAX_BYTES, slice: () => png() }), 'png');
  await assert.rejects(validateLibraryImage({ type: 'image/png', size: LIBRARY_IMAGE_MAX_BYTES + 1 }), /5 МБ/);
});

test('private image paths are owner-scoped, signed URLs short-lived and never stored in templates', async () => {
  const t = transport(), api = createServerLibrary(t.client, 'user-a');
  const ref = await api.uploadImage(png());
  assert.match(ref, /^library:user-a\/[\w-]+\.png$/);
  assert.equal(await api.resolveImage(ref), 'https://private.example/signed');
  assert.equal(t.calls[1].seconds, 60); assert.equal(t.calls[0].options.upsert, false);
  for (const invalid of ['library:user-b/image.png', 'library:user-a/../image.png', 'https://private.example/signed']) {
    await assert.rejects(api.resolveImage(invalid), /не из вашей/);
  }
  assert.equal(await api.removeImage(ref), true);
});

test('image quota comes from the server, counts unused files and reports both limits', async () => {
  const t = transport([{ data: [{ files: 2, bytes: 100 }] }]);
  assert.deepEqual(await createServerLibrary(t.client, 'user-a').imageUsage(), { files: 2, bytes: 100, maxFiles: 200, maxBytes: 104857600 });
  assert.deepEqual(t.calls, [{ rpc: 'library_image_usage' }]);
  for (const [constraint, message] of [['files', /200 изображений/], ['bytes', /100 МиБ/]]) {
    const denied = transport([{ error: { message: `library_storage_usage_${constraint}_check` } }]);
    await assert.rejects(createServerLibrary(denied.client, 'user-a').uploadImage(png()), message);
  }
  const malformed = transport([{ data: [{ files: 201, bytes: 100 }] }]);
  await assert.rejects(createServerLibrary(malformed.client, 'user-a').imageUsage(), /квоту/);
});

test('explicit cleanup uses Storage API and reports concurrent reference protection and missing ACKs', async () => {
  const t = transport([
    { data: [{ path: 'user-a/unused.png', bytes: 8 }, { path: 'user-a/just-attached.png', bytes: 8 }, { path: 'user-a/no-ack.png', bytes: 8 }] },
    { data: [{ name: 'user-a/unused.png' }] },
    { error: new Error('Изображение используется в личной библиотеке') },
    { data: [] },
  ]);
  const result = await createServerLibrary(t.client, 'user-a').cleanupUnusedImages();
  assert.deepEqual(result.removed, ['library:user-a/unused.png']);
  assert.equal(result.failed.length, 2);
  assert.match(result.failed[0].message, /используется/);
  assert.match(result.failed[1].message, /не подтверждено/);
  assert.equal(t.calls[0].rpc, 'library_unused_images');
  assert.equal(t.calls.filter(c => c.remove).length, 3);
  const foreign = transport([{ data: [{ path: 'user-b/other.png', bytes: 8 }] }]);
  await assert.rejects(createServerLibrary(foreign.client, 'user-a').cleanupUnusedImages(), /не из вашей/);
  assert.equal(foreign.calls.length, 1);
  const s = sandbox();
  await assert.rejects(s.api.cleanupUnusedImages(), /недоступна в песочнице/);
});
