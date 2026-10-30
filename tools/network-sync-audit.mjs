// TASK-035 diagnostic, no live service. Run: node --experimental-vm-modules tools/network-sync-audit.mjs
// Loads unmodified sync.js/model.js in separate VM contexts. Transport is deliberately small:
// it models row replacement, membership/visibility filtering and controlled failures, NOT SQL/RLS.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const copy = (x) => structuredClone(x);
const tick = async () => { for (let i = 0; i < 12; i++) await new Promise(setImmediate); };
const tables = ['campaigns', 'profiles', 'campaign_members', 'campaign_invites', 'characters', 'scenes', 'scene_secrets', 'scene_explored', 'tokens', 'drawings', 'log_entries', 'log_secrets', 'save_requests', 'portal_requests', 'combats'];
const key = (t, r) => t === 'campaign_members' ? `${r.campaign_id}:${r.user_id}` : ['campaign_invites', 'combats'].includes(t) ? r.campaign_id : ['scene_secrets', 'scene_explored'].includes(t) ? r.scene_id : r.id;
function server() {
  const T = Object.fromEntries(tables.map((t) => [t, []]));
  T.campaigns.push({ id: 'camp', owner_id: 'gm', name: 'Synthetic', data: { createdAt: 1, activeSceneId: 'scene' } });
  T.profiles.push(...['gm', 'player'].map((id) => ({ id, name: id })));
  T.campaign_members.push(...['gm', 'player'].map((id) => ({ campaign_id: 'camp', user_id: id, role: id === 'gm' ? 'master' : 'player', status: 'active', character_id: null, scene_id: null, joined_at: '2026-01-01T00:00:00Z' })));
  T.scenes.push({ id: 'scene', campaign_id: 'camp', ord: 0, data: { name: 'Room' } });
  T.tokens.push(...['tok1', 'tok2'].map((id) => ({ id, campaign_id: 'camp', scene_id: 'scene', character_id: null, owner_id: 'player', hidden: false, ord: id === 'tok1' ? 1 : 2, data: { name: id, x: 0, y: 0, hp: 10, hpMax: 10 } })));
  T.characters.push({ id: 'hero', campaign_id: 'camp', owner_id: 'player', data: { name: 'Hero', hp: 10, notes: '' } });
  T.combats.push({ campaign_id: 'camp', data: { active: false, round: 0, turn: 0, entries: [], moved: {} } });
  const S = { T, clients: [], events: [], requests: [], hook: null };
  S.member = (uid) => T.campaign_members.some((r) => r.user_id === uid && r.status === 'active');
  S.visible = (uid, t, r) => t === 'profiles' || (t === 'campaign_members' && r.user_id === uid) || (S.member(uid) && (!(t === 'tokens' && r.hidden) || uid === 'gm') && (!['scene_secrets', 'log_secrets', 'campaign_invites'].includes(t) || uid === 'gm'));
  S.emit = (table, eventType, row) => S.events.push({ table, eventType, new: eventType === 'DELETE' ? {} : copy(row), old: eventType === 'DELETE' ? (table === 'campaign_members' ? { campaign_id: row.campaign_id, user_id: row.user_id } : { id: row.id }) : {} });
  S.flush = () => {
    for (const p of S.events.splice(0)) for (const c of S.clients) if (!c.offline) for (const ch of c.channels) if (!ch.removed) {
      for (const h of ch.handlers) {
        const [col, value] = (h.f.filter || '').split('=eq.');
        if (h.type === 'postgres_changes' && h.f.table === p.table && (p.eventType === 'DELETE' || ((!col || p.new[col] === value) && S.visible(c.uid, p.table, p.new)))) h.cb(copy(p));
      }
    }
  };
  S.query = async (c, q) => {
    S.requests.push({ uid: c.uid, ...copy(q) });
    const match = (r) => q.filters.every(([k, v]) => Array.isArray(v) ? v.includes(r[k]) : r[k] === v);
    const rows = T[q.table].filter((r) => match(r) && S.visible(c.uid, q.table, r));
    const apply = () => {
      if (q.action === 'select') { const result = copy(rows); return { data: q.single ? result[0] || null : result, error: null }; }
      if (!S.member(c.uid)) return { data: [], error: q.action === 'insert' ? { code: '42501', message: 'not member' } : null };
      if (q.action === 'insert') {
        if (T[q.table].some((r) => key(q.table, r) === key(q.table, q.row))) return { data: null, error: { code: '23505', message: 'duplicate' } };
        T[q.table].push(copy(q.row)); S.emit(q.table, 'INSERT', q.row); return { data: null, error: null };
      }
      for (const r of rows) { if (q.action === 'delete') T[q.table].splice(T[q.table].indexOf(r), 1); else Object.assign(r, copy(q.row)); S.emit(q.table, q.action === 'delete' ? 'DELETE' : 'UPDATE', r); }
      return { data: copy(rows), error: null };
    };
    if (S.hook) { const handled = await S.hook(c, q, apply); if (handled !== undefined) return handled; }
    return apply();
  };
  return S;
}
async function client(S, uid) {
  const c = { uid, channels: [], retry: [], notices: [], db: { users: {}, campaigns: {} }, offline: false };
  S.clients.push(c);
  class Query {
    constructor(table) { this.q = { table, action: 'select', filters: [] }; }
    select() { return this; } eq(k, v) { this.q.filters.push([k, v]); return this; }
    in(k, v) { return this.eq(k, v); } match(o) { for (const [k, v] of Object.entries(o)) this.eq(k, v); return this; }
    order() { return this; } limit() { return this; } maybeSingle() { this.q.single = true; return this; }
    update(row) { this.q.action = 'update'; this.q.row = row; return this; }
    upsert(row) { this.q.action = 'upsert'; this.q.row = row; return this; }
    insert(row) { this.q.action = 'insert'; this.q.row = row; return this; }
    delete() { this.q.action = 'delete'; return this; }
    then(a, b) { return S.query(c, copy(this.q)).then(a, b); }
  }
  const sb = {
    from: (t) => new Query(t),
    rpc: async (name, args) => { S.requests.push({ uid, rpc: name, args }); return { data: null, error: null }; },
    auth: { getSession: async () => ({ data: { session: { user: { id: uid }, access_token: 'synthetic' } } }), onAuthStateChange() {} },
    realtime: { async setAuth() {} },
    channel: (topic) => { const ch = { topic, handlers: [], on(type, f, cb) { this.handlers.push({ type, f, cb }); return this; }, subscribe(cb) { this.status = cb; cb?.('SUBSCRIBED'); return this; }, send(msg) { c.notices.push(['send', msg]); return Promise.resolve('ok'); }, track() {}, untrack() {}, presenceState() { return {}; } }; c.channels.push(ch); return ch; },
    removeChannel: (ch) => { ch.removed = true; },
  };
  const context = vm.createContext({ structuredClone, URLSearchParams, location: { search: '', hash: '', pathname: '/' }, history: {}, console: { warn: (...a) => c.notices.push(['warn', ...a.map(String)]) }, setTimeout: (fn, ms) => ms >= 700 ? c.retry.push(fn) : setImmediate(fn) });
  const model = new vm.SourceTextModule(await readFile(new URL('dist/js/server/model.js', root), 'utf8'), { context });
  const stub = new vm.SyntheticModule(['supabase', 'advanceTurn', 'turnTokenId', 'initiativeOrder'], function () {
    this.setExport('supabase', async () => sb);
    this.setExport('advanceTurn', () => { throw Error('combat automation excluded'); });
    this.setExport('turnTokenId', () => null); this.setExport('initiativeOrder', () => []);
  }, { context });
  const sync = new vm.SourceTextModule(await readFile(new URL('dist/js/server/sync.js', root), 'utf8'), { context });
  await sync.link((specifier) => specifier === './model.js' ? model : stub);
  await sync.evaluate(); c.api = sync.namespace;
  await c.api.startServer({ getDB: () => c.db, setDB: (db) => { c.db = db; }, deliver: (...a) => c.notices.push(['deliver', ...a]), emitLocal: (...a) => c.notices.push(['local', ...a]), commit: () => { throw Error('combat automation excluded'); } });
  c.commit = (fn) => { const before = copy(c.db); fn(c.db.campaigns.camp); c.api.afterCommit(before, c.db); };
  c.resume = async () => { for (const fn of c.retry.splice(0)) fn(); await tick(); };
  return c;
}
const results = [];
async function check(name, fn) { await fn(); results.push({ name, result: 'reproduced / assertion passed' }); }
await check('B1: two clients, different fields of same token: late full row loses x', async () => {
  const S = server(), A = await client(S, 'gm'), B = await client(S, 'player');
  A.commit((c) => { c.scenes[0].tokens[0].x = 20; }); B.commit((c) => { c.scenes[0].tokens[0].hp = 7; });
  await Promise.all([A.api.whenSynced('camp'), B.api.whenSynced('camp')]);
  assert.equal(S.T.tokens[0].data.x, 0); assert.equal(S.T.tokens[0].data.hp, 7); assert.equal(S.requests.filter((q) => q.rpc).length, 0);
});
await check('B1: two stale sheet writes: later notes erases HP', async () => {
  const S = server(), A = await client(S, 'gm'), B = await client(S, 'player');
  A.commit((c) => { c.characters[0].hp = 7; }); B.commit((c) => { c.characters[0].notes = 'new'; });
  await Promise.all([A.api.whenSynced('camp'), B.api.whenSynced('camp')]); assert.equal(S.T.characters[0].data.hp, 10); assert.equal(S.T.characters[0].data.notes, 'new');
});
await check('positive: different token rows survive concurrent edits and realtime delivery', async () => {
  const S = server(), A = await client(S, 'gm'), B = await client(S, 'player');
  A.commit((c) => { c.scenes[0].tokens[0].x = 20; }); B.commit((c) => { c.scenes[0].tokens[1].x = 30; });
  await Promise.all([A.api.whenSynced('camp'), B.api.whenSynced('camp')]); S.flush(); await tick();
  for (const c of [A, B]) assert.deepEqual(copy(c.db.campaigns.camp.scenes[0].tokens.map((t) => t.x)), [20, 30]);
});
await check('B5: group move, second write denied: first persists; reload shows partial group', async () => {
  const S = server(), A = await client(S, 'gm');
  S.hook = (_c, q) => q.action === 'update' && q.table === 'tokens' && q.row.id === 'tok2' ? { data: null, error: { code: '42501', message: 'synthetic denial' } } : undefined;
  A.commit((c) => { for (const t of c.scenes[0].tokens) t.x = 20; }); await A.api.whenSynced('camp');
  assert.deepEqual(S.T.tokens.map((t) => t.data.x), [20, 0]); assert.deepEqual(copy(A.db.campaigns.camp.scenes[0].tokens.map((t) => t.x)), [20, 0]);
});
await check('retry: acknowledged-by-server update, response lost, peer edits HP, retry erases HP', async () => {
  const S = server(), A = await client(S, 'gm'), B = await client(S, 'player'); let once = true;
  S.hook = (c, q, apply) => { if (c === A && q.action === 'update' && q.table === 'tokens' && once) { once = false; apply(); return { error: { message: 'Failed to fetch' } }; } };
  A.commit((c) => { c.scenes[0].tokens[0].x = 20; }); await tick(); assert.equal(A.retry.length, 1);
  S.flush(); await tick(); B.commit((c) => { c.scenes[0].tokens[0].hp = 7; }); await B.api.whenSynced('camp');
  await A.resume(); await A.api.whenSynced('camp'); assert.equal(S.T.tokens[0].data.hp, 10);
});
await check('insert retry: response lost after insert, duplicate 23505 accepted, single log entry', async () => {
  const S = server(), A = await client(S, 'gm'); let once = true;
  S.hook = (_c, q, apply) => { if (q.action === 'insert' && q.table === 'log_entries' && once) { once = false; apply(); return { error: { message: 'network error' } }; } };
  A.commit((c) => { c.log.unshift({ id: 'roll1', at: 1, userId: 'gm', vis: 'all', total: 12 }); }); await tick(); await A.resume(); await A.api.whenSynced('camp'); assert.equal(S.T.log_entries.length, 1);
});
await check('offline edit, peer HP update, reconnect: waiting full-row edit overwrites peer', async () => {
  const S = server(), A = await client(S, 'gm'), B = await client(S, 'player');
  B.offline = true; S.hook = (c, q) => c.offline && q.action !== 'select' ? { error: { message: 'network error' } } : undefined;
  B.commit((c) => { c.scenes[0].tokens[0].x = 30; }); await tick(); A.commit((c) => { c.scenes[0].tokens[0].hp = 7; }); await A.api.whenSynced('camp');
  B.offline = false; await B.resume(); await B.api.whenSynced('camp'); assert.equal(S.T.tokens[0].data.hp, 10);
});
await check('reconnect after missed events reloads state', async () => {
  const S = server(), A = await client(S, 'gm'), B = await client(S, 'player'); const ch = B.channels.find((c) => c.topic === 'campaign:camp');
  ch.status('CHANNEL_ERROR'); S.T.tokens[0].data.hp = 4; ch.status('SUBSCRIBED'); await tick(); assert.equal(B.db.campaigns.camp.scenes[0].tokens[0].hp, 4);
});
await check('removed member: delete event clears campaign; waiting update denied by transport membership check', async () => {
  const S = server(), B = await client(S, 'player'); B.offline = true;
  S.hook = (c, q) => c.offline && q.action !== 'select' ? { error: { message: 'network error' } } : undefined;
  B.commit((c) => { c.scenes[0].tokens[0].x = 30; }); await tick(); const m = S.T.campaign_members.splice(1, 1)[0]; B.offline = false; S.emit('campaign_members', 'DELETE', m); S.flush(); await tick();
  assert.equal(B.db.campaigns.camp, undefined); await B.resume(); await B.api.whenSynced('camp'); assert.equal(S.T.tokens[0].data.x, 0); assert.equal(B.db.campaigns.camp, undefined);
});
await check('B2: initial SELECT-to-subscribe gap loses an event until reload', async () => {
  const S = server(); let once = true;
  S.hook = (_c, q, apply) => { if (q.action === 'select' && q.table === 'tokens' && once) { once = false; const old = apply(); S.T.tokens[0].data.hp = 4; S.emit('tokens', 'UPDATE', S.T.tokens[0]); S.flush(); return old; } };
  const B = await client(S, 'player'); assert.equal(B.db.campaigns.camp.scenes[0].tokens[0].hp, 10); await B.api.loadCampaign('camp'); assert.equal(B.db.campaigns.camp.scenes[0].tokens[0].hp, 4);
});
await check('B3: missed hidden-ids leaves previously visible token cached until reload', async () => {
  const S = server(), B = await client(S, 'player'); S.T.tokens[0].hidden = true; S.emit('tokens', 'UPDATE', S.T.tokens[0]); S.flush(); await tick();
  assert.equal(B.db.campaigns.camp.scenes[0].tokens.length, 2); await B.api.loadCampaign('camp'); assert.equal(B.db.campaigns.camp.scenes[0].tokens.length, 1);
});
await check('B2/revocation: in-flight snapshot resurrects removed campaign locally', async () => {
  const S = server(), B = await client(S, 'player'); let release; let once = true;
  S.hook = (_c, q, apply) => { if (q.action === 'select' && q.table === 'combats' && once) { once = false; const old = apply(); return new Promise((r) => { release = () => r(old); }); } };
  const loading = B.api.loadCampaign('camp'); await tick(); const m = S.T.campaign_members.splice(1, 1)[0]; S.emit('campaign_members', 'DELETE', m); S.flush(); await tick(); assert.equal(B.db.campaigns.camp, undefined);
  release(); await loading; assert.ok(B.db.campaigns.camp); // Stale local snapshot only: no fresh server access demonstrated.
});
await check('after nine failed sends: queue resolves after reload, unsent edit rolled back', async () => {
  const S = server(), B = await client(S, 'player');
  S.hook = (_c, q) => q.action !== 'select' ? { error: { message: 'network error' } } : undefined;
  B.commit((c) => { c.scenes[0].tokens[0].x = 30; }); await tick();
  for (let i = 0; i < 8; i++) await B.resume();
  await B.api.whenSynced('camp');
  assert.equal(S.requests.filter((q) => q.table === 'tokens' && q.action === 'update').length, 9);
  assert.equal(B.db.campaigns.camp.scenes[0].tokens[0].x, 0);
});
await check('nullable owner from server: unrelated log insert emits zero token updates', async () => {
  const S = server(); for (const t of S.T.tokens) t.owner_id = null;
  const A = await client(S, 'gm'); A.commit((c) => { c.log.unshift({ id: 'roll1', at: 1, userId: 'gm', vis: 'all', total: 12 }); });
  await A.api.whenSynced('camp'); assert.equal(S.requests.filter((q) => q.table === 'tokens' && q.action === 'update').length, 0);
});
console.log(JSON.stringify({ transport: 'synthetic; no production, SQL/RLS or UI assertions', count: results.length, results }, null, 2));
