// Экраны героя на витринных данных (#203): «Мои герои», мастер создания, быстрый герой, импорт LSS, лист, повышение.
// Адреса:
//   #/heroes                              — мои герои (88)
//   #/hero/new                            — как привести героя (45)
//   #/hero/new/<шаг>                      — пошагово: race, class, abilities, background, equipment, spells, look (46–52)
//   #/hero/new/done                       — героиня готова (53)
//   #/hero/quick/<1|2|3|done>             — быстрый герой (89–90)
//   #/hero/import                         — перенос из Long Story Short (72)
//   #/hero/<id>[/<вкладка>|/classic/<1-3>|/table|/levelup/<шаг>][?корнер] — лист, классический лист, лист на карте,
//                                           повышение уровня (sheet.js, levelup.js)
// Данные и действия — только через contract.js.
import { html, raw, on } from '../../core/dom.js';
import { currentUser } from '../../core/auth.js';
import { appHeader, bindHeader } from '../screens.js';
import { heroList, heroView, creationView, creationLive, creationDone, lssImportView, heroActions } from './contract.js';
import { ic, chip, caps, pathRow, iconCard, artCard, liveSheet, bottomBar, summaryHero, segmented } from './parts.js';
import { stepBody, stepGave, bindStepExtras } from './steps.js';

// Выборы мастера живут в сессии вкладки — переживают обновление страницы, но не попадают в данные кампании.
const KEY = 'rasputye-hero-draft';
const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch { return {}; } };
export const draft = load();
export function saveDraft() { try { sessionStorage.setItem(KEY, JSON.stringify(draft)); } catch { /* приватный режим */ } }

function parse(hash) {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), query };
}

export function mountHero(root, hash) {
  const { parts, query } = parse(hash);
  const user = currentUser();
  const cleanup = [];
  // Слушатели вешаются на общий #app — снимаем их при уходе с экрана.
  const L = (type, sel, fn) => cleanup.push(on(root, type, sel, fn));
  let alive = true;
  const page = (body, cls = '', header = true) => {
    root.innerHTML = String(html`<div class="screen hero-screen ${cls}">${header ? appHeader(user, 'heroes') : ''}${body}</div>`);
    if (header) bindHeader(root, user);
    // На узком экране шаги прокручиваются — текущий держим в поле зрения.
    const cur = root.querySelector('.h-step.current'); const bar = cur?.closest('.h-steps');
    if (cur && bar) bar.scrollLeft = cur.offsetLeft - bar.clientWidth / 2 + cur.offsetWidth / 2;
  };
  const [p0, p1, p2] = parts;
  // Перерисовка на месте не уводит к началу страницы: прокрутку окна и колонок мастера сохраняем.
  const rerender = () => {
    if (!alive) return;
    const SCROLLERS = '.screen, .h-wiz-main, .h-spell-list';
    const y = window.scrollY, inner = [...root.querySelectorAll(SCROLLERS)].map((x) => x.scrollTop);
    cleanup.splice(0).forEach((f) => f()); mountInto();
    window.scrollTo(0, y);
    root.querySelectorAll(SCROLLERS).forEach((x, i) => { x.scrollTop = inner[i] || 0; });
  };
  function mountInto() {
    if (p0 === 'heroes') { page(heroesPage()); bindHeroes(L); return; }
    if (p1 === 'new' && !p2) { page(pathPage(query)); bindPath(L); return; }
    if (p1 === 'new' && p2 === 'done') { page(donePage()); L('click', '[data-act]', (e, b) => heroActions[b.dataset.act]?.({ heroId: 'lira' })); return; }
    if (p1 === 'new') { page(stepPage(p2), 'wizard'); bindStep(root, L, p2, rerender); return; }
    if (p1 === 'quick') { page(quickPage(p2 || '1'), 'wizard'); bindQuick(root, L, p2 || '1'); return; }
    if (p1 === 'import') { page(importPage()); bindImport(root, L); return; }
    // Лист, лист на карте и повышение уровня — отдельными модулями, они крупные.
    const mod = p2 === 'levelup' ? import('./levelup.js') : import('./sheet.js');
    mod.then((m) => { if (alive) m.mount(root, { parts, query, page, L, user }); });
  }
  mountInto();
  // Данные поменялись (действие листа, сервер, соседняя вкладка): лист и «Мои герои» перерисовываются, только если
  // изменилось то, что они показывают, — иначе события чужих кампаний сбивали бы прокрутку. Мастер создания не трогаем.
  const sig = () => (p0 === 'heroes' ? JSON.stringify(heroList()) : p0 === 'hero' && p1 && !['new', 'quick', 'import'].includes(p1) && p2 !== 'levelup' ? JSON.stringify(heroView(p1)) : '');
  let last = sig();
  // Выбор в мастере создания меняет черновик конструктора (не базу) — перерисовать шаг и живой лист.
  const onChanged = () => { if (alive && (p1 === 'new' || p1 === 'quick' || p2 === 'levelup')) rerender(); };
  window.addEventListener('hero:changed', onChanged);
  return { unmount: () => { alive = false; window.removeEventListener('hero:changed', onChanged); cleanup.forEach((f) => f?.()); }, update: () => { const now = sig(); if (now !== last) { last = now; rerender(); } } };
}

