// Тела шагов пошагового мастера (экраны 46–52). Каждый шаг — разметка из витрины creationView() и выборов черновика.
// Выборы живут только в черновике вкладки (index.js) и уходят наружу через heroActions.choose.
import { html, raw } from '../../core/dom.js';
import { ic, chip, caps, stepTitle, artCard, iconCard, segmented, check, rowIcon } from './parts.js';
import { heroActions } from './contract.js';
import { srcOf } from '../../core/assets.js';

/** Разметка шага s. d — черновик (выборы игрока поверх витрины). */
export function stepBody(s, cv, d, { head: withHead = true } = {}) {
  // На полотне создания (create.js) заголовок раздела рисует само полотно.
  const head = withHead ? stepTitle(s.title, s.hint, s.tip, s.tipIcon) : '';
  switch (s.id) {
    case 'race': return html`${head}<div class="h-grid4">${cv.races.map((o) => artCard(o, { selected: o.id === (cv.live ? cv.selected.race : d.race || 'human') }))}</div>${extraBoxes(cv.extra?.race)}`;
    case 'class': return html`${head}<div class="h-grid4">${cv.classes.map((o) => artCard(o, { selected: o.id === (cv.live ? cv.selected.class : d.class || 'wizard') }))}</div>${extraBoxes(cv.extra?.class)}`;
    case 'abilities': return abilitiesStep(head, cv.abilities, d);
    case 'background': return backgroundStep(head, cv, d);
    case 'equipment': return equipmentStep(head, cv.equipment, d);
    case 'spells': return spellsStep(head, cv.spells, d);
    case 'look': return lookStep(head, cv.look, d);
    default: return head;
  }
}

/** «Ещё выбор» расы и класса на настоящем конструкторе (подкласс, стиль, инструменты…) — в стиле блоков навыков. */
// need — выбор ещё не заполнен: после карточки экран прокручивается к нему (index.js).
const filled = (b) => /выбрано (\d+) из \1/.test(b.note || '');
export const extraBoxes = (boxes = []) => boxes.map((b) => html`<section class="h-box h-extra ${filled(b) ? '' : 'need'}"><div class="h-box-head">${caps(b.title)}<small>${filled(b) ? '' : ic('alert-circle', 14)}${b.note}</small></div>
  <div class="h-pills">${b.list.map((p) => html`<button class="h-pill ${p.on ? 'on' : ''}" data-extra="${b.choiceId}|${p.value}" aria-pressed="${String(!!p.on)}">${p.on ? ic('tick-02', 14) : ''}${p.name}</button>`)}</div></section>`);

/** «Этот шаг дал» — для живого листа справа. */
export function stepGave(s, cv, d) {
  if (s.id === 'race') return cv.raceGave[cv.live ? cv.selected.race : d.race || 'human'] || ['Особенности расы появятся в листе'];
  if (s.id === 'class') return cv.classGave[cv.live ? cv.selected.class : d.class || 'wizard'] || ['Хиты, спасброски и умения класса'];
  if (s.id === 'abilities') return cv.abilities.gave;
  if (s.id === 'background') return cv.backgroundGave;
  if (s.id === 'equipment') return cv.equipment.gave;
  if (s.id === 'spells') return cv.spells.gave;
  if (s.id === 'look') return cv.look.gave;
  return [];
}

