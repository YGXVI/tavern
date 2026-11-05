// Лист героя на витринных данных (#203): удобный лист (54–59), классический (60), лист на карте (61–66), корнеры (67–71).
// Адреса: #/hero/<id>[/<combat|magic|skills|bag|person>] · #/hero/<id>/classic/<1-3> · #/hero/<id>/table[/<вкладка>]
// Корнеры и варианты — после «?»: down, concentration, noSlots, multiclass, unfinished, roll, stub, ask, levelup.
import { html, raw } from '../../core/dom.js';
import { modal, popover, closePopover, toast } from '../../ui/kit.js';
import { heroView, heroActions } from './contract.js';
import { ic, chip, caps, rowIcon, segmented, check, pips } from './parts.js';
import { previewNote } from './index.js';

const TABS = [
  { id: 'combat', name: 'Бой', icon: 'sword-01' }, { id: 'magic', name: 'Магия', icon: 'sparkles' },
  { id: 'skills', name: 'Навыки', icon: 'hand-grip' }, { id: 'bag', name: 'Сумка', icon: 'backpack-01' }, { id: 'person', name: 'Личность', icon: 'pencil-edit-02' },
];
// Правки на этой странице живут до перезагрузки: витрина неизменна, действия уходят в heroActions.
const local = { hpDelta: {}, prepared: {}, spellFocus: 'web', magicView: 'ready', search: '' };

