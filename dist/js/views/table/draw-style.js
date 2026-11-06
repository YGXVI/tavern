// Заливка и обводка рисунков (TASK-182, как в Owlbear Rodeo): палитра, толщина, пунктир, прозрачность.
// Ничего не вписывается вручную: цвет — кружок палитры или системная пипетка, толщина — точки, прозрачность — ползунок.
import { esc } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { popover, closePopover } from '../../ui/kit.js';

/** 16 цветов палитры: 15 как в Owlbear и золото стола. */
export const PALETTE = [
  '#2f6bff', '#f26a2e', '#ef4444', '#f7c52b',
  '#9a5b22', '#7c4dff', '#6ee36b', '#2f9e44',
  '#e879f9', '#38d7ef', '#0d0f14', '#26282e',
  '#55585f', '#a3a6ad', '#ffffff', '#e9b052',
];
/** Толщины обводки, px карты (клетка обычно 70–140 px). 0 — без обводки. */
export const WIDTHS = [0, 1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24];

/** Цвет из данных — только #hex, hsl()/rgb() или var(--…): прочее в style не пускаем. */
export function safeColor(c, fallback = '#e9b052') {
  return typeof c === 'string' && /^(#[0-9a-fA-F]{3,8}|(hsl|rgb)a?\([0-9 .,%/-]+\)|var\(--[a-z0-9-]+\))$/.test(c.trim()) ? c.trim() : fallback;
}

/** Стиль нового рисунка: свой у каждого участника, живёт в открытой вкладке. */
export function drawStyle(ctx) {
  if (!ctx.ui.drawStyle) {
    const hue = ctx.user?.hue ?? 32;
    ctx.ui.drawStyle = { color: ctx.isMaster ? '#e9b052' : `hsl(${hue} 80% 65%)`, width: 4, opacity: 1, dash: false, fill: 'none', fillOpacity: 0.35 };
  }
  return ctx.ui.drawStyle;
}

const swatchStyle = (c) => (c === 'none' ? '' : `--c:${esc(safeColor(c))}`);

/** Кружок заливки (шахматка — без заливки) и кольцо обводки — для панели инструментов и панели рисунка. */
export function fillSwatch(fill, opacity = 1) {
  return fill === 'none' ? '<span class="ds-sw ds-none"></span>' : `<span class="ds-sw" style="${swatchStyle(fill)};opacity:${Math.max(0.3, opacity)}"></span>`;
}
export function strokeSwatch(color, width = 4, dash = false) {
  return width ? `<span class="ds-ring ${dash ? 'dash' : ''}" style="${swatchStyle(color)}"></span>` : '<span class="ds-ring ds-none"></span>';
}

/**
 * Окно заливки или обводки. cur — текущий стиль {color, width, opacity, dash, fill, fillOpacity};
 * onChange(patch) получает изменённые поля сразу, без кнопки «Готово».
 */
export function stylePopover(anchor, kind, cur, onChange) {
  const isFill = kind === 'fill', onlyColor = kind === 'color';
  const color = isFill ? cur.fill : cur.color;
  const op = Math.round((isFill ? cur.fillOpacity ?? 1 : cur.opacity ?? 1) * 100);
  const custom = color !== 'none' && !PALETTE.includes(color);
  const pal = `<div class="ds-pal" role="radiogroup" aria-label="Цвет">${PALETTE.map((c) => `<button class="ds-c ${c === color ? 'on' : ''}" data-ds-color="${c}" style="--c:${c}" role="radio" aria-checked="${c === color}" aria-label="Цвет ${c}"></button>`).join('')}
    <label class="ds-c ds-custom ${custom ? 'on' : ''}" style="${custom ? swatchStyle(color) : ''}" data-tip="Свой цвет">${icon('plus-sign', 16)}<input type="color" data-ds-pick value="${/^#[0-9a-f]{6}$/i.test(color) ? color : '#ffffff'}" aria-label="Свой цвет"></label></div>`;
  const slider = `<label class="ds-op" data-tip="Непрозрачность"><input class="slider" type="range" min="10" max="100" step="5" value="${op}" data-ds-op style="--fill:${((op - 10) / 90) * 100}%"><span class="t-xs" data-ds-op-out>${op}%</span></label>`;
  const left = onlyColor ? '' : isFill
    ? `<div class="ds-col ds-narrow"><button class="ds-c ds-none-btn ${color === 'none' ? 'on' : ''}" data-ds-color="none" data-tip="Без заливки" aria-label="Без заливки">${icon('transparency', 18)}</button></div>`
    : `<div class="ds-col"><div class="ds-widths" role="radiogroup" aria-label="Толщина">${WIDTHS.map((w) => `<button class="ds-w ${w === (cur.width ?? 4) ? 'on' : ''}" data-ds-width="${w}" role="radio" aria-checked="${w === (cur.width ?? 4)}" aria-label="${w ? `Толщина ${w}` : 'Без обводки'}" data-tip="${w ? `${w} px` : 'Без обводки'}">${w ? `<i style="width:${Math.min(16, 2 + w * 0.6)}px;height:${Math.min(16, 2 + w * 0.6)}px"></i>` : icon('stop-circle', 18)}</button>`).join('')}</div>
        <div class="ds-dash" role="radiogroup" aria-label="Линия"><button class="${cur.dash ? '' : 'on'}" data-ds-dash="0" aria-label="Сплошная" data-tip="Сплошная"><i class="solid"></i></button><button class="${cur.dash ? 'on' : ''}" data-ds-dash="1" aria-label="Пунктир" data-tip="Пунктир">${icon('dashed-line-01', 18)}</button></div></div>`;
  const pop = popover(`<div class="ds-pop">${left}<div class="ds-col">${pal}${onlyColor ? '' : slider}</div></div>`, anchor, { placement: 'auto', className: 'ds-popover' });
  const n = pop.node;
  const mark = (sel, on) => { for (const b of n.querySelectorAll(sel)) { b.classList.toggle('on', b === on); if (b.hasAttribute('aria-checked')) b.setAttribute('aria-checked', String(b === on)); } };
  n.addEventListener('click', (e) => {
    const c = e.target.closest('[data-ds-color]');
    if (c) { mark('[data-ds-color], .ds-custom', c); onChange(isFill ? { fill: c.dataset.dsColor } : { color: c.dataset.dsColor }); return; }
    const w = e.target.closest('[data-ds-width]');
    if (w) { mark('[data-ds-width]', w); onChange({ width: Number(w.dataset.dsWidth) }); return; }
    const d = e.target.closest('[data-ds-dash]');
    if (d) { mark('[data-ds-dash]', d); onChange({ dash: d.dataset.dsDash === '1' }); }
  });
  // Пока тянут ползунок или пипетку — меняется только окно; рисунок — по отпусканию (одна запись отмены и одна отправка).
  n.addEventListener('input', (e) => {
    if (e.target.matches('[data-ds-pick]')) {
      const lab = e.target.closest('.ds-custom');
      lab.style.setProperty('--c', e.target.value); mark('[data-ds-color], .ds-custom', lab);
    }
    if (e.target.matches('[data-ds-op]')) {
      const v = Number(e.target.value);
      e.target.style.setProperty('--fill', `${((v - 10) / 90) * 100}%`);
      n.querySelector('[data-ds-op-out]').textContent = `${v}%`;
    }
  });
  n.addEventListener('change', (e) => {
    if (e.target.matches('[data-ds-pick]')) onChange(isFill ? { fill: e.target.value } : { color: e.target.value });
    if (e.target.matches('[data-ds-op]')) onChange(isFill ? { fillOpacity: Number(e.target.value) / 100 } : { opacity: Number(e.target.value) / 100 });
  });
  return pop;
}

export { closePopover };
