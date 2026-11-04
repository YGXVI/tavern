// Лист героя (базовый шаблон) и блок характеристик существа. Детали листа — следующая задача (TASK-004).
import { esc, fmtMod, el } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { srcOf } from '../../core/assets.js';
import { characterOf, updateCampaign, ownerOfCharacter, isMasterOf, tokenStats, monsterOf } from '../../core/campaign.js';
import { ABILITIES, SKILLS, mod, profBonus, CONDITIONS, conditionById } from '../../data/rules.js';
import { doRoll, parseFormula, poolVis } from './dice.js';
import { isDead, isStable } from '../../rules/attack.js';

let drawer = null;
let state = { kind: null, id: null, tab: 'main' };

export function closeSheet() { flushSheet(); drawer?.remove(); drawer = null; shown = ''; state = { kind: null, id: null, tab: 'main' }; }
export const sheetOpenFor = () => state;

export function openCharacterSheet(ctx, chId, tab) {
  state = { kind: 'character', id: chId, tab: tab || (state.id === chId ? state.tab : 'main') };
  renderSheet(ctx);
}

export function openStatblock(ctx, tokenId) {
  state = { kind: 'monster', id: tokenId, tab: 'main' };
  renderSheet(ctx);
}

export function refreshSheet(ctx) { if (drawer) renderSheet(ctx, true); }

function canEdit(ctx, ch) {
  return isMasterOf(ctx.c, ctx.userId) || ch.ownerId === ctx.userId;
}

function ensureDrawer(ctx) {
  if (drawer && ctx.root.contains(drawer)) return drawer;
  drawer = el('<aside class="sheet-drawer panel" aria-label="Лист"></aside>');
  ctx.root.append(drawer);
  drawer.addEventListener('click', (e) => onClick(ctx, e));
  drawer.addEventListener('input', (e) => onInput(ctx, e));
  drawer.addEventListener('change', (e) => onInput(ctx, e, true));
  return drawer;
}