export function mount(root, { parts, query, page, L }) {
  const [, id = 'lira', sub, n] = parts;
  const q = new Set(query.split('&').filter(Boolean));
  const corner = ['down', 'concentration', 'noSlots', 'multiclass', 'unfinished'].find((c) => q.has(c)) || '';
  const v = heroView(id, corner);
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
// Настоящий герой (v.live) — хиты уже в данных; локальная поправка только у образца.
const hpOf = (v) => { const h = v.vitals.hp; const now = Math.max(0, Math.min(h.max, h.now + (v.live ? 0 : local.hpDelta[v.id] || 0))); return { ...h, now }; };

function sheetHead(v, mode) {
  const back = mode === 'table' ? '' : html`<a class="icon-btn" href="#/heroes" aria-label="К героям">${ic('arrow-left-02')}</a>`;
  return html`<header class="s-head">${back}
    <span class="s-portrait ${v.isMine === false ? 'other' : ''}"><img src="${v.portrait}" alt=""></span>
    <span class="s-who"><b class="s-name" title="${v.name}" data-fullname>${v.name}</b><small>${v.subtitle}</small></span>
    <span class="spacer"></span>
    ${mode === 'table' ? html`${v.isMine === false ? '' : html`<a class="icon-btn icon-btn-sm" href="#/hero/${v.id}" aria-label="Открыть полностью">${ic('maximize-01', 18)}</a>`}<button class="icon-btn icon-btn-sm" data-more aria-label="Ещё">${ic('more-horizontal', 18)}</button><a class="icon-btn icon-btn-sm" href="#/hero/${v.id}/table?stub" aria-label="Свернуть">${ic('cancel-01', 18)}</a>`
      : html`${v.live && v.canLevelUp ? html`<a class="btn btn-sm btn-secondary" href="#/hero/${v.id}/levelup/hp">${ic('sparkles', 16)}Новый уровень</a>` : ''}<nav class="h-seg dark s-mode"><a href="#/hero/${v.id}" aria-selected="${mode === 'easy'}">${ic('book-open-01', 16)}Удобный</a><a href="#/hero/${v.id}/classic/1" aria-selected="${mode === 'classic'}">${ic('pen-tool-01', 16)}Классический</a></nav><button class="icon-btn icon-btn-sm" data-more aria-label="Ещё">${ic('more-horizontal', 18)}</button>`}
  </header>`;
}

function hpCard(v, { readonly = false } = {}) {
  const h = hpOf(v);
  const pct = h.max ? Math.round((h.now / h.max) * 100) : 0;
  return html`<div class="s-hp ${h.now === 0 ? 'zero' : ''}">
    ${readonly ? '' : html`<button class="s-hp-btn" data-hp="-1" aria-label="Урон">${ic('minus-sign', 18)}</button>`}
    <div class="s-hp-mid"><div class="s-hp-row"><span class="k">хп</span><b data-explain="hp">${h.now}</b><span class="max">/ ${h.max}</span><span class="spacer"></span><small>врем. ${h.temp || 0}</small></div>
      <span class="s-hp-bar"><i style="width:${pct}%"></i></span></div>
    ${readonly ? '' : html`<button class="s-hp-btn" data-hp="1" aria-label="Лечение">${ic('plus-sign', 18)}</button>`}
  </div>`;
}

const pills = (v) => html`<div class="s-pills">${[['кд', v.vitals.ac.value, 'ac'], ['иниц.', v.vitals.init, 'init'], ['шаг', v.vitals.speed], ['маст.', v.vitals.prof]].map(([k, val, ex]) => html`<span class="s-pill" ${ex ? raw(`data-explain="${ex}"`) : ''}><small>${k}</small><b>${val}</b></span>`)}</div>`;

function concRow(v) {
  const c = v.concentration;
  const notice = v.notice ? html`<span class="s-note">${v.notice}</span>` : '';
  const conds = (v.conditions || []).map((x) => html`<span class="s-cond">${x.name}</span>`);
  return html`<div class="s-conc">${conds}${c ? html`<span class="s-conc-chip">${ic('sparkles', 14)}Концентрация: ${c.spell}<button data-drop-conc aria-label="Снять">${ic('cancel-01', 12)}</button></span>` : ''}${notice}${v.down ? '' : html`<button class="s-add" data-add-cond>${ic('plus-sign', 14)}Состояние</button>`}</div>`;
}

const statBox = (a) => html`<button class="s-stat" data-roll="Проверка: ${a.name}|к20 ${a.mod}"><small>${a.short}</small><b>${a.mod}</b><span>${a.score}</span></button>`;
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
  if (a.empty) return html`<div class="s-act s-act-empty">${ic('sparkles', 18)}<span>${a.name}</span><span class="spacer"></span><a class="btn btn-sm btn-secondary" href="#/hero/new/spells">${a.action}</a></div>`;
  const noSlot = v.noSlot && a.slotLevel === v.noSlot.level;
  const off = v.down;
  return html`<div class="s-act ${a.icon} ${noSlot ? 'noslot' : ''} ${off ? 'off' : ''}" data-act-row="${a.id}">
    <span class="s-act-ic">${ic(rowIcon(a.icon), 18)}</span>
    <span class="s-act-t"><b>${a.name}</b><small>${noSlot ? `${a.slotLevel} ур. · нет ячеек` : a.sub}</small></span>
    ${a.hit ? html`<span class="s-badge" ${a.explain ? raw(`data-explain="${a.explain}"`) : ''}>${a.hit}</span>` : ''}${a.dc ? html`<span class="s-badge" ${a.explain ? raw(`data-explain="${a.explain}"`) : ''}>${a.dc}</span>` : ''}${a.dmg ? html`<span class="s-badge">${a.dmg}</span>` : ''}
    <button class="s-dice" data-roll="${a.name}|${a.hit ? `к20 ${a.hit}` : a.dmg || a.dc || ''}" aria-label="Бросить" ${off || noSlot ? raw('data-blocked') : ''}>${ic('dice-faces-06', 16)}</button>
  </div>`;
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
  if (!sc || v.status === 'unfinished') return html`<div class="s-empty">${ic('sparkles', 28)}<b>Заклинаний пока нет</b><p class="muted">Волшебнице нужна книга: 4 заговора и 14 заклинаний. Это шаг 6 мастера создания.</p><a class="btn btn-primary" href="#/hero/new/spells">${ic('arrow-right-02')}Выбрать заклинания</a></div>`;
  const view = local.magicView;
  const prepared = (s) => local.prepared[s.id] ?? s.prepared;
  let list = sc.spells;
  if (view === 'ready') list = list.filter((s) => s.level === 0 || prepared(s));
  if (view === 'ritual') list = list.filter((s) => s.ritual);
  if (local.search) list = list.filter((s) => s.name.toLowerCase().includes(local.search));
  const byLevel = [0, 1, 2, 3].map((lv) => ({ lv, items: list.filter((s) => s.level === lv) })).filter((g) => g.items.length);
  const slot = (lv) => v.resources.find((r) => r.id === `slot-${lv}`);
  const spell = (s) => {
    const open = s.id === local.spellFocus;
    return html`<div class="s-spell ${open ? 'open' : ''}" data-spell="${s.id}"><button class="s-spell-row" data-spell-open="${s.id}"><span data-prep="${s.id}">${check(prepared(s) || s.level === 0, 'magic')}</span><span class="t"><b>${s.name}</b><small>${s.range.toLowerCase()} · ${s.time.toLowerCase()}</small></span>${s.conc ? html`<span class="h-kr k">К</span>` : ''}${s.ritual ? html`<span class="h-kr">Р</span>` : ''}</button>
      ${open ? html`<div class="s-spell-more"><small>${s.meta || `${s.time} · ${s.range} · ${s.duration} · ${s.comp}`}</small><p>${s.text}</p><div class="s-spell-acts"><button class="btn btn-primary btn-sm" data-cast="${s.id}">${ic('sparkles', 14)}Сотворить</button>${s.level ? html`<button class="btn btn-ghost btn-sm" data-slot-pick="${s.id}">${ic('arrow-down-01', 14)}Ячейка ${s.level} ур.</button>` : ''}</div></div>` : ''}</div>`;
  };
  const groups = byLevel.map((g) => html`<div class="s-group">${caps(g.lv ? `${g.lv} уровень` : 'Заговоры')}<small>${g.lv ? `${slot(g.lv)?.left ?? 0} из ${slot(g.lv)?.total ?? 0} ячеек` : 'без ячеек'}</small></div>${g.items.map(spell)}`);
  const half = Math.ceil(groups.length / 2);
  const slotsBox = narrow ? html`<div class="s-res">${v.resources.filter((r) => r.kind === 'slot').map((r) => html`<div class="s-res-row"><span>${r.name.replace('Ячейки ', '').replace(' ур.', ' уровень')}</span>${pips(r.left, r.total)}<b>${r.left}/${r.total}</b></div>`)}</div>` : '';
  return html`${slotsBox}<div class="s-magic-top"><span class="s-pill"><small>сл</small><b data-explain="dc">${sc.dc}</b></span><span class="s-pill"><small>атака</small><b>${sc.attack}</b></span><span class="s-pill"><small>готово</small><b>${sc.prepared.now} из ${sc.prepared.max}</b></span><span class="spacer"></span>
    ${segmented([{ id: 'ready', name: 'Готовые' }, { id: 'book', name: 'Вся книга' }, { id: 'ritual', name: 'Ритуалы' }], view, 'data-mview', narrow ? 'wide' : '')}</div>
    ${narrow ? html`<div class="s-col">${groups}</div>` : html`<div class="s-cols"><div class="s-col">${groups.slice(0, half)}</div><div class="s-col">${groups.slice(half)}</div></div>`}`;
}

