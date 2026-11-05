// Книга кампании на столе (#203, макеты 33, 34, 38): ленточка «заложить момент», «глава закрыта на столе»,
// переплёт записей клиентом мастера и действия из дома кампании по адресу #/c/<кампания>/do/<действие>/….
import { el, esc, uid } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { subscribe } from '../../core/store.js';
import { characterOf } from '../../core/campaign.js';
import { modal, popover, closePopover } from '../../ui/kit.js';
import { cellOf, freeSpots, gridSize } from '../../rules/geometry.js';
import { monsterToken } from '../../data/demo.js';
import { monsterById, loadSrdBestiary } from '../../data/bestiary.js';
import { nextTokenName } from '../../core/campaign.js';
import { sizeById } from '../../data/rules.js';
import { readBook, foldInbox, startSession, ROMAN, fmtDate, newId } from '../camp/book-store.js';
import { local, updateLocal } from '../camp/local.js';
import { encounterById } from '../camp/encounters.js';
import { go } from '../screens.js';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const hhmm = (t) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export function mountBookHooks(ctx) {
  const offs = [];
  let lastSession = ctx.c?.book?.session ? { ...ctx.c.book.session } : null;

  // ——— Ленточка ———
  const tab = el(`<button class="bk-tab-ribbon" aria-label="Заложить момент в книгу" data-tip="Заложить момент в книгу · Б"><span>${icon('plus-sign', 12)}</span></button>`);
  ctx.root.append(tab);
  const place = () => {
    const sc = ctx.scene; if (!sc) return { text: '', sceneId: null };
    const me = sc.tokens.find((t) => t.characterId && t.characterId === ctx.myCharacterId);
    let cell = '';
    if (me) { const { c, r } = cellOf(sc.grid, me.x, me.y); cell = `${LETTERS[c % 26] || '?'}${r + 1}`; }
    return { text: `${sc.name}${cell ? ` · клетка ${cell}` : ''}`, sceneId: sc.id };
  };
  const sessionN = () => { const s = ctx.c?.book?.session; return s && !s.endedAt ? s.n : null; };
  function openRibbon() {
    const now = Date.now(), p = place();
    const list = (local('mine', ctx.cid, ctx.userId).ribbons || []).filter((r) => (sessionN() ? r.n === sessionN() : now - r.at < 12 * 3600000)).slice(-4);
    const pop = popover(`<div class="bk-ribbon-pop"><small class="bk-caps red">заложить момент</small>
      <p class="bk-rp-meta">${icon('location-01', 14)}${esc(hhmm(now))}${p.text ? ` · ${esc(p.text)}` : ''}</p>
      <textarea rows="2" maxlength="300" placeholder="Что случилось — в двух словах"></textarea>
      <p class="bk-rp-note">${icon('view', 12)}Видишь только ты — пока не впишешь в книгу</p>
      ${list.length ? `<hr><small class="bk-caps">раньше в этой сессии</small>${list.map((r) => `<p class="bk-rp-row"><i></i><b>${esc(hhmm(r.at))}</b>${esc(r.text)}</p>`).join('')}` : ''}
      <div class="bk-rp-foot"><button class="btn btn-primary btn-sm" data-ok>Заложить</button><small>Enter · Esc — закрыть</small></div></div>`, tab, { placement: 'bottom', className: 'bk-ribbon-popover' });
    const ta = pop.node.querySelector('textarea');
    setTimeout(() => ta.focus(), 20);
    const ok = () => {
      const text = ta.value.trim(); if (!text) { ta.focus(); return; }
      updateLocal('mine', ctx.cid, ctx.userId, (m) => { m.ribbons = [...(m.ribbons || []), { id: newId('rb-'), at: now, text, place: p.text, sceneId: p.sceneId, n: sessionN() }].slice(-200); });
      pop.close();
      ctx.toast({ title: 'Ленточка заложена', body: 'После игры из неё вырастет ваша версия главы', icon: 'sticky-note-01' });
    };
    pop.node.querySelector('[data-ok]').addEventListener('click', ok);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ok(); } if (e.key === 'Escape') { e.preventDefault(); closePopover(); } });
  }
  tab.addEventListener('click', openRibbon);
  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') { e.preventDefault(); import('../ref/table-ref.js').then((m) => m.openTableReference(ctx)); return; }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Comma' && !document.querySelector('.modal-root, .ref-pal-root')) { e.preventDefault(); openRibbon(); }
  };
  addEventListener('keydown', onKey);

  // ——— Сессия: началась, закончилась ———
  function sessionChanged() {
    const s = ctx.c?.book?.session || null;
    const was = lastSession; lastSession = s ? { ...s } : null;
    if (!s) return;
    if (s.endedAt && (!was || !was.endedAt) && Date.now() - s.endedAt < 10 * 60000) closedModal(s);
    else if (!s.endedAt && (!was || was.n !== s.n || was.endedAt) && !ctx.isMaster) ctx.toast({ title: `Глава ${ROMAN(s.n)} началась`, body: 'Закладывайте ленточки — из них вырастет ваша версия', icon: 'book-open-01' });
  }
  function closedModal(s) {
    const seenKey = `rasputye-chapter-seen:${ctx.cid}:${s.n}`;
    try { if (sessionStorage.getItem(seenKey)) return; sessionStorage.setItem(seenKey, '1'); } catch { /* */ }
    if (ctx.isMaster) { ctx.toast({ title: `Глава ${ROMAN(s.n)} закрыта на столе`, body: 'Переплетите её в книге, когда игроки впишут свои версии', icon: 'book-open-01', action: { label: 'Книга', onClick: () => go(`#/camp/${ctx.cid}/book`) } }); return; }
    const c = ctx.c, book = readBook(c, ctx.userId);
    const ch = book.chapters.find((x) => x.n === s.n);
    const mine = (local('mine', ctx.cid, ctx.userId).ribbons || []).filter((r) => r.n === s.n);
    const penId = ch?.pen || (book.pen?.n === s.n ? book.pen.userId : null);
    const penM = c.members.find((m) => m.userId === penId);
    const pen = penM?.characterId ? characterOf(c, penM.characterId)?.name : null;
    const m = modal(`<div class="bk-closed"><i class="bk-closed-ribbons"><b></b><b></b><b></b></i>
      <small class="bk-caps gold">мастер завершил сессию · ${esc(hhmm(s.endedAt))}</small>
      <h2>Глава ${ROMAN(s.n)} закрыта на столе</h2>
      <p class="bk-closed-sub">Имя главе даст мастер, когда переплетёт её. А пока — её пишут все.</p>
      ${mine.length ? `<div class="bk-closed-list"><small class="bk-caps red">твои ленточки · ${mine.length} <span>— из них вырастет твоя версия</span></small>${mine.map((r) => `<p><i></i><b>${esc(hhmm(r.at))}</b>${esc(r.text)}</p>`).join('')}</div>` : '<p class="bk-closed-sub">Ленточек в этот раз не было — но версию можно написать и по памяти.</p>'}
      ${pen ? `<p class="bk-closed-line">${icon('pencil-edit-02', 14)}Летописец главы — ${esc(pen)}. Твоя версия ляжет рядом с его.</p>` : ''}
      <p class="bk-closed-line">${icon('droplet', 14)}Чернила сохнут до ${ch?.inkUntil ? esc(fmtDate(ch.inkUntil, { time: true })) : 'следующей игры'}</p>
      <div class="row"><button class="btn btn-primary" data-write>Вписать свою версию</button><button class="btn bk-btn-ghostdark" data-later>Позже — напомню перед игрой</button></div></div>`, { className: 'bk-closed-modal' });
    m.box.querySelector('[data-write]').addEventListener('click', () => { m.close(); go(`#/camp/${ctx.cid}/book/write`); });
    m.box.querySelector('[data-later]').addEventListener('click', () => { updateLocal('mine', ctx.cid, ctx.userId, (x) => { x.later = s.n; }); m.close(); });
  }

  // Мастер переплетает присланные записи игроков и ломает печати, чьё время пришло (вход в сцену).
  const fold = () => { if (ctx.isMaster) foldInbox(ctx.cid, ctx.userId); };
  offs.push(subscribe(() => { sessionChanged(); fold(); }));
  fold();

  // ——— Действия из дома кампании ———
  function fromHash() {
    const m = location.hash.match(/^#\/c\/([^/]+)\/do\/([a-z-]+)(?:\/([^/?#]+))?(?:\/([^/?#]+))?/);
    if (!m || m[1] !== ctx.cid) return;
    const [, , act, a, b] = m;
    const arg = a ? decodeURIComponent(a) : null;
    history.replaceState(null, '', `#/c/${ctx.cid}`);
    if (!ctx.isMaster) return;
    run(act, arg, b).catch((err) => ctx.toast({ title: 'Не получилось', body: err.message || String(err), icon: 'alert-circle' }));
  }
  async function run(act, arg, b) {
    const P = await import('./p-side.js');
    if (act === 'scenes') ctx.panels.toggleSide('scenes');
    if (act === 'new-scene') P.newSceneModal(ctx);
    if (act === 'edit' && arg) { ctx.switchScene(arg); ctx.toast({ title: 'Вы смотрите сцену', body: 'Игроки её не видят, пока вы её не покажете', icon: 'view' }); }
    if (act === 'show' && arg) P.activateScene(ctx, arg);
    if (act === 'start') {
      const n = startSession(ctx.cid);
      if (arg && arg !== ctx.c.activeSceneId) P.activateScene(ctx, arg); else if (arg) ctx.switchScene(arg);
      ctx.toast({ title: `Глава ${ROMAN(n)} началась`, body: 'Игроки увидят, что сессия идёт', icon: 'play' });
    }
    if (act === 'place' && arg) await placeMonsters(ctx, [{ id: arg, count: 1 }], { hidden: true });
    if (act === 'encounter' && arg) {
      const enc = encounterById(ctx.cid, ctx.userId, arg);
      if (!enc) { ctx.toast({ title: 'Встреча не найдена', body: 'Встречи хранятся на устройстве, где их собрали', icon: 'alert-circle' }); return; }
      if (enc.sceneId && enc.sceneId !== ctx.sceneId && ctx.c.scenes.some((s) => s.id === enc.sceneId)) ctx.switchScene(enc.sceneId);
      const ids = await placeMonsters(ctx, enc.monsters, { hidden: enc.opts?.hidden !== false, label: enc.name });
      if (ids.length && (b === 'fight' || enc.opts?.combat)) ctx.panels.combatToggle(ids);
    }
  }
  return { fromHash, unmount() { for (const off of offs) off(); removeEventListener('keydown', onKey); tab.remove(); } };
}

