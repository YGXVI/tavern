// Лист героя на витринных данных (#203): удобный лист (54–59), классический (60), лист на карте (61–66), корнеры (67–71).
// Адреса: #/hero/<id>[/<combat|magic|skills|bag|person>] · #/hero/<id>/classic/<1-3> · #/hero/<id>/table[/<вкладка>]
// Корнеры и варианты — после «?»: down, concentration, noSlots, multiclass, unfinished, roll, stub, ask, levelup.
import { html, raw } from '../../core/dom.js';
import { modal, popover, closePopover, toast, confirmDialog } from '../../ui/kit.js';
import { CONDITIONS } from '../../data/rules.js';
import { heroView, heroActions, gearCatalog, spellCatalog, SPELL_CLASSES, PORTRAITS, uploadPortrait } from './contract.js';
import { ic, chip, caps, rowIcon, segmented, check, pips } from './parts.js';
import { previewNote } from './index.js';

const TABS = [
  { id: 'combat', name: 'Бой', icon: 'sword-01' }, { id: 'magic', name: 'Магия', icon: 'sparkles' },
  { id: 'skills', name: 'Навыки', icon: 'hand-grip' }, { id: 'bag', name: 'Сумка', icon: 'backpack-01' }, { id: 'person', name: 'Личность', icon: 'pencil-edit-02' },
];
// Правки на этой странице живут до перезагрузки: витрина неизменна, действия уходят в heroActions.
const local = { hpDelta: {}, prepared: {}, spellFocus: '', magicView: 'ready', search: '' };

export function mount(root, { parts, query, page, L }) {
  const [, id = 'lira', sub, n] = parts;
  const q = new Set(query.split('&').filter(Boolean));
  const corner = ['down', 'concentration', 'noSlots', 'multiclass', 'unfinished'].find((c) => q.has(c)) || '';
  const v = heroView(id, corner);
  // Героя нет (удалён, чужая кампания, старая ссылка) — так и говорим, без образца вместо него.
  if (!v) {
    page(html`<main class="page h-page"><div class="h-center h-missing">${ic('user', 32)}<h1>Героя не найти</h1><p class="muted">Его могли удалить или перенести, а может, это герой кампании, где вас нет.</p><a class="btn btn-primary" href="#/heroes">${ic('arrow-left-02')}Ко всем героям</a></div></main>`);
    return;
  }
  // Лист на карте у настоящего героя — это стол кампании с панелью листа (#203), а не картинка-образец.
  if (sub === 'table' && v.live) { const [cid, chid] = String(v.id).split('~'); location.replace(`#/c/${cid}/sheet/${encodeURIComponent(chid)}`); return; }
  const tab = TABS.some((t) => t.id === sub) ? sub : 'combat';
  // Перерисовка на месте: слушатели делегированы на корень и переживают её.
  const render = () => {
    if (sub === 'classic') page(classicPage(v, Math.min(3, Math.max(1, +n || 1))), 'sheet-page classic', false);
    else if (sub === 'table') page(tablePage(v, n || 'combat', q), 'table-preview', false);
    else page(sheetPage(v, tab, q), 'sheet-page', false);
    const nm = root.querySelector('[data-fullname]');
    if (nm && nm.scrollWidth > nm.clientWidth) nm.classList.add('cut');
  };
  render();
  bindSheet(root, L, v, render);
}

// ——— общие куски ———
// Ячейки круга lv: у настоящего героя ID пула любой (legacy-slot-N, slots-…), круг — в поле circle.
const slotOf = (v, lv) => v.resources.find((r) => r.kind === 'slot' && (r.circle === lv || r.id === `slot-${lv}`));
// Настоящий герой (v.live) — хиты уже в данных; локальная поправка только у образца.
const hpOf = (v) => { const h = v.vitals.hp; const now = Math.max(0, Math.min(h.max, h.now + (v.live ? 0 : local.hpDelta[v.id] || 0))); return { ...h, now }; };

function sheetHead(v, mode) {
  const back = mode === 'table' || mode === 'drawer' ? '' : html`<a class="icon-btn" href="#/heroes" aria-label="К героям">${ic('arrow-left-02')}</a>`;
  // Портрет — он же токен: владелец и мастер меняют его нажатием (набор артов или свой файл с кадрированием).
  const pic = v.live && v.canEdit
    ? html`<button class="s-portrait edit ${v.isMine === false ? 'other' : ''}" data-portrait aria-label="Сменить портрет" title="Сменить портрет"><img src="${v.portrait}" alt=""><span class="s-portrait-edit">${ic('image-add-01', 14)}</span></button>`
    : html`<span class="s-portrait ${v.isMine === false ? 'other' : ''}"><img src="${v.portrait}" alt=""></span>`;
  return html`<header class="s-head">${back}${pic}
    <span class="s-who"><b class="s-name" title="${v.name}" data-fullname>${v.name}</b><small>${v.subtitle}${mode !== 'drawer' && v.campaign?.name ? html`<span class="s-camp">${ic('home-01', 12)}${v.campaign.name}</span>` : ''}</small></span>
    <span class="spacer"></span>
    ${mode === 'drawer' ? html`<button class="icon-btn icon-btn-sm" data-more aria-label="Ещё">${ic('more-horizontal', 18)}</button><button class="icon-btn icon-btn-sm" data-close-sheet aria-label="Закрыть">${ic('cancel-01', 18)}</button>`
      : mode === 'table' ? html`${v.isMine === false ? '' : html`<a class="icon-btn icon-btn-sm" href="#/hero/${v.id}" aria-label="Открыть полностью">${ic('maximize-01', 18)}</a>`}<button class="icon-btn icon-btn-sm" data-more aria-label="Ещё">${ic('more-horizontal', 18)}</button><a class="icon-btn icon-btn-sm" href="#/hero/${v.id}/table?stub" aria-label="Свернуть">${ic('cancel-01', 18)}</a>`
      : html`${v.live && v.canLevelUp ? html`<a class="btn btn-sm btn-secondary" href="#/hero/${v.id}/levelup/hp">${ic('sparkles', 16)}Новый уровень</a>` : ''}<nav class="h-seg dark s-mode"><a href="#/hero/${v.id}" aria-selected="${mode === 'easy'}">${ic('book-open-01', 16)}Удобный</a><a href="#/hero/${v.id}/classic/1" aria-selected="${mode === 'classic'}">${ic('pen-tool-01', 16)}Классический</a></nav><button class="icon-btn icon-btn-sm" data-more aria-label="Ещё">${ic('more-horizontal', 18)}</button>`}
  </header>`;
}

function hpCard(v, { readonly = false } = {}) {
  const h = hpOf(v);
  const pct = h.max ? Math.round((h.now / h.max) * 100) : 0;
  const low = h.max && h.now > 0 && h.now / h.max <= 0.3;
  const mid = html`<span class="s-hp-row"><span class="k">Хиты</span><b data-hp-now>${h.now}</b><span class="max">/ ${h.max}</span><span class="spacer"></span>${h.temp ? html`<span class="s-temp">${ic('shield-user', 12)}+${h.temp}</span>` : ''}</span><span class="s-hp-bar"><i style="width:${pct}%"></i></span>`;
  return html`<div class="s-hp ${h.now === 0 ? 'zero' : ''} ${low ? 'low' : ''}">
    ${readonly ? '' : html`<button class="s-hp-btn" data-hp="-1" aria-label="Урон 1" title="−1">${ic('minus-sign', 18)}</button>`}
    ${readonly ? html`<div class="s-hp-mid">${mid}</div>` : html`<button class="s-hp-mid" data-hp-pad aria-label="Урон, лечение, временные хиты" title="Урон, лечение, временные хиты — числом">${mid}</button>`}
    ${readonly ? '' : html`<button class="s-hp-btn" data-hp="1" aria-label="Лечение 1" title="+1">${ic('plus-sign', 18)}</button>`}
  </div>`;
}

// КД, инициатива, скорость, мастерство — плитками: КД объясняет, откуда число, инициатива бросается.
const pills = (v) => html`<div class="s-vitals">
  <button class="s-vital ac" data-explain="ac" title="Откуда КД">${ic('shield-01', 16)}<b>${v.vitals.ac.value}</b><small>КД</small></button>
  <button class="s-vital" data-roll="Инициатива|к20 ${v.vitals.init}" title="Бросить инициативу">${ic('flash', 16)}<b>${v.vitals.init}</b><small>Инициатива</small></button>
  <span class="s-vital">${ic('running-shoes', 16)}<b>${parseInt(v.vitals.speed, 10) || '—'}</b><small>фт ходьба</small></span>
  <span class="s-vital">${ic('star', 16)}<b>${v.vitals.prof}</b><small>Мастерство</small></span></div>`;

function concRow(v) {
  const c = v.concentration;
  const notice = v.notice ? html`<span class="s-note">${v.notice}</span>` : '';
  const conds = (v.conditions || []).map((x) => html`<button class="s-cond" data-cond-chip="${x.id}" title="Снять">${x.name}${ic('cancel-01', 12)}</button>`);
  return html`<div class="s-conc">${conds}${c ? html`<span class="s-conc-chip">${ic('sparkles', 14)}Концентрация: ${c.spell}<button data-drop-conc aria-label="Снять">${ic('cancel-01', 12)}</button></span>` : ''}${notice}${v.down ? '' : html`<button class="s-add" data-add-cond>${ic('plus-sign', 14)}Состояние</button>`}</div>`;
}