const tickSvg = String(ic('tick-02', 14));
/** Переключить «выбранность» у группы карточек без перерисовки. */
function selectIn(root, sel, attr, id, artSel = '.h-choice-art, .h-icard-top, .art') {
  root.querySelectorAll(sel).forEach((x) => {
    const o = x.getAttribute(attr) === id;
    x.classList.toggle('on', o); x.setAttribute('aria-pressed', o);
    x.querySelector('.h-tick')?.remove();
    if (o) x.querySelector(artSel)?.insertAdjacentHTML('beforeend', `<span class="h-tick">${tickSvg}</span>`);
  });
}

// ——— 88 · Мои герои ———
function heroesPage() {
  const { heroes, saved, sample } = heroList();
  const card = (h) => {
    const draftCard = h.status === 'draft';
    const tag = draftCard ? chip('Черновик') : h.campaign ? chip(h.campaign.live ? `${h.campaign.name} · сессия идёт` : h.campaign.name, h.campaign.live ? 'accent' : '') : chip('Свободен');
    const body = draftCard
      ? html`<div class="h-bar wide"><i style="width:${Math.round((h.draft.step / h.draft.of) * 100)}%"></i></div><small class="muted">Шаг ${h.draft.step} из ${h.draft.of} — ${h.draft.stepName.toLowerCase()}</small>`
      : html`<div class="h-mini">${[['Хиты', h.stats.hp], ['КД', h.stats.ac], ['Ур.', h.stats.level]].map(([k, v]) => html`<span>${caps(k)}<b>${v}</b></span>`)}</div>`;
    const foot = draftCard
      ? html`<a class="btn btn-primary" href="#/hero/new/abilities">${ic('arrow-right-02')}Продолжить</a>`
      : html`<a class="btn btn-secondary" href="#/hero/${h.id === 'mira' ? 'lira' : h.id}">Открыть лист</a>`;
    return html`<article class="h-card ${draftCard ? 'draft' : ''}"><div class="h-card-art"><img src="${h.portrait}" alt="" loading="lazy">${tag}</div>
      <div class="h-card-body"><h3>${h.name}</h3><small class="muted">${h.summary}</small>${body}<span class="spacer"></span><div class="h-card-foot">${foot}<span class="spacer"></span><button class="icon-btn icon-btn-sm" data-more="${h.id}" aria-label="Ещё">${ic('more-horizontal')}</button></div></div></article>`;
  };
  return html`<main class="page h-page">
    <div class="title-row"><h2>Герои</h2>${chip(`Все · ${heroes.length}`, 'accent')}${chip(`В кампаниях · ${heroes.filter((h) => h.campaign).length}`)}${chip(`Черновики · ${heroes.filter((h) => h.status === 'draft').length}`)}<span class="spacer"></span>
      <a class="btn btn-secondary" href="#/hero/import">${ic('upload-01')}Из Long Story Short</a><a class="btn btn-primary" href="#/hero/new">${ic('plus-sign')}Новый герой</a></div>
    <div class="h-cards">${heroes.map(card)}
      <article class="h-card h-card-new"><span class="h-round">${ic('plus-sign', 24)}</span><h3>Новый герой</h3><p class="muted">Пошагово за 15 минут, быстро за три ответа или перенести из Long Story Short</p>
        <a class="btn btn-secondary" href="#/hero/new">Пошагово</a><a class="btn btn-ghost" href="#/hero/quick/1">${ic('sparkles')}Быстрый герой</a></article></div>
    <div class="h-saved-strip">${ic('book-open-01', 18)}<b>Сохранено в справочнике:</b>${saved.map((s) => chip(s))}<span class="spacer"></span><button class="link" data-sort>Разложить по книгам героев →</button></div>
    ${sample === false ? '' : previewNote()}
  </main>`;
}
function bindHeroes(L) {
  L('click', '[data-more]', (e, b) => heroActions.editField({ heroId: b.dataset.more, field: 'menu' }));
  L('click', '[data-sort]', () => heroActions.editField({ field: 'saved-from-reference' }));
}
export const previewNote = () => html`<p class="h-preview-note">${ic('information-circle', 16)}Экран на образце данных: числа ненастоящие, кнопки отвечают подсказкой. Все экраны героя — <a href="#/hero/lira">лист</a> · <a href="#/hero/lira/classic/1">классический</a> · <a href="#/hero/lira/table">на карте</a> · <a href="#/hero/lira/levelup/hp">повышение</a> · <a href="#/hero/import">импорт LSS</a> · корнеры: <a href="#/hero/lira/table?down">0 хитов</a>, <a href="#/hero/lira/table?concentration">концентрация</a>, <a href="#/hero/lira/table?noSlots">нет ячеек</a>, <a href="#/hero/lira?multiclass">мультикласс</a>, <a href="#/hero/lira?unfinished">не закончен</a>.</p>`;

