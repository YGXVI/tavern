// Ввод на карте: мышь, тачпад, касания, клавиатура. Камера + инструменты.
// Колесо мыши масштабирует к курсору, жест двумя пальцами на тачпаде двигает карту,
// щипок — масштаб; средняя/правая кнопка или пробел + перетаскивание — панорама.
import { uid, clamp } from '../../core/dom.js';
import { bus } from '../../core/store.js';
import {
  cellOf, cellCenter, footprintAt, footprintCenter, findPath, reachable, gridDims, gridSize, key, unkey,
  cellDistance, footprintGap, moveBlocked, distToSegment, footprintCells,
} from '../../rules/geometry.js';
import { sizeById, TEMPLATES } from '../../data/rules.js';
import { tokenStats, characterOf } from '../../core/campaign.js';
import { closePopover, popoverOpen, closeTopModal, hasModal } from '../../ui/kit.js';
import { currentEntry } from './combat.js';
import { renderChrome } from './chrome.js';

const DRAG_THRESHOLD = 4;
const isTyping = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;

export function attachInput(ctx) {
  const vp = ctx.viewport;
  const pointers = new Map();
  let g = null; // текущий жест
  let space = false;
  let lastClick = { t: 0, id: null, x: 0, y: 0 };

  const toolId = () => ctx.ui.tool;
  const W = (e) => ctx.camera.toWorld(e.clientX, e.clientY);

  function hit(e) {
    const t = e.target;
    const tok = t.closest?.('[data-token]');
    if (tok) return { kind: 'token', id: tok.dataset.token };
    for (const [attr, kind] of [['data-door', 'door'], ['data-light', 'light'], ['data-pin', 'pin'], ['data-portal', 'portal'], ['data-trap', 'trap'], ['data-handle', 'handle'], ['data-wall', 'wall'], ['data-calib', 'calib']]) {
      const n = t.closest?.(`[${attr}]`);
      if (n) return { kind, id: n.getAttribute(attr), node: n };
    }
    return { kind: 'empty' };
  }

  // ——— Колесо: масштаб и прокрутка ———
  vp.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (hasModal()) return;
    const mouseWheel = e.deltaMode !== 0 || (Math.abs(e.deltaY) >= 40 && e.deltaX === 0 && Number.isInteger(e.deltaY));
    if (e.ctrlKey || e.metaKey) {
      // Щипок на тачпаде или Ctrl + колесо.
      ctx.camera.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (mouseWheel ? 0.0025 : 0.012)));
    } else if (mouseWheel) {
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      ctx.camera.zoomAt(e.clientX, e.clientY, Math.exp(-dy * 0.0016));
    } else {
      ctx.camera.pan(-e.deltaX, -e.deltaY);
    }
    closePopover();
    ctx.hoverWorld = W(e);
  }, { passive: false });

  vp.addEventListener('contextmenu', (e) => e.preventDefault());

  // ——— Указатель ———
  vp.addEventListener('pointerdown', (e) => {
    if (ctx.ui.lookLock && !ctx.isMaster) return;
    vp.focus({ preventScroll: true });
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { vp.setPointerCapture(e.pointerId); } catch { /* */ }
    if (pointers.size === 2) {
      cancelGesture();
      const [a, b] = [...pointers.values()];
      g = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), z0: ctx.camera.z, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      return;
    }
    if (pointers.size > 2 || !ctx.scene) return;
    const start = { x: e.clientX, y: e.clientY };
    if (e.button === 1 || (space && e.button === 0)) { g = { type: 'pan', last: start }; vp.classList.add('panning'); e.preventDefault(); return; }
    if (e.button === 2) { g = { type: 'rpan', last: start, start, moved: false, target: hit(e), w: W(e) }; return; }
    if (e.button !== 0) return;
    const w = W(e);
    const target = hit(e);
    // Alt + клик — пинг. Исключение: мастер тянет токен с Alt — свободное перемещение сквозь стены.
    const freeDrag = target.kind === 'token' && ctx.isMasterView && ['move', 'select'].includes(toolId());
    if (e.altKey && toolId() !== 'walls' && !freeDrag) { g = { type: 'ping', start, w, look: e.shiftKey && ctx.isMaster }; return; }
    const tool = TOOLS[toolId()] || TOOLS.move;
    g = { type: 'tool', tool, start, last: start, w0: w, moved: false, target, shift: e.shiftKey, alt: e.altKey, pointerType: e.pointerType };
    tool.down?.(ctx, g, w, e);
  });

  vp.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (p) { p.x = e.clientX; p.y = e.clientY; }
    const w = W(e);
    ctx.hoverWorld = w;
    if (!g) { (TOOLS[toolId()] || TOOLS.move).hover?.(ctx, w, e); return; }
    if (g.type === 'pinch') {
      const pts = [...pointers.values()];
      if (pts.length < 2) return;
      const [a, b] = pts;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      ctx.camera.pan(mid.x - g.mid.x, mid.y - g.mid.y);
      ctx.camera.zoomAt(mid.x, mid.y, (g.z0 * (d / g.d0)) / ctx.camera.z);
      g.mid = mid;
      return;
    }
    if (g.type === 'pan' || g.type === 'rpan' || g.panFallback) {
      const dx = e.clientX - g.last.x, dy = e.clientY - g.last.y;
      if (g.type === 'rpan' && !g.moved && Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) < DRAG_THRESHOLD) return;
      if (g.type === 'rpan' || g.panFallback) { g.moved = true; vp.classList.add('panning'); }
      ctx.camera.pan(dx, dy);
      g.last = { x: e.clientX, y: e.clientY };
      return;
    }
    if (g.type === 'ping') return;
    if (!g.moved && Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) < DRAG_THRESHOLD) return;
    g.moved = true;
    g.last = { x: e.clientX, y: e.clientY };
    g.tool.move?.(ctx, g, w, e);
  });

  const finish = (e, cancelled = false) => {
    pointers.delete(e.pointerId);
    try { vp.releasePointerCapture(e.pointerId); } catch { /* */ }
    vp.classList.remove('panning');
    if (!g) return;
    const gg = g;
    if (gg.type === 'pinch') { if (pointers.size === 0) g = null; return; }
    g = null;
    if (cancelled) { gg.tool?.cancel?.(ctx, gg); return; }
    const w = W(e);
    if (gg.type === 'ping') { ctx.ping(gg.w.x, gg.w.y, { look: gg.look }); return; }
    if (gg.type === 'rpan') { if (!gg.moved) ctx.panels.contextMenu(gg.target, gg.w, { x: e.clientX, y: e.clientY }); return; }
    if (gg.type === 'pan') return;
    if (gg.panFallback && gg.moved) return;
    if (gg.moved) gg.tool.up?.(ctx, gg, w, e);
    else {
      const now = performance.now();
      const dbl = now - lastClick.t < 320 && lastClick.id === (gg.target.id || 'empty') && Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 8;
      lastClick = { t: now, id: gg.target.id || 'empty', x: e.clientX, y: e.clientY };
      gg.tool.click?.(ctx, gg, w, e, dbl);
      gg.tool.up?.(ctx, gg, w, e);
    }
  };
  vp.addEventListener('pointerup', (e) => finish(e));
  vp.addEventListener('pointercancel', (e) => finish(e, true));
  vp.addEventListener('pointerleave', () => { if (!g) { ctx.ui.brush = null; ctx.ui.wallGhost = ctx.ui.wallChain ? ctx.ui.wallGhost : null; ctx.invalidate('overlay'); } });

  function cancelGesture() { if (g?.tool) g.tool.cancel?.(ctx, g); g = null; }
  ctx.cancelGesture = cancelGesture;

  // ——— Клавиатура ———
  const onKey = (e) => {
    if (isTyping(e)) return;
    if (!document.body.contains(vp)) return;
    if (e.code === 'Space' && !e.repeat) { space = true; vp.classList.add('grab'); if (e.target === vp || e.target === document.body) e.preventDefault(); }
    if (hasModal()) { if (e.key === 'Escape') closeTopModal(); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? ctx.panels.redo() : ctx.panels.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); ctx.panels.redo(); return; }
    if (mod) return;
    if (e.key === 'Escape') {
      if (popoverOpen()) { closePopover(); return; }
      if (g) { cancelGesture(); ctx.invalidate('overlay', 'tokens'); return; }
      if (ctx.ui.wallChain) { ctx.ui.wallChain = null; ctx.ui.wallGhost = null; ctx.invalidate('overlay'); return; }
      if (ctx.ui.template || ctx.ui.ruler) { ctx.clearMeasure(); return; }
      if (ctx.ui.selection.size) { ctx.select([]); return; }
      if (ctx.ui.viewAs) { ctx.setViewAs(null); return; }
      if (toolId() !== 'move') { ctx.setTool('move'); return; }
      return;
    }
    if (e.key === 'Enter' && ctx.ui.wallChain) { ctx.ui.wallChain = null; ctx.ui.wallGhost = null; ctx.invalidate('overlay'); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && ctx.isMasterView) {
      if (ctx.ui.selectedWall) { ctx.panels.deleteWall(ctx.ui.selectedWall); return; }
      if (ctx.ui.selectedLight) { ctx.panels.deleteLight(ctx.ui.selectedLight); return; }
      if (ctx.ui.selection.size) { ctx.panels.deleteTokens([...ctx.ui.selection]); return; }
    }
    if (e.key.startsWith('Arrow') && ctx.ui.selection.size) { e.preventDefault(); nudge(ctx, e.key); return; }
    const k = e.key.toLowerCase();
    const map = { v: 'move', м: 'move', r: 'measure', к: 'measure', d: 'draw', в: 'draw' };
    if (map[k]) { ctx.setTool(map[k]); return; }
    if ((k === 'p' || k === 'з')) { ctx.setTool(ctx.isMaster ? 'measure' : 'ping'); if (!ctx.isMaster) return; }
    if (ctx.isMasterView) {
      const mm = { s: 'select', ы: 'select', f: 'fog', а: 'fog', w: 'walls', ц: 'walls', l: 'lights', д: 'lights', t: 'terrain', е: 'terrain', g: 'gm', п: 'gm' };
      if (mm[k]) { ctx.setTool(mm[k]); return; }
      if ((k === 'h' || k === 'р') && ctx.ui.selection.size) { ctx.panels.toggleHidden([...ctx.ui.selection]); return; }
    }
    if (k === '=' || k === '+') ctx.camera.zoomStep(1);
    if (k === '-' || k === '_') ctx.camera.zoomStep(-1);
    if (k === '0') ctx.fitScene(true);
    if (k === '?' || (e.shiftKey && e.code === 'Slash')) ctx.panels.help();
  };
  const onKeyUp = (e) => { if (e.code === 'Space') { space = false; vp.classList.remove('grab'); } };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);

  // ——— Общие действия контроллера ———
  ctx.select = (ids, { focus = false } = {}) => {
    ctx.ui.selection = new Set(ids);
    ctx.ui.selectedWall = null; ctx.ui.selectedLight = null;
    updateReach(ctx);
    ctx.invalidate('tokens', 'areas', 'chrome', 'panels');
    if (focus && ids.length === 1) { const t = ctx.scene.tokens.find((x) => x.id === ids[0]); if (t) ctx.camera.centerOn(t.x, t.y); }
  };
  ctx.setTool = (tool, sub) => {
    if (!ctx.isMasterView && ['select', 'fog', 'walls', 'lights', 'terrain', 'gm', 'grid', 'text'].includes(tool)) return;
    const prev = ctx.ui.tool;
    ctx.ui.tool = tool;
    if (sub) ctx.ui.sub[tool] = sub;
    if (prev !== tool) {
      ctx.ui.wallChain = null; ctx.ui.wallGhost = null; ctx.ui.brush = null; ctx.ui.selectedWall = null; ctx.ui.selectedLight = null; ctx.ui.trapCells = null;
      if (tool !== 'measure') { ctx.clearMeasure(false); }
      // Сетка: предпросмотр меняет сцену только в памяти; без «Готово» возвращаем как было.
      if (prev === 'grid' && ctx.ui.gridBefore && ctx.scene) { Object.assign(ctx.scene.grid, ctx.ui.gridBefore); }
      if (tool === 'grid') { ctx.ui.gridBefore = structuredClone(ctx.scene.grid); initCalib(ctx); } else { ctx.ui.calib = null; ctx.ui.gridBefore = null; }
      if (['walls', 'lights', 'fog', 'terrain', 'gm', 'grid'].includes(tool)) ctx.ui.selection.clear();
      closePopover();
    }
    vp.dataset.tool = tool;
    ctx.invalidate('all');
  };
  ctx.clearMeasure = (render = true) => {
    if (ctx.ui.ruler) ctx.sendRuler(null);
    if (ctx.ui.template) ctx.sendTemplate(null);
    ctx.ui.ruler = null; ctx.ui.template = null;
    closePopover();
    if (render) ctx.invalidate('overlay', 'areas');
  };
  ctx.snapCenter = (w) => snapToCellCenter(ctx, w);
  ctx.setViewAs = (characterId) => { ctx.ui.viewAs = characterId; ctx.ui.selection.clear(); ctx.invalidate('all'); };
  vp.dataset.tool = 'move';

  return () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUp);
  };
}