// Текст заклинания: свой с листа, иначе первый абзац SRD 5.1 (английский) и ссылка в справочник.
const spellText = (s) => (s.text ? html`<p>${s.text}</p>` : s.srdText?.length ? html`<p lang="en" class="s-srd">${s.srdText[0]}</p>` : '');
// Характеристика: проверка — по карточке, спасбросок — строкой под ней (золотая точка — владеет).
const statBox = (a) => html`<div class="s-stat"><button class="s-stat-main" data-roll="Проверка: ${a.name}|к20 ${a.mod}" title="Проверка: ${a.name}"><small>${a.short}</small><b>${a.mod}</b><span>${a.score}</span></button><button class="s-stat-save ${a.saveProf ? 'prof' : ''}" data-roll="Спасбросок: ${a.name}|к20 ${a.save}" title="Спасбросок: ${a.name}${a.saveProf ? ' (владеет)' : ''}"><i></i>спас ${a.save}</button></div>`;
const statsGrid = (v, cls = '') => html`<div class="s-stats ${cls}">${v.abilities.map(statBox)}</div>`;

function resources(v) {
  return html`<div class="s-res">${v.resources.map((r) => html`<div class="s-res-row" data-res="${r.id}"><span>${r.name}</span>${pips(r.left, r.total, r.kind)}<b>${r.left}/${r.total}</b></div>`)}</div>`;
}
const restBtns = () => html`<div class="s-rest"><button class="btn btn-secondary" data-rest="short">${ic('hourglass', 16)}Короткий отдых</button><button class="btn btn-secondary" data-rest="long">${ic('tent', 16)}Долгий отдых</button></div>`;

function deathPanel(v) {
  const d = v.vitals.deathSaves;
  const dots = (n, cls) => html`${[0, 1, 2].map((i) => html`<i class="${cls} ${i < n ? 'on' : ''}"></i>`)}`;
  return html`<section class="s-death"><div class="s-death-head">${ic('sad-dizzy', 16)}<b>${v.name} без сознания</b><span class="spacer"></span><small>спасбросок от смерти</small></div>
    <div class="s-death-row"><span>Успехи</span><span class="s-dots">${dots(d.ok, 'ok')}</span></div><div class="s-death-row"><span>Провалы</span><span class="s-dots">${dots(d.fail, 'fail')}</span></div>
    <p>10 и выше — успех. 20 — встаёте с 1 хитом. 1 — сразу два провала. Любое лечение поднимет вас.</p>
    <button class="btn btn-primary btn-block" data-death>${ic('dice-faces-06', 16)}Бросить спасбросок: к20</button></section>`;
}
function concPanel(v) {
  const c = v.concCheck;
  return html`<section class="s-conccheck"><div class="s-death-head">${ic('sparkles', 16)}<b>Удержать ${c.spell}?</b><span class="spacer"></span><small>концентрация</small></div>
    <p>${c.text}</p><div class="s-conccheck-acts"><button class="btn btn-primary" data-roll="Спасбросок Телосложения · концентрация|${c.roll}">${ic('dice-faces-06', 16)}Бросить: ${c.roll}</button><button class="btn btn-ghost" data-drop-conc>${ic('cancel-01', 16)}Отпустить</button></div></section>`;
}

// ——— строки действий ———
function actionRow(v, a) {
  if (a.empty) return html`<div class="s-act s-act-empty">${ic('sparkles', 18)}<span>${a.name}</span><span class="spacer"></span>${a.action ? html`<a class="btn btn-sm btn-secondary" href="#/hero/${v.id}/magic">${a.action}</a>` : ''}</div>`;
  // Умение с зарядами (Ярость, Второе дыхание…): сколько осталось и «потратить» вместо броска.
  if (a.res) return html`<div class="s-act feature ${a.left ? '' : 'noslot'}" data-act-row="${a.id}"><span class="s-act-ic">${ic(rowIcon('feature'), 18)}</span><span class="s-act-t"><b>${a.name}</b><small>${a.sub}</small></span><span class="s-chips"><span class="s-chip dc">${a.left} ${a.left === 1 ? 'заряд' : a.left > 1 && a.left < 5 ? 'заряда' : 'зарядов'}</span><button class="s-chip use" data-res="${a.res}" ${a.left ? '' : raw('disabled')} title="Потратить заряд">${ic('tick-02', 12)}Потратить</button></span></div>`;
  const noSlot = v.noSlot && a.slotLevel === v.noSlot.level;
  const off = v.down;
  const block = off || noSlot ? raw('data-blocked') : '';
  // Чипы — сами броски: «+5» — атака, «1к4+2» — урон; «СЛ 15» объясняет, откуда число; «1 ур.» — сотворить с ячейкой.
  const hit = a.hit ? html`<button class="s-chip hit" data-roll="${a.name}: атака|к20 ${a.hit}" ${block} title="Бросить атаку">${ic('dice-faces-06', 12)}${a.hit}</button>` : '';
  const dc = a.dc ? html`<span class="s-chip dc" ${a.explain ? raw(`data-explain="${a.explain}"`) : ''}>${a.dc}</span>` : '';
  const dmg = a.dmg ? html`<button class="s-chip dmg" data-roll="${a.name}: урон|${dmgFormula(a.dmg)}" ${block} title="Бросить урон">${a.dmg}</button>` : '';
  const cast = a.icon === 'spell' && a.slotLevel && v.live ? html`<button class="s-chip cast" data-cast="${a.id}" ${block} title="Сотворить: потратить ячейку">${ic('sparkles', 12)}${a.slotLevel} ур.</button>` : '';
  return html`<div class="s-act ${a.icon} ${noSlot ? 'noslot' : ''} ${off ? 'off' : ''}" data-act-row="${a.id}">
    <span class="s-act-ic">${ic(rowIcon(a.icon), 18)}</span>
    <span class="s-act-t"><b>${a.name}</b><small>${noSlot ? `${a.slotLevel} ур. · нет ячеек` : a.sub}</small></span>
    <span class="s-chips">${hit}${dc}${dmg}${cast}</span>
  </div>`;
}
// «3 × 1к4+1» (Волшебная стрела) — одним броском 3к4+3; остальное — как написано.
export function dmgFormula(t) {
  const m = /^(\d+)×(\d*)к(\d+)(?:([+−-])(\d+))?$/.exec(String(t).replace(/\s+/g, ''));
  if (!m) return t;
  const n = +m[1], c = +(m[2] || 1), f = m[5] ? +m[5] * n : 0;
  return `${n * c}к${m[3]}${f ? `${m[4] === '+' ? '+' : '−'}${f}` : ''}`;
}
const group = (title, note, rows) => (rows.length ? html`<div class="s-group">${caps(title)}<small>${note}</small></div>${rows}` : '');

function combatTab(v, { narrow = false } = {}) {
  const act = v.actions;
  const econ = html`<div class="s-econ">${v.economy.map((e) => html`<span class="s-econ-chip ${e.left && !v.down ? '' : 'used'}"><i></i>${e.name}</span>`)}</div>`;
  const left = group('Действие', '1 за ход', act.action.map((a) => actionRow(v, a)));
  const right = html`${group('Бонусное действие', '1 за ход', act.bonus.map((a) => actionRow(v, a)))}${group('Реакция', 'до вашего хода', act.reaction.map((a) => actionRow(v, a)))}${group('Особое', 'в свой ход', (act.special || []).map((a) => actionRow(v, a)))}`;
  return html`${econ}${narrow ? html`<div class="s-col">${left}${right}</div>` : html`<div class="s-cols"><div class="s-col">${left}</div><div class="s-col">${right}</div></div>`}`;
}

function magicTab(v, { narrow = false } = {}) {
  const sc = v.spellcasting;
  const add = v.live && v.canEdit ? html`<button class="btn btn-secondary btn-sm" data-add-spell>${ic('plus-sign', 14)}Заклинание</button>` : '';
  // Магия — не только у заклинателей (#203): артефакт, дар мастера или хоумбрю дают заклинания любому герою.
  if (!sc || !sc.spells.length) return html`${sc ? magicHead(v, sc, add, narrow) : ''}<div class="s-empty">${ic('sparkles', 28)}<b>Заклинаний нет</b><p class="muted">${sc ? 'Добавьте заговоры и заклинания — из справочника или свои.' : 'Артефакт, дар мастера или хоумбрю дали герою магию? Добавьте любое заклинание — характеристику колдовства выберете здесь же.'}</p>${add ? html`<button class="btn btn-primary" data-add-spell>${ic('plus-sign')}Добавить заклинание</button>` : ''}</div>`;
  const view = local.magicView;
  const prepared = (s) => local.prepared[s.id] ?? s.prepared;
  let list = sc.spells;
  if (view === 'ready') list = list.filter((s) => s.level === 0 || prepared(s));
  if (view === 'ritual') list = list.filter((s) => s.ritual);
  if (local.search) list = list.filter((s) => s.name.toLowerCase().includes(local.search));
  const byLevel = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((lv) => ({ lv, items: list.filter((s) => s.level === lv) })).filter((g) => g.items.length);
  const slot = (lv) => slotOf(v, lv);
  const spell = (s) => {
    const open = s.id === local.spellFocus;
    return html`<div class="s-spell ${open ? 'open' : ''}" data-spell="${s.id}"><button class="s-spell-row" data-spell-open="${s.id}"><span data-prep="${s.id}">${check(prepared(s) || s.level === 0, 'magic')}</span><span class="t"><b>${s.name}</b><small>${[s.range, s.time].filter(Boolean).map((x) => x.toLowerCase()).join(' · ') || (s.text ? s.text.slice(0, 80) : s.level ? `${s.level} ур.` : 'заговор')}</small></span>${s.conc ? html`<span class="h-kr k">К</span>` : ''}${s.ritual ? html`<span class="h-kr">Р</span>` : ''}</button>
      ${open ? html`<div class="s-spell-more"><small>${s.meta || [s.time, s.range, s.duration, s.comp].filter(Boolean).join(' · ')}</small>${spellText(s)}<div class="s-spell-acts"><button class="btn btn-primary btn-sm" data-cast="${s.id}">${ic('sparkles', 14)}${s.level ? `Сотворить · ячейка ${s.level} ур.` : 'Сотворить'}</button>${v.live && v.canEdit ? html`<span class="spacer"></span><button class="btn btn-ghost btn-sm" data-drop-spell="${s.id}" data-name="${s.name}">${ic('delete-02', 14)}Убрать из листа</button>` : ''}</div></div>` : ''}</div>`;
  };
  const groups = byLevel.map((g) => html`<div class="s-group">${caps(g.lv ? `${g.lv} уровень` : 'Заговоры')}<small>${g.lv && slot(g.lv)?.total ? `${slot(g.lv).left} из ${slot(g.lv).total} ячеек` : g.lv ? 'ячеек этого уровня нет' : 'без ячеек'}</small></div>${g.items.map(spell)}`);
  const half = Math.ceil(groups.length / 2);
  const slotsBox = narrow ? html`<div class="s-res">${v.resources.filter((r) => r.kind === 'slot').map((r) => html`<div class="s-res-row"><span>${r.name.replace('Ячейки ', '').replace(' ур.', ' уровень')}</span>${pips(r.left, r.total)}<b>${r.left}/${r.total}</b></div>`)}</div>` : '';
  return html`${slotsBox}${magicHead(v, sc, add, narrow)}
    ${narrow ? html`<div class="s-col">${groups}</div>` : html`<div class="s-cols"><div class="s-col">${groups.slice(0, half)}</div><div class="s-col">${groups.slice(half)}</div></div>`}`;
}

