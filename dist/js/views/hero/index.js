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
//   #/hero/<id>/edit                      — правка героя (edit.js)
// Данные и действия — только через contract.js.
import { html, raw, on } from '../../core/dom.js';
import { currentUser } from '../../core/auth.js';
import { appHeader, bindHeader } from '../screens.js';
import { heroList, heroView, creationView, creationLive, creationDone, lssImportView, lssError, heroActions, startCreation, uploadPortrait, loadLssFile, dropLss, bringTargets } from './contract.js';
import { srcOf } from '../../core/assets.js';
import { closeTopModal, hasModal } from '../../ui/kit.js';
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
    if (p0 === 'heroes') { page(heroesPage()); cleanup.push(bindHeroes(L)); return; }
    if (p1 === 'new' && !p2) { const qp = new URLSearchParams(query); if (qp.get('c')) startCreation(qp.get('c')); page(pathPage(qp)); bindPath(L, qp); return; }
    if (p1 === 'new' && p2 === 'done') { page(donePage()); L('click', '[data-act]', (e, b) => heroActions[b.dataset.act]?.({})); return; }
    if (p1 === 'new') { page(stepPage(p2), 'wizard'); bindStep(root, L, p2, rerender); return; }
    if (p1 === 'quick') { const q = creationView().quick; if (q && !q.built && creationDone()) heroActions.choose({ step: 'quick', id: 'role', value: q.picked.role }); page(quickPage(p2 || '1'), 'wizard'); bindQuick(root, L, p2 || '1'); return; }
    if (p1 === 'import') { const c = new URLSearchParams(query).get('c') || ''; page(importPage(c)); bindImport(root, L, c); return; }
    if (p2 === 'bring') { page(bringPage(p1, new URLSearchParams(query).get('c') || '')); L('click', '[data-bring-camp]', (e, b) => heroActions.bringToCampaign({ heroId: p1, campaignId: b.dataset.bringCamp })); return; }
    // Правка героя — свой экран со своим черновиком (edit.js); его слушатели снимаются вместе с экраном.
    if (p2 === 'edit') { import('./edit.js').then((m) => { if (!alive) return; const off = m.mount(root, { parts, query, page, L, user }); if (typeof off === 'function') cleanup.push(off); }); return; }
    // Лист, лист на карте и повышение уровня — отдельными модулями, они крупные.
    const mod = p2 === 'levelup' ? import('./levelup.js') : import('./sheet.js');
    mod.then((m) => { if (alive) m.mount(root, { parts, query, page, L, user }); });
  }
  mountInto();
  // Данные поменялись (действие листа, сервер, соседняя вкладка): лист и «Мои герои» перерисовываются, только если
  // изменилось то, что они показывают, — иначе события чужих кампаний сбивали бы прокрутку. Мастер создания не трогаем.
  const sig = () => (p0 === 'heroes' ? JSON.stringify(heroList()) : p0 === 'hero' && p1 && !['new', 'quick', 'import'].includes(p1) && p2 !== 'levelup' && p2 !== 'edit' ? JSON.stringify(heroView(p1)) : '');
  let last = sig();
  // Выбор в мастере создания меняет черновик конструктора (не базу) — перерисовать шаг и живой лист.
  // «Мои герои» (library.js) живут вне базы кампаний: их правки тоже приходят этим событием.
  const onChanged = () => {
    if (!alive) return;
    if (p1 === 'new' || p1 === 'quick' || p1 === 'import' || p2 === 'levelup' || p2 === 'bring') { rerender(); return; }
    const now = sig(); if (now !== last) { last = now; rerender(); }
  };
  window.addEventListener('hero:changed', onChanged);
  // Окна экранов героя (хиты, портрет, заклинание, предмет) закрываются по Esc и не переживают уход со страницы.
  const onKey = (e) => { if (e.key === 'Escape' && hasModal()) { e.preventDefault(); closeTopModal(); } };
  document.addEventListener('keydown', onKey);
  return { unmount: () => { alive = false; window.removeEventListener('hero:changed', onChanged); document.removeEventListener('keydown', onKey); while (hasModal()) closeTopModal(); cleanup.forEach((f) => f?.()); }, update: () => { const now = sig(); if (now !== last) { last = now; rerender(); } } };
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

