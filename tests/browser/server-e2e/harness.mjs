// Стенд «Supabase в памяти»: таблицы со схемой как в проекте tavern, упрощённые RLS/охранники,
// postgres_changes (удаления — без фильтра и только ключ, как в настоящем Realtime), broadcast, presence, RPC.
import { readFileSync } from 'node:fs';

const FAKE_JS = readFileSync(new URL('./fake-supabase.js', import.meta.url), 'utf8');
export const LIB_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';

// Колонки из information_schema проекта (30.10). ! — not null без значения по умолчанию.
const S = {
  profiles: { pk: ['id'], cols: { id: 'uuid!', name: 'text!', handle: 'text', avatar_url: 'text', hue: 'int', created_at: 'ts', updated_at: 'ts' } },
  campaigns: { pk: ['id'], cols: { id: 'text!', owner_id: 'uuid!', name: 'text!', data: 'json', created_at: 'ts', updated_at: 'ts' } },
  campaign_members: { pk: ['campaign_id', 'user_id'], cols: { campaign_id: 'text!', user_id: 'uuid!', role: 'text!', status: 'text!', character_id: 'text', scene_id: 'text', joined_at: 'ts' } },
  campaign_invites: { pk: ['campaign_id'], cols: { campaign_id: 'text!', code: 'text!', expires_at: 'ts', manual: 'bool', revoked: 'bool', created_at: 'ts' } },
  characters: { pk: ['id'], cols: { id: 'text!', campaign_id: 'text!', owner_id: 'uuid', data: 'json', updated_at: 'ts', sheet_version: 'text', sheet_managed: 'bool', archived_at: 'ts' } },
  scenes: { pk: ['id'], cols: { id: 'text!', campaign_id: 'text!', ord: 'int', data: 'json' } },
  scene_secrets: { pk: ['scene_id'], cols: { scene_id: 'text!', campaign_id: 'text!', data: 'json' } },
  scene_explored: { pk: ['scene_id'], cols: { scene_id: 'text!', campaign_id: 'text!', cells: 'text[]' } },
  tokens: { pk: ['id'], cols: { id: 'text!', campaign_id: 'text!', scene_id: 'text!', character_id: 'text', hidden: 'bool', ord: 'int', data: 'json' } },
  drawings: { pk: ['id'], cols: { id: 'text!', campaign_id: 'text!', scene_id: 'text!', author: 'uuid', ord: 'int', data: 'json' } },
  log_entries: { pk: ['id'], cols: { id: 'text!', campaign_id: 'text!', author: 'uuid', at: 'int!', vis: 'text', data: 'json' } },
  log_secrets: { pk: ['id'], cols: { id: 'text!', campaign_id: 'text!', author: 'uuid', vis: 'text!', data: 'json' } },
  save_requests: { pk: ['id'], cols: { id: 'text!', campaign_id: 'text!', data: 'json' } },
  portal_requests: { pk: ['id'], cols: { id: 'text!', campaign_id: 'text!', author: 'uuid', data: 'json' } },
  combats: { pk: ['campaign_id'], cols: { campaign_id: 'text!', data: 'json' } },
};
// Not null с значением по умолчанию: можно не передавать, но явный null — ошибка, как в Postgres.
const NN_DEFAULT = { campaign_invites: ['manual', 'revoked', 'created_at'], campaign_members: ['joined_at'], campaigns: ['data', 'created_at', 'updated_at'], characters: ['data', 'updated_at'], combats: ['data'], drawings: ['ord', 'data'], log_entries: ['vis', 'data'], log_secrets: ['data'], portal_requests: ['data'], profiles: ['hue', 'created_at', 'updated_at'], save_requests: ['data'], scene_explored: ['cells'], scene_secrets: ['data'], scenes: ['ord', 'data'], tokens: ['hidden', 'ord', 'data'] };
const DEFAULTS = { created_at: () => new Date().toISOString(), updated_at: () => new Date().toISOString(), joined_at: () => new Date().toISOString(), manual: () => true, revoked: () => false, hidden: () => false, ord: () => 0, data: () => ({}), vis: () => 'all', cells: () => [], hue: () => 32 };

