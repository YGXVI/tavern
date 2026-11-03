// Вкладка «Существа» на главной (TASK-175, план TASK-097 п. 4.1): личная библиотека — список, конструктор,
// копия из бестиария SRD, удаление. Данные — готовый API core/library.js (#150): песочница или таблица на сервере.
// Библиотеку видит и правит только её хозяин; за столом свои существа появятся следующей порцией (4.3).
import { esc } from '../core/dom.js';
import { icon } from '../icons.js';
import { isServerMode, commit } from '../core/store.js';
import { modal, panelHeader, toast, portrait, confirmDialog } from '../ui/kit.js';
import { ABILITIES, SKILLS, SIZES, sizeById, mod } from '../data/rules.js';
import { BESTIARY, loadSrdBestiary } from '../data/bestiary.js';
import { listCreatures, saveCreature, deleteCreature } from '../core/library.js';
import { normalizeCreature, fromSrd } from '../rules/creature.js';

const CRS = ['0', '1/8', '1/4', '1/2', ...Array.from({ length: 30 }, (_, i) => String(i + 1))];
const SPEEDS = [['walk', 'Ходьба'], ['fly', 'Полёт'], ['swim', 'Плавание'], ['climb', 'Лазание'], ['burrow', 'Копание']];
const LISTS = [['traits', 'Особенности', 'Особенность'], ['actions', 'Действия', 'Действие'], ['bonusActions', 'Бонусные действия', 'Бонусное действие'], ['reactions', 'Реакции', 'Реакция']];
const skillName = (id) => SKILLS.find((s) => s.id === id || s.name === id)?.name || id;
const fmt = (n) => (n == null ? '' : n >= 0 ? `+${n}` : `−${-n}`);
const icn = (n, s = 18) => icon(n, s);

// ——— Список ———
// Кэш на пользователя и режим: экран перерисовывается при каждом изменении хранилища, библиотеку грузим один раз.
let lib = { key: '', list: null, error: null, loading: false, q: '' };
const keyOf = (user) => `${user.id}:${isServerMode() ? 'server' : 'sandbox'}`;

async function load(user, rerender) {
  lib = { ...lib, key: keyOf(user), loading: true, error: null };
  // Песочница читает библиотеку прямо из хранилища браузера: если его очистили в соседней вкладке, сначала сохраняем базу.
  try { if (!isServerMode() && !localStorage.getItem('rasputye-v2-db')) commit(() => {}); } catch { /* приватный режим — покажем ошибку API */ }
  try { lib.list = await listCreatures(); } catch (err) { lib.error = err; lib.list = null; }
  lib.loading = false;
  rerender();
}

/** Таблица библиотеки ещё не создана на живой базе (миграция не применена). */
const notReady = (err) => /PGRST205|42P01|could not find the table|does not exist|schema cache/i.test(`${err?.code || ''} ${err?.message || ''}`);

const subtitle = (c) => [c.size ? sizeById(c.size).name : '', c.type].filter(Boolean).join(' ').replace(/^./, (s) => s.toUpperCase());
function card(c) {
  const vit = [c.ac != null ? `КД ${c.ac}` : '', c.hp != null ? `${c.hp} хит.` : '', c.speed?.walk != null ? `${c.speed.walk} фт` : ''].filter(Boolean).join(' · ');
  const sub = [subtitle(c), c.cr != null ? `ПО ${c.cr}` : ''].filter(Boolean).join(' · ');
  return `<button class="char-card lib-card" data-cr="${esc(c.id)}">${portrait(c.img || `ini:${c.name}`, 'lg foe', c.name)}
    <span class="cc-text"><b>${esc(c.name)}</b><small>${esc(sub || 'Без описания')}</small>${vit ? `<small class="cc-camp">${esc(vit)}</small>` : ''}</span></button>`;
}

