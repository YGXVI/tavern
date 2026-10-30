// Серверный режим (TASK-002): строки таблиц Supabase ↔ объект кампании прежней формы (docs/data.md).
// Чистые функции без сети — их проверяет `npm test` (tests/server-model.test.js).
//
//   assemble(rows, opts)  — собрать кампанию из строк, которые вернул сервер (игроку RLS не отдаёт скрытое);
//   explode(campaign)     — разложить кампанию на строки таблиц;
//   diffRows(before, after, opts) — что отправить на сервер после изменения.

const HIDDEN_VIS = new Set(['gm', 'blind', 'self']);
// Поля записи журнала, которые для скрытого броска уходят в log_secrets.
const SECRET_LOG_KEYS = ['label', 'text', 'total', 'detail', 'nat', 'dice', 'results'];
// Поля кампании, которые живут отдельными таблицами или не сохраняются на сервере.
const CAMPAIGN_SKIP = new Set(['id', 'name', 'ownerId', 'members', 'invite', 'characters', 'archivedCharacters', 'scenes', 'combat', 'log', 'saveRequests', 'portalRequests', 'doorAttempt']);

const ms = (t) => (t ? Date.parse(t) || null : null);
const iso = (n) => (n ? new Date(n).toISOString() : null);
const omit = (o, keys) => { const r = {}; for (const k of Object.keys(o || {})) if (!keys.has(k)) r[k] = o[k]; return r; };
export const EMPTY_COMBAT = () => ({ active: false, round: 0, turn: 0, entries: [], moved: {} });

/** Пустой кэш строк одной кампании. */
export function emptyRows() {
  return {
    campaign: null, invite: null,
    members: new Map(), characters: new Map(), scenes: new Map(), secrets: new Map(), explored: new Map(),
    tokens: new Map(), drawings: new Map(), log: new Map(), logSecrets: new Map(), saves: new Map(), portals: new Map(),
    combat: null,
  };
}

/** ACK RPC листа → кэш строк. Служебные колонки не попадают в characters.data. */
export function applyCharacterSnapshot(rows, sheet) {
  if (!rows.campaign || sheet?.campaignId !== rows.campaign.id || typeof sheet.id !== 'string'
    || typeof sheet.data !== 'object' || sheet.data === null || Array.isArray(sheet.data)
    || typeof sheet.version !== 'string' || !/^\d+$/.test(sheet.version)) throw new TypeError('Некорректный снимок листа');
  const previous = rows.characters.get(sheet.id);
  if (previous?.sheet_version !== undefined && BigInt(previous.sheet_version) > BigInt(sheet.version)) return rows;
  rows.characters.set(sheet.id, {
    id: sheet.id, campaign_id: sheet.campaignId, owner_id: sheet.ownerId ?? null, data: structuredClone(sheet.data),
    sheet_version: sheet.version, sheet_managed: !!sheet.managed, archived_at: sheet.archivedAt ?? null,
  });
  return rows;
}

/**
 * Строки → кампания. Кампания получает свои копии данных: интерфейс правит её на месте, а кэш строк должен
 * оставаться тем, что лежит на сервере (по нему считаются разрешённые игроку изменения боя и порядок токенов).
 */