// ——— 45 · Как привести героя ———
function pathPage(query) {
  const cv = creationView();
  const sel = ['steps', 'quick', 'lss'].includes(query) ? query : draft.path || 'steps';
  const start = { steps: ['#/hero/new/race', 'Начать пошагово'], quick: ['#/hero/quick/1', 'Начать быстро'], lss: ['#/hero/import', 'Загрузить файл'] }[sel];
  return html`<main class="page h-path-page">
    <div class="h-center"><h1>Как приведёте героя?</h1><p class="muted">Мастер «${cv.campaign.name}» ждёт героя ${cv.campaign.level} уровня. Выберите, как удобнее его собрать.</p></div>
    <div class="h-grid3 paths">${cv.paths.map((p) => iconCard(p, { selected: p.id === sel, attr: 'data-path', cls: 'path' }))}</div>
    <section class="h-rules"><div class="h-rules-head">${ic('crown', 16)}<b>Правила этой кампании — их задал мастер</b></div><div class="h-tags">${cv.campaign.rules.map((r) => chip(r))}</div></section>
    <div class="h-center h-actions"><a class="btn btn-ghost" href="#/heroes">Отмена</a><a class="btn btn-primary" href="${start[0]}" data-start>${ic('arrow-right-02')}${start[1]}</a></div>
  </main>`;
}
function bindPath(L) {
  L('click', '[data-path]', (e, b) => { draft.path = b.dataset.path; saveDraft(); location.hash = '#/hero/new?' + draft.path; });
  L('click', '[data-start]', () => heroActions.createFrom({ path: draft.path || 'steps' }));
}

// ——— 46–52 · Пошагово ———
function stepPage(stepId) {
  const cv = creationView();
  const i = Math.max(0, cv.steps.findIndex((s) => s.id === stepId));
  const s = cv.steps[i];
  const href = (k) => `#/hero/new/${cv.steps[k].id}`;
  const prev = i > 0 ? href(i - 1) : '#/hero/new';
  const last = i === cv.steps.length - 1;
  const next = last ? '#/hero/new/done' : href(i + 1);
  const nextLabel = last ? 'Готово: посмотреть героя' : `Дальше: ${cv.steps[i + 1].name.toLowerCase()}`;
  const live = creationLive(s.id);
  return html`<main class="h-wizard">
    ${pathRow({ back: '#/hero/new', steps: cv.steps, current: i, href })}
    <div class="h-wiz-grid"><section class="h-wiz-main">${stepBody(s, cv, draft)}</section>
      ${liveSheet(live, { note: `${cv.campaign.level} уровень — так решил мастер`, gave: stepGave(s, cv, draft) })}</div>
    ${bottomBar({ back: prev, hint: 'Шаги можно проходить в любом порядке — непройденные останутся серыми.', next, nextLabel })}
  </main>`;
}
function bindStep(root, L, stepId, rerender) {
  L('click', '[data-pick]', (e, b) => {
    const id = b.dataset.pick;
    draft[stepId] = id; saveDraft(); heroActions.choose({ step: stepId, id });
    selectIn(root, '[data-pick]', 'data-pick', id);
  });
  bindStepExtras(root, L, stepId, draft, saveDraft, rerender);
}

