// Книга кампании (#203): общий блокнот. Любой участник пишет заметку, заметка — блоки «заголовок / текст / цитата».
// Глав, сессий и пера у книги нет. Открытое — поле `book` кампании (на сервере — campaigns.data, пишет мастер).
// Заметки игроков доходят до книги через журнал (`log`, kind 'book'): игрок пишет запись журнала, клиент мастера
// переносит её в `book.notes`. Пока мастер не зашёл, заметку уже видят все — она читается прямо из журнала.
// Рядом в `book` лежат данные дома кампании, к блокноту не привязанные: дата игры, идёт ли игра, раздатки.
import { getCampaign, updateCampaign, addLog, isMasterOf, characterOf, membership, userById } from '../../core/campaign.js';
import { uid } from '../../core/dom.js';

export const BLOCK_TYPES = ['h', 'p', 'q']; // заголовок, текст, цитата
const LIM = { block: 6000, blocks: 40, gone: 500 };

/** Книга кампании с пустыми значениями по умолчанию (копия — можно править). */
export function bookOf(c) {
  const b = structuredClone(c?.book || {});
  return {
    notes: Array.isArray(b.notes) ? b.notes : [], gone: Array.isArray(b.gone) ? b.gone : [],
    handouts: b.handouts || [], next: b.next || null, session: b.session || null,
    // Сыгранные сессии; у кампаний до блокнота их считали по главам.
    played: b.played || (Array.isArray(b.chapters) ? b.chapters.filter((ch) => ch?.startedAt).length : 0),
  };
}

/** Блоки заметки: только известные типы, без пустых, с ограничением длины. */
export function cleanBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .map((x) => ({ type: BLOCK_TYPES.includes(x?.type) ? x.type : 'p', text: String(x?.text ?? '').replace(/\r/g, '').slice(0, LIM.block) }))
    .filter((x) => x.text.trim())
    .slice(0, LIM.blocks);
}

/**
 * Применить правку к книге (на месте). Повтор той же правки ничего не меняет — клиент мастера может
 * переносить записи журнала сколько угодно раз. Чужую заметку игрок не правит и не удаляет; мастер удаляет любую.
 * op: { op: 'note', note: {id, at, rev, blocks} } | { op: 'del', id }. by — автор правки, master — правит мастер.
 */
export function applyOp(book, op, by, master = false) {
  if (!op || typeof op !== 'object' || !by) return book;
  if (op.op === 'note' && op.note?.id) {
    const n = op.note;
    if (book.gone.includes(n.id)) return book;
    const blocks = cleanBlocks(n.blocks);
    const i = book.notes.findIndex((x) => x.id === n.id);
    if (i < 0) { if (blocks.length) book.notes.push({ id: n.id, userId: by, at: n.at || Date.now(), rev: n.rev || 1, blocks }); }
    else if (book.notes[i].userId === by && (book.notes[i].rev || 0) < (n.rev || 1) && blocks.length) {
      book.notes[i] = { ...book.notes[i], rev: n.rev, blocks, edited: n.edited || Date.now() };
    }
  }
  if (op.op === 'del' && op.id) {
    const x = book.notes.find((y) => y.id === op.id);
    if (x && x.userId !== by && !master) return book;
    book.notes = book.notes.filter((y) => y.id !== op.id);
    if (!book.gone.includes(op.id)) book.gone = [...book.gone, op.id].slice(-LIM.gone);
  }
  return book;
}

/** Правки книги из журнала: [{logId, at, userId, op}] — от старых к новым. Автор — из записи журнала, не из текста. */
export function bookOps(c) {
  const out = [];
  for (const l of c?.log || []) {
    if (l.kind !== 'book' || l.redacted || l.hidden || !l.text || !l.userId) continue;
    let op = null;
    try { op = JSON.parse(l.text); } catch { continue; }
    if (!op || typeof op !== 'object' || (op.op !== 'note' && op.op !== 'del')) continue;
    out.push({ logId: l.id, at: l.at, userId: l.userId, op });
  }
  return out.sort((a, b) => a.at - b.at);
}

function withLog(c) {
  const book = bookOf(c);
  for (const o of bookOps(c)) applyOp(book, o.op, o.userId, isMasterOf(c, o.userId));
  book.notes.sort((a, b) => a.at - b.at);
  return book;
}
/** Книга глазами участника: открытое из кампании + заметки из журнала, которые мастер ещё не перенёс. */
export const readBook = (c) => withLog(c);

