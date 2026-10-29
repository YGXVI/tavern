// Кубы: рельса с кубами, лоток, бросок с модификатором, преимущество/помеха, скрытый бросок мастера.
// Результаты уходят в журнал кампании и всплывают у остальных за столом.
import { esc, uid, fmtMod, timeAgo } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { bus } from '../../core/store.js';
import { updateCampaign, addLog, userById } from '../../core/campaign.js';
import { roll as rollFormulaEngine } from '../../../engine.js';
import { userAvatar } from '../../ui/kit.js';
import { DICE } from '../../data/rules.js';

const SHAPES = {
  4: 'M50 8 94 86H6Z',
  6: 'M14 14H86V86H14Z',
  8: 'M50 4 92 50 50 96 8 50Z',
  10: 'M50 4 92 42 50 96 8 42Z',
  12: 'M50 5 93 36 77 88H23L7 36Z',
  20: 'M50 4 90 27V73L50 96 10 73V27Z',
  100: 'M50 4 92 42 50 96 8 42Z',
};

export function dieSvg(sides, value = '', cls = '') {
  const label = value === '' ? `к${sides}` : value;
  const fs = String(label).length > 2 ? 24 : 30;
  return `<svg class="die ${cls}" viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="bone-${sides}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--die-light)"/><stop offset=".6" stop-color="var(--die-base)"/><stop offset="1" stop-color="var(--die-dark)"/></linearGradient></defs><path d="${SHAPES[sides] || SHAPES[20]}" fill="url(#bone-${sides})" stroke="var(--die-dark)" stroke-width="2" stroke-linejoin="round"/><text x="50" y="${sides === 4 ? 70 : 60}" text-anchor="middle" font-family="Unbounded, Inter, sans-serif" font-weight="600" font-size="${fs}" fill="var(--die-number)">${esc(label)}</text></svg>`;
}

function rnd(sides) { return rollFormulaEngine(`1d${sides}`).total; }