/** Разметка вкладки «Существа» (под вкладками главной). */
export function creaturesPage(user) {
  const tools = `<span class="spacer"></span>
    <label class="input lib-search">${icn('search-01')}<input type="search" data-lib-q placeholder="Найти своё существо" value="${esc(lib.q)}" aria-label="Поиск по библиотеке"></label>
    <button class="btn btn-secondary" data-lib-srd>${icn('book-open-01')}Из бестиария</button>
    <button class="btn btn-primary" data-lib-new>${icn('plus-sign')}Новое существо</button>`;
  if (lib.key !== keyOf(user) || lib.loading || (!lib.list && !lib.error)) return { tools, body: '<p class="muted lib-wait">Открываю библиотеку…</p>' };
  if (lib.error) {
    const body = notReady(lib.error)
      ? `<div class="empty-hero">${icn('cloud', 40)}<h2>Библиотека на сервере ещё не включена</h2><p>Её таблица появится, когда Яра обновит базу.<br>В песочнице библиотека уже работает.</p><small class="tertiary">${esc(lib.error.message || '')}</small></div>`
      : `<div class="empty-hero">${icn('alert-circle', 40)}<h2>Не удалось открыть библиотеку</h2><p>${esc(lib.error.message || String(lib.error))}</p><div class="row"><button class="btn btn-secondary" data-lib-retry>${icn('reload')}Ещё раз</button></div></div>`;
    return { tools: '', body };
  }
  if (!lib.list.length) {
    return { tools: '', body: `<div class="empty-hero">${icn('monster', 40)}<h2>Своих существ пока нет</h2><p>Соберите своего монстра в конструкторе или возьмите за основу существо из бестиария SRD.<br>Библиотеку видите только вы, игрокам она не выдаётся.</p>
      <div class="row"><button class="btn btn-primary btn-lg" data-lib-new>${icn('plus-sign')}Новое существо</button><button class="btn btn-secondary btn-lg" data-lib-srd>${icn('book-open-01')}Из бестиария</button></div></div>` };
  }
  const q = lib.q.trim().toLowerCase();
  const shown = lib.list.filter((c) => !q || `${c.name} ${c.en || ''} ${c.type}`.toLowerCase().includes(q));
  const body = shown.length
    ? `<div class="char-cards">${shown.map(card).join('')}</div><p class="t-xs tertiary lib-note">${lib.list.length} из 500 · библиотеку видите только вы</p>`
    : `<p class="muted lib-wait">Ничего не нашлось по «${esc(lib.q)}».</p>`;
  return { tools, body };
}

/** Обработчики вкладки. rerender — перерисовать главную. */
export function bindCreatures(root, user, rerender) {
  if (lib.key !== keyOf(user) || (!lib.list && !lib.error && !lib.loading)) { load(user, rerender); }
  const reload = () => load(user, rerender);
  root.querySelector('[data-lib-q]')?.addEventListener('input', (e) => {
    lib.q = e.target.value;
    const at = e.target.selectionStart;
    rerender();
    const inp = root.querySelector('[data-lib-q]'); inp?.focus(); inp?.setSelectionRange(at, at);
  });
  root.querySelectorAll('[data-lib-new]').forEach((b) => b.addEventListener('click', () => openEditor(normalizeCreature({ size: 'medium', speed: { walk: 30 } }), reload)));
  root.querySelectorAll('[data-lib-srd]').forEach((b) => b.addEventListener('click', () => pickFromSrd(reload)));
  root.querySelector('[data-lib-retry]')?.addEventListener('click', reload);
  root.querySelectorAll('[data-cr]').forEach((b) => b.addEventListener('click', () => {
    const c = lib.list?.find((x) => x.id === b.dataset.cr);
    if (c) openEditor(structuredClone(c), reload);
  }));
}

