// Лоток и кубы на столе (TASK-092, вёрстка по макету — TASK-100).
// Лоток (Figma: Dice → dice-tray): стоит справа от рейки виджета «Кубы». Состояния — пусто, кубы ждут броска, итог.
// До броска кубы висят в воздухе и трясутся, по центру — большая кнопка «Бросить». Крестик лотка очищает его
// (и до броска, и после). Свои броски из рейки катятся в лотке; броски из листа и атак, а также открытые броски
// других участников падают прямо на игровой стол (как в Foundry) и через несколько секунд тают.
import { el, esc, fmtMod, timeAgo } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { userById } from '../../core/campaign.js';
import { userAvatar } from '../../ui/kit.js';
import { createDiceStage, splitD100 } from './dice3d.js';
import { skinById } from './dice-art.js';

const reducedMotion = () => matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const GOLD = [0.95, 0.62, 0.18], RED = [0.85, 0.16, 0.1];
const FLOOR_HOLD = 3600;
const webgl = (() => { let ok = null; return () => { if (ok === null) { const g = document.createElement('canvas').getContext('webgl'); ok = !!g; g?.getExtension('WEBGL_lose_context')?.loseContext(); } return ok; }; })();

/** Кубы броска для сцены: к100 — две к10; отброшенный к20 преимущества — полупрозрачный; крит светится. */
export function targetsOf(results = [], dropped = null) {
  const out = [];
  const crit = results.filter((r) => r.sides === 20).length === 1;
  for (const r of results) {
    if (r.sides === 100) out.push(...splitD100(r.value));
    else out.push({ kind: r.sides, value: r.value, glow: crit && r.sides === 20 && r.value === 20 ? GOLD : crit && r.sides === 20 && r.value === 1 ? RED : null });
  }
  if (dropped) out.push({ kind: dropped.sides, value: dropped.value, dropped: true });
  return out;
}

/** Что выпало на каждом кубе (если кубов больше одного): «к20 15 · к6 3 · к6 5», отброшенный — зачёркнут. */
export function rollsLine(results = [], dropped = null) {
  if (results.length + (dropped ? 1 : 0) < 2) return '';
  const one = (r) => `<span>к${r.sides}&nbsp;<b>${r.value == null ? '?' : esc(r.value)}</b></span>`;
  return results.map(one).join('') + (dropped ? `<s>${one(dropped)}</s>` : '');
}

/** Кубы набора виджета: «1к20 + 2к6». */
export const poolLabel = (dice) => Object.entries(dice || {}).filter(([, n]) => n).map(([s, n]) => `${n}к${s}`).join(' + ');

// Подписи видимости в подвале лотка.
const VIS_HINT = {
  all: ['view', 'Бросок увидят все за столом'],
  gm: ['crown', 'Увидите вы и мастер, остальные — только факт броска'],
  blind: ['view-off', 'Число увидит только мастер'],
  self: ['user', 'Бросок увидите только вы'],
};
const VIS_HINT_MASTER_GM = ['view-off', 'Скрыто: игроки увидят только факт броска'];

// ——— Лоток ———
const trays = new WeakMap();
/** Лоток стола (один на стол). null — если WebGL недоступен: тогда броски показывают только тосты. */
export function diceTray(ctx) {
  if (trays.has(ctx)) return trays.get(ctx);
  const t = webgl() ? createTray(ctx) : null;
  trays.set(ctx, t);
  return t;
}