/** Поставить существ из бестиария на текущую сцену у центра экрана. Возвращает id новых токенов. */
async function placeMonsters(ctx, rows, { hidden = true, label = '' } = {}) {
  await loadSrdBestiary().catch(() => null);
  const sc0 = ctx.scene; if (!sc0) { ctx.toast({ title: 'Сначала создайте сцену', icon: 'maps' }); return []; }
  const { viewCenter, commitCreatures } = await import('./p-side.js');
  const sceneId = ctx.sceneId;
  const at = viewCenter(ctx);
  const sc = structuredClone(sc0);
  const g = sc.grid, s = gridSize(g);
  const made = [];
  for (const row of rows) {
    const m = monsterById(row.id); if (!m) continue;
    const n = sizeById(m.size).cells;
    for (const p of freeSpots(sc, at, row.count, n)) {
      const c0 = Math.round((p.x - (g.offsetX || 0)) / s - n / 2), r0 = Math.round((p.y - (g.offsetY || 0)) / s - n / 2);
      const t = monsterToken(m.id, nextTokenName(sc, m.name), c0, r0, { ...g, size: s }, { hidden }, m);
      sc.tokens.push(t); made.push(t);
    }
  }
  if (!made.length) return [];
  await commitCreatures(ctx, sceneId, made, null, {
    label: label || 'Существа',
    undo: (x) => { const ids = new Set(made.map((t) => t.id)); x.tokens = x.tokens.filter((t) => !ids.has(t.id)); },
    redo: (x) => { for (const t of made) x.tokens.push(structuredClone(t)); },
  });
  ctx.select?.(made.map((t) => t.id));
  ctx.toast({ title: `На карте: ${label ? `«${label}» · ` : ''}${made.length} ${made.length === 1 ? 'существо' : made.length < 5 ? 'существа' : 'существ'}`, body: hidden ? 'Скрыто от игроков — откройте, когда придёт время' : 'Игроки видят, если в обзоре героев', icon: 'monster' });
  return made.map((t) => t.id);
}

