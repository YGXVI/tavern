// Рамка выделенного токена (TASK-030): поворот, свободный размер и быстрые действия —
// замок, слой, копия, имя, удаление, «ещё». Ручки держат постоянный экранный размер (--iz).
import { esc } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { gridSize } from '../../rules/geometry.js';
import { sizeById } from '../../data/rules.js';
import { menu, closePopover } from '../../ui/kit.js';
import { deleteTokens, duplicateTokens, tokenSettings, contextMenu } from './p-token.js';

export const SCALE_MIN = 0.25, SCALE_MAX = 8;

/** Базовый диаметр токена в футах (без свободного масштаба): средний — 5 фт, большой — 10 и т. д. */
export function baseFeet(scene, t) {
  const size = sizeById(t.size);
  return size.cells * (scene.grid.feet || 5) * (size.scale || 1);
}

/** Текущий вид токена с учётом жеста, который тянут прямо сейчас. */
export function tokenLook(ctx, t) {
  const gz = ctx.ui.gz?.id === t.id ? ctx.ui.gz : null;
  return { rot: gz ? gz.rot : Number(t.rot) || 0, scale: gz ? gz.scale : Number(t.scale) || 1 };
}

/** Диаметр токена на карте, px. */
export function tokenDiameter(ctx, t) {
  const s = gridSize(ctx.scene.grid), size = sizeById(t.size);
  return size.cells * s * 0.9 * (size.scale || 1) * tokenLook(ctx, t).scale;
}

const fmtFt = (v) => `${String(Math.round(v * 2) / 2).replace('.', ',')} фт`;

function rights(ctx, t) {
  const master = ctx.isMasterView;
  return {
    master,
    rot: !t.locked && (master || ctx.canControl(t)),
    size: !t.locked && (master || ctx.isMine(t)),
  };
}

export function renderGizmo(L, ctx) {
  const box = L.gizmo;
  const ids = [...ctx.ui.selection];
  const t = ids.length === 1 ? ctx.scene.tokens.find((x) => x.id === ids[0]) : null;
  const show = t && ctx.tokenShown(t) && !ctx.dragging?.size && ['move', 'select'].includes(ctx.ui.tool)
    && !ctx.viewport.dataset.focus && (ctx.isMasterView || ctx.canControl(t));
  if (!show) { if (box.dataset.sig) { box.innerHTML = ''; box.dataset.sig = ''; } return; }
  const r = rights(ctx, t);
  const look = tokenLook(ctx, t);
  const d = tokenDiameter(ctx, t);
  const p = ctx.posOf(t);
  const s = gridSize(ctx.scene.grid);
  const gz = ctx.ui.gz?.id === t.id ? ctx.ui.gz : null;
  const val = gz ? (gz.mode === 'rot' ? `${Math.round(look.rot)}°` : fmtFt(baseFeet(ctx.scene, t) * look.scale)) : '';
  const btn = (k, ic, tip, extra = '') => `<button class="gz-b ${extra}" data-gzb="${k}" data-tip="${esc(tip)}" aria-label="${esc(tip)}">${icon(ic, 20)}</button>`;
  const bar = r.master
    ? [
      btn('lock', t.locked ? 'square-lock-02' : 'square-unlock-02', t.locked ? 'Снять замок' : 'Закрепить — никто не сдвинет', t.locked ? 'on' : ''),
      t.locked ? '' : btn('layer', 'layers-01', 'Слой: поверх или под всеми'),
      t.locked || t.characterId ? '' : btn('dup', 'copy-01', 'Дублировать'),
      t.locked || t.characterId ? '' : btn('name', 'text-font', 'Имя на карте'),
      t.locked ? '' : btn('del', 'delete-02', 'Удалить', 'danger'),
      btn('more', 'more-vertical', 'Ещё'),
    ].join('')
    : btn('layer', 'layers-01', 'Слой: поверх или под всеми') + btn('more', 'more-vertical', 'Ещё');
  const sig = [t.id, r.rot, r.size, r.master, t.locked, !!t.characterId].join('|');
  if (box.dataset.sig !== sig) {
    box.innerHTML = `<div class="gz">
      <div class="gz-ring"></div>
      ${r.rot ? `<button class="gz-h gz-rot" data-gz="rot" aria-label="Повернуть" data-tip="Повернуть · Shift — по 15°">${icon('rotate-clockwise', 16)}</button>` : ''}
      ${r.size ? `<button class="gz-h gz-l" data-gz="size" aria-label="Размер" data-tip="Размер · Shift — по 5 фт">${icon('arrow-left-right', 16)}</button><button class="gz-h gz-r" data-gz="size" aria-label="Размер" data-tip="Размер · Shift — по 5 фт">${icon('arrow-left-right', 16)}</button>` : ''}
      <span class="gz-val"></span>
      <div class="gz-bar">${bar}</div>
    </div>`;
    box.dataset.sig = sig;
  }
  const g = box.firstElementChild;
  g.style.transform = `translate(${p.x}px, ${p.y}px)`;
  g.style.setProperty('--d', `${d}px`);
  g.style.setProperty('--bt', `${d / 2 + s * 0.42}px`);
  g.classList.toggle('busy', !!gz);
  // Внизу экрана панель уходит под нижнюю панель стола — тогда показываем её над токеном.
  const below = ctx.camera.toScreen(p.x, p.y + d / 2 + s * 0.42).y;
  g.classList.toggle('up', below > ctx.viewport.getBoundingClientRect().bottom - 150);
  const v = g.querySelector('.gz-val'); v.textContent = val; v.hidden = !val;
}