// Шапка магии: СЛ, атака, сколько готово, характеристика «Предметов и даров», фильтр списка, «+ Заклинание».
function magicHead(v, sc, add, narrow) {
  const ab = sc.extra && v.live && v.canEdit ? html`<span class="s-ab-pick" title="Чем колдует: предметы и дары">${[['int', 'ИНТ'], ['wis', 'МДР'], ['cha', 'ХАР']].map(([k, t]) => html`<button data-spell-ab="${k}" aria-pressed="${sc.abilityId === k}">${t}</button>`)}</span>` : '';
  return html`<div class="s-magic-top"><span class="s-pill"><small>сл</small><b data-explain="dc">${sc.dc}</b></span><span class="s-pill"><small>атака</small><b>${sc.attack}</b></span>${sc.spells.length ? html`<span class="s-pill"><small>готово</small><b>${sc.prepared.now} из ${sc.prepared.max}</b></span>` : ''}${ab}<span class="spacer"></span>
    ${sc.spells.length ? segmented([{ id: 'ready', name: 'Готовые' }, { id: 'book', name: 'Все' }, { id: 'ritual', name: 'Ритуалы' }], local.magicView, 'data-mview', narrow ? 'wide' : '') : ''}${add}</div>`;
}

function skillsTab(v, { narrow = false, ask = false } = {}) {
  let skills = v.skills;
  if (local.search) skills = skills.filter((s) => s.name.toLowerCase().includes(local.search));
  const row = (s) => html`<button class="s-skill ${ask && s.name === 'Восприятие' ? 'asked' : ''}" data-roll="${s.name}|к20 ${s.mod}"><i class="${s.prof}"></i><span>${s.name}</span><small>${s.ab}</small><b>${s.mod}</b>${ic('dice-faces-06', 14)}</button>`;
  const half = Math.ceil(skills.length / 2);
  const askBox = ask ? html`<section class="s-ask"><div class="s-ask-head">${ic('crown', 16)}<span><b>Мастер просит: Восприятие</b><small>Проверка Мудрости. Результат увидит только мастер.</small></span></div><button class="btn btn-primary btn-block" data-roll="Восприятие · для мастера|к20 + 1">${ic('dice-faces-06', 16)}Бросить: к20 + 1</button></section>` : '';
  const body = narrow ? html`<div class="s-group">${caps('Навыки')}<small>пассивное Восприятие ${v.vitals.passive.perception}</small></div><div class="s-col tight">${skills.map(row)}</div>`
    : html`<div class="s-group">${caps('Навыки')}<small>клик — бросок</small></div><div class="s-cols tight"><div class="s-col">${skills.slice(0, half).map(row)}</div><div class="s-col">${skills.slice(half).map(row)}</div></div>`;
  const saves = html`<div class="s-group">${caps('Спасброски')}<small>золотые — владеет</small></div><div class="s-saves">${v.abilities.map((a) => html`<button class="s-save ${a.saveProf ? 'prof' : ''}" data-roll="Спасбросок: ${a.name}|к20 ${a.save}" ${a.saveProf ? raw(`data-explain="save.${a.key}"`) : ''}><small>${a.short}</small>${a.save}</button>`)}</div>
    <div class="s-group">${caps('Пассивные')}<small>для скрытых проверок мастера</small></div><div class="s-passive">${[['Восприятие', v.vitals.passive.perception], ['Проницательность', v.vitals.passive.insight], ['Анализ', v.vitals.passive.investigation]].map(([k, n]) => html`<span><small>${k}</small><b>${n}</b></span>`)}</div>`;
  return html`${askBox}${body}${narrow ? '' : saves}`;
}

function bagTab(v) {
  const inv = v.inventory;
  // Доспех, щит и оружие можно надеть и снять (#203): от этого зависят КД и атаки на «Бое».
  const item = (it) => html`<div class="s-item"><span class="s-act-ic">${ic(rowIcon(it.icon), 18)}</span><span class="t"><b>${it.name}</b><small>${it.sub}</small></span>${it.tag ? html`<span class="h-mini-chip ${it.tag === 'Новое' ? 'accent' : 'gold'}">${it.tag}</span>` : ''}<small class="qty">×${it.qty}</small>
    ${v.live && it.wearable && it.id ? html`<button class="btn btn-ghost btn-sm" data-equip="${it.id}">${it.equipped ? 'Снять' : 'Надеть'}</button>` : ''}${v.live && it.id && !it.id.startsWith('legacy-') ? html`<button class="icon-btn icon-btn-sm" data-unpack="${it.id}" aria-label="Убрать один">${ic('minus-sign', 14)}</button>` : ''}</div>`;
  return html`<div class="s-bag-top"><span class="s-pill"><small>груз</small><b>${inv.load.now} / ${inv.load.max} фнт</b></span><span class="s-pill"><small>зм</small><b>${inv.coins.gp}</b></span><span class="s-pill"><small>см</small><b>${inv.coins.sp}</b></span><span class="s-pill"><small>мм</small><b>${inv.coins.cp}</b></span>${v.live ? html`<button class="btn btn-ghost btn-sm" data-coins>${ic('edit-02', 14)}Монеты</button>` : ''}<span class="spacer"></span><button class="btn btn-secondary btn-sm" data-add-item>${ic('plus-sign', 14)}Добавить</button></div>
    <div class="s-group">${caps('Надето и в руках')}<small>влияет на атаки и КД</small></div><div class="s-items on">${inv.equipped.length ? inv.equipped.map(item) : html`<p class="s-none">${/записано на листе/.test(v.explain?.ac || '') ? `Ничего не надето — КД ${v.vitals.ac.value} записан на листе вручную.` : 'Ничего не надето — КД без доспехов.'}</p>`}</div>
    <div class="s-group">${caps('В рюкзаке')}<small>${inv.pack.length} ${inv.pack.length === 1 ? 'предмет' : 'предметов'}</small></div><div class="s-items">${inv.pack.length ? inv.pack.map(item) : html`<p class="s-none">Рюкзак пуст.</p>`}</div>`;
}

const PERSON_HINT = { traits: 'Как герой держится с людьми — пара фраз', ideals: 'Во что верит и ради чего рискнёт', bonds: 'Кто или что ему дорого', flaws: 'Слабость, на которой мастер может сыграть', appearance: 'Каким его увидят за столом' };
function personTab(v) {
  const p = v.personality;
  if (v.status === 'unfinished') return html`<div class="s-empty">${ic('pencil-edit-02', 28)}<b>Черты характера не заполнены</b><p class="muted">Черты, идеалы, привязанности и слабости — мастер вплетёт их в сюжет.</p><a class="btn btn-primary" href="#/hero/new/look">${ic('arrow-right-02')}Заполнить</a></div>`;
  const field = (k, label) => html`<label class="s-field"><span>${label}</span><textarea rows="2" data-edit="${k}" placeholder="${PERSON_HINT[k]}">${p[k]}</textarea></label>`;
  const none = (t) => html`<p class="s-none">${t}</p>`;
  return html`<div class="s-cols"><div class="s-col">${field('traits', 'Черты характера')}${field('ideals', 'Идеалы')}${field('bonds', 'Привязанности')}${field('flaws', 'Слабости')}${field('appearance', 'Внешность')}</div>
    <div class="s-col"><div class="s-group">${caps('Союзники и организации')}</div>${p.allies.length ? p.allies.map((a) => html`<div class="s-note-card"><b>${a.name}</b><p>${a.text}</p></div>`) : none('Пока никого. Кого встретите в пути — впишите в заметки.')}
      <div class="s-group">${caps('Цели и задачи')}</div>${p.goals.length ? html`<ul class="s-goals">${p.goals.map((g) => html`<li>${check(false)}${g}</li>`)}</ul>` : none('Целей пока нет — мастер подскажет первую.')}
      <div class="s-group">${caps('Заметки')}<small>видите вы и мастер</small></div><label class="s-field"><textarea rows="5" data-edit="note-0" placeholder="Имена, долги, обещания — всё, что не хочется забыть к следующей игре">${p.notes[0] || ''}</textarea></label></div></div>`;
}

