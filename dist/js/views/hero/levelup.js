// Повышение уровня на витринных данных (#203): хиты (74), что нового (75), заклинания в книгу (76), итог (77).
// Уведомление на карте (73) — в sheet.js: #/hero/lira/table?levelup. Адреса: #/hero/<id>/levelup/<hp|new|spells|done>.
import { html, raw } from '../../core/dom.js';
import { appHeader, bindHeader } from '../screens.js';
import { heroView, levelUpView, heroActions } from './contract.js';
import { ic, caps, chip, pathRow, stepTitle, iconCard, miniStat, bottomBar, check, segmented, pips, summaryHero, newTag } from './parts.js';
import { extraBoxes } from './steps.js';
import { draft, saveDraft } from './index.js';

export function mount(root, { parts, L, user }) {
  const [, id = 'lira', , step = 'hp'] = parts;
  const v = heroView(id);
  const lu = levelUpView(id);
  draft.lu ||= {};
  const render = () => {
    // Настоящий герой, которого нельзя повысить (20 уровень, нет класса), — объяснение вместо шагов.
    const content = lu.isLive && !lu.supported ? html`<main class="page h-done-page"><p class="h-info">${ic('alert-circle', 16)}${lu.reason}</p><a class="btn btn-secondary" href="#/hero/${v.id}">${ic('book-open-01')}К листу</a></main>` : body(v, lu, step);
    root.innerHTML = String(html`<div class="screen hero-screen wizard">${appHeader(user, 'heroes')}${content}</div>`);
    bindHeader(root, user);
    const cur = root.querySelector('.h-step.current'); const bar = cur?.closest('.h-steps');
    if (cur && bar) bar.scrollLeft = cur.offsetLeft - bar.clientWidth / 2 + cur.offsetWidth / 2;
  };
  render();
  L('click', '[data-pick]', (e, b) => { draft.lu.hp = b.dataset.pick; saveDraft(); heroActions.levelUp({ heroId: v.id, hp: b.dataset.pick }); render(); });
  L('click', '[data-lu-tab]', (e, b) => { draft.lu.tab = +b.dataset.luTab; saveDraft(); if (lu.isLive) heroActions.levelUp({ heroId: v.id, tab: draft.lu.tab }); render(); });
  L('click', '[data-extra]', (e, b) => heroActions.levelUp({ heroId: v.id, extra: b.dataset.extra }));
  L('click', '[data-lu-spell]', (e, b) => { draft.lu.focus = b.dataset.luSpell; saveDraft(); heroActions.levelUp({ heroId: v.id, spells: [b.dataset.luSpell] }); render(); });
  L('click', '[data-auto]', () => heroActions.levelUp({ heroId: v.id, auto: true }));
  L('click', '[data-finish]', () => heroActions.levelUp({ heroId: v.id, done: true }));
}

function live(v, lu, step) {
  const gave = lu[step]?.gave || [];
  const freshBy = { hp: ['Хиты'], news: ['Умение', 'Готово к бою', 'Ячейки'], spells: ['Книга'] }[step] || [];
  const rows = lu.live.map(([k, val]) => [k, step === 'spells' && k === 'Книга' ? '15 из 16 — Полёт' : val, freshBy.includes(k)]);
  return html`<aside class="h-live" aria-label="Лист героя">
    <div class="h-live-head"><span class="h-portrait has"><img src="${v.portrait}" alt=""></span><span class="who"><b>${v.name}</b><small>${v.race} · ${v.classes[0].name} ${lu.from} → ${lu.to}</small><span class="h-master-note">${ic('crown', 12)}${lu.note}</span></span></div>
    <div class="h-live-stats">${v.abilities.map((a) => miniStat({ short: a.short, mod: a.mod, score: a.score }))}</div>
    <dl class="h-facts">${rows.map(([k, val, fresh]) => html`<div><dt>${k}</dt><dd>${val}</dd>${fresh ? newTag() : html`<span></span>`}</div>`)}</dl>
    ${gave.length ? html`<div class="h-gave">${caps('Этот шаг дал', 'accent')}<ul>${gave.map((g) => html`<li>${g}</li>`)}</ul></div>` : ''}
  </aside>`;
}

