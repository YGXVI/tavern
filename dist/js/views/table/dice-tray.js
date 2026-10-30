// Лоток с объёмными кубами (TASK-092): как в референсе Owlbear Rodeo — тёмное сукно в деревянной рамке.
// Пока открыт виджет «Кубы», лоток стоит рядом: выбранные кубы падают в него, «Бросить» отправляет их катиться.
// Броски из листа, атак и спасбросков, а также открытые броски других участников катятся в лотке,
// который сам скрывается через несколько секунд. Значения задаёт общий движок — анимация ложится на них.
import { el, esc } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { userById } from '../../core/campaign.js';
import { createDiceStage, splitD100 } from './dice3d.js';

const trays = new WeakMap();
const HIDE_AFTER = 3500;
const reducedMotion = () => matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const GOLD = [0.95, 0.62, 0.18], RED = [0.85, 0.16, 0.1];

/** Лоток стола (один на стол). null — если WebGL недоступен: тогда остаются тосты и плоский лоток виджета. */
export function diceTray(ctx) {
  if (trays.has(ctx)) return trays.get(ctx);
  const t = createTray(ctx);
  trays.set(ctx, t);
  return t;
}

/** Кубы броска для сцены: к100 — две к10, отброшенный к20 преимущества — полупрозрачный. */
export function targetsOf(results = [], dropped = null) {
  const out = [];
  const crit = results.length === 1 && results[0].sides === 20;
  for (const r of results) {
    if (r.sides === 100) out.push(...splitD100(r.value));
    else out.push({ kind: r.sides, value: r.value, glow: crit && r.value === 20 ? GOLD : crit && r.value === 1 ? RED : null });
  }
  if (dropped) out.push({ kind: dropped.sides, value: dropped.value, dropped: true });
  return out;
}

