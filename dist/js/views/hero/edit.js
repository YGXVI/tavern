// Правка героя (#203, 06.11 — sol0139: «я загрузил/создал, а редактировать больше не могу»).
// Адрес: #/hero/<герой>/edit. Один экран со всеми разделами листа: слева — оглавление, по центру — поля, справа — лист,
// как он станет после «Сохранить». Черновик живёт в sessionStorage вкладки (переживает уход на лист и обновление),
// сохраняется одной кнопкой — изменёнными полями (contract.saveEdit → edit-model.finishEdit).
import { html, raw } from '../../core/dom.js';
import { confirmDialog } from '../../ui/kit.js';
import { ABILITIES, SKILLS, CLASSES, RACES } from '../../data/rules.js';
import { readCharacter } from '../table/sheet-model.js';
import { attackBonus } from '../table/sheet-fields.js';
import { editState, editPreview, heroGear, heroActions } from './contract.js';
import { EDIT_SECTIONS, startEdit, editOp, changedSections, profLevel, initManual, acManual, classList, itemList, featureList, slotList, itemName } from './edit-model.js';
import { featureText, wornItems } from './gear.js';
import { ic, caps, miniStat } from './parts.js';

const SKEY = (key) => `rasputye-hero-edit-v1:${key}`;
const loadSession = (key) => { try { return JSON.parse(sessionStorage.getItem(SKEY(key))); } catch { return null; } };
const saveSession = (key, s) => { try { sessionStorage.setItem(SKEY(key), JSON.stringify(s)); } catch { /* приватный режим */ } };
const dropSession = (key) => { try { sessionStorage.removeItem(SKEY(key)); } catch { /* приватный режим */ } };

const MINUS = '−';
const signed = (n) => (Number.isFinite(n) ? (n < 0 ? `${MINUS}${Math.abs(n)}` : `+${n}`) : '—');
const abMod = (v) => Math.floor((Number(v ?? 10) - 10) / 2);
const ALIGN = ['Законно-добрый', 'Нейтрально-добрый', 'Хаотично-добрый', 'Законно-нейтральный', 'Нейтральный', 'Хаотично-нейтральный', 'Законно-злой', 'Нейтрально-злой', 'Хаотично-злой'];
const BACKGROUNDS = ['Артист', 'Беспризорник', 'Благородный', 'Гильдейский ремесленник', 'Моряк', 'Мудрец', 'Народный герой', 'Отшельник', 'Пират', 'Прислужник', 'Преступник', 'Солдат', 'Чужеземец', 'Шарлатан'];
const COINS = [['pp', 'ПМ', 'платиновые'], ['gp', 'ЗМ', 'золотые'], ['ep', 'ЭМ', 'электрумовые'], ['sp', 'СМ', 'серебряные'], ['cp', 'ММ', 'медные']];
const PERSON = [['traits', 'Черты характера', 'Как герой держится с людьми'], ['ideals', 'Идеалы', 'Во что верит'], ['bonds', 'Привязанности', 'Кто или что ему дорого'], ['flaws', 'Слабости', 'Что его подводит']];
const PROF_LABEL = ['Нет', 'Владение', 'Компетентность'];
const at = (o, path) => path.split('.').reduce((v, k) => v?.[k], o);