// ——— Запись ———
/** Вписать новую заметку или поправить свою. Возвращает заметку. */
export function writeNote(cid, userId, { id, rev = 0, blocks }) {
  const c = getCampaign(cid); if (!c) return null;
  const clean = cleanBlocks(blocks);
  if (!clean.length) return null;
  const note = { id: id || uid('bn-'), at: Date.now(), rev: rev + 1, blocks: clean, ...(id ? { edited: Date.now() } : {}) };
  if (id) { const old = readBook(c).notes.find((x) => x.id === id); if (old) note.at = old.at; }
  send(c, userId, { op: 'note', note });
  return note;
}
/** Удалить заметку: свою — любой, чужую — только мастер. */
export function deleteNote(cid, userId, id) {
  const c = getCampaign(cid); if (!c) return;
  send(c, userId, { op: 'del', id });
}
function send(c, userId, op) {
  if (isMasterOf(c, userId)) { updateCampaign(c.id, (cc) => { const b = bookOf(cc); applyOp(b, op, userId, true); cc.book = { ...cc.book, notes: b.notes, gone: b.gone }; }); return; }
  updateCampaign(c.id, (cc) => addLog(cc, { kind: 'book', userId, text: JSON.stringify(op) }));
}
export const canEdit = (note, userId) => note.userId === userId;
export const canDelete = (c, note, userId) => note.userId === userId || isMasterOf(c, userId);

// ——— Мастер ———
/** Изменить книгу кампании (только мастер; на сервере игроку запись кампании не разрешена). */
export function mutateBook(cid, fn) {
  return updateCampaign(cid, (c) => { const b = bookOf(c); const r = fn(b, c); c.book = { ...c.book, ...b }; return r; });
}

/** Клиент мастера переносит заметки игроков из журнала в книгу — журнал хранит только последние записи. */
let folding = false;
export function foldInbox(cid, userId) {
  const c = getCampaign(cid);
  if (folding || !c || !isMasterOf(c, userId)) return false;
  folding = true;
  try {
    const before = bookOf(c), after = withLog(c);
    if (JSON.stringify(before.notes) === JSON.stringify(after.notes) && JSON.stringify(before.gone) === JSON.stringify(after.gone)) return false;
    updateCampaign(cid, (cc) => { cc.book = { ...cc.book, notes: after.notes, gone: after.gone }; });
    return true;
  } finally { folding = false; }
}

// ——— Игра (дом кампании, к блокноту не относится) ———
/** Начать игру: отметить, что сессия идёт. Возвращает номер сессии. */
export function startSession(cid) {
  return mutateBook(cid, (b) => {
    if (b.session && !b.session.endedAt) return b.session.n;
    b.played = (b.played || 0) + 1;
    b.session = { n: b.played, startedAt: Date.now(), endedAt: null };
    return b.played;
  });
}
/** Завершить сессию. */
export function endSession(cid) {
  return mutateBook(cid, (b) => { const s = b.session; if (!s || s.endedAt) return null; s.endedAt = Date.now(); return s.n; });
}
export const sessionLive = (book) => !!(book.session && !book.session.endedAt);

// ——— Помощники ———
export function heroOfUser(c, userId) { const m = membership(c, userId); return m?.characterId ? characterOf(c, m.characterId) : null; }
/** Подпись автора: мастер — «Мастер», игрок — имя героя, иначе ник. */
export function authorName(c, userId) {
  if (isMasterOf(c, userId)) return 'Мастер';
  return heroOfUser(c, userId)?.name || userById(userId)?.name || 'Игрок';
}
export const authorColor = (c, userId) => (isMasterOf(c, userId) ? 'hsl(38 70% 42%)' : `hsl(${userById(userId)?.hue ?? 30} 48% 42%)`);
/** Короткий пересказ заметки: заголовок или начало текста. */
export function noteSummary(note, max = 160) {
  const h = note?.blocks?.find((x) => x.type === 'h')?.text?.trim();
  const t = (note?.blocks || []).filter((x) => x.type !== 'h').map((x) => x.text).join(' ').replace(/\s+/g, ' ').trim();
  const cut = (s) => (s.length > max ? `${s.slice(0, max).replace(/\s+\S*$/, '')}…` : s);
  return { title: h ? cut(h) : '', text: cut(t) };
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