export function assemble(rows0) {
  if (!rows0.campaign) return null;
  const rows = structuredClone(rows0);
  const r = rows.campaign;
  const d = r.data || {};
  const c = {
    ...omit(d, CAMPAIGN_SKIP),
    id: r.id, name: r.name, ownerId: r.owner_id,
    createdAt: d.createdAt || ms(r.created_at) || Date.now(),
    settings: d.settings || {},
    members: [], invite: null, characters: [], scenes: [], log: [], saveRequests: [], portalRequests: [],
    combat: rows.combat ? { ...EMPTY_COMBAT(), ...rows.combat.data } : EMPTY_COMBAT(),
  };
  c.members = [...rows.members.values()].map((m) => {
    const out = { userId: m.user_id, role: m.role, status: m.status, characterId: m.character_id || null, joinedAt: ms(m.joined_at) || 0 };
    if (m.scene_id) out.sceneId = m.scene_id;
    return out;
  }).sort((a, b) => (a.role === b.role ? a.joinedAt - b.joinedAt : a.role === 'master' ? -1 : 1));
  const inv = rows.invite;
  c.invite = inv ? { code: inv.code, createdAt: ms(inv.created_at), expiresAt: ms(inv.expires_at), manual: !!inv.manual, ...(inv.revoked ? { revoked: true } : {}) } : { code: null, manual: true, expiresAt: null };
  const characterRows = [...rows.characters.values()];
  c.characters = characterRows.filter((ch) => !ch.archived_at).map((ch) => ({ ...ch.data, id: ch.id, ownerId: ch.owner_id || null }))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id)));
  const archive = characterRows.filter((ch) => ch.archived_at).map((ch) => ({ ...ch.data, id: ch.id, ownerId: ch.owner_id || null }));
  if (archive.length) c.archivedCharacters = archive;

  const byScene = (map) => {
    const g = new Map();
    for (const x of map.values()) { if (!g.has(x.scene_id)) g.set(x.scene_id, []); g.get(x.scene_id).push(x); }
    for (const list of g.values()) list.sort((a, b) => Number(a.ord) - Number(b.ord) || String(a.id).localeCompare(String(b.id)));
    return g;
  };
  const tok = byScene(rows.tokens), drw = byScene(rows.drawings);
  c.scenes = [...rows.scenes.values()].sort((a, b) => a.ord - b.ord).map((s) => {
    const sd = s.data || {};
    const sec = rows.secrets.get(s.id)?.data || {};
    const scene = { ...sd, id: s.id };
    scene.fog = { mode: 'off', ops: [], ...(sd.fog || {}), explored: [...(rows.explored.get(s.id)?.cells || [])] };
    scene.walls = sd.walls || []; scene.lights = sd.lights || []; scene.portals = sd.portals || [];
    scene.terrain = sd.terrain || { difficult: [], blocked: [] };
    scene.pins = [...(sd.pins || []), ...(sec.pins || [])];
    scene.traps = sec.traps || [];
    scene.tokens = (tok.get(s.id) || []).map((t) => ({ ...t.data, id: t.id, characterId: t.character_id || undefined, hidden: !!t.hidden }));
    for (const t of scene.tokens) if (t.characterId === undefined) delete t.characterId;
    scene.drawings = (drw.get(s.id) || []).map((x) => ({ ...x.data, id: x.id, author: x.author || null }));
    return scene;
  });

  c.log = [...rows.log.values()].map((e) => {
    const sec = rows.logSecrets.get(e.id)?.data;
    const entry = { ...e.data, ...(sec || {}), id: e.id, at: Number(e.at), userId: e.author || null, vis: e.vis };
    if (HIDDEN_VIS.has(e.vis)) { entry.hidden = true; if (!sec) entry.redacted = true; }
    return entry;
  }).sort((a, b) => b.at - a.at).slice(0, 120);
  c.saveRequests = [...rows.saves.values()].map((x) => ({ ...x.data, id: x.id })).sort((a, b) => (a.at || 0) - (b.at || 0));
  c.portalRequests = [...rows.portals.values()].map((x) => ({ ...x.data, id: x.id, userId: x.author || x.data?.userId })).sort((a, b) => (a.at || 0) - (b.at || 0));
  return c;
}

/**
 * Кампания → строки таблиц (те же формы, что в rows). ord токенов и рисунков берётся из прежних строк
 * (индекс в массиве у игрока и мастера разный — игрок не видит скрытого), у новых — время создания.
 */
