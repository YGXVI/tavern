// Книга кампании (#203, макеты 35–44 и 52–59): корешок и оглавление, разворот главы, пометки на полях, разночтения,
// указатель, нити, печати, сноски, переплёт, перо летописца, «Книга героя». Запись своей версии — book-write.js.
import { html, raw, on, esc, plural } from '../../core/dom.js';
import { userById, characterOf, getCampaign } from '../../core/campaign.js';
import { modal, panelHeader, popover, closePopover, confirmDialog, portrait } from '../../ui/kit.js';
import { roll } from '../../../engine.js';
import { ROMAN, chapterOf, mutateBook, addMargin, agreeWith, sealEntry, breakSeal, writeEntry, bookIndex, fmtDate, inkWet, setPen, penHistory, sessionLive, heroOfUser, newId } from './book-store.js';
import { local, updateLocal } from './local.js';
import { ic, caps, party, chapterName, chapterSummary } from './parts.js';
import { bookFonts, spine, entryBlock, variantMap, chapterHead, authorName, authorColor, renderText, sealWhen } from './book-view.js';
import { mountWrite, seedDraft } from './book-write.js';

export function mountTab(ctx, body, tools) {
  bookFonts();
  const offs = [];
  const L = (type, sel, fn) => offs.push(on(body, type, sel, fn));
  let rest = ctx.st.rest;
  let sub = null; // вложенный экран (редактор)
  const href = (...p) => ctx.href('book', ...p);

  function toolbar() {
    if (!tools) return;
    const book = ctx.book();
    const empty = !book.chapters.length;
    tools.innerHTML = String(empty ? '' : ctx.master
      ? html`<a class="cp-tool ${rest[0] === 'index' ? 'on' : ''}" href="${href()}">Корешок</a><a class="cp-tool" href="${href('index')}">Указатель</a><a class="cp-tool ${rest[0] === 'threads' ? 'on' : ''}" href="${href('threads')}">Нити</a><a class="cp-tool" href="${href('pen')}">Перо</a><button class="btn btn-primary btn-sm" data-bind-open>Переплести главу</button>`
      : html`<a class="cp-tool" href="${href()}">Корешок</a><a class="cp-tool" href="${href('index')}">Указатель</a><a class="btn btn-primary btn-sm" href="${href('write')}">Своя версия</a>`);
  }

  function render() {
    sub?.unmount?.(); sub = null;
    toolbar();
    const c = ctx.c, book = ctx.book();
    const [page, a, b, d] = rest;
    if (page === 'write') { body.innerHTML = ''; sub = mountWrite(ctx, body, a || null); return; }
    if (!book.chapters.length) { body.innerHTML = String(empty(ctx)); return; }
    let out;
    if (page === 'ch' && a) out = b === 'v' && d ? variantPage(ctx, Number(a), d) : chapterPage(ctx, Number(a));
    else if (page === 'index') out = indexPage(ctx, a || null);
    else if (page === 'threads') out = threadsPage(ctx, a || null);
    else if (page === 'pen') out = penPage(ctx);
    else if (page === 'bound' && a) out = boundPage(ctx, Number(a));
    else if (page === 'mine') out = minePage(ctx);
    else out = tocPage(ctx);
    body.innerHTML = String(out);
    if (ctx.master) body.insertAdjacentHTML('beforeend', `<p class="bk-mastereye">${ic('view', 14)}Вид мастера: печати и личные пометки видишь только ты</p>`);
  }

  // ——— Выделение текста: на полях, в свою версию, разночтение, сноска ———
  let selBar = null;
  const hideBar = () => { selBar?.remove(); selBar = null; };
  L('mouseup', '[data-text]', (e, t) => setTimeout(() => {
    hideBar();
    const s = getSelection(); const quote = String(s || '').trim();
    if (!quote || !t.contains(s.anchorNode)) return;
    const sec = t.closest('[data-entry]');
    const r = s.getRangeAt(0).getBoundingClientRect();
    selBar = document.createElement('div');
    selBar.className = 'bk-selbar';
    selBar.innerHTML = String(html`<button data-sel="margin">${ic('pencil-edit-02', 14)}На полях</button><button data-sel="mine">${ic('note-edit', 14)}В свою версию</button><button data-sel="variant">${ic('arrow-left-right', 14)}Разночтение</button>${ctx.master ? html`<button data-sel="fn">† Сноска</button>` : ''}`);
    document.body.append(selBar);
    selBar.style.left = `${Math.max(8, Math.min(innerWidth - selBar.offsetWidth - 8, r.left + r.width / 2 - selBar.offsetWidth / 2))}px`;
    selBar.style.top = `${Math.max(8, r.top - selBar.offsetHeight - 8)}px`;
    selBar.addEventListener('mousedown', (ev) => ev.preventDefault());
    selBar.addEventListener('click', (ev) => {
      const k = ev.target.closest('[data-sel]')?.dataset.sel; if (!k) return;
      const n = Number(sec.dataset.n), id = sec.dataset.entry;
      hideBar();
      if (k === 'margin') marginPop(ctx, n, id, quote, r);
      if (k === 'fn') footnotePop(ctx, n, id, quote, r);
      if (k === 'mine') { seedDraft(ctx, { quote, n }); ctx.go('book', 'write'); }
      if (k === 'variant') { seedDraft(ctx, { quote, n, variantOf: id }); ctx.go('book', 'write'); }
    });
  }, 0));
  const onDown = (e) => { if (selBar && !selBar.contains(e.target)) hideBar(); };
  addEventListener('mousedown', onDown);

  // ——— Действия ———
  if (tools) offs.push(on(tools, 'click', '[data-bind-open]', () => bindModal(ctx)));
  L('click', '[data-break]', (e, b) => { const sec = b.closest('[data-entry]'); if (breakSeal(ctx.cid, ctx.user.id, Number(sec.dataset.n), b.dataset.break)) ctx.toast({ title: 'Печать сломана — отряд получил весть', icon: 'square-lock-02' }); });
  L('click', '[data-seal]', (e, b) => { const sec = b.closest('[data-entry]'); sealPop(ctx, Number(sec.dataset.n), b.dataset.seal, b); });
  L('click', '[data-open-now]', async (e, b) => {
    const sec = b.closest('[data-entry]'); const n = Number(sec.dataset.n);
    const entry = local('secret', ctx.cid, ctx.user.id).inbox?.[b.dataset.openNow]; if (!entry) return;
    if (!(await confirmDialog({ title: 'Открыть запись отряду?', body: 'Автор просил «только мастеру». Запись сразу увидят все.', ok: 'Открыть' }))) return;
    mutateBook(ctx.cid, (bk) => { const ch = chapterOf(bk, n) || (bk.chapters.push({ n, entries: [] }), chapterOf(bk, n)); ch.entries = ch.entries.filter((x) => x.id !== entry.id); ch.entries.push({ ...entry, n }); });
    updateLocal('secret', ctx.cid, ctx.user.id, (s) => { delete s.inbox[entry.id]; });
  });
  L('click', '[data-agree]', (e, b) => { agreeWith(ctx.cid, ctx.user.id, Number(b.dataset.n), b.dataset.agree); ctx.toast({ title: 'Отмечено: помните так же', icon: 'tick-02' }); });
  L('click', '[data-my-variant]', (e, b) => { seedDraft(ctx, { n: Number(b.dataset.n), variantOf: b.dataset.myVariant }); ctx.go('book', 'write'); });
  L('input', '[data-isearch]', (e, inp) => { const q = inp.value.trim().toLowerCase(); body.querySelectorAll('[data-iname]').forEach((x) => { x.hidden = q && !x.dataset.iname.includes(q); }); });
  // Нити
  L('click', '[data-thread-new]', () => threadModal(ctx));
  L('click', '[data-touch]', (e, b) => { if (!ctx.master) return; const [id, n] = b.dataset.touch.split(':'); mutateBook(ctx.cid, (bk) => { const t = bk.threads.find((x) => x.id === id); if (!t) return; t.touches ||= []; t.touches = t.touches.includes(Number(n)) ? t.touches.filter((x) => x !== Number(n)) : [...t.touches, Number(n)].sort((p, q) => p - q); }); });
  L('click', '[data-knot]', (e, b) => knotPop(ctx, b.dataset.knot, b));
  L('click', '[data-reopen]', (e, b) => mutateBook(ctx.cid, (bk) => { const t = bk.threads.find((x) => x.id === b.dataset.reopen); if (t) { t.closed = null; t.answer = null; } }));
  L('click', '[data-thread-del]', async (e, b) => { if (await confirmDialog({ title: 'Удалить нить?', ok: 'Удалить', danger: true })) mutateBook(ctx.cid, (bk) => { bk.threads = bk.threads.filter((x) => x.id !== b.dataset.threadDel); }); ctx.go('book', 'threads'); });
  // Перо
  L('change', '[name="pen"]', () => { const btn = body.querySelector('[data-pen-go]'); const v = body.querySelector('[name="pen"]:checked'); if (btn && v) btn.textContent = v.value === 'd4' ? 'Бросить d4 и передать' : `Передать перо ${v.dataset.name}`; });
  L('click', '[data-pen-go]', () => {
    const v = body.querySelector('[name="pen"]:checked')?.value; if (!v) return;
    const heroes = party(ctx.c).filter((p) => p.member);
    let uid = v;
    if (v === 'd4' && !heroes.length) return;
    if (v === 'd4') {
      // Героев больше четырёх — кубик побольше; лишние грани перебрасываем.
      const die = [4, 6, 8, 10, 12, 20, 100].find((x) => x >= heroes.length) || 100;
      let r; do { r = roll(`1d${die}`); } while (r.total > heroes.length);
      const idx = r.total - 1; uid = heroes[idx]?.user?.id;
      ctx.toast({ title: `d${die}: ${r.total}`, body: `Перо — ${heroes[idx]?.ch.name}`, icon: 'dice-faces-06' });
    }
    if (!uid) return;
    const book = ctx.book(); const n = book.session && !book.session.endedAt ? book.session.n : (book.chapters.at(-1)?.n || 0) + (book.chapters.at(-1)?.endedAt ? 1 : 0);
    setPen(ctx.cid, uid, n || 1, body.querySelector('[data-rotate]')?.checked);
    ctx.toast({ title: `Перо передано: ${heroOfUser(ctx.c, uid)?.name || userById(uid)?.name || 'игрок'}`, body: `Летописец главы ${ROMAN(n || 1)}`, icon: 'pencil-edit-02' });
    ctx.go('book');
  });
  // Книга героя: «только я» удалить
  L('click', '[data-diary-del]', (e, b) => updateLocal('mine', ctx.cid, ctx.user.id, (m) => { m.diary = (m.diary || []).filter((x) => x.id !== b.dataset.diaryDel); }));

  render();
  return {
    update() { if (sub?.update) { toolbar(); sub.update(); return; } if (!body.querySelector('.bk-pop-open')) render(); },
    route(r) { rest = r; render(); scrollTo({ top: Math.min(scrollY, 260) }); },
    unmount() { sub?.unmount?.(); hideBar(); removeEventListener('mousedown', onDown); for (const off of offs) off(); closePopover(); if (tools) tools.innerHTML = ''; },
  };
}