// ——— Помощники ———
function sceneGrid(ctx) { return ctx.scene.grid; }
function cellsOfToken(t) { return sizeById(t.size).cells; }
function dims(ctx) { const s = ctx.scene; return gridDims(s.grid, s.map.width, s.map.height); }

function snapToCellCenter(ctx, w) { const g = sceneGrid(ctx); const { c, r } = cellOf(g, w.x, w.y); return cellCenter(g, c, r); }
function snapToVertex(ctx, w, step = 1) {
  const g = sceneGrid(ctx), s = gridSize(g) * step, ox = g.offsetX || 0, oy = g.offsetY || 0;
  return { x: ox + Math.round((w.x - ox) / s) * s, y: oy + Math.round((w.y - oy) / s) * s };
}

/** Клетки, где стоят враждебные существа (через них нельзя пройти). */
function hostileCells(ctx, mover) {
  const out = new Set();
  const moverHostile = mover.kind === 'foe';
  for (const t of ctx.scene.tokens) {
    if (t.id === mover.id || t.hidden) continue;
    const enemy = moverHostile ? t.kind === 'hero' : t.kind === 'foe';
    if (!enemy) continue;
    const st = tokenStats(ctx.c, t);
    if (st.hpMax > 0 && st.hp <= 0) continue;
    const n = cellsOfToken(t);
    const fp = footprintAt(sceneGrid(ctx), t.x, t.y, n);
    for (const x of footprintCells(fp.c, fp.r, n)) out.add(key(x.c, x.r));
  }
  return out;
}