function createTray(ctx) {
  const node = el(`<div class="dice-tray hidden" role="region" aria-label="Лоток с кубами" data-state="empty">
    <div class="dt-felt">
      <canvas class="dt-canvas" aria-hidden="true"></canvas>
      <div class="dt-top">
        <span class="dt-lead"></span>
        <div class="dt-summary" aria-live="polite"><b></b><small></small></div>
        <button class="icon-btn icon-btn-sm dt-clear" data-dt="clear" data-tip="Очистить лоток" aria-label="Очистить лоток">${icon('cancel-01', 20)}</button>
      </div>
      <div class="dt-empty">${icon('dice-faces-06', 36)}<b>Лоток пуст</b><span>Нажмите на кубы слева — они повиснут здесь. Затем бросок.</span></div>
      <button class="dt-go" data-dt="roll">Бросить ${icon('arrow-right-02', 20)}</button>
      <div class="dt-bottom"><p class="dt-rolls"></p><div class="dt-foot"><span class="dt-foot-ic"></span><span class="dt-foot-text"></span></div></div>
    </div>
  </div>`);
  ctx.root.append(node);
  const canvas = node.querySelector('.dt-canvas');
  const $ = (s) => node.querySelector(s);
  let stage = null, mode = 'empty', wantKey = '', result = null;

  const ensure = () => { if (!stage) stage = createDiceStage(canvas, { insetTop: 64, insetBottom: 36, hover: true }); return stage; };
  const show = () => { if (node.classList.contains('hidden')) { node.classList.remove('hidden'); ensure(); stage.resize(); } else ensure(); };
  const hide = () => node.classList.add('hidden');
  const setMode = (m) => { mode = m; node.dataset.state = m; };

  node.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dt]');
    if (!b) return;
    const a = b.dataset.dt;
    if (a === 'clear') ctx.panels.action('dice-clear', b, e);
    if (a === 'roll') ctx.panels.action('dice-roll', b, e);
    if (a === 'reroll') ctx.panels.action('dice-reroll', b, e);
  });
  const onResize = () => stage?.resize();
  addEventListener('resize', onResize);

  function visFoot(vis) {
    const [ic, text] = ctx.isMaster && vis === 'gm' ? VIS_HINT_MASTER_GM : VIS_HINT[vis] || VIS_HINT.all;
    $('.dt-foot-ic').innerHTML = icon(ic, 16);
    $('.dt-foot-text').textContent = text;
  }
  function paintReady(pool) {
    $('.dt-lead').innerHTML = '';
    $('.dt-summary b').textContent = poolLabel(pool.dice);
    const one20 = pool.dice[20] === 1;
    const adv = pool.adv ? (one20 ? (pool.adv === 'adv' ? 'с преимуществом' : 'с помехой') : `${pool.adv === 'adv' ? 'преимущество' : 'помеха'} — только для одного к20`) : '';
    $('.dt-summary small').textContent = [pool.mod ? fmtMod(pool.mod) : 'без модификатора', adv].filter(Boolean).join(' · ');
    visFoot(pool.vis || 'all');
    $('.dt-rolls').innerHTML = '';
  }
  function paintResult() {
    if (!result) return;
    const { entry, results, dropped, mod, label } = result;
    $('.dt-lead').innerHTML = result.reroll ? `<button class="icon-btn icon-btn-sm" data-dt="reroll" data-tip="Перебросить" aria-label="Перебросить">${icon('reload', 20)}</button>` : '';
    $('.dt-summary b').textContent = entry.total;
    const blind = entry.total === '?';
    const values = blind ? '?' : results.map((r) => r.value).join(' + ') + (mod ? ` ${fmtMod(mod)}` : '');
    // С преимуществом/помехой вместо сложения — режим: какой к20 отброшен, видно в строке кубов внизу.
    const how = dropped && !blind ? `${result.adv === 'dis' ? 'с помехой' : 'с преимуществом'}${mod ? ` ${fmtMod(mod)}` : ''}` : values;
    $('.dt-summary small').textContent = `${label} · ${how}`;
    const vis = entry.vis || 'all';
    $('.dt-foot-ic').innerHTML = icon(ctx.isMaster && vis === 'gm' ? 'view-off' : (VIS_HINT[vis] || VIS_HINT.all)[0], 16);
    $('.dt-foot-text').textContent = `${userById(entry.userId)?.name || 'Вы'} · ${timeAgo(entry.at)}`;
    $('.dt-rolls').innerHTML = blind ? '' : rollsLine(results, dropped);
  }

  return {
    /** Виджет «Кубы» перерисован: лоток стоит рядом с рейкой и держит выбранные кубы. */
    syncPool(pool) {
      if (ctx.ui.widget !== 'dice') { hide(); return; }
      show();
      const want = Object.entries(pool?.dice || {}).flatMap(([s, n]) => Array.from({ length: n }, () => (Number(s) === 100 ? ['d10t', 'd10u'] : [Number(s)])).flat());
      const key = want.join(',');
      // Итог лежит, пока набор не поменяли: новый куб — новый набор в лотке.
      if ((mode === 'result' || mode === 'rolling') && want.length && key !== wantKey) { stage.clear(); result = null; setMode('ready'); }
      wantKey = key;
      if (mode === 'empty' || mode === 'ready') {
        const skin = skinById(pool?.skin);
        const need = new Map();
        for (const k of want) need.set(k, (need.get(k) || 0) + 1);
        for (const k of stage.kinds()) need.set(k, (need.get(k) || 0) - 1);
        for (const [k, n] of need) {
          for (let i = 0; i < n; i++) stage.add(k, { skin });
          for (let i = 0; i < -n; i++) stage.remove(k);
        }
        setMode(want.length ? 'ready' : 'empty');
        if (want.length) paintReady(pool);
      } else if (mode === 'result') paintResult();
    },
    /** Свой бросок из рейки катится в лотке. */
    roll({ entry, results, dropped, mod = 0, label, adv = null, skin, reroll = false }) {
      if (!results?.length) return;
      show();
      setMode('rolling');
      result = null;
      const targets = targetsOf(results, dropped);
      const opts = { skin: skinById(skin) };
      const done = reducedMotion() ? stage.place(targets, opts) : stage.throw(targets, opts);
      done.then(() => {
        if (mode !== 'rolling' || result) return; // лоток очистили или уже катится другой бросок
        result = { entry, results, dropped, mod, label, adv, reroll };
        setMode('result');
        paintResult();
      });
    },
    /** Крестик: кубы и итог уходят из лотка. */
    clear() {
      stage?.clear();
      result = null; wantKey = '';
      setMode('empty');
    },
    hide,
    destroy() { removeEventListener('resize', onResize); stage?.destroy(); node.remove(); trays.delete(ctx); },
  };
}

