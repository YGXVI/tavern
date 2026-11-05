// Общие куски экранов героя: шаги, карточки выбора, живой лист, нижняя панель, мелочи (#203).
import { html, raw, esc } from '../../core/dom.js';
import { icon } from '../../icons.js';

export const ic = (name, size = 18) => raw(icon(name, size));
export const chip = (label, kind = '') => html`<span class="chip chip-md ${kind ? `chip-${kind}` : ''}">${label}</span>`;
export const caps = (t, cls = '') => html`<span class="h-caps ${cls}">${t}</span>`;
export const newTag = () => html`<span class="h-new">новое</span>`;

/** Иконки строк листа: заклинание, оружие, умение. */
export const rowIcon = (kind) => ({ spell: 'sparkles', weapon: 'sword-01', feature: 'star', wand: 'magic-wand-01', scroll: 'scroll', book: 'book-open-01', potion: 'potion', bag: 'package', kit: 'backpack-01', tent: 'tent' }[kind] || 'sparkles');

/** Шаги мастера: done / current / next. steps — [{name}], current — индекс; href(i) — адрес шага. */
export function stepper(steps, current, href) {
  return html`<nav class="h-steps" aria-label="Шаги">${steps.map((s, i) => {
    const st = i < current ? 'done' : i === current ? 'current' : 'next';
    return html`${i ? html`<span class="h-link ${i <= current ? 'on' : ''}"></span>` : ''}<a class="h-step ${st}" href="${href(i)}" ${i === current ? raw('aria-current="step"') : ''}><span class="n">${st === 'done' ? ic('tick-02', 14) : i + 1}</span><span class="l">${s.name}</span></a>`;
  })}</nav>`;
}

/** Строка над экраном мастера: назад, шаги, «Черновик сохранён». */
export function pathRow({ back, title = '', steps, current, href, saved = 'Черновик сохранён' }) {
  return html`<div class="h-path">
    <a class="icon-btn icon-btn-sm" href="${back}" aria-label="Назад">${ic('arrow-left-02')}</a>
    ${title ? html`<span class="h-path-title">${title}</span>` : ''}
    ${stepper(steps, current, href)}
    ${saved ? html`<span class="h-saved">${ic('cloud', 16)}${saved}</span>` : ''}
  </div>`;
}

/** Заголовок шага: крупный вопрос, пояснение и подсказка-пилюля справа. */
export function stepTitle(title, hint, tip = '', tipIcon = 'crown') {
  return html`<div class="h-step-title"><div class="t"><h1>${title}</h1><p>${hint}</p></div>${tip ? html`<span class="h-tip">${ic(tipIcon, 16)}${tip}</span>` : ''}</div>`;
}

/** Карточка выбора с картинкой (раса, класс, быстрый герой). */
export function artCard(o, { selected = false, attr = 'data-pick' } = {}) {
  return html`<button class="h-choice ${selected ? 'on' : ''}" ${raw(attr)}="${o.id}" aria-pressed="${selected}">
    <span class="h-choice-art">${o.img ? html`<img src="${o.img}" alt="" loading="lazy">` : ic(o.icon || 'user', 36)}${selected ? html`<span class="h-tick">${ic('tick-02', 14)}</span>` : ''}</span>
    <b>${o.name}</b>${o.sub ? html`<small>${o.sub}</small>` : ''}${o.text ? html`<span class="h-choice-text">${o.text}</span>` : ''}
    ${o.tags?.length ? html`<span class="h-tags">${o.tags.map((t) => chip(t))}</span>` : ''}
  </button>`;
}

/** Карточка выбора с иконкой (путь создания, предыстория, хиты при повышении). */
export function iconCard(o, { selected = false, attr = 'data-pick', cls = '' } = {}) {
  return html`<button class="h-icard ${cls} ${selected ? 'on' : ''}" ${raw(attr)}="${o.id}" aria-pressed="${selected}">
    <span class="h-icard-top"><span class="h-sq">${ic(o.icon || 'star', 20)}</span>${selected ? html`<span class="h-tick">${ic('tick-02', 14)}</span>` : ''}</span>
    <b>${o.name}</b>${o.sub ? html`<small>${o.sub}</small>` : ''}${o.text ? html`<span class="h-icard-text">${o.text}</span>` : ''}
    ${o.tags?.length ? html`<span class="h-tags">${o.tags.map((t) => chip(t))}</span>` : ''}
  </button>`;
}

