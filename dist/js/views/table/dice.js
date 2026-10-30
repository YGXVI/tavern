// Кубы (вёрстка по макету — TASK-100): рейка с набором, костями, видимостью, модификатором и преимуществом;
// лоток с объёмными кубами справа от неё; броски не из рейки и чужие открытые броски падают на стол.
// Результаты уходят в журнал кампании и всплывают у остальных за столом.
import { esc, uid, fmtMod } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { bus } from '../../core/store.js';
import { updateCampaign, addLog, userById } from '../../core/campaign.js';
import { roll as rollFormulaEngine } from '../../../engine.js';
import { userAvatar, popover, closePopover } from '../../ui/kit.js';
import { DICE } from '../../data/rules.js';
import { diceTray, diceFloor, poolLabel } from './dice-tray.js';
import { SKINS, skinById, railDie, mySkin, setMySkin } from './dice-art.js';
import { setDiceSound, diceSoundOn } from './dice3d.js';

function rnd(sides) { return rollFormulaEngine(`1d${sides}`).total; }

/** Бросить набор: {dice: {20: 1, 6: 2}, mod, adv: 'adv'|'dis'|null}. */
export function rollPool({ dice, mod = 0, adv = null }) {
  const results = [];
  for (const [s, n] of Object.entries(dice)) {
    const sides = Number(s);
    for (let i = 0; i < n; i++) results.push({ sides, value: rnd(sides) });
  }
  // Преимущество/помеха — для единственного к20 набора (остальные кубы, например к4 «Благословения», бросаются как есть).
  let dropped = null;
  const one = results.filter((r) => r.sides === 20).length === 1 ? results.findIndex((r) => r.sides === 20) : -1;
  if (adv && one >= 0) {
    const first = results[one], second = { sides: 20, value: rnd(20) };
    const keepFirst = adv === 'adv' ? first.value >= second.value : first.value <= second.value;
    dropped = keepFirst ? second : first;
    if (!keepFirst) results[one] = second;
  }
  const total = results.reduce((a, r) => a + r.value, 0) + mod;
  return { results, dropped, mod, total, adv };
}

/** Разобрать запись вида «1d8+3» или «2к6» в набор. */
export function parseFormula(f) {
  const m = String(f).replace(/\s/g, '').replace(/к/gi, 'd').match(/^(\d{0,3})d(4|6|8|10|12|20|100)([+-]\d{1,3})?$/i);
  if (!m) return null;
  return { dice: { [m[2]]: Number(m[1] || 1) }, mod: Number(m[3] || 0) };
}

export function describeRoll(r) {
  const parts = r.results.map((x) => `${x.value}`).join(' + ');
  const dice = Object.entries(r.results.reduce((a, x) => { a[x.sides] = (a[x.sides] || 0) + 1; return a; }, {})).map(([s, n]) => `${n}к${s}`).join(' + ');
  return `${dice} (${parts})${r.mod ? ` ${fmtMod(r.mod)}` : ''}${r.dropped ? ` · ${r.adv === 'adv' ? 'преимущество' : 'помеха'}, отброшено ${r.dropped.value}` : ''}`;
}

/** Кому виден бросок: all — всем; gm — автору и мастеру; blind — только мастеру; self — только автору. */
export const ROLL_MODES = [
  { id: 'all', name: 'Всем', icon: 'view', tip: 'Бросок видят все' },
  { id: 'gm', name: 'Мастеру', icon: 'crown', tip: 'Видите вы и мастер, остальные — только факт броска' },
  { id: 'blind', name: 'Вслепую', icon: 'view-off', tip: 'Результат видит только мастер — даже вы не узнаете' },
  { id: 'self', name: 'Себе', icon: 'user', tip: 'Только вы; другим бросок не показывается' },
];
export const rollVis = (l) => l.vis || (l.hidden ? 'gm' : 'all');
/** Видно ли этому участнику число броска. */
export function canSeeRoll(ctx, l) {
  const v = rollVis(l), mine = l.userId === ctx.userId;
  if (v === 'all') return true;
  if (v === 'gm') return mine || ctx.isMaster;
  if (v === 'blind') return ctx.isMaster;
  return mine;
}
/** Знает ли участник, что бросок был (бросок «себе» другим не показывается). */
export const knowsRoll = (ctx, l) => rollVis(l) !== 'self' || l.userId === ctx.userId;

