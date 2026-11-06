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
  tokens: { pk: ['id'], cols: { id: 'text!', campaign_id: 'text!', scene_id: 'text!', character_id: 'text', hidden: 'bool', ord: 'int', data: 'json', owner_id: 'uuid' } },
  drawings: { pk: ['id'], cols: { id: 'text!', campaign_id: 'text!', scene_id: 'text!', author: 'uuid', ord: 'int', data: 'json' } },
  log_entries: { pk: ['id'], cols: { id: 'text!', campaign_id: 'text!', author: 'uuid', at: 'int!', vis: 'text', data: 'json' } },
  log_secrets: { pk: ['id'], cols: { id: 'text!', campaign_id: 'text!', author: 'uuid', vis: 'text!', data: 'json' } },
  save_requests: { pk: ['id'], cols: { id: 'text!', campaign_id: 'text!', data: 'json' } },
  portal_requests: { pk: ['id'], cols: { id: 'text!', campaign_id: 'text!', author: 'uuid', data: 'json' } },
  combats: { pk: ['campaign_id'], cols: { campaign_id: 'text!', data: 'json' } },
  heroes: { pk: ['id'], cols: { id: 'text!', owner_id: 'uuid!', data: 'json!', archived_at: 'ts', updated_at: 'ts' } },
  creatures: { pk: ['owner_id', 'id'], cols: { id: 'text!', owner_id: 'uuid!', data: 'json!', updated_at: 'ts' } },
  campaign_creatures: { pk: ['campaign_id', 'id'], cols: { campaign_id: 'text!', id: 'text!', owner_id: 'uuid', source_id: 'text', data: 'json!', updated_at: 'ts' } },
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
  const fileUrls = new Map();
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
      case 'creatures': return r.owner_id === uid;
      case 'heroes': return r.owner_id === uid;
      case 'campaign_creatures': return isMaster(uid, cid) || (isMember(uid, cid) && r.owner_id === uid);
      case 'campaigns': return isApplicant(uid, cid);
      case 'campaign_members': return r.user_id === uid || isMember(uid, cid);
      case 'campaign_invites': return isMaster(uid, cid);
      case 'tokens': return isMember(uid, cid) && (!r.hidden || isMaster(uid, cid));
      case 'scene_secrets': return isMaster(uid, cid);
      case 'log_secrets': return isMaster(uid, cid) || (r.author === uid && r.vis !== 'blind');
      default: return isMember(uid, cid);
    }
  }

  // ——— Токены по матрице TASK-097 (миграция 20261030120000_own_tokens.sql) ———
  const POS = ['x', 'y', 'movedAt', 'rot'];
  const LOOK = ['scale', 'light', 'aura', 'disengaged', 'darkvision', 'elevation'];
  const IDENT = ['name', 'nameHidden', 'img', 'size', 'disposition', 'mount', 'layer'];
  const STATS = ['hpMax', 'ac', 'speed', 'initBonus', 'hp', 'tempHp', 'conditions'];
  const sameJ = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const isMyChar = (uid, cid, ch) => !!ch && isMember(uid, cid) && (T.characters.some((x) => x.id === ch && x.campaign_id === cid && x.owner_id === uid) || myChar(uid, cid) === ch);
  const ownsTok = (uid, t) => (t.character_id ? isMyChar(uid, t.campaign_id, t.character_id) : !!t.owner_id && t.owner_id === uid && isMember(uid, t.campaign_id));
  const openMove = (cid) => T.campaigns.find((x) => x.id === cid)?.data?.settings?.openMovement !== false;
  const canMoveTok = (uid, t) => isMaster(uid, t.campaign_id) || ownsTok(uid, t) || (isMember(uid, t.campaign_id) && !t.hidden && !t.data?.locked && openMove(t.campaign_id));

  /** guard_token: null — можно, иначе текст отказа. old — строка до правки (для UPDATE). */
  function tokenGuard(uid, op, r, old = {}) {
    const cid = r.campaign_id, d = r.data || {}, o = old.data || {};
    if ((op === 'insert' || r.scene_id !== old.scene_id || r.campaign_id !== old.campaign_id) && !T.scenes.some((s) => s.id === r.scene_id && s.campaign_id === cid)) return 'Сцена из другой кампании';
    if (r.character_id && (op === 'insert' || r.character_id !== old.character_id || cid !== old.campaign_id)
      && T.tokens.some((t) => t.campaign_id === cid && t.character_id === r.character_id && t.id !== r.id)) return 'Этот герой уже на карте — его переносят, второй токен не ставят';
    if (isMaster(uid, cid)) return null;
    if (JSON.stringify(d).length > 65536 && (op === 'insert' || JSON.stringify(d).length > JSON.stringify(o).length)) return 'Слишком много данных в токене';
    if (T.tokens.some(t => t.campaign_id === cid && t.data?.pending && [d.summonedBy, d.riding].includes(t.id))) return 'Сначала дождитесь разрешения мастера на этот токен';
    if (op === 'insert') {
      d.pending = true;
      if (r.hidden) return 'Скрывает только мастер';
      if (d.locked) return 'Закрепляет мастер';
      if (d.riding != null) return 'Сесть верхом можно после постановки';
      if (d.kind === 'hero') {
        if (!isMyChar(uid, cid, r.character_id)) return 'Это герой другого игрока';
        return r.owner_id && r.owner_id !== uid ? 'Владельца меняет мастер' : null;
      }
      if (!['custom', 'foe'].includes(d.kind)) return 'Это ставит мастер';
      if (r.character_id) return 'Лист к токену привязывает мастер';
      if ((r.owner_id || null) !== uid) return 'Свой токен и призыв — только от своего имени';
      if (d.summonedBy != null) {
        const ref = T.tokens.find((t) => t.id === d.summonedBy && t.campaign_id === cid);
        if (!ref || !ownsTok(uid, ref)) return 'Призывает владелец призывателя';
      } else if (d.kind === 'foe') return 'Существо игрок ставит только как призыв своего героя или токена';
      return null;
    }
    if (o.pending === true) return 'Токен ждёт разрешения мастера';
    if (cid !== old.campaign_id || (r.character_id || null) !== (old.character_id || null) || (r.owner_id || null) !== (old.owner_id || null) || Number(r.ord) !== Number(old.ord)) return 'Это меняет мастер';
    if (!!r.hidden !== !!old.hidden) return 'Скрывает только мастер';
    if (!sameJ(d.kind, o.kind) || !sameJ(d.monsterId, o.monsterId)) return 'Вид токена после создания не меняется';
    const own = ownsTok(uid, old);
    if (r.scene_id !== old.scene_id && !own) return 'Это меняет мастер';
    const allowed = own && old.character_id ? [...POS, ...LOOK] : own ? [...POS, ...LOOK, ...IDENT, ...STATS] : canMoveTok(uid, old) ? POS : [];
    const changed = [...new Set([...Object.keys(o), ...Object.keys(d)])].filter((k) => !sameJ(o[k], d[k]));
    if (o.locked && changed.some((k) => POS.includes(k))) return 'Токен закреплён мастером';
    if (changed.includes('riding')) {
      if (d.riding == null) {
        const ref = T.tokens.find((t) => t.id === o.riding);
        if (ref && !(own || allowed.includes('x') || ownsTok(uid, ref))) return 'Спешить может владелец всадника или ездового';
      } else {
        if (!own) return 'Сесть верхом может владелец всадника или мастер';
        const ref = T.tokens.find((t) => t.id === d.riding && t.campaign_id === cid);
        if (!ref || ref.scene_id !== r.scene_id || ref.hidden || ref.id === r.id) return 'Ездового нет на этой сцене';
        if (!ref.data?.mount) return 'Это не ездовое';
        if (ref.data?.riding != null || T.tokens.some((t) => t.data?.riding === r.id)) return 'Верхом нельзя ехать цепочкой';
      }
    }
    if (changed.includes('summonedBy')) {
      if (d.summonedBy != null) return 'Призывателя не меняют';
      if (!own && T.tokens.some((t) => t.id === o.summonedBy)) return 'Это меняет мастер';
    }
    const rest = changed.filter((k) => k !== 'riding' && k !== 'summonedBy' && !allowed.includes(k));
    if (!rest.length) return null;
    // Всадник едет вместе с ездовым: встаёт в его (уже записанную) точку.
    if (rest.every((k) => ['x', 'y', 'movedAt'].includes(k)) && o.riding != null && sameJ(d.riding, o.riding) && !o.locked && !old.hidden) {
      const ref = T.tokens.find((t) => t.id === o.riding && t.scene_id === r.scene_id);
      if (ref && canMoveTok(uid, ref) && Math.abs((Number(ref.data?.x) || 0) - (Number(d.x) || 0)) < 0.5 && Math.abs((Number(ref.data?.y) || 0) - (Number(d.y) || 0)) < 0.5) return null;
    }
    // Текст «Поле … чужого токена…» e2e.mjs ждёт у нарочно запрещённой правки хитов; в SQL — «Статы меняет владелец или мастер».
    if (rest.some((k) => POS.includes(k)) && !rest.some((k) => STATS.includes(k))) return 'Чужие токены двигает мастер';
    return `Поле ${rest.find((k) => STATS.includes(k)) || rest[0]} чужого токена меняет мастер`;
  }
  /** token_unlink: после удаления всадники спешиваются, призывы остаются без ссылки. */
  function unlinkToken(old) {
    for (const t of T.tokens) {
      if (t.campaign_id !== old.campaign_id) continue;
      let hit = false;
      for (const k of ['riding', 'summonedBy']) if (t.data?.[k] === old.id) { const { [k]: _, ...rest } = t.data; t.data = rest; hit = true; }
      if (hit) emit('tokens', 'UPDATE', t);
    }
  }

  // Права записи (упрощённо: политики + главное из охранников). Возвращает текст ошибки или null; 'skip' — RLS не нашёл строку.
  function writeCheck(uid, t, op, r, old) {
    const cid = t === 'campaigns' ? r.id : r.campaign_id;
    const M = isMaster(uid, cid), A = isMember(uid, cid);
    const rls = `new row violates row-level security policy for table "${t}"`;
    switch (t) {
      case 'creatures': return r.owner_id === uid ? null : rls;
      case 'heroes': return r.owner_id === uid ? null : rls;
      case 'campaign_creatures': return op === 'insert' ? M || (A && r.owner_id === uid) ? null : rls : M ? null : 'skip';
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
        // RLS tokens_insert / tokens_update / tokens_delete + охранники guard_token, guard_token_delete (own_tokens).
        if (op === 'insert') return A ? tokenGuard(uid, 'insert', r) : rls;
        if (!(M || (A && !old.hidden))) return 'skip';
        if (op === 'delete') return M || ((!old.character_id || old.data?.pending) && ownsTok(uid, old)) ? null : 'Удаляет мастер';
        return tokenGuard(uid, 'update', r, old);
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
    if (t === 'tokens' && r.owner_id === undefined) r.owner_id = null; // SELECT отдаёт колонку и без значения
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
    // Очищенная копия боя: здесь у всех участников одна строка боя, полные права проверяет rls.sql.
    if (q.table === 'combat_public') q = { ...q, table: 'combats' };
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
      const written = [].concat(q.payload).map((row) => clone(find(t, row)));
      return { data: q.wantSelect ? q.single ? written[0] : written : null, error: null };
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
      const removed = [];
      for (const old of hit) {
        const w = writeCheck(uid, t, 'delete', old, old); if (w === 'skip') continue; if (w) return err(w, '42501');
        removed.push(clone(old));
        T[t].splice(T[t].indexOf(old), 1); emit(t, 'DELETE', null, old);
        if (t === 'tokens') unlinkToken(old);
        if (t === 'campaigns') for (const k of Object.keys(T)) if (k !== 'campaigns' && k !== 'profiles') for (const x of T[k].filter((y) => y.campaign_id === old.id)) { T[k].splice(T[k].indexOf(x), 1); emit(k, 'DELETE', null, x); }
        if (t === 'scenes') for (const k of ['tokens', 'drawings', 'scene_secrets', 'scene_explored']) for (const x of T[k].filter((y) => y.scene_id === old.id)) { T[k].splice(T[k].indexOf(x), 1); emit(k, 'DELETE', null, x); }
      }
      return { data: q.wantSelect ? removed : null, error: null };
    }
    return err('unknown action');
  }

  function rpc(uid, name, a) {
    ensureProfile(uid);
    if (rpcOverride) { const custom = rpcOverride({ uid, name, args: a, tables: T, emit }); if (custom !== undefined) return custom; }
    const ok = (data) => ({ data, error: null });
    if (name === 'create_character_sheet') {
      const row = { id: a.p_character, campaign_id: a.p_campaign, owner_id: uid, data: a.p_payload, sheet_version: '0', sheet_managed: true, archived_at: null };
      const failure = insertRow(uid, 'characters', row);
      if (failure) return err(failure, /duplicate key/.test(failure) ? '23505' : '42501');
      return ok({ ok: true, operationId: a.p_operation, replayed: false, sheet: { id: row.id, campaignId: row.campaign_id, ownerId: uid, version: '0', managed: true, archivedAt: null, data: structuredClone(row.data), controllers: [] } });
    }
    if (name === 'place_creature') {
      const c = a.p_creature, t = a.p_token;
      if (!c || !t || c.campaign_id !== t.campaign_id || t.data?.monsterId !== `lib:${c.id}`) return err('Нужны снимок и токен одной кампании', '22023');
      const had = find('campaign_creatures', c);
      let failure = had ? null : insertRow(uid, 'campaign_creatures', c, { emitIt: false });
      if (!failure) failure = insertRow(uid, 'tokens', t, { emitIt: false });
      if (failure) {
        if (!had) { const i = T.campaign_creatures.findIndex((x) => x.id === c.id && x.campaign_id === c.campaign_id); if (i >= 0) T.campaign_creatures.splice(i, 1); }
        return err(failure, /duplicate key/.test(failure) ? '23505' : '42501');
      }
      if (!had) emit('campaign_creatures', 'INSERT', find('campaign_creatures', c));
      emit('tokens', 'INSERT', find('tokens', t));
      return ok(t.id);
    }
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
    // patch_token: только переданные поля data, от имени вошедшего (security invoker: RLS + guard_token).
    if (name === 'patch_token') {
      const set = a.p_set ?? {};
      if (!set || typeof set !== 'object' || Array.isArray(set)) return err('Нужен объект полей', '22023');
      const old = T.tokens.find((t) => t.id === a.p_id && canSee(uid, 'tokens', t));
      if (!old) return err('Токен удалён мастером', 'P0002');
      const data = { ...old.data };
      for (const k of a.p_unset || []) delete data[k];
      for (const [k, v] of Object.entries(set)) if (!['id', 'characterId', 'hidden', 'ownerId'].includes(k)) data[k] = v;
      const w = writeCheck(uid, 'tokens', 'update', { ...old, data }, old);
      if (w === 'skip') return err('Токен удалён мастером', 'P0002');
      if (w) return err(w, '42501');
      old.data = data; emit('tokens', 'UPDATE', old);
      return ok(clone(data));
    }
    // move_tokens: до 50 токенов одной транзакцией, ездовые первыми; отказ по любому — не двигается никто.
    if (name === 'move_tokens') {
      const moves = a.p_moves;
      if (!Array.isArray(moves) || moves.length < 1 || moves.length > 50) return err('Нужен список от 1 до 50 перемещений', '22023');
      const mount = (m) => (T.tokens.find((t) => t.id === m?.id)?.data?.mount ? 1 : 0);
      const order = moves.map((m, i) => ({ m, i })).sort((p, q) => mount(q.m) - mount(p.m) || p.i - q.i).map((x) => x.m);
      const undo = [], done = [];
      const fail = (e) => { for (const [t, d] of undo.reverse()) t.data = d; return e; };
      for (const m of order) {
        const bad = Object.keys(m || {}).find((k) => k !== 'id' && !['x', 'y', 'movedAt', 'rot'].includes(k));
        if (bad) return fail(err(`Перемещение меняет только место и поворот, не «${bad}»`, '22023'));
        const old = T.tokens.find((t) => t.id === m.id && t.scene_id === a.p_scene && canSee(uid, 'tokens', t));
        if (!old) return fail(err('Токен удалён мастером', 'P0002'));
        const { id, ...set } = m;
        const data = { ...old.data, ...set };
        const w = writeCheck(uid, 'tokens', 'update', { ...old, data }, old);
        if (w === 'skip') return fail(err('Токен удалён мастером', 'P0002'));
        if (w) return fail(err(w, '42501'));
        undo.push([old, old.data]); old.data = data; done.push(old);
      }
      for (const t of done) emit('tokens', 'UPDATE', t);
      return ok(done.length);
    }
    // Как PostgREST: неизвестная функция — PGRST202 (клиент тогда переходит на прежнюю отправку целой строки).
    return err(`Could not find the function public.${name} in the schema cache`, 'PGRST202');
  }

  function presenceSync(topic) {
    const m = pres.get(topic) || new Map();
    const state = {};
    for (const { key, info } of m.values()) (state[key] ||= []).push({ ...info, presence_ref: key });
    for (const [chan, s] of subs) if (s.topic === topic) send(s.page, chan, 'presence', state);
  }

  const net = { down: false };
  const auth = { anonymous: true, n: 0 }; // auth.anonymous = false — анонимный вход выключен в Supabase
  async function handle(page, msg) {
    log.push(msg.op === 'query' ? `${msg.q.action} ${msg.q.table}` : msg.op);
    if (net.signGate && msg.op === 'sign' && msg.bucket === 'tokens') await net.signGate;
    if (net.writeGate && (msg.op === 'rpc' && msg.name === 'place_creature'
      || msg.op === 'query' && msg.q.action === 'insert' && ['tokens', 'campaign_creatures'].includes(msg.q.table))) await net.writeGate;
    // Обрыв сети: supabase-js не бросает, а возвращает ошибку без кода.
    if (net.down && ['query', 'rpc'].includes(msg.op)) return { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' } };
    switch (msg.op) {
      case 'client': return null;
      case 'query': return query(msg.uid, msg.q);
      case 'rpc': return rpc(msg.uid, msg.name, msg.args || {});
      case 'oauth': oauth.push(msg.o); return null;
      case 'anon': {
        // Как настоящий Supabase: без «Allow anonymous sign-ins» — отказ; иначе новый пользователь, ник из метаданных.
        if (!auth.anonymous) return { error: { message: 'Anonymous sign-ins are disabled', code: 'anonymous_provider_disabled' } };
        const id = `00000000-0000-4000-8000-${String(++auth.n).padStart(12, '0')}`;
        names[id] = String(msg.name || '').slice(0, 40) || 'Игрок';
        ensureProfile(id);
        return { id };
      }
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
        if (msg.bucket === 'library' ? cid !== msg.uid : msg.bucket === 'tokens' ? !isMember(msg.uid, cid) : !isMaster(msg.uid, cid)) return { data: null, error: { message: 'new row violates row-level security policy' } };
        files.set(msg.path, msg.size); if (msg.dataUrl) fileUrls.set(msg.path, msg.dataUrl); return { data: { path: msg.path }, error: null };
      }
      case 'sign': {
        const cid = msg.path.split('/')[0];
        if ((msg.bucket === 'library' ? cid !== msg.uid : !isApplicant(msg.uid, cid)) || !files.has(msg.path)) return { data: null, error: { message: 'Object not found' } };
        return { data: { signedUrl: fileUrls.get(msg.path) || 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#3a5"/></svg>') }, error: null };
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

  return { T, attach, log, oauth, files, subs, pres, sysInsert, ensureProfile, net, auth };
}