function skillsTab(v, { narrow = false, ask = false } = {}) {
  let skills = v.skills;
  if (local.search) skills = skills.filter((s) => s.name.toLowerCase().includes(local.search));
  const row = (s) => html`<button class="s-skill ${ask && s.name === 'Внимательность' ? 'asked' : ''}" data-roll="${s.name}|к20 ${s.mod}"><i class="${s.prof}"></i><span>${s.name}</span><small>${s.ab}</small><b>${s.mod}</b>${ic('dice-faces-06', 14)}</button>`;
  const half = Math.ceil(skills.length / 2);
  const askBox = ask ? html`<section class="s-ask"><div class="s-ask-head">${ic('crown', 16)}<span><b>Мастер просит: Внимательность</b><small>Проверка Мудрости. Результат увидит только мастер.</small></span></div><button class="btn btn-primary btn-block" data-roll="Внимательность · для мастера|к20 + 1">${ic('dice-faces-06', 16)}Бросить: к20 + 1</button></section>` : '';
  const body = narrow ? html`<div class="s-group">${caps('Навыки')}<small>пассивная Внимательность ${v.vitals.passive.perception}</small></div><div class="s-col tight">${skills.map(row)}</div>`
    : html`<div class="s-group">${caps('Навыки')}<small>клик — бросок</small></div><div class="s-cols tight"><div class="s-col">${skills.slice(0, half).map(row)}</div><div class="s-col">${skills.slice(half).map(row)}</div></div>`;
  const saves = html`<div class="s-group">${caps('Спасброски')}<small>золотые — владеет</small></div><div class="s-saves">${v.abilities.map((a) => html`<button class="s-save ${a.saveProf ? 'prof' : ''}" data-roll="Спасбросок: ${a.name}|к20 ${a.save}" ${a.saveProf ? raw(`data-explain="save.${a.key}"`) : ''}><small>${a.short}</small>${a.save}</button>`)}</div>
    <div class="s-group">${caps('Пассивные')}<small>для скрытых проверок мастера</small></div><div class="s-passive">${[['Внимательность', v.vitals.passive.perception], ['Проницательность', v.vitals.passive.insight], ['Анализ', v.vitals.passive.investigation]].map(([k, n]) => html`<span><small>${k}</small><b>${n}</b></span>`)}</div>`;
  return html`${askBox}${body}${narrow ? '' : saves}`;
}

