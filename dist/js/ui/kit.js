// Компоненты интерфейса на строках: тосты, модальные окна, поповеры, меню, подсказки.
import { el, esc, html, raw, initials } from '../core/dom.js';
import { icon } from '../icons.js';
import { srcOf } from '../core/assets.js';

// ——— Аватары ———
export function userAvatar(u, cls = '', status = null) {
  const hue = u?.hue ?? 210;
  const st = status === null ? '' : `<span class="status ${status ? 'online' : ''}"></span>`;
  return raw(`<span class="avatar ${cls}" style="background:hsl(${hue} 42% 38%)" title="${esc(u?.name || '')}">${esc(initials(u?.name))}${st}</span>`);
}

export function portrait(ref, cls = '', title = '', status = null) {
  const src = srcOf(ref);
  const st = status === null ? '' : `<span class="status ${status ? 'online' : ''}"></span>`;
  if (!src) return raw(`<span class="avatar ${cls}" title="${esc(title)}">${esc(initials(title))}${st}</span>`);
  return raw(`<span class="avatar ${cls}" title="${esc(title)}"><img src="${esc(src)}" alt="" loading="lazy" draggable="false">${st}</span>`);
}

// ——— Тосты ———
let toastRoot = null;
function toastHost() {
  if (!toastRoot || !document.body.contains(toastRoot)) {
    toastRoot = el('<div class="toasts" role="status" aria-live="polite"></div>');
    document.body.append(toastRoot);
  }
  return toastRoot;
}

/**
 * toast({title, body, icon, avatar, result, action:{label, onClick}, timeout})
 * Возвращает функцию закрытия.
 */
export function toast(opts) {
  const o = typeof opts === 'string' ? { title: opts } : opts;
  const lead = o.avatar ? o.avatar : o.icon ? raw(`<span class="icon-wrap">${icon(o.icon, 20)}</span>`) : '';
  const node = el(html`<div class="toast panel">${lead}<div class="titles"><div class="title">${o.title}</div>${o.body ? html`<div class="body">${o.body}</div>` : ''}</div>${o.result !== undefined ? html`<div class="result">${o.result}</div>` : ''}${o.action ? html`<button class="btn btn-sm btn-secondary" data-act>${o.action.label}</button>` : ''}</div>`);
  const close = () => { node.classList.add('leaving'); setTimeout(() => node.remove(), 200); };
  node.querySelector('[data-act]')?.addEventListener('click', () => { o.action.onClick?.(); close(); });
  const host = o.host || toastHost();
  host.append(node);
  while (host.children.length > 4) host.firstElementChild.remove();
  if (o.timeout !== 0) setTimeout(close, o.timeout || (o.action ? 9000 : 4200));
  return close;
}

// ——— Модальные окна ———
const openModals = [];
export function modal(content, { wide = false, onClose, dismissable = true, className = '' } = {}) {
  const root = el(`<div class="modal-root" role="dialog" aria-modal="true"></div>`);
  const box = el(`<div class="modal panel ${wide ? 'wide' : ''} ${className}"></div>`);
  if (typeof content === 'string' || content?.s) box.innerHTML = String(content);
  else box.append(content);
  root.append(box);
  document.body.append(root);
  const api = {
    root, box,
    close() { if (!root.isConnected) return; root.remove(); openModals.splice(openModals.indexOf(api), 1); onClose?.(); },
    set(contentHtml) { box.innerHTML = String(contentHtml); },
  };
  openModals.push(api);
  if (dismissable) root.addEventListener('pointerdown', (e) => { if (e.target === root) api.close(); });
  box.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) api.close(); });
  setTimeout(() => box.querySelector('[autofocus]')?.focus() ?? box.querySelector('input,button')?.focus(), 30);
  return api;
}
export function closeTopModal() { const m = openModals.at(-1); if (m) { m.close(); return true; } return false; }
export const hasModal = () => openModals.length > 0;

export function panelHeader(title, subtitle = '', extra = '') {
  return html`<div class="panel-header"><div class="titles"><div class="title lg">${title}</div>${subtitle ? html`<div class="subtitle">${subtitle}</div>` : ''}</div>${raw(String(extra))}<button class="icon-btn icon-btn-sm" data-close aria-label="Закрыть">${raw(icon('cancel-01', 18))}</button></div>`;
}

export function confirmDialog({ title, body, ok = 'Подтвердить', danger = false }) {
  return new Promise((resolve) => {
    const m = modal(html`${panelHeader(title)}<div class="panel-section t-para muted">${body}</div><div class="panel-footer"><span class="spacer"></span><button class="btn btn-ghost" data-close>Отмена</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${ok}</button></div>`,
      { onClose: () => resolve(false) });
    m.box.querySelector('[data-ok]').addEventListener('click', () => { resolve(true); m.close(); });
  });
}

// ——— Поповеры (привязанные к точке или элементу) ———
let currentPopover = null;
export function closePopover() { if (currentPopover) { const p = currentPopover; currentPopover = null; p.node.remove(); p.onClose?.(); } }
export const popoverOpen = () => !!currentPopover;

/**
 * popover(content, anchor) — anchor: DOMRect | {x, y} (экранные координаты) | Element.
 * placement: 'top' | 'bottom' | 'right' | 'left' | 'auto'
 */