function moveOpts(ctx, t, { ignoreWalls = false } = {}) {
  const s = ctx.scene;
  const { cols, rows } = dims(ctx);
  const blocked = new Set(s.terrain?.blocked || []);
  if (!ctx.isMaster) for (const k of hostileCells(ctx, t)) blocked.add(k);
  return { walls: ignoreWalls ? [] : s.walls, difficult: new Set(s.terrain?.difficult || []), blocked, cols, rows, n: cellsOfToken(t), rule: ctx.c.settings.diagonal || '5' };
}

/** Сколько футов осталось у токена в текущем ходу (null — не его ход / не бой). */
export function movementLeft(ctx, t) {
  const cur = currentEntry(ctx.c, ctx.scene);
  if (!cur || cur.tokenId !== t.id) return null;
  const st = tokenStats(ctx.c, t);
  return Math.max(0, (st.speed || 30) - (ctx.c.combat.moved?.[t.id] || 0));
}

/** Подсветка досягаемости: свой герой в свой ход. */
export function updateReach(ctx) {
  ctx.ui.reach = null;
  if (ctx.ui.selection.size !== 1 || !ctx.scene) return;
  const t = ctx.scene.tokens.find((x) => x.id === [...ctx.ui.selection][0]);
  if (!t || !ctx.canControl(t)) return;
  const left = movementLeft(ctx, t);
  if (left === null || left <= 0) return;
  const g = sceneGrid(ctx), n = cellsOfToken(t);
  const fp = footprintAt(g, t.x, t.y, n);
  const steps = Math.floor(left / (g.feet || 5));
  ctx.ui.reach = reachable(g, fp, steps, moveOpts(ctx, t));
}

function nudge(ctx, k) {
  const d = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[k];
  const g = sceneGrid(ctx), s = gridSize(g);
  const moves = [];
  for (const id of ctx.ui.selection) {
    const t = ctx.scene.tokens.find((x) => x.id === id);
    if (!t || !ctx.canControl(t)) continue;
    const to = { x: t.x + d[0] * s, y: t.y + d[1] * s };
    if (!ctx.isMaster && moveBlocked(t, to, ctx.scene.walls)) { ctx.toast({ title: 'Там стена', icon: 'path' }); continue; }
    moves.push({ id, from: { x: t.x, y: t.y }, to });
  }
  if (moves.length) commitMoves(ctx, moves, null);
}

/** Записать перемещение (с отменой) и расход движения в бою. */
function commitMoves(ctx, moves, leaderCost) {
  const leader = moves[0];
  ctx.mutateScene((s, c) => {
    for (const m of moves) { const t = s.tokens.find((x) => x.id === m.id); if (t) { t.x = m.to.x; t.y = m.to.y; } }
    if (leaderCost != null && c.combat.active) {
      const cur = currentEntry(c, s);
      if (cur?.tokenId === leader.id) c.combat.moved[leader.id] = (c.combat.moved[leader.id] || 0) + leaderCost;
    }
  }, {
    label: 'Перемещение',
    undo: (s) => { for (const m of moves) { const t = s.tokens.find((x) => x.id === m.id); if (t) { t.x = m.from.x; t.y = m.from.y; } } },
    redo: (s) => { for (const m of moves) { const t = s.tokens.find((x) => x.id === m.id); if (t) { t.x = m.to.x; t.y = m.to.y; } } },
  });
}
export { commitMoves };

function initCalib(ctx) {
  const g = sceneGrid(ctx), s = gridSize(g);
  const v = ctx.camera.viewRect();
  const c = Math.max(0, Math.round((v.x + v.w / 2 - (g.offsetX || 0)) / s) - 1);
  const r = Math.max(0, Math.round((v.y + v.h / 2 - (g.offsetY || 0)) / s) - 1);
  ctx.ui.calib = { x: (g.offsetX || 0) + c * s, y: (g.offsetY || 0) + r * s, size: s };
}