// ——— Кубы на столе ———
const floors = new WeakMap();
/** Слой кубов поверх карты (один на стол). null — без WebGL. */
export function diceFloor(ctx) {
  if (floors.has(ctx)) return floors.get(ctx);
  const f = webgl() ? createFloor(ctx) : null;
  floors.set(ctx, f);
  return f;
}

function createFloor(ctx) {
  const node = el('<div class="dice-floor" aria-hidden="true"><canvas class="df-canvas"></canvas></div>');
  const chrome = ctx.root.querySelector('.chrome');
  if (chrome) chrome.before(node); else ctx.root.append(node);
  const canvas = node.querySelector('.df-canvas');
  let stage = null;
  const ensure = () => { if (!stage) stage = createDiceStage(canvas, { insetTop: 100, insetBottom: 110, maxDpr: 1.5 }); return stage; };
  const onResize = () => stage?.resize();
  addEventListener('resize', onResize);

  return {
    /** Бросок падает на стол: кубы катятся по карте, сверху — кто и сколько, потом всё тает. */
    roll({ entry, results, dropped, skin, mine = false }) {
      if (!results?.length) return;
      ensure();
      const targets = targetsOf(results, dropped);
      const opts = { skin: skinById(skin), keep: true, group: entry.id, lane: (Math.random() - 0.5) * 0.7, speed: 1.08 };
      const done = reducedMotion() ? stage.place(targets, opts) : stage.throw(targets, opts);
      done.then(({ top }) => {
        const u = userById(entry.userId);
        const rolls = entry.total === '?' ? '' : rollsLine(results, dropped);
        const chip = el(`<div class="df-label">${userAvatar(u, 'xs')}<span class="df-text"><span class="ellipsis">${esc(mine ? 'Вы' : u?.name || 'Кто-то')} · ${esc(entry.label)}</span>${rolls ? `<small class="df-rolls">${rolls}</small>` : ''}</span><b>${esc(entry.total)}</b></div>`);
        chip.style.left = `${top[0]}px`;
        chip.style.top = `${Math.max(96, top[1])}px`;
        node.append(chip);
        stage.fade(entry.id, FLOOR_HOLD);
        setTimeout(() => chip.classList.add('out'), FLOOR_HOLD);
        setTimeout(() => chip.remove(), FLOOR_HOLD + 700);
      });
    },
    destroy() { removeEventListener('resize', onResize); stage?.destroy(); node.remove(); floors.delete(ctx); },
  };
}