const tabBody = (v, tab, opts = {}) => ({ combat: combatTab, magic: magicTab, skills: skillsTab, bag: bagTab, person: personTab }[tab] || combatTab)(v, opts);

function tabsNav(v, tab, base, list = TABS) {
  const dots = v.missing?.tabs || [];
  return html`<nav class="s-tabs">${list.map((t) => html`<a href="${base}${t.id === 'combat' ? '' : `/${t.id}`}" aria-selected="${t.id === tab}">${ic(t.icon, 16)}${t.name}${dots.includes(t.id) ? html`<i class="s-dot"></i>` : ''}</a>`)}</nav>`;
}

// ——— 54–59 · Удобный лист ———
function sheetPage(v, tab, q) {
  const qs = [...q].join('&');
  const base = `#/hero/${v.id}`;
  const keep = (href) => (qs ? `${href}?${qs}` : href);
  return html`<main class="s-page">
    ${sheetHead(v, 'easy')}
    <div class="s-layout">
      <aside class="s-left">${hpCard(v)}${v.down ? deathPanel(v) : ''}${v.concCheck ? concPanel(v) : ''}${pills(v)}${concRow(v)}${statsGrid(v)}${resources(v)}${restBtns()}</aside>
      <section class="s-right">
        ${v.missing ? html`<div class="s-banner">${ic('alert-circle', 18)}<b>${v.missing.text}</b><span class="spacer"></span><button class="btn btn-ghost btn-sm" data-later>Позже</button><a class="btn btn-primary btn-sm" href="#/hero/new/spells">${ic('arrow-right-02', 14)}Доделать</a></div>` : ''}
        <div class="s-tabbar">${raw(String(tabsNav(v, tab, base)).replace(/href="([^"]+)"/g, (m, h) => `href="${keep(h)}"`))}<button class="icon-btn" data-search aria-label="Поиск">${ic('search-01')}</button></div>
        <div class="s-search hidden"><span class="input">${ic('search-01', 16)}<input data-search-input placeholder="Найти заклинание, навык, предмет…" value="${local.search}"></span></div>
        <div class="s-tab">${tabBody(v, tab)}</div>
      </section>
    </div>
    ${v.live ? '' : previewNote()}
  </main>`;
}

// ——— 60 · Классический лист ———
function classicPage(v, n) {
  const box = (title, body, cls = '') => html`<section class="c-box ${cls}"><h4>${title}</h4>${body}</section>`;
  const line = (val, label) => html`<div class="c-line"><span>${val}</span><small>${label}</small></div>`;
  const abil = (a) => {
    const skills = v.skills.filter((s) => s.ab === a.short);
    return box(a.name, html`<div class="c-ab"><span class="c-mod">${a.mod}<small>модификатор</small></span><span class="c-score">${a.score}<small>значение</small></span></div>
      <div class="c-row strong"><i class="${a.saveProf ? 'on' : ''}"></i><span>${a.save}</span><b>Спасбросок</b></div>${skills.map((s) => html`<div class="c-row"><i class="${s.prof !== 'none' ? 'on' : ''}"></i><span>${s.mod}</span>${s.name}</div>`)}`, 'c-abil');
  };
  const ab = Object.fromEntries(v.abilities.map((a) => [a.key, a]));
  const p = v.personality; const sc = v.spellcasting;
  // Всё ниже — из героя, без образцов (#203, ревью листа): оружие и боевые заговоры — строки боя с чипами.
  const d = v.vitals.deathSaves, pr = v.proficiencies;
  const dia = (on) => (on ? '◆' : '◇');
  const fight = [...v.actions.action, ...v.actions.bonus, ...v.actions.reaction].filter((a) => !a.empty && (a.hit || a.dc || a.dmg)).slice(0, 6);
  const cantrips = sc ? sc.spells.filter((s) => s.level === 0).map((s) => s.name) : [];
  const slotsLine = v.resources.filter((r) => r.kind === 'slot').map((r) => r.total).join(' · ');
  const gearNames = [...v.inventory.equipped, ...v.inventory.pack].map((it) => (it.qty > 1 ? `${it.name} ×${it.qty}` : it.name));
  const cards = sc ? sc.spells.filter((s) => (s.level === 0 || s.prepared) && (s.text || s.srdText?.length)).sort((a, b) => b.level - a.level).slice(0, 3) : [];
  const none = (t) => html`<p class="muted">${t}</p>`;
  const pages = {
    1: html`<div class="c-top">${box('', html`${line(v.name, 'Имя персонажа')}<div class="c-2">${line(v.background, 'Предыстория')}${line(v.classes[0].short || v.classes[0].name, 'Класс')}${line(v.race, 'Вид')}${line(v.classes[0].sub || '—', 'Подкласс')}</div>`, 'c-ident')}
        <div class="c-level"><b>${v.level}</b><small>уровень</small><span>${v.xp.now.toLocaleString('ru')}</span><small>опыт</small></div>
        <div class="c-shield"><small>Класс защиты</small><b>${v.vitals.ac.value}</b><small>щит</small><i></i></div>
        ${box('Хиты', html`<div class="c-hp"><span>${hpOf(v).now}<small>текущие</small></span><span>${v.vitals.hp.temp}<small>временные</small>${v.vitals.hp.max}<small>максимум</small></span></div>`, 'c-hpbox')}
        ${box('Кости хитов', html`<div class="c-hd">${v.vitals.hitDice.left} / ${v.vitals.hitDice.total}<small>текущие</small>${v.vitals.hitDice.die}<small>кость</small></div>`, 'c-small')}
        ${box('Спасброски от смерти', html`<small>успехи</small><div class="c-dia">${[0, 1, 2].map((i) => dia(i < d.ok)).join(' ')}</div><small>провалы</small><div class="c-dia">${[0, 1, 2].map((i) => dia(i < d.fail)).join(' ')}</div>`, 'c-small')}</div>
      <div class="c-title"><span></span><b>Распутье</b><span></span></div>
      <div class="c-grid">
        <div class="c-col">${box('Бонус владения', html`<div class="c-big">${v.vitals.prof}</div>`)}${abil(ab.str)}${abil(ab.dex)}${abil(ab.con)}${box('Истощение', html`<div class="c-squares">${'▣'.repeat(v.vitals.exhaustion)}${'▢'.repeat(Math.max(0, 6 - v.vitals.exhaustion))}</div>`)}${box('Героическое вдохновение', html`<div class="c-squares">${v.vitals.inspiration ? '▣' : '▢'}</div>`)}</div>
        <div class="c-col">${abil(ab.int)}${abil(ab.wis)}${abil(ab.cha)}</div>
        <div class="c-col wide"><div class="c-4">${box('Инициатива', html`<div class="c-big">${v.vitals.init}</div>`)}${box('Скорость', html`<div class="c-big">${parseInt(v.vitals.speed, 10)}</div>`)}${box('П. внимательность', html`<div class="c-big">${v.vitals.passive.perception}</div>`)}${box('Состояния', html`<p>${[...(v.conditions || []).map((c) => c.name), v.concentration ? 'Концентрация' : ''].filter(Boolean).join(', ') || '—'}</p>`)}</div>
          ${box('Оружие и боевые заговоры', html`<table class="c-table"><tr><th>Название</th><th>Бонус / Сложность</th><th>Урон / Вид</th><th>Заметки</th></tr>${fight.map((a) => html`<tr><td>${a.name}</td><td>${a.hit || a.dc || ''}</td><td>${a.dmg || ''}</td><td>${a.sub}</td></tr>`)}${fight.length ? '' : html`<tr><td colspan="4" class="muted">Оружия и боевых заговоров пока нет</td></tr>`}</table>`)}
          ${box('Умения и способности', html`${v.features.length ? v.features.map((f) => html`<p><b>${f.name}.</b><br>${f.text}</p>`) : none('Умений пока нет')}`, 'c-paper tall')}</div>
      </div>
      <div class="c-grid3">${box('Владение снаряжением и умения', html`<div class="c-prof"><small>доспехи</small>${dia(pr.armor.light)} Лёгкие ${dia(pr.armor.medium)} Средние ${dia(pr.armor.heavy)} Тяжёлые ${dia(pr.armor.shield)} Щит</div><div class="c-prof"><small>оружие</small>${dia(pr.weapons.simple)} Простое ${dia(pr.weapons.martial)} Воинское ${dia(pr.weapons.other)} Другое</div><p><b>Языки:</b> ${v.proficiencies.languages}</p><p><b>Инструменты:</b> ${v.proficiencies.tools}</p>${pr.weaponsText ? html`<p><b>Оружие:</b> ${pr.weaponsText}</p>` : ''}`, 'c-paper')}
        ${box('Атаки и заклинания', sc ? html`${cantrips.length ? html`<p>Заговоры: ${cantrips.join(', ')}</p>` : ''}<p>Заклинаний: ${sc.book.now}, подготовлено ${sc.prepared.now} — стр. 3</p>${slotsLine ? html`<p>Ячейки: ${slotsLine}</p>` : ''}${v.concentration ? html`<p>Концентрация сейчас: ${v.concentration.spell}</p>` : ''}` : none('Заклинаний нет'), 'c-paper')}
        ${box('Черты', html`${v.traits.length ? v.traits.map((t) => html`<p>${t}</p>`) : none('—')}`, 'c-paper')}</div>`,
    2: html`<div class="c-grid2"><div class="c-col">${box('Портрет', html`<img class="c-portrait" src="${v.art}" alt="">`)}${box('Цели и задачи', html`${p.goals.map((g) => html`<p>${g}</p>`)}`, 'c-paper tall')}</div>
        <div class="c-col">${box('Союзники и организации', html`${p.allies.map((a) => html`<p><b>${a.name}</b><br>${a.text}</p>`)}`, 'c-paper')}${box('Дополнительные способности и умения', html`${p.extra.map((a) => html`<p><b>${a.name}</b><br>${a.text}</p>`)}`, 'c-paper')}${box('Сокровища', html`${p.treasures.map((t) => html`<p>${t}</p>`)}`, 'c-paper')}</div></div>
      <div class="c-notes">${[0, 1, 2, 3, 4, 5].map((i) => box('Заметки', html`<textarea data-edit="classic-note-${i}" rows="6">${i % 2 === 0 ? p.notes[i / 2] || '' : ''}</textarea>`, `c-paper ${i % 2 === 0 ? 'wide' : ''}`))}</div>`,
    3: !sc ? html`<div class="s-empty">${ic('sparkles', 28)}<b>Заклинаний нет</b><p class="muted">У ${v.name} нет заклинательной характеристики — третья страница пустая.</p></div>` : html`<div class="c-grid2 s3"><div class="c-col"><div class="c-4 sp">${box('', html`${line(sc?.ability || '—', 'Характеристика')}<div class="c-kv"><b>${sc.mod}</b><small>заклинательный модификатор</small></div><div class="c-kv"><b>${sc.dc}</b><small>сложность спасброска</small></div><div class="c-kv"><b>${sc.attack}</b><small>бонус атаки заклинанием</small></div>`, 'c-spellab')}
          <div class="c-col">${box('', html`<div class="c-4">${[['Размер', v.vitals.size], ['Грузоподъёмность', v.vitals.carry], ['Прыжок в.', v.vitals.jump.high], ['Прыжок д.', v.vitals.jump.long]].map(([k, val]) => html`<div class="c-mini"><small>${k}</small><b>${val}</b></div>`)}</div>`, 'c-bare')}
            ${box('Ячейки заклинаний', html`<div class="c-slots">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((lv) => { const r = slotOf(v, lv); return html`<span>${lv}-й ${r ? html`${'◆'.repeat(r.left)}${'◇'.repeat(r.total - r.left)}` : ''}</span>`; })}</div>`)}</div></div>
        ${box('Заговоры и подготовленные заклинания', html`<table class="c-table spells"><tr><th>Ур.</th><th>Название</th><th>Время сотворения</th><th>Дистанция</th><th>Концентрация, ритуал, материал</th><th>Заметки</th></tr>${sc.spells.filter((s) => s.level === 0 || s.prepared).map((s) => html`<tr><td>${s.level}</td><td class="link">${s.name}</td><td>${s.time.replace('1 ', '').replace('действие', 'Действие')}</td><td>${s.range}</td><td>${s.conc ? '◆' : '◇'} К ${s.ritual ? '◆' : '◇'} Р ${s.comp.includes('М') ? '◆' : '◇'} М</td><td>${s.comp}</td></tr>`)}${Array.from({ length: 8 }, () => html`<tr><td></td><td></td><td></td><td></td><td>◇ К ◇ Р ◇ М</td><td></td></tr>`)}</table>`, 'c-spells')}</div>
      <div class="c-col">${box('Внешность', html`<p>${p.appearance}</p>`, 'c-paper')}${box('Предыстория и личные качества', html`<p><b>${p.backstoryTitle}</b><br>${p.backstory}</p><p><b>Черты:</b><br>${p.traits}</p><p><b>Слабость:</b><br>${p.flaws}</p>${line(v.alignment, 'Мировоззрение')}`, 'c-paper')}
        ${box('Снаряжение', html`${gearNames.length ? html`<p>${gearNames.join(', ')}</p>` : none('Сумка пуста')}<div class="c-sub">Настройка на магические предметы</div>${[0, 1, 2].map((i) => html`<p>${v.inventory.attunement[i] ? `◆ ${v.inventory.attunement[i].name}` : '◇'}</p>`)}`, 'c-paper')}
        ${box('Монеты', html`<div class="c-coins">${[['мм', v.inventory.coins.cp], ['см', v.inventory.coins.sp], ['зм', v.inventory.coins.gp], ['эм', v.inventory.coins.ep], ['пм', v.inventory.coins.pp]].map(([k, val]) => html`<span><small>${k}</small><b>${val}</b></span>`)}</div><button class="c-manage" data-coins>Управлять</button>`)}</div></div>
      <div class="c-cards">${cards.map((s) => html`<article class="c-card"><h3><span>${s.level}</span>${s.name}</h3><div class="c-card-tags"><span>${s.time.replace('1 ', '').replace('действие', 'Действие')}</span><span>${s.range}</span><span>${s.duration}</span></div>${s.text ? html`<p>${s.text}</p>` : html`<p lang="en">${s.srdText[0]}</p>`}<small>${s.comp}</small><footer>${s.school}<span>SRD</span></footer></article>`)}</div>`,
  };
  return html`<main class="s-page classic">${sheetHead(v, 'classic')}
    <nav class="c-pages">${[[1, 'Основное'], [2, 'Личность и заметки'], [3, 'Заклинания']].map(([k, t]) => html`<a href="#/hero/${v.id}/classic/${k}" aria-selected="${k === n}">${k} · ${t}</a>`)}</nav>
    <article class="c-sheet p${n}">${pages[n]}</article>${v.live ? '' : previewNote()}</main>`;
}