// ——— Инструменты ———
const tokenTool = {
  down(ctx, g, w) {
    const tg = g.target;
    if (tg.kind === 'token') {
      const t = ctx.scene.tokens.find((x) => x.id === tg.id);
      if (!t) return;
      if (!ctx.canControl(t)) { g.noDrag = true; return; }
      if (g.shift) { const sel = new Set(ctx.ui.selection); sel.has(t.id) ? sel.delete(t.id) : sel.add(t.id); ctx.select([...sel]); g.noDrag = true; return; }
      if (!ctx.ui.selection.has(t.id)) ctx.select([t.id]);
      const group = [...ctx.ui.selection].map((id) => ctx.scene.tokens.find((x) => x.id === id)).filter((x) => x && ctx.canControl(x));
      g.drag = { leader: t, items: group.map((x) => ({ id: x.id, x0: x.x, y0: x.y, n: cellsOfToken(x) })) };
      return;
    }
    if (['door', 'light', 'pin', 'portal', 'trap'].includes(tg.kind)) return;
    if (ctx.ui.tool === 'select' || (g.shift && ctx.isMasterView)) { ctx.ui.marquee = { x0: w.x, y0: w.y, x1: w.x, y1: w.y }; g.marquee = true; return; }
    g.panFallback = true;
  },
  move(ctx, g, w, e) {
    if (g.marquee) { ctx.ui.marquee.x1 = w.x; ctx.ui.marquee.y1 = w.y; ctx.invalidate('overlay'); return; }
    if (!g.drag || g.noDrag) return;
    dragTokens(ctx, g, w, e);
  },
  up(ctx, g, w) {
    if (g.marquee) {
      const m = ctx.ui.marquee; ctx.ui.marquee = null;
      const x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1), y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
      const ids = ctx.scene.tokens.filter((t) => ctx.tokenShown(t) && t.x >= x0 && t.x <= x1 && t.y >= y0 && t.y <= y1).map((t) => t.id);
      ctx.select(g.shift ? [...new Set([...ctx.ui.selection, ...ids])] : ids);
      ctx.invalidate('overlay');
      return;
    }
    if (g.drag && g.moved && !g.noDrag) finishDrag(ctx, g);
  },
  click(ctx, g, w, e, dbl) {
    const tg = g.target;
    if (tg.kind === 'token') {
      const t = ctx.scene.tokens.find((x) => x.id === tg.id);
      if (!t) return;
      if (g.alt) { ctx.ping(t.x, t.y, { look: g.shift && ctx.isMaster }); return; }
      if (!g.shift) ctx.select([t.id]);
      if (dbl) ctx.panels.openSheetFor(t);
      return;
    }
    if (tg.kind === 'door') { ctx.panels.doorClick(tg.id, tg.node); return; }
    if (tg.kind === 'pin') { ctx.panels.pinPopover(tg.id, tg.node); return; }
    if (tg.kind === 'portal') { ctx.panels.portalPopover(tg.id, tg.node); return; }
    if (tg.kind === 'trap') { ctx.panels.trapPopover(tg.id, tg.node); return; }
    if (tg.kind === 'light' && ctx.isMasterView) { ctx.setTool('lights'); ctx.ui.selectedLight = tg.id; ctx.panels.lightPopover(tg.id, tg.node); return; }
    if (ctx.ui.selection.size) ctx.select([]);
    closePopover();
  },
  cancel(ctx, g) {
    if (g.drag) { ctx.dragging = null; ctx.ui.drag = null; ctx.sendDrag({ end: true, ids: g.drag.items.map((i) => i.id) }); ctx.invalidate('tokens', 'overlay'); }
    ctx.ui.marquee = null;
  },
};

function dragTokens(ctx, g, w, e) {
  const grid = sceneGrid(ctx);
  const lead = g.drag.items[0].id === g.drag.leader.id ? g.drag.items[0] : g.drag.items.find((i) => i.id === g.drag.leader.id) || g.drag.items[0];
  const leaderTok = ctx.scene.tokens.find((t) => t.id === lead.id);
  const raw = { x: lead.x0 + (w.x - g.w0.x), y: lead.y0 + (w.y - g.w0.y) };
  const free = (e.altKey || g.alt) && ctx.isMaster;
  const positions = new Map();
  let path = null;
  if (free) {
    const dx = raw.x - lead.x0, dy = raw.y - lead.y0;
    for (const it of g.drag.items) positions.set(it.id, { x: it.x0 + dx, y: it.y0 + dy });
    path = { pts: [{ x: lead.x0, y: lead.y0 }, raw], label: '' };
  } else {
    const n = lead.n;
    const from = footprintAt(grid, lead.x0, lead.y0, n);
    let to = footprintAt(grid, raw.x, raw.y, n);
    const { cols, rows } = dims(ctx);
    to = { c: clamp(to.c, 0, cols - n), r: clamp(to.r, 0, rows - n) };
    const opts = moveOpts(ctx, leaderTok);
    let found = findPath(grid, from, to, opts);
    let blocked = false;
    if (!found && ctx.isMaster) { found = findPath(grid, from, to, { ...opts, walls: [], blocked: new Set() }); blocked = true; }
    if (!found) {
      // Игрок упёрся: оставляем последнюю достижимую клетку.
      to = g.lastFp || from;
      found = findPath(grid, from, to, opts) || { cells: [from], cost: 0 };
      blocked = true;
    }
    g.lastFp = to;
    const dc = to.c - from.c, dr = to.r - from.r;
    for (const it of g.drag.items) {
      const f = footprintAt(grid, it.x0, it.y0, it.n);
      positions.set(it.id, footprintCenter(grid, f.c + dc, f.r + dr, it.n));
    }
    const feet = found.cost * (grid.feet || 5);
    const left = movementLeft(ctx, leaderTok);
    let label = `${feet} фт`;
    let over = false;
    if (left !== null) { const rest = left - feet; over = rest < 0; label = over ? `${feet} фт · больше скорости на ${-rest} — рывок?` : `${feet} фт · осталось ${rest}`; }
    else if (found.cells.length > 1) label = `${feet} фт · ${found.cells.length - 1} кл.`;
    if (blocked && ctx.isMaster && feet) label += ' · сквозь стену';
    path = { pts: found.cells.map((cc) => footprintCenter(grid, cc.c, cc.r, n)), label: feet ? label : '', over, blocked: blocked && !ctx.isMaster, cost: feet };
    g.cost = feet;
    g.path = found;
  }
  ctx.dragging = positions;
  ctx.ui.drag = { path };
  ctx.sendDrag({ positions: Object.fromEntries(positions), leader: lead.id, path, ids: [...positions.keys()] });
  ctx.invalidate('tokens', 'overlay');
}

