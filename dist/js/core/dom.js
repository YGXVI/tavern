// Мелкие помощники для DOM. Без фреймворка: проект buildless (DEC-002).

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Шаблон с экранированием: html`<b>${name}</b>`. Вложенные html`` и raw() не экранируются. */
export class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v instanceof Raw) out += v.s;
    else if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.s : esc(x))).join('');
    else if (v === false || v === null || v === undefined) out += '';
    else out += esc(v);
    out += strings[i + 1];
  }
  return raw(out);
}

/** Создать элемент из html-строки (один корневой узел). */
export function el(markup) {
  const t = document.createElement('template');
  t.innerHTML = String(markup).trim();
  return t.content.firstElementChild;
}

export function uid(prefix = '') {
  const a = crypto.getRandomValues(new Uint32Array(2));
  return prefix + a[0].toString(36) + a[1].toString(36).slice(0, 4);
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function throttle(fn, ms) {
  let last = 0, t = null, pending = null;
  return (...args) => {
    const now = performance.now();
    pending = args;
    if (now - last >= ms) { last = now; fn(...args); pending = null; }
    else if (!t) t = setTimeout(() => { t = null; last = performance.now(); if (pending) fn(...pending); pending = null; }, ms - (now - last));
  };
}

/** Делегирование событий: on(root, 'click', '[data-act]', (e, target) => …) */
export function on(root, type, selector, handler, opts) {
  const fn = (e) => {
    const t = e.target.closest?.(selector);
    if (t && root.contains(t)) handler(e, t);
  };
  root.addEventListener(type, fn, opts);
  return () => root.removeEventListener(type, fn, opts);
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export const fmtMod = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

export function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'только что';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} ${plural(m, 'минуту', 'минуты', 'минут')} назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${plural(h, 'час', 'часа', 'часов')} назад`;
  const d = Math.round(h / 24);
  return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
}

export function initials(name) {
  return String(name || '?').trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

/** Детерминированный цвет из строки — для аватаров пользователей без картинки. */
export function hueOf(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}