// ——— Пустая книга (44) ———
function empty(ctx) {
  const c = ctx.c, book = ctx.book();
  const owner = userById(c.members.find((m) => m.role === 'master')?.userId);
  const pen = book.pen?.userId ? heroOfUser(c, book.pen.userId)?.name : null;
  return html`<div class="bk-empty">
    <div class="bk-cover"><div class="bk-cover-in"><small>книга кампании</small><h2>${c.name}</h2><span>✦</span><em>ведёт ${owner?.name || 'мастер'}</em></div><i class="bk-cover-ribbon"></i></div>
    <div class="bk-empty-t"><h2>Книга пока пуста</h2><p>Её напишете вы — по главе за сессию.${book.next?.at ? ` Первая глава появится после ${fmtDate(book.next.at)}` : ' Первая глава появится после первой игры'}${pen ? `, и первое перо — ${pen}` : ''}.</p>
      <div class="bk-steps">
        <div>${ic('sticky-note-01', 18)}<span><b>Во время игры — ленточка</b><small>Заметили важное — закладка сверху стола. Время, сцена и место запишутся сами.</small></span></div>
        <div>${ic('pencil-edit-02', 18)}<span><b>После — своя версия</b><small>Летописец пишет главу, остальные — свои голоса и пометки на полях. Чернила сохнут до следующей игры.</small></span></div>
        <div>${ic('book-open-01', 18)}<span><b>Мастер переплетает главу</b><small>Даёт ей имя, выбирает эпиграф из ваших строк — и глава встаёт на корешок.</small></span></div>
      </div>
      ${ctx.master ? html`<div class="row"><button class="btn btn-primary" data-start>${ic('play')}Начать первую главу</button><a class="btn btn-secondary" href="${ctx.href('book', 'pen')}">${ic('pencil-edit-02')}Выбрать летописца</a></div>` : ''}
    </div></div>`;
}

