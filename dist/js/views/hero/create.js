// Создание героя одним полотном (#203, 06.11 — sol0139: «сделай процесс создания персонажа примерно таким же, как его
// редактирование»). Все шаги мастера — разделами одной страницы, как в правке героя (edit.js): слева оглавление с
// отметками «готово / нужно выбрать», по центру выборы (тела шагов steps.js), справа живой лист. Адрес
// #/hero/new/<шаг> прокручивает к разделу; «Создать героя» — в нижней панели, всегда под рукой.
import { html } from '../../core/dom.js';
import { ic, caps, liveSheet } from './parts.js';
import { creationView, creationLive, creationDone, heroActions } from './contract.js';
import { stepBody, bindStepExtras } from './steps.js';

const ICONS = { race: 'user', class: 'shield-user', abilities: 'dice-faces-06', background: 'book-open-01', equipment: 'backpack-01', spells: 'sparkles', look: 'image-01' };
// Раздел, к которому прокрутить после перерисовки: выбор карточки открывает «ещё выбор» под ней (подраса, навыки…).
let pendingFocus = '';
// Последний раздел из адреса: при переходе по ссылке «к шагу» страница едет к нему, при перерисовке — стоит на месте.
let routed = '';

/** Заклинаний на старте нет (воин, плут…) — одна строка вместо пустого списка и всплывашки. */
const noSpells = (cv) => html`<p class="e-note">${ic('information-circle', 16)}<span>${cv.spells?.detail?.name || 'Заклинаний на старте нет'}. Магию любому герою можно добавить потом на листе — если мастер разрешит.</span></p>`;

/** Состояние шага для оглавления: ok — готов, need — ещё выбрать, '' — не начат. */
function stepState(cv, id) {
  const c = (cv.done?.checks || []).find((x) => x.step === id);
  if (!c) return '';
  return c.ok ? 'ok' : 'need';
}
const stepMark = (st, i, name) => html`<span class="c-num">${st === 'ok' ? ic('tick-02', 12) : i + 1}</span><span>${name}</span>${st === 'need' ? html`<i class="c-need" aria-label="нужно выбрать"></i>` : ''}`;
const badge = (st) => (st === 'need' ? html`<span class="c-badge">${ic('alert-circle', 14)}Нужно выбрать</span>` : st === 'ok' ? html`<span class="c-badge ok">${ic('tick-02', 14)}Готово</span>` : '');
/** Можно ли создавать и что сказать в нижней панели. */
function readiness(cv, real) {
  const need = cv.steps.filter((s) => stepState(cv, s.id) === 'need');
  const ok = real ? real.status === 'valid' : !need.length;
  const hint = ok ? 'Всё выбрано — можно создавать. Потом героя можно поправить в любой момент.' : `Осталось: ${need.map((s) => s.name).join(', ') || 'проверить выборы'}`;
  return { ok, hint, need };
}

export function createPage(stepId, draft) {
  const cv = creationView();
  const real = creationDone();
  const live = creationLive('look');
  const steps = cv.steps;
  const { ok, hint } = readiness(cv, real);
  const nav = html`<nav class="e-nav" aria-label="Шаги">${steps.map((s, i) => html`<button data-goto="${s.id}" class="c-step ${stepState(cv, s.id)}">${stepMark(stepState(cv, s.id), i, s.name)}</button>`)}</nav>`;
  const sections = steps.map((s) => html`<section class="e-sec c-sec ${stepState(cv, s.id)}" id="c-${s.id}" data-sec="${s.id}" data-step="${s.id}">
    <header class="e-sec-head"><span class="e-sec-ic">${ic(ICONS[s.id] || 'star', 18)}</span><h2>${s.title || s.name}</h2><small>${s.hint || ''}</small>
      <span class="c-badge-slot">${badge(stepState(cv, s.id))}</span></header>
    ${s.id === 'spells' && !cv.spells?.list?.length ? noSpells(cv) : stepBody(s, cv, draft, { head: false })}
  </section>`);
  return html`<main class="e-page">
    <header class="e-head">
      <a class="icon-btn" href="#/hero/new" aria-label="Назад к выбору пути">${ic('arrow-left-02')}</a>
      <span class="e-head-pic"><img src="${live.portrait || 'assets/hero/class-fighter.webp'}" alt=""></span>
      <span class="e-head-who">${caps('Новый герой')}<b>${live.name || 'Без имени'}</b></span>
      <span class="spacer"></span>
      <span class="e-where">${ic('crown', 14)}${cv.campaignId ? `${cv.campaign.level} уровень — так решил мастер` : `${cv.campaign.level} уровень`}</span>
    </header>
    <div class="e-layout">
      ${nav}
      <div class="e-main">${sections}</div>
      <div class="e-preview">${liveSheet(live, { note: cv.campaignId ? `Для кампании «${cv.campaign.name || ''}»` : '' })}</div>
    </div>
    <footer class="h-bottom e-bottom">
      <a class="btn btn-secondary" href="#/hero/new">${ic('arrow-left-02')}Назад</a>
      <span class="h-bottom-hint">${hint}</span>
      <a class="btn btn-ghost c-sum" href="#/hero/new/done">${ic('eye')}Итог</a>
      <button class="btn btn-primary ${ok ? '' : 'c-soft'}" data-create>${ic('tick-02')}Создать героя</button>
    </footer>
  </main>`;
}

