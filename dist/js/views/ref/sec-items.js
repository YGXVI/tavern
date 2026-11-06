// Справочник, магические предметы (#203): сокровищница по редкости с подбором и страница предмета —
// камень редкости, паспорт, английский текст SRD целиком (или ссылка на источник) и лестница редкости.
import { html, plural } from '../../core/dom.js';
import { norm } from './data.js';
import { reflow } from './class-text.js';
import { ic, sec, srdText, crumbs, sideFilters, countLine } from './rx.js';

export const RARITY = [['Обычный', '#b4bccb'], ['Необычный', '#6ad3a1'], ['Редкий', '#6fa8e8'], ['Очень редкий', '#b08cf5'], ['Легендарный', '#efb456'], ['Артефакт', '#ef7a52'], ['Редкость варьируется', '#e88fcf'], ['Не имеет редкости', '#7a8094']];
const TYPE_IC = { 'Чудесный предмет': 'sparkles', 'Оружие': 'sword-01', 'Доспех': 'shield-01', 'Кольцо': 'circle', 'Зелье': 'potion', 'Посох': 'magic-wand-01', 'Волшебная палочка': 'magic-wand-01', 'Жезл': 'magic-wand-01', 'Свиток': 'scroll' };
const href = (it) => `#/ref/items/${encodeURIComponent(it.id)}`;
const rc = (it) => RARITY.find((r) => r[0] === it.rarity)?.[1] || '#7a8094';
const icOf = (it) => TYPE_IC[it.type] || 'gem';
const short = (r) => ({ 'Редкость варьируется': 'Варьируется', 'Не имеет редкости': 'Без редкости' }[r] || r);

const matches = (it, q, text) => {
  const r = q.getAll('rar'); if (r.length && !r.includes(it.rarity)) return false;
  const t = q.getAll('type'); if (t.length && !t.includes(it.type)) return false;
  if (q.get('att') && !it.attune) return false;
  if (q.get('txt') && !it.text) return false;
  if (text && !it.hay.includes(norm(text))) return false;
  return true;
};
const row = (it) => html`<a class="rx-row it-row" href="${href(it)}"><i class="rx-dot gem" style="background:${rc(it)}"></i>
  <span class="rx-name"><b>${it.name}</b><small>${it.en}</small></span><span class="rx-col">${it.type}</span><span class="rx-col">${it.attune ? 'настройка' : ''}</span>
  <span class="rx-marks">${it.text ? html`<abbr title="Полный текст SRD">T</abbr>` : ''}</span></a>`;