// ——— Корешок и оглавление (39) ———
function tocPage(ctx) {
  const c = ctx.c, book = ctx.book();
  const idx = bookIndex(book, c).sort((a, b) => b.refs.length - a.refs.length).slice(0, 3);
  const seals = book.chapters.reduce((n, ch) => n + ch.entries.filter((e) => e.kind === 'sealed').length, 0);
  const voicesN = book.chapters.reduce((n, ch) => n + ch.entries.filter((e) => !e.diary && e.kind !== 'sealed').length, 0);
  const last = book.chapters.at(-1);
  const pen = book.pen?.userId ? heroOfUser(c, book.pen.userId)?.name || userById(book.pen.userId)?.name : null;
  const cur = Number(ctx.st.rest[1]) || last?.n;
  const ep = (ch) => {
    const e = ch.epigraph ? { text: ch.epigraph.text, userId: ch.epigraph.userId } : null;
    return e ? html`<p class="bk-toc-ep" style="--c:${authorColor(c, e.userId)}">«${e.text}» — ${authorName(c, e)}</p>` : chapterSummary(ch, 90) ? html`<p class="bk-toc-ep muted">${chapterSummary(ch, 90)}</p>` : '';
  };
  return html`<div class="bk-toc-wrap">
    ${spine(c, book, { current: cur, hrefOf: (n) => ctx.href('book', 'ch', n) })}
    <div class="bk-paper bk-toc"><i class="bk-bookmark"></i><div class="row"><h1>Оглавление</h1><span class="spacer"></span><small class="bk-caps">${book.chapters.length} ${plural(book.chapters.length, 'глава', 'главы', 'глав')} · ${voicesN} ${plural(voicesN, 'голос', 'голоса', 'голосов')}${seals ? ` · ${seals} ${plural(seals, 'печать', 'печати', 'печатей')}` : ''}</small></div>
      ${book.chapters.map((ch) => html`<a class="bk-toc-row ${ch.n === cur ? 'current' : ''}" href="${ctx.href('book', 'ch', ch.n)}"><span class="bk-num">${ROMAN(ch.n)}</span><span class="bk-toc-t"><span class="row"><b>${ch.title || chapterName(ch)}</b>${ch.boundAt ? '' : html`<em>${ch.endedAt ? 'ждёт переплёта' : 'пишется'}</em>`}<span class="bk-dots"></span><small>${fmtDate(ch.startedAt).replace(/ (\S+)$/, (m, mo) => ` ${mo.slice(0, 3)}`)}</small></span>${ep(ch)}</span></a>`)}
      ${!last || last.endedAt ? html`<p class="bk-toc-next"><span class="bk-num">${ROMAN((last?.n || 0) + 1)}</span>глава ещё не написана${pen ? ` — перо: ${pen}` : ''}${book.next?.at ? `, сессия ${fmtDate(book.next.at)}` : ''}</p>` : ''}
    </div>
    <aside class="bk-insert"><small class="bk-caps red">вкладыш · нити</small>
      ${book.threads.length ? book.threads.slice(0, 6).map((t) => html`<a class="bk-ins-thread ${t.closed ? 'closed' : ''}" href="${ctx.href('book', 'threads', t.id)}">${t.closed ? ic('tick-02', 14) : html`<span class="bk-wave">∿</span>`}<span>${t.title}</span><small>${t.closed ? `закрыта в ${ROMAN(t.closed)}` : `с главы ${ROMAN(t.opened || 1)}`}</small></a>`) : html`<p class="t-sm bk-muted">Нитей пока нет${ctx.master ? ' — заведите их в «Нитях»' : ''}.</p>`}
      ${idx.length ? html`<small class="bk-caps red">чаще всего в книге</small>${idx.map((x) => html`<a class="bk-ins-name" href="${ctx.href('book', 'index', x.name)}"><span>${x.name}</span><i></i><small>${[...new Set(x.refs.map((r) => ROMAN(r.n)))].join(', ')}</small></a>`)}<a class="bk-link" href="${ctx.href('book', 'index')}">Весь указатель →</a>` : ''}
    </aside>
  </div>`;
}

// ——— Разворот главы (40, 52) ———
function chapterPage(ctx, n) {
  const c = ctx.c, book = ctx.book();
  const ch = chapterOf(book, n);
  if (!ch) return html`<div class="cp-empty"><h3>Такой главы нет</h3><a class="btn btn-secondary" href="${ctx.href('book')}">К оглавлению</a></div>`;
  const variants = variantMap(c, ch);
  const entries = ch.entries.filter((e) => ctx.master || e.kind === 'sealed' || !e.onlyMaster || e.userId === ctx.user.id);
  const prev = chapterOf(book, n - 1), next = chapterOf(book, n + 1);
  const wet = inkWet(ch);
  return html`<div class="bk-spread-wrap">
    ${prev ? html`<a class="bk-turn left" href="${ctx.href('book', 'ch', prev.n)}" aria-label="Предыдущая глава">${ic('arrow-left-01', 20)}</a>` : ''}
    <article class="bk-spread"><div class="bk-cols">${chapterHead(c, ch)}
      ${entries.length ? entries.map((e) => entryBlock(c, ch, e, { me: ctx.user.id, master: ctx.master, variants })) : html`<p class="bk-muted bk-none">В главе пока нет записей. ${wet ? 'Напишите свою версию — чернила ещё не высохли.' : ''}</p>`}
    </div><footer class="bk-pagenums"><span>${ROMAN(n)} · 1</span><span>${ROMAN(n)} · 2</span></footer></article>
    ${next ? html`<a class="bk-turn right" href="${ctx.href('book', 'ch', next.n)}" aria-label="Следующая глава">${ic('arrow-right-01', 20)}</a>` : ''}
    <p class="bk-under">${wet ? html`${ic('droplet', 14)}Чернила сохнут${ch.inkUntil ? ` до ${fmtDate(ch.inkUntil, { time: true })}` : ''} — выделите строку, чтобы оставить пометку на полях или начать свою версию.` : html`${ic('tick-02', 14)}Чернила высохли — глава застыла. Пометки на полях оставлять можно.`}</p>
  </div>`;
}

