// Боковая панель мастера: сцены и бестиарий. Плюс быстрые «добавить»: герой, предмет, новая сцена.
import { el, esc, uid, plural } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { srcOf, resolveSrc, storeImage, BUILTIN_MAP_LIST } from '../../core/assets.js';
import { characterOf, ownerOfCharacter, sceneOf, tokenStats, updateCampaign, addLog, nextTokenName } from '../../core/campaign.js';
import { BESTIARY, monsterById } from '../../data/bestiary.js';
import { sizeById } from '../../data/rules.js';
import { makeScene, monsterToken } from '../../data/demo.js';
import { gridDims, gridSize, freeSpots } from '../../rules/geometry.js';
import { parseUniversalVTT, scaleImport } from '../../rules/uvtt.js';
import { modal, panelHeader, popover, closePopover, menu, confirmDialog } from '../../ui/kit.js';
import { endCombat } from './combat.js';
import { roll } from '../../../engine.js';

// ——— Общее ———
export function hydrateImages(root) {
  for (const img of root.querySelectorAll('img[data-ref]')) {
    if (img.getAttribute('src')) continue;
    resolveSrc(img.dataset.ref).then((u) => { if (u) img.src = u; });
  }
}
const mapImg = (ref, cls = '') => { const s = srcOf(ref); return `<img class="${cls}" alt="" draggable="false" data-ref="${esc(ref)}" ${s ? `src="${esc(s)}"` : ''}>`; };

function viewCenter(ctx) {
  const v = ctx.camera.viewRect();
  const sc = ctx.scene;
  return { x: Math.min(sc.map.width - 1, Math.max(0, v.x + v.w / 2)), y: Math.min(sc.map.height - 1, Math.max(0, v.y + v.h / 2)) };
}

// ——— Разметка панели ———
export function sideHTML(ctx) {
  if (ctx.ui.panel === 'scenes') return scenesHTML(ctx);
  if (ctx.ui.panel === 'bestiary') return bestiaryHTML(ctx);
  return '';
}

const GRID_PRESET = { 'map:crypt': 74.0625 };

function setupChips(ctx, s) {
  const { cols, rows } = gridDims(s.grid, s.map.width, s.map.height);
  const walls = s.walls.length, lights = s.lights.length;
  const fog = { vision: 'обзор', manual: 'вручную', off: 'нет' }[s.fog.mode];
  return `<div class="chips-wrap setup">
    <button class="chip ${s.grid.calibrated !== false ? 'chip-success' : ''}" data-act="scene-setup" data-id="${esc(s.id)}" data-tool="grid" data-tip="Подогнать сетку">${icon('grid', 12)}${cols}×${rows}</button>
    <button class="chip ${walls ? 'chip-success' : ''}" data-act="scene-setup" data-id="${esc(s.id)}" data-tool="walls" data-tip="Стены и двери">${icon('path', 12)}${walls ? `${walls}` : 'стен нет'}</button>
    <button class="chip ${lights || s.lighting === 'bright' ? 'chip-success' : ''}" data-act="scene-setup" data-id="${esc(s.id)}" data-tool="lights" data-tip="Свет">${icon(s.lighting === 'dark' ? 'moon-02' : 'sun-01', 12)}${s.lighting === 'dark' ? `темно · ${lights}` : 'светло'}</button>
    <button class="chip ${s.fog.mode !== 'off' ? 'chip-success' : ''}" data-act="scene-setup" data-id="${esc(s.id)}" data-tool="fog" data-tip="Туман войны">${icon('cloud', 12)}${fog}</button>
  </div>`;
}