/** Карточка «Ранее в кампании» для игрока, пока мастер готовит сцену (макет 38). Пустая строка — книги ещё нет. */
export function previouslyCard(c, userId) {
  const book = readBook(c, userId);
  const ch = [...book.chapters].reverse().find((x) => x.endedAt && x.entries.some((e) => e.text));
  if (!ch) return '';
  const pickE = ch.entries.find((e) => ch.pen && e.userId === ch.pen && e.text) || ch.entries.find((e) => e.text && !e.diary && !e.onlyMaster);
  const text = String(pickE?.text || '').replace(/^>.*$/gm, '').replace(/@\[([^\]]+)\]/g, '$1').replace(/@(\S+)/g, '$1').replace(/\s+/g, ' ').trim().slice(0, 300);
  const pen = book.pen?.userId ? c.members.find((m) => m.userId === book.pen.userId) : null;
  const penName = pen?.characterId ? characterOf(c, pen.characterId)?.name : null;
  const threads = book.threads.filter((t) => !t.closed).slice(0, 3);
  return `<div class="bk-prev panel"><i class="bk-bookmark"></i><small class="bk-caps red">ранее в «${esc(c.name)}» · глава ${ROMAN(ch.n)}</small>
    <h2>${esc(ch.title || `Глава ${ROMAN(ch.n)}`)}</h2>
    ${ch.epigraph ? `<blockquote>«${esc(ch.epigraph.text)}»</blockquote>` : ''}
    ${text ? `<p>${esc(text)}${text.length >= 300 ? '…' : ''}</p>` : ''}
    ${threads.length ? `<small class="bk-caps">нити, которые тянутся</small>${threads.map((t) => `<p class="bk-prev-thread"><span>∿</span>${esc(t.title)} <small>с главы ${ROMAN(t.opened || 1)}</small></p>`).join('')}` : ''}
    <div class="bk-prev-foot">${penName ? `<small>${icon('pencil-edit-02', 14)}Сегодня перо — ${esc(penName)}</small>` : '<span></span>'}<a class="btn btn-sm bk-btn-dark" href="#/camp/${esc(c.id)}/book/ch/${ch.n}">Открыть главу ${ROMAN(ch.n)}</a></div></div>`;
}
export { uid };