export function explode(c, prev = emptyRows(), now = Date.now()) {
  const rows = emptyRows();
  const data = omit(c, CAMPAIGN_SKIP);
  rows.campaign = { id: c.id, owner_id: c.ownerId, name: c.name, data };
  for (const m of c.members || []) {
    rows.members.set(m.userId, withDefault({ campaign_id: c.id, user_id: m.userId, role: m.role, status: m.status, character_id: m.characterId || null, scene_id: m.sceneId || null, joined_at: prev.members.get(m.userId)?.joined_at ?? iso(m.joinedAt) }, 'joined_at'));
  }
  if (c.invite?.code) rows.invite = withDefault({ campaign_id: c.id, code: c.invite.code, expires_at: iso(c.invite.expiresAt), manual: !!c.invite.manual, revoked: !!c.invite.revoked, created_at: prev.invite?.created_at ?? iso(c.invite.createdAt) }, 'created_at');
  for (const ch of [...(c.characters || []), ...(c.archivedCharacters || [])]) {
    const { id, ownerId, ...rest } = ch;
    const old = prev.characters.get(id);
    rows.characters.set(id, { id, campaign_id: c.id, owner_id: ownerId || null, data: rest,
      ...(old?.sheet_version !== undefined ? { sheet_version: old.sheet_version, sheet_managed: old.sheet_managed, archived_at: old.archived_at } : {}) });
  }
  (c.scenes || []).forEach((s, i) => {
    const { id, tokens = [], drawings = [], traps = [], pins = [], fog = {}, ...rest } = s;
    const { explored = [], ...fogRest } = fog;
    const open = pins.filter((p) => p.kind !== 'secret' && p.shown);
    const secret = pins.filter((p) => !(p.kind !== 'secret' && p.shown));
    rows.scenes.set(id, { id, campaign_id: c.id, ord: i, data: { ...rest, fog: fogRest, pins: open } });
    rows.secrets.set(id, { scene_id: id, campaign_id: c.id, data: { traps, pins: secret } });
    rows.explored.set(id, { scene_id: id, campaign_id: c.id, cells: [...explored] });
    tokens.forEach((t, k) => {
      const { id: tid, characterId, hidden, ...td } = t;
      rows.tokens.set(tid, { id: tid, campaign_id: c.id, scene_id: id, character_id: characterId || null, hidden: !!hidden, ord: prev.tokens.get(tid)?.ord ?? now + k, data: td });
    });
    drawings.forEach((d, k) => {
      const { id: did, author, ...dd } = d;
      rows.drawings.set(did, { id: did, campaign_id: c.id, scene_id: id, author: author || null, ord: prev.drawings.get(did)?.ord ?? now + k, data: dd });
    });
  });
  for (const e of c.log || []) {
    const { id, at, userId, vis: v0, ...rest } = e;
    const vis = v0 || (e.hidden ? 'gm' : 'all');
    if (HIDDEN_VIS.has(vis)) {
      const pub = {}, sec = {};
      for (const [k, v] of Object.entries(rest)) {
        if (k === 'redacted') continue;
        (SECRET_LOG_KEYS.includes(k) ? sec : pub)[k] = v;
      }
      pub.hidden = true;
      rows.log.set(id, { id, campaign_id: c.id, author: userId || null, at: at || now, vis, data: pub });
      if (!e.redacted) rows.logSecrets.set(id, { id, campaign_id: c.id, author: userId || null, vis, data: sec });
    } else {
      rows.log.set(id, { id, campaign_id: c.id, author: userId || null, at: at || now, vis: 'all', data: rest });
    }
  }
  for (const r of c.saveRequests || []) { const { id, ...rest } = r; rows.saves.set(id, { id, campaign_id: c.id, data: rest }); }
  for (const r of c.portalRequests || []) { const { id, userId, ...rest } = r; rows.portals.set(id, { id, campaign_id: c.id, author: userId || null, data: { ...rest, userId } }); }
  rows.combat = { campaign_id: c.id, data: { ...(c.combat || EMPTY_COMBAT()) } };
  return rows;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Колонка not null с умолчанием: если значения нет, не отправляем её вовсе (явный null база отвергнет). */
function withDefault(row, key) { if (row[key] == null) delete row[key]; return row; }

/**
 * Что изменилось между двумя разложениями одной кампании.
 * Возвращает список операций {table, op: 'insert'|'update'|'delete'|'rpc', key, row, prev} в порядке отправки.
 * opts.isMaster — мастер; игрок не отправляет то, что ему заведомо запрещено и что сервер всё равно вернёт:
 * удаления записей журнала, правку кампании, вставку участников.
 */
export function diffRows(a, b, { isMaster = false } = {}) {
  const ops = [];
  const cmpMap = (table, ma, mb, { insert = true, update = true, del = true } = {}) => {
    for (const [k, row] of mb) {
      const old = ma.get(k);
      if (!old) { if (insert) ops.push({ table, op: 'insert', key: k, row }); }
      else if (update && !same(old, row)) ops.push({ table, op: 'update', key: k, row, prev: old });
    }
    if (del) for (const [k, row] of ma) if (!mb.has(k)) ops.push({ table, op: 'delete', key: k, prev: row });
  };
  if (a.campaign && b.campaign && !same(a.campaign, b.campaign) && isMaster) ops.push({ table: 'campaigns', op: 'update', key: b.campaign.id, row: b.campaign, prev: a.campaign });
  if (isMaster && !same(a.invite, b.invite) && b.invite) ops.push({ table: 'campaign_invites', op: a.invite ? 'update' : 'insert', key: b.invite.campaign_id, row: b.invite, prev: a.invite });
  cmpMap('campaign_members', a.members, b.members, { insert: false });
  cmpMap('characters', a.characters, b.characters);
  cmpMap('scenes', a.scenes, b.scenes);
  if (isMaster) cmpMap('scene_secrets', a.secrets, b.secrets, { del: false });
  // Исследованные клетки — только добавление, функцией add_explored.
  for (const [sid, row] of b.explored) {
    const had = new Set(a.explored.get(sid)?.cells || []);
    const add = row.cells.filter((x) => !had.has(x));
    if (add.length) ops.push({ table: 'scene_explored', op: 'rpc', key: sid, row: { p_scene: sid, p_cells: add } });
  }
  cmpMap('tokens', a.tokens, b.tokens);
  cmpMap('drawings', a.drawings, b.drawings);
  cmpMap('log_entries', a.log, b.log, { update: false, del: false });
  cmpMap('log_secrets', a.logSecrets, b.logSecrets, { update: false, del: false });
  cmpMap('save_requests', a.saves, b.saves);
  cmpMap('portal_requests', a.portals, b.portals, { update: false });
  if (!same(a.combat, b.combat)) ops.push({ table: 'combats', op: a.combat ? 'update' : 'insert', key: b.combat.campaign_id, row: b.combat, prev: a.combat });
  // Порядок: сначала родители, удаления детей — до удаления родителей.
  const order = ['campaigns', 'campaign_invites', 'campaign_members', 'characters', 'scenes', 'scene_secrets', 'scene_explored', 'tokens', 'drawings', 'log_entries', 'log_secrets', 'save_requests', 'portal_requests', 'combats'];
  const rank = (o) => (o.op === 'delete' ? 100 - order.indexOf(o.table) : order.indexOf(o.table));
  return ops.sort((x, y) => rank(x) - rank(y));
}

/** Применить операции к кэшу строк (оптимистично — до ответа сервера). */
export function applyOps(rows, ops0) {
  // Копии: строки операций собраны из живой кампании, и её дальнейшие правки не должны менять кэш.
  const ops = structuredClone(ops0);
  const map = { campaign_members: 'members', characters: 'characters', scenes: 'scenes', scene_secrets: 'secrets', tokens: 'tokens', drawings: 'drawings', log_entries: 'log', log_secrets: 'logSecrets', save_requests: 'saves', portal_requests: 'portals' };
  for (const o of ops) {
    if (o.table === 'campaigns') { rows.campaign = o.row; continue; }
    if (o.table === 'campaign_invites') { rows.invite = o.row; continue; }
    if (o.table === 'combats') { rows.combat = o.row; continue; }
    if (o.table === 'scene_explored') {
      const cur = rows.explored.get(o.key) || { scene_id: o.key, campaign_id: rows.campaign?.id, cells: [] };
      rows.explored.set(o.key, { ...cur, cells: [...new Set([...cur.cells, ...o.row.p_cells])] });
      continue;
    }
    const m = rows[map[o.table]]; if (!m) continue;
    if (o.op === 'delete') m.delete(o.key); else m.set(o.key, o.row);
  }
  return rows;
}

/** Строка из события реального времени → в кэш. table — имя таблицы, row — новая строка (или старая при удалении). */
export function applyChange(rows, table, type, row) {
  const keyOf = { campaign_members: (r) => r.user_id, scene_secrets: (r) => r.scene_id, scene_explored: (r) => r.scene_id };
  const map = { campaign_members: 'members', characters: 'characters', scenes: 'scenes', scene_secrets: 'secrets', scene_explored: 'explored', tokens: 'tokens', drawings: 'drawings', log_entries: 'log', log_secrets: 'logSecrets', save_requests: 'saves', portal_requests: 'portals' };
  if (table === 'campaigns') { if (type === 'DELETE') rows.campaign = null; else rows.campaign = row; return rows; }
  if (table === 'campaign_invites') { rows.invite = type === 'DELETE' ? null : row; return rows; }
  if (table === 'combats') { rows.combat = type === 'DELETE' ? null : row; return rows; }
  const m = rows[map[table]]; if (!m) return rows;
  const k = (keyOf[table] || ((r) => r.id))(row);
  if (type === 'DELETE') m.delete(k); else m.set(k, row);
  return rows;
}

/** Разложить строки, которые вернул сервер при загрузке, по кэшу одной кампании. */
export function rowsFrom(server) {
  const rows = emptyRows();
  rows.campaign = server.campaign || null;
  rows.invite = server.invite || null;
  rows.combat = server.combat || null;
  const put = (m, list, key = (r) => r.id) => { for (const r of list || []) m.set(key(r), r); };
  put(rows.members, server.members, (r) => r.user_id);
  put(rows.characters, server.characters);
  put(rows.scenes, server.scenes);
  put(rows.secrets, server.secrets, (r) => r.scene_id);
  put(rows.explored, server.explored, (r) => r.scene_id);
  put(rows.tokens, server.tokens);
  put(rows.drawings, server.drawings);
  put(rows.log, server.log);
  put(rows.logSecrets, server.logSecrets);
  put(rows.saves, server.saves);
  put(rows.portals, server.portals);
  return rows;
}

/** Копия кэша (Map-ы копируются, строки — по ссылке: строки не меняются на месте). */
export function cloneRows(r) {
  const out = { ...r };
  for (const k of Object.keys(r)) if (r[k] instanceof Map) out[k] = new Map(r[k]);
  return out;
}
