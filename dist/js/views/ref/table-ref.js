// Справочник на карте (#203): кнопка слева снизу открывает поиск Ctrl K, карточка — модалкой поверх стола.
// Стол не закрывается; ссылки на правила внутри карточки открываются тут же.
import { html, raw } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { modal, copyText } from '../../ui/kit.js';
import { roll } from '../../../engine.js';
import { loadSection } from './data.js';
import { card } from './cards.js';
import { openPalette } from './palette.js';

const ic = (n, s = 16) => raw(icon(n, s));

export function openTableReference(ctx, q = '') {
  return openPalette(q, { onPick: (it) => cardModal(ctx, it) });
}

function cardModal(ctx, it0) {
  let it = it0, lang = 'ru';
  const back = [];
  const body = () => html`<div class="ref-card ref-card-modal" data-card><div class="ref-card-body">${card(it, { lang, key: `${it.section}/${it.id}`, fav: false })}</div>
    <footer class="ref-card-foot">${back.length ? html`<button class="btn btn-ghost btn-sm" data-back>${ic('arrow-left-02')}Назад</button>` : ''}<button class="btn btn-secondary btn-sm" data-search>${ic('search-01')}Искать ещё</button>
      ${it.section === 'creatures' && ctx.isMaster ? html`<button class="btn btn-primary btn-sm" data-place>${ic('maps')}Поставить на карту</button>` : ''}
      <span class="spacer"></span><span class="t-xs tertiary">${it.section === 'creatures' && !it.m?.srd ? 'Стартовый бестиарий' : 'SRD 5.1 · CC BY 4.0'}</span><button class="icon-btn icon-btn-sm" data-close aria-label="Закрыть">${ic('cancel-01', 18)}</button></footer></div>`;
  const m = modal(body(), { wide: true, className: 'ref-modal' });
  const redraw = () => m.set(body());
  m.box.addEventListener('click', async (e) => {
    const roller = e.target.closest('[data-roll]');
    if (roller) {
      e.preventDefault();
      try { const r = roll(roller.dataset.roll); ctx.toast({ title: `${roller.textContent.trim() || roller.dataset.roll}: ${r.total}`, body: r.rolls.length > 1 ? `Кубы: ${r.rolls.join(' + ')}` : roller.dataset.roll.replace(/d/g, 'к'), icon: 'dice-faces-06' }); } catch (err) { ctx.toast({ title: 'Не бросить', body: err.message, icon: 'alert-circle' }); }
      return;
    }
    const link = e.target.closest('a[href^="#/ref/"]');
    if (link) {
      e.preventDefault();
      const [, , section, id] = link.getAttribute('href').split('?')[0].split('/');
      const items = await loadSection(section).catch(() => null);
      const next = items?.find((x) => x.id === decodeURIComponent(id || ''));
      if (next) { back.push(it); it = next; redraw(); }
      return;
    }
    if (e.target.closest('[data-back]')) { it = back.pop() || it; redraw(); return; }
    const l = e.target.closest('[data-lang]'); if (l) { lang = l.dataset.lang; redraw(); return; }
    if (e.target.closest('[data-search]')) { m.close(); openTableReference(ctx); return; }
    if (e.target.closest('[data-share]')) { const ok = await copyText(`${location.origin}${location.pathname}#/ref/${it.section}/${encodeURIComponent(it.id)}`); ctx.toast({ title: ok ? 'Ссылка на карточку скопирована' : 'Не удалось скопировать', icon: 'link-01' }); return; }
    if (e.target.closest('[data-fav]')) { ctx.toast({ title: 'Избранное — в справочнике вне стола', icon: 'star' }); return; }
    if (e.target.closest('[data-place]')) {
      m.close();
      const { placeCreatures } = await import('../table/p-side.js');
      placeCreatures(ctx, it.monsterId);
    }
  });
  return m;
}