function body(v, lu, step) {
  const i = Math.max(0, lu.steps.findIndex((s) => s.id === step));
  const href = (k) => `#/hero/${v.id}/levelup/${lu.steps[k].id}`;
  if (step === 'done') return done(v, lu, href);
  const path = pathRow({ back: `#/hero/${v.id}/table?levelup`, steps: lu.steps, current: i, href });
  const bar = (next, nextLabel, back = i ? href(i - 1) : `#/hero/${v.id}/table`, backLabel = i ? 'Назад' : 'К столу') => bottomBar({ back, backLabel, hint: 'Можно вернуться к столу — повышение подождёт в листе', next, nextLabel });
  let main;
  if (step === 'hp') {
    const h = lu.hp; const sel = draft.lu.hp || 'average';
    main = html`${stepTitle(h.title, h.hint, h.rule, 'dice-faces-06')}<div class="h-grid2 wide">${h.options.map((o) => iconCard(o, { selected: o.id === sel }))}</div>
      <div class="h-hp-compare"><div class="h-kv">${caps(h.now.label)}<b>${h.now.value}</b><small>${h.now.sub}</small></div>${ic('arrow-right-02', 20)}<div class="h-kv">${caps(h.after.label)}<b>${sel === 'roll' ? '23–28' : h.after.value}</b><small>${sel === 'roll' ? 'после броска к6' : h.after.sub}</small></div></div>`;
    return wrap(path, main, live(v, lu, 'hp'), bar(href(1), 'Дальше: что нового'));
  }
  if (step === 'new') {
    const n = lu.news;
    main = html`${stepTitle(n.title, n.hint, n.chip, 'sparkles')}
      <div class="h-group">${caps('Новое умение')}<small>работает само, без действий</small></div>
      <section class="h-feature"><span class="chip chip-md chip-magic">${n.feature.tag}</span><h2>${n.feature.name}</h2><p>${n.feature.text}</p>${n.feature.warn ? html`<p class="h-warn">${ic('alert-circle', 16)}${n.feature.warn}</p>` : ''}</section>
      ${n.extra?.length ? extraBoxes(n.extra) : ''}
      ${n.slots.length ? html`<div class="h-group">${caps('Ячейки заклинаний')}<small>вернутся после долгого отдыха</small></div>` : ''}
      <div class="h-grid3">${n.slots.map((s) => html`<div class="h-slotcard ${s.from !== s.to ? 'on' : ''}"><span>${s.name}</span><small>${s.from === s.to ? s.to : `${s.from} → ${s.to}`}</small>${pips(s.to, s.to, s.from !== s.to ? 'grow' : 'slot')}</div>`)}</div>
      <div class="h-group">${caps('Ещё')}</div><div class="h-grid2">${n.more.map((m) => html`<div class="h-kv">${caps(m.label)}<b>${m.value}</b><small>${m.sub}</small></div>`)}</div>`;
    return wrap(path, main, live(v, lu, 'news'), bar(href(2), 'Дальше: заклинания'));
  }
  const sp = lu.spells; const tab = draft.lu.tab ?? sp.tab; const list = sp.lists ? sp.lists[tab] || [] : sp.list; const focus = draft.lu.focus || list.find((x) => x.focus)?.name;
  const det = sp.live || focus === sp.detail.name || !focus ? sp.detail : { tag: `3 круг`, name: focus, text: sp.list.find((x) => x.name === focus)?.meta || '' };
  main = html`${stepTitle(sp.title, sp.hint, '«Собрать за меня» возьмёт надёжный набор', 'crown')}
    <div class="h-grid3 progress">${sp.progress.map((p) => html`<div class="h-prog">${caps(p.label)}<b>${p.now} из ${p.max}</b><span class="h-bar magic"><i style="width:${Math.round((p.now / p.max) * 100)}%"></i></span></div>`)}</div>
    <div class="h-spell-tools">${segmented(sp.tabs.map((t, k) => ({ id: String(k), name: t })), String(tab), 'data-lu-tab', 'dark')}<button class="btn btn-secondary" data-auto>${ic('magic-wand-01')}Собрать за меня</button></div>
    <div class="h-spell-split"><div class="h-spell-list">${sp.lists ? (list.length ? '' : html`<p class="muted h-pad">${sp.hint}</p>`) : ''}${sp.lists || tab === 2 ? list.map((x) => html`<button class="h-sp ${x.name === focus ? 'focus' : ''}" data-lu-spell="${x.name}">${check(x.on, 'magic')}<span><b>${x.name}</b><small>${x.meta}</small></span>${x.conc ? html`<span class="h-kr k">К</span>` : ''}${x.ritual ? html`<span class="h-kr">Р</span>` : ''}</button>`) : html`<p class="muted h-pad">На ${tab + 1} круге новых заклинаний не берёте — переключитесь на 3 круг или возьмите свиток.</p>`}</div>
      <aside class="h-spell-card"><span class="chip chip-md chip-magic">${det.tag}</span><h2>${det.name}</h2><p>${det.text}</p></aside></div>`;
  return wrap(path, main, live(v, lu, 'spells'), bar(href(3), 'Дальше: итог'));
}

