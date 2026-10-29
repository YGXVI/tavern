// Рисунки и надписи как объекты (TASK-031): выделить, сдвинуть, перекрасить, изменить текст, удалить.
import { esc } from '../../core/dom.js';
import { icon } from '../../icons.js';

export const DRAW_COLORS = [
  { id: '#e9b052', name: 'Золото' },
  { id: '#e5584f', name: 'Кровь' },
  { id: '#5aa9e6', name: 'Лёд' },
  { id: '#6cc070', name: 'Мох' },
  { id: '#f2efe8', name: 'Мел' },
];

/** Кто может трогать рисунок: мастер — любой, игрок — свой. */
export function canEditDrawing(ctx, d) {
  return ctx.isMasterView || d.author === ctx.userId;
}

/** Копия рисунка, сдвинутая на dx, dy. */
export function shiftDrawing(d, dx, dy) {
  const r = (v) => Math.round(v * 10) / 10;
  const out = { ...d };
  if (d.pts) out.pts = d.pts.map((p) => ({ x: r(p.x + dx), y: r(p.y + dy) }));
  if (d.x != null) { out.x = r(d.x + dx); out.y = r(d.y + dy); }
  if (d.a) out.a = { x: r(d.a.x + dx), y: r(d.a.y + dy) };
  if (d.b) out.b = { x: r(d.b.x + dx), y: r(d.b.y + dy) };
  return out;
}

function put(ctx, id, after, label) {
  const d0 = ctx.scene.drawings.find((x) => x.id === id); if (!d0) return;
  const before = Object.fromEntries(Object.keys(after).map((k) => [k, structuredClone(d0[k])]));
  const set = (v) => (s) => { const x = s.drawings.find((q) => q.id === id); if (x) Object.assign(x, structuredClone(v)); };
  ctx.mutateScene(set(after), { label, undo: set(before), redo: set(after) });
}

export function moveDrawing(ctx, id, dx, dy) {
  const d = ctx.scene.drawings.find((x) => x.id === id); if (!d || (!dx && !dy)) return;
  const s = shiftDrawing(d, dx, dy);
  const after = {};
  for (const k of ['pts', 'x', 'y', 'a', 'b']) if (d[k] != null) after[k] = s[k];
  put(ctx, id, after, 'Сдвинуть рисунок');
}

export function updateDrawing(ctx, id, patch, label = 'Рисунок') { put(ctx, id, patch, label); }

export function deleteDrawing(ctx, id) {
  const d = ctx.scene.drawings.find((x) => x.id === id); if (!d) return;
  const copy = structuredClone(d);
  ctx.mutateScene((s) => { s.drawings = s.drawings.filter((x) => x.id !== id); },
    { label: d.type === 'text' ? 'Удалить надпись' : 'Удалить рисунок', undo: (s) => s.drawings.push(structuredClone(copy)), redo: (s) => { s.drawings = s.drawings.filter((x) => x.id !== id); } });
  if (ctx.ui.selDrawing === id) ctx.ui.selDrawing = null;
}

/** Панель выделенного рисунка: цвет, (надпись: текст и размер), удалить. */
export function renderDrawBar(L, ctx, bbox) {
  const box = L.drawUi;
  const d = ctx.ui.selDrawing && !ctx.ui.drawMove ? ctx.scene.drawings.find((x) => x.id === ctx.ui.selDrawing) : null;
  if (!d || !bbox) { if (box.innerHTML) box.innerHTML = ''; return; }
  const sw = DRAW_COLORS.map((c) => `<button class="db-sw ${d.color === c.id ? 'on' : ''}" data-db="color" data-v="${c.id}" style="--c:${c.id}" aria-label="${esc(c.name)}" data-tip="${esc(c.name)}"></button>`).join('');
  const text = d.type === 'text'
    ? `<span class="db-div"></span><button class="gz-b" data-db="edit" data-tip="Изменить текст" aria-label="Изменить текст">${icon('pencil-edit-02', 18)}</button><button class="gz-b" data-db="smaller" data-tip="Мельче" aria-label="Мельче">${icon('minus-sign', 18)}</button><button class="gz-b" data-db="bigger" data-tip="Крупнее" aria-label="Крупнее">${icon('plus-sign', 18)}</button>`
    : '';
  box.innerHTML = `<div class="db" style="transform: translate(${bbox.x + bbox.width / 2}px, ${bbox.y + bbox.height}px)"><div class="gz-bar db-bar">${sw}${text}<span class="db-div"></span><button class="gz-b danger" data-db="del" data-tip="Удалить · Del" aria-label="Удалить">${icon('delete-02', 18)}</button></div></div>`;
}

export function attachDrawBar(L, ctx) {
  const box = L.drawUi;
  box.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-db]') || e.target.closest('.db-bar')) e.stopPropagation(); });
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-db]'); if (!b) return;
    e.stopPropagation();
    const id = ctx.ui.selDrawing; const d = ctx.scene.drawings.find((x) => x.id === id); if (!d) return;
    const k = b.dataset.db;
    if (k === 'color') updateDrawing(ctx, id, { color: b.dataset.v }, 'Цвет');
    if (k === 'bigger' || k === 'smaller') updateDrawing(ctx, id, { size: Math.max(8, Math.min(400, Math.round((d.size || 28) * (k === 'bigger' ? 1.25 : 0.8)))) }, 'Размер надписи');
    if (k === 'edit') { const r = b.getBoundingClientRect(); ctx.panels.textPrompt({ x: d.x, y: d.y }, { x: r.left + r.width / 2, y: r.top }, d); }
    if (k === 'del') deleteDrawing(ctx, id);
    ctx.invalidate('drawings');
  });
}