function scenesHTML(ctx) {
  const c = ctx.c;
  const active = sceneOf(c, c.activeSceneId);
  const cards = c.scenes.map((s) => {
    const heroes = s.tokens.filter((t) => t.kind === 'hero');
    const foes = s.tokens.filter((t) => t.kind === 'foe');
    const isActive = s.id === c.activeSceneId;
    const split = c.members.filter((m) => m.sceneId === s.id && m.status === 'active').length;
    const status = isActive ? '<span class="chip chip-solid">Игроки здесь</span>' : split ? `<span class="chip chip-accent">${split} ${plural(split, 'игрок', 'игрока', 'игроков')} здесь</span>` : s.status === 'draft' ? '<span class="chip">Черновик</span>' : '';
    return `<div class="scene-card ${s.id === ctx.sceneId ? 'viewing' : ''} ${isActive ? 'active' : ''}">
      <button class="scene-thumb" data-act="scene-view" data-id="${esc(s.id)}" aria-label="Открыть «${esc(s.name)}»">${mapImg(s.map.src)}${status ? `<span class="thumb-chip">${status}</span>` : ''}${s.id === ctx.sceneId ? `<span class="thumb-eye">${icon('view', 14)}вы здесь</span>` : ''}</button>
      <div class="scene-info">
        <div class="row"><b class="ellipsis grow">${esc(s.name)}</b><button class="icon-btn icon-btn-xs" data-act="scene-menu" data-id="${esc(s.id)}" aria-label="Действия со сценой">${icon('more-horizontal', 16)}</button></div>
        <div class="t-sm muted ellipsis">${esc(s.note || `${s.map.width}×${s.map.height} px`)}</div>
        <div class="row scene-people">${heroes.slice(0, 5).map((t) => `<span class="mini-tok hero" style="background-image:url(${esc(srcOf(t.img))})"></span>`).join('')}${foes.length ? `<span class="t-xs tertiary">${heroes.length ? '·' : ''} ${foes.length} ${plural(foes.length, 'существо', 'существа', 'существ')}</span>` : ''}${!heroes.length && !foes.length ? '<span class="t-xs tertiary">пусто</span>' : ''}</div>
        ${setupChips(ctx, s)}
      </div>
    </div>`;
  }).join('');
  return `<div class="panel-header"><div class="titles"><div class="title lg">Сцены</div><div class="subtitle">${c.scenes.length} ${plural(c.scenes.length, 'сцена', 'сцены', 'сцен')} · ${active ? `игроки в «${esc(active.name)}»` : 'игрокам ничего не показано'}</div></div><button class="icon-btn icon-btn-sm" data-act="side-close" aria-label="Закрыть">${icon('cancel-01', 18)}</button></div>
    <div class="side-body scroll">${cards || '<div class="empty"><p class="t-sm muted">Сцен пока нет</p></div>'}</div>
    <div class="panel-footer"><button class="btn btn-primary btn-block" data-act="scene-new">${icon('plus-sign', 16)}Новая сцена</button></div>`;
}

const B_FILTERS = [['all', 'Все'], ['Гуманоид', 'Гуманоиды'], ['Нежить', 'Нежить'], ['Зверь', 'Звери'], ['other', 'Прочие']];

function bestiaryList(ctx) {
  const st = bState(ctx);
  const q = st.q.trim().toLowerCase();
  const list = BESTIARY.filter((m) => (!q || m.name.toLowerCase().includes(q) || m.type.toLowerCase().includes(q)) && (st.type === 'all' || (st.type === 'other' ? !['Гуманоид', 'Нежить', 'Зверь'].includes(m.type) : m.type === st.type)));
  if (!list.length) return '<p class="t-sm muted b-empty">Никого не нашлось. В демо — только существа из SRD 5.1.</p>';
  return list.map((m) => {
    const n = ctx.scene?.tokens.filter((t) => t.monsterId === m.id).length || 0;
    return `<button class="list-row b-row ${st.pick === m.id ? 'current' : ''}" data-act="b-pick" data-id="${esc(m.id)}"><span class="avatar sm foe"><img src="${esc(srcOf(m.img))}" alt=""></span><span class="grow col-tight"><span class="primary ellipsis">${esc(m.name)}</span><span class="secondary ellipsis">${esc(m.type)} · КО ${esc(m.cr)} · КД ${m.ac} · ${m.hp} хп${sizeById(m.size).cells > 1 ? ` · ${sizeById(m.size).cells}×${sizeById(m.size).cells}` : ''}</span></span>${n ? `<span class="chip">×${n}</span>` : ''}</button>`;
  }).join('');
}

function bState(ctx) { return ctx.ui.bestiary || (ctx.ui.bestiary = { q: '', type: 'all', pick: null, count: 1, hidden: false, rollHp: false }); }