function bagTab(v) {
  const inv = v.inventory;
  const item = (it) => html`<div class="s-item"><span class="s-act-ic">${ic(rowIcon(it.icon), 18)}</span><span class="t"><b>${it.name}</b><small>${it.sub}</small></span>${it.tag ? html`<span class="h-mini-chip ${it.tag === 'Новое' ? 'accent' : 'gold'}">${it.tag}</span>` : ''}<small class="qty">×${it.qty}</small></div>`;
  return html`<div class="s-bag-top"><span class="s-pill"><small>груз</small><b>${inv.load.now} / ${inv.load.max} фнт</b></span><span class="s-pill"><small>зм</small><b>${inv.coins.gp}</b></span><span class="s-pill"><small>см</small><b>${inv.coins.sp}</b></span><span class="s-pill"><small>мм</small><b>${inv.coins.cp}</b></span><span class="spacer"></span><button class="btn btn-secondary btn-sm" data-add-item>${ic('plus-sign', 14)}Добавить</button></div>
    <div class="s-group">${caps('Надето и в руках')}<small>влияет на атаки и КД</small></div><div class="s-items on">${inv.equipped.map(item)}</div>
    <div class="s-group">${caps('В рюкзаке')}<small>перетащите на портрет, чтобы передать</small></div><div class="s-items">${inv.pack.map(item)}</div>`;
}