/** Компактная характеристика (живой лист, повышение): подпись, модификатор, значение. */
export const miniStat = (a) => html`<span class="h-mstat ${a.mod === '—' ? 'empty' : ''}"><span class="k">${a.short}</span><b>${a.mod}</b><small>${a.score}</small></span>`;

/** Крупная характеристика (итог создания, быстрый герой): подпись, модификатор, значение, спасбросок. */
export function bigStat(a) {
  return html`<div class="h-bstat"><span class="k">${a.name || a.short}</span><b>${a.mod}</b><span class="s">${a.score}</span><small class="${a.saveProf ? 'prof' : ''}">Спасбросок ${a.save}</small></div>`;
}

/** Живой лист справа в мастере. live — {name, summary, portrait, stats, facts: [[label, value, isNew]]}. */
export function liveSheet(live, { note = '', gave = [] } = {}) {
  return html`<aside class="h-live" aria-label="Лист героя">
    <div class="h-live-head"><span class="h-portrait ${live.portrait ? 'has' : ''}">${live.portrait ? html`<img src="${live.portrait}" alt="">` : ic('user-group', 26)}</span>
      <span class="who"><b>${live.name}</b><small>${live.summary}</small>${note ? html`<span class="h-master-note">${ic('crown', 12)}${note}</span>` : ''}</span></div>
    <div class="h-live-stats">${live.stats.map(miniStat)}</div>
    <dl class="h-facts">${live.facts.map(([k, v, fresh]) => html`<div class="${v ? '' : 'dim'}"><dt>${k}</dt><dd>${v || '—'}</dd>${fresh ? newTag() : html`<span></span>`}</div>`)}</dl>
    ${gave.length ? html`<div class="h-gave">${caps('Этот шаг дал', 'accent')}<ul>${gave.map((g) => html`<li>${g}</li>`)}</ul></div>` : ''}
  </aside>`;
}

/** Нижняя панель мастера. */
export function bottomBar({ back, backLabel = 'Назад', hint = '', next, nextLabel }) {
  return html`<footer class="h-bottom">
    ${back ? html`<a class="btn btn-secondary" href="${back}">${ic('arrow-left-02')}${backLabel}</a>` : html`<span></span>`}
    <span class="h-bottom-hint">${hint}</span>
    ${next ? html`<a class="btn btn-primary" href="${next}" data-next>${ic('arrow-right-02')}${nextLabel}</a>` : html`<span></span>`}
  </footer>`;
}

/** Плашка-переключатель (сегменты): items — [{id, name, disabled}]. */
export function segmented(items, active, attr = 'data-seg', cls = '') {
  return html`<div class="h-seg ${cls}" role="tablist">${items.map((it) => html`<button role="tab" ${raw(attr)}="${it.id ?? it.name}" aria-selected="${(it.id ?? it.name) === active}" ${it.disabled ? raw('disabled') : ''}>${it.icon ? ic(it.icon, 16) : ''}${it.name}</button>`)}</div>`;
}

/** Галочка-чекбокс в стиле макета (фиолетовая для заклинаний). */
export const check = (on, cls = '') => html`<span class="h-check ${cls} ${on ? 'on' : ''}">${on ? ic('tick-02', 14) : ''}</span>`;

/** Ромбы ячеек и точки умений: left из total. */
export function pips(left, total, kind = 'slot') {
  return html`<span class="h-pips ${kind}">${Array.from({ length: total }, (_, i) => html`<i class="${i < left ? 'on' : ''}"></i>`)}</span>`;
}

/** Большая шапка «итога»: портрет, имя, плашки, характеристики (экраны 53, 77). */
export function summaryHero({ art, badge, name, line, facts, abilities, extra = '' }) {
  return html`<div class="h-summary">
    <figure class="h-summary-art"><img src="${art}" alt=""></figure>
    <section class="h-summary-main">
      <span class="chip chip-md chip-accent h-badge">${ic('tick-02', 14)}${badge}</span>
      <h1 class="h-hero-name">${name}</h1><p class="muted">${line}</p>
      <div class="h-facts5">${facts.map((f) => html`<div>${caps(f.label)}<b>${f.value}</b><small>${f.sub}</small></div>`)}</div>
      <div class="h-bstats">${abilities.map(bigStat)}</div>
      ${raw(String(extra))}
    </section>
  </div>`;
}

export { esc };