/**
 * Бросок от имени пользователя: записать в журнал и показать всем, кому положено.
 * opts: {label, dice, mod, adv, vis | hidden, kind}
 */
export function doRoll(ctx, opts) {
  const r = rollPool(opts);
  const vis = opts.vis || (opts.hidden ? 'gm' : 'all');
  const entry = { id: uid('r-'), at: Date.now(), userId: ctx.userId, kind: opts.kind || 'roll', label: opts.label || 'Бросок', total: r.total, detail: describeRoll(r), hidden: vis !== 'all', vis, nat: r.results.length === 1 && r.results[0].sides === 20 ? r.results[0].value : null };
  updateCampaign(ctx.cid, (c) => addLog(c, entry));
  // Кубы и набор — только у открытого броска и только в мгновенном событии (в журнал не пишутся):
  // у остальных они падают на стол (TASK-092/093).
  const skin = dicePool(ctx).skin;
  bus.send('roll', { cid: ctx.cid, entry, ...(vis === 'all' ? { dice: r.results, dropped: r.dropped, skin } : {}) });
  showRollToast(ctx, entry, true);
  // Вслепую: кубы катятся, но на гранях «?», и сумма «?» — число увидит только мастер.
  const shown = canSeeRoll(ctx, entry) ? { entry, results: r.results, dropped: r.dropped }
    : { entry: { ...entry, total: '?' }, results: r.results.map((x) => ({ sides: x.sides, value: null })), dropped: null };
  const tray = opts.fromTray && ctx.ui.widget === 'dice' ? diceTray(ctx) : null;
  if (tray) tray.roll({ ...shown, mod: r.mod, label: poolLabel(opts.dice), adv: r.adv, skin, reroll: true });
  else diceFloor(ctx)?.roll({ ...shown, skin, mine: true });
  return { ...r, entry };
}

export function showRollToast(ctx, entry, mine = false) {
  const u = userById(entry.userId);
  if (!knowsRoll(ctx, entry)) return;
  const vis = rollVis(entry);
  if (!canSeeRoll(ctx, entry)) {
    if (mine) ctx.toast({ title: `Бросок вслепую · ${entry.label}`, body: 'Результат увидит только мастер', icon: 'view-off' });
    else ctx.toast({ title: `${u?.name || 'Кто-то'} бросил скрыто`, body: vis === 'gm' && !ctx.isMaster ? 'Результат видят он и мастер' : 'Результат видит только мастер', icon: 'view-off' });
    return;
  }
  const crit = entry.nat === 20 ? ' · критическое попадание!' : entry.nat === 1 ? ' · единица' : '';
  const tag = vis === 'all' ? '' : ` · ${ROLL_MODES.find((m) => m.id === vis)?.name.toLowerCase()}`;
  ctx.toast({ title: `${mine ? 'Вы' : u?.name || 'Кто-то'} · ${entry.label}${tag}`, body: entry.detail + crit, avatar: userAvatar(u, 'sm'), result: entry.total });
}

// ——— Инициатива на столе ———
/**
 * Инициатива при начале боя и добавлении в бой: к20 каждого участника падают на стол — сколько участников,
 * столько кубов. rolls: [{tokenId, natural, init}]. Другим за столом уходят только участники, которых они видят.
 */