// ——— 48 · Характеристики ———
function abilitiesStep(head, ab, d) {
  const mode = ab.mode || d.abMode || 'buy';
  const b = ab.budget;
  const card = (a) => html`<div class="h-ab ${a.main ? 'main' : ''}" data-ab="${a.key}">
    <div class="h-ab-head">${caps(a.name)}${a.main ? html`<span class="h-mini-chip accent">главная</span>` : a.tag ? html`<span class="h-mini-chip">${a.tag}</span>` : ''}</div>
    <div class="h-stepper"><button data-ab-dec="${a.key}" aria-label="Меньше">${ic('minus-sign', 16)}</button><b>${a.base}</b><button data-ab-inc="${a.key}" aria-label="Больше">${ic('plus-sign', 16)}</button></div>
    <dl class="h-ab-rows">${ab.array ? '' : html`<div><dt>Цена</dt><dd>${a.cost} оч.</dd></div>`}<div><dt>Раса</dt><dd>${a.race}</dd></div>${a.asi ? html`<div class="accent"><dt>4 уровень</dt><dd>${a.asi}</dd></div>` : ''}</dl>
    <div class="h-ab-total"><b>${a.final}</b><span class="h-modpill">${a.mod}</span></div>
  </div>`;
  return html`${head}
    <div class="h-ab-top">${segmented(ab.modes.map((m) => ({ ...m, icon: m.id === 'roll' ? 'dice-faces-06' : '' })), mode, 'data-abmode', 'dark')}
      ${ab.array ? html`<div class="h-array" aria-label="Стандартный набор">${ab.array.map((x) => html`<span class="${x.used ? 'used' : ''}">${x.value}</span>`)}<small>Шесть чисел на шесть характеристик: «+» и «−» меняют их местами</small></div>`
    : html`<div class="h-budget"><span>Потрачено ${b.spent} из ${b.of}</span><span class="h-mini-chip accent">${b.left} свободны</span><span class="h-bar"><i style="width:${Math.round((b.spent / b.of) * 100)}%"></i></span></div>`}</div>
    <div class="h-grid3">${ab.list.map(card)}</div>
    <section class="h-box"><div class="h-box-head"><b>${ab.asi.title}</b><small>${ab.asi.note}</small></div>
      <div class="h-radio-row">${ab.asi.options.map((o) => html`<button class="h-radio ${o.on ? 'on' : ''}" ${o.disabled ? raw('disabled') : ''} data-asi="${o.id}"><span class="dot"></span><span><b>${o.name}</b><small>${o.sub}</small></span></button>`)}</div></section>
    <div class="h-auto"><button class="btn btn-secondary" data-auto>${ic('magic-wand-01')}${ab.auto}</button><span class="muted sm">${ab.autoNote}</span></div>`;
}

// ——— 49 · Предыстория ———
function backgroundStep(head, cv, d) {
  const sel = cv.live ? cv.selected.background : d.background || 'sage';
  const pills = (box, attr) => html`<section class="h-box"><div class="h-box-head">${caps(box.title)}<small>${box.note}</small></div>
    <div class="h-pills">${box.list.map((p) => html`<button class="h-pill ${p.on ? 'on' : ''} ${p.from ? 'fixed' : ''}" ${raw(attr)}="${p.name}" aria-pressed="${String(!!(p.on || p.from))}" ${p.from ? raw('disabled') : ''}>${p.from ? ic('information-circle', 14) : p.on ? ic('tick-02', 14) : ''}${p.name}${p.from ? html`<small>${p.from}</small>` : ''}</button>`)}</div>
    ${box.hint ? html`<p class="h-box-hint">${box.hint}</p>` : ''}${box.tip ? html`<p class="h-box-tip">${ic('crown', 14)}${box.tip}</p>` : ''}</section>`;
  return html`${head}
    <div class="h-grid4 bg">${cv.backgrounds.map((o) => iconCard(o, { selected: o.id === sel }))}</div>
    ${pills(cv.backgroundSkills, 'data-skill')}${pills(cv.backgroundLangs, 'data-lang')}`;
}