function finishDrag(ctx, g) {
  const positions = ctx.dragging || new Map();
  const items = g.drag.items;
  const moves = items.map((it) => ({ id: it.id, from: { x: it.x0, y: it.y0 }, to: positions.get(it.id) || { x: it.x0, y: it.y0 } }))
    .filter((m) => m.from.x !== m.to.x || m.from.y !== m.to.y);
  const done = () => { ctx.dragging = null; ctx.ui.drag = null; ctx.sendDrag({ end: true, ids: items.map((i) => i.id) }); ctx.invalidate('tokens', 'overlay'); };
  if (!moves.length) { done(); return; }
  const leader = ctx.scene.tokens.find((t) => t.id === g.drag.leader.id);
  // Ловушка на пути: токен останавливается на ней.
  const trapHit = !ctx.ui.viewAs && findTrapOnPath(ctx, leader, g.path);
  if (trapHit && moves.length === 1) {
    const n = cellsOfToken(leader);
    const p = footprintCenter(sceneGrid(ctx), trapHit.cell.c, trapHit.cell.r, n);
    moves[0].to = p;
  }
  // Атака по возможности: игрок уходит из досягаемости врага.
  const threats = !ctx.isMaster && leader.kind === 'hero' && moves.length === 1 ? leavingReach(ctx, leader, moves[0]) : [];
  const commit = () => {
    commitMoves(ctx, moves, g.cost ?? null);
    done();
    if (trapHit) ctx.panels.trapTriggered(trapHit.trap, leader);
    if (threats.length) bus.send('opportunity', { cid: ctx.cid, tokenId: leader.id, foes: threats.map((t) => t.id) });
    checkPortal(ctx, leader, moves[0].to);
    updateReach(ctx);
  };
  if (threats.length && !leader.disengaged) {
    ctx.ui.threat = threats.flatMap((t) => { const n = cellsOfToken(t); const fp = footprintAt(sceneGrid(ctx), t.x, t.y, n); return footprintCells(fp.c, fp.r, n).map((x) => key(x.c, x.r)); });
    ctx.panels.opportunityWarning(leader, threats, {
      go: () => { ctx.ui.threat = null; commit(); },
      disengage: () => { ctx.ui.threat = null; ctx.mutateScene((s) => { const t = s.tokens.find((x) => x.id === leader.id); if (t) t.disengaged = true; }); moves.length && commitMoves(ctx, moves, g.cost ?? null); done(); },
      cancel: () => { ctx.ui.threat = null; done(); },
    });
    ctx.invalidate('areas');
    return;
  }
  commit();
}

function findTrapOnPath(ctx, t, path) {
  if (!path?.cells || t.kind !== 'hero') return null;
  for (const cell of path.cells.slice(1)) {
    for (const tr of ctx.scene.traps || []) {
      if (tr.triggered) continue;
      if (tr.cells.includes(key(cell.c, cell.r))) return { trap: tr, cell };
    }
  }
  return null;
}

function leavingReach(ctx, t, move) {
  const grid = sceneGrid(ctx), n = cellsOfToken(t);
  const a = { ...footprintAt(grid, move.from.x, move.from.y, n), n };
  const b = { ...footprintAt(grid, move.to.x, move.to.y, n), n };
  const out = [];
  for (const f of ctx.scene.tokens) {
    if (f.kind !== 'foe' || f.hidden) continue;
    const st = tokenStats(ctx.c, f);
    if (st.hpMax > 0 && st.hp <= 0) continue;
    if ((st.conditions || []).some((c) => ['incapacitated', 'paralyzed', 'stunned', 'unconscious', 'petrified'].includes(c))) continue;
    const fn = cellsOfToken(f);
    const fo = { ...footprintAt(grid, f.x, f.y, fn), n: fn };
    const reachCells = f.monsterId === 'faceless-spawn' ? 2 : 1;
    if (footprintGap(a, fo) <= reachCells && footprintGap(b, fo) > reachCells) out.push(f);
  }
  return out;
}

function checkPortal(ctx, t, to) {
  const grid = sceneGrid(ctx), n = cellsOfToken(t);
  const fp = footprintAt(grid, to.x, to.y, n);
  for (const p of ctx.scene.portals || []) {
    const pc = cellOf(grid, p.x, p.y);
    if (pc.c >= fp.c && pc.c < fp.c + n && pc.r >= fp.r && pc.r < fp.r + n) { ctx.panels.portalReached(p, t); return; }
  }
}

const measureTool = {
  down(ctx, g, w) {
    const sub = ctx.ui.sub.measure || 'ruler';
    if (sub === 'ruler') {
      const p = g.alt ? w : snapToCellCenter(ctx, w);
      if (g.shift && ctx.ui.ruler) ctx.ui.ruler.pts.push(p);
      else ctx.ui.ruler = { pts: [p, p], color: ctx.isMaster ? 'var(--brand-500)' : 'var(--blue-500)', label: '' };
      closePopover();
      g.mode = 'ruler';
    } else {
      const def = TEMPLATES.find((t) => t.id === sub);
      const size = ctx.ui.sub.templateSize?.[sub] || def.size;
      const origin = sub === 'line' || sub === 'cone' ? snapToVertex(ctx, w, 0.5) : snapToVertex(ctx, w);
      ctx.ui.template = { type: sub, origin, angle: ctx.ui.template?.angle || 0, size, owner: ctx.userId };
      closePopover();
      g.mode = 'template';
    }
    ctx.invalidate('overlay', 'areas');
  },
  move(ctx, g, w) {
    if (g.mode === 'ruler') {
      const r = ctx.ui.ruler;
      r.pts[r.pts.length - 1] = g.alt ? w : snapToCellCenter(ctx, w);
      r.label = rulerLabel(ctx, r.pts);
      if (ctx.ui.shareRuler) ctx.sendRuler(r);
      ctx.invalidate('overlay');
    } else if (g.mode === 'template') {
      const t = ctx.ui.template;
      t.angle = Math.atan2(w.y - t.origin.y, w.x - t.origin.x);
      if (t.type === 'cube') t.angle = Math.round(t.angle / (Math.PI / 2)) * (Math.PI / 2);
      if (ctx.ui.shareRuler) ctx.sendTemplate(t);
      ctx.invalidate('areas');
    }
  },
  up(ctx, g, w, e) {
    if (g.mode === 'ruler') {
      const r = ctx.ui.ruler;
      if (r && (!g.moved || r.pts.length < 2 || (r.pts.at(-1).x === r.pts.at(-2).x && r.pts.at(-1).y === r.pts.at(-2).y)) && !g.shift) { ctx.clearMeasure(); return; }
      r.label = rulerLabel(ctx, r.pts);
      if (ctx.ui.shareRuler) ctx.sendRuler(r);
      ctx.invalidate('overlay');
    } else if (g.mode === 'template') {
      const t = ctx.ui.template;
      if (ctx.ui.shareRuler) ctx.sendTemplate(t);
      ctx.invalidate('areas');
      const sc = ctx.camera.toScreen(t.origin.x, t.origin.y);
      ctx.panels.templatePopover({ x: e.clientX, y: e.clientY }, sc);
    }
  },
};

export function rulerLabel(ctx, pts) {
  const g = sceneGrid(ctx);
  let cells = 0;
  for (let i = 1; i < pts.length; i++) cells += cellDistance(cellOf(g, pts[i - 1].x, pts[i - 1].y), cellOf(g, pts[i].x, pts[i].y), ctx.c.settings.diagonal);
  const feet = cells * (g.feet || 5);
  return `${feet} фт · ${cells} ${cells % 10 === 1 && cells % 100 !== 11 ? 'клетка' : cells % 10 >= 2 && cells % 10 <= 4 && (cells % 100 < 10 || cells % 100 >= 20) ? 'клетки' : 'клеток'}`;
}