function createTray(ctx) {
  const probe = document.createElement('canvas').getContext('webgl');
  if (!probe) return null;
  probe.getExtension('WEBGL_lose_context')?.loseContext();
  const node = el(`<div class="dice-tray hidden" role="region" aria-label="Лоток с кубами">
    <div class="dt-frame"><div class="dt-felt">
      <canvas class="dt-canvas" aria-hidden="true"></canvas>
      <div class="dt-head">
        <button class="icon-btn icon-btn-sm dt-reroll hidden" data-dt="reroll" data-tip="Перебросить" aria-label="Перебросить">${icon('reload', 18)}</button>
        <div class="dt-total" aria-live="polite"></div>
        <button class="icon-btn icon-btn-sm" data-dt="close" aria-label="Закрыть лоток">${icon('cancel-01', 18)}</button>
      </div>
      <p class="dt-hint hidden">Кликните куб в виджете — он упадёт в лоток</p>
      <button class="dt-roll hidden" data-dt="roll">${icon('dice-faces-06', 16)}Бросить</button>
    </div></div>
  </div>`);
  ctx.root.append(node);
  const canvas = node.querySelector('.dt-canvas');
  const totalEl = node.querySelector('.dt-total');
  let stage = null, hideTimer = 0, hovered = false, mode = 'idle', lastEntryId = null, wantKey = '';

  const ensureStage = () => {
    if (!stage) stage = createDiceStage(canvas, { insetTop: 64 });
    return stage;
  };
  const show = () => {
    clearTimeout(hideTimer); hideTimer = 0;
    if (node.classList.contains('hidden')) { node.classList.remove('hidden'); stage?.resize(); }
    ensureStage();
  };
  const hide = () => {
    clearTimeout(hideTimer); hideTimer = 0;
    node.classList.add('hidden');
  };
  /** Скрыть через несколько секунд (если виджет «Кубы» закрыт и мышь не над лотком). Уже назначенное не продлевается. */
  const scheduleHide = () => {
    if (hideTimer || ctx.ui.widget === 'dice' || node.classList.contains('hidden')) return;
    hideTimer = setTimeout(() => { hideTimer = 0; if (hovered || ctx.ui.widget === 'dice') return; hide(); }, HIDE_AFTER);
  };
  node.addEventListener('pointerenter', () => { hovered = true; clearTimeout(hideTimer); });
  node.addEventListener('pointerleave', () => { hovered = false; if (mode === 'result') scheduleHide(); });
  node.addEventListener('pointerenter', () => { clearTimeout(hideTimer); hideTimer = 0; });
  node.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dt]');
    if (!b) return;
    const a = b.dataset.dt;
    if (a === 'close') { if (ctx.ui.widget === 'dice') ctx.panels.action('w-close'); hide(); }
    if (a === 'roll') ctx.panels.action('dice-roll', b, e);
    if (a === 'reroll') ctx.panels.action('dice-reroll', b, e);
  });
  const onResize = () => stage?.resize();
  addEventListener('resize', onResize);

  function setHead({ total = '', label = '', who = '', reroll = false } = {}) {
    totalEl.innerHTML = total === '' ? '' : `<b>${esc(total)}</b><small>${who ? `${esc(who)} · ` : ''}${esc(label)}</small>`;
    node.querySelector('.dt-reroll').classList.toggle('hidden', !reroll);
  }
  function setIdleUi(count) {
    node.querySelector('.dt-roll').classList.toggle('hidden', !count || mode !== 'idle');
    node.querySelector('.dt-hint').classList.toggle('hidden', !!count || mode !== 'idle');
  }

  return {
    /** Виджет «Кубы» открыт или закрыт: лоток стоит рядом с ним, а выбранные кубы лежат в лотке. */
    syncPool(pool) {
      const open = ctx.ui.widget === 'dice';
      if (!open) { if (mode === 'idle') hide(); else if (mode === 'result') scheduleHide(); return; }
      show();
      // к100 в лотке — две к10: десятки и единицы.
      const want = Object.entries(pool?.dice || {}).flatMap(([s, n]) => Array.from({ length: n }, () => (Number(s) === 100 ? ['d10t', 'd10u'] : [Number(s)])).flat());
      const key = want.join(',');
      // Результат броска лежит, пока набор в виджете не поменяли: новый куб — новый набор в лотке.
      if (mode !== 'idle' && want.length && key !== wantKey) { mode = 'idle'; stage.clear(); setHead(); }
      wantKey = key;
      if (mode === 'idle') {
        const hue = userById(ctx.userId)?.hue;
        const need = new Map();
        for (const k of want) need.set(k, (need.get(k) || 0) + 1);
        for (const k of stage.kinds()) need.set(k, (need.get(k) || 0) - 1);
        for (const [k, n] of need) {
          for (let i = 0; i < n; i++) stage.add(k, { hue });
          for (let i = 0; i < -n; i++) stage.remove(k);
        }
      }
      setIdleUi(want.length);
    },
    /**
     * Показать бросок. entry — запись журнала; results/dropped — выпавшие кубы (их знает только тот,
     * кому бросок виден: свой бросок или открытый бросок другого участника).
     */
    roll({ entry, results, dropped, mine = false, reuse = false }) {
      if (!results?.length) return;
      show();
      mode = 'rolling';
      lastEntryId = entry.id;
      setIdleUi(0);
      const u = userById(entry.userId);
      setHead();
      const targets = targetsOf(results, dropped);
      // Кубы из лотка летят сами, только если бросок из виджета; остальные броски вылетают новыми кубами.
      const opts = { hue: u?.hue, fresh: !reuse };
      const done = reducedMotion() ? stage.place(targets, opts) : stage.throw(targets, opts);
      done.then(() => {
        if (lastEntryId !== entry.id) return; // уже катится следующий бросок
        mode = 'result';
        setHead({ total: entry.total, label: entry.label, who: mine ? '' : u?.name || '', reroll: mine && ctx.ui.lastRoll?.entry?.id === entry.id });
        if (!hovered) scheduleHide();
      });
    },
    hide,
    get visible() { return !node.classList.contains('hidden'); },
    destroy() { removeEventListener('resize', onResize); stage?.destroy(); node.remove(); trays.delete(ctx); },
  };
}