function bestiaryHTML(ctx) {
  const st = bState(ctx);
  const m = st.pick ? monsterById(st.pick) : null;
  return `<div class="panel-header"><div class="titles"><div class="title lg">Существа</div><div class="subtitle">SRD 5.1 · ${BESTIARY.length} ${plural(BESTIARY.length, 'существо', 'существа', 'существ')}${ctx.ui.placeAt ? ' · поставим, куда кликнули' : ' · поставим в центр экрана'}</div></div><button class="icon-btn icon-btn-sm" data-act="side-close" aria-label="Закрыть">${icon('cancel-01', 18)}</button></div>
    <div class="panel-section b-search"><div class="input">${icon('search-01', 18)}<input data-bsearch value="${esc(st.q)}" placeholder="Гоблин, нежить…" aria-label="Поиск существ"></div>
      <div class="chips-wrap">${B_FILTERS.map(([v, l]) => `<button class="chip chip-md ${st.type === v ? 'chip-accent' : ''}" data-act="b-filter" data-v="${v}">${l}</button>`).join('')}</div></div>
    <div class="side-body scroll b-list">${bestiaryList(ctx)}</div>
    ${m ? `<div class="panel-footer b-foot"><div class="col grow" style="gap:8px">
      <div class="row"><b class="grow ellipsis">${esc(m.name)}</b><div class="stepper"><button class="icon-btn icon-btn-xs" data-act="b-count" data-d="-1" aria-label="Меньше">${icon('minus-sign', 14)}</button><span>${st.count}</span><button class="icon-btn icon-btn-xs" data-act="b-count" data-d="1" aria-label="Больше">${icon('plus-sign', 14)}</button></div></div>
      <div class="row"><label class="check t-sm"><input type="checkbox" data-act="b-hidden" ${st.hidden ? 'checked' : ''}>Скрыто от игроков</label><label class="check t-sm"><input type="checkbox" data-act="b-rollhp" ${st.rollHp ? 'checked' : ''}>Хиты ${esc(m.hpDice)}</label></div>
      <button class="btn btn-primary btn-block" data-act="b-place">${icon('plus-sign', 16)}Поставить ${st.count > 1 ? `${st.count} ` : ''}на карту</button></div></div>` : ''}`;
}

export function sideInput(ctx, e) {
  if (e.target.matches('[data-bsearch]')) {
    bState(ctx).q = e.target.value;
    const list = e.target.closest('.side-panel').querySelector('.b-list');
    if (list) list.innerHTML = bestiaryList(ctx);
  }
}

// ——— Действия панели ———
export function sideAction(ctx, act, b, e) {
  const st = bState(ctx);
  switch (act) {
    case 'scene-view': ctx.switchScene(b.dataset.id); ctx.panels.renderSide(); return true;
    case 'scene-setup': if (ctx.sceneId !== b.dataset.id) ctx.switchScene(b.dataset.id); ctx.setTool(b.dataset.tool); return true;
    case 'scene-menu': sceneMenu(ctx, b.dataset.id, b); return true;
    case 'scene-new': newSceneModal(ctx); return true;
    case 'scene-activate': activateScene(ctx, b.dataset.id); return true;
    case 'b-filter': st.type = b.dataset.v; ctx.panels.renderSide(true); return true;
    case 'b-pick': {
      const now = performance.now();
      if (st.pick === b.dataset.id && now - (st.pickAt || 0) < 350) { placeCreatures(ctx, st.pick); return true; }
      st.pick = b.dataset.id; st.pickAt = now; st.count = 1; ctx.panels.renderSide(true); return true;
    }
    case 'b-count': st.count = Math.max(1, Math.min(12, st.count + Number(b.dataset.d))); ctx.panels.renderSide(true); return true;
    case 'b-hidden': st.hidden = b.checked; return true;
    case 'b-rollhp': st.rollHp = b.checked; return true;
    case 'b-place': placeCreatures(ctx, st.pick); return true;
    default: return false;
  }
}

// ——— Сцены ———
function sceneMenu(ctx, sid, anchor) {
  const c = ctx.c, s = sceneOf(c, sid);
  if (!s) return;
  menu([
    sid !== c.activeSceneId ? { icon: 'view', label: 'Показать игрокам', onClick: () => activateScene(ctx, sid) } : null,
    { icon: 'edit-02', label: 'Переименовать', onClick: () => renameScene(ctx, sid) },
    { icon: 'copy-01', label: 'Дублировать без героев', onClick: () => duplicateScene(ctx, sid) },
    { icon: 'grid', label: 'Подогнать сетку', onClick: () => { ctx.switchScene(sid); ctx.setTool('grid'); } },
    'divider',
    { icon: 'delete-02', label: 'Удалить сцену', danger: true, onClick: () => deleteScene(ctx, sid) },
  ].filter(Boolean), anchor, { placement: 'left' });
}