// ——— 88 · Герои ———
// Только настоящие герои (#203): свои — во всех кампаниях, у мастера ещё и герои его кампаний. Пусто — так и говорим.
function heroesPage() {
  const { heroes, party, saved, archived = [], deviceOnly } = heroList();
  // Свои герои (вне кампаний) — отдельно от их копий в кампаниях (#203: героя собирают отдельно, приводят потом).
  const own = heroes.filter((h) => h.lib), placed = heroes.filter((h) => !h.lib);
  // Карточка: портрет, кампания, класс; хиты — сколько сейчас из максимума, полоской, как в листе.
  const hpBar = (h) => { const p = h.hp?.max ? Math.round((h.hp.now / h.hp.max) * 100) : 0; return html`<span class="h-card-hp ${p && p <= 30 ? 'low' : ''}"><i style="width:${p}%"></i></span>`; };
  const card = (h) => html`<article class="h-card"><a class="h-card-art" href="#/hero/${h.id}"><img src="${h.portrait}" alt="" loading="lazy">${h.campaign ? chip(h.campaign.name) : chip('Не в кампании', 'accent')}</a>
    <div class="h-card-body"><h3>${h.name}</h3><small class="muted">${h.line || h.summary}${h.player ? ` · играет ${h.player}` : ''}</small>
      <div class="h-mini">${[['Хиты', h.hp ? `${h.hp.now}/${h.hp.max}` : h.stats.hp], ['КД', h.stats.ac], ['Ур.', h.stats.level]].map(([k, v]) => html`<span>${caps(k)}<b>${v}</b></span>`)}</div>${hpBar(h)}
      <span class="spacer"></span><div class="h-card-foot">${h.lib ? html`<a class="btn btn-primary" href="#/hero/${h.id}/bring">${ic('arrow-right-02', 16)}В кампанию</a><a class="btn btn-ghost" href="#/hero/${h.id}">Лист</a>` : html`<a class="btn btn-secondary" href="#/hero/${h.id}">Открыть лист</a>`}<span class="spacer"></span><button class="icon-btn icon-btn-sm" data-more="${h.id}" aria-label="Ещё">${ic('more-horizontal')}</button></div></div></article>`;
  const newCard = html`<article class="h-card h-card-new"><span class="h-round">${ic('plus-sign', 24)}</span><h3>Новый герой</h3><p class="muted">Соберите пошагово, быстро за три ответа или перенесите из Long Story Short — в кампанию приведёте потом</p>
    <a class="btn btn-secondary" href="#/hero/new">Пошагово</a><a class="btn btn-ghost" href="#/hero/quick/1">${ic('sparkles')}Быстрый герой</a></article>`;
  const head = html`<div class="title-row"><h2>Герои</h2>${own.length ? chip(`Мои · ${own.length}`, 'accent') : ''}${placed.length ? chip(`В кампаниях · ${placed.length}`) : ''}<span class="spacer"></span>
    <a class="btn btn-secondary" href="#/hero/import">${ic('upload-01')}Из Long Story Short</a><a class="btn btn-primary" href="#/hero/new">${ic('plus-sign')}Новый герой</a></div>`;
  const gone = archived.length ? html`<h3 class="h-sec">Удалённые</h3><div class="h-gone">${archived.map((h) => html`<div class="h-gone-row"><img src="${h.portrait}" alt=""><span><b>${h.name}</b><small>${h.campaign === 'Мои герои' ? 'из «Моих героев»' : `в архиве «${h.campaign}»`}</small></span><button class="btn btn-ghost btn-sm" data-restore="${h.id}">${ic('arrow-turn-backward', 14)}Вернуть</button></div>`)}</div>` : '';
  const savedStrip = saved.length ? html`<div class="h-saved-strip">${ic('book-open-01', 18)}<b>Сохранено в справочнике:</b>${saved.map((s) => chip(s))}<span class="spacer"></span><a class="link" href="#/ref">Открыть справочник →</a></div>` : '';
  const device = deviceOnly && own.length ? html`<p class="h-device-note">${ic('information-circle', 16)}«Мои герои» пока хранятся в этом браузере: на другом устройстве их не будет. Копии в кампаниях — на сервере.</p>` : '';
  return html`<main class="page h-page">${head}
    <h3 class="h-sec first">Мои герои</h3>${device}<div class="h-cards">${own.map(card)}${newCard}${own.length ? '' : html`<div class="h-empty-note"><b>Своих героев пока нет</b><p class="muted">Соберите героя — он появится здесь, а в кампанию приведёте его, когда мастер позовёт.</p></div>`}</div>
    ${placed.length ? html`<h3 class="h-sec">В кампаниях</h3><div class="h-cards">${placed.map(card)}</div>` : ''}
    ${party.length ? html`<h3 class="h-sec">Герои моих кампаний</h3><div class="h-cards">${party.map(card)}</div>` : ''}
    ${gone}${savedStrip}
  </main>`;
}

