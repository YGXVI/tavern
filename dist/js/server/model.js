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
const CAMPAIGN_SKIP = new Set(['id', 'name', 'ownerId', 'members', 'invite', 'characters', 'archivedCharacters', 'scenes', 'combat', 'log', 'saveRequests', 'portalRequests', 'doorAttempt', 'creatures']);

const ms = (t) => (t ? Date.parse(t) || null : null);
const iso = (n) => (n ? new Date(n).toISOString() : null);
const omit = (o, keys) => { const r = {}; for (const k of Object.keys(o || {})) if (!keys.has(k)) r[k] = o[k]; return r; };
export const EMPTY_COMBAT = () => ({ active: false, round: 0, turn: 0, entries: [], moved: {} });

/** Пустой кэш строк одной кампании. */
export function emptyRows(withCreatures = false) {
  return {
    campaign: null, invite: null,
    members: new Map(), characters: new Map(), scenes: new Map(), secrets: new Map(), explored: new Map(),
    tokens: new Map(), drawings: new Map(), log: new Map(), logSecrets: new Map(), saves: new Map(), portals: new Map(),
    combat: null,
    // Снимки личных существ в кампании (TASK-179): Map — таблица campaign_creatures есть; null — её ещё нет на сервере.
    creatures: withCreatures ? new Map() : null,
    // Тайное мастера в токенах (20261105170000): секреты по token_id и список тайных полей каждого токена (_s).
    tokenSecrets: new Map(), tokenHeld: new Map(), master: false,
    // Тайное мастера в сценах (20261106160000): {note, walls: {id: поля}} по scene_id.
    sceneHidden: new Map(),
  };
}

// ——— Тайное мастера в токенах (аудит 04.11, #204) ———
// Публичная строка tokens несёт _s (какие поля лежат в token_secrets) и wound (степень ранения вместо хитов).
// Мастер видит токен целиком: тайные поля подставляются из секрета. Игроку подставляются только видимые ему
// значения: хиты по степени ранения (их показывает только «цел / ранен / …») и «союзник» у скрытого врага;
// _s и wound у игрока остаются в данных токена, чтобы строка, собранная из кампании, совпала с кэшем.
const WOUND_HP = { full: 100, hurt: 75, bloodied: 40, critical: 10, down: 0 };
export function viewToken(row, { master = false, secret = null, prev = null } = {}) {
  const d = row?.data;
  if (!d || typeof d !== 'object') return row;
  const held = Array.isArray(d._s) ? d._s : [];
  if (!held.length && !('wound' in d)) return row;
  const data = { ...d };
  if (master) {
    delete data._s; delete data.wound;
    const src = secret?.data || prev?.data || {};
    for (const k of held) if (!(k in data) && k in src) data[k] = src[k];
  } else {
    if (held.includes('hp') && data.wound in WOUND_HP) { data.hpMax = 100; data.hp = WOUND_HP[data.wound]; }
    if (held.includes('disposition')) data.disposition = 'friendly';
  }
  return { ...row, data };
}
function putToken(rows, row, prev) {
  const held = Array.isArray(row?.data?._s) ? row.data._s : [];
  if (held.length) rows.tokenHeld.set(row.id, held); else rows.tokenHeld.delete(row.id);
  rows.tokens.set(row.id, viewToken(row, { master: rows.master, secret: rows.tokenSecrets.get(row.id), prev }));
}
// ——— Тайное мастера в сценах (аудит 04.11, #204) ———
// Публичная строка: неоткрытая потайная дверь — обычная стена, без сложности замка и заметки мастера. Мастер видит
// сцену целиком: скрытое подставляется поверх. Колонка revealed — серверная, в кэш не попадает: иначе строка, собранная
// из кампании, не совпала бы с кэшем и каждое действие слало бы все сцены заново.
const wallHidden = (w) => (w?.kind === 'secret' && !w.discovered ? (({ id, a, b, ...rest }) => rest)(w) : w?.lockDc !== undefined ? { lockDc: w.lockDc } : null);
export function viewScene(row, { master = false, hidden = null, prev = null } = {}) {
  if (!row) return row;
  const { revealed, ...out } = row;
  if (!master || !out.data) return out;
  const src = hidden?.data || null, was = prev?.data;
  const data = { ...out.data };
  // Скрытое ещё не пришло событием — держим то, что мастер уже видел.
  if (Array.isArray(data.walls)) data.walls = data.walls.map((w) => { const h = src ? src.walls?.[w.id] : wallHidden((was?.walls || []).find((x) => x.id === w.id)); return h ? { ...w, ...h } : w; });
  const note = src ? src.note : was?.note;
  if (note !== undefined) data.note = note;
  return { ...out, data };
}
function putSceneHidden(rows, type, row) {
  const k = row?.scene_id; if (k == null) return;
  if (type === 'DELETE') { rows.sceneHidden.delete(k); return; }
  rows.sceneHidden.set(k, row);
  const s = rows.scenes.get(k);
  if (rows.master && s) rows.scenes.set(k, viewScene(s, { master: true, hidden: row }));
}

