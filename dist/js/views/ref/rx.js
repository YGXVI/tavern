// Справочник (#203): общий каркас разделов в духе страницы классов — галерея с подбором, страница записи,
// инструмент сбоку с ползунками. Внешний вид — классы cls-* из pages.css (общие для всех разделов).
// Инструмент: <div data-rx="<раздел>" data-sec data-id data-state='{…}'> — поля [data-rx-in] меняют состояние,
// пересобирается только [data-rx-out], поэтому ползунок не теряется во время перетаскивания.
import { html, raw } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { sectionNow } from './data.js';

export const ic = (n, s = 16) => raw(icon(n, s));
export const TOOLS = {};

/** Блок страницы: заголовок, подсказка, содержимое. */
export const sec = (id, title, hint, body) => html`<section class="cls-sec" id="rx-${id}"><header class="cls-sec-head"><h2>${title}</h2>${hint ? html`<p>${hint}</p>` : ''}</header>${body}</section>`;

/** Чипы подбора в адресе: one — одно значение (повторный клик снимает), multi — несколько. */
export function pickRow(key, label, iconName, options, q, { multi = false } = {}) {
  const vals = multi ? q.getAll(key) : [q.get(key)];
  return html`<div class="cls-pick-q"><small>${ic(iconName, 14)}${label}</small><div class="ref-chips">${options.map(([v, l, color]) => html`<button class="chip chip-md ${color ? 'rx-color-chip' : ''}" ${color ? raw(`style="--dot:${color}"`) : ''} ${raw(multi ? 'data-qmulti' : 'data-qtoggle')}="${key}" data-v="${v}" aria-pressed="${vals.includes(String(v))}">${l}</button>`)}</div></div>`;
}
export function switchRow(key, label, iconName, text, q) {
  return html`<label class="cls-pick-q cls-pick-easy"><small>${ic(iconName, 14)}${label}</small><span class="row"><input type="checkbox" class="switch" data-qswitch="${key}" ${q.get(key) ? 'checked' : ''}><span class="t-sm">${text}</span></span></label>`;
}
/** Шапка галереи: заголовок, лид, переключатель «Карточки / Сравнить». */
export function galleryHead(title, lead, q, { compare = true } = {}) {
  const view = q.get('view');
  return html`<header class="cls-gal-head"><div><h1>${title}</h1><p>${lead}</p></div>
    ${compare ? html`<div class="h-seg cls-gal-view"><button data-qtoggle="view" data-v="" aria-selected="${view !== 'table'}">${ic('grid-02', 16)}Карточки</button><button data-qtoggle="view" data-v="table" aria-selected="${view === 'table'}">${ic('menu-01', 16)}Таблица</button></div>` : ''}</header>`;
}
export const picked = (q, keys) => keys.some((k) => q.getAll(k).length);
export function resultLine(on, total, q, keys, text, link) {
  if (!picked(q, keys) && !text) return '';
  return html`<p class="cls-result">${on.length ? html`Подходят <b>${on.length}</b> из ${total}${on.length <= 12 ? html`: ${on.map((it, i) => html`${i ? ', ' : ''}<a href="${link(it)}">${it.name}</a>`)}` : ''}` : 'Таких нет — снимите одно из условий.'}
    <button class="link-btn" data-qclear="${keys.join(',')}">Сбросить</button></p>`;
}

/** Английский текст SRD — сразу видно, без раскрывашек. */
export function srdText(paras, label = 'SRD 5.1') {
  const list = (Array.isArray(paras) ? paras : [paras]).filter(Boolean);
  if (!list.length) return '';
  return html`<div class="cls-srd"><small>${ic('book-open-01', 12)}${label}</small><div lang="en">${list.map((p) => (typeof p === 'object' && p.h ? html`<h5>${p.h}</h5>` : html`<p>${typeof p === 'object' ? p.p : p}</p>`))}</div></div>`;
}

/** Инструмент сбоку: управление + вывод. tool = { controls(it, st), out(it, st) }. */
export function toolBox(section, it, st, { title = '', hint = '' } = {}) {
  const t = TOOLS[section];
  if (!t) return '';
  return html`<div class="cls-now rx-tool" data-rx="${section}" data-sec="${it.section}" data-id="${it.id}" data-state="${JSON.stringify(st)}">
    ${title ? html`<p class="cls-now-hint">${title}</p>` : ''}${hint ? html`<p class="t-xs tertiary">${hint}</p>` : ''}
    <div class="rx-controls">${t.controls(it, st)}</div><div data-rx-out>${t.out(it, st)}</div></div>`;
}
/** Ползунок с подписью; значение обновляется на месте. */
export const slider = (key, label, min, max, value, fmt = (v) => v) => html`<label class="rx-slider"><span><small>${label}</small><b data-rx-val="${key}">${fmt(value)}</b></span>
  <input type="range" min="${min}" max="${max}" step="1" value="${value}" data-rx-in="${key}" aria-label="${label}"></label>`;