const wrap = (path, main, side, bar) => html`<main class="h-wizard">${path}<div class="h-wiz-grid"><section class="h-wiz-main">${main}</section>${side}</div>${bar}</main>`;

function done(v, lu, href) {
  const d = lu.done;
  if (lu.isLive) {
    const ok = lu.status === 'valid';
    const x = html`<section class="h-checks"><div class="h-box-head">${caps('Что изменится')}<small>${ok ? 'всё готово к записи' : 'вернитесь к шагам'}</small></div><div class="h-tags">${d.changes.map((c) => html`<span class="h-check-chip">${ic('tick-02', 14)}${c}</span>`)}</div></section>
      <p class="h-info">${ic(ok ? 'eye' : 'alert-circle', 16)}${d.note}</p>
      <div class="h-actions"><button class="btn btn-primary btn-lg" data-finish ${ok ? '' : raw('disabled')}>${ic('arrow-right-02')}Записать ${lu.to} уровень</button><a class="btn btn-secondary btn-lg" href="#/hero/${v.id}">${ic('book-open-01')}К листу</a></div>`;
    return html`<main class="page h-done-page">${summaryHero({ art: v.art, badge: `${lu.from} → ${lu.to} уровень`, name: v.name, line: v.fullTitle,
      facts: [{ label: 'Хиты', value: String(d.hp.value), sub: d.hp.sub }, { label: 'Класс доспеха', value: String(v.vitals.ac.value), sub: v.vitals.ac.note }, { label: 'Инициатива', value: v.vitals.init, sub: 'Ловкость' }, { label: 'Скорость', value: v.vitals.speed, sub: 'ходьба' }],
      abilities: v.abilities, extra: x })}</main>`;
  }
  const extra = html`<section class="h-checks"><div class="h-box-head">${caps('Что изменилось')}<small>всё уже в листе</small></div><div class="h-tags">${d.changes.map((c) => html`<span class="h-check-chip">${ic('tick-02', 14)}${c}</span>`)}</div></section>
    <p class="h-info">${ic('eye', 16)}${d.note}</p>
    <div class="h-actions"><a class="btn btn-primary btn-lg" href="#/hero/${v.id}/table" data-finish>${ic('arrow-right-02')}Вернуться к столу</a><a class="btn btn-secondary btn-lg" href="#/hero/${v.id}">${ic('book-open-01')}Открыть лист</a></div>`;
  return html`<main class="page h-done-page">${summaryHero({
    art: v.art, badge: `${lu.to} уровень · готово`, name: v.name, line: `${v.race} · Волшебница ${lu.to} уровня · Школа воплощения · ${v.background} · ${v.alignment}`,
    facts: [{ label: 'Хиты', value: String(d.hp.value), sub: d.hp.sub }, { label: 'Класс доспеха', value: '13', sub: '16 с «Доспехами мага»' }, { label: 'Инициатива', value: v.vitals.init, sub: 'Ловкость' }, { label: 'Сл заклинаний', value: '15', sub: 'атака +7' }, { label: 'Скорость', value: '30 фт', sub: 'ходьба' }],
    abilities: v.abilities, extra,
  })}</main>`;
}

export { chip };