let shown = '', lastHtml = ''; // что сейчас в ящике: тот же лист и вкладка — сохраняем прокрутку
function renderSheet(ctx, soft = false) {
  const d = ensureDrawer(ctx);
  // Не перерисовываем поле, в котором сейчас печатают.
  if (soft && d.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  let html;
  if (state.kind === 'character') {
    const ch = characterOf(ctx.c, state.id);
    if (!ch) { closeSheet(); return; }
    html = characterHTML(ctx, ch);
  } else {
    const t = ctx.scene?.tokens.find((x) => x.id === state.id);
    if (!t) { closeSheet(); return; }
    html = monsterHTML(ctx, t);
  }
  // Любое изменение кампании (чужой ход, бросок) перерисовывает лист — без этого он прыгал бы к началу.
  const key = `${state.kind}:${state.id}:${state.tab}`;
  const same = key === shown;
  if (same && lastHtml === html && d.childElementCount) return;
  const top = same ? d.querySelector('.sheet-body')?.scrollTop || 0 : 0;
  const left = d.querySelector('.sheet-tabs')?.scrollLeft || 0;
  d.innerHTML = html;
  lastHtml = html;
  shown = key;
  const body = d.querySelector('.sheet-body'); if (body && top) body.scrollTop = top;
  const tabs = d.querySelector('.sheet-tabs'); if (tabs && left) tabs.scrollLeft = left;
}

const TABS = [['main', 'Основное'], ['skills', 'Навыки'], ['combat', 'Бой'], ['spells', 'Заклинания'], ['gear', 'Снаряжение'], ['notes', 'Заметки']];

function characterHTML(ctx, ch) {
  const edit = canEdit(ctx, ch);
  const owner = ownerOfCharacter(ctx.c, ch);
  const pb = profBonus(ch.level);
  const ro = edit ? '' : 'readonly';
  const num = (f, v, w = '') => `<input class="sheet-num ${w}" type="number" data-f="${f}" value="${esc(v)}" ${ro}>`;
  const hpFrac = Math.max(0, Math.min(1, ch.hp / Math.max(1, ch.hpMax)));
  const passive = 10 + mod(ch.stats.wis) + (ch.skills.includes('perception') ? pb : 0);
  let body = '';
  if (state.tab === 'main') {
    body = `<div class="abilities">${ABILITIES.map((a) => {
      const m = mod(ch.stats[a.id]);
      const save = m + (ch.saves.includes(a.id) ? pb : 0);
      return `<div class="ability"><span class="ab-name">${a.short}</span><button class="ab-mod" data-roll="check" data-ab="${a.id}" data-tip="Проверка ${AB_NAMES[a.id] || a.name}">${fmtMod(m)}</button>${num(`stats.${a.id}`, ch.stats[a.id], 'ab-score')}<button class="ab-save ${ch.saves.includes(a.id) ? 'prof' : ''}" data-roll="save" data-ab="${a.id}" data-tip="Спасбросок ${AB_NAMES[a.id] || a.name}">спас ${fmtMod(save)}</button></div>`;
    }).join('')}</div>
    <div class="sheet-grid3"><div class="stat-box"><small>Пассивное Восприятие</small><b>${passive}</b></div><div class="stat-box"><small>Бонус мастерства</small><b>${fmtMod(pb)}</b></div><div class="stat-box"><small>Тёмное зрение</small><b>${ch.darkvision ? `${ch.darkvision} фт` : '—'}</b></div></div>
    <div class="sheet-sect"><div class="section-label">Спасброски от смерти</div><div class="death-row"><span class="t-sm muted">Успехи</span>${[0, 1, 2].map((i) => `<button class="pip ok ${ch.deathSaves.s > i ? 'on' : ''}" data-ds="s" data-i="${i}" ${edit ? '' : 'disabled'}></button>`).join('')}<span class="t-sm muted" style="margin-left:12px">Провалы</span>${[0, 1, 2].map((i) => `<button class="pip bad ${ch.deathSaves.f > i ? 'on' : ''}" data-ds="f" data-i="${i}" ${edit ? '' : 'disabled'}></button>`).join('')}<span class="spacer"></span>${isDead(ch.deathSaves) ? `<span class="chip chip-negative">${icon('skull', 12)}Погиб</span>` : isStable(ch.deathSaves) ? `<span class="chip chip-success">${icon('heart-check', 12)}Стабилен</span>` : ch.hp <= 0 ? `<button class="btn btn-sm btn-secondary" data-roll="death">${icon('dice-faces-06', 14)}Бросить</button>` : '<span class="t-xs tertiary">бросают при 0 хитов</span>'}</div></div>
    <div class="sheet-sect"><div class="section-label">Состояния</div><div class="cond-chips">${CONDITIONS.map((c) => `<button class="chip ${ch.conditions.includes(c.id) ? 'chip-accent' : ''}" data-cond="${c.id}" ${edit || ctx.isMaster ? '' : 'disabled'} data-tip="${esc(c.text)}">${icon(c.icon, 12)}${esc(c.name)}</button>`).join('')}</div></div>`;
  } else if (state.tab === 'skills') {
    body = `<div class="skills">${SKILLS.map((s) => {
      const prof = ch.skills.includes(s.id);
      const v = mod(ch.stats[s.ab]) + (prof ? pb : 0);
      const ab = ABILITIES.find((a) => a.id === s.ab);
      return `<div class="skill-row"><button class="prof-dot ${prof ? 'on' : ''}" data-skillprof="${s.id}" ${edit ? '' : 'disabled'} aria-label="Владение"></button><span class="grow">${esc(s.name)} <small class="tertiary">${ab.short}</small></span><button class="skill-mod" data-roll="skill" data-skill="${s.id}">${fmtMod(v)}</button></div>`;
    }).join('')}</div>`;
  } else if (state.tab === 'combat') {
    body = `<div class="attacks">${ch.attacks.map((a, i) => `<div class="attack-row ${edit && state.editAttack === i ? 'editing' : ''}"><div class="grow"><b>${esc(a.name)}</b><small class="muted">${esc(a.type || '')}${a.note ? ` · ${esc(a.note)}` : ''}</small></div><button class="btn btn-sm btn-secondary" data-roll="attack" data-i="${i}">${Number(a.bonus) ? `${esc(fmtMod(Number(a.bonus)))} к попаданию` : 'Попадание'}</button><button class="btn btn-sm btn-secondary" data-roll="damage" data-i="${i}">${esc(a.damage)}</button>${edit ? `<button class="icon-btn icon-btn-xs" data-act-sheet="edit-attack" data-i="${i}" aria-expanded="${state.editAttack === i}" data-tip="Изменить" aria-label="Изменить атаку «${esc(a.name)}»">${icon('pencil-edit-02', 14)}</button>` : ''}</div>
      ${edit && state.editAttack === i ? `<div class="attack-edit"><label class="field"><span class="label">Название</span><input class="sheet-line" data-f="attacks.${i}.name" value="${esc(a.name)}"></label><label class="field"><span class="label">К попаданию</span><input class="sheet-line" type="number" data-f="attacks.${i}.bonus" value="${esc(Number(a.bonus) || 0)}"></label><label class="field"><span class="label">Урон</span><input class="sheet-line" data-f="attacks.${i}.damage" value="${esc(a.damage)}" placeholder="1d8+3"></label><label class="field"><span class="label">Тип</span><input class="sheet-line" data-f="attacks.${i}.type" value="${esc(a.type || '')}" placeholder="рубящий"></label><button class="btn btn-sm btn-ghost danger" data-act-sheet="del-attack" data-i="${i}">${icon('delete-02', 14)}Удалить атаку</button></div>` : ''}`).join('') || '<p class="muted t-sm">Атак пока нет.</p>'}</div>
      ${edit ? `<button class="btn btn-sm btn-ghost" data-act-sheet="add-attack">${icon('plus-sign', 14)}Добавить атаку</button>` : ''}
      <div class="sheet-sect"><div class="section-label">Особенности</div><textarea class="sheet-text" data-f="features" rows="5" ${ro}>${esc(ch.features)}</textarea></div>`;
  } else if (state.tab === 'spells') {
    const levels = Object.keys(ch.slots || {}).sort();
    body = `${levels.length ? `<div class="slots">${levels.map((lv) => { const s = ch.slots[lv]; return `<div class="slot-row"><span class="t-sm muted">${lv} круг</span>${Array.from({ length: s.max }, (_, i) => `<button class="pip ${i < s.max - s.used ? 'on' : ''}" data-slot="${lv}" data-i="${i}" ${edit ? '' : 'disabled'}></button>`).join('')}<span class="t-sm tertiary">${s.max - s.used}/${s.max}</span></div>`; }).join('')}</div>` : '<p class="muted t-sm">Ячеек заклинаний нет.</p>'}
      <div class="sheet-sect"><div class="section-label">Заклинания</div><textarea class="sheet-text" data-f="spells" rows="9" ${ro}>${esc(ch.spells)}</textarea></div>`;
  } else if (state.tab === 'gear') {
    body = `<div class="sheet-sect"><div class="section-label">Снаряжение и деньги</div><textarea class="sheet-text" data-f="inventory" rows="10" ${ro}>${esc(ch.inventory)}</textarea></div>`;
  } else {
    body = `<div class="sheet-sect"><div class="section-label">Предыстория и характер</div><input class="sheet-line" data-f="background" placeholder="Предыстория" value="${esc(ch.background)}" ${ro}><input class="sheet-line" data-f="alignment" placeholder="Мировоззрение" value="${esc(ch.alignment)}" ${ro}></div>
      <div class="sheet-sect"><div class="section-label">Заметки</div><textarea class="sheet-text" data-f="notes" rows="10" ${ro} placeholder="Что важно помнить герою">${esc(ch.notes)}</textarea></div>`;
  }
  return `<header class="sheet-head">
      <span class="sheet-portrait" style="background-image:url(&quot;${esc(srcOf(ch.portrait))}&quot;)"></span>
      <div class="titles grow"><input class="sheet-name" data-f="name" value="${esc(ch.name)}" ${ro}><div class="t-sm muted">${esc(ch.className)} · <input class="sheet-num inline" type="number" min="1" max="20" data-f="level" value="${esc(ch.level)}" ${ro}> ур. · ${esc(ch.raceName)}</div><div class="t-xs tertiary">${owner ? `Играет ${esc(owner.name)}` : 'Без игрока'}${edit ? '' : ' · только просмотр'}</div></div>
      <button class="icon-btn icon-btn-sm" data-close-sheet aria-label="Закрыть">${icon('cancel-01', 18)}</button>
    </header>
    <div class="sheet-vitals">
      <button class="vital hp" data-act-sheet="hp"><small>Хиты</small><b>${esc(ch.hp)}<span>/${esc(ch.hpMax)}</span></b>${ch.tempHp ? `<em>+${esc(ch.tempHp)} врем.</em>` : ''}<span class="hp-bar ${hpFrac > 0.5 ? 'ok' : ''}"><i style="width:${hpFrac * 100}%"></i></span></button>
      <label class="vital"><small>КД</small>${num('ac', ch.ac)}</label>
      <button class="vital" data-roll="init"><small>Инициатива</small><b>${fmtMod(initOf(ch))}</b></button>
      <label class="vital"><small>Скорость</small><span class="row">${num('speed', ch.speed)}<span class="t-xs muted">фт</span></span></label>
    </div>
    <nav class="sheet-tabs">${TABS.map(([id, n]) => `<button class="tab" data-tab="${id}" aria-selected="${state.tab === id}">${n}</button>`).join('')}</nav>
    <div class="sheet-body scroll">${body}${edit ? '' : '<p class="t-xs tertiary" style="margin-top:12px">Править лист может владелец героя и мастер.</p>'}</div>`;
}

// Статблок существа. Ручные существа: особенности — строки; SRD (TASK-083): { name, en, desc } с английским текстом SRD.
const MLISTS = { actions: 'Действия', bonusActions: 'Бонусные действия', reactions: 'Реакции', legendary: 'Легендарные действия' };
const openDesc = new Set(); // раскрытые описания: «monsterId:list:i» — переживают перерисовку листа

function traitHTML(x) {
  if (typeof x === 'string') return `<p class="t-para trait">${esc(x)}</p>`;
  return `<p class="t-para trait"><b>${esc(x.name)}.</b> <span lang="en">${esc(x.desc)}</span></p>`;
}

// Подпись способности своего существа (TASK-179): урон и спасбросок по-русски, а не служебной строкой копии.
const AB_NAMES = { str: 'Силы', dex: 'Ловкости', con: 'Телосложения', int: 'Интеллекта', wis: 'Мудрости', cha: 'Харизмы' };
function libMeta(a) {
  const dmg = (a.damageComponents || []).filter((d) => d.dice || d.type).map((d) => [d.dice, d.type].filter(Boolean).join(' '));
  const sv = a.save ? `Спасбросок ${AB_NAMES[a.save.ability] || a.save.ability}${a.save.dc != null ? ` СЛ ${a.save.dc}` : ''}${a.save.who === 'self' ? ', бросает само существо' : ''}` : '';
  return [...dmg, sv, a.recharge ? `перезарядка ${a.recharge}` : ''].filter(Boolean).join(' · ');
}

function actionHTML(m, list, a, i) {
  const meta = String(m.id).startsWith('lib:') ? libMeta(a) : [a.type, a.note].filter(Boolean).join(' · ');
  const rolls = (a.bonus ? `<button class="btn btn-sm btn-secondary" data-roll="mattack" data-list="${list}" data-i="${i}" aria-label="Атака: ${esc(a.name)}">${fmtMod(a.bonus)}</button>` : '')
    + (a.damage ? parseFormula(a.damage) ? `<button class="btn btn-sm btn-secondary" data-roll="mdamage" data-list="${list}" data-i="${i}" aria-label="Урон: ${esc(a.name)}">${esc(a.damage)}</button>`
      : `<span class="chip" title="Урон без броска">${esc(a.damage)} урон</span>` : '');
  const k = `${m.id}:${list}:${i}`;
  // Описание без бросков — единственное, что есть у действия: показываем целиком; у атак — две строки, тап раскрывает.
  const desc = a.desc ? `<p class="atk-desc ${!rolls || openDesc.has(k) ? 'open' : ''}" lang="en" ${rolls ? `data-desc="${esc(k)}" title="Показать целиком"` : ''}>${esc(a.desc)}</p>` : '';
  return `<div class="attack-row ${desc ? 'has-desc' : ''}"><div class="grow"><b>${esc(a.name)}</b>${meta ? `<small class="muted">${esc(meta)}</small>` : ''}${desc}</div>${rolls}</div>`;
}

function monsterHTML(ctx, t) {
  const st = tokenStats(ctx.c, t);
  const m = monsterOf(ctx.c, t.monsterId);
  const isM = ctx.isMaster || ctx.owns(t); // свой призыв владелец видит целиком (TASK-183)
  const lib = String(t.monsterId || '').startsWith('lib:');
  const copyOwner = lib ? ctx.c.creatures?.[t.monsterId.slice(4)]?.ownerId : null;
  if (!m) return `<header class="sheet-head"><div class="titles grow"><b>${esc(t.name)}</b>${t.monsterId?.startsWith('srd:') ? '<div class="t-sm muted">Бестиарий загружается…</div>' : ''}</div><button class="icon-btn icon-btn-sm" data-close-sheet>${icon('cancel-01', 18)}</button></header>`;
  const saves = m.saves ? ABILITIES.filter((a) => m.saves[a.id] != null).map((a) => `${a.short} ${fmtMod(m.saves[a.id])}`).join(', ') : '';
  return `<header class="sheet-head">
      <span class="sheet-portrait foe" style="background-image:url(&quot;${esc(srcOf(t.img))}&quot;)"></span>
      <div class="titles grow"><b class="t-lg">${esc(t.name)}</b><div class="t-sm muted">${esc(m.name)}${m.en && isM ? ` <span lang="en">(${esc(m.en)})</span>` : ''}${m.type ? ` · ${esc(m.type)}` : ''}${m.cr != null ? ` · КО ${esc(m.cr)}` : ''}</div></div>
      <button class="icon-btn icon-btn-sm" data-close-sheet aria-label="Закрыть">${icon('cancel-01', 18)}</button>
    </header>
    <div class="sheet-vitals">
      <div class="vital hp"><small>Хиты</small><b>${isM ? `${esc(st.hp)}<span>/${esc(st.hpMax)}</span>` : '?'}</b><small class="tertiary">${esc(m.hpDice)}</small></div>
      <div class="vital"><small>КД</small><b>${isM ? m.ac : '?'}</b></div>
      <div class="vital"><small>Скорость</small><b>${m.speed ?? '—'}<span> фт</span></b></div>
      <div class="vital"><small>Иниц.</small><b>${fmtMod(m.init ?? 0)}</b></div>
    </div>
    <div class="sheet-body scroll">
      ${isM ? `<div class="abilities">${ABILITIES.map((a) => `<div class="ability"><span class="ab-name">${a.short}</span><button class="ab-mod" data-roll="mcheck" data-ab="${a.id}">${fmtMod(mod(m.stats[a.id]))}</button><span class="ab-score">${m.stats[a.id] ?? '—'}</span></div>`).join('')}</div>
      ${saves ? `<p class="t-sm muted" style="margin:12px 0 0">Спасброски: ${saves}</p>` : ''}
      ${m.senses ? `<p class="t-sm muted" style="margin:12px 0">${esc(m.senses)}</p>` : ''}
      ${m.traits.map(traitHTML).join('')}
      ${Object.entries(MLISTS).filter(([list]) => m[list]?.length).map(([list, title]) => `<div class="section-label" style="margin:16px 0 8px">${title}</div>
      ${list === 'reactions' ? m.reactions.map(traitHTML).join('') : `<div class="attacks">${m[list].map((a, i) => actionHTML(m, list, a, i)).join('')}</div>`}`).join('')}
      <p class="t-xs tertiary" style="margin-top:16px">${lib ? `Своё существо — копия из ${copyOwner === ctx.userId ? 'вашей библиотеки' : copyOwner ? 'библиотеки игрока' : 'библиотеки мастера'} в этой кампании${m.provenance ? '; основа — SRD 5.1 (CC BY 4.0)' : ''}.` : m.srd ? 'Числа и английские описания — SRD 5.1 (CC BY 4.0), русские названия — наши.' : 'Числа — SRD 5.1 (CC BY 4.0).'}</p>` : '<p class="muted t-para">Подробности о существе знает только мастер.</p>'}
    </div>`;
}

function setPath(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (const p of parts.slice(0, -1)) o = o[p];
  o[parts.at(-1)] = value;
}

/** Инициатива идёт за Ловкостью: прочие бонусы (черта «Бдительный» и т. п.) сохраняются. */
const initOf = (ch) => ch.initBonus ?? mod(ch.stats.dex);
function writeField(c, chId, f, v) {
  const ch = c.characters.find((x) => x.id === chId); if (!ch) return;
  if (f === 'stats.dex') ch.initBonus = initOf(ch) - mod(ch.stats.dex) + mod(v);
  setPath(ch, f, v);
}
// Своя задержка у каждого поля: правка одного и сразу другого не теряет первую (раньше таймер был общий).
const timers = new Map();
function saveText(ctx, chId, f, v) {
  const k = `${chId}|${f}`;
  clearTimeout(timers.get(k)?.t);
  const run = () => { timers.delete(k); updateCampaign(ctx.cid, (c) => writeField(c, chId, f, v)); };
  timers.set(k, { t: setTimeout(run, 400), run });
}
/** Дописать отложенные правки сразу (лист закрывают или уходят со стола). */
export function flushSheet() { for (const { t, run } of [...timers.values()]) { clearTimeout(t); run(); } }

function onInput(ctx, e, final = false) {
  const f = e.target.dataset.f;
  if (!f || state.kind !== 'character') return;
  const ch = characterOf(ctx.c, state.id);
  if (!ch || !canEdit(ctx, ch)) return;
  let v = e.target.value;
  if (e.target.type === 'number') {
    if (v.trim() === '') return; // пустое поле — не ноль: ничего не пишем, пока не впишут число
    v = Number(v); if (!Number.isFinite(v)) return;
    if (f === 'level') v = Math.min(20, Math.max(1, Math.round(v)));
    if (f.startsWith('stats.')) v = Math.min(30, Math.max(1, Math.round(v)));
  }
  if (e.target.type === 'number' && !final) return;
  saveText(ctx, ch.id, f, v);
  if (f === 'level') setTimeout(() => updateCampaign(ctx.cid, (c) => { const x = c.characters.find((y) => y.id === ch.id); if (x) x.profBonus = profBonus(x.level); }), 450);
}

function onClick(ctx, e) {
  if (e.target.closest('[data-close-sheet]')) { closeSheet(); return; }
  const tab = e.target.closest('[data-tab]');
  if (tab) { state.tab = tab.dataset.tab; renderSheet(ctx); return; }
  const rollBtn = e.target.closest('[data-roll]');
  if (rollBtn) { sheetRoll(ctx, rollBtn); return; }
  const desc = e.target.closest('[data-desc]');
  if (desc) { const k = desc.dataset.desc; if (openDesc.has(k)) openDesc.delete(k); else openDesc.add(k); desc.classList.toggle('open', openDesc.has(k)); return; }
  if (state.kind !== 'character') return;
  const ch = characterOf(ctx.c, state.id);
  if (!ch) return;
  const edit = canEdit(ctx, ch);
  const upd = (fn) => updateCampaign(ctx.cid, (c) => { const x = c.characters.find((y) => y.id === ch.id); if (x) fn(x); });
  const cond = e.target.closest('[data-cond]');
  if (cond && (edit || ctx.isMaster)) { const id = cond.dataset.cond; upd((x) => { x.conditions = x.conditions.includes(id) ? x.conditions.filter((q) => q !== id) : [...x.conditions, id]; }); return; }
  if (!edit) return;
  const ds = e.target.closest('[data-ds]');
  if (ds) { const k = ds.dataset.ds, i = Number(ds.dataset.i); upd((x) => { x.deathSaves[k] = x.deathSaves[k] > i ? i : i + 1; }); return; }
  const sp = e.target.closest('[data-skillprof]');
  if (sp) { const id = sp.dataset.skillprof; upd((x) => { x.skills = x.skills.includes(id) ? x.skills.filter((q) => q !== id) : [...x.skills, id]; }); return; }
  const slot = e.target.closest('[data-slot]');
  if (slot) { const lv = slot.dataset.slot, i = Number(slot.dataset.i); upd((x) => { const s = x.slots[lv]; const avail = s.max - s.used; s.used = i < avail ? s.max - i : s.max - i - 1; s.used = Math.max(0, Math.min(s.max, s.used)); }); return; }
  const act = e.target.closest('[data-act-sheet]')?.dataset.actSheet;
  if (act === 'add-attack') { state.editAttack = ch.attacks.length; upd((x) => x.attacks.push({ name: 'Новая атака', bonus: pbAttack(x), damage: '1d6', type: 'рубящий' })); }
  if (act === 'edit-attack') { const i = Number(e.target.closest('[data-i]').dataset.i); state.editAttack = state.editAttack === i ? null : i; renderSheet(ctx); }
  if (act === 'del-attack') { const i = Number(e.target.closest('[data-i]').dataset.i); state.editAttack = null; upd((x) => { x.attacks.splice(i, 1); }); }
  if (act === 'hp') { const t = ctx.scene?.tokens.find((q) => q.characterId === ch.id); if (t) ctx.panels.hpEditor(t.id, e.target.closest('[data-act-sheet]')); }
}

function pbAttack(x) { return mod(Math.max(x.stats.str, x.stats.dex)) + profBonus(x.level); }

function sheetRoll(ctx, b) {
  const kind = b.dataset.roll;
  if (state.kind === 'monster') {
    const t = ctx.scene.tokens.find((x) => x.id === state.id);
    const m = monsterOf(ctx.c, t?.monsterId);
    if (!m) return;
    const vis = poolVis(ctx, !!t?.hidden);
    const who = ctx.nameOf ? ctx.nameOf(t) : t.name;
    if (kind === 'mcheck') { const ab = ABILITIES.find((a) => a.id === b.dataset.ab); doRoll(ctx, { label: `${who}: проверка ${AB_NAMES[ab.id] || ab.name}`, dice: { 20: 1 }, mod: mod(m.stats[ab.id]), vis }); }
    const a = (m[b.dataset.list] || m.actions)[Number(b.dataset.i)];
    if (kind === 'mattack' && a) doRoll(ctx, { label: `${who}: ${a.name}`, dice: { 20: 1 }, mod: a.bonus, kind: 'attack', vis });
    if (kind === 'mdamage' && a) { const f = parseFormula(a.damage); if (f) doRoll(ctx, { label: `${who}: ${a.name} — урон${a.type ? ` (${a.type})` : ''}`, ...f, vis }); }
    return;
  }
  const ch = characterOf(ctx.c, state.id);
  if (!ch) return;
  const pb = profBonus(ch.level);
  const ab = ABILITIES.find((a) => a.id === b.dataset.ab);
  const vis = poolVis(ctx);
  if (kind === 'check') doRoll(ctx, { label: `${ch.name}: проверка ${AB_NAMES[ab.id] || ab.name}`, dice: { 20: 1 }, mod: mod(ch.stats[ab.id]), vis });
  if (kind === 'save') doRoll(ctx, { label: `${ch.name}: спасбросок ${AB_NAMES[ab.id] || ab.name}`, dice: { 20: 1 }, mod: mod(ch.stats[ab.id]) + (ch.saves.includes(ab.id) ? pb : 0), kind: 'save', vis });
  if (kind === 'skill') { const s = SKILLS.find((x) => x.id === b.dataset.skill); doRoll(ctx, { label: `${ch.name}: ${s.name}`, dice: { 20: 1 }, mod: mod(ch.stats[s.ab]) + (ch.skills.includes(s.id) ? pb : 0), vis }); }
  if (kind === 'init') doRoll(ctx, { label: `${ch.name}: инициатива`, dice: { 20: 1 }, mod: initOf(ch), vis });
  if (kind === 'attack') { const a = ch.attacks[Number(b.dataset.i)]; doRoll(ctx, { label: `${ch.name}: ${a.name}`, dice: { 20: 1 }, mod: Number(a.bonus) || 0, kind: 'attack', vis }); }
  if (kind === 'damage') { const a = ch.attacks[Number(b.dataset.i)]; const f = parseFormula(a.damage); if (f) doRoll(ctx, { label: `${ch.name}: урон ${a.name}`, ...f, vis }); else ctx.toast({ title: 'Не понимаю формулу урона', body: a.damage, icon: 'alert-circle' }); }
  if (kind === 'death') ctx.panels.deathSave(ch.id);
}

export { conditionById };
