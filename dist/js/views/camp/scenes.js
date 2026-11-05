// Сцены кампании (#203, макет 61) и «Мои карты» — карты из всех кампаний мастера (макет 63).
// Сцена правится на столе: отсюда — открыть, перенести отряд, переименовать, удалить, взять карту из другой кампании.
import { html, raw, on, esc, plural, uid } from '../../core/dom.js';
import { srcOf, resolveSrc } from '../../core/assets.js';
import { currentUser } from '../../core/auth.js';
import { campaignsFor, roleIn, updateCampaign, addLog } from '../../core/campaign.js';
import { modal, panelHeader, menu, confirmDialog, toast } from '../../ui/kit.js';
import { gridDims } from '../../rules/geometry.js';
import { appHeader, bindHeader } from '../screens.js';
import { ic } from './parts.js';

/** Подгрузить картинки idb:/sb: в <img data-ref> и фон [data-bgref]. */
export function hydrate(root) {
  for (const img of root.querySelectorAll('img[data-ref]')) if (!img.getAttribute('src')) resolveSrc(img.dataset.ref).then((u) => { if (u) img.src = u; });
  for (const n of root.querySelectorAll('[data-bgref]')) if (!n.style.backgroundImage) resolveSrc(n.dataset.bgref).then((u) => { if (u) n.style.backgroundImage = `url("${u}")`; });
}
const img = (ref) => { const s = srcOf(ref); return raw(`<img alt="" loading="lazy" draggable="false" data-ref="${esc(ref || '')}" ${s ? `src="${esc(s)}"` : ''}>`); };

function sceneMeta(s) {
  let dims = '';
  try { const d = gridDims(s.grid, s.map?.width, s.map?.height); if (d?.cols && s.map?.width) dims = `${d.cols}×${d.rows} клеток`; } catch { /* нет сетки */ }
  const tokens = (s.tokens || []).length;
  const walls = (s.walls || []).length;
  const bits = [dims, tokens ? `${tokens} ${plural(tokens, 'токен', 'токена', 'токенов')}` : '', walls ? 'стены' : '', s.fog?.mode && s.fog.mode !== 'off' ? 'туман войны' : '', s.lighting === 'dark' ? 'темнота' : ''];
  return bits.filter(Boolean).join(' · ');
}

export function mountTab(ctx, body) {
  const offs = [];
  const L = (type, sel, fn) => offs.push(on(body, type, sel, fn));
  const render = () => {
    const c = ctx.c;
    body.innerHTML = String(html`<div class="cp-toolbar"><span class="chip chip-accent">Все · ${c.scenes.length}</span><span class="spacer"></span>
        <button class="btn btn-secondary btn-sm" data-from-maps>${ic('maps')}Из «Моих карт»</button><a class="btn btn-primary btn-sm" href="#/c/${c.id}/do/new-scene">${ic('plus-sign')}Новая сцена</a></div>
      <div class="cp-scenes">${c.scenes.map((s) => {
        const active = s.id === c.activeSceneId;
        return html`<article class="cp-scene ${active ? 'active' : ''}"><div class="cp-scene-img">${img(s.map?.src)}${active ? html`<span class="chip chip-accent cp-scene-flag">Сейчас на столе</span>` : ''}</div>
          <div class="cp-scene-body"><b>${s.name}</b><small>${sceneMeta(s) || 'пустая сцена'}</small>
            <div class="cp-scene-foot">${active ? html`<a class="btn btn-primary btn-sm" href="#/c/${c.id}">${ic('play')}Открыть стол</a>` : html`<a class="btn btn-secondary btn-sm" href="#/c/${c.id}/do/show/${encodeURIComponent(s.id)}">${ic('arrow-right-02')}Перенести отряд</a>`}
              <span class="spacer"></span><a class="icon-btn icon-btn-sm" href="#/c/${c.id}/do/edit/${encodeURIComponent(s.id)}" data-tip="Настроить на столе" aria-label="Настроить на столе">${ic('settings-01', 18)}</a><button class="icon-btn icon-btn-sm" data-more="${s.id}" aria-label="Ещё">${ic('more-horizontal', 18)}</button></div></div></article>`;
      })}<a class="cp-scene cp-scene-new" href="#/c/${c.id}/do/new-scene"><span class="cp-plus">${ic('plus-sign', 22)}</span><b>Новая сцена</b><small>Загрузите карту или возьмите из «Моих карт» — сетку подгоним</small></a></div>`);
    hydrate(body);
  };
  L('click', '[data-more]', (e, b) => {
    const sid = b.dataset.more;
    const s = ctx.c.scenes.find((x) => x.id === sid); if (!s) return;
    menu([
      { icon: 'edit-02', label: 'Переименовать', onClick: () => rename(ctx, s) },
      { icon: 'copy-01', label: 'Копия сцены', hint: 'без токенов', onClick: () => duplicate(ctx.cid, s) },
      'divider',
      { icon: 'delete-02', label: 'Удалить сцену', danger: true, onClick: async () => {
        if (ctx.c.activeSceneId === sid) { toast({ title: 'Сцена сейчас на столе', body: 'Сначала покажите игрокам другую', icon: 'alert-circle' }); return; }
        if (!(await confirmDialog({ title: `Удалить «${s.name}»?`, body: 'Токены, стены и рисунки на ней исчезнут. Карта останется в других сценах.', ok: 'Удалить', danger: true }))) return;
        updateCampaign(ctx.cid, (c) => { c.scenes = c.scenes.filter((x) => x.id !== sid); for (const m of c.members) if (m.sceneId === sid) delete m.sceneId; });
      } },
    ], b, { placement: 'bottom' });
  });
  L('click', '[data-from-maps]', () => pickMap(ctx));
  render();
  return { update: render, unmount() { for (const off of offs) off(); } };
}