/** Обработчики полотна. stepId — раздел из адреса (к нему едем при открытии). */
export function bindCreate(root, L, stepId, draft, save, rerender) {
  const stepOf = (el) => el.closest('[data-step]')?.dataset.step || 'race';
  const sc = () => root.querySelector('.screen');
  const goTo = (id, smooth = true) => {
    const t = root.querySelector(`#c-${id}`), s = sc();
    if (t && s) s.scrollTo({ top: t.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop - (window.innerWidth < 900 ? 72 : 16), behavior: smooth ? 'smooth' : 'auto' });
  };
  L('click', '[data-pick]', (e, b) => {
    const step = stepOf(b), id = b.dataset.pick;
    draft[step] = id; save();
    pendingFocus = step;
    heroActions.choose({ step, id });
  });
  bindStepExtras(root, L, stepOf, draft, save, rerender);
  L('click', '[data-goto]', (e, b) => goTo(b.dataset.goto));
  // Имя и черты пишутся без перерисовки (фокус в поле не теряется) — отметки и шапку обновляем на месте.
  let tm = 0;
  const later = () => { clearTimeout(tm); tm = setTimeout(() => refreshMarks(root), 250); };
  L('input', '[data-name]', later);
  L('change', '[data-name]', () => { clearTimeout(tm); refreshMarks(root); });
  // «Создать героя»: готов — создаём; нет — едем к первому незаполненному шагу.
  L('click', '[data-create]', () => {
    clearTimeout(tm);
    const real = creationDone();
    if (real && real.status === 'valid') { heroActions.finish({}); return; }
    if (!real) { location.hash = '#/hero/new/done'; return; }
    // Что не выбрано — по свежим проверкам, а не по отметкам на экране (имя могли ввести только что).
    const { need } = refreshMarks(root);
    const first = need[0] && root.querySelector(`#c-${need[0].id}`);
    if (first) { goTo(need[0].id); first.classList.remove('c-flash'); void first.offsetWidth; first.classList.add('c-flash'); }
  });
  // Оглавление подсвечивает раздел на экране.
  const s = sc();
  if (s) {
    let raf = 0;
    const mark = () => {
      raf = 0;
      const line = s.getBoundingClientRect().top + s.clientHeight * 0.3;
      const secs = [...root.querySelectorAll('.c-sec')];
      const atEnd = s.scrollTop + s.clientHeight >= s.scrollHeight - 4;
      const cur = atEnd ? secs.at(-1) : secs.filter((x) => x.getBoundingClientRect().top <= line).at(-1) || secs[0];
      root.querySelectorAll('.e-nav [data-goto]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.goto === cur?.dataset.sec)));
      const btn = root.querySelector(`.e-nav [aria-current="true"]`), nav = btn?.parentElement;
      if (nav && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: btn.offsetLeft - nav.clientWidth / 2 + btn.offsetWidth / 2 });
    };
    s.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(mark); }, { passive: true });
    requestAnimationFrame(mark);
  }
  // После выбора карточки — к первому незаполненному «ещё выбору» этого раздела; по адресу — к разделу.
  if (pendingFocus) {
    const box = root.querySelector(`#c-${pendingFocus} .h-extra.need`);
    pendingFocus = '';
    if (box) requestAnimationFrame(() => box.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  } else if (stepId && stepId !== routed) {
    routed = stepId;
    // Первый шаг — и так наверху: шапку полотна не прячем.
    if (stepId !== root.querySelector('.c-sec')?.dataset.sec) requestAnimationFrame(() => goTo(stepId, false));
  }
}
/** Отметки шагов, плашки разделов, подсказка и кнопка внизу, имя в шапке — по свежему черновику, без перерисовки. */
function refreshMarks(root) {
  const cv = creationView();
  const r = readiness(cv, creationDone());
  cv.steps.forEach((s, i) => {
    const st = stepState(cv, s.id);
    const b = root.querySelector(`.e-nav [data-goto="${s.id}"]`);
    const was = b?.classList.contains('ok') ? 'ok' : b?.classList.contains('need') ? 'need' : '';
    if (b && was !== st) {
      b.classList.remove('ok', 'need'); if (st) b.classList.add(st);
      b.innerHTML = String(stepMark(st, i, s.name));
    }
    const sec = root.querySelector(`#c-${s.id}`);
    if (sec) { sec.classList.remove('ok', 'need'); if (st) sec.classList.add(st); }
    const slot = sec?.querySelector('.c-badge-slot');
    if (slot) slot.innerHTML = String(badge(st));
  });
  const hint = root.querySelector('.e-bottom .h-bottom-hint');
  if (hint) hint.textContent = r.hint;
  root.querySelector('[data-create]')?.classList.toggle('c-soft', !r.ok);
  const name = creationLive('look').name || 'Без имени';
  root.querySelectorAll('.e-head-who b, .h-live .who b').forEach((x) => { x.textContent = name; });
  return r;
}
/** Новый вход на полотно (уход со страницы создания) — снова ехать к разделу из адреса. */
export const resetCreateRoute = () => { routed = ''; };
