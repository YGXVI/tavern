// Справочник, магические предметы (#203): сокровищница по редкости с подбором и страница предмета —
// камень редкости, паспорт, английский текст SRD целиком (или ссылка на источник) и лестница редкости.
import { html, plural } from '../../core/dom.js';
import { norm } from './data.js';
import { reflow } from './class-text.js';
import { ic, sec, pickRow, switchRow, galleryHead, resultLine, srdText, crumbs } from './rx.js';

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
function card(it) {
  return html`<a class="it-card" href="${href(it)}" style="--c:${rc(it)}"><span class="it-gem">${ic(icOf(it), 18)}</span><span class="it-t"><b>${it.name}</b><small>${it.en}</small></span>
    <span class="it-tags">${it.attune ? html`<i title="Нужна настройка">${ic('link-04', 11)}</i>` : ''}${it.text ? html`<i class="srd" title="Текст SRD">${ic('book-open-01', 11)}</i>` : ''}</span><em>${it.type}</em></a>`;
}
export function grid(items, q, text = '') {
  const on = items.filter((it) => matches(it, q, text));
  const keys = ['rar', 'type', 'att', 'txt'];
  if (q.get('view') === 'table') {
    return html`${resultLine(on, items.length, q, keys, text, href)}<div class="cls-compare-wrap"><table class="cls-compare"><thead><tr><th>Предмет</th><th>Тип</th><th>Редкость</th><th>Настройка</th><th>Текст</th></tr></thead>
      <tbody>${on.map((it) => html`<tr style="--c:${rc(it)}"><td><a class="cls-compare-name" href="${href(it)}"><span><b>${it.name}</b><small>${it.en}</small></span></a></td><td>${it.type}</td><td><span class="it-rar">${it.rarity}</span></td><td>${it.attune ? 'да' : '—'}</td><td>${it.text ? 'SRD' : '—'}</td></tr>`)}</tbody></table></div>`;
  }
  return html`${resultLine(on, items.length, q, keys, text, href)}${RARITY.map(([r, c]) => { const list = on.filter((it) => it.rarity === r); return list.length ? html`<section class="sp-level it-level" style="--c:${c}"><h3><span class="it-dot"></span>${r}<small>${list.length}</small></h3><div class="sp-grid">${list.map(card)}</div></section>` : ''; })}`;
}
export function gallery(items, q, text, top) {
  const types = [...new Set(items.map((it) => it.type).filter(Boolean))];
  return html`<main class="page cls-gallery">${top}
    ${galleryHead('Магические предметы', `${items.length} предметов, у ${items.filter((it) => it.text).length} — полный текст SRD. Цвет — редкость: от серого «обычного» до огненного артефакта.`, q)}
    <section class="cls-pick" aria-label="Подбор предметов">
      ${pickRow('rar', 'Редкость', 'gem', RARITY.map(([r, c]) => [r, short(r), c]), q, { multi: true })}
      ${pickRow('type', 'Вид', 'sparkles', types.map((t) => [t, t]), q, { multi: true })}
      ${switchRow('att', 'Настройка', 'link-04', 'только с настройкой', q)}
      ${switchRow('txt', 'Текст', 'book-open-01', 'с полным текстом SRD', q)}
    </section>
    <div data-rx-grid>${grid(items, q, text)}</div>
    <p class="ref-foot">Названия, тип и редкость — открытый индекс dnd.su; полный текст — SRD 5.1 (CC BY 4.0) на английском.</p>
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
        ${near.length ? sec('near', 'Того же вида и редкости', `${near.length}`, html`<div class="sp-grid">${near.map(card)}</div>`) : ''}
      </div>
      <aside class="cls-side"><div class="cls-now"><p class="cls-now-hint">Лестница редкости</p>
        <ol class="it-ladder">${RARITY.slice(0, 6).map(([r, col], i) => html`<li class="${i === ri ? 'on' : ''}" style="--k:${col}"><i></i><b>${r}</b><span>${items.filter((x) => x.rarity === r).length}</span></li>`)}</ol>
        ${ri > 5 ? html`<p class="t-sm muted">${it.rarity} — у предметов, чья сила зависит от варианта (например, +1, +2 или +3).</p>` : ''}
        <p class="t-xs tertiary">Настройка: короткий отдых рядом с предметом; одновременно — не больше трёх.</p></div></aside>
    </div>
  </div>`;
}