const pingTool = {
  click(ctx, g, w) { ctx.ping(w.x, w.y, { look: g.shift && ctx.isMaster }); },
  down(ctx, g, w) { if (g.target.kind === 'token') ctx.select([g.target.id]); },
};

const drawTool = {
  down(ctx, g, w) {
    const sub = ctx.ui.sub.draw || 'pen';
    if (sub === 'erase') { g.erase = true; eraseAt(ctx, w); return; }
    const hue = ctx.user.hue ?? 32;
    ctx.ui.liveStroke = { color: ctx.isMaster ? '#e9b052' : `hsl(${hue} 80% 65%)`, pts: [w] };
    ctx.invalidate('overlay');
  },
  move(ctx, g, w) {
    if (g.erase) { eraseAt(ctx, w); return; }
    const s = ctx.ui.liveStroke; if (!s) return;
    const last = s.pts.at(-1);
    if (Math.hypot(w.x - last.x, w.y - last.y) * ctx.camera.z < 3) return;
    s.pts.push(w);
    ctx.invalidate('overlay');
  },
  up(ctx) {
    const s = ctx.ui.liveStroke; ctx.ui.liveStroke = null;
    if (!s || s.pts.length < 2) { ctx.invalidate('overlay'); return; }
    const d = { id: uid('d-'), type: 'line', color: s.color, pts: s.pts.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })), author: ctx.userId };
    ctx.mutateScene((sc) => { sc.drawings.push(d); }, { label: 'Рисунок', undo: (sc) => { sc.drawings = sc.drawings.filter((x) => x.id !== d.id); }, redo: (sc) => { sc.drawings.push(d); } });
  },
  cancel(ctx) { ctx.ui.liveStroke = null; },
};

function eraseAt(ctx, w) {
  const tol = 10 / ctx.camera.z;
  for (const d of ctx.scene.drawings) {
    if (!ctx.isMaster && d.author !== ctx.userId) continue;
    let near = false;
    if (d.type === 'text') near = Math.abs(d.x - w.x) < 80 && Math.abs(d.y - w.y) < 24;
    else for (let i = 1; i < d.pts.length && !near; i++) near = distToSegment(w, d.pts[i - 1], d.pts[i]) < tol;
    if (near) {
      const copy = structuredClone(d);
      ctx.mutateScene((sc) => { sc.drawings = sc.drawings.filter((x) => x.id !== d.id); }, { label: 'Стереть', undo: (sc) => sc.drawings.push(copy), redo: (sc) => { sc.drawings = sc.drawings.filter((x) => x.id !== d.id); } });
      return;
    }
  }
}

const textTool = {
  click(ctx, g, w, e) { ctx.panels.textPrompt(w, { x: e.clientX, y: e.clientY }); },
};

const fogTool = {
  hover(ctx, w) {
    const sub = ctx.ui.sub.fog || 'reveal';
    if (sub === 'rect') { ctx.ui.brush = null; return; }
    ctx.ui.brush = { x: w.x, y: w.y, r: brushRadius(ctx), mode: sub };
    ctx.invalidate('overlay');
  },
  down(ctx, g, w) {
    const sub = ctx.ui.sub.fog || 'reveal';
    if (sub === 'rect' || sub === 'rect-hide') { g.rect = { x0: w.x, y0: w.y }; ctx.ui.marquee = { x0: w.x, y0: w.y, x1: w.x, y1: w.y }; return; }
    g.op = { id: uid('f-'), type: sub === 'hide' ? 'hide' : 'reveal', shape: 'brush', r: brushRadius(ctx), pts: [w] };
    ctx.ui.brush = { x: w.x, y: w.y, r: g.op.r, mode: sub };
    ctx.ui.liveFogOp = g.op;
    applyLiveFog(ctx, g.op);
  },
  move(ctx, g, w) {
    if (g.rect) { ctx.ui.marquee.x1 = w.x; ctx.ui.marquee.y1 = w.y; ctx.invalidate('overlay'); return; }
    const last = g.op.pts.at(-1);
    if (Math.hypot(w.x - last.x, w.y - last.y) < g.op.r / 3) { ctx.ui.brush = { ...ctx.ui.brush, x: w.x, y: w.y }; ctx.invalidate('overlay'); return; }
    g.op.pts.push({ x: Math.round(w.x), y: Math.round(w.y) });
    ctx.ui.brush = { x: w.x, y: w.y, r: g.op.r, mode: ctx.ui.sub.fog || 'reveal' };
    applyLiveFog(ctx, g.op);
  },
  up(ctx, g) {
    let op = g.op;
    if (g.rect) {
      const m = ctx.ui.marquee; ctx.ui.marquee = null;
      op = { id: uid('f-'), type: (ctx.ui.sub.fog || 'rect') === 'rect-hide' ? 'hide' : 'reveal', shape: 'rect', x: Math.min(m.x0, m.x1), y: Math.min(m.y0, m.y1), w: Math.abs(m.x1 - m.x0), h: Math.abs(m.y1 - m.y0) };
      if (op.w < 4 || op.h < 4) { ctx.invalidate('overlay'); return; }
    }
    ctx.ui.liveFogOp = null;
    if (!op) return;
    ctx.mutateScene((s) => { s.fog.ops = [...(s.fog.ops || []), op]; if (op.type === 'hide') s.fog.explored = (s.fog.explored || []).filter((k) => !opCoversCell(s, op, k)); },
      { label: 'Туман', undo: (s) => { s.fog.ops = (s.fog.ops || []).filter((x) => x.id !== op.id); }, redo: (s) => { s.fog.ops = [...(s.fog.ops || []), op]; } });
  },
  cancel(ctx) { ctx.ui.liveFogOp = null; ctx.ui.marquee = null; },
};

function opCoversCell(s, op, k) {
  const { c, r } = unkey(k);
  const p = cellCenter(s.grid, c, r);
  if (op.shape === 'rect') return p.x >= op.x && p.x <= op.x + op.w && p.y >= op.y && p.y <= op.y + op.h;
  return op.pts.some((q) => Math.hypot(p.x - q.x, p.y - q.y) <= op.r);
}

function brushRadius(ctx) { return ((ctx.ui.sub.fogSize || 2) * gridSize(sceneGrid(ctx))) / 2; }