export function initiativeDice(ctx, rolls) {
  const list = rolls.filter((r) => r && r.natural != null);
  if (!list.length) return;
  const skin = dicePool(ctx).skin;
  const id = uid('i-');
  const items = list.map((r) => {
    const t = ctx.scene?.tokens.find((x) => x.id === r.tokenId);
    return t && { tokenId: r.tokenId, name: ctx.nameOf(t), natural: r.natural, total: r.init, hidden: !!t.hidden };
  }).filter(Boolean);
  diceFloor(ctx)?.rollGroup({ id, userId: ctx.userId, title: 'Инициатива', items, skin, mine: true });
  const open = items.filter((x) => !x.hidden).map(({ tokenId, natural, total }) => ({ tokenId, natural, total }));
  if (open.length) bus.send('init-dice', { cid: ctx.cid, sceneId: ctx.sceneId, id, userId: ctx.userId, items: open, skin });
}

// ——— Рейка кубов (Figma: Dice → dice-rail) ———
/** Набор кубов в рейке: кости, модификатор, преимущество, видимость, набор (материал). */
export function dicePool(ctx) {
  return ctx.ui.dicePool || (ctx.ui.dicePool = { dice: {}, mod: 0, adv: null, vis: 'all', skin: mySkin(ctx.userId) });
}
const modeOf = (ctx, vis) => {
  const m = ROLL_MODES.find((x) => x.id === vis) || ROLL_MODES[0];
  return ctx.isMaster && m.id === 'gm' ? { ...m, name: 'Скрыто', icon: 'view-off', tip: 'Игроки увидят только факт броска' } : m;
};
// Кнопка преимущества — по кругу: обычный → преимущество (зелёная) → помеха (красная) → обычный.
const ADV_NEXT = { none: 'adv', adv: 'dis', dis: null };
const ADV_TIP = {
  none: 'Обычный бросок · клик — с преимуществом',
  adv: 'С преимуществом: два к20, берётся больший · клик — с помехой',
  dis: 'С помехой: два к20, берётся меньший · клик — обычный бросок',
};

/**
 * Преимущество/помеха: в лотке сразу два к20 — к20 набора и второй, из которых выбирают.
 * Нет к20 — он добавляется сам (и уходит при возврате к обычному броску); несколько к20 — остаётся один.
 */
export function setAdv(pool, next) {
  if (next && !pool.adv) {
    if (!pool.dice[20]) pool.autoD20 = true;
    pool.dice[20] = 1;
  }
  if (!next && pool.adv && pool.autoD20 && pool.dice[20] === 1) delete pool.dice[20];
  if (!next) pool.autoD20 = false;
  pool.adv = next || null;
}

export function diceWidget(ctx) {
  const pool = dicePool(ctx);
  const skin = skinById(pool.skin);
  const mode = modeOf(ctx, pool.vis || 'all');
  const tool = (act, ic, tip, { active = false, badge = '', cls = '', menu = true } = {}) => `<button class="icon-btn rail-btn ${active ? 'active' : ''} ${cls}" data-act="${act}" data-tip="${esc(tip)}" aria-label="${esc(tip)}"${menu ? ' aria-haspopup="dialog"' : ''}>${icon(ic, 24)}${badge ? `<span class="rail-badge">${esc(badge)}</span>` : ''}</button>`;
  const adv = pool.adv || 'none';
  return `<div class="dice-widget"><div class="toolbar toolbar-v dice-rail" role="toolbar" aria-label="Кубы">
    <button class="rail-btn rail-die dice-set" data-act="dice-set" data-tip="Набор кубов: ${esc(skin.name)}" aria-label="Набор кубов: ${esc(skin.name)}" aria-haspopup="dialog">${railDie(20, skin.id)}</button>
    <span class="divider"></span>
    ${DICE.map((s) => {
      const n = (pool.dice[s] || 0) + (s === 20 && pool.adv && pool.dice[20] === 1 ? 1 : 0); // при преимуществе к20 два
      return `<button class="rail-btn rail-die ${n ? 'selected' : ''}" data-act="die-add" data-sides="${s}" data-tip="к${s}${n ? ' · правый клик — убрать' : ''}" aria-label="Положить к${s}${n ? `, в лотке ${n}` : ''}">${railDie(s, skin.id)}${n ? `<span class="count">${n}</span>` : ''}</button>`;
    }).join('')}
    <span class="divider"></span>
    ${tool('dice-vis-menu', mode.icon, `Кому виден бросок: ${mode.name}`, { active: (pool.vis || 'all') !== 'all' })}
    ${tool('dice-mod-menu', 'plus-minus', pool.mod ? `Модификатор ${fmtMod(pool.mod)}` : 'Модификатор', { active: !!pool.mod, badge: pool.mod ? fmtMod(pool.mod) : '' })}
    ${tool('dice-adv', 'justice-scale-01', ADV_TIP[adv], { cls: pool.adv ? `adv-${pool.adv}` : '', badge: pool.adv === 'adv' ? '↑' : pool.adv === 'dis' ? '↓' : '', menu: false })}
  </div></div>`;
}

