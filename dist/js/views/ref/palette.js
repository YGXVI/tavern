// Поиск по всему справочнику — Ctrl K (#203, макет 84): разделы, опечатки и раскладка, превью справа.
import { html, raw, esc } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { SECTIONS, loadAll, loadSection, sectionNow, search, norm } from './data.js';
import { preview, artwork } from './cards.js';

let open = null;
const ic = (n, s = 16) => raw(icon(n, s));

/** Открыть поиск. onPick(item) — что сделать с выбранным (по умолчанию — перейти на карточку). */
export function openPalette(q0 = '', { onPick } = {}) {
  if (open) { open.input.value = q0 || open.input.value; open.input.focus(); open.run(); return open; }
  const root = document.createElement('div');
  root.className = 'ref-pal-root';
  root.innerHTML = String(html`<div class="ref-pal panel" role="dialog" aria-modal="true" aria-label="Поиск по справочнику">
    <div class="ref-pal-top">${ic('search-01', 20)}<input data-q value="${q0}" placeholder="Заклинание, существо, правило…" aria-label="Что найти" autocomplete="off" spellcheck="false"><button class="icon-btn ref-pal-close" data-pal-close aria-label="Закрыть поиск">${ic('cancel-01', 20)}</button></div>
    <div class="ref-pal-hint" hidden></div>
    <div class="ref-pal-body"><div class="ref-pal-list" role="listbox"></div><div class="ref-pal-preview"></div></div>
    <div class="ref-pal-foot"><span><kbd>↑ ↓</kbd> выбрать</span><span><kbd>Enter</kbd> открыть</span><span><kbd>Tab</kbd> следующий раздел</span><span><kbd>/</kbd> поиск в любом месте</span></div>
  </div>`);
  document.body.append(root);
  const input = root.querySelector('[data-q]'), list = root.querySelector('.ref-pal-list'), pv = root.querySelector('.ref-pal-preview'), hint = root.querySelector('.ref-pal-hint');
  let flat = [], cur = 0;
  const pick = (it) => { close(); if (onPick) onPick(it); else location.hash = `#/ref/${it.section}/${encodeURIComponent(it.id)}`; };
  const draw = () => {
    list.querySelectorAll('[data-i]').forEach((b) => b.setAttribute('aria-selected', String(Number(b.dataset.i) === cur)));
    list.querySelector(`[data-i="${cur}"]`)?.scrollIntoView({ block: 'nearest' });
    const it = flat[cur];
    pv.innerHTML = it ? String(html`${preview(it)}<div class="row ref-pal-go"><button class="btn btn-secondary btn-sm" data-go>${ic('arrow-right-02')}Открыть</button></div>`) : '';
  };
  const run = () => {
    const q = input.value;
    flat = []; const groups = [];
    let alt = null, typo = false;
    for (const s of SECTIONS) {
      const items = sectionNow(s.id); if (!items) continue;
      const r = search(items, q, norm(q) ? 6 : 0);
      if (r.alt) alt = r.alt; if (r.typo) typo = true;
      if (r.list.length) { groups.push([s, r.list]); flat.push(...r.list); }
    }
    cur = Math.min(cur, Math.max(0, flat.length - 1));
    hint.hidden = !(alt || typo);
    const top = flat[0];
    hint.innerHTML = alt ? String(html`${ic('sparkles', 14)}Похоже на другую раскладку — ищем «${alt}»`) : typo && top ? String(html`${ic('sparkles', 14)}Похоже на опечатку — ищем «${top.name.toLowerCase()}»${top.en ? html` и «${top.en.toLowerCase()}»` : ''}`) : '';
    let i = 0;
    list.innerHTML = norm(q)
      ? (groups.length ? groups.map(([s, items]) => html`<div class="ref-pal-group">${s.name}</div>${items.map((it) => html`<button class="ref-pal-row" data-i="${i++}" role="option">${artwork(it, 'ref-pal-thumb') || ic(s.icon)}<span><b>${it.name}</b><small>${[it.en, it.sub].filter(Boolean).join(' · ')}</small></span>${i === 1 ? html`<kbd>Enter</kbd>` : ''}</button>`)}`).map(String).join('') : '<p class="ref-pal-empty">Ничего не нашлось. Попробуйте по-английски или короче.</p>')
      : String(html`<div class="ref-pal-group">Разделы</div>${SECTIONS.map((s) => html`<a class="ref-pal-row" href="#/ref/${s.id}">${ic(s.icon)}<span><b>${s.name}</b><small>${s.hint}</small></span></a>`)}`);
    draw();
  };
  const close = () => { root.remove(); removeEventListener('keydown', onKey, true); open = null; };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.target.closest('[data-pal-close]')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); cur = Math.min(flat.length - 1, cur + 1); draw(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); cur = Math.max(0, cur - 1); draw(); }
    if (e.key === 'Tab' && flat.length) {
      e.preventDefault();
      const s = flat[cur]?.section; const nxt = flat.findIndex((x, k) => k > cur && x.section !== s);
      cur = nxt >= 0 ? nxt : 0; draw();
    }
    if (e.key === 'Enter' && flat[cur]) { e.preventDefault(); pick(flat[cur]); }
  };
  addEventListener('keydown', onKey, true);
  root.querySelector('[data-pal-close]').addEventListener('click', close);
  input.addEventListener('input', () => { cur = 0; run(); });
  root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
  list.addEventListener('mousemove', (e) => { const b = e.target.closest('[data-i]'); if (b && Number(b.dataset.i) !== cur) { cur = Number(b.dataset.i); draw(); } });
  list.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) pick(flat[Number(b.dataset.i)]); else if (e.target.closest('a')) close(); });
  pv.addEventListener('click', (e) => { if (e.target.closest('[data-go]') && flat[cur]) pick(flat[cur]); });
  // Разделы догружаются в фоне: результаты дополняются по мере готовности.
  for (const s of SECTIONS) if (!sectionNow(s.id)) loadSection(s.id).then(() => open && run(), () => {});
  loadAll().catch(() => {});
  open = { input, run, close };
  run();
  input.focus(); input.select();
  return open;
}

/** Горячие клавиши справочника на экране: Ctrl K и «/». Возвращает функцию снятия. */
export function bindPaletteKeys({ slash } = {}) {
  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK')) { e.preventDefault(); openPalette(); return; }
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') && !document.activeElement?.isContentEditable) {
      e.preventDefault(); if (slash) slash(); else openPalette();
    }
  };
  addEventListener('keydown', onKey);
  return () => removeEventListener('keydown', onKey);
}
export const paletteOpen = () => !!open;
export { esc };