function renameScene(ctx, sid) {
  const s = sceneOf(ctx.c, sid);
  const m = modal(`${panelHeader('Название сцены')}<div class="panel-section"><div class="field"><label for="sn">Название</label><div class="input"><input id="sn" maxlength="60" value="${esc(s.name)}" autofocus></div></div><div class="field"><label for="snote">Заметка для себя</label><div class="input"><input id="snote" maxlength="80" value="${esc(s.note || '')}" placeholder="Например, засада волков"></div></div></div><div class="panel-footer"><span class="spacer"></span><button class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary" data-ok>Сохранить</button></div>`);
  const ok = () => {
    const name = m.box.querySelector('#sn').value.trim();
    if (!name) { m.box.querySelector('#sn').closest('.input').classList.add('error'); return; }
    const note = m.box.querySelector('#snote').value.trim();
    updateCampaign(ctx.cid, (c) => { const x = c.scenes.find((q) => q.id === sid); if (x) { x.name = name; x.note = note; } for (const sc of c.scenes) for (const p of sc.portals || []) if (p.targetSceneId === sid) p.label = name; });
    m.close();
  };
  m.box.querySelector('[data-ok]').addEventListener('click', ok);
  m.box.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
}

function duplicateScene(ctx, sid) {
  const s = sceneOf(ctx.c, sid);
  const copy = structuredClone(s);
  copy.id = uid('s-');
  copy.name = `${s.name} (копия)`;
  copy.tokens = copy.tokens.filter((t) => t.kind !== 'hero').map((t) => ({ ...t, id: uid('t-') }));
  copy.fog.explored = [];
  copy.status = 'draft';
  copy.createdAt = Date.now();
  updateCampaign(ctx.cid, (c) => { const i = c.scenes.findIndex((x) => x.id === sid); c.scenes.splice(i + 1, 0, copy); });
  ctx.toast({ title: 'Сцена скопирована', body: copy.name, icon: 'copy-01' });
}

async function deleteScene(ctx, sid) {
  const c = ctx.c, s = sceneOf(c, sid);
  const heroes = s.tokens.filter((t) => t.kind === 'hero').length;
  const ok = await confirmDialog({ title: `Удалить «${s.name}»?`, body: `Карта, стены, свет и токены этой сцены исчезнут.${heroes ? ' Листы героев останутся.' : ''}${sid === c.activeSceneId ? ' Игроки сейчас на этой сцене — им покажется следующая.' : ''}`, ok: 'Удалить', danger: true });
  if (!ok) return;
  updateCampaign(ctx.cid, (cc) => {
    cc.scenes = cc.scenes.filter((x) => x.id !== sid);
    if (cc.activeSceneId === sid) cc.activeSceneId = cc.scenes[0]?.id || null;
    for (const m of cc.members) if (m.sceneId === sid) delete m.sceneId;
    for (const sc of cc.scenes) for (const p of sc.portals || []) if (p.targetSceneId === sid) p.targetSceneId = null;
    if (cc.combat.active && cc.combat.sceneId === sid) endCombat(cc);
  });
  if (ctx.sceneId === sid) ctx.switchScene(ctx.c.activeSceneId || ctx.c.scenes[0]?.id || null);
}