/** Всплывашка рейки справа от кнопки; клики внутри — через data-атрибуты. */
function railPopover(ctx, anchor, html, onClick, cls = '') {
  const p = popover(`<div class="dice-pop ${cls}">${html}</div>`, anchor, { placement: 'right', gap: 12 });
  p.node.addEventListener('click', (e) => onClick(e, p));
  return p;
}

function skinsPopover(ctx, anchor) {
  const pool = dicePool(ctx);
  railPopover(ctx, anchor, `<div class="dp-title">Набор кубов</div>
    <div class="skin-grid" role="radiogroup" aria-label="Набор кубов">${SKINS.map((s) => `<button class="skin-opt ${s.id === pool.skin ? 'on' : ''}" data-skin="${s.id}" role="radio" aria-checked="${s.id === pool.skin}">${railDie(20, s.id)}<span>${esc(s.name)}</span></button>`).join('')}</div>
    <p class="dp-hint">Ваши кубы в этом наборе увидят все за столом</p>
    <label class="dp-row dp-sound">${icon(diceSoundOn() ? 'volume-high' : 'volume-off', 20)}<span class="grow"><b>Звук кубов</b><small>Удары о лоток и друг о друга</small></span><input type="checkbox" class="switch" data-dice-sound ${diceSoundOn() ? 'checked' : ''}></label>`, (e) => {
    // Звук кубов (TASK-145): только на этой вкладке, переключается не закрывая окна.
    const sw = e.target.closest('[data-dice-sound]');
    if (sw) { setDiceSound(sw.checked); sw.closest('.dp-sound').querySelector('svg').outerHTML = icon(sw.checked ? 'volume-high' : 'volume-off', 20); return; }
    const b = e.target.closest('[data-skin]'); if (!b) return;
    pool.skin = b.dataset.skin; setMySkin(ctx.userId, pool.skin);
    closePopover();
    // Лоток перекладывает кубы в новом материале: они падают заново.
    diceTray(ctx)?.clear();
    ctx.panels.refreshWidget(true);
  }, 'skins');
}

function visPopover(ctx, anchor) {
  const pool = dicePool(ctx);
  const modes = (ctx.isMaster ? ROLL_MODES.filter((m) => m.id !== 'blind') : ROLL_MODES).map((m) => modeOf(ctx, m.id));
  railPopover(ctx, anchor, `<div class="dp-title">Кому виден бросок</div>${modes.map((m) => `<button class="dp-row ${(pool.vis || 'all') === m.id ? 'on' : ''}" data-vis="${m.id}">${icon(m.icon, 20)}<span class="grow"><b>${esc(m.name)}</b><small>${esc(m.tip)}</small></span>${(pool.vis || 'all') === m.id ? icon('tick-02', 18) : ''}</button>`).join('')}`, (e) => {
    const b = e.target.closest('[data-vis]'); if (!b) return;
    pool.vis = b.dataset.vis;
    closePopover();
    ctx.panels.refreshWidget(true);
  });
}

