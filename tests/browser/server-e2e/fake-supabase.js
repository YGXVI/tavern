// Поддельный supabase-js для проверок серверного режима в Playwright.
// Повторяет только ту часть API, которой пользуется dist/js/server/*. Данные живут в Node (стенд harness.mjs),
// браузер говорит с ним через window.__sb (exposeBinding), события получает через window.__sbEmit.
const call = (msg) => window.__sb(msg);
const chans = new Map();
let authCbs = [];

function session() {
  try { const u = localStorage.getItem('fake-sb-user'); return u ? { user: { id: u }, access_token: `tok-${u}` } : null; } catch { return null; }
}
const uid = () => session()?.user.id || null;

window.__sbEmit = (chanId, kind, payload) => { chans.get(chanId)?._emit(kind, payload); };

class Query {
  constructor(table) { this.q = { table, action: 'select', filters: [], cols: '*', order: null, limit: null, single: null, payload: null, wantSelect: false }; }
  select(cols = '*') { if (this.q.action === 'select') this.q.cols = cols; else this.q.wantSelect = true; return this; }
  insert(p) { this.q.action = 'insert'; this.q.payload = p; return this; }
  update(p) { this.q.action = 'update'; this.q.payload = p; return this; }
  upsert(p) { this.q.action = 'upsert'; this.q.payload = p; return this; }
  delete() { this.q.action = 'delete'; return this; }
  eq(c, v) { this.q.filters.push(['eq', c, v]); return this; }
  in(c, v) { this.q.filters.push(['in', c, v]); return this; }
  match(o) { for (const [c, v] of Object.entries(o)) this.q.filters.push(['eq', c, v]); return this; }
  order(c, o = {}) { this.q.order = [c, o.ascending !== false]; return this; }
  limit(n) { this.q.limit = n; return this; }
  maybeSingle() { this.q.single = 'maybe'; return this; }
  single() { this.q.single = 'one'; return this; }
  then(res, rej) { return call({ op: 'query', uid: uid(), q: JSON.parse(JSON.stringify(this.q)) }).then(res, rej); }
}

let seq = 0;
class Channel {
  constructor(topic, opts = {}) { this.topic = topic; this.cfg = opts.config || {}; this.id = `ch${++seq}-${Math.random().toString(36).slice(2, 7)}`; this.handlers = []; this.pstate = {}; }
  on(type, filter, cb) { this.handlers.push({ type, filter, cb }); return this; }
  subscribe(cb) {
    chans.set(this.id, this);
    const pg = this.handlers.filter((h) => h.type === 'postgres_changes').map((h) => h.filter);
    call({ op: 'join', uid: uid(), chan: this.id, topic: this.topic, pg, priv: !!this.cfg.private, self: !!this.cfg.broadcast?.self })
      .then((r) => cb?.(r?.error ? 'CHANNEL_ERROR' : 'SUBSCRIBED'));
    return this;
  }
  send(msg) { return call({ op: 'broadcast', uid: uid(), chan: this.id, topic: this.topic, event: msg.event, payload: msg.payload }).then(() => 'ok'); }
  track(info) { return call({ op: 'track', chan: this.id, topic: this.topic, key: this.cfg.presence?.key || this.id, info }); }
  untrack() { return call({ op: 'untrack', chan: this.id, topic: this.topic }); }
  presenceState() { return this.pstate; }
  _emit(kind, p) {
    if (kind === 'pg') {
      for (const h of this.handlers) {
        if (h.type !== 'postgres_changes' || h.filter.table !== p.table) continue;
        if (h.filter.event && h.filter.event !== '*' && h.filter.event !== p.eventType) continue;
        if (h.filter.filter && p.eventType !== 'DELETE') {
          const [col, rest] = h.filter.filter.split('='); const val = rest.replace(/^eq\./, '');
          if (String(p.new?.[col]) !== val) continue;
        }
        h.cb(p);
      }
    } else if (kind === 'broadcast') {
      for (const h of this.handlers) if (h.type === 'broadcast' && h.filter.event === p.event) h.cb({ type: 'broadcast', event: p.event, payload: p.payload });
    } else if (kind === 'presence') {
      this.pstate = p;
      for (const h of this.handlers) if (h.type === 'presence' && h.filter.event === 'sync') h.cb();
    }
  }
}

export function createClient(url, key, opts) {
  call({ op: 'client', url, key, opts: { flowType: opts?.auth?.flowType, storageKey: opts?.auth?.storageKey } });
  return {
    from: (t) => new Query(t),
    rpc: (name, args) => call({ op: 'rpc', uid: uid(), name, args }),
    channel: (topic, o) => new Channel(topic, o),
    removeChannel: (ch) => { chans.delete(ch.id); return call({ op: 'leave', chan: ch.id }); },
    realtime: { setAuth: async () => {} },
    auth: {
      getSession: async () => ({ data: { session: session() }, error: null }),
      signInWithOAuth: async (o) => { await call({ op: 'oauth', o }); return { data: {}, error: null }; },
      onAuthStateChange: (cb) => { authCbs.push(cb); return { data: { subscription: { unsubscribe() { authCbs = authCbs.filter((x) => x !== cb); } } } }; },
      signOut: async () => { localStorage.removeItem('fake-sb-user'); for (const cb of authCbs) cb('SIGNED_OUT', null); return { error: null }; },
    },
    storage: {
      from: (bucket) => ({
        upload: (path, blob, o) => call({ op: 'upload', uid: uid(), bucket, path, size: blob.size, type: o?.contentType }),
        createSignedUrl: (path) => call({ op: 'sign', uid: uid(), bucket, path }),
      }),
    },
  };
}