/** Показать сцену игрокам: при необходимости перенести героев и закончить бой на прежней. */
export function activateScene(ctx, sid) {
  const c = ctx.c, target = sceneOf(c, sid);
  if (!target) return;
  const party = c.members.filter((m) => m.status === 'active' && m.role === 'player' && m.characterId).map((m) => characterOf(c, m.characterId)).filter(Boolean);
  const missing = party.filter((ch) => !target.tokens.some((t) => t.characterId === ch.id));
  const split = c.members.some((m) => m.sceneId && m.sceneId !== sid);
  const combatElsewhere = c.combat.active && c.combat.sceneId !== sid;
  const doIt = (move) => {
    updateCampaign(ctx.cid, (cc) => {
      const to = cc.scenes.find((x) => x.id === sid);
      cc.activeSceneId = sid;
      for (const m of cc.members) delete m.sceneId;
      if (cc.combat.active && cc.combat.sceneId !== sid) endCombat(cc);
      to.status = 'ready';
      if (move && missing.length) {
        const center = { x: to.map.width / 2, y: to.map.height / 2 };
        const entry = (to.portals || []).find((p) => p.targetSceneId === c.activeSceneId) || null;
        const spots = freeSpots(to, entry || center, missing.length);
        missing.forEach((ch, i) => {
          let tok = null;
          for (const sc of cc.scenes) { const t = sc.tokens.find((x) => x.characterId === ch.id); if (t) { tok = t; sc.tokens = sc.tokens.filter((x) => x !== t); break; } }
          tok = tok || { id: uid('t-'), kind: 'hero', characterId: ch.id, name: ch.name, img: ch.portrait, size: 'medium', hidden: false, conditions: [], light: ch.light || null, aura: ch.aura || null };
          tok.x = spots[i].x; tok.y = spots[i].y; tok.disengaged = false;
          to.tokens.push(tok);
        });
      }
      addLog(cc, { kind: 'scene', userId: ctx.userId, text: `Сцена «${to.name}»` });
    });
    ctx.switchScene(sid);
    ctx.toast({ title: `Игроки видят «${target.name}»`, icon: 'view' });
  };
  if (!missing.length && !combatElsewhere) { doIt(false); return; }
  const m = modal(`${panelHeader(`Показать «${target.name}» игрокам`, 'Все игроки переключатся на эту сцену')}
    <div class="panel-section">
      ${missing.length ? `<label class="radio-card"><input type="radio" name="mv" value="1" checked><span><b>Перенести героев сюда</b><small>${esc(missing.map((x) => x.name).join(', '))} встанут ${target.portals?.some((p) => p.targetSceneId === c.activeSceneId) ? 'у входа' : 'в центре карты'}</small></span></label>
      <label class="radio-card"><input type="radio" name="mv" value="0"><span><b>Без героев</b><small>Поставлю их сам, когда будет нужно</small></span></label>` : ''}
      ${split ? '<p class="t-sm muted">Разделившийся отряд снова соберётся на одной сцене.</p>' : ''}
      ${combatElsewhere ? `<p class="t-sm negative">${icon('alert-circle', 14)} Бой на прежней сцене закончится.</p>` : ''}
    </div>
    <div class="panel-footer"><span class="spacer"></span><button class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary" data-ok>${icon('view', 16)}Показать</button></div>`);
  m.box.querySelector('[data-ok]').addEventListener('click', () => { const v = m.box.querySelector('input[name="mv"]:checked')?.value; m.close(); doIt(v !== '0'); });
}