// ——— Разночтение (41) ———
function variantPage(ctx, n, id) {
  const c = ctx.c, book = ctx.book();
  const ch = chapterOf(book, n);
  const a = ch?.entries.find((e) => e.id === id);
  const b = a && (ch.entries.find((e) => e.id === a.variantOf) || ch.entries.find((e) => e.variantOf === a.id));
  if (!a || !b) return chapterPage(ctx, n);
  const at = a.ribbon?.at || b.ribbon?.at || a.at;
  const chron = (c.log || []).filter((l) => l.kind !== 'book' && (l.label || l.total != null) && !l.redacted && !l.hidden && Math.abs(l.at - at) < 15 * 60000).slice(0, 4);
  const side = (e, left) => {
    const mine = e.userId === ctx.user.id || (e.agree || []).includes(ctx.user.id);
    return html`<div class="bk-vside"><p class="bk-meta red">разночтение · глава ${ROMAN(n)}${e.ribbon?.place ? html` <span>${new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} · ${e.ribbon.place}</span>` : ''}</p>
      <h1>Версия ${authorName(c, e)}</h1><div class="bk-by" style="--c:${authorColor(c, e.userId)}"><i></i>${authorName(c, e)} · ${e.voice === 'hero' ? 'от лица героя' : 'от себя'}</div>
      ${e.title ? html`<h3>${e.title}</h3>` : ''}<div class="bk-text" style="--c:${authorColor(c, e.userId)}">${renderText(e.text, c.id)}</div>
      ${(e.agree || []).length ? html`<p class="bk-caps">помнят так же ${e.agree.map((u) => html`<span class="bk-agree-who">${authorName(c, { userId: u })}</span>`)}</p>` : ''}
      ${left && chron.length ? html`<div class="bk-chron"><small class="bk-caps">что записано в хронике мастера</small><p>${chron.map((l) => `${new Date(l.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} · ${l.label}: ${l.total}`).join('. ')}.</p></div>` : ''}
      ${!mine ? html`<button class="btn btn-sm bk-btn-dark" data-agree="${e.id}" data-n="${n}">Помню так же, как ${authorName(c, e)}</button>` : ''}
    </div>`;
  };
  return html`<div class="bk-spread-wrap"><article class="bk-spread bk-variant">${side(b, true)}<span class="bk-neq">≠</span>${side(a, false)}
    <footer class="bk-pagenums"><span>${ROMAN(n)} · 3</span><span>${ROMAN(n)} · 4</span></footer></article>
    <div class="row bk-under"><span class="bk-muted">Мастер пока молчит. У разночтения нет правильного ответа, пока он его не даст — а может, и не даст.</span><span class="spacer"></span>
      <button class="btn btn-sm btn-secondary" data-my-variant="${a.id}" data-n="${n}">Моя версия момента</button><a class="btn btn-sm btn-ghost" href="${ctx.href('book', 'ch', n)}">К главе</a></div></div>`;
}

// ——— Указатель (43) ———
function indexPage(ctx, sel) {
  const c = ctx.c, book = ctx.book();
  const idx = bookIndex(book, c);
  const cur = sel ? idx.find((x) => x.name.toLowerCase() === sel.toLowerCase()) : idx[0];
  const groups = new Map();
  for (const x of idx) { const L0 = x.name[0].toUpperCase(); if (!groups.has(L0)) groups.set(L0, []); groups.get(L0).push(x); }
  const near = cur ? [...new Set(book.chapters.flatMap((ch) => ch.entries.filter((e) => cur.refs.some((r) => r.entryId === e.id)).flatMap((e) => bookIndex({ chapters: [{ ...ch, entries: [e] }] }, c).map((y) => y.name))))].filter((nm) => nm !== cur.name).slice(0, 4) : [];
  const KIND = { hero: 'герой', place: 'место', name: 'имя или вещь' };
  return html`<article class="bk-spread bk-index"><div class="bk-ipage">
      <div class="row"><h1>Указатель</h1><span class="spacer"></span><small class="bk-caps">${idx.length} ${plural(idx.length, 'имя', 'имени', 'имён')}</small></div>
      <label class="bk-isearch">${ic('search-01', 16)}<input data-isearch placeholder="Найти имя, место или вещь"></label>
      ${idx.length ? html`<div class="bk-icols">${[...groups].map(([L0, list]) => html`<div class="bk-igroup"><b class="bk-iletter">${L0}</b>${list.map((x) => html`<a class="bk-iname ${x === cur ? 'current' : ''}" data-iname="${x.name.toLowerCase()}" href="${ctx.href('book', 'index', x.name)}"><span>${x.name}</span><i></i><small>${[...new Set(x.refs.map((r) => ROMAN(r.n)))].join(', ')}</small></a>`)}</div>`)}</div>`
    : html`<p class="bk-muted">Указатель собирается сам: напишите в своей версии @ и имя — «@Торин», «@[Алтарь Безликого]».</p>`}
      <p class="bk-pfoot">указатель</p></div>
    <div class="bk-ipage">${cur ? html`<p class="bk-meta red">${KIND[cur.kind]} · ${cur.refs.length > 1 ? 'главы' : 'глава'} ${[...new Set(cur.refs.map((r) => ROMAN(r.n)))].join(' и ')}</p><h1>${cur.name}</h1>
      ${cur.refs.map((r) => html`<div class="bk-iref"><span class="bk-num">${ROMAN(r.n)}</span><div><p>«${r.quote}»</p><small style="color:${authorColor(c, r.userId)}">${authorName(c, { userId: r.userId })}</small> <a class="bk-link" href="${ctx.href('book', 'ch', r.n)}">→ ${ROMAN(r.n)}</a></div></div>`)}
      ${near.length ? html`<p class="bk-near">Рядом в указателе: ${near.map((nm, i) => html`${i ? ' · ' : ''}<a href="${ctx.href('book', 'index', nm)}">${nm}</a>`)}</p>` : ''}` : ''}
      <p class="bk-pfoot">указатель</p></div></article>`;
}

