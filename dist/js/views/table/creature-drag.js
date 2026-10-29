// Перетаскивание существа из панели «Существа» прямо на карту (TASK-033).
import { esc } from '../../core/dom.js';
import { srcOf } from '../../core/assets.js';
import { monsterById } from '../../data/bestiary.js';
import { placeCreatures } from './p-side.js';

const THRESHOLD = 6;

/** Подключить один раз: ловит нажатие на строке существа в боковой панели. Возвращает функцию отключения. */
export function attachCreatureDrag(ctx) {
  let d = null; // {id, m, x0, y0, pointerId, ghost, touch}

  const overMap = (x, y) => {
    const hit = document.elementFromPoint(x, y);
    return !!hit && !!hit.closest('.viewport') && !hit.closest('.side-panel, .toolbar, .ch-widget, .popover, .tb, .panel');
  };

  const cleanup = () => {
    if (!d) return;
    d.ghost?.remove();
    document.body.classList.remove('dragging-creature');
    removeEventListener('pointermove', move, true);
    removeEventListener('pointerup', up, true);
    removeEventListener('pointercancel', cancel, true);
    d = null;
  };

  function move(e) {
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.ghost) {
      // Касание: тянем вбок (вертикально — это прокрутка списка).
      if (Math.hypot(dx, dy) < THRESHOLD || (d.touch && Math.abs(dx) < Math.abs(dy))) return;
      d.ghost = document.createElement('div');
      d.ghost.className = 'creature-ghost';
      d.ghost.innerHTML = `<span class="avatar foe"><img src="${esc(srcOf(d.m.img))}" alt=""></span><span class="cg-name">${esc(d.m.name)}</span>`;
      document.body.append(d.ghost);
      document.body.classList.add('dragging-creature');
    }
    e.preventDefault();
    d.ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    d.ghost.classList.toggle('ok', overMap(e.clientX, e.clientY));
  }

  function up(e) {
    if (!d || e.pointerId !== d.pointerId) return;
    const dragged = !!d.ghost, id = d.id;
    const onMap = dragged && overMap(e.clientX, e.clientY);
    cleanup();
    if (!dragged) return; // обычный клик — выбор в списке, как раньше
    // После перетаскивания клик по строке не нужен: глушим только клик этого же жеста.
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => removeEventListener('click', swallow, true), 0);
    if (!onMap || !ctx.scene) return;
    const w = ctx.camera.toWorld(e.clientX, e.clientY);
    const m = ctx.scene.map;
    const st = ctx.ui.bestiary || (ctx.ui.bestiary = { q: '', type: 'all', pick: null, count: 1, hidden: false, rollHp: false });
    if (st.pick !== id) { st.pick = id; st.count = 1; }
    ctx.ui.placeAt = { x: Math.max(0, Math.min(m.width, w.x)), y: Math.max(0, Math.min(m.height, w.y)) };
    placeCreatures(ctx, id);
    ctx.panels.renderSide?.(true);
  }
  function cancel(e) { if (d && e.pointerId === d.pointerId) cleanup(); }

  function down(e) {
    if (e.button !== 0 || d || !ctx.isMasterView) return;
    const row = e.target.closest?.('.side-panel [data-act="b-pick"]');
    if (!row) return;
    const m = monsterById(row.dataset.id); if (!m) return;
    d = { id: m.id, m, x0: e.clientX, y0: e.clientY, pointerId: e.pointerId, ghost: null, touch: e.pointerType === 'touch' };
    addEventListener('pointermove', move, { capture: true, passive: false });
    addEventListener('pointerup', up, true);
    addEventListener('pointercancel', cancel, true);
  }

  addEventListener('pointerdown', down, true);
  return () => { cleanup(); removeEventListener('pointerdown', down, true); };
}