export function newSceneModal(ctx) {
  const c = ctx.c;
  const state = { map: BUILTIN_MAP_LIST[0], upload: null, feet: 5, lighting: 'bright', fog: 'off' };
  const render = () => `${panelHeader('Новая сцена', 'Карта, сетка и свет — остальное настроите на столе')}
    <div class="modal-body scroll"><div class="panel-section">
      <div class="field"><label for="ns-name">Название</label><div class="input"><input id="ns-name" maxlength="60" placeholder="Например, Мост через ущелье" value="${esc(state.name || '')}" autofocus></div></div>
      <div class="field"><label>Карта</label><div class="map-pick">
        ${BUILTIN_MAP_LIST.map((mp) => `<button class="map-opt ${!state.upload && state.map.id === mp.id ? 'on' : ''}" data-map="${mp.id}">${mapImg(mp.id)}<span>${esc(mp.name)}</span></button>`).join('')}
        <label class="map-opt upload ${state.upload ? 'on' : ''}">${state.upload ? mapImg(state.upload.ref) : `<span class="up-ic">${icon('image-add-01', 24)}</span>`}<span>${state.upload ? 'Своя карта' : 'Загрузить'}</span><input type="file" accept="image/png,image/jpeg,image/webp,.dd2vtt,.uvtt,.df2vtt" hidden data-upload></label>
      </div><div class="t-xs tertiary" data-up-msg>${state.imported ? `Карта Universal VTT: ${state.imported.counts.walls} ${plural(state.imported.counts.walls, 'стена', 'стены', 'стен')}, ${state.imported.counts.doors} ${plural(state.imported.counts.doors, 'дверь', 'двери', 'дверей')}, ${state.imported.counts.lights} ${plural(state.imported.counts.lights, 'источник', 'источника', 'источников')} света · сетка уже подогнана · хранится только в этом браузере` : state.upload ? `${state.upload.width}×${state.upload.height} px · хранится только в этом браузере` : 'JPG, PNG, WebP до 25 МБ или карта Dungeondraft (.dd2vtt, .uvtt) — сразу со стенами, дверьми и светом. Хранится только в этом браузере.'}</div></div>
      <div class="form-grid">
        <div class="field"><label>Одна клетка</label><div class="chips-wrap">${[5, 10].map((f) => `<button class="chip chip-md ${state.feet === f ? 'chip-accent' : ''}" data-feet="${f}">${f} фт</button>`).join('')}</div></div>
        <div class="field"><label>Освещение</label><div class="chips-wrap"><button class="chip chip-md ${state.lighting === 'bright' ? 'chip-accent' : ''}" data-light="bright">${icon('sun-01', 12)}Светло</button><button class="chip chip-md ${state.lighting === 'dark' ? 'chip-accent' : ''}" data-light="dark">${icon('moon-02', 12)}Темно</button></div></div>
      </div>
      <div class="field"><label>Туман войны</label><div class="chips-wrap">${[['off', 'Без тумана'], ['vision', 'Открывается обзором'], ['manual', 'Открываю вручную']].map(([v, l]) => `<button class="chip chip-md ${state.fog === v ? 'chip-accent' : ''}" data-fog="${v}">${l}</button>`).join('')}</div></div>
      <label class="check"><input type="checkbox" data-show ${!c.scenes.length ? 'checked' : ''}>Сразу показать игрокам</label>
    </div></div>
    <div class="panel-footer"><span class="t-xs tertiary grow">${state.upload ? 'После создания откроем подгонку сетки' : ''}</span><button class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary" data-ok>${icon('plus-sign', 16)}Создать</button></div>`;
  const m = modal(render(), { wide: true, className: 'new-scene' });
  hydrateImages(m.box);
  const rerender = () => { state.name = m.box.querySelector('#ns-name')?.value || state.name; const show = m.box.querySelector('[data-show]')?.checked; m.set(render()); m.box.querySelector('[data-show]').checked = show; hydrateImages(m.box); };
  m.box.addEventListener('click', (e) => {
    const mp = e.target.closest('[data-map]'); if (mp) { state.map = BUILTIN_MAP_LIST.find((x) => x.id === mp.dataset.map); state.upload = null; state.imported = null; rerender(); return; }
    const f = e.target.closest('[data-feet]'); if (f) { state.feet = Number(f.dataset.feet); rerender(); return; }
    const l = e.target.closest('[data-light]'); if (l) { state.lighting = l.dataset.light; rerender(); return; }
    const fg = e.target.closest('[data-fog]'); if (fg) { state.fog = fg.dataset.fog; rerender(); return; }
    if (e.target.closest('[data-ok]')) create();
  });
  m.box.addEventListener('change', async (e) => {
    if (!e.target.matches('[data-upload]')) return;
    const file = e.target.files?.[0]; if (!file) return;
    const msg = m.box.querySelector('[data-up-msg]');
    msg.textContent = 'Загружаем…';
    try {
      state.imported = null;
      if (/\.(dd2vtt|uvtt|df2vtt)$/i.test(file.name)) {
        // Карта Dungeondraft / Universal VTT: картинка + стены, двери и свет.
        const data = parseUniversalVTT(await file.text(), { feet: state.feet, uid: () => uid('') });
        if (!data.image) throw new Error('В файле нет картинки карты.');
        const bytes = Uint8Array.from(atob(data.image.base64), (ch) => ch.charCodeAt(0));
        state.upload = await storeImage(new File([bytes], 'map', { type: data.image.mime }));
        state.imported = scaleImport(data, state.upload.width / data.width);
        if (data.lights.length) state.lighting = 'dark';
        if (data.walls.length) state.fog = 'vision';
      } else state.upload = await storeImage(file);
      state.name = state.name || m.box.querySelector('#ns-name').value || file.name.replace(/\.[^.]+$/, '').slice(0, 60);
      rerender();
    } catch (err) { msg.textContent = err instanceof SyntaxError ? 'Файл повреждён: это не JSON карты Universal VTT.' : err.message; msg.classList.add('negative'); }
  });
  function create() {
    const nameInput = m.box.querySelector('#ns-name');
    const name = nameInput.value.trim() || (state.upload ? 'Новая сцена' : state.map.name);
    const src = state.upload ? { src: state.upload.ref, width: state.upload.width, height: state.upload.height } : { src: state.map.id, width: state.map.width, height: state.map.height };
    const imp = state.upload && state.imported;
    const size = imp ? imp.ppg : state.upload ? 70 : GRID_PRESET[state.map.id] || src.width / 20;
    const s = makeScene({ name, map: src, grid: { size, feet: state.feet, calibrated: !state.upload || !!imp }, lighting: state.lighting, fog: { mode: state.fog }, status: 'ready', walls: imp ? structuredClone(imp.walls) : [], lights: imp ? structuredClone(imp.lights) : [] });
    const { cols, rows } = gridDims(s.grid, src.width, src.height);
    s.note = `${cols}×${rows} клеток`;
    const show = m.box.querySelector('[data-show]').checked;
    updateCampaign(ctx.cid, (cc) => { cc.scenes.push(s); if (show || !cc.activeSceneId) cc.activeSceneId = s.id; });
    m.close();
    ctx.ui.panel = 'scenes';
    ctx.switchScene(s.id);
    ctx.panels.renderSide();
    if (state.upload && !imp) setTimeout(() => ctx.setTool('grid'), 60);
    ctx.toast({ title: `Сцена «${name}» готова`, body: imp ? `Стены, двери и свет перенесены из карты (${imp.counts.walls + imp.counts.doors} отрезков, ${imp.counts.lights} источников)` : state.upload ? 'Подгоните сетку под клетки на карте' : show ? 'Игроки уже её видят' : 'Игроки её пока не видят', icon: 'maps' });
  }
}

