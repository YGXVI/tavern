// Книга кампании (#203): общий блокнот фиксированной высоты. Разворот из двух страниц, заметки текут со страницы
// на страницу, листаются стрелками. Любой участник вписывает заметку из блоков «заголовок / текст / цитата»,
// свою — правит и удаляет; мастер может удалить любую. Данные и правила — book-store.js.
import { html, raw, on, esc, plural } from '../../core/dom.js';
import { confirmDialog } from '../../ui/kit.js';
import { readBook, writeNote, deleteNote, canEdit, canDelete, authorName, authorColor, fmtDate } from './book-store.js';
import { ic } from './parts.js';

const TYPES = [['h', 'Заголовок'], ['p', 'Текст'], ['q', 'Цитата']];
const HINT = { h: 'Заголовок', p: 'Что хотите записать…', q: 'Чьи-то слова, надпись, строка из письма' };
const NARROW = '(max-width: 760px)';

let fontsLoaded = false;
function bookFonts() {
  if (fontsLoaded) return; fontsLoaded = true;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=PT+Serif:ital,wght@0,400;0,700;1,400&display=swap';
  document.head.append(l);
}

export function mountTab(ctx, body, tools) {
  bookFonts();
  const offs = [];
  const L = (type, sel, fn) => offs.push(on(body, type, sel, fn));
  let spread = null; // открытый разворот; null — последний
  let spreads = 1;
  let editing = null; // { id, rev } правка своей заметки; {} — новая

  if (tools) tools.innerHTML = String(html`<button class="btn btn-primary btn-sm" data-new>${ic('pencil-edit-02')}Новая заметка</button>`);
  body.innerHTML = String(html`<div class="bk">
    <button class="bk-turn prev" data-turn="-1" aria-label="Предыдущий разворот">${ic('arrow-left-01', 20)}</button>
    <div class="bk-book" data-book>
      <div class="bk-pages" data-pages><div class="bk-flow" data-flow></div></div>
      <span class="bk-pnum left" data-pnum-l></span><span class="bk-pnum right" data-pnum-r></span>
      <form class="bk-sheet" data-sheet hidden></form>
    </div>
    <button class="bk-turn next" data-turn="1" aria-label="Следующий разворот">${ic('arrow-right-01', 20)}</button>
  </div>`);
  const $ = (s) => body.querySelector(s);
  const flow = $('[data-flow]'), pages = $('[data-pages]'), sheet = $('[data-sheet]');

  // ——— Страницы ———
  function renderFlow() {
    const c = ctx.c, notes = readBook(c).notes;
    const n = notes.length;
    flow.innerHTML = String(html`<section class="bk-title-page">
        <small class="bk-caps">книга кампании</small><h1>${c.name}</h1><span class="bk-orn">✦</span>
        <p>${n ? `${n} ${plural(n, 'заметка', 'заметки', 'заметок')} · пишут все за столом` : 'Пустые страницы. Вписывайте что угодно — что случилось, имена, догадки, цитаты. Видят все за столом.'}</p>
      </section>
      ${notes.map((x) => noteBlock(c, x, ctx.user.id))}
      <button type="button" class="bk-more ${n ? '' : 'big'}" data-new>${ic('plus-sign', n ? 14 : 18)}${n ? 'Новая заметка' : 'Вписать первую заметку'}</button>`);
    layout();
  }
  function layout() {
    const W = pages.clientWidth; if (!W) return;
    const per = matchMedia(NARROW).matches ? 1 : 2;
    const stride = W / per;
    const end = flow.querySelector('.bk-more');
    const x = end ? end.getBoundingClientRect().left - flow.getBoundingClientRect().left : 0;
    const last = Math.max(0, Math.floor((x + 1) / stride));
    spreads = Math.floor(last / per) + 1;
    const k = spread === null ? spreads - 1 : Math.min(Math.max(0, spread), spreads - 1);
    flow.style.transform = `translateX(${-k * W}px)`;
    const p = k * per + 1;
    $('[data-pnum-l]').textContent = String(p);
    $('[data-pnum-r]').textContent = per === 2 && p + 1 <= last + 1 ? String(p + 1) : '';
    body.querySelector('[data-turn="-1"]').disabled = k <= 0;
    body.querySelector('[data-turn="1"]').disabled = k >= spreads - 1;
    // Невидимые страницы не должны ловить Tab.
    flow.querySelectorAll('button').forEach((b) => { const r = b.getBoundingClientRect(), box = pages.getBoundingClientRect(); b.tabIndex = r.left >= box.left - 1 && r.right <= box.right + 1 ? 0 : -1; });
  }
  function turn(d) {
    const cur = spread === null ? spreads - 1 : spread;
    const k = Math.min(Math.max(0, cur + d), spreads - 1);
    spread = k === spreads - 1 ? null : k;
    layout();
  }
  L('click', '[data-turn]', (e, b) => turn(Number(b.dataset.turn)));
  const ro = new ResizeObserver(() => layout());
  ro.observe(pages);
  const onKey = (e) => {
    if (!sheet.hidden || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable || document.querySelector('.modal-root')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); turn(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); turn(1); }
  };
  addEventListener('keydown', onKey);

  // ——— Заметки ———
  const openNew = () => openSheet({}, [{ type: 'h', text: '' }, { type: 'p', text: '' }]);
  L('click', '[data-new]', openNew);
  if (tools) offs.push(on(tools, 'click', '[data-new]', openNew));
  L('click', '[data-edit]', (e, b) => {
    const note = readBook(ctx.c).notes.find((x) => x.id === b.closest('[data-note]').dataset.note);
    if (note && canEdit(note, ctx.user.id)) openSheet({ id: note.id, rev: note.rev || 1 }, note.blocks);
  });
  L('click', '[data-del]', async (e, b) => {
    const id = b.closest('[data-note]').dataset.note;
    const note = readBook(ctx.c).notes.find((x) => x.id === id);
    if (!note || !canDelete(ctx.c, note, ctx.user.id)) return;
    const mine = note.userId === ctx.user.id;
    if (!(await confirmDialog({ title: 'Удалить заметку?', body: mine ? 'Её больше никто не увидит.' : `Это заметка: ${authorName(ctx.c, note.userId)}. Её больше никто не увидит.`, ok: 'Удалить', danger: true }))) return;
    deleteNote(ctx.cid, ctx.user.id, id);
  });

  // ——— Лист для записи: лежит поверх правой страницы ———
  function openSheet(target, blocks) {
    editing = target;
    sheet.innerHTML = String(html`<div class="bk-sheet-in">
        <div class="bk-sheet-head"><small class="bk-caps">${target.id ? 'правка заметки' : 'новая заметка'} · видят все</small>
          <span class="bk-seg" role="group" aria-label="Вид блока">${TYPES.map(([t, label]) => html`<button type="button" data-t="${t}" aria-pressed="false">${label}</button>`)}</span></div>
        <div class="bk-ed" data-blocks></div>
        <div class="bk-ed-add"><span>Добавить</span>${TYPES.map(([t, label]) => html`<button type="button" data-add="${t}">${ic('plus-sign', 12)}${label}</button>`)}</div>
      </div>
      <footer class="bk-sheet-foot"><button class="btn btn-sm bk-btn-dark" type="submit">${target.id ? 'Сохранить' : 'Вписать в книгу'}</button><button class="btn btn-sm bk-btn-line" type="button" data-cancel>Отмена</button><small>Ctrl + Enter</small></footer>`);
    const box = sheet.querySelector('[data-blocks]');
    for (const b of blocks.length ? blocks : [{ type: 'p', text: '' }]) box.append(blockEditor(b.type, b.text));
    sheet.hidden = false;
    body.querySelector('.bk').classList.add('writing');
    sheet.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    box.querySelectorAll('textarea').forEach(grow);
    const areas = [...box.querySelectorAll('textarea')];
    const first = areas.find((t) => !t.value) || areas.at(-1);
    setTimeout(() => { first?.focus(); }, 20);
  }
  function closeSheet() { sheet.hidden = true; sheet.innerHTML = ''; editing = null; body.querySelector('.bk')?.classList.remove('writing'); }
  const blocksOf = () => [...sheet.querySelectorAll('[data-b]')].map((x) => ({ type: x.dataset.b, text: x.querySelector('textarea').value }));
  const dirty = () => blocksOf().some((b) => b.text.trim());
  function save() {
    if (!editing) return;
    const blocks = blocksOf();
    if (!blocks.some((b) => b.text.trim())) { sheet.querySelector('textarea')?.focus(); return; }
    const isNew = !editing.id;
    const note = writeNote(ctx.cid, ctx.user.id, { id: editing.id, rev: editing.rev || 0, blocks });
    if (!note) return;
    closeSheet();
    if (isNew) spread = null;
    renderFlow();
  }
  sheet.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  offs.push(on(sheet, 'click', '[data-cancel]', async () => { if (!dirty() || editing?.id || await confirmDialog({ title: 'Не вписывать?', body: 'Написанное пропадёт.', ok: 'Не вписывать', danger: true })) closeSheet(); }));
  offs.push(on(sheet, 'click', '[data-add]', (e, b) => { const row = blockEditor(b.dataset.add, ''); sheet.querySelector('[data-blocks]').append(row); row.querySelector('textarea').focus(); }));
  // Вид блока — кнопками в шапке листа, для блока, где стоит курсор.
  let current = null;
  const markSeg = () => sheet.querySelectorAll('.bk-seg [data-t]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.t === current?.dataset.b)));
  offs.push(on(sheet, 'focusin', 'textarea', (e, t) => { current = t.closest('[data-b]'); markSeg(); }));
  offs.push(on(sheet, 'mousedown', '.bk-seg [data-t]', (e) => e.preventDefault()));
  offs.push(on(sheet, 'click', '.bk-seg [data-t]', (e, b) => {
    if (!current?.isConnected) current = sheet.querySelector('[data-b]:last-child');
    if (!current) return;
    setType(current, b.dataset.t); markSeg(); current.querySelector('textarea').focus();
  }));
  offs.push(on(sheet, 'click', '[data-rm]', (e, b) => { const row = b.closest('[data-b]'); const prev = row.previousElementSibling || row.nextElementSibling; if (sheet.querySelectorAll('[data-b]').length > 1) { row.remove(); prev?.querySelector('textarea')?.focus(); } else row.querySelector('textarea').value = ''; }));
  offs.push(on(sheet, 'input', 'textarea', (e, t) => grow(t)));
  offs.push(on(sheet, 'keydown', 'textarea', (e, t) => {
    const row = t.closest('[data-b]');
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); return; }
    if (e.key === 'Escape') { e.preventDefault(); if (!dirty()) closeSheet(); return; }
    // Enter в заголовке — дальше пишем текст.
    if (e.key === 'Enter' && !e.shiftKey && row.dataset.b === 'h') {
      e.preventDefault();
      let next = row.nextElementSibling;
      if (!(next?.dataset.b === 'p' && !next.querySelector('textarea').value)) { next = blockEditor('p', ''); row.after(next); }
      next.querySelector('textarea').focus(); return;
    }
    // Backspace в пустом блоке — убрать блок.
    if (e.key === 'Backspace' && !t.value && sheet.querySelectorAll('[data-b]').length > 1) {
      e.preventDefault(); const prev = row.previousElementSibling || row.nextElementSibling; row.remove();
      const pt = prev?.querySelector('textarea'); if (pt) { pt.focus(); pt.setSelectionRange(pt.value.length, pt.value.length); }
    }
  }));

  renderFlow();
  document.fonts?.ready.then(() => layout());
  return {
    update() { renderFlow(); },
    route() { renderFlow(); },
    unmount() { ro.disconnect(); removeEventListener('keydown', onKey); for (const off of offs) off(); if (tools) tools.innerHTML = ''; },
  };
}