export function wireRx(host) {
  const rootOf = (t) => t.closest('[data-rx]');
  const itOf = (el) => (sectionNow(el.dataset.sec) || []).find((x) => x.id === el.dataset.id);
  const apply = (el, key, value) => {
    const t = TOOLS[el.dataset.rx]; const it = itOf(el); if (!t || !it) return;
    const prev = JSON.parse(el.dataset.state || '{}');
    const st = t.reduce ? t.reduce(prev, key, value) : { ...prev, [key]: value };
    el.dataset.state = JSON.stringify(st);
    el.querySelectorAll(`[data-rx-val="${key}"]`).forEach((n) => { n.textContent = t.fmt?.[key] ? t.fmt[key](value, st) : value; });
    el.querySelectorAll(`[data-rx-in="${key}"]`).forEach((n) => { if (Number(n.value) !== Number(value)) n.value = value; });
    el.querySelectorAll('[data-rx-set]').forEach((b) => { const [k, v] = b.dataset.rxSet.split(':'); if (k === key) b.setAttribute('aria-pressed', String(String(st[k]) === v)); });
    el.querySelector('[data-rx-out]').innerHTML = String(t.out(it, st));
  };
  const onInput = (e) => { const i = e.target.closest('[data-rx-in]'); if (!i) return; const el = rootOf(i); if (el) apply(el, i.dataset.rxIn, Number(i.value)); };
  const onClick = (e) => {
    const g = e.target.closest('[data-rx-goto]');
    if (g) { document.getElementById(g.dataset.rxGoto)?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); return; }
    const r = e.target.closest('[data-rx-roll]');
    if (r) { const el = rootOf(r); if (el) apply(el, r.dataset.rxRoll, 1 + Math.floor(Math.random() * (Number(r.dataset.max) || 20))); return; }
    onSet(e);
  };
  const onSet = (e) => { const b = e.target.closest('[data-rx-set]'); if (!b) return; const el = rootOf(b); if (!el) return; const [k, v] = b.dataset.rxSet.split(':'); apply(el, k, Number.isNaN(Number(v)) ? v : Number(v)); };
  host.addEventListener('input', onInput);
  host.addEventListener('click', onClick);
  return () => { host.removeEventListener('input', onInput); host.removeEventListener('click', onClick); };
}

/** Короткая ссылка назад к разделу и соседи по списку. */
export function crumbs(section, title, it, list, href) {
  const i = list.indexOf(it);
  const prev = i > 0 ? list[i - 1] : null, next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
  return html`<nav class="rx-crumbs"><a href="#/ref/${section}">${ic('arrow-left-02', 14)}${title}</a><span class="spacer"></span>
    ${prev ? html`<a href="${href(prev)}" class="rx-nb">${ic('arrow-left-01', 14)}${prev.name}</a>` : ''}${next ? html`<a href="${href(next)}" class="rx-nb">${next.name}${ic('arrow-right-01', 14)}</a>` : ''}</nav>`;
}

/**
 * Чистая раскладка раздела: фильтры колонкой слева, содержимое справа.
 * groups: [{ key, label, options: [[значение, подпись, цвет?, число?]], multi?, grid? }] — строки-галочки, без чипов.
 */
export function sideFilters(groups, q) {
  const keys = [...new Set(groups.flatMap((g) => g.options.map((o) => o[4] || g.key)))];
  const any = keys.some((k) => q.getAll(k).length);
  return html`<aside class="rx-side" aria-label="Фильтры">
    ${groups.map((g) => {
      const attr = g.multi ? 'data-qmulti' : 'data-qtoggle';
      return html`<div class="rx-fgroup"><small>${g.label}</small><div class="${g.grid ? 'rx-fgrid' : 'rx-flist'}">${g.options.map(([v, l, color, n, key]) => html`<button class="rx-opt" ${raw(attr)}="${key || g.key}" data-v="${v}" aria-pressed="${q.getAll(key || g.key).includes(String(v))}">${color ? html`<i style="background:${color}"></i>` : ''}<span>${l}</span>${n != null ? html`<em>${n}</em>` : ''}</button>`)}</div></div>`;
    })}
    ${any ? html`<button class="link-btn rx-reset" data-qclear="${keys.join(',')}">Сбросить фильтры</button>` : ''}
  </aside>`;
}
/** Строка-счётчик над списком. */
export const countLine = (n, total, what) => html`<p class="rx-count">${n === total ? html`${total} ${what}` : html`<b>${n}</b> из ${total} ${what}`}</p>`;