function modPopover(ctx, anchor) {
  const pool = dicePool(ctx);
  railPopover(ctx, anchor, `<div class="dp-title">Модификатор</div>
    <div class="dp-stepper"><button class="icon-btn" data-mod="-1" aria-label="Минус один">${icon('minus-sign', 20)}</button><b class="dp-mod">${fmtMod(pool.mod)}</b><button class="icon-btn" data-mod="1" aria-label="Плюс один">${icon('plus-sign', 20)}</button></div>
    <div class="dp-chips">${[-2, -1, 1, 2, 3, 5].map((v) => `<button class="chip chip-md" data-mod-set="${v}">${fmtMod(v)}</button>`).join('')}<button class="chip chip-md" data-mod-set="0">0</button></div>`, (e, p) => {
    const step = e.target.closest('[data-mod]'), set = e.target.closest('[data-mod-set]');
    if (!step && !set) return;
    pool.mod = Math.max(-30, Math.min(30, set ? Number(set.dataset.modSet) : pool.mod + Number(step.dataset.mod)));
    p.node.querySelector('.dp-mod').textContent = fmtMod(pool.mod);
    ctx.panels.refreshWidget(true);
  }, 'mod');
}

export function diceAction(ctx, act, el, e) {
  const pool = dicePool(ctx);
  const s = Number(el?.dataset.sides);
  if (act === 'dice-set') { skinsPopover(ctx, el); return; }
  if (act === 'dice-vis-menu') { visPopover(ctx, el); return; }
  if (act === 'dice-mod-menu') { modPopover(ctx, el); return; }
  if (act === 'dice-adv') setAdv(pool, ADV_NEXT[pool.adv || 'none']);
  else if (act === 'die-add' || act === 'die-remove') {
    pool.dice[s] = act === 'die-add' ? Math.min(20, (pool.dice[s] || 0) + 1) : Math.max(0, (pool.dice[s] || 0) - 1);
    if (!pool.dice[s]) delete pool.dice[s];
    // Преимущество — ровно для одного к20: добавили или убрали к20 — бросок снова обычный.
    if (s === 20 && pool.adv && pool.dice[20] !== 1) { pool.adv = null; pool.autoD20 = false; }
  }
  else if (act === 'mod-inc') pool.mod = Math.min(30, pool.mod + 1);
  else if (act === 'mod-dec') pool.mod = Math.max(-30, pool.mod - 1);
  else if (act === 'adv') pool.adv = pool.adv === el.dataset.v ? null : el.dataset.v;
  else if (act === 'dice-vis') pool.vis = el.dataset.v;
  else if (act === 'dice-clear') {
    // Крестик лотка: кубы и итог уходят; модификатор, видимость и набор остаются.
    pool.dice = {}; pool.adv = null; pool.autoD20 = false; ctx.ui.lastRoll = null;
    diceTray(ctx)?.clear();
  } else if (act === 'dice-reroll' && ctx.ui.lastRoll) {
    const l = ctx.ui.lastRoll;
    const dice = l.results.reduce((a, x) => { a[x.sides] = (a[x.sides] || 0) + 1; return a; }, {});
    const r = doRoll(ctx, { label: l.label, dice, mod: l.mod, adv: l.adv, vis: l.vis || 'all', fromTray: true });
    ctx.ui.lastRoll = { ...r, label: l.label, vis: l.vis || 'all' };
  } else if (act === 'dice-roll') {
    const count = Object.values(pool.dice).reduce((a, b) => a + b, 0);
    if (!count) return;
    const label = poolLabel(pool.dice) + (pool.mod ? ` ${fmtMod(pool.mod)}` : '');
    const vis = ctx.isMaster && pool.vis === 'blind' ? 'gm' : pool.vis || 'all';
    const r = doRoll(ctx, { label, dice: { ...pool.dice }, mod: pool.mod, adv: pool.adv, vis, fromTray: true });
    ctx.ui.lastRoll = { ...r, label, vis };
    pool.dice = {}; pool.adv = null; pool.autoD20 = false;
  }
  ctx.panels.refreshWidget(true);
}