function blockEditor(type, text) {
  const row = document.createElement('div');
  row.className = 'bk-ed-b';
  row.innerHTML = String(html`<textarea rows="1" maxlength="6000"></textarea><button type="button" class="bk-ed-rm" data-rm aria-label="Убрать блок" tabindex="-1">${ic('cancel-01', 14)}</button>`);
  row.querySelector('textarea').value = text || '';
  setType(row, type);
  return row;
}
function setType(row, type) {
  row.dataset.b = type;
  const t = row.querySelector('textarea');
  t.setAttribute('aria-label', TYPES.find((x) => x[0] === type)?.[1] || 'Текст');
  t.placeholder = HINT[type];
  grow(t);
}
function grow(t) { t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }

/** Заметка на странице: подпись автора, затем блоки. */
function noteBlock(c, note, me) {
  const acts = [canEdit(note, me) ? html`<button type="button" data-edit>Править</button>` : '', canDelete(c, note, me) ? html`<button type="button" data-del>Удалить</button>` : ''];
  return html`<article class="bk-note" data-note="${note.id}" style="--c:${authorColor(c, note.userId)}">
    <header class="bk-note-meta"><i></i><b>${authorName(c, note.userId)}</b><span>${fmtDate(note.at, { time: true })}${note.edited ? ' · изменено' : ''}</span>${acts.some(Boolean) ? html`<span class="bk-note-acts">${acts}</span>` : ''}</header>
    ${note.blocks.map((b) => (b.type === 'h' ? html`<h3>${b.text}</h3>` : b.type === 'q' ? html`<blockquote>${paras(b.text)}</blockquote>` : paras(b.text)))}
  </article>`;
}
/** Абзацы: пустая строка — новый абзац, перенос — перенос. */
function paras(text) {
  return raw(String(text).trim().split(/\n\s*\n/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join(''));
}