function personTab(v) {
  const p = v.personality;
  if (v.status === 'unfinished') return html`<div class="s-empty">${ic('pencil-edit-02', 28)}<b>Черты характера не заполнены</b><p class="muted">Черты, идеалы, привязанности и слабости — мастер вплетёт их в сюжет.</p><a class="btn btn-primary" href="#/hero/new/look">${ic('arrow-right-02')}Заполнить</a></div>`;
  const field = (k, label) => html`<label class="s-field"><span>${label}</span><textarea rows="2" data-edit="${k}">${p[k]}</textarea></label>`;
  return html`<div class="s-cols"><div class="s-col">${field('traits', 'Черты характера')}${field('ideals', 'Идеалы')}${field('bonds', 'Привязанности')}${field('flaws', 'Слабости')}${field('appearance', 'Внешность')}</div>
    <div class="s-col"><div class="s-group">${caps('Союзники и организации')}</div>${p.allies.map((a) => html`<div class="s-note-card"><b>${a.name}</b><p>${a.text}</p></div>`)}
      <div class="s-group">${caps('Цели и задачи')}</div><ul class="s-goals">${p.goals.map((g) => html`<li>${check(false)}${g}</li>`)}</ul>
      <div class="s-group">${caps('Заметки')}<small>видите только вы</small></div>${p.notes.map((n, i) => html`<label class="s-field"><textarea rows="3" data-edit="note-${i}">${n}</textarea></label>`)}</div></div>`;
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
  const pages = {
    1: html`<div class="c-top">${box('', html`${line(v.name, 'Имя персонажа')}<div class="c-2">${line(v.background, 'Предыстория')}${line(v.classes[0].short || v.classes[0].name, 'Класс')}${line(v.race, 'Вид')}${line(v.classes[0].sub || '—', 'Подкласс')}</div>`, 'c-ident')}
        <div class="c-level"><b>${v.level}</b><small>уровень</small><span>${v.xp.now.toLocaleString('ru')}</span><small>опыт</small></div>
        <div class="c-shield"><small>Класс защиты</small><b>${v.vitals.ac.value}</b><small>щит</small><i></i></div>
        ${box('Хиты', html`<div class="c-hp"><span>${hpOf(v).now}<small>текущие</small></span><span>${v.vitals.hp.temp}<small>временные</small>${v.vitals.hp.max}<small>максимум</small></span></div>`, 'c-hpbox')}
        ${box('Кости хитов', html`<div class="c-hd">${v.vitals.hitDice.left} / ${v.vitals.hitDice.total}<small>текущие</small>${v.vitals.hitDice.die}<small>кость</small></div>`, 'c-small')}
        ${box('Спасброски от смерти', html`<small>успехи</small><div class="c-dia">◇ ◇ ◇</div><small>провалы</small><div class="c-dia">◇ ◇ ◇</div>`, 'c-small')}</div>
      <div class="c-title"><span></span><b>Распутье</b><span></span></div>
      <div class="c-grid">
        <div class="c-col">${box('Бонус владения', html`<div class="c-big">${v.vitals.prof}</div>`)}${abil(ab.str)}${abil(ab.dex)}${abil(ab.con)}${box('Истощение', html`<div class="c-squares">${'▢'.repeat(6)}</div>`)}${box('Героическое вдохновение', html`<div class="c-squares">▢</div>`)}</div>
        <div class="c-col">${abil(ab.int)}${abil(ab.wis)}${abil(ab.cha)}</div>
        <div class="c-col wide"><div class="c-4">${box('Инициатива', html`<div class="c-big">${v.vitals.init}</div>`)}${box('Скорость', html`<div class="c-big">${parseInt(v.vitals.speed, 10)}</div>`)}${box('П. внимательность', html`<div class="c-big">${v.vitals.passive.perception}</div>`)}${box('Состояния', html`<p>${v.concentration ? 'Концентрация' : '—'}</p>`)}</div>
          ${box('Оружие и боевые заговоры', html`<table class="c-table"><tr><th>Название</th><th>Бонус / Сложность</th><th>Урон / Вид</th><th>Заметки</th></tr>${[['Кинжал', '+6', '1к4+3 колющий', 'Фехтовальное, метательное 20/60'], ['Огненный снаряд', '+7', '2к10 огонь', 'Заговор, 120 фт'], ['Боевой посох', '+2', '1к6−1 дробящий', 'Фокус']].map((r) => html`<tr>${r.map((c) => html`<td>${c}</td>`)}</tr>`)}</table>`)}
          ${box('Умения и способности', html`${v.features.map((f) => html`<p><b>${f.name}.</b><br>${f.text}</p>`)}`, 'c-paper tall')}</div>
      </div>
      <div class="c-grid3">${box('Владение снаряжением и умения', html`<div class="c-prof"><small>доспехи</small>◇ Лёгкие ◇ Средние ◇ Тяжёлые ◇ Щит</div><div class="c-prof"><small>оружие</small>◆ Простое ◇ Воинское ◇ Другое</div><p><b>Языки:</b> ${v.proficiencies.languages}</p><p><b>Инструменты:</b> ${v.proficiencies.tools}</p><p><b>Оружие:</b> ${v.proficiencies.weaponsText}</p>`, 'c-paper')}
        ${box('Атаки и заклинания', html`<p>Заговоры: Огненный снаряд, Волшебная рука, Свет, Фокусы</p><p>Книга: 14 заклинаний, подготовлено 9 — стр. 3</p><p>Ячейки: 4 · 3 · 2</p><p>Концентрация сейчас: Паутина</p>`, 'c-paper')}
        ${box('Черты', html`${v.traits.map((t) => html`<p>${t}</p>`)}`, 'c-paper')}</div>`,
    2: html`<div class="c-grid2"><div class="c-col">${box('Портрет', html`<img class="c-portrait" src="${v.art}" alt="">`)}${box('Цели и задачи', html`${p.goals.map((g) => html`<p>${g}</p>`)}`, 'c-paper tall')}</div>
        <div class="c-col">${box('Союзники и организации', html`${p.allies.map((a) => html`<p><b>${a.name}</b><br>${a.text}</p>`)}`, 'c-paper')}${box('Дополнительные способности и умения', html`${p.extra.map((a) => html`<p><b>${a.name}</b><br>${a.text}</p>`)}`, 'c-paper')}${box('Сокровища', html`${p.treasures.map((t) => html`<p>${t}</p>`)}`, 'c-paper')}</div></div>
      <div class="c-notes">${[0, 1, 2, 3, 4, 5].map((i) => box('Заметки', html`<textarea data-edit="classic-note-${i}" rows="6">${i % 2 === 0 ? p.notes[i / 2] || '' : ''}</textarea>`, `c-paper ${i % 2 === 0 ? 'wide' : ''}`))}</div>`,
    3: html`<div class="c-grid2 s3"><div class="c-col"><div class="c-4 sp">${box('', html`${line('Интеллект', 'Характеристика')}<div class="c-kv"><b>${sc.mod}</b><small>заклинательный модификатор</small></div><div class="c-kv"><b>${sc.dc}</b><small>сложность спасброска</small></div><div class="c-kv"><b>${sc.attack}</b><small>бонус атаки заклинанием</small></div>`, 'c-spellab')}
          <div class="c-col">${box('', html`<div class="c-4">${[['Размер', v.vitals.size], ['Грузоподъёмность', v.vitals.carry], ['Прыжок в.', v.vitals.jump.high], ['Прыжок д.', v.vitals.jump.long]].map(([k, val]) => html`<div class="c-mini"><small>${k}</small><b>${val}</b></div>`)}</div>`, 'c-bare')}
            ${box('Ячейки заклинаний', html`<div class="c-slots">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((lv) => { const r = v.resources.find((x) => x.id === `slot-${lv}`); return html`<span>${lv}-й ${r ? html`${'◆'.repeat(r.left)}${'◇'.repeat(r.total - r.left)}` : ''}</span>`; })}</div>`)}</div></div>
        ${box('Заговоры и подготовленные заклинания', html`<table class="c-table spells"><tr><th>Ур.</th><th>Название</th><th>Время сотворения</th><th>Дистанция</th><th>Концентрация, ритуал, материал</th><th>Заметки</th></tr>${sc.spells.filter((s) => s.level === 0 || s.prepared).map((s) => html`<tr><td>${s.level}</td><td class="link">${s.name}</td><td>${s.time.replace('1 ', '').replace('действие', 'Действие')}</td><td>${s.range}</td><td>${s.conc ? '◆' : '◇'} К ${s.ritual ? '◆' : '◇'} Р ${s.comp.includes('М') ? '◆' : '◇'} М</td><td>${s.comp}</td></tr>`)}${Array.from({ length: 8 }, () => html`<tr><td></td><td></td><td></td><td></td><td>◇ К ◇ Р ◇ М</td><td></td></tr>`)}</table>`, 'c-spells')}</div>
      <div class="c-col">${box('Внешность', html`<p>${p.appearance}</p>`, 'c-paper')}${box('Предыстория и личные качества', html`<p><b>${p.backstoryTitle}</b><br>${p.backstory}</p><p><b>Черты:</b><br>${p.traits}</p><p><b>Слабость:</b><br>${p.flaws}</p>${line(v.alignment, 'Мировоззрение')}`, 'c-paper')}
        ${box('Снаряжение', html`<p>Кинжал, боевой посох (фокус)</p><p>Книга заклинаний, мешочек с компонентами</p><p>Зелье лечения ×2</p><p>Набор учёного, свиток «Обнаружение мыслей»</p><div class="c-sub">Настройка на магические предметы</div><p>◇</p><p>◇</p><p>◇</p>`, 'c-paper')}
        ${box('Монеты', html`<div class="c-coins">${[['мм', v.inventory.coins.cp], ['см', v.inventory.coins.sp], ['зм', v.inventory.coins.gp], ['эм', v.inventory.coins.ep], ['пм', v.inventory.coins.pp]].map(([k, val]) => html`<span><small>${k}</small><b>${val}</b></span>`)}</div><button class="c-manage" data-coins>Управлять</button>`)}</div></div>
      <div class="c-cards">${sc.spells.filter((s) => ['fire-bolt', 'web', 'fireball'].includes(s.id)).map((s) => html`<article class="c-card"><h3><span>${s.level}</span>${s.name}</h3><div class="c-card-tags"><span>${s.time.replace('1 ', '').replace('действие', 'Действие')}</span><span>${s.range}</span><span>${s.duration}</span></div><p>${s.text}</p><small>${s.comp}</small><footer>${s.school}<span>SRD</span></footer></article>`)}</div>`,
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
    <small>КД</small><b class="sm">${v.vitals.ac.value}</b><small>Ячейки</small>${(v.resources || []).filter((r) => r.kind === 'slot').map((r) => html`<span class="s-stub-slot"><small>${r.id.slice(-1)}</small>${pips(1, 1)}${r.left}</span>`)}
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

// ——— обработчики ———
function bindSheet(root, L, v, redraw) {
  L('click', '[data-hp]', (e, b) => { local.hpDelta[v.id] = (local.hpDelta[v.id] || 0) + +b.dataset.hp; heroActions.setHp({ heroId: v.id, delta: +b.dataset.hp }); refreshHp(root, v); });
  L('click', '[data-roll]', (e, b) => {
    if (b.hasAttribute('data-blocked')) return;
    const [what, formula] = b.dataset.roll.split('|');
    heroActions.roll({ heroId: v.id, what, formula });
  });
  L('click', '[data-explain]', (e, b) => { e.stopPropagation(); const t = v.explain?.[b.dataset.explain]; if (t) popover(html`<div class="s-explain">${t}</div>`, b, { placement: 'top', className: 'explain-pop' }); });
  L('click', '[data-res]', (e, b) => heroActions.useResource({ heroId: v.id, id: b.dataset.res }));
  L('click', '[data-drop-conc]', () => heroActions.dropConcentration({ heroId: v.id }));
  L('click', '[data-add-cond]', () => heroActions.toggleCondition({ heroId: v.id }));
  L('click', '[data-death]', () => heroActions.deathSave({ heroId: v.id }));
  L('click', '[data-rest]', (e, b) => (b.dataset.rest === 'short' ? shortRest(v) : heroActions.rest({ heroId: v.id, kind: 'long' })));
  L('click', '[data-mview]', (e, b) => { local.magicView = b.dataset.mview; redraw(); });
  L('click', '[data-spell-open]', (e, b) => {
    if (e.target.closest('[data-prep]')) { const id = e.target.closest('[data-prep]').dataset.prep; const s = v.spellcasting.spells.find((x) => x.id === id); if (s.level) { local.prepared[id] = !(local.prepared[id] ?? s.prepared); heroActions.prepare({ heroId: v.id, spellId: id, prepared: local.prepared[id] }); } redraw(); return; }
    local.spellFocus = local.spellFocus === b.dataset.spellOpen ? '' : b.dataset.spellOpen; redraw();
  });
  L('click', '[data-cast]', (e, b) => heroActions.cast({ heroId: v.id, spellId: b.dataset.cast }));
  L('click', '[data-slot-pick]', (e, b) => heroActions.cast({ heroId: v.id, spellId: b.dataset.slotPick, pickSlot: true }));
  L('click', '[data-add-item],[data-coins]', () => heroActions.addItem({ heroId: v.id }));
  L('click', '[data-more],[data-later]', () => heroActions.editField({ heroId: v.id, field: 'menu' }));
  L('change', '[data-edit]', (e, t) => heroActions.editField({ heroId: v.id, field: t.dataset.edit, value: t.value }));
  L('click', '[data-search]', () => { const s = root.querySelector('.s-search'); s?.classList.toggle('hidden'); s?.querySelector('input')?.focus(); });
  L('input', '[data-search-input]', (e, t) => { local.search = t.value.trim().toLowerCase(); clearTimeout(bindSheet.t); bindSheet.t = setTimeout(() => { redraw(); const s = root.querySelector('.s-search'); s?.classList.remove('hidden'); const i = s?.querySelector('input'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); });
}

function refreshHp(root, v) {
  const h = hpOf(v);
  root.querySelectorAll('.s-hp b[data-explain="hp"]').forEach((b) => { b.textContent = h.now; });
  root.querySelectorAll('.s-hp-bar i').forEach((i) => { i.style.width = `${Math.round((h.now / h.max) * 100)}%`; });
  root.querySelectorAll('.t-hp b').forEach((b) => { b.textContent = `${h.now}/${h.max}`; });
  root.querySelectorAll('.t-hp em').forEach((i) => { i.style.width = `${Math.round((h.now / h.max) * 100)}%`; });
}

// ——— 59 · Короткий отдых ———
function shortRest(v) {
  closePopover();
  let dice = 1; const pick = new Set([1, 2]);
  const hd = v.vitals.hitDice;
  const body = () => html`<div class="s-rest-modal"><div class="s-rest-head">${ic('hourglass', 18)}<b>Короткий отдых · 1 час</b><span class="spacer"></span><button class="icon-btn icon-btn-sm" data-close aria-label="Закрыть">${ic('cancel-01', 18)}</button></div>
    <div class="s-rest-row"><span class="h-stepper sm"><button data-hd="-1">${ic('minus-sign', 16)}</button><b>${dice}</b><button data-hd="1">${ic('plus-sign', 16)}</button></span><span><b>Кости хитов: ${dice}${hd.die}</b><small>осталось ${hd.left} из ${hd.total}</small></span></div>
    <div class="s-rest-row"><span><b>Маг. восстановление</b><small>до 3 уровней ячеек</small></span><span class="spacer"></span>${[1, 2, 3].map((lv) => html`<button class="s-lvl ${pick.has(lv) ? 'on' : ''}" data-lv="${lv}">${pick.has(lv) ? ic('tick-02', 12) : ''}${lv} ур.</button>`)}</div>
    <div class="s-rest-foot"><button class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary" data-ok>${ic('dice-faces-06', 16)}Отдохнуть</button></div></div>`;
  const m = modal(body(), { className: 'rest' });
  m.box.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.hd) { dice = Math.max(0, Math.min(hd.left, dice + +b.dataset.hd)); m.set(body()); }
    if (b.dataset.lv) { const lv = +b.dataset.lv; if (pick.has(lv)) pick.delete(lv); else if ([...pick].reduce((a, x) => a + x, 0) + lv <= 3) pick.add(lv); else toast({ title: 'Не больше 3 уровней ячеек', icon: 'information-circle', timeout: 1800 }); m.set(body()); }
    if (b.hasAttribute('data-ok')) { heroActions.rest({ heroId: v.id, kind: 'short', hitDice: dice, recover: [...pick] }); m.close(); }
  });
}

export { chip };
