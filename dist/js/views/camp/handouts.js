// Раздатки (#203): мастер готовит письма, карты и записки на своём устройстве и показывает отряду, когда придёт время.
// Показанные — в книге кампании (`book.handouts`), видят все участники.
import { html, raw, on, uid } from '../../core/dom.js';
import { srcOf, storeImage } from '../../core/assets.js';
import { isServerMode } from '../../core/store.js';
import { modal, panelHeader, confirmDialog } from '../../ui/kit.js';
import { mutateBook } from './book-store.js';
import { local, updateLocal } from './local.js';
import { ic, openHandout, handoutIcon } from './parts.js';

/** Вкладка игрока «Раздатки». */
export function mountTab(ctx, body) {
  const off = on(body, 'click', '[data-handout]', (e, b) => { const h = ctx.book().handouts.find((x) => x.id === b.dataset.handout); if (h) openHandout(h); });
  const render = () => {
    const list = ctx.book().handouts;
    body.innerHTML = String(list.length ? html`<div class="cp-hgrid">${list.map((h) => html`<button class="cp-hcard" data-handout="${h.id}">${h.img ? html`<span class="cp-hcard-img" style="background-image:url(${srcOf(h.img)})"></span>` : html`<span class="cp-hcard-paper">${String(h.text || '').slice(0, 220)}</span>`}<span class="cp-hcard-t">${ic(handoutIcon(h), 16)}<b>${h.title}</b></span></button>`)}</div>`
      : html`<div class="cp-empty">${ic('note-edit', 28)}<h3>Раздаток пока нет</h3><p>Письма, карты и записки появятся здесь, когда мастер их покажет.</p></div>`);
  };
  render();
  return { update: render, unmount: off };
}