function rename(ctx, s) {
  const m = modal(html`${panelHeader('Название сцены')}<div class="panel-section"><div class="input"><input data-v maxlength="60" value="${s.name}"></div></div>
    <div class="panel-footer"><span class="spacer"></span><button class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary" data-ok>Сохранить</button></div>`);
  const ok = () => { const v = m.box.querySelector('[data-v]').value.trim(); if (!v) return; updateCampaign(ctx.cid, (c) => { const x = c.scenes.find((y) => y.id === s.id); if (x) x.name = v; }); m.close(); };
  m.box.querySelector('[data-ok]').addEventListener('click', ok);
  m.box.querySelector('[data-v]').addEventListener('keydown', (e) => e.key === 'Enter' && ok());
}

/** Новая сцена из карты: картинка, сетка, стены, свет и двери; без токенов, рисунков и тайного. */
function sceneFromMap(s, name) {
  return { id: uid('s-'), name: name || s.name, note: '', status: 'draft', map: structuredClone(s.map), grid: structuredClone(s.grid), lighting: s.lighting || 'bright',
    fog: { mode: s.fog?.mode || 'off', ops: [], explored: [] }, walls: structuredClone(s.walls || []).map((w) => ({ ...w, open: false })), lights: structuredClone(s.lights || []),
    terrain: structuredClone(s.terrain || { difficult: [], blocked: [] }), tokens: [], drawings: [], pins: [], portals: [], traps: [] };
}
function duplicate(cid, s) {
  updateCampaign(cid, (c) => { c.scenes.push(sceneFromMap(s, `${s.name} — копия`)); addLog(c, { kind: 'scene', text: `Новая сцена «${s.name} — копия»` }); });
  toast({ title: 'Копия готова', icon: 'copy-01' });
}

/** Карты мастера из всех его кампаний: одна карта — одна запись, с перечнем кампаний. */
export function myMaps(userId) {
  const map = new Map();
  for (const c of campaignsFor(userId)) {
    if (roleIn(c, userId) !== 'master') continue;
    for (const s of c.scenes) {
      const src = s.map?.src; if (!src) continue;
      if (!map.has(src)) map.set(src, { src, name: s.name, scene: s, campaign: c, used: [] });
      const e = map.get(src);
      if (!e.used.some((u) => u.id === c.id)) e.used.push({ id: c.id, name: c.name });
    }
  }
  return [...map.values()];
}
const mapMeta = (e) => { const s = e.scene; let d = ''; try { const g = gridDims(s.grid, s.map?.width, s.map?.height); if (g?.cols && s.map?.width) d = ` · ${g.cols}×${g.rows}`; } catch { /* */ } return `${s.map.width}×${s.map.height} · сетка ${Math.round(s.grid?.size || 0)} px${d}`; };

function pickMap(ctx) {
  const list = myMaps(ctx.user.id);
  const m = modal(html`${panelHeader('Из «Моих карт»', 'Карта встанет новой сценой с сеткой, стенами и светом — без токенов')}
    <div class="modal-body scroll"><div class="cp-mapgrid small">${list.map((e, i) => html`<button class="cp-map" data-i="${i}"><span class="cp-map-img">${img(e.src)}</span><b>${e.name}</b><small>${mapMeta(e)}</small></button>`)}
    ${!list.length ? html`<p class="t-sm muted">Карт пока нет.</p>` : ''}</div></div>`, { wide: true });
  hydrate(m.box);
  m.box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]'); if (!b) return;
    const src = list[Number(b.dataset.i)];
    if (src.campaign.id !== ctx.cid && /^sb:/.test(src.src)) { toast({ title: 'Эта карта лежит в другой кампании', body: 'На сервере файл карты привязан к кампании — загрузите его в этой кампании через «Новая сцена».', icon: 'alert-circle' }); return; }
    updateCampaign(ctx.cid, (c) => { c.scenes.push(sceneFromMap(src.scene)); addLog(c, { kind: 'scene', text: `Новая сцена «${src.scene.name}»` }); });
    m.close(); toast({ title: `Сцена «${src.scene.name}» готова`, icon: 'maps' });
  });
}