// ——— 61–66 · Лист на карте ———
function tablePage(v, tab, q) {
  const qs = [...q].join('&');
  const keep = (href) => (qs ? `${href}?${qs}` : href);
  const party = ['garr', 'mira', 'elian', 'torin'];
  const stub = q.has('stub');
  const other = v.isMine === false;
  const lira = heroView('lira', q.has('down') ? 'down' : q.has('concentration') ? 'concentration' : '');
  const h = hpOf(lira);
  const drawer = other ? otherDrawer(v) : html`<aside class="s-drawer">${sheetHead(v, 'table')}${hpCard(v)}${v.down ? deathPanel(v) : ''}${v.concCheck ? concPanel(v) : ''}${pills(v)}${concRow(v)}${statsGrid(v, 'row6')}
    <nav class="s-tabs small">${TABS.slice(0, 4).map((t) => html`<a href="${keep(`#/hero/${v.id}/table/${t.id}`)}" aria-selected="${t.id === tab}">${ic(t.icon, 16)}${t.name}</a>`)}</nav>
    <div class="s-tab">${tabBody(v, tab, { narrow: true, ask: q.has('ask') })}</div></aside>`;
  const stubRail = () => html`<aside class="s-stub"><a class="icon-btn icon-btn-sm" href="${keep(`#/hero/${v.id}/table`).replace(/[?&]stub/, '')}" aria-label="Развернуть">${ic('layers-01', 18)}</a><span class="s-portrait"><img src="${v.portrait}" alt=""></span>
    <small>хп</small><b>${hpOf(v).now}</b><small>из ${v.vitals.hp.max}</small><span class="s-vbar"><i style="height:${Math.round((hpOf(v).now / v.vitals.hp.max) * 100)}%"></i></span>
    <small>КД</small><b class="sm">${v.vitals.ac.value}</b><small>Ячейки</small>${(v.resources || []).filter((r) => r.kind === 'slot').map((r) => html`<span class="s-stub-slot"><small>${r.circle || r.id.slice(-1)}</small>${pips(1, 1)}${r.left}</span>`)}
    ${v.concentration ? html`<span class="s-stub-conc">${ic('sparkles', 16)}</span><small class="magic">${v.concentration.spell}</small>` : ''}</aside>`;
  const toasts = q.has('roll') ? html`<div class="t-toasts"><div class="t-toast"><img src="${v.portrait}" alt=""><span><b>Лира · Огненный снаряд по Культисту 1: 21</b><small>1к20 (14) + 7 · попадание решает мастер</small></span></div><div class="t-toast"><img src="${v.portrait}" alt=""><span><b>Лира · урон: 13 огнём</b><small>2к10 (6 + 7)</small></span></div></div>`
    : v.log ? html`<div class="t-toasts"><div class="t-toast"><img src="${v.log.portrait}" alt=""><span><b>${v.log.title}</b><small>${v.log.sub}</small></span></div></div>`
      : q.has('levelup') ? html`<div class="t-toasts"><div class="t-toast"><span class="t-round">${ic('arrow-up-01', 16)}</span><span><b>Поднимите уровень</b><small>Мастер поднял партию до 6</small></span><a class="btn btn-secondary btn-sm" href="#/hero/lira/levelup/hp">Поднять</a></div></div>` : '';
  const noSlotPop = v.noSlot ? html`<div class="t-pop"><b>${v.noSlot.title}</b><div class="t-pop-row">3 уровень ${pips(0, 2)} 0/2</div><p>${v.noSlot.text}</p><p class="t-pop-can">${v.noSlot.can}</p><button class="btn btn-secondary btn-block btn-sm" data-rest="short">Открыть отдых</button></div>` : '';
  return html`<main class="t-preview">
    <div class="t-map"><img src="assets/maps/crypt.webp" alt=""></div>
    <div class="t-chrome tl"><span class="t-logo"><img src="assets/logo.webp" alt=""></span><span class="t-group">${ic('view', 20)}${ic('user-group', 20)}${ic('sword-03', 20)}</span><span class="t-group one">${ic('dice-faces-06', 20)}</span></div>
    <div class="t-chrome tr">${q.has('levelup') ? html`<span class="t-me up"><img src="${v.portrait}" alt=""><i>${ic('arrow-up-01', 12)}</i></span>` : html`<span class="t-me"><img src="${lira.portrait}" alt=""></span>`}<span class="t-party">${party.map((p) => html`<img src="assets/portraits/${p}.webp" alt="">`)}</span></div>
    ${toasts}${q.has('levelup') ? '' : stub ? stubRail() : drawer}${noSlotPop}
    <div class="t-bottom"><img src="${lira.portrait}" alt=""><span class="t-who"><b>Лира</b><small>Волшебница 5 · ваш герой</small></span><button class="icon-btn icon-btn-sm" data-hp="-1">${ic('minus-sign', 16)}</button><span class="t-hp"><small>хп</small><b>${h.now}/${h.max}</b><i><em style="width:${Math.round((h.now / h.max) * 100)}%"></em></i></span><button class="icon-btn icon-btn-sm" data-hp="1">${ic('plus-sign', 16)}</button><span class="s-pill"><small>кд</small><b>13</b></span><span class="s-pill"><b>30 фт</b></span><span class="t-sep"></span>${ic('sparkles', 20)}<a class="t-book ${stub || q.has('levelup') ? '' : 'on'}" href="${keep(`#/hero/lira/table`).replace(/[?&]stub/, '')}">${ic('book-open-01', 20)}</a>${ic('dice-faces-06', 20)}<span class="t-sep"></span>${ic('cancel-01', 20)}</div>
    <div class="t-chrome br"><span>${ic('minus-sign', 18)}100%${ic('plus-sign', 18)}</span><b>клетка 5 фт</b></div>
    <nav class="t-variants">${[['Свой', `#/hero/lira/table`], ['Бросок', `#/hero/lira/table?roll`], ['Магия', `#/hero/lira/table/magic`], ['Чужой', `#/hero/torin/table`], ['Корешок', `#/hero/lira/table?stub`], ['Мастер просит', `#/hero/lira/table/skills?ask`], ['0 хитов', `#/hero/lira/table?down`], ['Концентрация', `#/hero/lira/table?concentration`], ['Нет ячеек', `#/hero/lira/table?noSlots`], ['Новый уровень', `#/hero/lira/table?levelup`]].map(([t, href]) => html`<a href="${href}" aria-current="${location.hash === href}">${t}</a>`)}</nav>
  </main>`;
}

function otherDrawer(v) {
  const s = v.shared;
  return html`<aside class="s-drawer">${sheetHead(v, 'table')}${hpCard(v, { readonly: true })}${pills(v)}
    <p class="s-info">${ic('eye', 16)}${s.note}</p>
    <div class="s-group">${caps('Чем прикрывает отряд')}<small>реакции и ауры</small></div>${s.covers.map((a) => actionRow(v, a))}
    <div class="s-group">${caps('Скрыто')}<small>видят Яра и мастер</small></div>${s.hidden.map((t) => html`<div class="s-hidden">${ic('square-lock-02', 14)}${t}</div>`)}</aside>`;
}

// «…» листа: другие виды, повышение, кампания; на столе — ещё «Все поля» (подробный редактор Яры) и «Открыть полностью».
function sheetMenu(v, anchor, opts) {
  const [cid] = String(v.id).split('~');
  const a = (href, icon, label) => html`<a class="menu-item" href="${href}">${ic(icon, 16)}${label}</a>`;
  const pop = popover(html`<div class="menu">${opts.edit ? html`<button class="menu-item" data-menu-edit>${ic('pencil-edit-02', 16)}Все поля листа</button>${a(`#/hero/${v.id}`, 'maximize-01', 'Открыть полностью')}` : ''}
    ${a(`#/hero/${v.id}/classic/1`, 'pen-tool-01', 'Классический лист')}${v.canLevelUp ? a(`#/hero/${v.id}/levelup/hp`, 'arrow-up-01', 'Новый уровень') : ''}${cid && v.live ? a(`#/camp/${cid}`, 'home-01', `Кампания «${v.campaign?.name || ''}»`) : ''}
    ${v.live && v.canEdit ? html`<span class="menu-sep"></span><button class="menu-item" data-menu-portrait>${ic('image-add-01', 16)}Сменить портрет</button><button class="menu-item danger" data-menu-delete>${ic('delete-02', 16)}Удалить героя</button>` : ''}</div>`, anchor, { placement: 'auto' });
  pop.node.addEventListener('click', (e) => {
    if (e.target.closest('[data-menu-edit]')) { closePopover(); opts.edit?.(); }
    if (e.target.closest('[data-menu-portrait]')) { closePopover(); portraitModal(v); }
    if (e.target.closest('[data-menu-delete]')) { closePopover(); deleteHero(v); }
  });
}

/**
 * Лист героя в выезжающей панели стола (61–63): тот же лист в узком виде — хиты, характеристики, бой, магия, навыки,
 * сумка. Вкладки переключаются кнопками (адрес стола не меняется).
 */
export function drawerHTML(v, tab = 'combat') {
  const t = TABS.slice(0, 4).some((x) => x.id === tab) ? tab : 'combat';
  return html`${sheetHead(v, 'drawer')}${hpCard(v)}${v.down ? deathPanel(v) : ''}${pills(v)}${concRow(v)}${statsGrid(v, 'row6')}
    <nav class="s-tabs small">${TABS.slice(0, 4).map((x) => html`<button data-dtab="${x.id}" aria-selected="${x.id === t}">${ic(x.icon, 16)}${x.name}</button>`)}</nav>
    <div class="s-tab">${tabBody(v, t, { narrow: true })}</div>${t === 'combat' ? html`<div class="s-res-mini">${resources(v)}${restBtns()}</div>` : ''}`;
}
export { shortRest };

// ——— обработчики ———
/**
 * Обработчики листа. src — герой или функция, отдающая свежего героя (лист на столе перерисовывается по данным).
 * opts.roll(what, formula) — бросок столом (кубы и журнал кампании) вместо подсказки страницы листа.
 */
export function bindSheet(root, L0, src, redraw, opts = {}) {
  const V = () => (typeof src === 'function' ? src() : src);
  const L = (type, sel, fn) => L0(type, sel, (e, b) => { const v = V(); if (v) fn(e, b, v); });
  L('click', '[data-hp]', (e, b, v) => { local.hpDelta[v.id] = (local.hpDelta[v.id] || 0) + +b.dataset.hp; heroActions.setHp({ heroId: v.id, delta: +b.dataset.hp }); refreshHp(root, v); });
  L('click', '[data-roll]', (e, b, v) => {
    if (b.hasAttribute('data-blocked')) return;
    const [what, formula] = b.dataset.roll.split('|');
    if (opts.roll) opts.roll(what, formula, v); else heroActions.roll({ heroId: v.id, what, formula });
  });
  L('click', '[data-explain]', (e, b, v) => { e.stopPropagation(); const t = v.explain?.[b.dataset.explain]; if (t) popover(html`<div class="s-explain">${t}</div>`, b, { placement: 'top', className: 'explain-pop' }); });
  L('click', '[data-res]', (e, b, v) => { const r = v.resources.find((x) => x.id === b.dataset.res); heroActions.useResource({ heroId: v.id, id: b.dataset.res, name: r?.name, total: r?.total, recovery: r?.recovery }); });
  L('click', '[data-drop-conc]', (e, b, v) => heroActions.dropConcentration({ heroId: v.id }));
  // Состояние: список PHB поповером — отмеченные снимаются повторным нажатием.
  L('click', '[data-add-cond]', (e, b, v) => {
    const on = new Set((v.conditions || []).map((c) => c.id));
    const pop = popover(html`<div class="menu s-cond-menu">${CONDITIONS.filter((c) => c.id !== 'concentration').map((c) => html`<button class="menu-item ${on.has(c.id) ? 'on' : ''}" data-cond="${c.id}">${on.has(c.id) ? ic('tick-02', 14) : ic('plus-sign', 14)}${c.name}</button>`)}</div>`, b, { placement: 'auto' });
    pop.node.addEventListener('click', (ev) => { const x = ev.target.closest('[data-cond]'); if (x) { heroActions.toggleCondition({ heroId: v.id, id: x.dataset.cond }); closePopover(); } });
  });
  L('click', '[data-cond-chip]', (e, b, v) => heroActions.toggleCondition({ heroId: v.id, id: b.dataset.condChip }));
  L('click', '[data-death]', (e, b, v) => heroActions.deathSave({ heroId: v.id }));
  L('click', '[data-rest]', (e, b, v) => (b.dataset.rest === 'short' ? shortRest(v) : heroActions.rest({ heroId: v.id, kind: 'long' })));
  L('click', '[data-mview]', (e, b, v) => { local.magicView = b.dataset.mview; redraw(); });
  L('click', '[data-spell-open]', (e, b, v) => {
    if (e.target.closest('[data-prep]')) { const id = e.target.closest('[data-prep]').dataset.prep; const s = v.spellcasting.spells.find((x) => x.id === id); if (s.level) { local.prepared[id] = !(local.prepared[id] ?? s.prepared); heroActions.prepare({ heroId: v.id, spellId: id, prepared: local.prepared[id] }); } redraw(); return; }
    local.spellFocus = local.spellFocus === b.dataset.spellOpen ? '' : b.dataset.spellOpen; redraw();
  });
  L('click', '[data-cast]', (e, b, v) => heroActions.cast({ heroId: v.id, spellId: b.dataset.cast }));
  L('click', '[data-slot-pick]', (e, b, v) => heroActions.cast({ heroId: v.id, spellId: b.dataset.slotPick, pickSlot: true }));
  L('click', '[data-add-item]', (e, b, v) => addItemModal(v));
  L('click', '[data-coins]', (e, b, v) => coinsModal(v));
  L('click', '[data-equip]', (e, b, v) => { const all = [...v.inventory.equipped, ...v.inventory.pack]; const it = all.find((x) => x.id === b.dataset.equip); heroActions.equip({ heroId: v.id, itemId: b.dataset.equip, name: it?.name, auto: v.inventory.equipped.filter((x) => x.auto).map((x) => x.id) }); });
  L('click', '[data-unpack]', (e, b, v) => heroActions.removeItem({ heroId: v.id, itemId: b.dataset.unpack }));
  L('click', '[data-later]', (e, b) => b.closest('.s-banner')?.remove());
  L('click', '[data-more]', (e, b, v) => sheetMenu(v, b, opts));
  L('click', '[data-portrait]', (e, b, v) => portraitModal(v));
  L('click', '[data-hp-pad]', (e, b, v) => hpPad(v));
  L('click', '[data-add-spell]', (e, b, v) => spellPicker(v));
  L('click', '[data-drop-spell]', (e, b, v) => heroActions.removeSpell({ heroId: v.id, spellId: b.dataset.dropSpell, name: b.dataset.name }));
  L('click', '[data-spell-ab]', (e, b, v) => heroActions.spellAbility({ heroId: v.id, ability: b.dataset.spellAb }));
  L('change', '[data-edit]', (e, t, v) => heroActions.editField({ heroId: v.id, field: t.dataset.edit, value: t.value }));
  L('click', '[data-search]', (e, b, v) => { const s = root.querySelector('.s-search'); s?.classList.toggle('hidden'); s?.querySelector('input')?.focus(); });
  L('input', '[data-search-input]', (e, t, v) => { local.search = t.value.trim().toLowerCase(); clearTimeout(bindSheet.t); bindSheet.t = setTimeout(() => { redraw(); const s = root.querySelector('.s-search'); s?.classList.remove('hidden'); const i = s?.querySelector('input'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); });
}

function refreshHp(root, v) {
  const h = hpOf(v);
  root.querySelectorAll('.s-hp [data-hp-now]').forEach((b) => { b.textContent = h.now; });
  root.querySelectorAll('.s-hp-bar i').forEach((i) => { i.style.width = `${Math.round((h.now / h.max) * 100)}%`; });
  root.querySelectorAll('.t-hp b').forEach((b) => { b.textContent = `${h.now}/${h.max}`; });
  root.querySelectorAll('.t-hp em').forEach((i) => { i.style.width = `${Math.round((h.now / h.max) * 100)}%`; });
}

// ——— 59 · Короткий отдых ———
function shortRest(v) {
  closePopover();
  const hd = v.vitals.hitDice;
  // «Магическое восстановление» — только у того, у кого оно есть (волшебник); остальным — кости хитов.
  const arcane = v.resources.find((r) => /восстановлен/i.test(r.name) && r.left > 0);
  let dice = Math.min(1, hd.left); const pick = new Set(arcane ? [1] : []);
  const body = () => html`<div class="s-rest-modal"><div class="s-rest-head">${ic('hourglass', 18)}<b>Короткий отдых · 1 час</b><span class="spacer"></span><button class="icon-btn icon-btn-sm" data-close aria-label="Закрыть">${ic('cancel-01', 18)}</button></div>
    <div class="s-rest-row"><span class="h-stepper sm"><button data-hd="-1">${ic('minus-sign', 16)}</button><b>${dice}</b><button data-hd="1">${ic('plus-sign', 16)}</button></span><span><b>Кости хитов: ${dice}${hd.die}</b><small>осталось ${hd.left} из ${hd.total}</small></span></div>
    ${arcane ? html`<div class="s-rest-row"><span><b>${arcane.name}</b><small>до ${Math.ceil(v.level / 2)} уровней ячеек</small></span><span class="spacer"></span>${v.resources.filter((r) => r.kind === 'slot' && r.circle && r.circle <= 5).map((r) => html`<button class="s-lvl ${pick.has(r.circle) ? 'on' : ''}" data-lv="${r.circle}">${pick.has(r.circle) ? ic('tick-02', 12) : ''}${r.circle} ур.</button>`)}</div>` : ''}
    <div class="s-rest-foot"><button class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary" data-ok>${ic('dice-faces-06', 16)}Отдохнуть</button></div></div>`;
  const m = modal(body(), { className: 'rest' });
  m.box.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.hd) { dice = Math.max(0, Math.min(hd.left, dice + +b.dataset.hd)); m.set(body()); }
    if (b.dataset.lv) { const lv = +b.dataset.lv; if (pick.has(lv)) pick.delete(lv); else if ([...pick].reduce((a, x) => a + x, 0) + lv <= Math.ceil(v.level / 2)) pick.add(lv); else toast({ title: `Не больше ${Math.ceil(v.level / 2)} уровней ячеек`, icon: 'information-circle', timeout: 1800 }); m.set(body()); }
    if (b.hasAttribute('data-ok')) { heroActions.rest({ heroId: v.id, kind: 'short', hitDice: dice, recover: [...pick] }); m.close(); }
  });
}