export function mount(root, { parts, page, L }) {
  const key = parts[1];
  const st = editState(key);
  const stop = (title, text, back = '#/heroes') => page(html`<main class="page h-page"><div class="h-center h-missing">${ic('user', 32)}<h1>${title}</h1><p class="muted">${text}</p><a class="btn btn-primary" href="${back}">${ic('arrow-left-02')}Назад</a></div></main>`, '', true);
  if (!st) return stop('Героя не найти', 'Его могли удалить или перенести.');
  if (!st.canEdit) return stop('Править может игрок или мастер', 'Этот герой не ваш — лист можно только смотреть.', `#/hero/${key}`);

  // Черновик: из сессии, если в нём есть правки (вернулись с листа или обновили страницу), иначе — свежая копия.
  let s = loadSession(key);
  if (!s?.base || !s?.draft || !changedSections(s.base, s.draft).length) s = startEdit(st.data);
  // Открыли правку, а в черновике уже есть изменения (ушли на лист, обновили страницу) — скажем об этом.
  const restored = changedSections(s.base, s.draft).length > 0;
  let { base, draft } = s;
  const persist = () => saveSession(key, { base, draft });
  persist();
  const gear = heroGear();
  const ctx = { gear };
  let shown = { restored };

  // Прокручивается .screen (не окно): перерисовка оставляет его на месте.
  const scroller = () => root.querySelector('.screen');
  const render = () => {
    const y = scroller()?.scrollTop || 0;
    page(editPage(), 'edit-page', false);
    const sc = scroller(); if (sc) sc.scrollTop = y;
    refresh();
    spy();
  };
  // ——— экран ———
  function editPage() {
    const v = editPreview(key, draft) || st.v;
    const dirty = changedSections(base, draft);
    const nav = html`<nav class="e-nav" aria-label="Разделы">${EDIT_SECTIONS.map((x) => html`<button data-goto="${x.id}" class="${dirty.includes(x.id) ? 'dirty' : ''}">${ic(x.icon, 16)}<span>${x.name}</span><i class="e-dot" aria-hidden="true"></i></button>`)}</nav>`;
    return html`<main class="e-page">
      <header class="e-head">
        <a class="icon-btn" href="#/hero/${key}" aria-label="К листу">${ic('arrow-left-02')}</a>
        <span class="e-head-pic"><img src="${v.portrait}" alt="" data-pv-pic></span>
        <span class="e-head-who">${caps('Правка героя')}<b data-pv-name>${v.name}</b></span>
        <span class="spacer"></span>
        <span class="e-where">${st.lib ? html`${ic('user', 14)}Мои герои` : html`${ic('home-01', 14)}${st.campaign?.name || ''}`}</span>
      </header>
      ${shown.restored ? html`<div class="e-banner">${ic('undo-02', 18)}<span><b>Продолжаем правку</b><small>Несохранённые изменения остались с прошлого раза.</small></span><span class="spacer"></span><button class="btn btn-ghost btn-sm" data-reset>Начать заново</button></div>` : ''}
      <div class="e-layout">
        ${nav}
        <div class="e-main">${whoSec()}${statsSec()}${skillsSec()}${combatSec(v)}${attacksSec(v)}${magicSec()}${bagSec()}${featuresSec()}${profsSec(v)}${personSec()}</div>
        <aside class="e-preview" data-preview>${preview(v)}</aside>
      </div>
      <footer class="h-bottom e-bottom"><button class="btn btn-secondary" data-cancel>${ic('cancel-01')}Отменить</button><span class="h-bottom-hint" data-dirty></span><button class="btn btn-primary" data-save>${ic('tick-02')}Сохранить</button></footer>
      ${datalists()}
    </main>`;
  }
  const sec = (id, title, hint, body) => { const x = EDIT_SECTIONS.find((e) => e.id === id); return html`<section class="e-sec" id="e-${id}" data-sec="${id}"><header class="e-sec-head"><span class="e-sec-ic">${ic(x.icon, 18)}</span><h2>${title}</h2><small>${hint}</small></header>${body}</section>`; };
  const field = (label, input, cls = '') => html`<label class="field e-field ${cls}"><span class="label">${label}</span>${input}</label>`;
  const textIn = (path, value, ph = '', list = '') => html`<span class="input"><input data-f="${path}" value="${value ?? ''}" placeholder="${ph}" autocomplete="off" ${list ? raw(`list="${list}"`) : ''}></span>`;
  const numIn = (attrs, value, { suffix = '', ph = '', label = '' } = {}) => html`<span class="input e-num"><input ${raw(attrs)} inputmode="decimal" value="${value ?? ''}" placeholder="${ph}" aria-label="${label}">${suffix ? html`<span class="suffix">${suffix}</span>` : ''}</span>`;
  const area = (path, value, ph, rows = 3, disabled = false) => html`<span class="input area ${disabled ? 'off' : ''}"><textarea data-f="${path}" rows="${rows}" placeholder="${ph}" ${disabled ? raw('disabled') : ''}>${value ?? ''}</textarea></span>`;
  const seg = (attr, items, active) => html`<div class="h-seg e-seg" role="group">${items.map(([id, label]) => html`<button ${raw(attr)}="${id}" aria-pressed="${String(id === active)}" aria-selected="${String(id === active)}">${label}</button>`)}</div>`;
  const drop = (list, id, label) => html`<button class="icon-btn icon-btn-sm e-drop" data-op="drop" data-list="${list}" data-id="${id}" aria-label="Убрать: ${label || 'строку'}" title="Убрать">${ic('delete-02', 16)}</button>`;

  function datalists() {
    return html`<datalist id="e-races">${RACES.map((r) => html`<option value="${r.name}"></option>`)}</datalist>
      <datalist id="e-bgs">${BACKGROUNDS.map((b) => html`<option value="${b}"></option>`)}</datalist>
      <datalist id="e-aligns">${ALIGN.map((a) => html`<option value="${a}"></option>`)}</datalist>`;
  }
  function whoSec() {
    const cls = classList(draft);
    const classRow = (c, i) => {
      const known = CLASSES.some((x) => x.name === c.name);
      return html`<div class="e-class">
        <span class="input e-select">${ic('shield-user', 16)}<select data-class="${i}" data-field="name" aria-label="Класс">${known ? '' : html`<option value="${c.name}" selected>${c.name || 'Свой класс'}</option>`}${CLASSES.map((x) => html`<option value="${x.id}" ${x.name === c.name ? raw('selected') : ''}>${x.name}</option>`)}</select>${ic('arrow-down-01', 14)}</span>
        <span class="input"><input data-class="${i}" data-field="subclass" value="${c.subclass || ''}" placeholder="Подкласс — например, Чемпион" autocomplete="off" aria-label="Подкласс"></span>
        <span class="e-stepper" role="group" aria-label="Уровень класса"><button data-op="classLv" data-i="${i}" data-by="-1" aria-label="Уровнем ниже" ${Number(c.levels) <= 1 ? raw('disabled') : ''}>${ic('minus-sign', 14)}</button><b>${c.levels || 1}<small>ур.</small></b><button data-op="classLv" data-i="${i}" data-by="1" aria-label="Уровнем выше" ${Number(c.levels) >= 20 ? raw('disabled') : ''}>${ic('plus-sign', 14)}</button></span>
        ${cls.length > 1 ? html`<button class="icon-btn icon-btn-sm e-drop" data-op="dropClass" data-i="${i}" aria-label="Убрать класс" title="Убрать класс">${ic('delete-02', 16)}</button>` : ''}
      </div>`;
    };
    return sec('who', 'Кто это', 'Имя, раса, предыстория, класс и уровень', html`
      <div class="e-who">
        <button class="e-pic" data-pic aria-label="Сменить портрет"><img src="${st.v.portrait}" alt="" data-pv-pic><span>${ic('image-add-01', 16)}Сменить</span></button>
        <div class="e-grid2">
          ${field('Имя', textIn('name', draft.name, 'Как зовут героя'))}
          ${field('Раса', textIn('raceName', draft.raceName, 'Например, Дварф', 'e-races'))}
          ${field('Предыстория', textIn('background', draft.background, 'Например, Солдат', 'e-bgs'))}
          ${field('Мировоззрение', textIn('alignment', draft.alignment, 'Например, Нейтральный', 'e-aligns'))}
        </div>
      </div>
      ${caps('Класс и уровень')}
      <div class="e-classes">${cls.map(classRow)}
        <button class="btn btn-ghost btn-sm e-add" data-op="addClass">${ic('plus-sign', 16)}Ещё класс — мультикласс</button>
      </div>
      <p class="e-note">${ic('information-circle', 16)}<span>Здесь меняется запись в листе. Умения, хиты и ячейки нового уровня даёт «Новый уровень» на листе.</span></p>`);
  }
  function statsSec() {
    return sec('stats', 'Характеристики', 'Значения и спасброски с владением', html`<div class="e-stats">${ABILITIES.map((a) => {
      const on = profLevel(draft, 'saves', a.id) >= 1;
      return html`<div class="e-stat">
        <span class="e-stat-name">${a.name}</span>
        <div class="e-stat-row"><button class="e-step" data-op="step" data-id="${a.id}" data-by="-1" aria-label="${a.name}: меньше">${ic('minus-sign', 16)}</button>
          <input class="e-stat-in" data-f="stats.${a.id}" inputmode="numeric" value="${draft.stats?.[a.id] ?? 10}" aria-label="${a.name}">
          <button class="e-step" data-op="step" data-id="${a.id}" data-by="1" aria-label="${a.name}: больше">${ic('plus-sign', 16)}</button></div>
        <b class="e-stat-mod" data-calc="mod.${a.id}">${signed(abMod(draft.stats?.[a.id]))}</b>
        <button class="e-save ${on ? 'on' : ''}" data-op="prof" data-kind="saves" data-id="${a.id}" aria-pressed="${String(on)}"><i>${on ? ic('tick-02', 12) : ''}</i>Спасбросок<b data-calc="save.${a.id}"></b></button>
      </div>`;
    })}</div>`);
  }
  function skillsSec() {
    const list = [...SKILLS].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return sec('skills', 'Навыки', 'Нажатие: владение → компетентность → без владения', html`<div class="e-skills">${list.map((k) => {
      const lv = Math.min(2, Math.floor(profLevel(draft, 'skills', k.id)));
      return html`<button class="e-skill p${lv}" data-op="prof" data-kind="skills" data-id="${k.id}" aria-pressed="${String(lv > 0)}" title="${PROF_LABEL[lv]}"><span class="e-pip" aria-hidden="true"><i></i><i></i></span><span class="t">${k.name}<small>${ABILITIES.find((a) => a.id === k.ab)?.short}</small></span><em>${PROF_LABEL[lv]}</em><b data-calc="skill.${k.id}"></b></button>`;
    })}</div>`);
  }
  function combatSec(v) {
    const acOn = acManual(draft), initOn = initManual(draft);
    return sec('combat', 'Бой', 'Хиты, класс доспеха, инициатива, скорость', html`<div class="e-combat">
      <div class="e-tile">${caps('Хиты, максимум')}${numIn('data-f="hpMax"', draft.hpMax ?? v.vitals.hp.max, { label: 'Хиты, максимум' })}<small class="e-hint">Сейчас ${v.vitals.hp.now} — меняются на листе</small></div>
      <div class="e-tile">${caps('Класс доспеха')}${seg('data-ac-mode', [['auto', html`По снаряжению <b data-calc="acAuto"></b>`], ['manual', 'Вручную']], acOn ? 'manual' : 'auto')}
        ${acOn ? numIn('data-ac', draft.ac, { label: 'КД вручную' }) : html`<small class="e-hint" data-calc="acNote"></small>`}</div>
      <div class="e-tile">${caps('Инициатива')}${seg('data-init-mode', [['auto', html`По Ловкости <b data-calc="initAuto"></b>`], ['manual', 'Вручную']], initOn ? 'manual' : 'auto')}
        ${initOn ? numIn('data-init', draft.initBonus ?? '', { label: 'Инициатива вручную' }) : html`<small class="e-hint">Черта «Бдительный» или магия — включите «Вручную»</small>`}</div>
      <div class="e-tile">${caps('Скорость')}${numIn('data-f="speed"', draft.speed ?? 30, { suffix: 'фт', label: 'Скорость' })}</div>
      <div class="e-tile">${caps('Тёмное зрение')}${numIn('data-f="darkvision"', draft.darkvision || '', { suffix: 'фт', ph: 'нет', label: 'Тёмное зрение' })}</div>
    </div>`);
  }
  function attacksSec(v) {
    const auto = (v.actions?.action || []).filter((a) => String(a.id).startsWith('weapon-'));
    const own = Array.isArray(draft.attacks) ? draft.attacks : [];
    const abOpts = (cur) => html`<option value="" ${cur ? '' : raw('selected')}>—</option>${ABILITIES.map((a) => html`<option value="${a.id}" ${a.id === cur ? raw('selected') : ''}>${a.short}</option>`)}`;
    const pre = (label, input) => html`<span class="input e-lab"><span class="e-pre">${label}</span>${input}</span>`;
    const inp = (a, f, ph, label) => html`<input data-item="attacks" data-id="${a.id}" data-field="${f}" value="${a[f] ?? ''}" placeholder="${ph}" aria-label="${label}" autocomplete="off">`;
    const row = (a) => html`<div class="e-row e-attack">
      <div class="e-line"><span class="input e-grow">${ic('sword-01', 16)}${inp(a, 'name', 'Название — Когти, Посох отца', 'Название атаки')}</span>${drop('attacks', a.id, a.name)}</div>
      <div class="e-line e-attack-nums">
        ${pre('Урон', inp(a, 'damage', '1к8+3', 'Урон'))}
        ${pre('Тип', inp(a, 'type', 'рубящий', 'Тип урона'))}
        <span class="input e-select e-lab"><span class="e-pre">Хар.</span><select data-item="attacks" data-id="${a.id}" data-field="ability" aria-label="Характеристика">${abOpts(a.ability)}</select>${ic('arrow-down-01', 14)}</span>
        ${pre('Бонус', html`<input data-item="attacks" data-id="${a.id}" data-field="bonus" inputmode="numeric" value="${a.bonus ?? ''}" placeholder="${a.ability ? `авто ${signed(attackBonus({ ...draft }, { ...a, bonus: null }))}` : '—'}" aria-label="Бонус атаки">`)}
        <label class="check e-check"><input type="checkbox" data-item="attacks" data-id="${a.id}" data-field="proficient" ${a.proficient ? raw('checked') : ''}>Владение</label>
      </div>
      <div class="e-line">${pre('Заметка', inp(a, 'note', 'дальность, свойства, когда работает', 'Заметка'))}</div>
    </div>`;
    return sec('attacks', 'Атаки', 'Оружие из сумки считается само; свои атаки — ниже', html`
      ${auto.length ? html`<div class="e-auto">${auto.map((a) => html`<span class="e-auto-row">${ic('sword-01', 16)}<b>${a.name}</b><span>${a.hit} · ${a.dmg}</span><small>из надетого оружия</small></span>`)}</div>` : ''}
      <div class="e-rows">${own.map(row)}</div>
      ${own.length ? '' : html`<p class="e-empty">Своих атак нет. Добавьте когти, оружие из дома или удар волшебного посоха.</p>`}
      <button class="btn btn-ghost btn-sm e-add" data-op="add" data-list="attacks">${ic('plus-sign', 16)}Атака</button>`);
  }
  function magicSec() {
    const pools = slotList(draft), sources = draft.spellSources || [];
    const maxOf = (c) => pools.find((p) => p.circle === c && p.kind !== 'pact')?.max || '';
    const pact = pools.filter((p) => p.kind === 'pact');
    return sec('magic', 'Магия', 'Ячейки и чем колдует герой; сами заклинания — на листе', html`
      ${sources.length ? html`<div class="e-rows">${sources.map((s, i) => html`<div class="e-src"><span class="t"><b>${s.name || 'Источник магии'}</b><small>Чем колдует</small></span>${seg(`data-src-ab="${i}" data-ab`, [['int', 'ИНТ'], ['wis', 'МДР'], ['cha', 'ХАР']], s.ability)}</div>`)}</div>` : ''}
      ${caps('Ячейки заклинаний — сколько всего')}
      <div class="e-slots">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => html`<label class="e-slot"><small>${c} круг</small>${numIn(`data-slot="${c}"`, maxOf(c), { ph: '—', label: `Ячейки ${c} круга` })}</label>`)}</div>
      ${pact.length ? html`<p class="e-note">${ic('sparkles', 16)}<span>Магия договора: ${pact.map((p) => `${p.max} яч. ${p.circle} круга`).join(', ')} — восстанавливаются коротким отдыхом.</span></p>` : ''}
      <a class="btn btn-secondary btn-sm e-add" href="#/hero/${key}/magic">${ic('sparkles', 16)}Заклинания — на вкладке «Магия»</a>`);
  }
  function bagSec() {
    const items = itemList(draft), worn = wornItems(items, gear);
    const row = (x, i) => {
      const on = !!worn[i]?.equipped;
      return html`<div class="e-row e-item">
        <button class="e-wear ${on ? 'on' : ''}" data-op="equip" data-id="${x.id}" aria-pressed="${String(on)}" title="${on ? 'Надето — снять' : 'В рюкзаке — надеть'}">${ic(on ? 'shield-01' : 'backpack-01', 16)}<span>${on ? 'Надето' : 'В рюкзаке'}</span></button>
        <span class="input e-grow"><input data-item="inventoryItems" data-id="${x.id}" data-field="name" value="${itemName(x, gear)}" placeholder="Предмет" aria-label="Предмет"></span>
        ${numIn(`data-item="inventoryItems" data-id="${x.id}" data-field="quantity"`, x.quantity ?? 1, { suffix: 'шт', label: 'Количество' })}
        ${numIn(`data-item="inventoryItems" data-id="${x.id}" data-field="weight"`, x.weight ?? '', { suffix: 'фнт', ph: worn[i]?.g?.weight ?? '', label: 'Вес' })}
        <label class="check e-check"><input type="checkbox" data-item="inventoryItems" data-id="${x.id}" data-field="attuned" ${x.attuned ? raw('checked') : ''}>Настроен</label>
        ${drop('inventoryItems', x.id, itemName(x, gear))}
      </div>`;
    };
    return sec('bag', 'Сумка', 'Деньги и вещи; КД и атаки считаются по надетому', html`
      <div class="e-coins">${COINS.map(([id, short, name]) => html`<label class="e-coin c-${id}"><span class="e-coin-ic">${short}</span>${numIn(`data-f="coins.${id}"`, draft.coins?.[id] ?? 0, { label: `${name} монеты` })}</label>`)}</div>
      <div class="e-rows">${items.map(row)}</div>
      ${items.length ? '' : html`<p class="e-empty">Сумка пуста.</p>`}
      <button class="btn btn-ghost btn-sm e-add" data-op="add" data-list="inventoryItems">${ic('plus-sign', 16)}Предмет</button>`);
  }
  function featuresSec() {
    const list = featureList(draft);
    const row = (f) => html`<div class="e-row e-feat">
      <span class="input e-grow"><input data-item="featureEntries" data-id="${f.id}" data-field="name" value="${f.name || ''}" placeholder="Название — Ярость, Тёмное зрение" aria-label="Название умения"></span>
      <span class="input e-src-in"><input data-item="featureEntries" data-id="${f.id}" data-field="source" value="${f.source || ''}" placeholder="Откуда — класс, раса, черта" aria-label="Источник"></span>
      ${drop('featureEntries', f.id, f.name)}
      <span class="input area e-full"><textarea data-item="featureEntries" data-id="${f.id}" data-field="description" rows="2" placeholder="Что делает" aria-label="Текст умения">${f.description || featureText(f.ref) || ''}</textarea></span>
    </div>`;
    return sec('features', 'Умения и черты', 'Класс, раса, черты, дары мастера', html`<div class="e-rows">${list.map(row)}</div>
      ${list.length ? '' : html`<p class="e-empty">Умений пока нет.</p>`}
      <button class="btn btn-ghost btn-sm e-add" data-op="add" data-list="featureEntries">${ic('plus-sign', 16)}Умение или черта</button>`);
  }
  function profsSec(v) {
    const p = draft.proficiencies || {}, pv = v.proficiencies || {};
    const shownText = (raw0, ru) => (raw0 ? (ru && ru !== '—' ? ru : raw0) : '');
    return sec('profs', 'Владения', 'Языки, доспехи, оружие, инструменты', html`<div class="e-grid2">
      ${field('Языки', area('proficiencies.languages', shownText(p.languages, pv.languages), 'Общий, дварфийский', 2))}
      ${field('Доспехи, оружие, инструменты', area('proficiencies.tools', shownText(p.tools, pv.tools), 'Доспехи: лёгкие, средние\nОружие: простое\nИнструменты: воровские', 3))}
      ${p.weapons ? field('Оружие', area('proficiencies.weapons', shownText(p.weapons, pv.weaponsText), 'Простое, воинское', 2)) : ''}
    </div>`);
  }
  function personSec() {
    const pers = draft.personality || {}, off = st.server;
    return sec('person', 'Личность и заметки', off ? 'Черты характера сервер пока не хранит — заметки сохраняются' : 'Характер, внешность, история', html`
      ${off ? html`<p class="e-note warn">${ic('information-circle', 16)}<span>В кампании на сервере сохраняются только заметки. Черты характера, внешность и историю пока пишите туда.</span></p>` : ''}
      <div class="e-grid2">${PERSON.map(([k, label, ph]) => field(label, area(`personality.${k}`, pers[k], ph, 2, off)))}</div>
      ${field('Внешность', area('personality.appearance', pers.appearance, 'Рост, шрамы, во что одет', 2, off))}
      ${field('История', area('personality.backstory', pers.backstory, 'Откуда герой и что его ведёт', 4, off))}
      ${field('Заметки', area('notes', draft.notes, 'Имена, долги, обещания — всё, что не хочется забыть', 4))}`);
  }
  function preview(v) {
    const t = (k, val, sub = '') => html`<div class="e-pv-tile">${caps(k)}<b>${val}</b>${sub ? html`<small>${sub}</small>` : ''}</div>`;
    return html`<div class="e-pv">
      <div class="e-pv-head"><img src="${v.portrait}" alt=""><span><b>${v.name}</b><small>${v.fullTitle || v.summary}</small></span></div>
      <div class="e-pv-tiles">${t('КД', v.vitals.ac.value)}${t('Хиты', v.vitals.hp.max, `сейчас ${v.vitals.hp.now}`)}${t('Иниц.', v.vitals.init)}${t('Скорость', v.vitals.speed)}${t('Мастерство', v.vitals.prof)}${t('Восприятие', v.vitals.passive.perception, 'пассивное')}</div>
      <div class="h-live-stats">${v.abilities.map((a) => miniStat({ short: a.short, mod: a.mod, score: a.score }))}</div>
      <div class="e-pv-changed" data-changed></div>
    </div>`;
  }

  // ——— живое обновление без перерисовки (фокус в поле не теряется) ———
  function refresh() {
    const v = editPreview(key, draft);
    if (!v) return;
    const r = readCharacter({ ...draft });
    const set = (k, val) => root.querySelectorAll(`[data-calc="${k}"]`).forEach((n) => { n.textContent = val; });
    for (const a of ABILITIES) { set(`mod.${a.id}`, signed(abMod(draft.stats?.[a.id]))); set(`save.${a.id}`, signed(r.saves[a.id]?.value)); }
    for (const k of SKILLS) set(`skill.${k.id}`, signed(r.skills[k.id]?.value));
    const autoV = editPreview(key, { ...draft, ac: null });
    set('acAuto', autoV?.vitals.ac.value ?? '—'); set('acNote', autoV?.explain?.ac || '');
    set('initAuto', signed(abMod(draft.stats?.dex)));
    const pv = root.querySelector('[data-preview]');
    if (pv) pv.innerHTML = String(preview(v));
    root.querySelectorAll('[data-pv-name]').forEach((n) => { n.textContent = v.name; });
    const dirty = changedSections(base, draft);
    root.querySelectorAll('.e-nav [data-goto]').forEach((b) => b.classList.toggle('dirty', dirty.includes(b.dataset.goto)));
    const names = EDIT_SECTIONS.filter((x) => dirty.includes(x.id)).map((x) => x.name);
    const hint = root.querySelector('[data-dirty]');
    if (hint) hint.textContent = names.length ? `Изменено: ${names.join(', ')}` : 'Пока без изменений';
    const ch = root.querySelector('[data-changed]');
    if (ch) ch.innerHTML = String(names.length ? html`${caps('Изменено')}<div>${names.map((n) => html`<span class="chip chip-md chip-accent">${n}</span>`)}</div>` : html`<small class="muted">Правки видны здесь сразу. Сохраняются кнопкой «Сохранить».</small>`);
  }
  // Оглавление подсвечивает раздел, который сейчас на экране (верх раздела выше трети экрана).
  let spyOff = null;
  function spy() {
    spyOff?.();
    const sc = scroller();
    if (!sc) return;
    let raf = 0, last = '';
    const mark = () => {
      raf = 0;
      const line = sc.getBoundingClientRect().top + sc.clientHeight * 0.3;
      const secs = [...root.querySelectorAll('.e-sec')];
      const atEnd = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4;
      const cur = atEnd ? secs.at(-1) : secs.filter((x) => x.getBoundingClientRect().top <= line).at(-1) || secs[0];
      const id = cur?.dataset.sec || '';
      if (id === last) return;
      last = id;
      root.querySelectorAll('.e-nav [data-goto]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.goto === id)));
      const btn = root.querySelector(`.e-nav [data-goto="${id}"]`), nav = btn?.parentElement;
      if (nav && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: btn.offsetLeft - nav.clientWidth / 2 + btn.offsetWidth / 2, behavior: 'smooth' });
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(mark); };
    sc.addEventListener('scroll', onScroll, { passive: true });
    mark();
    spyOff = () => { sc.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }

  const op = (name, p, { redraw = false } = {}) => { editOp(draft, name, p, ctx); persist(); if (redraw) render(); else refresh(); };
  // ——— поля ———
  L('input', '[data-f]', (e, t) => op('set', { path: t.dataset.f, value: t.value }));
  // Числа после ввода приводим к записанному (пустое — как было, 31 → 30).
  L('change', '[data-f]', (e, t) => { if (/^(stats\.|coins\.|hpMax|speed|darkvision)/.test(t.dataset.f)) { const v = at(draft, t.dataset.f); t.value = v ?? ''; } });
  L('change', 'select[data-class]', (e, t) => op('class', { i: t.dataset.class, field: t.dataset.field, value: t.value }, { redraw: true }));
  L('input', 'input[data-class]', (e, t) => op('class', { i: t.dataset.class, field: t.dataset.field, value: t.value }));
  L('input', 'input[data-item]:not([type="checkbox"]), textarea[data-item]', (e, t) => op('item', { list: t.dataset.item, id: t.dataset.id, field: t.dataset.field, value: t.value }));
  L('change', 'select[data-item]', (e, t) => op('item', { list: t.dataset.item, id: t.dataset.id, field: t.dataset.field, value: t.value }, { redraw: true }));
  L('change', 'input[type="checkbox"][data-item]', (e, t) => op('item', { list: t.dataset.item, id: t.dataset.id, field: t.dataset.field, value: t.checked }));
  L('input', '[data-slot]', (e, t) => op('slots', { circle: t.dataset.slot, value: t.value }));
  L('input', '[data-ac]', (e, t) => op('acMode', { manual: true, value: t.value }));
  L('input', '[data-init]', (e, t) => op('initValue', { value: t.value }));
  L('click', '[data-ac-mode]', (e, b) => op('acMode', { manual: b.dataset.acMode === 'manual', value: editPreview(key, { ...draft, ac: null })?.vitals.ac.value }, { redraw: true }));
  L('click', '[data-init-mode]', (e, b) => op('initMode', { manual: b.dataset.initMode === 'manual' }, { redraw: true }));
  L('click', '[data-src-ab]', (e, b) => op('srcAbility', { i: b.dataset.srcAb, value: b.dataset.ab }, { redraw: true }));
  // ——— кнопки ———
  L('click', '[data-op]', (e, b) => {
    const d = b.dataset;
    if (d.op === 'step') {
      op('step', { id: d.id, by: Number(d.by) });
      const inp = root.querySelector(`[data-f="stats.${d.id}"]`); if (inp) inp.value = draft.stats?.[d.id] ?? 10;
      return;
    }
    if (d.op === 'prof') { op('prof', { kind: d.kind, id: d.id }, { redraw: true }); return; }
    if (d.op === 'classLv') { const c = classList(draft)[Number(d.i)]; op('class', { i: d.i, field: 'levels', value: (Number(c?.levels) || 1) + Number(d.by) }, { redraw: true }); return; }
    if (d.op === 'addClass' || d.op === 'dropClass') { op(d.op, { i: d.i }, { redraw: true }); return; }
    if (d.op === 'equip') { op('equip', { id: d.id }, { redraw: true }); return; }
    if (d.op === 'drop') { op('drop', { list: d.list, id: d.id }, { redraw: true }); return; }
    if (d.op === 'add') {
      op('add', { list: d.list }, { redraw: true });
      // Новая строка — сразу в поле названия.
      const rows = root.querySelectorAll(`[data-item="${d.list}"][data-field="name"]`); const last = rows[rows.length - 1];
      last?.focus(); last?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });
  L('click', '[data-goto]', (e, b) => {
    const t = root.querySelector(`#e-${b.dataset.goto}`), sc = scroller();
    if (t && sc) sc.scrollTo({ top: t.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - (window.innerWidth < 900 ? 72 : 20), behavior: 'smooth' });
  });
  L('click', '[data-pic]', () => import('./sheet.js').then((m) => m.portraitModal(editState(key)?.v || st.v)));
  L('click', '[data-reset]', () => { dropSession(key); ({ base, draft } = startEdit(editState(key)?.data || st.data)); persist(); shown = { restored: false }; render(); });
  const save = () => {
    if (!heroActions.saveEdit({ heroId: key, base, draft })) return;
    dropSession(key);
    location.hash = `#/hero/${key}`;
  };
  L('click', '[data-save]', save);
  L('click', '[data-cancel]', async () => {
    if (changedSections(base, draft).length && !(await confirmDialog({ title: 'Выйти без сохранения?', body: 'Правки этого героя пропадут.', ok: 'Выйти', danger: true }))) return;
    dropSession(key);
    location.hash = `#/hero/${key}`;
  });
  // Ctrl/⌘+S — сохранить; портрет меняется сразу (окно портрета) — подтягиваем его в черновик и просмотр.
  const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } };
  const onHero = () => {
    const now = editState(key);
    if (!now || now.data.portrait === draft.portrait) return;
    base.portrait = now.data.portrait; draft.portrait = now.data.portrait; persist();
    root.querySelectorAll('[data-pv-pic]').forEach((n) => { n.src = now.v.portrait; });
    refresh();
  };
  document.addEventListener('keydown', onKey);
  window.addEventListener('hero:changed', onHero);
  render();
  return () => { spyOff?.(); document.removeEventListener('keydown', onKey); window.removeEventListener('hero:changed', onHero); };
}