/** Окно мастера: черновики на устройстве и показанные отряду. */
export function handoutsModal(ctx) {
  const cid = ctx.cid, me = ctx.user.id;
  let editing = null; // {id,title,text,img}
  const drafts = () => local('secret', cid, me).handouts || [];
  const render = () => {
    const shown = ctx.book().handouts;
    if (editing) {
      return String(html`${panelHeader(editing.id ? 'Раздатка' : 'Новая раздатка', 'Пока не покажете — видите только вы')}
        <div class="modal-body scroll"><div class="panel-section">
          <div class="field"><label for="ho-t">Название</label><div class="input"><input id="ho-t" maxlength="80" value="${editing.title || ''}" placeholder="Письмо с печатью культа"></div></div>
          <div class="field"><label for="ho-x">Текст</label><div class="input area"><textarea id="ho-x" rows="7" maxlength="6000" placeholder="Что увидят игроки">${editing.text || ''}</textarea></div></div>
          <div class="field"><label>Картинка — карта, рисунок, печать</label><div class="row">${editing.img ? html`<span class="cp-ho-thumb" style="background-image:url(${srcOf(editing.img)})"></span><button class="btn btn-ghost btn-sm" data-noimg>Убрать</button>` : ''}<label class="btn btn-secondary btn-sm">${ic('upload-01')}${editing.img ? 'Заменить' : 'Загрузить'}<input type="file" accept="image/*" hidden data-file></label></div></div>
        </div></div>
        <div class="panel-footer"><button class="btn btn-ghost" data-back>Назад</button><span class="spacer"></span><button class="btn btn-secondary" data-save>Сохранить</button><button class="btn btn-primary" data-save-show>${ic('view')}Показать отряду</button></div>`);
    }
    const row = (h, isShown) => html`<div class="list-row">${ic(handoutIcon(h), 18)}<span class="grow col-tight"><span class="primary">${h.title || 'Без названия'}</span><span class="secondary">${isShown ? 'у игроков' : 'черновик — видите только вы'}</span></span>
      ${isShown ? html`<button class="btn btn-ghost btn-sm" data-hide="${h.id}">Спрятать</button>` : html`<button class="btn btn-ghost btn-sm" data-edit="${h.id}">Править</button><button class="btn btn-primary btn-sm" data-show="${h.id}">${ic('view')}Показать</button>`}
      <button class="icon-btn icon-btn-sm" data-del="${h.id}" aria-label="Удалить" data-tip="Удалить">${ic('delete-02', 16)}</button></div>`;
    return String(html`${panelHeader('Раздатки', 'Письма, карты и записки для отряда')}
      <div class="modal-body scroll"><div class="panel-section">${[...drafts().map((h) => row(h, false)), ...shown.map((h) => row(h, true))]}
        ${!drafts().length && !shown.length ? html`<p class="t-sm muted">Пока пусто. Подготовьте письмо или карту заранее — покажете, когда найдут тайник.</p>` : ''}</div></div>
      <div class="panel-footer"><span class="spacer"></span><button class="btn btn-secondary" data-close>Готово</button><button class="btn btn-primary" data-new>${ic('plus-sign')}Новая раздатка</button></div>`);
  };
  const m = modal(render(), { wide: true });
  const rerender = () => m.box.innerHTML = render();
  const grab = () => { editing.title = m.box.querySelector('#ho-t')?.value.trim() || editing.title; editing.text = m.box.querySelector('#ho-x')?.value ?? editing.text; };
  const saveDraft = () => { grab(); const h = { ...editing, id: editing.id || uid('ho-'), title: editing.title || 'Раздатка' }; updateLocal('secret', cid, me, (s) => { s.handouts = (s.handouts || []).filter((x) => x.id !== h.id); s.handouts.push(h); }); return h; };
  const show = (h) => {
    updateLocal('secret', cid, me, (s) => { s.handouts = (s.handouts || []).filter((x) => x.id !== h.id); });
    mutateBook(cid, (b) => { b.handouts = b.handouts.filter((x) => x.id !== h.id); b.handouts.push({ id: h.id, title: h.title, text: h.text || '', img: h.img || '', shownAt: Date.now() }); });
    ctx.toast({ title: `«${h.title}» у игроков`, icon: 'view' });
  };
  m.box.addEventListener('click', async (e) => {
    const t = e.target.closest('button, label'); if (!t) return;
    if (t.matches('[data-new]')) { editing = { title: '', text: '', img: '' }; rerender(); return; }
    if (t.matches('[data-back]')) { editing = null; rerender(); return; }
    if (t.matches('[data-noimg]')) { grab(); editing.img = ''; rerender(); return; }
    if (t.matches('[data-save]')) { saveDraft(); editing = null; rerender(); return; }
    if (t.matches('[data-save-show]')) { const h = saveDraft(); show(h); editing = null; rerender(); return; }
    if (t.dataset.edit) { editing = { ...drafts().find((x) => x.id === t.dataset.edit) }; rerender(); return; }
    if (t.dataset.show) { const h = drafts().find((x) => x.id === t.dataset.show); if (h) show(h); rerender(); return; }
    if (t.dataset.hide) {
      const h = ctx.book().handouts.find((x) => x.id === t.dataset.hide); if (!h) return;
      mutateBook(cid, (b) => { b.handouts = b.handouts.filter((x) => x.id !== h.id); });
      updateLocal('secret', cid, me, (s) => { s.handouts = [...(s.handouts || []), { ...h, shownAt: undefined }]; });
      rerender(); return;
    }
    if (t.dataset.del) {
      if (!(await confirmDialog({ title: 'Удалить раздатку?', body: 'У игроков она тоже пропадёт.', ok: 'Удалить', danger: true }))) return;
      updateLocal('secret', cid, me, (s) => { s.handouts = (s.handouts || []).filter((x) => x.id !== t.dataset.del); });
      if (ctx.book().handouts.some((x) => x.id === t.dataset.del)) mutateBook(cid, (b) => { b.handouts = b.handouts.filter((x) => x.id !== t.dataset.del); });
      rerender();
    }
  });
  m.box.addEventListener('change', async (e) => {
    if (!e.target.matches('[data-file]')) return;
    const f = e.target.files[0]; if (!f) return;
    grab();
    try {
      if (!/^image\//.test(f.type)) throw new Error('Нужна картинка: JPG, PNG или WebP.');
      if (isServerMode()) { const sv = await import('../../server/sync.js'); editing.img = await sv.uploadImage(cid, f); }
      else editing.img = (await storeImage(f)).ref;
      rerender();
    } catch (err) { ctx.toast({ title: 'Картинка не загрузилась', body: err.message, icon: 'alert-circle' }); }
  });
  return m;
}
export { raw };