// ——— Копия из бестиария ———
const SPEED_WORDS = { летая: 'fly', лазая: 'climb', плавая: 'swim', копая: 'burrow' };
/**
 * Бестиарий стола хранит одну скорость, а остальные — в начале строки чувств («скорость: лазая 40 фт, летая 80 фт, …»).
 * В копии раскладываем их по полям конструктора; у легендарных существ SRD — 3 действия за раунд.
 */
export function srdCopy(monster) {
  const c = fromSrd(monster);
  const rest = [];
  for (const part of String(c.senses || '').split(/,\s*/)) {
    const m = /^(?:скорость:\s*)?(летая|лазая|плавая|копая)\s+(\d+)\s*фт/i.exec(part.trim());
    if (m) c.speed[SPEED_WORDS[m[1].toLowerCase()]] = Number(m[2]);
    else if (part.trim()) rest.push(part.trim());
  }
  c.senses = rest.join(', ');
  if (c.legendary.actions.length && c.legendary.count == null) c.legendary.count = 3;
  return c;
}

async function pickFromSrd(reload) {
  let q = '';
  const m = modal(`${panelHeader('Из бестиария', 'Копия SRD 5.1 попадёт в вашу библиотеку — её можно править')}
    <div class="panel-section"><label class="input">${icn('search-01')}<input type="search" data-q placeholder="Гоблин, adult red, ПО 5…" autofocus></label></div>
    <div class="modal-body lib-srd"><p class="muted lib-wait">Загружаю бестиарий…</p></div>
    <div class="panel-footer"><small class="tertiary">SRD 5.1 by Wizards of the Coast LLC, CC BY 4.0</small></div>`, { className: 'lib-srd-modal' });
  const box = m.box.querySelector('.lib-srd');
  const render = () => {
    const s = q.trim().toLowerCase().replace(/^по\s*/, '');
    const list = BESTIARY.filter((x) => x.srd === true && (!s || `${x.name} ${x.en || ''}`.toLowerCase().includes(s) || String(x.cr) === s)).slice(0, 60);
    box.innerHTML = list.length
      ? list.map((x) => `<button class="w-row lib-srd-row" data-id="${esc(x.id)}">${portrait(x.img, 'sm foe', x.name)}<span class="grow"><b>${esc(x.name)}</b><small class="muted">${esc(x.en || '')} · ${esc(x.type || '')} · ПО ${esc(x.cr)}</small></span>${icn('copy-01')}</button>`).join('')
      : '<p class="muted lib-wait">Ничего не нашлось.</p>';
  };
  m.box.querySelector('[data-q]').addEventListener('input', (e) => { q = e.target.value; render(); });
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-id]'); if (!b || b.disabled) return;
    const src = BESTIARY.find((x) => x.id === b.dataset.id); if (!src) return;
    b.disabled = true;
    try {
      const c = await saveCreature(srdCopy(src));
      m.close();
      toast({ title: 'Скопировано в библиотеку', body: c.name, icon: 'tick-02' });
      reload();
      openEditor(c, reload);
    } catch (err) { b.disabled = false; failed('Не получилось скопировать', err); }
  });
  try { await loadSrdBestiary(); } catch { /* останутся существа, что уже есть */ }
  if (m.root.isConnected) render();
}

function failed(title, err) {
  const first = err?.errors?.[0]?.message;
  toast({ title, body: first ? `${first}${err.errors.length > 1 ? ` (и ещё ${err.errors.length - 1})` : ''}` : (err?.message || String(err)), icon: 'alert-circle' });
}

// ——— Конструктор ———
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, v) {
  const ks = p.split('.'); let cur = o;
  for (let i = 0; i < ks.length - 1; i++) cur = cur[ks[i]] ??= /^\d+$/.test(ks[i + 1]) ? [] : {};
  cur[ks.at(-1)] = v;
}
const num = (v) => { const s = String(v).trim().replace('−', '-'); if (s === '') return null; const n = Number(s); return Number.isFinite(n) ? Math.trunc(n) : NaN; };