function applyLiveFog(ctx, op) {
  // Живой предпросмотр: временно добавляем операцию в сцену только для отрисовки.
  const s = ctx.scene;
  const saved = s.fog.ops;
  s.fog.ops = [...(saved || []), op];
  ctx.invalidateVision();
  ctx.invalidate('fog', 'overlay');
  requestAnimationFrame(() => { s.fog.ops = saved; });
}

const wallTool = {
  hover(ctx, w) {
    if (!ctx.ui.wallChain) return;
    ctx.ui.wallGhost = { a: ctx.ui.wallChain.a, b: wallSnap(ctx, w), kind: ctx.ui.sub.walls || 'wall' };
    ctx.invalidate('overlay');
  },
  down(ctx, g, w, e) {
    const sub = ctx.ui.sub.walls || 'wall';
    const tg = g.target;
    if (tg.kind === 'handle' && !ctx.ui.wallChain) {
      const [x, y] = tg.id.split(',').map(Number);
      g.handle = { x, y };
      g.before = structuredClone(ctx.scene.walls);
      return;
    }
    if ((tg.kind === 'wall' || tg.kind === 'door') && !ctx.ui.wallChain) {
      if (sub === 'erase') { ctx.panels.deleteWall(tg.id); return; }
      ctx.ui.selectedWall = tg.id;
      ctx.invalidate('walls');
      ctx.panels.wallPopover(tg.id, { x: e.clientX, y: e.clientY });
      g.done = true;
      return;
    }
    if (sub === 'erase') return;
    const p = wallSnap(ctx, w, e.altKey);
    if (!ctx.ui.wallChain) { ctx.ui.wallChain = { a: p }; ctx.ui.selectedWall = null; closePopover(); g.started = true; ctx.ui.wallGhost = { a: p, b: p, kind: sub }; ctx.invalidate('overlay', 'walls'); return; }
    addWall(ctx, ctx.ui.wallChain.a, p, sub);
    ctx.ui.wallChain = { a: p };
  },
  move(ctx, g, w, e) {
    if (g.handle) {
      const p = wallSnap(ctx, w, e.altKey, g.handle);
      const s = ctx.scene;
      for (const wl of s.walls) {
        if (wl.a.x === g.handle.x && wl.a.y === g.handle.y) wl.a = { ...p };
        if (wl.b.x === g.handle.x && wl.b.y === g.handle.y) wl.b = { ...p };
      }
      g.handle = p;
      ctx.invalidate('walls');
      return;
    }
    if (ctx.ui.wallChain) { ctx.ui.wallGhost = { a: ctx.ui.wallChain.a, b: wallSnap(ctx, w, e.altKey), kind: ctx.ui.sub.walls || 'wall' }; ctx.invalidate('overlay'); }
  },
  up(ctx, g, w, e) {
    if (g.handle && g.moved) {
      const before = g.before, after = structuredClone(ctx.scene.walls);
      ctx.mutateScene((s) => { s.walls = structuredClone(after); }, { label: 'Стена', undo: (s) => { s.walls = structuredClone(before); }, redo: (s) => { s.walls = structuredClone(after); } });
      return;
    }
    // Перетаскивание от точки — сразу отрезок.
    if (g.started && g.moved) {
      const p = wallSnap(ctx, w, e.altKey);
      const a = ctx.ui.wallChain?.a;
      if (a && (a.x !== p.x || a.y !== p.y)) { addWall(ctx, a, p, ctx.ui.sub.walls || 'wall'); ctx.ui.wallChain = { a: p }; }
    }
  },
  click(ctx, g, w, e, dbl) {
    if (dbl && ctx.ui.wallChain) { ctx.ui.wallChain = null; ctx.ui.wallGhost = null; ctx.invalidate('overlay'); }
  },
};

function wallSnap(ctx, w, free = false, exclude = null) {
  if (free) return { x: Math.round(w.x), y: Math.round(w.y) };
  const tol = 12 / ctx.camera.z;
  let best = null, bd = tol;
  for (const wl of ctx.scene.walls) for (const p of [wl.a, wl.b]) {
    if (exclude && p.x === exclude.x && p.y === exclude.y) continue;
    const d = Math.hypot(p.x - w.x, p.y - w.y);
    if (d < bd) { bd = d; best = p; }
  }
  if (best) return { ...best };
  const v = snapToVertex(ctx, w, 0.5);
  return { x: Math.round(v.x * 100) / 100, y: Math.round(v.y * 100) / 100 };
}

function addWall(ctx, a, b, kind) {
  if (Math.hypot(a.x - b.x, a.y - b.y) < 2) return;
  const wl = { id: uid('w-'), a: { ...a }, b: { ...b }, kind: kind === 'erase' ? 'wall' : kind, open: false, locked: false };
  ctx.mutateScene((s) => { s.walls.push(wl); }, { label: 'Стена', undo: (s) => { s.walls = s.walls.filter((x) => x.id !== wl.id); }, redo: (s) => { s.walls.push(wl); } });
}

const lightTool = {
  down(ctx, g, w) {
    const tg = g.target;
    if (tg.kind === 'light') {
      if ((ctx.ui.sub.lights || 'torch') === 'erase') { ctx.panels.deleteLight(tg.id); g.done = true; return; }
      const l = ctx.scene.lights.find((x) => x.id === tg.id);
      ctx.ui.selectedLight = tg.id;
      g.light = { id: tg.id, x0: l.x, y0: l.y };
      ctx.invalidate('markers', 'areas');
      return;
    }
    const sub = ctx.ui.sub.lights || 'torch';
    if (sub === 'erase') return;
    g.create = true;
  },
  move(ctx, g, w, e) {
    if (!g.light) return;
    const l = ctx.scene.lights.find((x) => x.id === g.light.id); if (!l) return;
    const p = e.altKey ? w : snapToVertex(ctx, w, 0.5);
    l.x = Math.round(p.x); l.y = Math.round(p.y);
    ctx.invalidateVision();
    ctx.invalidate('markers', 'areas', 'fog');
  },
  up(ctx, g, w, e) {
    if (g.light && g.moved) {
      const l = ctx.scene.lights.find((x) => x.id === g.light.id);
      const to = { x: l.x, y: l.y }, from = { x: g.light.x0, y: g.light.y0 };
      ctx.mutateScene((s) => { const x = s.lights.find((q) => q.id === l.id); if (x) Object.assign(x, to); }, { label: 'Свет', undo: (s) => { const x = s.lights.find((q) => q.id === l.id); if (x) Object.assign(x, from); }, redo: (s) => { const x = s.lights.find((q) => q.id === l.id); if (x) Object.assign(x, to); } });
      return;
    }
    if (g.light && !g.moved) { ctx.panels.lightPopover(g.light.id, { x: e.clientX, y: e.clientY }); return; }
    if (g.create && !g.moved) ctx.panels.addLight(snapToVertex(ctx, w, 0.5), ctx.ui.sub.lights || 'torch', { x: e.clientX, y: e.clientY });
  },
};