// ——— Нити (55) ———
function threadsPage(ctx, sel) {
  const c = ctx.c, book = ctx.book();
  const nMax = Math.max(1, ...book.chapters.map((ch) => ch.n));
  const cols = Array.from({ length: nMax + 1 }, (_, i) => i + 1);
  const cur = book.threads.find((t) => t.id === sel) || book.threads.find((t) => !t.closed) || book.threads[0];
  const W = 100 / cols.length;
  const x = (n) => `${(n - 0.5) * W}%`;
  const row = (t) => {
    const end = t.closed || nMax;
    const pts = [t.opened || 1, ...(t.touches || []).filter((n) => n > (t.opened || 1) && n <= end), ...(t.closed ? [t.closed] : [])];
    const segs = [];
    for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]]);
    const last = pts.at(-1);
    const sag = !t.closed && nMax - last >= 2;
    return html`<a class="bk-loom-row ${t === cur ? 'current' : ''} ${t.closed ? 'closed' : ''}" href="${ctx.href('book', 'threads', t.id)}"><span class="bk-loom-name">${t.title}</span>
      <span class="bk-loom-track">${cols.map((n) => html`<button class="bk-loom-cell" style="left:${x(n)}" data-touch="${t.id}:${n}" aria-label="Глава ${ROMAN(n)}" ${ctx.master ? '' : raw('tabindex="-1"')}></button>`)}
        ${segs.map(([a, b]) => html`<i class="bk-loom-line ${b - a >= 2 ? 'sag' : ''}" style="left:${x(a)};width:calc(${x(b)} - ${x(a)})"></i>`)}
        ${!t.closed ? html`<i class="bk-loom-line dash ${sag ? 'sag' : ''}" style="left:${x(last)};width:calc(${x(nMax + 1)} - ${x(last)})"></i>` : ''}
        ${pts.map((n, i) => html`<i class="bk-loom-knot ${t.closed && i === pts.length - 1 ? 'big' : ''}" style="left:${x(n)}"></i>`)}
        ${sag ? html`<small class="bk-loom-sag" style="left:${x(last)}">провисла — ${nMax - last} ${plural(nMax - last, 'глава', 'главы', 'глав')} без единого слова</small>` : ''}</span></a>`;
  };
  return html`<article class="bk-paper bk-threads"><div class="bk-loom">
      <div class="row"><h1>Нити кампании</h1><span class="spacer"></span>${ctx.master ? html`<button class="btn btn-sm bk-btn-dark" data-thread-new>${ic('plus-sign', 14)}Новая нить</button>` : ''}</div>
      <p class="bk-muted">Красная нить тянется от главы, где открылась, до узла, где закрылась. Нить, которую давно не трогали, провисает.${ctx.master ? ' Нажмите на главу в строке — отметить, что нить там звучала.' : ''}</p>
      <div class="bk-loom-head"><span class="bk-loom-name"></span><span class="bk-loom-track">${cols.map((n) => html`<b style="left:${x(n)}" class="${n > nMax ? 'future' : ''}">${ROMAN(n)}</b>`)}</span></div>
      ${book.threads.length ? book.threads.map(row) : html`<p class="bk-muted bk-none">Нитей пока нет. Нить — вопрос, который тянется через главы: «Кто подменил жреца?»</p>`}
    </div>
    <aside class="bk-thread-side">${cur ? html`<p class="bk-meta red">нить · ${cur.closed ? `закрыта в главе ${ROMAN(cur.closed)}` : `открыта в главе ${ROMAN(cur.opened || 1)}`}</p><h2>${cur.title}</h2>
      ${cur.note ? html`<p class="bk-muted">${cur.note}</p>` : ''}
      ${cur.answer ? html`<div class="bk-answer"><small class="bk-caps">ответ уже в книге</small><p>${cur.answer.text}</p></div>` : ''}
      ${ctx.master ? html`<div class="col">${cur.closed ? html`<button class="btn btn-sm bk-btn-line" data-reopen="${cur.id}">Развязать узел</button>` : html`<button class="btn btn-sm bk-btn-dark" data-knot="${cur.id}">Завязать узел этой записью</button>`}<button class="btn btn-sm bk-btn-line" data-thread-del="${cur.id}">Удалить нить</button></div>
        <p class="bk-hand">Закрытую нить можно развязать — если правда окажется сложнее.</p>` : ''}` : ''}</aside></article>`;
}
function threadModal(ctx) {
  const book = ctx.book();
  const n = book.session?.n || book.chapters.at(-1)?.n || 1;
  const m = modal(html`${panelHeader('Новая нить', 'Вопрос или обещание, которое тянется через главы')}
    <div class="panel-section"><div class="field"><label for="th-t">Нить</label><div class="input"><input id="th-t" maxlength="80" placeholder="Кто подменил жреца?"></div></div>
      <div class="field"><label for="th-n">Открылась в главе</label><div class="input"><input id="th-n" type="number" min="1" max="${n + 1}" value="${n}"></div></div>
      <div class="field"><label for="th-d">Заметка — видна всем</label><div class="input"><input id="th-d" maxlength="160" placeholder="Открыла Лира — ленточкой в 21:14"></div></div></div>
    <div class="panel-footer"><span class="spacer"></span><button class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary" data-ok>Завести нить</button></div>`);
  m.box.querySelector('[data-ok]').addEventListener('click', () => {
    const t = m.box.querySelector('#th-t').value.trim(); if (!t) return;
    const id = newId('th-');
    mutateBook(ctx.cid, (b) => { b.threads.push({ id, title: t, opened: Number(m.box.querySelector('#th-n').value) || n, closed: null, touches: [], note: m.box.querySelector('#th-d').value.trim(), answer: null }); });
    m.close(); ctx.go('book', 'threads', id);
  });
}
function knotPop(ctx, id, anchor) {
  const book = ctx.book();
  const cands = book.chapters.flatMap((ch) => ch.entries.filter((e) => e.text && !e.diary && !e.onlyMaster).map((e) => ({ ch, e }))).slice(-12).reverse();
  const p = popover(html`<div class="bk-pop"><small class="bk-caps">какая запись отвечает на нить</small>${cands.map(({ ch, e }, i) => html`<button class="bk-pop-row" data-i="${i}"><b>${e.title || chapterSummary({ entries: [e] }, 50)}</b><small>${authorName(ctx.c, e)} · глава ${ROMAN(ch.n)}</small></button>`)}
    <button class="bk-pop-row" data-i="-1"><b>Без записи — просто закрыть</b></button></div>`, anchor, { placement: 'left', className: 'bk-pop-open' });
  p.node.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]'); if (!b) return;
    const k = Number(b.dataset.i); const pick = cands[k];
    const n = pick?.ch.n || book.session?.n || book.chapters.at(-1)?.n || 1;
    mutateBook(ctx.cid, (bk) => { const t = bk.threads.find((x) => x.id === id); if (!t) return; t.closed = n; t.answer = pick ? { entryId: pick.e.id, text: `«${pick.e.title || chapterSummary({ entries: [pick.e] }, 80)}» — ${authorName(ctx.c, pick.e)}` } : null; });
    p.close();
  });
}

