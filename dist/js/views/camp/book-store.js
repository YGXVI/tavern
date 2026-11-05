// Книга кампании (#203): данные, правки и чтение. Открытое отряду — поле `book` кампании (на сервере — campaigns.data,
// пишет мастер). Записи игроков доходят до книги через журнал (`log`, kind 'book'): игрок пишет свою запись журнала,
// клиент мастера переплетает её в `book`. «Только мастеру» — скрытая запись журнала (текст в log_secrets: мастер и автор).
// Тайное мастера (печати, личные сноски) и личное игрока (ленточки, черновики, дневник) — на устройстве (local.js).
import { getCampaign, updateCampaign, addLog, isMasterOf, characterOf, membership } from '../../core/campaign.js';
import { uid } from '../../core/dom.js';
import { local, updateLocal } from './local.js';

export const ROMAN = (n) => { let s = '', x = Math.max(0, Math.floor(n)); for (const [v, r] of [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]) while (x >= v) { s += r; x -= v; } return s || '0'; };

/** Книга кампании с пустыми значениями по умолчанию (копия — можно править). */
export function bookOf(c) {
  const b = structuredClone(c?.book || {});
  return { chapters: b.chapters || [], threads: b.threads || [], handouts: b.handouts || [], next: b.next || null, session: b.session || null, pen: b.pen || null, rotate: !!b.rotate };
}
export const chapterOf = (book, n) => book.chapters.find((ch) => ch.n === n) || null;
function ensureChapter(book, n, at = Date.now()) {
  let ch = chapterOf(book, n);
  if (!ch) { ch = { n, title: null, startedAt: at, endedAt: null, boundAt: null, inkUntil: null, epigraph: null, entries: [] }; book.chapters.push(ch); book.chapters.sort((a, b) => a.n - b.n); }
  ch.entries ||= [];
  return ch;
}
const findEntry = (book, n, id) => chapterOf(book, n)?.entries.find((e) => e.id === id) || null;

/**
 * Применить правку к книге (на месте). Повтор той же правки ничего не меняет — так клиент мастера может
 * переплетать записи журнала сколько угодно раз. op: entry | margin | agree.
 */
export function applyOp(book, op) {
  if (!op || typeof op !== 'object') return book;
  if (op.op === 'entry' && op.entry?.id && Number.isInteger(op.entry.n)) {
    const e = op.entry;
    const ch = ensureChapter(book, e.n, e.at);
    const i = ch.entries.findIndex((x) => x.id === e.id);
    const clean = pickEntry(e);
    if (i < 0) ch.entries.push(clean);
    else if ((ch.entries[i].rev || 0) < (clean.rev || 0)) ch.entries[i] = { ...clean, margins: ch.entries[i].margins, agree: ch.entries[i].agree, footnotes: ch.entries[i].footnotes };
  }
  if (op.op === 'margin' && op.margin?.id) {
    const e = findEntry(book, op.n, op.entryId);
    if (e && !(e.margins ||= []).some((m) => m.id === op.margin.id)) e.margins.push({ id: op.margin.id, userId: op.margin.userId, quote: String(op.margin.quote || '').slice(0, 300), text: String(op.margin.text || '').slice(0, 400), at: op.margin.at || Date.now() });
  }
  if (op.op === 'agree' && op.userId) {
    const e = findEntry(book, op.n, op.entryId);
    if (e && !(e.agree ||= []).includes(op.userId)) e.agree.push(op.userId);
  }
  return book;
}
const LIM = { title: 140, text: 12000 };
function pickEntry(e) {
  const out = { id: e.id, n: e.n, userId: e.userId || null, kind: e.kind || 'voice', voice: e.voice === 'hero' ? 'hero' : 'self', title: String(e.title || '').slice(0, LIM.title), text: String(e.text || '').slice(0, LIM.text), at: e.at || Date.now(), rev: e.rev || 1 };
  if (e.heroId) out.heroId = e.heroId;
  if (e.ribbon) out.ribbon = { at: e.ribbon.at, place: String(e.ribbon.place || '').slice(0, 80), text: String(e.ribbon.text || '').slice(0, 300) };
  if (e.variantOf) out.variantOf = e.variantOf;
  if (e.sealed) out.sealed = e.sealed;
  for (const k of ['margins', 'agree', 'footnotes']) if (e[k]) out[k] = e[k];
  return out;
}