/** Подключить ручки и кнопки рамки. Вызывается один раз при сборке стола. */
export function attachGizmo(L, ctx) {
  const box = L.gizmo;
  const current = () => { const ids = [...ctx.ui.selection]; return ids.length === 1 ? ctx.scene?.tokens.find((x) => x.id === ids[0]) : null; };

  box.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('[data-gz]');
    if (!h && !e.target.closest('[data-gzb]')) return;
    e.stopPropagation(); // столу этот жест не нужен
    if (!h || e.button !== 0) return;
    const t = current(); if (!t) return;
    e.preventDefault();
    const mode = h.dataset.gz;
    const c = ctx.camera.toScreen(t.x, t.y);
    const look = tokenLook(ctx, t);
    const a0 = Math.atan2(e.clientY - c.y, e.clientX - c.x), r0 = Math.max(4, Math.hypot(e.clientX - c.x, e.clientY - c.y));
    const base = baseFeet(ctx.scene, t);
    ctx.ui.gz = { id: t.id, mode, rot: look.rot, scale: look.scale };
    try { h.setPointerCapture(e.pointerId); } catch { /* */ }
    const move = (ev) => {
      const gz = ctx.ui.gz; if (!gz) return;
      if (mode === 'rot') {
        let rot = look.rot + ((Math.atan2(ev.clientY - c.y, ev.clientX - c.x) - a0) * 180) / Math.PI;
        if (ev.shiftKey) rot = Math.round(rot / 15) * 15;
        gz.rot = ((Math.round(rot) % 360) + 360) % 360;
      } else {
        let ft = base * look.scale * (Math.hypot(ev.clientX - c.x, ev.clientY - c.y) / r0);
        ft = ev.shiftKey ? Math.max(5, Math.round(ft / 5) * 5) : Math.round(ft * 2) / 2;
        gz.scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, ft / base));
      }
      ctx.invalidate('tokens');
    };
    const up = () => {
      h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
      const gz = ctx.ui.gz; ctx.ui.gz = null;
      if (!gz) return;
      const id = t.id, before = { rot: Number(t.rot) || 0, scale: Number(t.scale) || 1 };
      const after = mode === 'rot' ? { rot: gz.rot } : { scale: Math.round(gz.scale * 1000) / 1000 };
      const changed = Object.keys(after).some((k) => after[k] !== before[k]);
      if (changed) {
        const put = (v) => (s) => { const x = s.tokens.find((q) => q.id === id); if (x) Object.assign(x, v); };
        ctx.mutateScene(put(after), { label: mode === 'rot' ? 'Поворот' : 'Размер', undo: put(before), redo: put(after) });
      }
      ctx.invalidate('tokens');
    };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  });

  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-gzb]'); if (!b) return;
    e.stopPropagation();
    const t = current(); if (!t) return;
    const k = b.dataset.gzb;
    const rect = b.getBoundingClientRect();
    const anchor = { x: rect.left + rect.width / 2, y: rect.bottom };
    const put = (v, label) => {
      const before = Object.fromEntries(Object.keys(v).map((q) => [q, t[q]]));
      const set = (val) => (s) => { const x = s.tokens.find((q) => q.id === t.id); if (x) Object.assign(x, val); };
      ctx.mutateScene(set(v), { label, undo: set(before), redo: set(v) });
    };
    if (k === 'lock') { put({ locked: !t.locked }, t.locked ? 'Снять замок' : 'Закрепить'); ctx.toast({ title: t.locked ? 'Замок снят' : 'Закреплён', body: t.locked ? 'Токен снова можно двигать' : 'Его не сдвинет никто, пока не снимете замок', icon: t.locked ? 'square-unlock-02' : 'square-lock-02' }); }
    if (k === 'layer') menu([
      { icon: 'bring-to-front', label: 'Поверх всех', onClick: () => put({ movedAt: Date.now() }, 'Наверх') },
      { icon: 'send-to-back', label: 'Под всеми', onClick: () => put({ movedAt: -Date.now() }, 'Вниз') },
    ], anchor, { placement: 'bottom' });
    if (k === 'dup') duplicateTokens(ctx, [t.id]);
    if (k === 'name') { tokenSettings(ctx, t.id, anchor); setTimeout(() => document.querySelector('.popover [data-name]')?.select(), 40); }
    if (k === 'del') { closePopover(); deleteTokens(ctx, [t.id]); }
    if (k === 'more') contextMenu(ctx, { kind: 'token', id: t.id }, { x: t.x, y: t.y }, anchor);
  });
}