// ——— Хиты: урон, лечение, временные — числом, а не по одному (#203) ———
function hpPad(v) {
  const h = hpOf(v);
  let val = '';
  const body = () => html`<div class="s-rest-modal s-hp-pad"><div class="s-rest-head">${ic('heart-check', 18)}<b>Хиты · ${h.now} из ${h.max}${h.temp ? ` · +${h.temp} врем.` : ''}</b><span class="spacer"></span><button class="icon-btn icon-btn-sm" data-close aria-label="Закрыть">${ic('cancel-01', 18)}</button></div>
    <label class="s-hp-input"><input type="number" inputmode="numeric" min="0" max="999" data-hpv placeholder="0" value="${val}" aria-label="Сколько"></label>
    <div class="s-hp-quick">${[1, 2, 5, 10].map((n) => html`<button data-plus="${n}">+${n}</button>`)}<button data-clear>${ic('cancel-01', 14)}</button></div>
    <div class="s-hp-acts"><button class="btn btn-danger" data-apply="dmg">${ic('sword-01', 16)}Урон</button><button class="btn btn-primary" data-apply="heal">${ic('heart-check', 16)}Лечение</button><button class="btn btn-secondary" data-apply="temp">${ic('shield-user', 16)}Временные</button></div>
    <p class="s-hp-note">Урон сначала снимает временные хиты. Временные не складываются — остаётся большее.${v.explain?.hp ? ` ${v.explain.hp}.` : ''}</p></div>`;
  const m = modal(body(), { className: 'rest' });
  const input = () => m.box.querySelector('[data-hpv]');
  setTimeout(() => input()?.focus(), 50);
  const apply = (kind) => {
    const n = Math.max(0, Math.round(Number(input()?.value || val) || 0));
    if (!n) { input()?.focus(); return; }
    if (kind === 'temp') heroActions.setHp({ heroId: v.id, temp: Math.max(n, h.temp || 0) });
    else heroActions.setHp({ heroId: v.id, delta: kind === 'dmg' ? -n : n });
    m.close();
  };
  m.box.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.plus) { val = String((Number(input()?.value) || 0) + +b.dataset.plus); input().value = val; }
    if (b.hasAttribute('data-clear')) { val = ''; input().value = ''; input().focus(); }
    if (b.dataset.apply) apply(b.dataset.apply);
  });
  m.box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(e.shiftKey ? 'heal' : 'dmg'); } });
}