// ——— Существа ———
export function placeCreatures(ctx, monsterId) {
  const m = monsterById(monsterId);
  if (!m || !ctx.scene) return;
  const st = bState(ctx);
  const n = sizeById(m.size).cells;
  const at = ctx.ui.placeAt || viewCenter(ctx);
  ctx.ui.placeAt = null;
  const spots = freeSpots(ctx.scene, at, st.count, n);
  const g = ctx.scene.grid, s = gridSize(g);
  const made = [];
  ctx.mutateScene((sc) => {
    for (const p of spots) {
      const name = nextTokenName(sc, m.name);
      let hp = m.hp;
      if (st.rollHp) { try { hp = Math.max(1, roll(m.hpDice.replace(/\s/g, '')).total); } catch { /* среднее */ } }
      const c0 = Math.round((p.x - (g.offsetX || 0)) / s - n / 2), r0 = Math.round((p.y - (g.offsetY || 0)) / s - n / 2);
      const t = monsterToken(m.id, name, c0, r0, { ...g, size: s }, { hidden: st.hidden, hp, hpMax: hp });
      sc.tokens.push(t);
      made.push(t);
    }
  }, { label: 'Существа', undo: (sc) => { const ids = new Set(made.map((t) => t.id)); sc.tokens = sc.tokens.filter((t) => !ids.has(t.id)); }, redo: (sc) => { for (const t of made) sc.tokens.push(structuredClone(t)); } });
  ctx.select(made.map((t) => t.id));
  const combat = ctx.c.combat.active;
  ctx.toast({
    title: `На карте: ${made.length > 1 ? `${made.length} × ` : ''}${m.name}`, body: st.hidden ? 'Скрыто от игроков' : 'Игроки видят, если в обзоре героев', icon: 'monster',
    action: combat ? { label: 'В бой', onClick: () => ctx.panels.combatToggle(made.map((t) => t.id)) } : null,
  });
}

// ——— Герой на сцену ———
export function heroPicker(ctx, anchor) {
  const c = ctx.c;
  const chars = c.characters;
  const render = () => `<div class="pick-pop">${`<div class="panel-header"><div class="titles"><div class="title">Герой на сцену</div><div class="subtitle">Встанет в центре экрана</div></div><button class="icon-btn icon-btn-sm" data-close>${icon('cancel-01', 18)}</button></div>`}
    <div class="w-list scroll">${chars.map((ch) => {
      const owner = ownerOfCharacter(c, ch);
      const here = ctx.scene.tokens.some((t) => t.characterId === ch.id);
      const where = c.scenes.find((s) => s.id !== ctx.sceneId && s.tokens.some((t) => t.characterId === ch.id));
      return `<div class="list-row"><span class="avatar sm hero"><img src="${esc(srcOf(ch.portrait))}" alt=""></span><span class="grow col-tight"><span class="primary">${esc(ch.name)}</span><span class="secondary">${owner ? esc(owner.name) : 'без игрока'}${where ? ` · в «${esc(where.name)}»` : here ? ' · уже здесь' : ''}</span></span>${here ? `<span class="chip chip-success">${icon('tick-02', 12)}</span>` : `<button class="btn btn-sm btn-secondary" data-place="${esc(ch.id)}">${where ? 'Перенести' : 'Поставить'}</button>`}</div>`;
    }).join('') || '<p class="t-sm muted" style="padding:0 16px">В кампании пока нет героев</p>'}</div></div>`;
  const pop = popover(render(), anchor, { placement: 'top' });
  pop.node.addEventListener('click', (e) => {
    const b = e.target.closest('[data-place]'); if (!b) return;
    placeHero(ctx, b.dataset.place);
    pop.node.innerHTML = render();
  });
}