/** Секрет токена пришёл или изменился: мастер подставляет тайные поля в уже лежащий токен. */
function putTokenSecret(rows, type, row) {
  const k = row?.token_id; if (k == null) return;
  if (type === 'DELETE') { rows.tokenSecrets.delete(k); return; }
  rows.tokenSecrets.set(k, row);
  const t = rows.tokens.get(k), held = rows.tokenHeld.get(k);
  if (!rows.master || !t || !held) return;
  const data = { ...t.data };
  for (const h of held) { if (h in (row.data || {})) data[h] = row.data[h]; else delete data[h]; }
  rows.tokens.set(k, { ...t, data });
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
  if (rows.creatures) c.creatures = Object.fromEntries([...rows.creatures.values()].map((x) => [x.id, { ...x.data, id: x.id, ownerId: x.owner_id || null, sourceId: x.source_id || null }]));

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
    scene.tokens = (tok.get(s.id) || []).map((t) => ({ ...t.data, id: t.id, characterId: t.character_id || undefined, ownerId: t.owner_id || undefined, hidden: !!t.hidden }));
    for (const t of scene.tokens) { if (t.characterId === undefined) delete t.characterId; if (t.ownerId === undefined) delete t.ownerId; }
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
/** Время строки: прежняя строка сервера, если момент тот же (формат ISO у сервера свой), иначе новое значение. */
const keepTime = (prevIso, msValue) => (prevIso != null && (msValue == null || ms(prevIso) === msValue) ? prevIso : iso(msValue));

export function explode(c, prev = emptyRows(true), now = Date.now()) {
  const rows = emptyRows();
  const data = omit(c, CAMPAIGN_SKIP);
  rows.campaign = { id: c.id, owner_id: c.ownerId, name: c.name, data };
  for (const m of c.members || []) {
    rows.members.set(m.userId, withDefault({ campaign_id: c.id, user_id: m.userId, role: m.role, status: m.status, character_id: m.characterId || null, scene_id: m.sceneId || null, joined_at: keepTime(prev.members.get(m.userId)?.joined_at, m.joinedAt) }, 'joined_at'));
  }
  if (c.invite?.code) rows.invite = withDefault({ campaign_id: c.id, code: c.invite.code, expires_at: iso(c.invite.expiresAt), manual: !!c.invite.manual, revoked: !!c.invite.revoked, created_at: keepTime(prev.invite?.created_at, c.invite.createdAt) }, 'created_at');
  for (const ch of [...(c.characters || []), ...(c.archivedCharacters || [])]) {
    const { id, ownerId, ...rest } = ch;
    const old = prev.characters.get(id);
    rows.characters.set(id, { id, campaign_id: c.id, owner_id: ownerId || null, data: rest,
      ...(old?.sheet_version !== undefined ? { sheet_version: old.sheet_version, sheet_managed: old.sheet_managed, archived_at: old.archived_at } : {}) });
  }
  // Снимки существ — только если таблица есть на сервере (prev.creatures — Map); нет таблицы — null, без операций.
  if (prev.creatures) {
    rows.creatures = new Map();
    for (const [key, x] of Object.entries(c.creatures || {})) {
      const { id = key, ownerId, sourceId, updatedAt, ...data } = x;
      rows.creatures.set(id, { campaign_id: c.id, id, owner_id: ownerId || null, source_id: sourceId || null, data });
    }
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
      const { id: tid, characterId, ownerId, hidden, ...td } = t;
      const row = { id: tid, campaign_id: c.id, scene_id: id, character_id: characterId || null, hidden: !!hidden, ord: prev.tokens.get(tid)?.ord ?? now + k, data: td };
      // Владелец своего токена и призыва (TASK-123) — колонка owner_id. Пишем её, когда владелец есть, только что снят
      // или колонка уже пришла с сервера (после миграции SELECT отдаёт owner_id: null у каждого токена — без неё
      // «null» и «нет поля» разошлись бы, и любое действие слало бы все токены заново). До миграции поля нет — как раньше.
      const was = prev.tokens.get(tid);
      if (ownerId || (was && 'owner_id' in was)) row.owner_id = ownerId || null;
      rows.tokens.set(tid, row);
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
  // Исследованные клетки — добавление функцией add_explored. Мастер, стерев клетки («Скрыть всё», новая сетка),
  // перезаписывает строку целиком (политика explored_master): иначе сервер вернул бы старые клетки (review C5).
  for (const [sid, row] of b.explored) {
    const had = new Set(a.explored.get(sid)?.cells || []);
    const now = new Set(row.cells);
    if (isMaster && [...had].some((x) => !now.has(x))) {
      ops.push({ table: 'scene_explored', op: 'replace', key: sid, row: { scene_id: sid, campaign_id: row.campaign_id, cells: [...now] } });
      continue;
    }
    const add = row.cells.filter((x) => !had.has(x));
    if (add.length) ops.push({ table: 'scene_explored', op: 'rpc', key: sid, row: { p_scene: sid, p_cells: add } });
  }
  // Снимки существ (TASK-179): добавляет мастер или владелец призыва, правит и удаляет мастер. До токенов — токен ссылается на снимок.
  if (a.creatures && b.creatures) cmpMap('campaign_creatures', a.creatures, b.creatures, { update: isMaster, del: isMaster });
  cmpMap('tokens', a.tokens, b.tokens);
  cmpMap('drawings', a.drawings, b.drawings);
  cmpMap('log_entries', a.log, b.log, { update: false, del: false });
  cmpMap('log_secrets', a.logSecrets, b.logSecrets, { update: false, del: false });
  cmpMap('save_requests', a.saves, b.saves);
  cmpMap('portal_requests', a.portals, b.portals, { update: false });
  if (!same(a.combat, b.combat)) ops.push({ table: 'combats', op: a.combat ? 'update' : 'insert', key: b.combat.campaign_id, row: b.combat, prev: a.combat });
  // Порядок: сначала родители, удаления детей — до удаления родителей.
  const order = ['campaigns', 'campaign_invites', 'campaign_members', 'characters', 'scenes', 'scene_secrets', 'scene_explored', 'campaign_creatures', 'tokens', 'drawings', 'log_entries', 'log_secrets', 'save_requests', 'portal_requests', 'combats'];
  const rank = (o) => (o.op === 'delete' ? 100 - order.indexOf(o.table) : order.indexOf(o.table));
  return ops.sort((x, y) => rank(x) - rank(y));
}

// ——— Частичная правка токенов (TASK-097 п. 2.5, TASK-173) ———
const TOKEN_COLS = ['scene_id', 'character_id', 'hidden', 'ord', 'owner_id'];
const MOVE_KEYS = new Set(['x', 'y', 'movedAt', 'rot']);

/**
 * Что изменилось в строке токена: cols — изменённые колонки (обычный UPDATE только их), set/unset — поля data
 * для `patch_token`. Двое правят разные поля одного токена — второй не затирает первого (аудит #57, B1).
 */
export function tokenPatch(prev, row) {
  const cols = {};
  for (const k of TOKEN_COLS) if (k in row && !same(prev?.[k] ?? null, row[k] ?? null)) cols[k] = row[k];
  const a = prev?.data || {}, b = row.data || {};
  const set = {}, unset = [];
  for (const [k, v] of Object.entries(b)) if (!same(a[k], v)) set[k] = v;
  for (const k of Object.keys(a)) if (!(k in b)) unset.push(k);
  return { cols, set, unset };
}

/** Правка токена — только место и поворот (x, y, movedAt, rot), без колонок и удалённых полей. */
export function isTokenMove(o) {
  if (o.table !== 'tokens' || o.op !== 'update' || !o.prev) return false;
  const { cols, set, unset } = tokenPatch(o.prev, o.row);
  const keys = Object.keys(set);
  return !Object.keys(cols).length && !unset.length && keys.length > 0 && keys.every((k) => MOVE_KEYS.has(k));
}

/**
 * Сгруппировать перемещения: два и больше токенов одной сцены, сдвинутых одним действием, — одна операция
 * `{op: 'move', scene, moves:[{id, x, y, …}], parts}` для `move_tokens`: при отказе по любому не двигается никто (B5).
 * Группа не делится: больше 50 токенов (предел функции сервера) отправка отклоняет целиком (sync.js).
 * Остальные операции — как были, порядок сохраняется.
 */
export function groupTokenMoves(ops) {
  const out = [], groups = new Map();
  for (const o of ops) {
    if (!isTokenMove(o)) { out.push(o); continue; }
    const scene = o.row.scene_id;
    let g = groups.get(scene);
    if (!g) { g = { table: 'tokens', op: 'move', key: `move:${scene}:${o.key}`, scene, moves: [], parts: [] }; groups.set(scene, g); out.push(g); }
    const { set } = tokenPatch(o.prev, o.row);
    g.moves.push({ id: o.key, ...set });
    g.parts.push(o);
  }
  // Один токен — обычная частичная правка, без лишнего вызова.
  return out.map((o) => (o.op === 'move' && o.parts.length === 1 ? o.parts[0] : o));
}

/**
 * Своё существо на карту (TASK-097 1.2b): вставку снимка campaign_creatures и вставку ссылающегося на него токена
 * той же кампании — одной операцией place (функция place_creature, одна транзакция). Остальное — как было.
 */
export function groupPlacements(ops) {
  const out = [...ops];
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (c.table !== 'campaign_creatures' || c.op !== 'insert') continue;
    const j = out.findIndex((o, k) => k > i && o.table === 'tokens' && o.op === 'insert' && o.row?.campaign_id === c.row.campaign_id
      && o.row?.data?.monsterId === `lib:${c.row.id}`);
    if (j < 0) continue;
    const t = out[j];
    out.splice(j, 1);
    out[i] = { table: 'tokens', op: 'place', key: t.key, creature: c.row, token: t.row, parts: [c, t] };
  }
  return out;
}

/** Применить операции к кэшу строк (оптимистично — до ответа сервера). */
export function applyOps(rows, ops0) {
  // Копии: строки операций собраны из живой кампании, и её дальнейшие правки не должны менять кэш.
  const ops = structuredClone(ops0);
  const map = { campaign_members: 'members', characters: 'characters', scenes: 'scenes', scene_secrets: 'secrets', tokens: 'tokens', drawings: 'drawings', log_entries: 'log', log_secrets: 'logSecrets', save_requests: 'saves', portal_requests: 'portals', campaign_creatures: 'creatures' };
  for (const o of ops) {
    if (o.table === 'campaigns') { rows.campaign = o.row; continue; }
    if (o.table === 'campaign_invites') { rows.invite = o.row; continue; }
    if (o.table === 'combats') { rows.combat = o.row; continue; }
    if (o.table === 'scene_explored' && o.op === 'replace') { rows.explored.set(o.key, { ...o.row, cells: [...o.row.cells] }); continue; }
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
  const map = { campaign_members: 'members', characters: 'characters', scenes: 'scenes', scene_secrets: 'secrets', scene_explored: 'explored', tokens: 'tokens', drawings: 'drawings', log_entries: 'log', log_secrets: 'logSecrets', save_requests: 'saves', portal_requests: 'portals', campaign_creatures: 'creatures' };
  if (table === 'campaigns') { if (type === 'DELETE') rows.campaign = null; else rows.campaign = row; return rows; }
  if (table === 'campaign_invites') { rows.invite = type === 'DELETE' ? null : row; return rows; }
  if (table === 'combats') { rows.combat = type === 'DELETE' ? null : row; return rows; }
  if (table === 'token_secrets') { putTokenSecret(rows, type, row); return rows; }
  if (table === 'scene_hidden') { putSceneHidden(rows, type, row); return rows; }
  const m = rows[map[table]]; if (!m) return rows;
  const k = (keyOf[table] || ((r) => r.id))(row);
  if (table === 'scenes' && type !== 'DELETE') { m.set(k, viewScene(row, { master: rows.master, hidden: rows.sceneHidden.get(k), prev: m.get(k) })); return rows; }
  if (table === 'tokens') {
    if (type === 'DELETE') { m.delete(k); rows.tokenHeld?.delete(k); rows.tokenSecrets?.delete(k); }
    else putToken(rows, row, m.get(k));
    return rows;
  }
  if (type === 'DELETE') m.delete(k); else m.set(k, row);
  return rows;
}

/**
 * Удаления без фильтра по кампании (TASK-168). Realtime не фильтрует DELETE и присылает в событии только первичный
 * ключ, поэтому по подписке с campaign_id=eq.<id> удаления этих таблиц не доходят. Клиент слушает их без фильтра
 * и применяет только своё: ключ удалённой строки уже есть в кэше этой кампании.
 */
export const UNFILTERED_DELETES = ['combat_public', 'characters', 'scenes', 'scene_secrets', 'scene_explored', 'tokens', 'drawings', 'log_entries', 'log_secrets', 'save_requests', 'portal_requests'];
const DELETE_MAP = { characters: 'characters', scenes: 'scenes', scene_secrets: 'secrets', scene_explored: 'explored', tokens: 'tokens', drawings: 'drawings', log_entries: 'log', log_secrets: 'logSecrets', save_requests: 'saves', portal_requests: 'portals' };
const DELETE_KEY = { scene_secrets: 'scene_id', scene_explored: 'scene_id' };
export function ownsDeleted(rows, table, row) {
  const m = rows?.[DELETE_MAP[table]];
  const k = row?.[DELETE_KEY[table] || 'id'];
  return !!m && k != null && m.has(k);
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
  rows.master = !!server.master;
  put(rows.sceneHidden, server.sceneHidden, (r) => r.scene_id);
  for (const s of server.scenes || []) rows.scenes.set(s.id, viewScene(s, { master: rows.master, hidden: rows.sceneHidden.get(s.id) }));
  put(rows.secrets, server.secrets, (r) => r.scene_id);
  put(rows.explored, server.explored, (r) => r.scene_id);
  put(rows.tokenSecrets, server.tokenSecrets, (r) => r.token_id);
  for (const t of server.tokens || []) putToken(rows, t, null);
  put(rows.drawings, server.drawings);
  put(rows.log, server.log);
  put(rows.logSecrets, server.logSecrets);
  put(rows.saves, server.saves);
  put(rows.portals, server.portals);
  // Таблицы снимков ещё нет на сервере — null: кампания грузится без них, вкладка «Мои» за столом недоступна.
  if (server.creatures) { rows.creatures = new Map(); put(rows.creatures, server.creatures); }
  return rows;
}

/** Копия кэша (Map-ы копируются, строки — по ссылке: строки не меняются на месте). */
export function cloneRows(r) {
  const out = { ...r };
  for (const k of Object.keys(r)) if (r[k] instanceof Map) out[k] = new Map(r[k]);
  return out;
}

/** Что игрок поменял в бою относительно своего «до» (base): брошенные инициативы, пройденное, конец хода. */
export function playerCombatDelta(want, base, rows) {
  const tokens = [...rows.tokens.values()];
  const visible = new Set(tokens.filter((t) => !t.hidden).map((t) => t.id));
  const init = {}, moved = {};
  for (const w of want?.entries || []) {
    const b = (base?.entries || []).find((x) => x.tokenId === w.tokenId);
    const v = Number(w.init);
    if (w.init != null && b?.init == null && Number.isFinite(v)) init[w.tokenId] = Math.round(v);
  }
  for (const [id, v] of Object.entries(want?.moved || {})) {
    if (visible.has(id) && v !== base?.moved?.[id] && Number.isFinite(Number(v))) moved[id] = Number(v);
  }
  const ended = want?.ended && want.ended !== base?.ended ? want.ended : null;
  return Object.keys(init).length || Object.keys(moved).length || ended ? { init, moved, ended } : null;
}

/** Новые результаты спасброска игрока: то, чего не было в его «до». */
export function playerSaveResults(o) {
  const was = o.prev?.data?.results || {};
  return Object.fromEntries(Object.entries(o.row?.data?.results || {}).filter(([k]) => !(k in was)));
}