// ——— Перо (59) ———
function penPage(ctx) {
  const c = ctx.c, book = ctx.book();
  const heroes = party(c).filter((p) => p.member);
  const hist = penHistory(book);
  const n = book.session && !book.session.endedAt ? book.session.n : (book.chapters.at(-1)?.n || 0) + (book.chapters.at(-1)?.endedAt || !book.chapters.length ? 1 : 0);
  const curPen = book.pen?.userId;
  const lastPen = [...book.chapters].reverse().find((ch) => ch.pen)?.pen;
  const order = heroes.map((p) => p.user.id);
  const nextIdx = lastPen && order.includes(lastPen) ? (order.indexOf(lastPen) + 1) % order.length : 0;
  const next = heroes[nextIdx];
  const never = heroes.find((p) => !hist.has(p.user.id) && p !== next);
  const R = 150;
  const wrote = (p) => { const h = hist.get(p.user.id); return h ? `главы: ${h.map(ROMAN).join(', ')}` : 'глав пока нет'; };
  return html`<div class="bk-pen">
    <div class="bk-circle"><span class="bk-circle-ring"></span><span class="bk-quill">${ic('pencil-edit-02', 30)}</span>
      ${heroes.map((p, i) => { const a = (i / Math.max(1, heroes.length)) * 2 * Math.PI - Math.PI / 2; return html`<span class="bk-seat ${p.user.id === curPen ? 'on' : ''}" style="left:calc(50% + ${Math.round(Math.cos(a) * R)}px);top:calc(50% + ${Math.round(Math.sin(a) * R)}px)">${portrait(p.ch.portrait, 'lg hero', p.ch.name)}<b>${p.ch.name}</b><small>${wrote(p)}</small></span>`; })}
      ${!heroes.length ? html`<p class="bk-muted bk-circle-empty">За столом пока нет героев с игроками.</p>` : ''}</div>
    <div class="bk-pen-side"><p class="bk-meta gold">перо главы ${ROMAN(n || 1)}${book.next?.at ? ` · сессия ${fmtDate(book.next.at)}` : ''}</p><h1 class="bk-serif-light">Кто пишет следующую главу?</h1>
      ${heroes.length ? html`<div class="bk-pen-opts">
        ${next ? html`<label class="bk-pen-opt"><input type="radio" name="pen" value="${next.user.id}" data-name="${next.ch.name}" checked>${portrait(next.ch.portrait, 'sm hero', next.ch.name)}<span><b>${next.ch.name} — по кругу</b><small>${wrote(next)}${lastPen ? ` · следующий после ${heroOfUser(c, lastPen)?.name || 'прошлого летописца'}` : ''}</small></span></label>` : ''}
        ${never ? html`<label class="bk-pen-opt"><input type="radio" name="pen" value="${never.user.id}" data-name="${never.ch.name}">${portrait(never.ch.portrait, 'sm hero', never.ch.name)}<span><b>${never.ch.name} — пока без глав</b><small>хорошая глава, чтобы услышать новый голос</small></span><span class="chip chip-accent">предложение</span></label>` : ''}
        ${heroes.filter((p) => p !== next && p !== never).map((p) => html`<label class="bk-pen-opt"><input type="radio" name="pen" value="${p.user.id}" data-name="${p.ch.name}">${portrait(p.ch.portrait, 'sm hero', p.ch.name)}<span><b>${p.ch.name}</b><small>${wrote(p)}</small></span></label>`)}
        <label class="bk-pen-opt"><input type="radio" name="pen" value="d4"><span class="bk-d4">d4</span><span><b>Пусть решит кубик</b><small>бросим сейчас — кому выпадет</small></span></label></div>
        <label class="bk-pen-rot"><input type="checkbox" class="switch" data-rotate ${book.rotate ? 'checked' : ''}>Дальше передавать по кругу без вопросов</label>
        <p class="t-xs tertiary">Летописец пишет основу главы. Остальные, как всегда, — свои версии и пометки на полях.</p>
        ${ctx.master ? html`<button class="btn btn-primary" data-pen-go>Передать перо ${next?.ch.name || ''}</button>` : html`<p class="t-sm muted">Перо передаёт мастер.</p>`}` : ''}
    </div></div>`;
}