/** Бросить набор: {dice: {20: 1, 6: 2}, mod, adv: 'adv'|'dis'|null}. */
export function rollPool({ dice, mod = 0, adv = null }) {
  const results = [];
  for (const [s, n] of Object.entries(dice)) {
    const sides = Number(s);
    for (let i = 0; i < n; i++) results.push({ sides, value: rnd(sides) });
  }
  let dropped = null;
  if (adv && results.length === 1 && results[0].sides === 20) {
    const second = { sides: 20, value: rnd(20) };
    const keepFirst = adv === 'adv' ? results[0].value >= second.value : results[0].value <= second.value;
    dropped = keepFirst ? second : results[0];
    if (!keepFirst) results[0] = second;
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

/**
 * Бросок от имени пользователя: записать в журнал и показать всем.
 * opts: {label, dice, mod, adv, hidden, kind}
 */
export function doRoll(ctx, opts) {
  const r = rollPool(opts);
  const entry = { id: uid('r-'), at: Date.now(), userId: ctx.userId, kind: opts.kind || 'roll', label: opts.label || 'Бросок', total: r.total, detail: describeRoll(r), hidden: !!opts.hidden, nat: r.results.length === 1 && r.results[0].sides === 20 ? r.results[0].value : null };
  updateCampaign(ctx.cid, (c) => addLog(c, entry));
  bus.send('roll', { cid: ctx.cid, entry });
  showRollToast(ctx, entry, true);
  return { ...r, entry };
}

export function showRollToast(ctx, entry, mine = false) {
  const u = userById(entry.userId);
  if (entry.hidden && !mine && !ctx.isMaster) {
    ctx.toast({ title: 'Мастер бросил скрыто', body: 'Результат видит только мастер', icon: 'view-off' });
    return;
  }
  const crit = entry.nat === 20 ? ' · критическое попадание!' : entry.nat === 1 ? ' · единица' : '';
  ctx.toast({ title: `${mine ? 'Вы' : u?.name || 'Кто-то'} · ${entry.label}${entry.hidden ? ' · скрыто' : ''}`, body: entry.detail + crit, avatar: userAvatar(u, 'sm'), result: entry.total });
}

// ——— Виджет кубов ———
export function diceWidget(ctx) {
  const pool = ctx.ui.dicePool || (ctx.ui.dicePool = { dice: {}, mod: 0, adv: null, hidden: false });
  const last = ctx.ui.lastRoll;
  const count = Object.values(pool.dice).reduce((a, b) => a + b, 0);
  const onlyD20 = count === 1 && pool.dice[20] === 1;
  const log = ctx.c.log.filter((l) => l.kind === 'roll' || l.kind === 'save' || l.kind === 'attack').filter((l) => !l.hidden || ctx.isMaster || l.userId === ctx.userId).slice(0, 8);
  return `<div class="dice-widget panel">
    <div class="dice-rail">${DICE.map((s) => `<button class="rail-die" data-act="die-add" data-sides="${s}" data-tip="к${s} · правый клик — убрать">${dieSvg(s)}${pool.dice[s] ? `<span class="count">${pool.dice[s]}</span>` : ''}</button>`).join('')}</div>
    <div class="tray">
      <div class="tray-felt ${last && !count ? 'has-result' : ''}">
        ${count ? `<div class="tray-dice">${Object.entries(pool.dice).flatMap(([s, n]) => Array.from({ length: n }, () => `<button class="tray-die" data-act="die-remove" data-sides="${s}">${dieSvg(Number(s))}</button>`)).join('')}</div>`
          : last ? `<div class="tray-dice result">${last.results.map((x) => `<span class="tray-die rolled ${x.sides === 20 && x.value === 20 ? 'crit' : x.sides === 20 && x.value === 1 ? 'fumble' : ''}">${dieSvg(x.sides, x.value, 'tumble')}</span>`).join('')}${last.dropped ? `<span class="tray-die dropped">${dieSvg(20, last.dropped.value)}</span>` : ''}</div><div class="tray-total"><span>${last.hidden ? 'скрыто · ' : ''}${esc(last.label || '')}</span><b>${last.total}</b></div>`
          : '<div class="tray-hint">Кликните куб слева, чтобы положить его в лоток</div>'}
      </div>
      <div class="tray-foot">
        <div class="mod-ctl"><button class="icon-btn icon-btn-xs" data-act="mod-dec" aria-label="Минус">${icon('minus-sign', 14)}</button><span class="mod-val">${fmtMod(pool.mod)}</span><button class="icon-btn icon-btn-xs" data-act="mod-inc" aria-label="Плюс">${icon('plus-sign', 14)}</button></div>
        ${onlyD20 ? `<button class="chip ${pool.adv === 'adv' ? 'chip-success' : ''}" data-act="adv" data-v="adv">Преим.</button><button class="chip ${pool.adv === 'dis' ? 'chip-negative' : ''}" data-act="adv" data-v="dis">Помеха</button>` : ''}
        <span class="spacer"></span>
        ${ctx.isMaster ? `<button class="icon-btn icon-btn-sm ${pool.hidden ? 'active' : ''}" data-act="dice-hidden" data-tip="${pool.hidden ? 'Скрытый бросок: игроки увидят только факт' : 'Бросок видят все'}">${icon(pool.hidden ? 'view-off' : 'view', 18)}</button>` : ''}
        ${count ? `<button class="icon-btn icon-btn-sm" data-act="dice-clear" data-tip="Очистить">${icon('delete-02', 18)}</button>` : last ? `<button class="icon-btn icon-btn-sm" data-act="dice-reroll" data-tip="Перебросить">${icon('reload', 18)}</button>` : ''}
        <button class="roll-btn" data-act="dice-roll" ${count ? '' : 'disabled'} aria-label="Бросить">${icon('arrow-right-02', 22)}</button>
      </div>
    </div>
    ${log.length ? `<div class="dice-log scroll">${log.map((l) => `<div class="log-row">${userAvatar(userById(l.userId), 'xs')}<span class="grow ellipsis">${esc(l.hidden && !ctx.isMaster && l.userId !== ctx.userId ? 'Скрытый бросок' : l.label)}<small> · ${esc(timeAgo(l.at))}</small></span><b>${l.hidden && !ctx.isMaster && l.userId !== ctx.userId ? '?' : l.total}</b></div>`).join('')}</div>` : ''}
  </div>`;
}

export function diceAction(ctx, act, el, e) {
  const pool = ctx.ui.dicePool || (ctx.ui.dicePool = { dice: {}, mod: 0, adv: null, hidden: false });
  const s = Number(el?.dataset.sides);
  if (act === 'die-add') { pool.dice[s] = Math.min(20, (pool.dice[s] || 0) + 1); if (Object.values(pool.dice).reduce((a, b) => a + b, 0) !== 1) pool.adv = null; }
  else if (act === 'die-remove') { pool.dice[s] = Math.max(0, (pool.dice[s] || 0) - 1); if (!pool.dice[s]) delete pool.dice[s]; }
  else if (act === 'mod-inc') pool.mod = Math.min(30, pool.mod + 1);
  else if (act === 'mod-dec') pool.mod = Math.max(-30, pool.mod - 1);
  else if (act === 'adv') pool.adv = pool.adv === el.dataset.v ? null : el.dataset.v;
  else if (act === 'dice-hidden') pool.hidden = !pool.hidden;
  else if (act === 'dice-clear') { pool.dice = {}; pool.mod = 0; pool.adv = null; }
  else if (act === 'dice-reroll' && ctx.ui.lastRoll) {
    const l = ctx.ui.lastRoll;
    const dice = l.results.reduce((a, x) => { a[x.sides] = (a[x.sides] || 0) + 1; return a; }, {});
    const r = doRoll(ctx, { label: l.label, dice, mod: l.mod, adv: l.adv, hidden: l.hidden });
    ctx.ui.lastRoll = { ...r, label: l.label, hidden: l.hidden };
  } else if (act === 'dice-roll') {
    const count = Object.values(pool.dice).reduce((a, b) => a + b, 0);
    if (!count) return;
    const label = Object.entries(pool.dice).map(([k, n]) => `${n}к${k}`).join(' + ') + (pool.mod ? ` ${fmtMod(pool.mod)}` : '');
    const r = doRoll(ctx, { label, dice: { ...pool.dice }, mod: pool.mod, adv: pool.adv, hidden: pool.hidden && ctx.isMaster });
    ctx.ui.lastRoll = { ...r, label, hidden: pool.hidden && ctx.isMaster };
    pool.dice = {}; pool.adv = null;
  }
  ctx.panels.refreshWidget();
}