// ——— 50 · Снаряжение ———
function equipmentStep(head, eq, d) {
  const mode = d.eqMode || 'kit';
  const pick = (g, o, p) => html`<label class="h-eq-pick"><span>${p.label}</span><span class="input"><select data-eqpick="${g.title}|${o.id}|${p.item}|${p.slot}" aria-label="${g.title}: ${p.label}">${p.list.map((x) => html`<option value="${x.id}" ${x.id === p.value ? raw('selected') : ''}>${x.name}</option>`)}</select></span></label>`;
  const row = (g, o) => html`<button class="h-opt ${o.on ? 'on' : ''}" data-eq="${g.title}|${o.name}"><span class="dot"></span><span class="h-sq sm">${ic(rowIcon(o.icon), 16)}</span><span><b>${o.name}</b><small>${o.sub}</small></span></button>${(o.pick || []).map((p) => pick(g, o, p))}`;
  return html`${head}
    ${segmented(eq.modes, mode, 'data-eqmode', 'dark')}
    ${mode === 'gold' ? html`<section class="h-box"><b>Золото вместо набора</b><p class="h-box-hint">Бросьте 4к4 × 10 — получится от 40 до 160 зм. Всё купите сами в «Сумке» листа; книга заклинаний и вещи мудреца останутся.</p><button class="btn btn-primary" data-roll-gold>${ic('dice-faces-06')}Бросить 4к4</button></section>` : eq.groups.map((g) => html`<div class="h-group">${caps(g.title)}<small>${g.note}</small></div><div class="h-grid2">${g.options.map((o) => row(g, o))}</div>`)}
    <section class="h-box"><div class="h-box-head">${caps('Всегда с вами')}<small>без выбора</small></div>${eq.always.map((a) => html`<p class="h-always">${ic(rowIcon(a.icon), 16)}${a.text}</p>`)}</section>`;
}

// ——— 51 · Заклинания ———
function spellsStep(head, sp, d) {
  const tab = sp.live ? sp.tab : d.spTab ?? sp.tab;
  const focus = d.spFocus || sp.list.find((x) => x.focus)?.name;
  return html`${head}
    <div class="h-grid3 progress">${sp.progress.map((p) => html`<div class="h-prog">${caps(p.label)}${p.now >= p.max ? html`<span class="ok">${ic('tick-02', 14)}</span>` : html`<span></span>`}<b>${p.now} из ${p.max}</b><span class="h-bar magic"><i style="width:${Math.round((p.now / p.max) * 100)}%"></i></span></div>`)}</div>
    <div class="h-spell-tools">${segmented(sp.tabs.map((t, i) => ({ id: String(i), name: t })), String(tab), 'data-sptab', 'dark')}<button class="btn btn-secondary" data-auto>${ic('magic-wand-01')}Собрать за меня</button></div>
    <div class="h-spell-split">
      <div class="h-spell-list">${sp.list.map((x) => html`<button class="h-sp ${x.name === focus ? 'focus' : ''}" data-sp="${x.name}">${check(x.on, 'magic')}<span><b>${x.name}</b><small>${x.meta}</small></span>${x.conc ? html`<span class="h-kr k">К</span>` : ''}${x.ritual ? html`<span class="h-kr">Р</span>` : ''}</button>`)}</div>
      <aside class="h-spell-card"><span class="chip chip-md chip-magic">${sp.detail.tag}</span><h2>${sp.detail.name}</h2><p>${sp.detail.text}</p></aside>
    </div>
    <div class="h-full-toast">${ic('alert-circle', 20)}<span><b>${sp.full.title}</b><small>${sp.full.text}</small></span><button class="btn btn-sm btn-secondary" data-replace>${sp.full.action}</button></div>`;
}