const card = row;
export function grid(items, q, text = '') {
  const on = items.filter((it) => matches(it, q, text));
  return html`${countLine(on.length, items.length, 'предметов')}
    ${on.length ? html`<div class="rx-head it-row"><span></span><span>Название</span><span>Вид</span><span>Настройка</span><span></span></div>` : html`<p class="ref-empty">Таких нет — снимите один из фильтров.</p>`}
    ${RARITY.map(([r, c]) => { const list = on.filter((it) => it.rarity === r); return list.length ? html`<section class="rx-group"><h3><i class="rx-dot gem" style="background:${c}"></i>${r}<small>${list.length}</small></h3>${list.map(row)}</section>` : ''; })}`;
}
export function gallery(items, q, text, top) {
  const count = (fn) => items.filter(fn).length;
  const types = [...new Set(items.map((it) => it.type).filter(Boolean))];
  return html`<main class="page cls-gallery rx-clean">${top}
    <header class="rx-title"><h1>Магические предметы</h1><p>Цвет — редкость. Полный текст SRD — у ${count((it) => it.text)} из ${items.length}.</p></header>
    <div class="rx-split">
      ${sideFilters([
        { key: 'rar', label: 'Редкость', multi: true, options: RARITY.map(([r, c]) => [r, short(r), c, count((it) => it.rarity === r)]) },
        { key: 'type', label: 'Вид', multi: true, options: types.map((t) => [t, t, null, count((it) => it.type === t)]) },
        { key: 'att', label: 'Свойства', options: [['1', 'Нужна настройка', null, count((it) => it.attune), 'att'], ['1', 'Есть полный текст', null, count((it) => it.text), 'txt']] },
      ], q)}
      <div class="rx-main" data-rx-grid>${grid(items, q, text)}</div>
    </div>
    <p class="ref-foot">Названия, вид и редкость — открытый индекс dnd.su; полный текст — SRD 5.1 (CC BY 4.0) на английском. Т — есть текст.</p>
  </main>`;
}
export function page(it, items, q, o = {}) {
  const c = rc(it);
  const paras = it.text ? it.text.slice(1).flatMap((p) => reflow(p)) : [];
  const near = items.filter((x) => x !== it && x.type === it.type && x.rarity === it.rarity).slice(0, 8);
  const ri = RARITY.findIndex((r) => r[0] === it.rarity);
  return html`<div class="cls-page" style="--c:${c}">
    ${o.modal ? '' : crumbs('items', 'Все предметы', it, items, href)}
    <div class="cls-main">
      <div class="cls-left">
        <header class="cls-hero rl-hero">
          <div class="cls-hero-text"><small class="cls-over">${it.type} · ${it.rarity}</small><h1>${it.name} <span>${it.en}</span></h1>
            ${it.text ? html`<p class="cls-tagline" lang="en">${it.text[0]}</p>` : ''}
            <div class="ref-chips">${it.attune ? html`<span class="chip chip-md">${ic('link-04', 14)}Нужна настройка${it.attuneText ? ` · ${it.attuneText}` : ''}</span>` : html`<span class="chip chip-md">Без настройки</span>`}</div>
            ${o.modal ? '' : html`<div class="cls-hero-actions"><button class="icon-btn icon-btn-sm" data-fav="${o.key}" aria-pressed="${!!o.fav}" aria-label="Избранное">${ic(o.fav ? 'star' : 'favourite', 18)}</button><button class="icon-btn icon-btn-sm" data-share="${o.key}" aria-label="Скопировать ссылку">${ic('link-01', 18)}</button></div>`}</div>
          <div class="it-bigem">${ic(icOf(it), 64)}</div>
        </header>
        ${sec('text', 'Описание', it.text ? 'SRD 5.1 на английском — целиком' : '', it.text ? srdText(paras, `SRD · ${it.en}`) : html`<div class="cls-box sp-nosrd"><h3>${ic('book-open-01', 18)}Текста в открытых правилах нет</h3><p class="t-sm muted">Предмет не входит в SRD 5.1 — открыт только паспорт: тип, редкость, настройка.</p>${it.link ? html`<a class="btn btn-secondary btn-sm" href="${it.link}" target="_blank" rel="noopener noreferrer">${ic('arrow-right-02')}Карточка на dnd.su</a>` : ''}</div>`)}
        ${!o.modal && near.length ? sec('near', 'Того же вида и редкости', `${near.length}`, html`<div class="rx-group">${near.map(card)}</div>`) : ''}
      </div>
      ${o.modal ? '' : html`<aside class="cls-side"><div class="cls-now"><p class="cls-now-hint">Лестница редкости</p>
        <ol class="it-ladder">${RARITY.slice(0, 6).map(([r, col], i) => html`<li class="${i === ri ? 'on' : ''}" style="--k:${col}"><i></i><b>${r}</b><span>${items.filter((x) => x.rarity === r).length}</span></li>`)}</ol>
        ${ri > 5 ? html`<p class="t-sm muted">${it.rarity} — у предметов, чья сила зависит от варианта (например, +1, +2 или +3).</p>` : ''}
        <p class="t-xs tertiary">Настройка: короткий отдых рядом с предметом; одновременно — не больше трёх.</p></div></aside>`}
    </div>
  </div>`;
}

export { icOf as itemIcon };