// ——— 53 · Героиня готова ———
function donePage() {
  const cv = creationView();
  const real = creationDone();
  if (real) return realDonePage(cv, real);
  const v = creationLive('look');
  const lira = { name: draft.name || 'Лира' };
  const checks = html`<section class="h-checks"><div class="h-box-head">${caps('Проверка')}<small>можно вернуться к любому шагу</small></div>
    <div class="h-tags">${cv.done.checks.map((c) => html`<a class="h-check-chip ${c.ok ? '' : 'warn'}" href="#/hero/new/${c.step || cv.steps.find((s) => c.name.startsWith(s.name))?.id || 'race'}">${ic(c.ok ? 'tick-02' : 'alert-circle', 14)}${c.name}</a>`)}</div></section>
    <p class="h-info">${ic('eye', 16)}${cv.done.note}</p>
    <div class="h-actions"><a class="btn btn-primary btn-lg" href="#/hero/lira/table" data-act="finish">${ic('arrow-right-02')}Сесть за стол как ${lira.name}</a><a class="btn btn-secondary btn-lg" href="#/hero/lira">${ic('book-open-01')}Открыть лист</a><button class="btn btn-ghost" data-act="editField">${ic('note-edit', 16)}Скачать PDF</button></div>`;
  return html`<main class="page h-done-page">${summaryHero({
    art: 'assets/hero/lira-portrait.webp', badge: 'Героиня готова', name: lira.name,
    line: 'Человек · Волшебница 5 уровня · Школа воплощения · Мудрец · Нейтрально-добрая',
    facts: [{ label: 'Хиты', value: '22', sub: 'к6 за уровень' }, { label: 'Класс доспеха', value: '13', sub: '16 с «Доспехами мага»' }, { label: 'Инициатива', value: '+3', sub: 'Ловкость' }, { label: 'Сл заклинаний', value: '15', sub: 'атака +7' }, { label: 'Скорость', value: '30 фт', sub: 'ходьба' }],
    abilities: v.stats.map((a, k) => ({ ...a, name: ['Сила', 'Ловкость', 'Телосложение', 'Интеллект', 'Мудрость', 'Харизма'][k], save: ['−1', '+3', '+0', '+7', '+4', '+0'][k], saveProf: k === 3 || k === 4 })),
    extra: checks,
  })}</main>`;
}

// Итог на настоящем конструкторе: числа из сборки, «Создать» отправляет героя (contract.finish).
function realDonePage(cv, r) {
  const ok = r.status === 'valid';
  const checks = html`<section class="h-checks"><div class="h-box-head">${caps('Проверка')}<small>можно вернуться к любому шагу</small></div>
    <div class="h-tags">${cv.done.checks.map((c) => html`<a class="h-check-chip ${c.ok ? '' : 'warn'}" href="#/hero/new/${c.step}">${ic(c.ok ? 'tick-02' : 'alert-circle', 14)}${c.name}</a>`)}</div></section>
    ${ok ? '' : html`<p class="h-info">${ic('alert-circle', 16)}${r.missing.slice(0, 3).join(' ')}</p>`}
    <p class="h-info">${ic('eye', 16)}${cv.done.note}</p>
    <div class="h-actions"><button class="btn btn-primary btn-lg" data-act="finish" ${ok ? '' : raw('disabled')}>${ic('arrow-right-02')}${r.campaign ? `Создать героя в «${r.campaign}»` : 'Создать героя'}</button><a class="btn btn-secondary btn-lg" href="#/hero/new/race">${ic('pencil-edit-02')}К шагам</a></div>`;
  return html`<main class="page h-done-page">${summaryHero({ art: r.art, badge: ok ? 'Герой готов' : 'Почти готов', name: r.name, line: r.line, facts: r.facts, abilities: r.abilities, extra: checks })}</main>`;
}