export function popover(content, anchor, { placement = 'auto', className = '', onClose, keepOpen = false, gap = 10 } = {}) {
  closePopover();
  const node = el(`<div class="popover panel ${className}"></div>`);
  if (typeof content === 'string' || content?.s) node.innerHTML = String(content); else node.append(content);
  node.style.visibility = 'hidden';
  document.body.append(node);
  const rect = anchor instanceof Element ? anchor.getBoundingClientRect() : anchor.width !== undefined ? anchor : { left: anchor.x, top: anchor.y, right: anchor.x, bottom: anchor.y, width: 0, height: 0 };
  place(node, rect, placement, gap);
  node.style.visibility = '';
  const p = { node, onClose };
  currentPopover = p;
  node.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closePopover(); });
  if (!keepOpen) {
    const away = (e) => {
      if (!node.isConnected) { document.removeEventListener('pointerdown', away, true); return; }
      if (node.contains(e.target) || (anchor instanceof Element && anchor.contains(e.target))) return;
      if (e.target.closest?.('.modal-root, .toasts')) return;
      document.removeEventListener('pointerdown', away, true);
      if (currentPopover === p) closePopover();
    };
    setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
  }
  return { node, close: () => { if (currentPopover === p) closePopover(); }, reposition: () => place(node, rect, placement, gap) };
}

function place(node, rect, placement, gap) {
  const vw = innerWidth, vh = innerHeight, w = node.offsetWidth, h = node.offsetHeight, m = 12;
  const tries = placement === 'auto' ? ['top', 'bottom', 'right', 'left'] : [placement, 'top', 'bottom', 'right', 'left'];
  for (const pl of tries) {
    let x, y;
    if (pl === 'top') { x = rect.left + rect.width / 2 - w / 2; y = rect.top - h - gap; }
    if (pl === 'bottom') { x = rect.left + rect.width / 2 - w / 2; y = rect.bottom + gap; }
    if (pl === 'right') { x = rect.right + gap; y = rect.top + rect.height / 2 - h / 2; }
    if (pl === 'left') { x = rect.left - w - gap; y = rect.top + rect.height / 2 - h / 2; }
    const fits = y >= m && y + h <= vh - m && x >= m && x + w <= vw - m;
    const cx = Math.min(Math.max(x, m), vw - w - m), cy = Math.min(Math.max(y, m), vh - h - m);
    if (fits || pl === tries.at(-1)) { node.style.left = `${cx}px`; node.style.top = `${cy}px`; return; }
    if ((pl === 'top' || pl === 'bottom') && y >= m && y + h <= vh - m) { node.style.left = `${cx}px`; node.style.top = `${y}px`; return; }
  }
}

// ——— Меню ———
/** items: [{icon, label, hint, danger, onClick} | 'divider'] */
export function menu(items, anchor, opts = {}) {
  const body = items.map((it, i) => it === 'divider' ? '<hr>' : `<button class="menu-item ${it.danger ? 'danger' : ''}" data-i="${i}" ${it.disabled ? 'disabled' : ''}>${it.icon ? icon(it.icon, 18) : ''}<span>${esc(it.label)}</span>${it.hint ? `<span class="hint">${esc(it.hint)}</span>` : ''}</button>`).join('');
  const p = popover(`<div class="menu">${body}</div>`, anchor, { placement: opts.placement || 'bottom', gap: 6, ...opts });
  p.node.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const it = items[Number(b.dataset.i)];
    closePopover();
    it.onClick?.();
  });
  return p;
}

// ——— Подсказки по data-tip ———
let tipNode = null, tipTimer = null;
export function initTooltips() {
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest?.('[data-tip]');
    clearTimeout(tipTimer);
    if (!t) { tipNode?.remove(); tipNode = null; return; }
    tipTimer = setTimeout(() => {
      tipNode?.remove();
      const kbd = t.dataset.kbd ? `<kbd>${esc(t.dataset.kbd)}</kbd>` : '';
      tipNode = el(`<div class="tooltip">${esc(t.dataset.tip)}${kbd}</div>`);
      document.body.append(tipNode);
      const r = t.getBoundingClientRect();
      const w = tipNode.offsetWidth, h = tipNode.offsetHeight;
      let x = r.left + r.width / 2 - w / 2, y = r.top - h - 8;
      if (y < 8) y = r.bottom + 8;
      x = Math.min(Math.max(8, x), innerWidth - w - 8);
      tipNode.style.left = `${x}px`; tipNode.style.top = `${y}px`;
    }, 350);
  });
  document.addEventListener('pointerdown', () => { clearTimeout(tipTimer); tipNode?.remove(); tipNode = null; }, true);
}

export function iconBtn(name, tip, attrs = '', cls = '') {
  return raw(`<button class="icon-btn ${cls}" ${tip ? `data-tip="${esc(tip)}" aria-label="${esc(tip)}"` : ''} ${attrs}>${icon(name, 22)}</button>`);
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, () => fallback());
  return Promise.resolve(fallback());
  function fallback() {
    const ta = el('<textarea style="position:fixed;opacity:0"></textarea>');
    ta.value = text; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* */ }
    ta.remove(); return ok;
  }
}