// ——— Переплёт (57) и «глава переплетена» (58) ———
function bindModal(ctx) {
  const c = ctx.c, book = ctx.book();
  const ch = [...book.chapters].reverse().find((x) => x.endedAt && !x.boundAt) || [...book.chapters].reverse().find((x) => !x.boundAt);
  if (!ch) { ctx.toast({ title: 'Все главы уже переплетены', body: 'Новая глава появится, когда начнёте игру', icon: 'book-open-01' }); return; }
  const prev = chapterOf(book, ch.n - 1);
  const lines = ch.entries.filter((e) => e.text && !e.diary && !e.onlyMaster && e.kind !== 'sealed').map((e) => ({ userId: e.userId, text: (String(e.text).replace(/^>.*$/gm, '').replace(/@\[([^\]]+)\]/g, '$1').replace(/@(\S+)/g, '$1').trim().split(/(?<=[.!?…])\s+/)[0] || '').slice(0, 140) })).filter((x) => x.text).slice(0, 5);
  const stat = [
    `${new Set(ch.entries.map((e) => e.userId)).size} ${plural(new Set(ch.entries.map((e) => e.userId)).size, 'голос', 'голоса', 'голосов')}`,
    ch.entries.filter((e) => e.variantOf).length ? `${ch.entries.filter((e) => e.variantOf).length} разночтение` : '',
    ch.entries.filter((e) => e.sealed?.brokenAt).length ? `${ch.entries.filter((e) => e.sealed?.brokenAt).length} печать сломана` : '',
    ch.entries.reduce((n, e) => n + (e.footnotes || []).length, 0) ? `${ch.entries.reduce((n, e) => n + (e.footnotes || []).length, 0)} сноска` : '',
    book.threads.filter((t) => !t.closed).length ? `${book.threads.filter((t) => !t.closed).length} нити тянутся дальше` : '',
  ].filter(Boolean);
  const m = modal(html`<div class="bk-bind"><div class="bk-bind-spine">${prev ? html`<div class="bk-vol"><span class="bk-num">${ROMAN(prev.n)}</span><b>${prev.title || chapterName(prev)}</b><small>${fmtDate(prev.startedAt)}</small></div>` : ''}<div class="bk-vol glow"><span class="bk-num">${ROMAN(ch.n)}</span><b data-prev-title>${ch.title || chapterName(ch)}</b><small>${fmtDate(ch.startedAt)}</small></div><small class="bk-muted">Так глава встанет на корешок</small></div>
    <div class="bk-bind-form"><p class="bk-meta gold">переплетая главу, ты даёшь ей имя</p><h1 class="bk-serif-light">Переплести главу ${ROMAN(ch.n)}</h1>
      <label class="bk-flabel">Название главы<input data-title maxlength="80" value="${ch.title || ''}" placeholder="Чего хотел староста"></label>
      <p class="bk-flabel">Эпиграф — строка из ваших записей</p>
      <div class="bk-epi-list">${lines.map((l, i) => html`<label class="bk-epi" style="--c:${authorColor(c, l.userId)}"><input type="radio" name="ep" value="${i}" ${i === 0 ? 'checked' : ''}><span>«${l.text}»</span><small>— ${authorName(c, l)}</small></label>`)}<label class="bk-epi"><input type="radio" name="ep" value="-1" ${lines.length ? '' : 'checked'}><span>Без эпиграфа</span></label></div>
      <div class="bk-chips">${stat.map((s) => html`<span>${s}</span>`)}</div>
      <p class="bk-flabel">Чернила</p><div class="row bk-ink"><label><input type="radio" name="ink" value="wet" checked>Пусть сохнут${book.next?.at ? ` до ${fmtDate(book.next.at, { time: true })}` : ' до следующей игры'}</label><label><input type="radio" name="ink" value="dry">Высушить сейчас</label></div>
      <div class="row"><button class="btn btn-primary" data-ok>Переплести главу</button><button class="btn bk-btn-ghostdark" data-close>Ещё не время</button></div></div></div>`, { className: 'bk-bind-modal', wide: true });
  m.box.querySelector('[data-title]').addEventListener('input', (e) => { m.box.querySelector('[data-prev-title]').textContent = e.target.value || chapterName(ch); });
  m.box.querySelector('[data-ok]').addEventListener('click', () => {
    const title = m.box.querySelector('[data-title]').value.trim();
    if (!title) { m.box.querySelector('[data-title]').focus(); return; }
    const ep = Number(m.box.querySelector('[name="ep"]:checked')?.value ?? -1);
    const dry = m.box.querySelector('[name="ink"]:checked')?.value === 'dry';
    mutateBook(ctx.cid, (b) => { const x = chapterOf(b, ch.n); if (!x) return; x.title = title; x.epigraph = lines[ep] ? { text: lines[ep].text, userId: lines[ep].userId } : null; x.boundAt = Date.now(); x.endedAt ||= Date.now(); x.inkUntil = dry ? Date.now() : (b.next?.at && b.next.at > Date.now() ? b.next.at : x.inkUntil || Date.now() + 7 * 86400000); if (b.session?.n === x.n && !b.session.endedAt) b.session.endedAt = Date.now(); });
    m.close(); ctx.go('book', 'bound', ch.n);
  });
}
function boundPage(ctx, n) {
  const c = ctx.c, book = ctx.book(), ch = chapterOf(book, n);
  if (!ch) return tocPage(ctx);
  const ep = ch.epigraph;
  return html`<div class="bk-bound">${spine(c, book, { current: n, glow: n, hrefOf: (k) => ctx.href('book', 'ch', k) })}
    <div class="bk-bound-t"><p class="bk-meta gold">глава переплетена · встала на корешок ${ROMAN(n).toLowerCase() === 'v' ? 'пятой' : `под номером ${ROMAN(n)}`}</p><h1 class="bk-serif-light big">${ch.title}</h1>
      ${ep ? html`<p class="bk-bound-ep">«${ep.text}» — ${authorName(c, ep)}</p>` : ''}
      <p class="t-sm muted">Отряд получил весть — глава уже в оглавлении.${ch.inkUntil && ch.inkUntil > Date.now() ? ` Чернила сохнут до ${fmtDate(ch.inkUntil)}, потом текст застынет.` : ' Чернила высохли — текст застыл.'}</p>
      <div class="row">${ctx.master ? html`<a class="btn btn-primary" href="${ctx.href('book', 'pen')}">Передать перо →</a>` : ''}<a class="btn btn-secondary" href="${ctx.href('book', 'ch', n)}">Открыть главу</a></div></div></div>`;
}

// ——— Книга героя ———
function minePage(ctx) {
  const c = ctx.c, book = ctx.book(), me = ctx.user.id;
  const mine = book.chapters.flatMap((ch) => ch.entries.filter((e) => e.userId === me).map((e) => ({ ch, e })));
  const ribbons = local('mine', ctx.cid, me).ribbons || [];
  return html`<div class="bk-mine"><div class="bk-paper"><h1>Книга героя</h1><p class="bk-muted">Всё, что вы вписали в книгу кампании, и ваш дневник «только я».</p>
    ${mine.length ? mine.map(({ ch, e }) => html`<div class="bk-mine-row"><span class="bk-num">${ROMAN(ch.n)}</span><div><b>${e.title || 'Без заголовка'}</b><small>${e.diary ? 'дневник — только вы' : e.onlyMaster ? 'только мастеру' : 'в книге'} · ${fmtDate(e.at, { time: true })}</small><p>${chapterSummary({ entries: [e] }, 200)}</p>
      <div class="row">${inkWet(ch) ? html`<a class="bk-link" href="${ctx.href('book', 'write', e.id)}">Править</a>` : ''}<a class="bk-link" href="${ctx.href('book', 'ch', ch.n)}">К главе</a>${e.diary ? html`<button class="link-btn" data-diary-del="${e.id}">Удалить</button>` : ''}</div></div></div>`) : html`<p class="bk-muted">Пока пусто. Напишите свою версию главы — она появится здесь.</p>`}
    ${ribbons.length ? html`<h3>Ленточки</h3>${ribbons.slice().reverse().map((r) => html`<p class="bk-mine-rb"><b>${new Date(r.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</b> ${r.text}${r.place ? html` <small>· ${r.place}</small>` : ''}</p>`)}` : ''}
    <a class="btn btn-primary btn-sm" href="${ctx.href('book', 'write')}">Своя версия</a></div></div>`;
}