// ——— 52 · Образ ———
function lookStep(head, lk, d) {
  const pr = d.pronoun || lk.pronoun;
  const al = d.alignment || lk.alignment;
  return html`${head}
    <div class="h-look">
      <div class="h-look-left">
        <label class="h-field"><span>Имя</span><span class="input lg"><input data-name value="${d.name ?? lk.name}" maxlength="40"></span></label>
        <div class="h-field"><span>Как о герое писать</span>${segmented(lk.pronouns.map((p) => ({ id: p, name: p })), pr, 'data-pronoun', 'dark wide')}<small class="muted">${lk.pronounNote}</small></div>
        <div class="h-look-portrait"><img class="big" src="${srcOf(lk.portrait || 'assets/hero/class-fighter.webp')}" alt="Портрет">
          <div class="h-look-side"><button class="btn btn-secondary" data-lupload>${ic('image-add-01')}Загрузить свой</button>
            <div class="h-token-prev"><span class="tok-prev"><img src="${srcOf(lk.portrait || 'assets/hero/class-fighter.webp')}" alt=""></span><small>Так ${pr === 'он' ? 'он выглядит' : pr === 'они' ? 'они выглядят' : 'она выглядит'} на карте</small></div></div></div>
        ${lk.portraits ? html`<div class="h-field"><span>Или из набора</span><div class="h-quick-portraits sm">${lk.portraits.map((p) => html`<button class="h-portrait-pick ${p === lk.portrait ? 'on' : ''}" data-lportrait="${p}"><img src="${p}" alt="" loading="lazy"></button>`)}</div></div>` : ''}
      </div>
      <div class="h-look-right">
        <div class="h-group">${caps('Мировоззрение')}<small>подсказка для мастера, не правило</small></div>
        <div class="h-align">${lk.alignments.map((a) => html`<button class="h-pill sm ${a === al ? 'on' : ''}" data-align="${a}">${a}</button>`)}</div>
        ${lk.fields.map((f) => html`<label class="h-field"><span class="h-field-head">${f.label}</span><span class="input area"><textarea rows="2" data-text="${f.id}">${d[f.id] ?? f.value}</textarea></span></label>`)}
      </div>
    </div>`;
}

/** Обработчики шагов, кроме выбора карточки (он общий в index.js). */
export function bindStepExtras(root, L, stepId, d, save, rerender) {
  // stepId — шаг экрана или функция «шаг по нажатому элементу» (полотно create.js: все шаги на одной странице).
  const stepOf = (el) => (typeof stepId === 'function' ? stepId(el) : stepId);
  const set = (k, v, el) => { d[k] = v; save(); heroActions.choose({ step: stepOf(el), id: k, value: v }); };
  L('click', '[data-abmode]', (e, b) => { if (!b.disabled) { set('abMode', b.dataset.abmode, b); rerender(); } });
  L('change', '[data-eqpick]', (e, t) => heroActions.choose({ step: stepOf(t), id: 'eqPick', value: `${t.dataset.eqpick}|${t.value}` }));
  L('click', '[data-eqmode]', (e, b) => { set('eqMode', b.dataset.eqmode, b); rerender(); });
  L('click', '[data-sptab]', (e, b) => { set('spTab', +b.dataset.sptab, b); rerender(); });
  L('click', '[data-sp]', (e, b) => { set('spFocus', b.dataset.sp, b); rerender(); });
  L('click', '[data-pronoun]', (e, b) => { set('pronoun', b.dataset.pronoun, b); rerender(); });
  L('click', '[data-align]', (e, b) => { set('alignment', b.dataset.align, b); rerender(); });
  L('input', '[data-name]', (e, t) => { d.name = t.value; save(); });
  L('input', '[data-text]', (e, t) => { d[t.dataset.text] = t.value; save(); });
  L('click', '[data-extra]', (e, b) => heroActions.choose({ step: stepOf(b), id: 'extra', value: b.dataset.extra }));
  // Портрет героя (он же токен): из набора или свой файл (#203).
  L('click', '[data-lportrait]', (e, b) => heroActions.choose({ step: 'look', id: 'portrait', value: b.dataset.lportrait }));
  L('click', '[data-lupload]', () => import('./index.js').then(({ pickPortrait }) => pickPortrait((ref) => heroActions.choose({ step: 'look', id: 'portrait', value: ref }))));
  L('click', '[data-ab-inc],[data-ab-dec],[data-asi],[data-auto],[data-skill],[data-lang],[data-eq],[data-roll-gold],[data-replace],[data-trait]', (e, b) => {
    const key = Object.keys(b.dataset)[0];
    heroActions.choose({ step: stepOf(b), id: key, value: b.dataset[key] });
  });
}