export function placeHero(ctx, chId, at = null) {
  const c = ctx.c, ch = characterOf(c, chId);
  if (!ch || !ctx.scene) return;
  const p = freeSpots(ctx.scene, at || viewCenter(ctx), 1, 1)[0];
  const sid = ctx.sceneId;
  updateCampaign(ctx.cid, (cc) => {
    let tok = null;
    for (const sc of cc.scenes) { const t = sc.tokens.find((x) => x.characterId === chId); if (t) { tok = t; sc.tokens = sc.tokens.filter((x) => x !== t); break; } }
    tok = tok || { id: uid('t-'), kind: 'hero', characterId: chId, name: ch.name, img: ch.portrait, size: 'medium', hidden: false, conditions: [], light: ch.light || null, aura: ch.aura || null };
    tok.x = p.x; tok.y = p.y;
    const to = cc.scenes.find((s) => s.id === sid);
    to.tokens.push(tok);
    const m = cc.members.find((mm) => mm.characterId === chId);
    if (m) { if (sid === cc.activeSceneId) delete m.sceneId; else m.sceneId = sid; }
  });
  ctx.toast({ title: `${ch.name} на сцене`, body: sid === c.activeSceneId ? '' : 'Игрок теперь видит эту сцену — отряд разделился', icon: 'chess-pawn' });
}

// ——— Предметы ———
const ITEMS = [['package', 'Сундук'], ['barrel', 'Бочка'], ['potion', 'Зелье'], ['key-01', 'Ключ'], ['scroll', 'Свиток'], ['gem', 'Самоцвет'], ['skull', 'Останки'], ['bomb', 'Бомба'], ['flag-02', 'Флаг'], ['tent', 'Лагерь']];

export function itemPicker(ctx, anchor) {
  const pop = popover(`<div class="pick-pop"><div class="panel-header"><div class="titles"><div class="title">Предмет на карте</div><div class="subtitle">Фишка без хитов: сундук, ключ, лагерь</div></div><button class="icon-btn icon-btn-sm" data-close>${icon('cancel-01', 18)}</button></div>
    <div class="panel-section"><div class="item-grid">${ITEMS.map(([ic, name]) => `<button class="item-opt" data-item="${ic}" data-name="${esc(name)}"><img src="${esc(srcOf(`item:${ic}`))}" alt=""><span>${esc(name)}</span></button>`).join('')}</div>
    <label class="check t-sm"><input type="checkbox" data-hid>Скрыть от игроков</label></div></div>`, anchor, { placement: 'top' });
  pop.node.addEventListener('click', (e) => {
    const b = e.target.closest('[data-item]'); if (!b) return;
    const hidden = pop.node.querySelector('[data-hid]').checked;
    const p = freeSpots(ctx.scene, ctx.ui.placeAt || viewCenter(ctx), 1, 1)[0];
    ctx.ui.placeAt = null;
    const t = { id: uid('t-'), kind: 'item', name: nextTokenName(ctx.scene, b.dataset.name), img: `item:${b.dataset.item}`, size: 'small', x: p.x, y: p.y, hidden, conditions: [], hp: 0, hpMax: 0, ac: 10 };
    ctx.mutateScene((s) => { s.tokens.push(t); }, { label: 'Предмет', undo: (s) => { s.tokens = s.tokens.filter((x) => x.id !== t.id); }, redo: (s) => { s.tokens.push(structuredClone(t)); } });
    ctx.select([t.id]);
    closePopover();
  });
}

export { el, tokenStats, freeSpots };