// ——— Портрет: набор артов или свой файл с кадрированием в круг; токены героя меняются вместе с ним ———
function portraitModal(v) {
  const [cid] = String(v.id).split('~');
  const m = modal(html`<div class="s-rest-modal s-portrait-modal"><div class="s-rest-head">${ic('image-add-01', 18)}<b>Портрет ${v.name}</b><span class="spacer"></span><button class="icon-btn icon-btn-sm" data-close aria-label="Закрыть">${ic('cancel-01', 18)}</button></div>
    <p class="s-hp-note">Портрет — это и токен на карте: поменяется на всех сценах кампании.</p>
    <button class="s-upload" data-own-pic>${ic('upload-01', 20)}<span><b>Загрузить свой</b><small>PNG, JPEG или WebP до 5 МБ · кадр выберете сами</small></span></button>
    <div class="s-pic-grid">${PORTRAITS.map((p) => html`<button class="s-pic ${p === v.portrait ? 'on' : ''}" data-pic="${p}" aria-pressed="${p === v.portrait}"><img src="${p}" alt="" loading="lazy">${p === v.portrait ? html`<span class="h-tick">${ic('tick-02', 12)}</span>` : ''}</button>`)}</div></div>`, { className: 'rest pick' });
  m.box.addEventListener('click', async (e) => {
    const pic = e.target.closest('[data-pic]');
    if (pic) { heroActions.setPortrait({ heroId: v.id, ref: pic.dataset.pic }); m.close(); return; }
    if (e.target.closest('[data-own-pic]')) {
      m.close();
      const { tokenImageEditor } = await import('../table/token-image.js');
      tokenImageEditor({ title: `Портрет ${v.name}`, ref: v.portrait, defaultRef: '', toast, store: async (file) => { const ref = await uploadPortrait(file, cid); if (!ref) throw new Error('Портрет не загрузился'); return ref; }, done: (ref) => heroActions.setPortrait({ heroId: v.id, ref }) });
    }
  });
}