const err = (message, code = 'PGRST') => ({ data: null, error: { message, code } });
const typeOk = (t, v) => {
  if (v === null || v === undefined) return true;
  const base = t.replace('!', '');
  if (base === 'int') return Number.isInteger(v);
  if (base === 'bool') return typeof v === 'boolean';
  if (base === 'text' || base === 'uuid') return typeof v === 'string';
  if (base === 'ts') return typeof v === 'string' && !Number.isNaN(Date.parse(v));
  if (base === 'text[]') return Array.isArray(v) && v.every((x) => typeof x === 'string');
  if (base === 'json') return typeof v === 'object';
  return true;
};

export function fakeServer({ names = {}, rpcOverride = null } = {}) {
  const T = Object.fromEntries(Object.keys(S).map((k) => [k, []]));
  const subs = new Map();  // chan → {page, uid, topic, pg, self}
  const pres = new Map();  // topic → Map(chan → {key, info})
  const files = new Map();
  const log = [];          // журнал вызовов (для отладки)
  const oauth = [];
  const queues = new WeakMap();

  const pkOf = (t, r) => S[t].pk.map((k) => r[k]).join('|');
  const find = (t, r) => T[t].find((x) => pkOf(t, x) === pkOf(t, r));
  const mem = (uid, cid) => T.campaign_members.find((m) => m.campaign_id === cid && m.user_id === uid);
  const isMember = (uid, cid) => mem(uid, cid)?.status === 'active';
  const isMaster = (uid, cid) => isMember(uid, cid) && mem(uid, cid).role === 'master';
  const isApplicant = (uid, cid) => !!mem(uid, cid);
  const myChar = (uid, cid) => (isMember(uid, cid) ? mem(uid, cid).character_id : null);

  function ensureProfile(uid) {
    if (!uid || T.profiles.some((p) => p.id === uid)) return;
    const name = names[uid] || 'Игрок';
    T.profiles.push({ id: uid, name, handle: name.toLowerCase(), avatar_url: null, hue: 120, created_at: DEFAULTS.created_at(), updated_at: DEFAULTS.updated_at() });
  }

  function canSee(uid, t, r) {
    if (!uid) return false;
    const cid = t === 'campaigns' ? r.id : r.campaign_id;
    switch (t) {
      case 'profiles': return true;
      case 'campaigns': return isApplicant(uid, cid);
      case 'campaign_members': return r.user_id === uid || isMember(uid, cid);
      case 'campaign_invites': return isMaster(uid, cid);
      case 'tokens': return isMember(uid, cid) && (!r.hidden || isMaster(uid, cid));
      case 'scene_secrets': return isMaster(uid, cid);
      case 'log_secrets': return isMaster(uid, cid) || (r.author === uid && r.vis !== 'blind');
      default: return isMember(uid, cid);
    }
  }

  // Права записи (упрощённо: политики + главное из охранников). Возвращает текст ошибки или null; 'skip' — RLS не нашёл строку.
  function writeCheck(uid, t, op, r, old) {
    const cid = t === 'campaigns' ? r.id : r.campaign_id;
    const M = isMaster(uid, cid), A = isMember(uid, cid);
    const rls = `new row violates row-level security policy for table "${t}"`;
    switch (t) {
      case 'campaigns': return op === 'insert' ? (r.owner_id === uid ? null : rls) : M ? null : 'skip';
      case 'campaign_members':
        if (op === 'insert') return 'permission denied for table campaign_members';
        if (op === 'delete') return (M && old.role !== 'master') || (old.user_id === uid && old.role !== 'master') ? null : 'skip';
        if (M) return null;
        if (old.user_id !== uid) return 'skip';
        if (r.role !== old.role || r.status !== old.status) return 'Роль и статус меняет мастер';
        if ((r.character_id || null) !== (old.character_id || null)) return 'Героя выбирают на экране выбора героя';
        return null;
      case 'campaign_invites': return M ? null : op === 'insert' ? rls : 'skip';
      case 'characters':
        if (op === 'insert') return A && (M || r.owner_id === uid) ? null : rls;
        if (op === 'delete') return M ? null : 'skip';
        if (!(M || old.owner_id === uid)) return 'skip';
        if (!M && r.owner_id !== old.owner_id) return 'Владельца героя меняет мастер';
        return null;
      case 'scenes': case 'scene_secrets':
        if (op !== 'update') return M ? null : op === 'insert' ? rls : 'skip';
        if (t === 'scene_secrets') return M ? null : 'skip';
        if (M) return null;
        if (!A) return 'skip';
        { // игрок: только двери
          const a = { ...old.data, walls: null }, b = { ...r.data, walls: null };
          if (JSON.stringify(a) !== JSON.stringify(b)) return 'Сцену меняет мастер';
          const wa = old.data.walls || [], wb = r.data.walls || [];
          if (wa.length !== wb.length) return 'Стены меняет мастер';
          for (let i = 0; i < wa.length; i++) { const x = { ...wa[i], open: 0 }, y = { ...wb[i], open: 0 }; if (JSON.stringify(x) !== JSON.stringify(y) && !(wa[i].locked && !wb[i].locked)) return 'Стены меняет мастер'; if (wb[i].open && wa[i].locked && wb[i].locked) return 'Дверь заперта'; }
        }
        return null;
      case 'tokens':
        if (op === 'insert') return M || (A && r.character_id && r.character_id === myChar(uid, cid)) ? null : rls;
        if (op === 'delete') return M ? null : 'skip';
        if (M) return null;
        if (!A || old.hidden) return 'skip';
        if (r.hidden !== old.hidden || r.character_id !== old.character_id) return 'Это меняет мастер';
        {
          const mine = old.character_id && old.character_id === myChar(uid, cid);
          const allowed = mine ? ['x', 'y', 'movedAt', 'rot', 'scale', 'light', 'aura', 'disengaged', 'darkvision', 'elevation'] : ['x', 'y', 'movedAt', 'rot'];
          const keys = new Set([...Object.keys(old.data || {}), ...Object.keys(r.data || {})]);
          for (const k of keys) if (!allowed.includes(k) && JSON.stringify(old.data?.[k]) !== JSON.stringify(r.data?.[k])) return `Поле ${k} чужого токена меняет мастер`;
          if (!mine) {
            const c = T.campaigns.find((x) => x.id === cid);
            if (c?.data?.settings?.openMovement === false) return 'Открытое перемещение выключено';
            if (old.data?.locked) return 'Токен закреплён';
          }
        }
        return null;
      case 'drawings':
        if (op === 'insert') return A ? null : rls;
        return M || old.author === uid ? null : 'skip';
      case 'log_entries': case 'log_secrets': case 'portal_requests':
        if (op === 'insert') return A && r.author === uid ? null : rls;
        return M ? null : 'skip';
      case 'save_requests': return op === 'update' ? (A ? null : 'skip') : M ? null : op === 'insert' ? rls : 'skip';
      case 'combats': return op === 'update' ? (A ? null : 'skip') : M ? null : op === 'insert' ? rls : 'skip';
      default: return rls;
    }
  }

  function validate(t, r, { partial = false } = {}) {
    for (const k of Object.keys(r)) {
      if (!S[t].cols[k]) return `Could not find the '${k}' column of '${t}' in the schema cache`;
      if (!typeOk(S[t].cols[k], r[k])) return `invalid input for ${t}.${k} (${S[t].cols[k]}): ${JSON.stringify(r[k]).slice(0, 60)}`;
    }
    for (const k of NN_DEFAULT[t] || []) if (k in r && r[k] === null) return `null value in column "${k}" of relation "${t}" violates not-null constraint`;
    if (!partial) for (const [k, ty] of Object.entries(S[t].cols)) if (ty.endsWith('!') && (r[k] === undefined || r[k] === null)) return `null value in column "${k}" of relation "${t}" violates not-null constraint`;
    if (t !== 'campaigns' && t !== 'profiles' && r.campaign_id && !T.campaigns.some((c) => c.id === r.campaign_id)) return `insert or update on table "${t}" violates foreign key constraint (campaign ${r.campaign_id})`;
    if (['tokens', 'drawings', 'scene_secrets', 'scene_explored'].includes(t) && r.scene_id && !T.scenes.some((s) => s.id === r.scene_id)) return `insert or update on table "${t}" violates foreign key constraint (scene ${r.scene_id})`;
    if (S[t].cols.id === 'text!' && 'id' in r && (String(r.id).length < 3 || String(r.id).length > 64)) return `new row for relation "${t}" violates check constraint "${t}_id_check"`;
    if (t === 'campaigns' && 'name' in r && (!r.name || r.name.length > 80)) return 'new row for relation "campaigns" violates check constraint "campaigns_name_check"';
    if (t === 'log_entries' && 'vis' in r && !['all', 'gm', 'blind', 'self'].includes(r.vis)) return 'log_entries_vis_check';
    if (t === 'log_secrets' && 'vis' in r && !['gm', 'blind', 'self'].includes(r.vis)) return 'log_secrets_vis_check';
    if (t === 'campaign_members' && (('role' in r && !['master', 'player'].includes(r.role)) || ('status' in r && !['active', 'pending'].includes(r.status)))) return 'campaign_members check';
    if (t === 'campaign_invites' && r.code && !/^RSP-[A-Z0-9]{4,8}$/.test(r.code)) return 'new row violates check constraint "campaign_invites_code_check"';
    return null;
  }

  const clone = (x) => JSON.parse(JSON.stringify(x));
  function emit(t, type, row, old) {
    for (const [chan, s] of subs) {
      const want = s.pg.some((f) => f.table === t && (!f.event || f.event === '*' || f.event === type));
      if (!want) continue;
      if (type === 'DELETE') {
        const key = Object.fromEntries(S[t].pk.map((k) => [k, old[k]]));
        send(s.page, chan, 'pg', { eventType: 'DELETE', table: t, schema: 'public', new: {}, old: key });
      } else if (canSee(s.uid, t, row)) {
        send(s.page, chan, 'pg', { eventType: type, table: t, schema: 'public', new: clone(row), old: {} });
      }
    }
  }
  function send(page, chan, kind, payload) {
    const prev = queues.get(page) || Promise.resolve();
    const next = prev.then(() => page.evaluate(([c, k, p]) => window.__sbEmit?.(c, k, p), [chan, kind, payload])).catch(() => {});
    queues.set(page, next);
  }

  function insertRow(uid, t, r0, { upsert = false, emitIt = true } = {}) {
    const r = { ...r0 };
    for (const [k, ty] of Object.entries(S[t].cols)) if (r[k] === undefined && DEFAULTS[k]) r[k] = DEFAULTS[k]();
    const bad = validate(t, r); if (bad) return bad;
    const old = find(t, r);
    if (old) {
      if (!upsert) return `duplicate key value violates unique constraint "${t}_pkey"`;
      const w = writeCheck(uid, t, 'update', r, old); if (w) return w === 'skip' ? `new row violates row-level security policy (USING expression) for table "${t}"` : w;
      Object.assign(old, r); if (emitIt) emit(t, 'UPDATE', old); return null;
    }
    if (t === 'campaign_invites' && T.campaign_invites.some((x) => x.code === r.code)) return 'duplicate key value violates unique constraint "campaign_invites_code_key"';
    const w = writeCheck(uid, t, 'insert', r); if (w) return w === 'skip' ? `new row violates row-level security policy for table "${t}"` : w;
    T[t].push(r);
    if (emitIt) emit(t, 'INSERT', r);
    if (t === 'campaigns') sysInsert('campaign_members', { campaign_id: r.id, user_id: r.owner_id, role: 'master', status: 'active', character_id: null, scene_id: null });
    return null;
  }
  // Системная вставка (триггеры, RPC) — без проверок прав.
  function sysInsert(t, r) { const x = { ...r }; for (const k of Object.keys(S[t].cols)) if (x[k] === undefined && DEFAULTS[k]) x[k] = DEFAULTS[k](); T[t].push(x); emit(t, 'INSERT', x); return x; }

  const match = (r, filters) => filters.every(([op, c, v]) => (op === 'eq' ? String(r[c]) === String(v) : op === 'in' ? v.map(String).includes(String(r[c])) : true));

  function query(uid, q) {
    ensureProfile(uid);
    const t = q.table;
    if (!S[t]) return err(`relation "public.${t}" does not exist`);
    if (!uid) return err('permission denied', '42501');
    if (q.action === 'select') {
      let rows = T[t].filter((r) => canSee(uid, t, r) && match(r, q.filters)).map(clone);
      if (q.order) rows.sort((a, b) => (a[q.order[0]] > b[q.order[0]] ? 1 : -1) * (q.order[1] ? 1 : -1));
      if (q.limit) rows = rows.slice(0, q.limit);
      if (q.single === 'maybe') return rows.length > 1 ? err('JSON object requested, multiple rows returned') : { data: rows[0] || null, error: null };
      if (q.single === 'one') return rows.length !== 1 ? err('JSON object requested, multiple (or no) rows returned') : { data: rows[0], error: null };
      return { data: rows, error: null };
    }
    if (q.action === 'insert' || q.action === 'upsert') {
      for (const r of [].concat(q.payload)) { const e = insertRow(uid, t, r, { upsert: q.action === 'upsert' }); if (e) return err(e, e.startsWith('new row') ? '42501' : '23000'); }
      return { data: q.wantSelect ? [].concat(q.payload) : null, error: null };
    }
    if (q.action === 'update') {
      const bad = validate(t, q.payload, { partial: true }); if (bad) return err(bad);
      const hit = T[t].filter((r) => canSee(uid, t, r) && match(r, q.filters));
      const done = [];
      for (const old of hit) {
        const next = { ...old, ...q.payload };
        const w = writeCheck(uid, t, 'update', next, old);
        if (w === 'skip') continue;
        if (w) return err(w, '42501');
        Object.assign(old, q.payload);
        if (t === 'characters' || t === 'campaigns') old.updated_at = new Date().toISOString();
        done.push(clone(old)); emit(t, 'UPDATE', old);
      }
      return { data: q.wantSelect ? done : null, error: null };
    }
    if (q.action === 'delete') {
      const hit = T[t].filter((r) => canSee(uid, t, r) && match(r, q.filters));
      for (const old of hit) {
        const w = writeCheck(uid, t, 'delete', old, old); if (w === 'skip') continue; if (w) return err(w, '42501');
        T[t].splice(T[t].indexOf(old), 1); emit(t, 'DELETE', null, old);
        if (t === 'campaigns') for (const k of Object.keys(T)) if (k !== 'campaigns' && k !== 'profiles') for (const x of T[k].filter((y) => y.campaign_id === old.id)) { T[k].splice(T[k].indexOf(x), 1); emit(k, 'DELETE', null, x); }
        if (t === 'scenes') for (const k of ['tokens', 'drawings', 'scene_secrets', 'scene_explored']) for (const x of T[k].filter((y) => y.scene_id === old.id)) { T[k].splice(T[k].indexOf(x), 1); emit(k, 'DELETE', null, x); }
      }
      return { data: null, error: null };
    }
    return err('unknown action');
  }

  function rpc(uid, name, a) {
    ensureProfile(uid);
    if (rpcOverride) { const custom = rpcOverride({ uid, name, args: a, tables: T, emit }); if (custom !== undefined) return custom; }
    const ok = (data) => ({ data, error: null });
    if (name === 'invite_preview') {
      const inv = T.campaign_invites.find((i) => i.code === String(a.p_code).trim().toUpperCase());
      if (!inv || inv.revoked || (inv.expires_at && Date.parse(inv.expires_at) < Date.now())) return ok({ ok: false });
      const c = T.campaigns.find((x) => x.id === inv.campaign_id);
      const m = T.campaign_members.find((x) => x.campaign_id === c.id && x.role === 'master');
      const taken = T.campaign_members.filter((x) => x.campaign_id === c.id && x.role === 'player' && x.status === 'active').length;
      const heroes = T.characters.filter((x) => x.campaign_id === c.id).slice(0, 4).map((h) => ({ name: h.data.name, portrait: h.data.portrait }));
      return ok({ ok: true, campaignId: c.id, name: c.name, description: c.data.description, cover: c.data.cover, seats: c.data.seats ?? 5, taken, master: T.profiles.find((p) => p.id === m?.user_id)?.name, heroes, manual: inv.manual, myStatus: uid ? mem(uid, c.id)?.status || null : null });
    }
    if (!uid) return err('Нужно войти', '42501');
    if (name === 'join_campaign') {
      const inv = T.campaign_invites.find((i) => i.code === String(a.p_code).trim().toUpperCase());
      if (!inv || inv.revoked) return ok({ ok: false, error: 'invalid' });
      const ex = mem(uid, inv.campaign_id); if (ex) return ok({ ok: true, campaignId: inv.campaign_id, status: ex.status });
      const st = inv.manual ? 'pending' : 'active';
      sysInsert('campaign_members', { campaign_id: inv.campaign_id, user_id: uid, role: 'player', status: st, character_id: null, scene_id: null });
      return ok({ ok: true, campaignId: inv.campaign_id, status: st });
    }
    if (name === 'claim_character') {
      const m = mem(uid, a.p_campaign);
      if (!m || m.status !== 'active' || m.role !== 'player') return err('Выбирает героя игрок кампании', '42501');
      if (m.character_id && m.character_id !== a.p_character) return err('У вас уже есть герой в этой кампании', '42501');
      const ch = T.characters.find((x) => x.id === a.p_character && x.campaign_id === a.p_campaign); if (!ch) return err('Нет такого героя', 'P0002');
      if (T.campaign_members.some((x) => x.campaign_id === a.p_campaign && x.character_id === a.p_character && x.status === 'active' && x.user_id !== uid)) return ok({ ok: false, error: 'taken' });
      m.character_id = a.p_character; emit('campaign_members', 'UPDATE', m);
      ch.owner_id = uid; ch.data = { ...ch.data, ownerId: uid }; emit('characters', 'UPDATE', ch);
      return ok({ ok: true });
    }
    if (name === 'add_explored') {
      const s = T.scenes.find((x) => x.id === a.p_scene);
      if (!s || !isMember(uid, s.campaign_id)) return err('Сцена недоступна', '42501');
      const e = T.scene_explored.find((x) => x.scene_id === s.id);
      if (e) { e.cells = [...new Set([...e.cells, ...a.p_cells])]; emit('scene_explored', 'UPDATE', e); }
      else sysInsert('scene_explored', { scene_id: s.id, campaign_id: s.campaign_id, cells: [...new Set(a.p_cells)] });
      return ok(null);
    }
    return err(`function ${name} does not exist`);
  }

  function presenceSync(topic) {
    const m = pres.get(topic) || new Map();
    const state = {};
    for (const { key, info } of m.values()) (state[key] ||= []).push({ ...info, presence_ref: key });
    for (const [chan, s] of subs) if (s.topic === topic) send(s.page, chan, 'presence', state);
  }

  const net = { down: false };
  async function handle(page, msg) {
    log.push(msg.op === 'query' ? `${msg.q.action} ${msg.q.table}` : msg.op);
    // Обрыв сети: supabase-js не бросает, а возвращает ошибку без кода.
    if (net.down && ['query', 'rpc'].includes(msg.op)) return { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' } };
    switch (msg.op) {
      case 'client': return null;
      case 'query': return query(msg.uid, msg.q);
      case 'rpc': return rpc(msg.uid, msg.name, msg.args || {});
      case 'oauth': oauth.push(msg.o); return null;
      case 'join': {
        if (msg.priv) {
          const [kind, id] = [msg.topic.split(':')[0], msg.topic.split(':').slice(1).join(':')];
          const okJoin = kind === 'campaign' ? isMember(msg.uid, id) : kind === 'user' ? id === msg.uid : false;
          if (!okJoin) return { error: 'Unauthorized' };
        }
        subs.set(msg.chan, { page, uid: msg.uid, topic: msg.topic, pg: msg.pg || [], self: msg.self });
        presenceSync(msg.topic);
        return { ok: true };
      }
      case 'leave': { const s = subs.get(msg.chan); subs.delete(msg.chan); if (s) { pres.get(s.topic)?.delete(msg.chan); presenceSync(s.topic); } return null; }
      case 'broadcast': for (const [chan, s] of subs) if (s.topic === msg.topic && (chan !== msg.chan || subs.get(msg.chan)?.self)) send(s.page, chan, 'broadcast', { event: msg.event, payload: msg.payload }); return null;
      case 'track': { if (!pres.has(msg.topic)) pres.set(msg.topic, new Map()); pres.get(msg.topic).set(msg.chan, { key: msg.key, info: msg.info }); presenceSync(msg.topic); return null; }
      case 'untrack': pres.get(msg.topic)?.delete(msg.chan); presenceSync(msg.topic); return null;
      case 'upload': {
        const cid = msg.path.split('/')[0];
        if (!isMaster(msg.uid, cid)) return { data: null, error: { message: 'new row violates row-level security policy' } };
        files.set(msg.path, msg.size); return { data: { path: msg.path }, error: null };
      }
      case 'sign': {
        const cid = msg.path.split('/')[0];
        if (!isApplicant(msg.uid, cid) || !files.has(msg.path)) return { data: null, error: { message: 'Object not found' } };
        return { data: { signedUrl: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#3a5"/></svg>') }, error: null };
      }
      default: return { error: { message: `unknown op ${msg.op}` } };
    }
  }

  async function attach(context) {
    await context.route(LIB_URL, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_JS, headers: { 'access-control-allow-origin': '*' } }));
    await context.route(/supabase\.co/, (r) => r.abort());
    await context.exposeBinding('__sb', async ({ page }, msg) => {
      try { return await handle(page, msg); } catch (e) { return { data: null, error: { message: `harness: ${e.message}` } }; }
    });
  }

  return { T, attach, log, oauth, files, subs, pres, sysInsert, ensureProfile, net };
}