/** Правки книги из журнала: [{logId, at, userId, hidden, op}] — открытые и (для автора и мастера) «только мастеру». */
export function bookOps(c) {
  const out = [];
  for (const l of c?.log || []) {
    if (l.kind !== 'book' || l.redacted || !l.text) continue;
    let op = null;
    try { op = JSON.parse(l.text); } catch { continue; }
    if (!op || typeof op !== 'object') continue;
    if (op.entry) op.entry = { ...op.entry, userId: l.userId };
    if (op.margin) op.margin = { ...op.margin, userId: l.userId };
    if (op.op === 'agree') op.userId = l.userId;
    out.push({ logId: l.id, at: l.at, userId: l.userId, hidden: !!(l.hidden || (l.vis && l.vis !== 'all')), op });
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * Книга глазами участника: открытое из кампании + ещё не переплетённые записи журнала + своё с устройства.
 * Мастер видит входящие «только мастеру» и содержимое печатей; автор — свои закрытые записи.
 */
export function readBook(c, userId) {
  const book = bookOf(c);
  const master = isMasterOf(c, userId);
  const ops = bookOps(c);
  for (const o of ops) if (!o.hidden) applyOp(book, o.op);
  const mark = (e, flag) => { const ch = ensureChapter(book, e.n, e.at); if (!ch.entries.some((x) => x.id === e.id)) ch.entries.push({ ...pickEntry(e), [flag]: true }); };
  for (const o of ops) if (o.hidden && o.op.op === 'entry' && (master || o.userId === userId)) mark(o.op.entry, 'onlyMaster');
  if (master) {
    const sec = local('secret', c.id, userId);
    for (const e of Object.values(sec.inbox || {})) if (!findEntry(book, e.n, e.id)) mark(e, 'onlyMaster');
    for (const ch of book.chapters) for (const e of ch.entries) if (e.kind === 'sealed' && sec.sealed?.[e.id]) e.secret = sec.sealed[e.id];
    for (const ch of book.chapters) for (const e of ch.entries) if (sec.notes?.[e.id]) e.myNotes = sec.notes[e.id];
  }
  const mine = local('mine', c.id, userId);
  for (const e of mine.diary || []) mark(e, 'diary');
  for (const ch of book.chapters) ch.entries.sort((a, b) => (a.ribbon?.at || a.at) - (b.ribbon?.at || b.at));
  return book;
}

// ——— Запись ———
/** Внести запись в книгу. vis: all — отряду, master — только мастеру, me — только себе (на устройстве). */
export function writeEntry(cid, userId, entry, vis = 'all') {
  const c = getCampaign(cid); if (!c) return;
  const e = { ...entry, id: entry.id || uid('be-'), at: entry.at || Date.now(), rev: (entry.rev || 0) + 1, userId };
  if (vis === 'me') { updateLocal('mine', cid, userId, (m) => { m.diary = (m.diary || []).filter((x) => x.id !== e.id); m.diary.push(e); delete m.drafts[e.id]; }); return e; }
  updateLocal('mine', cid, userId, (m) => { m.diary = (m.diary || []).filter((x) => x.id !== e.id); delete m.drafts[e.id]; });
  if (isMasterOf(c, userId) && vis !== 'master') {
    updateCampaign(cid, (cc) => { const b = bookOf(cc); applyOp(b, { op: 'entry', entry: e }); cc.book = { ...cc.book, chapters: b.chapters }; });
    return e;
  }
  const { userId: _u, ...payload } = e;
  updateCampaign(cid, (cc) => addLog(cc, { kind: 'book', userId, text: JSON.stringify({ op: 'entry', entry: payload }), ...(vis === 'master' ? { vis: 'gm', hidden: true } : {}) }));
  return e;
}
/** Пометка на полях: видна всем, кто читает главу. */
export function addMargin(cid, userId, n, entryId, quote, text) {
  const c = getCampaign(cid); if (!c) return;
  const margin = { id: uid('bm-'), quote, text, at: Date.now() };
  if (isMasterOf(c, userId)) { updateCampaign(cid, (cc) => { const b = bookOf(cc); applyOp(b, { op: 'margin', n, entryId, margin: { ...margin, userId } }); cc.book = { ...cc.book, chapters: b.chapters }; }); return; }
  updateCampaign(cid, (cc) => addLog(cc, { kind: 'book', userId, text: JSON.stringify({ op: 'margin', n, entryId, margin }) }));
}
/** «Помню так же» — согласиться с чужой версией момента. */
export function agreeWith(cid, userId, n, entryId) {
  const c = getCampaign(cid); if (!c) return;
  if (isMasterOf(c, userId)) { updateCampaign(cid, (cc) => { const b = bookOf(cc); applyOp(b, { op: 'agree', n, entryId, userId }); cc.book = { ...cc.book, chapters: b.chapters }; }); return; }
  updateCampaign(cid, (cc) => addLog(cc, { kind: 'book', userId, text: JSON.stringify({ op: 'agree', n, entryId }) }));
}

// ——— Мастер ———
/** Изменить книгу кампании (только мастер; на сервере игроку запись кампании не разрешена). */
export function mutateBook(cid, fn) {
  return updateCampaign(cid, (c) => { const b = bookOf(c); const r = fn(b, c); c.book = b; return r; });
}

/**
 * Клиент мастера переплетает записи игроков из журнала в книгу, забирает «только мастеру» на устройство
 * и ломает печати, чьё время пришло. Повторный вызов без новых записей ничего не пишет.
 */
let folding = false;
export function foldInbox(cid, userId) {
  const c = getCampaign(cid);
  if (folding || !c || !isMasterOf(c, userId)) return false;
  folding = true;
  try {
    const ops = bookOps(c);
    const hidden = ops.filter((o) => o.hidden && o.op.op === 'entry');
    if (hidden.length) {
      const sec = local('secret', cid, userId);
      const fresh = hidden.filter((o) => !sec.inbox?.[o.op.entry.id] || (sec.inbox[o.op.entry.id].rev || 0) < (o.op.entry.rev || 0));
      if (fresh.length) updateLocal('secret', cid, userId, (s) => { for (const o of fresh) s.inbox[o.op.entry.id] = { ...o.op.entry, userId: o.userId }; });
    }
    const before = bookOf(c);
    const after = bookOf(c);
    for (const o of ops) if (!o.hidden) applyOp(after, o.op);
    breakDueSeals(c, after, userId);
    if (JSON.stringify(before) !== JSON.stringify(after)) { updateCampaign(cid, (cc) => { cc.book = after; }); return true; }
    return false;
  } finally { folding = false; }
}

/** Печати: пора ли ломать (вход в сцену, начало главы). Возвращает сломанные. */
function breakDueSeals(c, book, userId) {
  const sec = local('secret', c.id, userId);
  const broken = [];
  const curN = book.session && !book.session.endedAt ? book.session.n : null;
  for (const ch of book.chapters) for (const [i, e] of ch.entries.entries()) {
    if (e.kind !== 'sealed' || e.sealed?.brokenAt) continue;
    const on = e.sealed?.breakOn || '';
    const due = (on.startsWith('scene:') && on.slice(6) === c.activeSceneId) || (on.startsWith('chapter:') && curN && Number(on.slice(8)) <= curN);
    const full = sec.sealed?.[e.id];
    if (due && full) { ch.entries[i] = { ...pickEntry(full), id: e.id, n: ch.n, sealed: { ...e.sealed, brokenAt: Date.now() } }; broken.push(ch.entries[i]); }
  }
  return broken;
}

/** Сломать печать сейчас (мастер). */
export function breakSeal(cid, userId, n, id) {
  const sec = local('secret', cid, userId);
  const full = sec.sealed?.[id];
  if (!full) return false;
  mutateBook(cid, (b) => { const ch = chapterOf(b, n); const i = ch?.entries.findIndex((e) => e.id === id) ?? -1; if (i >= 0) ch.entries[i] = { ...pickEntry(full), id, n, sealed: { ...ch.entries[i].sealed, brokenAt: Date.now() } }; });
  return true;
}

/** Запечатать запись в главу: отряд видит печать на месте записи, текст — только на устройстве мастера. */
export function sealEntry(cid, userId, entry, breakOn, label) {
  const id = entry.id || uid('be-');
  updateLocal('secret', cid, userId, (s) => { s.sealed[id] = { ...entry, id }; delete s.inbox[entry.id]; });
  mutateBook(cid, (b) => {
    const ch = ensureChapter(b, entry.n);
    ch.entries = ch.entries.filter((e) => e.id !== id);
    ch.entries.push({ id, n: entry.n, kind: 'sealed', userId: entry.userId || null, at: entry.ribbon?.at || entry.at || Date.now(), rev: 1, title: '', text: '', sealed: { breakOn, label: label || '', at: Date.now() } });
  });
}

/** Начать игру: открыть сессию и главу. */
export function startSession(cid) {
  return mutateBook(cid, (b) => {
    if (b.session && !b.session.endedAt) return b.session.n;
    const last = b.chapters.at(-1);
    const n = last && !last.endedAt && !last.boundAt ? last.n : (last?.n || 0) + 1;
    const ch = ensureChapter(b, n);
    ch.startedAt ||= Date.now();
    if (b.pen?.n === n) ch.pen = b.pen.userId;
    b.session = { n, startedAt: Date.now(), endedAt: null };
    return n;
  });
}
/** Передать перо: кто летописец главы n. */
export function setPen(cid, userId, n, rotate) {
  return mutateBook(cid, (b) => {
    b.pen = { userId, n };
    if (rotate !== undefined) b.rotate = !!rotate;
    const ch = chapterOf(b, n); if (ch && !ch.boundAt) ch.pen = userId;
  });
}
/** Кто держал перо: userId → номера глав. */
export function penHistory(book) {
  const m = new Map();
  for (const ch of book.chapters) if (ch.pen) { if (!m.has(ch.pen)) m.set(ch.pen, []); m.get(ch.pen).push(ch.n); }
  return m;
}
/** Завершить сессию: глава закрыта на столе, чернила сохнут до следующей игры. */
export function endSession(cid) {
  return mutateBook(cid, (b) => {
    const s = b.session; if (!s || s.endedAt) return null;
    s.endedAt = Date.now();
    const ch = ensureChapter(b, s.n);
    ch.endedAt = s.endedAt;
    ch.inkUntil = b.next?.at && b.next.at > s.endedAt ? b.next.at : s.endedAt + 7 * 86400000;
    return s.n;
  });
}
export const sessionLive = (book) => !!(book.session && !book.session.endedAt);
/** Можно ли ещё править записи главы. */
export const inkWet = (ch, now = Date.now()) => !!ch && !(ch.inkUntil && ch.inkUntil <= now);

// ——— Указатель ———
const MENTION = /@\[([^\]\n]{1,60})\]|@([\p{L}][\p{L}\d-]{1,30})/gu;
export function mentionsIn(text) { const out = []; for (const m of String(text || '').matchAll(MENTION)) out.push((m[1] || m[2]).trim()); return out; }
/** Указатель книги: имена, места и вещи по упоминаниям @ в записях. */
export function bookIndex(book, c) {
  const heroes = new Set((c?.characters || []).map((h) => h.name.toLowerCase()));
  const scenes = (c?.scenes || []).map((s) => s.name.toLowerCase());
  const map = new Map();
  for (const ch of book.chapters) for (const e of ch.entries) {
    if (e.kind === 'sealed' && !e.sealed?.brokenAt) continue;
    for (const name of mentionsIn(`${e.title}\n${e.text}`)) {
      const key = name.toLowerCase();
      if (!map.has(key)) map.set(key, { name, kind: heroes.has(key) ? 'hero' : scenes.some((s) => s.includes(key) || key.includes(s)) ? 'place' : 'name', refs: [] });
      const quote = String(e.text).split(/(?<=[.!?…])\s+/).find((s) => s.toLowerCase().includes(`@${key}`) || s.toLowerCase().includes(`@[${key}`)) || e.title;
      map.get(key).refs.push({ n: ch.n, entryId: e.id, userId: e.userId, quote: quote.replace(MENTION, (m, a, b) => a || b) });
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

// ——— Помощники ———
export function heroOfUser(c, userId) { const m = membership(c, userId); return m?.characterId ? characterOf(c, m.characterId) : null; }
export function voiceLabel(c, e, chapter) {
  const hero = e.heroId ? characterOf(c, e.heroId) : null;
  if (e.kind === 'master' || e.kind === 'chronicle') return 'хроника';
  if (chapter?.pen && e.userId === chapter.pen) return 'летописец';
  return e.voice === 'hero' && hero ? 'от лица героя' : 'от себя';
}
/** Дата по-человечески: «8 ноября» или «суббота, 8 ноября, 19:00». */
export function fmtDate(ts, { time = false, weekday = false } = {}) {
  if (!ts) return '';
  const d = new Date(ts);
  const s = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(weekday ? { weekday: 'long' } : {}) });
  return time ? `${s}, ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : s;
}
export const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '');
const CITY = { 'Asia/Dushanbe': 'Душанбе', 'Europe/Moscow': 'Москве', 'Asia/Tashkent': 'Ташкенту', 'Asia/Almaty': 'Алматы', 'Europe/Kyiv': 'Киеву', 'Europe/Kiev': 'Киеву', 'Europe/Minsk': 'Минску', 'Asia/Yekaterinburg': 'Екатеринбургу', 'Asia/Novosibirsk': 'Новосибирску', 'Europe/Berlin': 'Берлину' };
export const tzCity = () => { try { return CITY[Intl.DateTimeFormat().resolvedOptions().timeZone] || ''; } catch { return ''; } };
export const newId = (p) => uid(p);