// ——— 89–90 · Быстрый герой ———
const QSTEPS = [{ name: 'В бою' }, { name: 'Споры' }, { name: 'Имя и облик' }];
function quickPage(step) {
  const q = creationView().quick;
  const href = (k) => `#/hero/quick/${k + 1}`;
  draft.quick ||= {};
  if (step === 'done') return quickDone(q, href);
  const n = Math.min(3, Math.max(1, +step || 1));
  const qq = q.questions[n - 1];
  const picked = draft.quick[qq.id] ?? q.picked[qq.id];
  let body;
  if (qq.options) {
    body = html`<div class="h-quick-opts n${qq.options.length}">${qq.options.map((o) => html`<button class="h-qcard ${o.id === picked ? 'on' : ''}" data-q="${o.id}" aria-pressed="${o.id === picked}">
      <span class="art"><img src="${o.img}" alt="" loading="lazy">${o.id === picked ? html`<span class="h-tick">${ic('tick-02', 14)}</span>` : ''}</span>
      <span class="body"><b>${o.name}</b><small>${o.text}</small><span class="note">${o.note}</span></span></button>`)}</div>`;
  } else {
    const sel = draft.quick.portrait ?? 0;
    body = html`<div class="h-quick-name"><label class="h-field"><span>Имя</span><span class="input lg"><input data-qname value="${draft.quick.name ?? q.picked.name}" placeholder="Имя героя" maxlength="40"></span></label>
      <div class="h-field"><span>Портрет</span><div class="h-quick-portraits">${q.portraits.map((p, k) => html`<button class="h-portrait-pick ${k === sel ? 'on' : ''}" data-qportrait="${k}"><img src="${p}" alt=""></button>`)}<button class="h-portrait-pick add" data-qupload aria-label="Загрузить свой">${ic('image-add-01', 22)}</button></div></div></div>`;
  }
  return html`<main class="h-wizard quick">
    ${pathRow({ back: '#/hero/new?quick', title: 'Быстрый герой', steps: QSTEPS, current: n - 1, href })}
    <div class="h-center"><h1>${qq.title}</h1><p class="muted">${qq.hint}</p></div>
    ${body}
    ${bottomBar({ back: n === 1 ? '#/hero/new?quick' : href(n - 2), backLabel: n === 1 ? 'Другой способ' : 'Назад', hint: 'Мастер «Склепа культа» ждёт героя 5 уровня — уровень выставим сами', next: n < 3 ? href(n) : '#/hero/quick/done', nextLabel: n === 1 ? 'Дальше: как решаете споры' : n === 2 ? 'Дальше: имя и облик' : 'Собрать героя' })}
  </main>`;
}
function quickDone(q, href) {
  const r = q.result;
  const name = draft.quick?.name || r.name;
  const portrait = q.portraits[draft.quick?.portrait ?? 0] || r.portrait;
  return html`<main class="h-wizard quick">
    ${pathRow({ back: '#/hero/quick/3', title: 'Быстрый герой', steps: QSTEPS, current: 3, href })}
    <div class="h-qdone">
      <figure class="h-qdone-art"><img src="${portrait}" alt=""><figcaption><b>${name}</b><span>${r.summary}</span></figcaption><a class="btn btn-secondary btn-sm h-qdone-swap" href="#/hero/quick/3">${ic('edit-02', 14)}Другой облик</a></figure>
      <section class="h-qdone-main"><h1>${name} готов к драке</h1>
        <p class="muted">Собрали по трём ответам: «впереди», «кулаком», «${name}». Всё ниже можно поменять — или открыть пошаговый мастер на нужном шаге.</p>
        <div class="h-bstats compact">${r.abilities.map((a) => html`<div class="h-bstat"><span class="k">${a.short}</span><b>${a.mod}</b><span class="s">${a.score}</span></div>`)}</div>
        <div class="h-facts4">${r.facts.map((f) => html`<div>${caps(f.label)}<b>${f.value}</b><small>${f.sub}</small></div>`)}</div>
        <div class="h-chosen"><div class="h-chosen-head">${caps('Что мы выбрали за вас')}</div>${r.chosen.map(([k, v, step]) => html`<div class="row"><span class="k">${k}</span><span class="v">${v}</span><a class="link" href="#/hero/new/${step}">Поменять</a></div>`)}</div>
        <div class="h-actions"><button class="btn btn-primary" data-bring>${ic('arrow-right-02')}Привести в «Склеп культа»</button><a class="btn btn-secondary" href="#/hero/new/race">${ic('edit-02')}Доработать пошагово</a><span class="muted sm">Мастер увидит героя и одобрит</span></div>
      </section>
    </div>
  </main>`;
}
function bindQuick(root, L, step) {
  L('click', '[data-q]', (e, b) => {
    const qid = creationView().quick.questions[(+step || 1) - 1].id;
    draft.quick[qid] = b.dataset.q; saveDraft(); heroActions.choose({ step: 'quick', id: qid, value: b.dataset.q });
    selectIn(root, '[data-q]', 'data-q', b.dataset.q);
  });
  L('input', '[data-qname]', (e, t) => { draft.quick.name = t.value; saveDraft(); });
  L('click', '[data-qportrait]', (e, b) => { draft.quick.portrait = +b.dataset.qportrait; saveDraft(); root.querySelectorAll('.h-portrait-pick').forEach((x) => x.classList.toggle('on', x === b)); });
  L('click', '[data-qupload]', () => heroActions.editField({ field: 'portrait', value: 'upload' }));
  L('click', '[data-bring]', () => heroActions.bringToCampaign({ heroId: 'grom', campaignId: 'c-crypt' }));
}