// ——— «Мои карты» (#/maps) ———
export function mountMaps(root) {
  const user = currentUser();
  let only = null;
  const offs = [];
  const render = () => {
    const all = myMaps(user.id);
    const camps = [...new Map(all.flatMap((e) => e.used).map((u) => [u.id, u])).values()];
    const list = only ? all.filter((e) => e.used.some((u) => u.id === only)) : all;
    const masterCamps = campaignsFor(user.id).filter((c) => roleIn(c, user.id) === 'master');
    root.innerHTML = String(html`<div class="screen">${appHeader(user, 'maps')}<main class="page cp-maps-page">
      <div class="cp-maps-title"><h1>Мои карты</h1><button class="chip chip-md" data-only="" aria-pressed="${!only}">Все · ${all.length}</button>${camps.map((u) => html`<button class="chip chip-md" data-only="${u.id}" aria-pressed="${only === u.id}">${u.name} · ${all.filter((e) => e.used.some((x) => x.id === u.id)).length}</button>`)}<span class="spacer"></span>
        <button class="btn btn-primary" data-upload ${masterCamps.length ? '' : raw('disabled')}>${ic('upload-01')}Загрузить карту</button></div>
      <div class="cp-mapgrid">${list.map((e) => html`<article class="cp-map"><span class="cp-map-img">${img(e.src)}</span><div class="cp-map-row"><b>${e.name}</b><button class="icon-btn icon-btn-sm" data-mapmenu="${all.indexOf(e)}" aria-label="Ещё">${ic('more-horizontal', 18)}</button></div><small>${mapMeta(e)}</small>
        <div class="cp-map-used"><span>В кампаниях:</span>${e.used.map((u) => html`<a class="chip chip-accent" href="#/camp/${u.id}/scenes">${u.name}</a>`)}</div></article>`)}
        <button class="cp-map cp-map-new" data-upload ${masterCamps.length ? '' : raw('disabled')}><span class="cp-plus">${ic('image-add-01', 24)}</span><b>${masterCamps.length ? 'Загрузить карту' : 'Сначала создайте кампанию'}</b><small>Сетку найдём сами — вы проверите одним взглядом. JPG, PNG или WebP.</small></button></div>
      <p class="cp-hint">${ic('settings-01', 16)}Карта — это картинка с сеткой. Сцена — карта в кампании: с токенами, стенами, светом и туманом. Одну карту можно поставить в разные кампании.</p>
    </main></div>`);
    bindHeader(root, user);
    hydrate(root);
  };
  offs.push(on(root, 'click', '[data-only]', (e, b) => { only = b.dataset.only || null; render(); }));
  offs.push(on(root, 'click', '[data-upload]', (e, b) => {
    const masterCamps = campaignsFor(user.id).filter((c) => roleIn(c, user.id) === 'master');
    if (masterCamps.length === 1) { location.hash = `#/c/${masterCamps[0].id}/do/new-scene`; return; }
    menu(masterCamps.map((c) => ({ icon: 'maps', label: `В «${c.name}»`, onClick: () => { location.hash = `#/c/${c.id}/do/new-scene`; } })), b, { placement: 'bottom' });
  }));
  offs.push(on(root, 'click', '[data-mapmenu]', (e, b) => {
    const entry = myMaps(user.id)[Number(b.dataset.mapmenu)]; if (!entry) return;
    const targets = campaignsFor(user.id).filter((c) => roleIn(c, user.id) === 'master' && !entry.used.some((u) => u.id === c.id));
    menu([
      ...entry.used.map((u) => ({ icon: 'maps', label: `Сцены «${u.name}»`, href: `#/camp/${u.id}/scenes` })),
      ...(targets.length ? ['divider', ...targets.map((c) => ({ icon: 'plus-sign', label: `Поставить в «${c.name}»`, onClick: () => {
        if (/^sb:/.test(entry.src)) { toast({ title: 'Файл карты привязан к своей кампании', body: 'На сервере загрузите эту картинку в новой кампании через «Новая сцена».', icon: 'alert-circle' }); return; }
        updateCampaign(c.id, (cc) => { cc.scenes.push(sceneFromMap(entry.scene)); }); toast({ title: `«${entry.name}» в «${c.name}»`, icon: 'maps' }); render();
      } }))] : []),
    ], b, { placement: 'bottom' });
  }));
  render();
  return { update: render, unmount() { for (const off of offs) off(); } };
}