// ——— Всплывающие окна ———
function marginPop(ctx, n, id, quote, rect) {
  const c = ctx.c; const e = chapterOf(ctx.book(), n)?.entries.find((x) => x.id === id);
  const p = popover(html`<div class="bk-pop"><small class="bk-caps">карандашом на полях</small><p class="bk-pop-quote">«${quote.slice(0, 200)}»</p>
    <textarea class="bk-hand-input" rows="3" maxlength="400" placeholder="Гарр, между прочим, смотрел на кошелёк старосты!"></textarea>
    <p class="bk-muted t-xs">${ic('view', 12)}Видят все, кто читает главу. Текст ${e ? authorName(c, e) : 'автора'} не меняется.</p>
    <div class="row"><button class="btn btn-sm bk-btn-dark" data-ok>Оставить</button><button class="btn btn-sm bk-btn-line" data-close>Отмена</button></div></div>`, { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }, { placement: 'bottom', className: 'bk-pop-open' });
  const ta = p.node.querySelector('textarea'); setTimeout(() => ta.focus(), 20);
  p.node.querySelector('[data-ok]').addEventListener('click', () => { const t = ta.value.trim(); if (!t) return; addMargin(ctx.cid, ctx.user.id, n, id, quote, t); p.close(); ctx.toast({ title: 'Пометка на полях', body: 'Её увидят все, кто читает главу', icon: 'pencil-edit-02' }); });
}
function footnotePop(ctx, n, id, quote, rect) {
  const c = ctx.c; const e = chapterOf(ctx.book(), n)?.entries.find((x) => x.id === id);
  const p = popover(html`<div class="bk-pop"><small class="bk-caps">сноска мастера к строке ${e ? authorName(c, e) : ''}</small><p class="bk-pop-quote">…${quote.slice(0, 160)}</p>
    <textarea rows="3" maxlength="400" placeholder="Спускался. Восемь лет назад — с сыном."></textarea>
    <small class="bk-caps">где появится</small>
    <label class="bk-radio"><input type="radio" name="fnw" value="all" checked><span><b>Внизу страницы, для всех</b><small>текст ${e ? authorName(c, e) : 'автора'} не меняется — сноска говорит рядом</small></span></label>
    <label class="bk-radio"><input type="radio" name="fnw" value="me"><span><b>Только мне, на полях</b><small>личная пометка мастера</small></span></label>
    <div class="row"><button class="btn btn-sm bk-btn-dark" data-ok>Поставить сноску</button><button class="btn btn-sm bk-btn-line" data-close>Отмена</button></div></div>`, { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }, { placement: 'bottom', className: 'bk-pop-open' });
  const ta = p.node.querySelector('textarea'); setTimeout(() => ta.focus(), 20);
  p.node.querySelector('[data-ok]').addEventListener('click', () => {
    const t = ta.value.trim(); if (!t) return;
    const where = p.node.querySelector('[name="fnw"]:checked').value;
    const fn = { id: newId('fn-'), quote, text: t, at: Date.now() };
    if (where === 'me') updateLocal('secret', ctx.cid, ctx.user.id, (s) => { (s.notes[id] ||= []).push(fn); });
    else mutateBook(ctx.cid, (b) => { const x = chapterOf(b, n)?.entries.find((y) => y.id === id); if (x) (x.footnotes ||= []).push(fn); });
    p.close();
  });
}
function sealPop(ctx, n, id, anchor) {
  const c = ctx.c;
  const entry = local('secret', ctx.cid, ctx.user.id).inbox?.[id] || chapterOf(ctx.book(), n)?.entries.find((e) => e.id === id);
  if (!entry) return;
  const next = (ctx.book().chapters.at(-1)?.n || n) + 1;
  const scenes = c.scenes.filter((s) => s.id !== c.activeSceneId);
  const p = popover(html`<div class="bk-pop bk-seal-pop"><div class="row"><span class="bk-wax">${ic('square-lock-02', 18)}</span><span><b class="bk-serif-light">Запечатать в главу</b><small class="bk-muted">Отряд увидит печать на этом месте, но не текст</small></span></div>
    <small class="bk-caps red">печать сломается</small>
    ${scenes.length ? html`<label class="bk-radio"><input type="radio" name="brk" value="scene" checked><span><b>Когда отряд войдёт в <select data-scene>${scenes.map((s) => html`<option value="${s.id}">«${s.name}»</option>`)}</select></b><small>сцена из списка — печать сломается сама</small></span></label>` : ''}
    <label class="bk-radio"><input type="radio" name="brk" value="chapter" ${scenes.length ? '' : 'checked'}><span><b>В начале главы ${ROMAN(next)}</b><small>в первую минуту следующей сессии</small></span></label>
    <label class="bk-radio"><input type="radio" name="brk" value="manual"><span><b>Сломаю сам</b><small>кнопка останется на печати</small></span></label>
    <p class="bk-muted t-xs">Текст печати хранится на этом устройстве — сломать её можно только отсюда.</p>
    <div class="row"><button class="btn btn-sm bk-btn-dark" data-ok>Запечатать</button><button class="btn btn-sm bk-btn-line" data-close>Отмена</button></div></div>`, anchor, { placement: 'left', className: 'bk-pop-open' });
  p.node.querySelector('[data-ok]').addEventListener('click', () => {
    const v = p.node.querySelector('[name="brk"]:checked').value;
    const sid = p.node.querySelector('[data-scene]')?.value;
    const breakOn = v === 'scene' && sid ? `scene:${sid}` : v === 'chapter' ? `chapter:${next}` : 'manual';
    sealEntry(ctx.cid, ctx.user.id, { ...entry, n }, breakOn, sealWhen(c, { breakOn }));
    p.close(); ctx.toast({ title: 'Запечатано', body: `Печать сломается ${sealWhen(c, { breakOn })}`, icon: 'square-lock-02' });
  });
}
export { esc, raw, getCampaign, writeEntry, sessionLive, caps, characterOf };