// ——— 72 · Перенос из Long Story Short ———
function importPage() {
  const v = lssImportView();
  const d = draft.lss || {};
  const issue = (x, k) => html`<article class="h-issue ${x.kind}"><span class="h-sq ${x.kind}">${ic(x.kind === 'error' ? 'cancel-01' : 'alert-circle', 18)}</span>
    <div><b>${x.title}</b><p>${x.text}</p><div class="h-issue-acts">
      ${x.primary ? html`<button class="btn btn-sm ${x.ghost ? 'btn-secondary' : 'btn-primary'} ${d[k] === 'primary' ? 'picked' : ''}" data-lss="${k}|primary">${x.primaryIcon ? ic(x.primaryIcon, 14) : ''}${x.primary}</button>` : ''}
      ${x.secondary ? html`<button class="btn btn-sm btn-ghost ${d[k] === 'secondary' ? 'picked' : ''}" data-lss="${k}|secondary">${x.secondary}</button>` : ''}</div></div></article>`;
  return html`<main class="page h-import">
    <section class="h-import-main"><h1>Перенесли лист из Long Story Short</h1>
      <p class="muted">Почти всё совпало. Посмотрите четыре места, где файл и наши правила расходятся — решите сейчас или позже в листе.</p>
      <div class="h-ok-bar">${ic('tick-02', 18)}<span><b>Совпало ${v.matched.ok} из ${v.matched.of}</b><small>${v.matched.text}</small></span></div>
      ${v.issues.map(issue)}
      <div class="h-import-foot"><a class="btn btn-ghost" href="#/heroes">Отменить импорт</a><span class="spacer"></span><button class="btn btn-secondary" data-later>Решить потом</button><a class="btn btn-primary" href="#/hero/lira" data-accept>${ic('arrow-right-02')}Принять и открыть лист</a></div>
    </section>
    <aside class="h-import-card"><span class="h-initials">${v.hero.initials}</span><h2>${v.hero.name}</h2><small class="muted">${v.hero.summary}</small>
      <div class="h-import-stats">${[['Хп', v.hero.hp], ['КД', v.hero.ac], ['Сл', v.hero.dc]].map(([k, n]) => html`<span>${caps(k)}<b>${n}</b></span>`)}</div>
      <div class="h-import-token"><span class="h-initials sm">${v.hero.initials}</span><small>Токен на карте — тоже с инициалами, пока нет портрета</small></div>
      <small class="h-file">${ic('note-edit', 14)}${v.file}</small></aside>
  </main>`;
}
function bindImport(root, L) {
  draft.lss ||= {};
  L('click', '[data-lss]', (e, b) => {
    const [k, choice] = b.dataset.lss.split('|');
    draft.lss[k] = choice; saveDraft();
    b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('picked', x === b));
    heroActions.importLss({ decisions: { ...draft.lss } });
  });
  L('click', '[data-later],[data-accept]', () => heroActions.importLss({ decisions: { ...draft.lss }, later: true }));
}

export { segmented, artCard, raw };