function field(label, path, value, { type = 'text', ph = '', suffix = '', cls = '', t = 'text', min = null } = {}) {
  return `<div class="field ${cls}"><label>${label}</label><div class="input"><input type="${type}" data-p="${path}" data-t="${t}" value="${esc(value ?? '')}" placeholder="${esc(ph)}"${min != null ? ` min="${min}"` : ''}${type === 'number' ? ' inputmode="numeric"' : ''}>${suffix ? `<span class="suffix">${suffix}</span>` : ''}</div></div>`;
}
function select(label, path, value, options, cls = '') {
  return `<div class="field ${cls}"><label>${label}</label><div class="input"><select data-p="${path}" data-t="text">${options.map(([v, n]) => `<option value="${esc(v)}" ${String(value ?? '') === String(v) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>${icn('arrow-down-01', 16)}</div></div>`;
}

function abilityCard(list, a, i) {
  const p = `${list}.${i}`;
  const atk = a.attack ? `<div class="lib-sub"><span class="lib-sub-t">Атака</span>
      ${field('Бонус', `${p}.attack.bonus`, a.attack.bonus, { type: 'number', t: 'num', ph: '+5' })}
      ${field('Досягаемость', `${p}.attack.reach`, a.attack.reach, { type: 'number', t: 'num', suffix: 'фт', min: 0 })}
      ${field('Дальность', `${p}.attack.range.normal`, a.attack.range?.normal, { type: 'number', t: 'num', suffix: 'фт', min: 0 })}
      ${field('Макс.', `${p}.attack.range.long`, a.attack.range?.long, { type: 'number', t: 'num', suffix: 'фт', min: 0 })}
      <button class="icon-btn icon-btn-sm" data-act="drop" data-p="${p}.attack" aria-label="Убрать атаку" data-tip="Убрать атаку">${icn('cancel-01')}</button></div>` : '';
  const dmg = (a.damage || []).map((d, k) => `<div class="lib-sub"><span class="lib-sub-t">${k ? '' : 'Урон'}</span>
      ${field('Кубы', `${p}.damage.${k}.dice`, d.dice, { ph: '2к6+3' })}
      ${field('Тип', `${p}.damage.${k}.type`, d.type, { ph: 'рубящий' })}
      <button class="icon-btn icon-btn-sm" data-act="del" data-p="${p}.damage.${k}" aria-label="Убрать урон" data-tip="Убрать урон">${icn('cancel-01')}</button></div>`).join('');
  const sv = a.save ? `<div class="lib-sub"><span class="lib-sub-t">Спасбросок</span>
      ${select('Характеристика', `${p}.save.ability`, a.save.ability, ABILITIES.map((x) => [x.id, x.name]))}
      ${field('СЛ', `${p}.save.dc`, a.save.dc, { type: 'number', t: 'num', min: 0, ph: '13' })}
      ${select('Кто бросает', `${p}.save.who`, a.save.who, [['target', 'Цель'], ['self', 'Само существо']])}
      <button class="icon-btn icon-btn-sm" data-act="drop" data-p="${p}.save" aria-label="Убрать спасбросок" data-tip="Убрать спасбросок">${icn('cancel-01')}</button></div>` : '';
  const adds = [!a.attack && `<button class="btn btn-sm btn-ghost" data-act="attack" data-p="${p}">${icn('plus-sign', 16)}Атака</button>`,
    `<button class="btn btn-sm btn-ghost" data-act="damage" data-p="${p}">${icn('plus-sign', 16)}Урон</button>`,
    !a.save && `<button class="btn btn-sm btn-ghost" data-act="save" data-p="${p}">${icn('plus-sign', 16)}Спасбросок</button>`].filter(Boolean).join('');
  return `<div class="lib-ab">
    <div class="lib-ab-top">${field('Название', `${p}.name`, a.name, { ph: 'Ятаган', cls: 'grow' })}${field('Перезарядка', `${p}.recharge`, a.recharge, { ph: '5–6', cls: 'lib-narrow' })}
      <button class="icon-btn icon-btn-sm" data-act="del" data-p="${p}" aria-label="Удалить" data-tip="Удалить">${icn('delete-02')}</button></div>
    <div class="field"><label>Описание</label><div class="input area"><textarea data-p="${p}.text" data-t="text" rows="2" placeholder="Рукопашная атака оружием…">${esc(a.text || '')}</textarea></div></div>
    ${atk}${dmg}${sv}<div class="lib-adds">${adds}</div></div>`;
}

function editorBody(d) {
  const crs = [['', '—'], ...CRS.map((c) => [c, c])];
  const stats = ABILITIES.map((a) => `<div class="lib-stat"><label>${a.short}</label><div class="input"><input type="number" data-p="stats.${a.id}" data-t="num" min="0" max="30" value="${esc(d.stats?.[a.id] ?? '')}" inputmode="numeric"></div><small data-mod="${a.id}">${d.stats?.[a.id] != null ? fmt(mod(d.stats[a.id])) : ''}</small></div>`).join('');
  const saves = ABILITIES.map((a) => {
    const i = d.saves.findIndex((s) => s.ability === a.id);
    return `<div class="lib-stat"><label>${a.short}</label><div class="input"><input type="text" data-save="${a.id}" value="${esc(i >= 0 ? fmt(d.saves[i].bonus) : '')}" placeholder="—" inputmode="numeric"></div></div>`;
  }).join('');
  const skills = d.skills.map((s, i) => `<div class="lib-sub">${select('Навык', `skills.${i}.name`, SKILLS.find((x) => x.id === s.name || x.name === s.name)?.id || s.name, [...(SKILLS.some((x) => x.id === s.name || x.name === s.name) ? [] : [[s.name, s.name]]), ...SKILLS.map((x) => [x.id, x.name])], 'grow')}
    ${field('Бонус', `skills.${i}.bonus`, s.bonus, { type: 'number', t: 'num', ph: '+4' })}
    <button class="icon-btn icon-btn-sm" data-act="del" data-p="skills.${i}" aria-label="Убрать навык">${icn('cancel-01')}</button></div>`).join('');
  const lists = LISTS.map(([k, title, one]) => `<section class="lib-sec"><h4>${title}</h4>${(d[k] || []).map((a, i) => abilityCard(k, a, i)).join('')}
    <button class="btn btn-sm btn-secondary" data-act="add" data-p="${k}">${icn('plus-sign', 16)}${one}</button></section>`).join('');
  const leg = `<section class="lib-sec"><h4>Легендарные действия</h4>
    ${field('Действий за раунд', 'legendary.count', d.legendary?.count, { type: 'number', t: 'num', min: 0, ph: '3', cls: 'lib-narrow' })}
    ${(d.legendary?.actions || []).map((a, i) => abilityCard('legendary.actions', a, i)).join('')}
    <button class="btn btn-sm btn-secondary" data-act="add" data-p="legendary.actions">${icn('plus-sign', 16)}Легендарное действие</button></section>`;
  const prov = d.provenance ? `<p class="t-xs tertiary">Основа — SRD 5.1 (CC BY 4.0), копия ваша: правки не меняют бестиарий.</p>` : '';
  return `
    <section class="lib-sec"><h4>Основное</h4>
      ${field('Имя', 'name', d.name, { ph: 'Жрец Безликого', cls: 'lib-wide' })}
      <div class="lib-grid">${select('Размер', 'size', d.size, [['', '—'], ...SIZES.map((s) => [s.id, s.name])])}${field('Тип', 'type', d.type, { ph: 'гуманоид' })}
        ${field('Мировоззрение', 'alignment', d.alignment, { ph: 'нейтрально-злое' })}${select('Опасность (ПО)', 'cr', d.cr, crs)}</div>${prov}</section>
    <section class="lib-sec"><h4>Защита и движение</h4>
      <div class="lib-grid">${field('Класс доспеха', 'ac', d.ac, { type: 'number', t: 'num', min: 0, ph: '13' })}${field('Доспех', 'acNote', d.acNote, { ph: 'кожаный доспех, щит' })}
        ${field('Хиты', 'hp', d.hp, { type: 'number', t: 'num', min: 0, ph: '27' })}${field('Кости хитов', 'hpFormula', d.hpFormula, { ph: '5к8+5' })}</div>
      <div class="lib-grid five">${SPEEDS.map(([k, n]) => field(n, `speed.${k}`, d.speed?.[k], { type: 'number', t: 'num', min: 0, suffix: 'фт' })).join('')}</div></section>
    <section class="lib-sec"><h4>Характеристики</h4><div class="lib-stats">${stats}</div>
      <h4>Спасброски</h4><div class="lib-stats">${saves}</div><p class="t-xs tertiary">Пусто — без владения: бросок по модификатору характеристики.</p></section>
    <section class="lib-sec"><h4>Навыки</h4>${skills}<button class="btn btn-sm btn-secondary" data-act="skill">${icn('plus-sign', 16)}Навык</button>
      <div class="lib-grid">${field('Чувства', 'senses', d.senses, { ph: 'тёмное зрение 60 фт, пассивное Восприятие 12', cls: 'lib-wide' })}${field('Языки', 'languages', d.languages, { ph: 'Общий, Бездны', cls: 'lib-wide' })}</div></section>
    ${lists}${leg}`;
}

/** Убрать пустое перед сохранением: строки без имени и текста, урон без кубов и типа, атаку без чисел. */
function cleaned(d0) {
  const d = structuredClone(d0);
  const ab = (a) => {
    if (a.attack && [a.attack.bonus, a.attack.reach, a.attack.range?.normal, a.attack.range?.long].every((v) => v == null)) delete a.attack;
    if (a.attack?.range && a.attack.range.normal == null && a.attack.range.long == null) delete a.attack.range;
    a.damage = (a.damage || []).filter((x) => (x.dice || '').trim() || (x.type || '').trim()).map((x) => ({ ...x, dice: (x.dice || '').trim() || null, type: (x.type || '').trim() || null }));
    if (!a.recharge) delete a.recharge;
    return a;
  };
  for (const [k] of LISTS) d[k] = (d[k] || []).filter((a) => (a.name || '').trim() || (a.text || '').trim()).map(ab);
  d.legendary.actions = (d.legendary.actions || []).filter((a) => (a.name || '').trim() || (a.text || '').trim()).map(ab);
  d.skills = d.skills.filter((s) => s.name);
  d.name = (d.name || '').trim();
  return d;
}

function openEditor(c0, reload) {
  const isNew = !c0.id;
  const d = normalizeCreature(c0);
  // У копий SRD «мультиатака» и подобные приходят с бонусом атаки 0 — это не атака: прячем пустой блок.
  for (const a of [...LISTS.flatMap(([k]) => d[k] || []), ...(d.legendary?.actions || [])]) {
    if (a.attack && !a.attack.bonus && a.attack.reach == null && a.attack.range == null) delete a.attack;
  }
  const m = modal(`${panelHeader(isNew ? 'Новое существо' : esc(d.name), 'Личная библиотека · видите только вы')}
    <div class="modal-body lib-ed"></div>
    <hr class="panel-divider"><div class="panel-footer">${isNew ? '' : `<button class="btn btn-ghost lib-del" data-del>${icn('delete-02')}Удалить</button>`}<span class="spacer"></span>
      <button class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary" data-ok>${icn('tick-02')}Сохранить</button></div>`, { wide: true, className: 'lib-modal', dismissable: false });
  const body = m.box.querySelector('.lib-ed');
  const render = () => { const top = body.scrollTop; body.innerHTML = editorBody(d); body.scrollTop = top; };
  render();
  body.addEventListener('input', (e) => {
    const t = e.target;
    t.closest('.input')?.classList.remove('error');
    if (t.dataset.save) {
      const v = num(t.value.replace('+', ''));
      const i = d.saves.findIndex((s) => s.ability === t.dataset.save);
      if (v == null || Number.isNaN(v)) { if (i >= 0 && v == null) d.saves.splice(i, 1); }
      else if (i >= 0) d.saves[i].bonus = v; else d.saves.push({ ability: t.dataset.save, bonus: v });
      return;
    }
    if (!t.dataset.p) return;
    const v = t.dataset.t === 'num' ? num(t.value) : t.value;
    setPath(d, t.dataset.p, Number.isNaN(v) ? getPath(d, t.dataset.p) : v);
    const s = /^stats\.(\w+)$/.exec(t.dataset.p);
    if (s) { const out = body.querySelector(`[data-mod="${s[1]}"]`); if (out) out.textContent = v == null || Number.isNaN(v) ? '' : fmt(mod(v)); }
  });
  body.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT' && e.target.dataset.p) setPath(d, e.target.dataset.p, e.target.value || null); });
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const p = b.dataset.p, act = b.dataset.act;
    if (act === 'add') getPath(d, p).push({ name: '', text: '' });
    else if (act === 'skill') d.skills.push({ name: 'perception', bonus: null });
    else if (act === 'attack') getPath(d, p).attack = { bonus: null, reach: 5 };
    else if (act === 'damage') (getPath(d, p).damage ||= []).push({ dice: '', type: '' });
    else if (act === 'save') getPath(d, p).save = { ability: 'dex', dc: null, who: 'target' };
    else if (act === 'drop') { const ks = p.split('.'); delete getPath(d, ks.slice(0, -1).join('.'))[ks.at(-1)]; }
    else if (act === 'del') { const ks = p.split('.'); getPath(d, ks.slice(0, -1).join('.')).splice(Number(ks.at(-1)), 1); }
    render();
    if (act === 'add') body.querySelector(`[data-p="${p}.${getPath(d, p).length - 1}.name"]`)?.focus();
  });
  const save = async () => {
    const ok = m.box.querySelector('[data-ok]');
    body.querySelectorAll('.input.error').forEach((x) => x.classList.remove('error'));
    const c = cleaned(d);
    if (!c.name) { mark('name'); toast({ title: 'Нужно имя', icon: 'alert-circle' }); return; }
    ok.disabled = true;
    try {
      const saved = await saveCreature(c);
      m.close();
      toast({ title: isNew ? 'Существо в библиотеке' : 'Сохранено', body: saved.name, icon: 'tick-02' });
      reload();
    } catch (err) {
      ok.disabled = false;
      // Поля с ошибкой проверки подсвечиваем; строки, убранные при очистке, не сдвигают пути — показываем общий список.
      (err.errors || []).forEach((x) => mark(x.path));
      failed('Не сохранилось', err);
    }
  };
  function mark(path) {
    const inp = body.querySelector(`[data-p="${CSS.escape(path)}"]`);
    if (inp) { inp.closest('.input')?.classList.add('error'); inp.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }
  m.box.querySelector('[data-ok]').addEventListener('click', save);
  m.box.querySelector('[data-del]')?.addEventListener('click', async () => {
    const yes = await confirmDialog({ title: `Удалить «${d.name}»?`, body: 'Существо исчезнет из вашей библиотеки. Уже поставленные на карту копии останутся.', ok: 'Удалить', danger: true });
    if (!yes) return;
    try { await deleteCreature(d.id); m.close(); toast({ title: 'Удалено из библиотеки', body: d.name, icon: 'delete-02' }); reload(); }
    catch (err) { failed('Не удалилось', err); }
  });
  return m;
}

export const _test = { cleaned, setPath, num, srdCopy };