// ——— Удалить героя: в архив кампании, с возвратом ———
async function deleteHero(v) {
  const ok = await confirmDialog({ title: `Удалить ${v.name}?`, body: `Лист уйдёт в архив кампании «${v.campaign?.name || ''}»: токены снимутся со всех сцен, из боя — тоже. Вернуть героя можно со страницы «Герои».`, ok: 'Удалить', danger: true });
  if (ok) heroActions.deleteHero({ heroId: v.id });
}
export { portraitModal, deleteHero as confirmDeleteHero };

// ——— Любое заклинание любому герою (#203): справочник с поиском и фильтрами или своё ———
function spellPicker(v) {
  const all = spellCatalog();
  const have = new Set((v.spellcasting?.spells || []).map((s) => s.name.toLowerCase()));
  const st = { q: '', level: 'all', cls: '', own: false, name: '', circle: 0, text: '' };
  const LV = [['all', 'Все'], ['0', 'Заговоры'], ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [String(n), `${n}`])];
  const list = () => {
    const q = st.q.trim().toLowerCase();
    // Сначала названия, которые начинаются с запроса, потом — где он внутри.
    const rank = (s) => (!q ? 0 : s.name.toLowerCase().startsWith(q) || s.en.toLowerCase().startsWith(q) ? 0 : 1);
    return all.filter((s) => (st.level === 'all' || s.level === +st.level) && (!st.cls || s.classes.includes(st.cls)) && (!q || s.name.toLowerCase().includes(q) || s.en.toLowerCase().includes(q))).sort((a, b) => rank(a) - rank(b)).slice(0, 80);
  };
  const row = (s) => { const on = have.has(s.name.toLowerCase()); return html`<button class="s-add-row spell ${on ? 'on' : ''}" data-pick-spell="${s.ref}" ${on ? raw('disabled') : ''}><b>${s.name}${s.conc ? html`<span class="h-kr k">К</span>` : ''}${s.ritual ? html`<span class="h-kr">Р</span>` : ''}</b><small>${s.level ? `${s.level} ур.` : 'заговор'}${s.school ? ` · ${s.school}` : ''}${s.time ? ` · ${s.time}` : ''}${s.classes.length ? ` · ${s.classes.join(', ')}` : ''}</small>${on ? ic('tick-02', 16) : ic('plus-sign', 16)}</button>`; };
  const body = () => html`<div class="s-rest-modal s-add-modal s-spell-pick"><div class="s-rest-head">${ic('sparkles', 18)}<b>Добавить заклинание</b><span class="spacer"></span><button class="icon-btn icon-btn-sm" data-close aria-label="Закрыть">${ic('cancel-01', 18)}</button></div>
    <p class="s-hp-note">Любое — от класса, артефакта или дара мастера. Ограничений по классу нет.</p>
    ${st.own ? html`<div class="s-own-spell"><label class="s-field"><span>Название</span><span class="input"><input data-own-name value="${st.name}" placeholder="Например, «Шёпот маски»" maxlength="60"></span></label>
        <div class="s-field"><span>Уровень</span><span class="s-lv-pick">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => html`<button data-own-lv="${n}" aria-pressed="${st.circle === n}">${n ? n : 'Заговор'}</button>`)}</span></div>
        <label class="s-field"><span>Что делает</span><textarea rows="4" data-own-text placeholder="Время, дистанция, эффект — как записано у мастера">${st.text}</textarea></label>
        <div class="s-rest-foot"><button class="btn btn-ghost" data-own-back>${ic('arrow-left-02', 16)}К справочнику</button><button class="btn btn-primary" data-own-save>${ic('plus-sign', 16)}Добавить</button></div></div>`
    : html`<span class="input">${ic('search-01', 16)}<input data-sq placeholder="Огненный шар, Щит, Fireball…" value="${st.q}"></span>
      <div class="s-lv-pick">${LV.map(([k, t]) => html`<button data-lv="${k}" aria-pressed="${st.level === k}">${t}</button>`)}</div>
      <label class="s-cls-pick">${caps('Класс')}<select class="input" data-cls><option value="">Любой — без ограничений</option>${SPELL_CLASSES.map((c) => html`<option value="${c}" ${st.cls === c ? raw('selected') : ''}>${c}</option>`)}</select></label>
      <div class="s-add-list">${list().map(row)}${list().length ? '' : html`<p class="s-none">Ничего не нашлось.</p>`}</div>
      <button class="s-add-row own" data-own-open><b>Своё заклинание</b><small>хоумбрю, предмет, умение мастера — название, уровень, текст</small>${ic('pencil-edit-02', 16)}</button>`}</div>`;
  const m = modal(body(), { className: 'rest pick' });
  const redraw = (focus) => { m.set(body()); const i = m.box.querySelector(focus); if (i) { i.focus(); if (i.setSelectionRange && typeof i.value === 'string') i.setSelectionRange(i.value.length, i.value.length); } };
  setTimeout(() => m.box.querySelector('[data-sq]')?.focus(), 50);
  m.box.addEventListener('input', (e) => {
    if (e.target.matches('[data-sq]')) { st.q = e.target.value; redraw('[data-sq]'); }
    if (e.target.matches('[data-own-name]')) st.name = e.target.value;
    if (e.target.matches('[data-own-text]')) st.text = e.target.value;
  });
  m.box.addEventListener('change', (e) => { if (e.target.matches('[data-cls]')) { st.cls = e.target.value; redraw('[data-sq]'); } });
  m.box.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.lv) { st.level = b.dataset.lv; redraw('[data-sq]'); }
    if (b.hasAttribute('data-own-open')) { st.own = true; st.name = st.q; redraw('[data-own-name]'); }
    if (b.hasAttribute('data-own-back')) { st.own = false; redraw('[data-sq]'); }
    if (b.dataset.ownLv) { st.circle = +b.dataset.ownLv; redraw('[data-own-text]'); }
    if (b.hasAttribute('data-own-save')) {
      if (!st.name.trim()) { m.box.querySelector('[data-own-name]')?.focus(); return; }
      heroActions.addSpell({ heroId: v.id, name: st.name.trim(), circle: st.circle, description: st.text.trim() });
      m.close();
    }
    if (b.dataset.pickSpell) {
      const s = all.find((x) => x.ref === b.dataset.pickSpell);
      if (!s) return;
      heroActions.addSpell({ heroId: v.id, name: s.name, circle: s.level, ref: s.ref, ritual: s.ritual });
      have.add(s.name.toLowerCase()); redraw('[data-sq]');
    }
  });
}

// ——— Сумка: добавить предмет и монеты (#203) ———
function addItemModal(v) {
  const all = gearCatalog();
  let q = '';
  const KIND = { weapon: 'оружие', armor: 'доспех', shield: 'щит', gear: 'снаряжение', tool: 'инструмент', pack: 'набор', ammunition: 'боеприпасы', mount: 'транспорт' };
  const list = () => { const n = q.trim().toLowerCase(); return (n ? all.filter((g) => g.name.toLowerCase().includes(n)) : all).slice(0, 40); };
  const body = () => html`<div class="s-rest-modal s-add-modal"><div class="s-rest-head">${ic('backpack-01', 18)}<b>Добавить в сумку</b><span class="spacer"></span><button class="icon-btn icon-btn-sm" data-close aria-label="Закрыть">${ic('cancel-01', 18)}</button></div>
    <span class="input">${ic('search-01', 16)}<input data-q placeholder="Кинжал, верёвка, зелье лечения…" value="${q}" autofocus></span>
    <div class="s-add-list">${list().map((g) => html`<button class="s-add-row" data-ref="${g.ref}"><b>${g.name}</b><small>${KIND[g.kind] || g.kind}${g.weight ? ` · ${g.weight} фнт` : ''}</small>${ic('plus-sign', 16)}</button>`)}
      ${q.trim() ? html`<button class="s-add-row own" data-own><b>«${q.trim()}»</b><small>свой предмет</small>${ic('plus-sign', 16)}</button>` : ''}</div></div>`;
  const m = modal(body(), { className: 'rest pick' });
  const redraw = () => { m.set(body()); const i = m.box.querySelector('[data-q]'); i.focus(); i.setSelectionRange(q.length, q.length); };
  m.box.addEventListener('input', (e) => { if (e.target.matches('[data-q]')) { q = e.target.value; redraw(); } });
  m.box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ref],[data-own]'); if (!b) return;
    const g = all.find((x) => x.ref === b.dataset.ref);
    heroActions.addItem({ heroId: v.id, ...(g ? { name: g.name, ref: g.ref, weight: g.weight } : { name: q.trim() }), quantity: 1 });
    m.close();
  });
}
function coinsModal(v) {
  const c = v.inventory.coins;
  const m = modal(html`<div class="s-rest-modal"><div class="s-rest-head">${ic('backpack-01', 18)}<b>Монеты</b><span class="spacer"></span><button class="icon-btn icon-btn-sm" data-close aria-label="Закрыть">${ic('cancel-01', 18)}</button></div>
    <div class="s-coins">${[['pp', 'пм'], ['gp', 'зм'], ['ep', 'эм'], ['sp', 'см'], ['cp', 'мм']].map(([k, t]) => html`<label><small>${t}</small><input type="number" min="0" step="1" data-coin="${k}" value="${c[k] || 0}"></label>`)}</div>
    <div class="s-rest-foot"><button class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary" data-ok>${ic('tick-02', 16)}Сохранить</button></div></div>`, { className: 'rest' });
  m.box.querySelector('[data-ok]').addEventListener('click', () => {
    const p = { heroId: v.id };
    m.box.querySelectorAll('[data-coin]').forEach((i) => { p[i.dataset.coin] = Number(i.value) || 0; });
    heroActions.coins(p); m.close();
  });
}

export { chip };