const terrainTool = {
  down(ctx, g, w) {
    g.before = structuredClone(ctx.scene.terrain);
    g.mode = ctx.ui.sub.terrain || 'difficult';
    paintCell(ctx, g, w);
  },
  move(ctx, g, w) { paintCell(ctx, g, w); },
  click() {},
  up(ctx, g) {
    const before = g.before, after = structuredClone(ctx.scene.terrain);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    ctx.mutateScene((s) => { s.terrain = structuredClone(after); }, { label: 'Местность', undo: (s) => { s.terrain = structuredClone(before); }, redo: (s) => { s.terrain = structuredClone(after); } });
  },
  cancel(ctx, g) { if (g.before) ctx.scene.terrain = g.before; ctx.invalidate('terrain'); },
};

function paintCell(ctx, g, w) {
  const s = ctx.scene;
  const r = Math.max(0, Math.floor(((ctx.ui.sub.terrainSize || 1) - 1) / 2));
  const base = cellOf(s.grid, w.x, w.y);
  const { cols, rows } = dims(ctx);
  s.terrain = s.terrain || { difficult: [], blocked: [] };
  const dif = new Set(s.terrain.difficult), blk = new Set(s.terrain.blocked);
  for (let dc = -r; dc <= r; dc++) for (let dr = -r; dr <= r; dr++) {
    const c = base.c + dc, rr = base.r + dr;
    if (c < 0 || rr < 0 || c >= cols || rr >= rows) continue;
    const k = key(c, rr);
    if (g.mode === 'erase') { dif.delete(k); blk.delete(k); }
    else if (g.mode === 'blocked') { blk.add(k); dif.delete(k); }
    else { dif.add(k); blk.delete(k); }
  }
  s.terrain.difficult = [...dif]; s.terrain.blocked = [...blk];
  ctx.invalidate('terrain');
}

const gmTool = {
  down(ctx, g, w) {
    const sub = ctx.ui.sub.gm || 'trap';
    if (g.target.kind === 'trap') return;
    if (sub === 'trap') { g.trap = { start: cellOf(ctx.scene.grid, w.x, w.y) }; ctx.ui.trapCells = [key(g.trap.start.c, g.trap.start.r)]; ctx.invalidate('areas'); }
  },
  move(ctx, g, w) {
    if (!g.trap) return;
    const a = g.trap.start, b = cellOf(ctx.scene.grid, w.x, w.y);
    const cells = [];
    for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++) cells.push(key(c, r));
    ctx.ui.trapCells = cells;
    ctx.invalidate('areas');
  },
  click(ctx, g, w, e) {
    const tg = g.target;
    if (tg.kind === 'trap') { ctx.panels.trapPopover(tg.id, tg.node); g.handled = true; return; }
    if (tg.kind === 'pin') { ctx.panels.pinPopover(tg.id, tg.node); g.handled = true; return; }
    if (tg.kind === 'portal') { ctx.panels.portalPopover(tg.id, tg.node); g.handled = true; return; }
    const sub = ctx.ui.sub.gm || 'trap';
    if (sub === 'pin' || sub === 'note') { ctx.panels.addPin(w, sub === 'note' ? 'secret' : 'read-aloud', { x: e.clientX, y: e.clientY }); g.handled = true; }
    if (sub === 'portal') { ctx.panels.addPortal(snapToCellCenter(ctx, w), { x: e.clientX, y: e.clientY }); g.handled = true; }
  },
  up(ctx, g, w, e) {
    if (g.trap && !g.handled) {
      const cells = ctx.ui.trapCells || [];
      ctx.panels.addTrap(cells, { x: e.clientX, y: e.clientY });
    }
  },
};

const gridTool = {
  down(ctx, g, w) {
    const k = ctx.ui.calib; if (!k) return;
    if (g.target.kind === 'calib') {
      const corners = [[k.x, k.y], [k.x + k.size, k.y], [k.x, k.y + k.size], [k.x + k.size, k.y + k.size]];
      let bi = 0, bd = Infinity;
      corners.forEach(([x, y], i) => { const d = Math.hypot(x - w.x, y - w.y); if (d < bd) { bd = d; bi = i; } });
      const opp = corners[3 - bi];
      g.resize = { ox: opp[0], oy: opp[1], sx: Math.sign(corners[bi][0] - opp[0]), sy: Math.sign(corners[bi][1] - opp[1]) };
    } else if (w.x >= k.x && w.x <= k.x + k.size && w.y >= k.y && w.y <= k.y + k.size) g.moveCalib = { dx: w.x - k.x, dy: w.y - k.y };
    else g.panFallback = true;
  },
  move(ctx, g, w) {
    const k = ctx.ui.calib;
    if (g.resize) {
      const size = Math.max(10, Math.max(Math.abs(w.x - g.resize.ox), Math.abs(w.y - g.resize.oy)));
      k.size = Math.round(size * 4) / 4;
      k.x = g.resize.sx > 0 ? g.resize.ox : g.resize.ox - k.size;
      k.y = g.resize.sy > 0 ? g.resize.oy : g.resize.oy - k.size;
    } else if (g.moveCalib) { k.x = w.x - g.moveCalib.dx; k.y = w.y - g.moveCalib.dy; }
    applyCalibPreview(ctx);
  },
  up(ctx, g) { if (g.resize || g.moveCalib) applyCalibPreview(ctx); },
};

export function applyCalibPreview(ctx) {
  const k = ctx.ui.calib, s = ctx.scene;
  s.grid.size = k.size;
  s.grid.offsetX = ((k.x % k.size) + k.size) % k.size;
  s.grid.offsetY = ((k.y % k.size) + k.size) % k.size;
  if (s.grid.offsetX > k.size - 0.5) s.grid.offsetX = 0;
  if (s.grid.offsetY > k.size - 0.5) s.grid.offsetY = 0;
  ctx.invalidate('grid', 'overlay', 'tokens', 'terrain');
  renderChrome(ctx);
}

const TOOLS = { move: tokenTool, select: tokenTool, measure: measureTool, ping: pingTool, draw: drawTool, text: textTool, fog: fogTool, walls: wallTool, lights: lightTool, terrain: terrainTool, gm: gmTool, grid: gridTool };
export { TOOLS, snapToCellCenter, snapToVertex };