// ——— Куда привести героя (#203): свой герой — в любую кампанию копией, игрок без героя садится за стол ———
function bringPage(key, prefer) {
  const v = heroView(key);
  if (!v) return html`<main class="page h-page"><div class="h-center h-missing">${ic('user', 32)}<h1>Героя не найти</h1><a class="btn btn-primary" href="#/heroes">${ic('arrow-left-02')}Ко всем героям</a></div></main>`;
  const targets = bringTargets(key).sort((a, b) => (b.id === prefer) - (a.id === prefer) || b.free - a.free || a.dup - b.dup);
  const row = (c, i) => html`<div class="h-bring-row ${c.id === prefer ? 'pref' : ''}"><span class="h-bring-ic ${c.free ? 'free' : ''}">${ic(c.free ? 'chess-pawn' : c.master ? 'crown' : 'copy-01', 18)}</span>
    <span class="t"><b>${c.name}</b><small>${c.free ? 'Сядете за стол этим героем' : c.master ? 'Вы мастер — герой появится в списке героев кампании' : 'У вас там уже есть герой — этот придёт копией в список'}${c.dup ? html` · <em>${v.name} там уже есть</em>` : ''}</small></span>
    <button class="btn ${i === 0 && !c.dup ? 'btn-primary' : 'btn-secondary'}" data-bring-camp="${c.id}">${ic('arrow-right-02', 16)}${c.dup ? 'Ещё раз' : c.free ? 'Сесть за стол' : 'Привести'}</button></div>`;
  return html`<main class="page h-page h-bring">
    <div class="h-bring-hero"><img src="${v.portrait}" alt=""><div><h1>Куда отправится ${v.name}?</h1><p class="muted">${v.summary}</p></div></div>
    <p class="h-bring-lead">${v.lib ? 'Герой остаётся в «Моих героях». В кампанию уходит его копия: у каждой кампании свой лист — хиты, сумка, уровень.' : 'В другую кампанию уходит копия листа.'}</p>
    ${targets.length ? html`<div class="h-bring-list">${targets.map(row)}</div>` : html`<div class="h-empty-note"><b>Кампаний пока нет</b><p class="muted">Войдите в кампанию по ссылке-приглашению мастера — и приведите героя туда.</p></div>`}
    <div class="h-bring-foot"><a class="btn btn-ghost" href="#/hero/${key}">${ic('book-open-01')}Открыть лист</a>${v.canEdit ? html`<a class="btn btn-ghost" href="#/hero/${key}/edit">${ic('pencil-edit-02')}Править</a>` : ''}<span class="spacer"></span><a class="btn btn-secondary" href="#/heroes">${v.lib ? 'Пока оставить в «Моих героях»' : 'Ко всем героям'}</a></div>
  </main>`;
}
function bindHeroes(L) {
  L('click', '[data-more]', (e, b) => heroMenu(b));
  L('click', '[data-restore]', (e, b) => heroActions.restoreHero({ heroId: b.dataset.restore }));
  // Меню живёт в поповере вне корня экрана — слушаем документ, пока открыт экран.
  const onBring = (e) => {
    const b = e.target.closest('[data-bring-to]'); if (b) heroActions.bringToCampaign({ heroId: b.dataset.hero, campaignId: b.dataset.bringTo });
    const pic = e.target.closest('[data-card-portrait]'), del = e.target.closest('[data-card-delete]');
    if (pic || del) import('../../ui/kit.js').then(({ closePopover }) => closePopover());
    if (pic) { const v = heroView(pic.dataset.cardPortrait); if (v) import('./sheet.js').then((m) => m.portraitModal(v)); }
    if (del) { const v = heroView(del.dataset.cardDelete); if (v) import('./sheet.js').then((m) => m.confirmDeleteHero(v)); }
  };
  document.addEventListener('click', onBring);
  return () => document.removeEventListener('click', onBring);
}
/** Меню «…» карточки героя: лист, классический лист, повышение, дом кампании. */
function heroMenu(anchor) {
  const id = anchor.dataset.more, v = heroView(id);
  if (!v) return;
  const [cid] = id.split('~');
  const item = (href, icon, label) => html`<a class="menu-item" href="${href}">${ic(icon, 16)}${label}</a>`;
  import('../../ui/kit.js').then(({ popover }) => popover(html`<div class="menu">${item(`#/hero/${id}`, 'book-open-01', 'Удобный лист')}${v.canEdit ? item(`#/hero/${id}/edit`, 'pencil-edit-02', 'Править героя') : ''}${item(`#/hero/${id}/classic/1`, 'pen-tool-01', 'Классический лист')}
    ${v.canLevelUp ? item(`#/hero/${id}/levelup/hp`, 'arrow-up-01', 'Новый уровень') : ''}${v.lib ? '' : item(`#/camp/${cid}`, 'home-01', `Кампания «${v.campaign?.name || ''}»`)}
    ${v.isMine ? bringTargets(id).map((c) => html`<button class="menu-item" data-bring-to="${c.id}" data-hero="${id}">${ic('arrow-right-02', 16)}Привести в «${c.name}»${c.free ? '' : ' (копией)'}</button>`) : ''}
    ${v.canEdit ? html`<span class="menu-sep"></span><button class="menu-item" data-card-portrait="${id}">${ic('image-add-01', 16)}Сменить портрет</button><button class="menu-item danger" data-card-delete="${id}">${ic('delete-02', 16)}Удалить героя</button>` : ''}</div>`, anchor, { placement: 'auto' }));
}
export const previewNote = () => html`<p class="h-preview-note">${ic('information-circle', 16)}Экран на образце данных: числа ненастоящие, кнопки отвечают подсказкой. Все экраны героя — <a href="#/hero/lira">лист</a> · <a href="#/hero/lira/classic/1">классический</a> · <a href="#/hero/lira/table">на карте</a> · <a href="#/hero/lira/levelup/hp">повышение</a> · <a href="#/hero/import">импорт LSS</a> · корнеры: <a href="#/hero/lira/table?down">0 хитов</a>, <a href="#/hero/lira/table?concentration">концентрация</a>, <a href="#/hero/lira/table?noSlots">нет ячеек</a>, <a href="#/hero/lira?multiclass">мультикласс</a>, <a href="#/hero/lira?unfinished">не закончен</a>.</p>`;

// ——— 45 · Как привести героя ———
function pathPage(qp) {
  const cv = creationView();
  const sel = ['steps', 'quick', 'lss'].find((k) => qp.has(k)) || draft.path || 'steps';
  const start = { steps: ['#/hero/new/race', 'Начать пошагово'], quick: ['#/hero/quick/1', 'Начать быстро'], lss: [`#/hero/import${qp.get('c') ? `?c=${encodeURIComponent(qp.get('c'))}` : ''}`, 'Загрузить файл'] }[sel];
  const cid = qp.get('c');
  // Из кампании («Свой герой») — ещё и готовые свои герои: приводятся копией и садятся за стол.
  const ready = cid ? heroList().heroes.filter((h) => h.lib) : [];
  return html`<main class="page h-path-page">
    <div class="h-center"><h1>${cid ? 'Как приведёте героя?' : 'Новый герой'}</h1><p class="muted">${cid ? `Мастер «${cv.campaign.name}» ждёт героя ${cv.campaign.level} уровня. Приведите готового или соберите нового.` : 'Герой будет вашим: соберите его, а в кампанию приведёте потом — в любую, где играете.'}</p></div>
    ${ready.length ? html`<section class="h-ready"><div class="h-box-head">${caps('Готовые герои')}<small>придут копией — свой лист в этой кампании</small></div><div class="h-ready-list">${ready.map((h) => html`<button class="h-ready-card" data-lib-bring="${h.id}"><img src="${h.portrait}" alt=""><span><b>${h.name}</b><small>${h.line}</small></span>${ic('arrow-right-02', 16)}</button>`)}</div></section><div class="h-or"><span>или соберите нового</span></div>` : ''}
    <div class="h-grid3 paths">${cv.paths.map((p) => iconCard(p, { selected: p.id === sel, attr: 'data-path', cls: 'path' }))}</div>
    <section class="h-rules"><div class="h-rules-head">${ic('crown', 16)}<b>${cid ? 'Правила этой кампании — их задал мастер' : 'Правила по умолчанию — в кампании их задаёт мастер'}</b></div><div class="h-tags">${cv.campaign.rules.map((r) => chip(r))}</div></section>
    <div class="h-center h-actions"><a class="btn btn-ghost" href="${qp.get('c') ? `#/c/${qp.get('c')}` : '#/heroes'}">Отмена</a><a class="btn btn-primary" href="${start[0]}" data-start>${ic('arrow-right-02')}${start[1]}</a></div>
  </main>`;
}
function bindPath(L, qp) {
  L('click', '[data-path]', (e, b) => { draft.path = b.dataset.path; saveDraft(); location.hash = `#/hero/new?${qp.get('c') ? `c=${encodeURIComponent(qp.get('c'))}&` : ''}${draft.path}`; });
  L('click', '[data-start]', () => heroActions.createFrom({ path: draft.path || 'steps' }));
  L('click', '[data-lib-bring]', (e, b) => heroActions.bringToCampaign({ heroId: b.dataset.libBring, campaignId: qp.get('c') }));
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
      ${liveSheet(live, { note: cv.campaignId ? `${cv.campaign.level} уровень — так решил мастер` : `${cv.campaign.level} уровень`, gave: stepGave(s, cv, draft) })}</div>
    ${bottomBar({ back: prev, hint: 'Шаги можно проходить в любом порядке — непройденные останутся серыми.', next, nextLabel })}
  </main>`;
}
function bindStep(root, L, stepId, rerender) {
  L('click', '[data-pick]', (e, b) => {
    const id = b.dataset.pick;
    draft[stepId] = id; saveDraft(); heroActions.choose({ step: stepId, id });
    selectIn(root, '[data-pick]', 'data-pick', id);
    // Выборы расы и класса (прибавки, навыки, подкласс) лежат под карточками — показываем первый незаполненный.
    root.querySelector('.h-extra.need')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    <div class="h-actions"><button class="btn btn-primary btn-lg" data-act="finish" ${ok ? '' : raw('disabled')}>${ic('tick-02')}Создать героя</button><a class="btn btn-secondary btn-lg" href="#/hero/new/race">${ic('pencil-edit-02')}К шагам</a></div>`;
  return html`<main class="page h-done-page">${summaryHero({ art: r.art, badge: ok ? 'Герой готов' : 'Почти готов', name: r.name, line: r.line, facts: r.facts, abilities: r.abilities, extra: checks })}</main>`;
}

// ——— 89–90 · Быстрый герой ———
// Три ответа пересобирают черновик мастера целиком (contract.quickBuild): итог — настоящий герой, его можно
// привести в кампанию сразу или доработать пошагово (#203).
const QSTEPS = [{ name: 'В бою' }, { name: 'Споры' }, { name: 'Имя и облик' }];
const uniq = (a) => [...new Set(a.filter(Boolean))];
function quickPage(step) {
  const cv = creationView(), q = cv.quick;
  const href = (k) => `#/hero/quick/${k + 1}`;
  if (step === 'done') return quickDone(cv, q, href);
  const n = Math.min(3, Math.max(1, +step || 1));
  const qq = q.questions[n - 1];
  const picked = q.picked[qq.id];
  let body;
  if (qq.options) {
    body = html`<div class="h-quick-opts n${qq.options.length}">${qq.options.map((o) => html`<button class="h-qcard ${o.id === picked ? 'on' : ''}" data-q="${o.id}" aria-pressed="${String(o.id === picked)}">
      <span class="art"><img src="${o.img}" alt="" loading="lazy">${o.id === picked ? html`<span class="h-tick">${ic('tick-02', 14)}</span>` : ''}</span>
      <span class="body"><b>${o.name}</b><small>${o.text}</small><span class="note">${o.note}</span></span></button>`)}</div>`;
  } else {
    const sel = q.result.portrait;
    const shown = uniq([sel, ...q.portraits.filter((p) => p.includes('/portraits/')), ...q.portraits]).slice(0, 10);
    body = html`<div class="h-quick-name"><label class="h-field"><span>Имя</span><span class="input lg"><input data-qname value="${q.picked.name}" placeholder="Имя героя" maxlength="40"></span></label>
      <div class="h-field"><span>Портрет — он же токен на карте</span><div class="h-quick-portraits">${shown.map((p) => html`<button class="h-portrait-pick ${p === sel ? 'on' : ''}" data-qportrait="${p}"><img src="${srcOf(p)}" alt=""></button>`)}<button class="h-portrait-pick add" data-qupload aria-label="Загрузить свой">${ic('image-add-01', 22)}</button></div></div></div>`;
  }
  return html`<main class="h-wizard quick">
    ${pathRow({ back: '#/hero/new?quick', title: 'Быстрый герой', steps: QSTEPS, current: n - 1, href })}
    <div class="h-center"><h1>${qq.title}</h1><p class="muted">${qq.hint}</p></div>
    ${body}
    ${bottomBar({ back: n === 1 ? '#/hero/new?quick' : href(n - 2), backLabel: n === 1 ? 'Другой способ' : 'Назад', hint: cv.campaignId ? `Мастер «${cv.campaign.name}» ждёт героя ${cv.campaign.level} уровня — остальное подберём сами` : 'Остальное подберём сами — поменять можно в пошаговом мастере', next: n < 3 ? href(n) : '#/hero/quick/done', nextLabel: n === 1 ? 'Дальше: как решаете споры' : n === 2 ? 'Дальше: имя и облик' : 'Собрать героя' })}
  </main>`;
}
function quickDone(cv, q, href) {
  const r = q.result;
  const name = r.name;
  return html`<main class="h-wizard quick">
    ${pathRow({ back: '#/hero/quick/3', title: 'Быстрый герой', steps: QSTEPS, current: 3, href })}
    <div class="h-qdone">
      <figure class="h-qdone-art"><img src="${srcOf(r.portrait)}" alt=""><figcaption><b>${name}</b><span>${r.summary}</span></figcaption><a class="btn btn-secondary btn-sm h-qdone-swap" href="#/hero/quick/3">${ic('edit-02', 14)}Другой облик</a></figure>
      <section class="h-qdone-main"><h1>${name} готов${/а$/.test(name) ? 'а' : ''} к приключению</h1>
        <p class="muted">Собрали по трём ответам: ${r.why.map((w) => `«${w}»`).join(', ')}. Всё ниже можно поменять — или открыть пошаговый мастер на нужном шаге.</p>
        <div class="h-bstats compact">${r.abilities.map((a) => html`<div class="h-bstat"><span class="k">${a.short}</span><b>${a.mod}</b><span class="s">${a.score}</span></div>`)}</div>
        <div class="h-facts4">${r.facts.map((f) => html`<div>${caps(f.label)}<b>${f.value}</b><small>${f.sub}</small></div>`)}</div>
        <div class="h-chosen"><div class="h-chosen-head">${caps('Что мы выбрали за вас')}</div>${r.chosen.map(([k, v, step]) => html`<div class="row"><span class="k">${k}</span><span class="v">${v}</span><a class="link" href="#/hero/new/${step}">Поменять</a></div>`)}</div>
        ${r.ok ? '' : html`<p class="h-info">${ic('alert-circle', 16)}${r.missing.slice(0, 2).join(' ')}</p>`}
        <div class="h-actions"><button class="btn btn-primary" data-bring ${r.ok ? '' : raw('disabled')}>${ic('tick-02')}Создать героя</button><a class="btn btn-secondary" href="#/hero/new/race">${ic('edit-02')}Доработать пошагово</a></div>
      </section>
    </div>
  </main>`;
}
function bindQuick(root, L, step) {
  const qid = () => creationView().quick.questions[(+step || 1) - 1].id;
  L('click', '[data-q]', (e, b) => { selectIn(root, '[data-q]', 'data-q', b.dataset.q); heroActions.choose({ step: 'quick', id: qid(), value: b.dataset.q }); });
  L('change', '[data-qname]', (e, t) => heroActions.choose({ step: 'quick', id: 'name', value: t.value.trim() }));
  L('click', '[data-qportrait]', (e, b) => heroActions.choose({ step: 'quick', id: 'portrait', value: b.dataset.qportrait }));
  L('click', '[data-qupload]', () => pickPortrait((ref) => heroActions.choose({ step: 'quick', id: 'portrait', value: ref })));
  L('click', '[data-bring]', () => heroActions.finish());
}
/** Свой портрет: файл → ссылка (песочница — на устройстве; на сервере — когда включат загрузку игрокам). */
export function pickPortrait(done) {
  Promise.all([import('../creature-img.js'), import('../../ui/kit.js')]).then(([{ pickImageFile }, { toast }]) => pickImageFile(toast, async (file) => { const ref = await uploadPortrait(file); if (ref) done(ref); }));
}

// ——— 72 · Перенос из Long Story Short ———
// Файл выбирают здесь же; разбор — lss.js (contract.loadLssFile), перенос — в кампанию игрока (contract.importLss).
function importPage(prefer = '') {
  const v = lssImportView(prefer);
  if (!v) {
    const err = lssError();
    return html`<main class="page h-import"><section class="h-import-main"><h1>Перенести героя из Long Story Short</h1>
      <p class="muted">В LSS откройте лист героя → «Экспорт» → сохраните файл .json и перетащите его сюда. Характеристики, навыки, хиты, атаки, ячейки, умения и сумка перенесутся; что ляжет не так, как в LSS, — покажем.</p>
      <label class="h-drop ${err ? 'bad' : ''}" data-drop><input type="file" accept=".json,application/json" data-lss-file hidden>${ic(err ? 'alert-circle' : 'upload-01', 28)}<b>${err ? 'Этот файл не подошёл' : 'Перетащите файл .json'}</b>
        ${err ? html`<small class="h-drop-err" role="alert">${err.file ? `${err.file}: ` : ''}${err.text}</small>` : ''}<small>${err ? 'Перетащите другой или нажмите, чтобы выбрать' : 'или нажмите, чтобы выбрать'}</small></label>
      <div class="h-import-foot"><a class="btn btn-ghost" href="#/heroes">Отменить</a></div></section></main>`;
  }
  const h = v.hero;
  const initials = h.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const issue = (x) => html`<article class="h-issue ${x.kind}"><span class="h-sq ${x.kind}">${ic(x.kind === 'error' ? 'cancel-01' : x.kind === 'info' ? 'information-circle' : 'alert-circle', 18)}</span><div><b>${x.title}</b><p>${x.text}</p></div></article>`;
  const look = v.issues.filter((x) => x.kind !== 'info').length;
  return html`<main class="page h-import">
    <section class="h-import-main"><h1>Перенесли лист из Long Story Short</h1>
      <p class="muted">${look ? `Посмотрите ${look === 1 ? 'одно место' : `${look} ${look < 5 ? 'места' : 'мест'}`}, где файл и наши правила расходятся, — поправить можно и потом, в листе.` : 'Всё совпало — можно переносить.'}</p>
      <div class="h-ok-bar">${ic('tick-02', 18)}<span><b>Совпало ${v.matched.ok} из ${v.matched.of}</b><small>${v.matched.text}</small></span></div>
      ${v.issues.map(issue)}
      <p class="h-import-where muted">${ic('information-circle', 16)}Герой ляжет в «Мои герои». Следующим шагом выберете кампанию — туда уйдёт его копия.</p>
      <div class="h-import-foot"><button class="btn btn-ghost" data-lss-drop>Другой файл</button><span class="spacer"></span><button class="btn btn-primary" data-accept>${ic('tick-02')}Сохранить героя</button></div>
    </section>
    <aside class="h-import-card"><img class="h-import-art" src="${h.portrait}" alt=""><h2>${h.name}</h2><small class="muted">${v.summary}</small>
      <div class="h-import-stats">${[['Хп', h.hpMax], ['КД', h.ac ?? '—'], ['Ур.', h.level]].map(([k, n]) => html`<span>${caps(k)}<b>${n}</b></span>`)}</div>
      <div class="h-import-token"><span class="h-initials sm">${initials}</span><small>${v.avatar ? 'Портрет в LSS лежит по ссылке на их сервере — его не берём. Пока арт класса, свой выберете в листе.' : 'Портрет и токен — арт класса; другой выберете в листе'}</small></div>
      <small class="h-file">${ic('note-edit', 14)}${v.file}</small></aside>
  </main>`;
}
function bindImport(root, L, prefer = '') {
  const take = (f) => { if (f) loadLssFile(f); };
  L('change', '[data-lss-file]', (e, t) => take(t.files?.[0]));
  L('dragover', '[data-drop]', (e, b) => { e.preventDefault(); b.classList.add('over'); });
  L('dragleave', '[data-drop]', (e, b) => b.classList.remove('over'));
  L('drop', '[data-drop]', (e) => { e.preventDefault(); take(e.dataTransfer?.files?.[0]); });
  L('click', '[data-lss-drop]', () => dropLss());
  L('click', '[data-accept]', () => heroActions.importLss({ campaignId: prefer }));
}

export { segmented, artCard, raw };
