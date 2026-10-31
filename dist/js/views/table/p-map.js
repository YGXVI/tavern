// Объекты карты: двери, стены, свет, метки, переходы, ловушки, шаблоны, текст, атака по возможности.
import { esc, uid, fmtMod, plural } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { srcOf } from '../../core/assets.js';
import { bus } from '../../core/store.js';
import { tokenStats, characterOf, addLog, sceneOf, updateCampaign, monsterOf } from '../../core/campaign.js';
import { LIGHTS, LIGHT_COLORS, ABILITIES, mod, profBonus, TEMPLATES } from '../../data/rules.js';
import { WALL_KINDS, cellOf, footprintAt, gridSize, gridDims, templateCells, footprintCells, key, cellCenter } from '../../rules/geometry.js';
import { popover, closePopover, confirmDialog } from '../../ui/kit.js';
import { doRoll, parseFormula, rollPool, describeRoll } from './dice.js';
import { sizeById } from '../../data/rules.js';
import { hpEditor } from './p-token.js';

const head = (title, sub = '') => `<div class="panel-header"><div class="titles"><div class="title">${esc(title)}</div>${sub ? `<div class="subtitle">${esc(sub)}</div>` : ''}</div><button class="icon-btn icon-btn-sm" data-close>${icon('cancel-01', 18)}</button></div>`;

const inMap = (ctx, p) => ({ x: Math.max(0, Math.min(ctx.scene.map.width, p.x)), y: Math.max(0, Math.min(ctx.scene.map.height, p.y)) });

// ——— Двери ———
export function doorClick(ctx, wallId, anchorEl) {
  const w = ctx.scene.walls.find((x) => x.id === wallId);
  if (!w) return;
  if (ctx.isMasterView) return masterDoor(ctx, w, anchorEl);
  return playerDoor(ctx, w, anchorEl);
}

function setWall(ctx, id, patch, label = 'Дверь') {
  const before = { ...ctx.scene.walls.find((x) => x.id === id) };
  ctx.mutateScene((s) => { const w = s.walls.find((x) => x.id === id); if (w) Object.assign(w, patch); },
    { label, undo: (s) => { const w = s.walls.find((x) => x.id === id); if (w) Object.assign(w, { open: before.open, locked: before.locked, kind: before.kind, discovered: before.discovered }); }, redo: (s) => { const w = s.walls.find((x) => x.id === id); if (w) Object.assign(w, patch); } });
}

function masterDoor(ctx, w, anchor) {
  const render = () => {
    const x = ctx.scene.walls.find((q) => q.id === w.id) || w;
    return `<div class="door-pop">${head(x.name || (x.kind === 'secret' ? 'Потайная дверь' : 'Дверь'), x.open ? 'Открыта' : x.locked ? `Заперта${x.lockDc ? ` · СЛ ${x.lockDc}` : ''}` : 'Закрыта')}
      <div class="panel-section">
        <button class="btn btn-primary btn-block" data-d="toggle">${icon(x.open ? 'door-01' : 'door-02', 18)}${x.open ? 'Закрыть' : 'Открыть'}</button>
        <div class="setting-row">${icon('door-lock', 18)}<span class="titles"><span class="label-main">Заперта</span><span class="hint">Игроку придётся взламывать</span></span><input type="checkbox" class="switch" data-d="lock" ${x.locked ? 'checked' : ''}></div>
        ${x.kind === 'secret' ? `<div class="setting-row">${icon('mask', 18)}<span class="titles"><span class="label-main">Найдена отрядом</span><span class="hint">Пассивная Внимательность ≥ ${x.perceptionDc || 14}</span></span><input type="checkbox" class="switch" data-d="found" ${x.discovered ? 'checked' : ''}></div>` : ''}
      </div></div>`;
  };
  const pop = popover(render(), anchor, { placement: 'top' });
  pop.node.addEventListener('click', (e) => {
    const b = e.target.closest('[data-d]'); if (!b) return;
    const x = ctx.scene.walls.find((q) => q.id === w.id);
    if (b.dataset.d === 'toggle') { setWall(ctx, w.id, { open: !x.open, locked: x.open ? x.locked : false }); closePopover(); return; }
    if (b.dataset.d === 'lock') setWall(ctx, w.id, { locked: b.checked, open: b.checked ? false : x.open });
    if (b.dataset.d === 'found') setWall(ctx, w.id, { discovered: b.checked });
    pop.node.innerHTML = render();
  });
}

/** Ближайший к точке свой герой на сцене (расстояние не ограничено) — его характеристики идут в проверки у двери. */
function heroNear(ctx, p) {
  let best = null, bd = Infinity;
  for (const t of ctx.scene.tokens) {
    if (!ctx.isMine(t)) continue;
    const d = Math.hypot(t.x - p.x, t.y - p.y);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

function playerDoor(ctx, w, anchor) {
  const mid = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
  const hero = heroNear(ctx, mid);
  const ch = hero ? characterOf(ctx.c, hero.characterId) : characterOf(ctx.c, ctx.myCharacterId);
  const pb = ch ? profBonus(ch.level) : 2;
  const perc = ch ? mod(ch.stats.wis) + (ch.skills.includes('perception') ? pb : 0) : 0;
  const dex = ch ? mod(ch.stats.dex) + (ch.classId === 'rogue' ? pb : 0) : 0;
  const str = ch ? mod(ch.stats.str) + (ch.skills.includes('athletics') ? pb : 0) : 0;
  if (w.open) {
    const pop = popover(`<div class="door-pop">${head(w.name || 'Дверь', 'Открыта')}<div class="panel-section"><button class="btn btn-secondary btn-block" data-d="close">${icon('door-01', 18)}Закрыть</button></div></div>`, anchor, { placement: 'top' });
    pop.node.addEventListener('click', (e) => { if (e.target.closest('[data-d="close"]')) { setWall(ctx, w.id, { open: false }); closePopover(); } });
    return;
  }
  if (w.locked) {
    const hasKnock = ch?.spells?.includes('Открывание');
    const pop = popover(`<div class="door-pop">${head('Заперто', w.name || '')}
      <div class="panel-section"><p class="t-sm muted">Тяжёлый засов с той стороны и старый замок. Как попробуете?</p>
      <button class="btn btn-secondary btn-block" data-d="pick">${icon('key-01', 16)}Взломать · Ловкость ${fmtMod(dex)}</button>
      <button class="btn btn-secondary btn-block" data-d="force">${icon('hand-grip', 16)}Выбить · Сила ${fmtMod(str)}</button>
      ${hasKnock ? `<button class="btn btn-secondary btn-block" data-d="knock">${icon('magic-wand-01', 16)}«Открывание» <span class="chip chip-magic">2 круг</span></button>` : ''}
      <button class="btn btn-ghost btn-block" data-d="ask">${icon('bubble-chat-question', 16)}Спросить мастера про ключ</button></div></div>`, anchor, { placement: 'top' });
    pop.node.addEventListener('click', (e) => {
      const b = e.target.closest('[data-d]'); if (!b) return;
      const name = ch?.name || 'Герой';
      if (b.dataset.d === 'pick' || b.dataset.d === 'force') {
        const r = doRoll(ctx, { label: `${name}: ${b.dataset.d === 'pick' ? 'взлом' : 'выбить дверь'}`, dice: { 20: 1 }, mod: b.dataset.d === 'pick' ? dex : str });
        bus.send('lockpick', { cid: ctx.cid, wallId: w.id, total: r.total, name, how: b.dataset.d, userId: ctx.userId });
        updateCampaign(ctx.cid, (c) => { c.doorAttempt = { wallId: w.id, total: r.total, name, how: b.dataset.d, at: Date.now(), userId: ctx.userId, sceneId: ctx.sceneId }; });
        ctx.toast({ title: 'Результат у мастера', body: 'Мастер решит, поддался ли замок', icon: 'hourglass' });
      }
      if (b.dataset.d === 'knock') { setWall(ctx, w.id, { locked: false, open: true }); ctx.toast({ title: '«Открывание»', body: 'Замок со звоном отпирается — громко!', icon: 'magic-wand-01' }); }
      if (b.dataset.d === 'ask') bus.send('door-ask', { cid: ctx.cid, wallId: w.id, name: ch?.name || ctx.user.name });
      closePopover();
    });
    return;
  }
  const pop = popover(`<div class="door-pop">${head(w.name || 'Дверь', 'Закрыта, но не заперта')}
    <div class="panel-section"><button class="btn btn-primary btn-block" data-d="open">${icon('door-02', 18)}Открыть</button>
    <button class="btn btn-secondary btn-block" data-d="listen">${icon('volume-off', 16)}Прислушаться · Восприятие ${fmtMod(perc)}</button>
    <p class="t-xs tertiary">Открыть дверь — бесплатное взаимодействие в ваш ход</p></div></div>`, anchor, { placement: 'top' });
  pop.node.addEventListener('click', (e) => {
    const b = e.target.closest('[data-d]'); if (!b) return;
    if (b.dataset.d === 'open') setWall(ctx, w.id, { open: true });
    if (b.dataset.d === 'listen') doRoll(ctx, { label: `${ch?.name || 'Герой'}: прислушаться у двери`, dice: { 20: 1 }, mod: perc });
    closePopover();
  });
}

export function lockpickResult(ctx, p) {
  if (!ctx.isMaster) return;
  const w = ctx.scene?.walls.find((x) => x.id === p.wallId);
  if (!w) return;
  const dc = w.lockDc || 15;
  const ok = p.total >= dc;
  const mid = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
  const s = ctx.camera.toScreen(mid.x, mid.y);
  const pop = popover(`<div class="door-pop">${head(`${p.name}: ${p.how === 'pick' ? 'взлом' : 'выбить дверь'}`, `Результат ${p.total} · СЛ ${dc}`)}
    <div class="panel-section"><span class="chip chip-md ${ok ? 'chip-success' : 'chip-negative'}" style="align-self:flex-start">${ok ? `Успех · СЛ ${dc}` : 'Не поддался'}</span>
    <div class="row"><button class="btn btn-ghost grow" data-d="no">Не поддался</button><button class="btn btn-primary grow" data-d="yes">${icon('door-02', 16)}Открыть дверь</button></div></div></div>`, s, { placement: 'top', keepOpen: true });
  pop.node.addEventListener('click', (e) => {
    const b = e.target.closest('[data-d]'); if (!b) return;
    if (b.dataset.d === 'yes') setWall(ctx, w.id, { locked: false, open: true });
    else ctx.toast({ title: 'Замок держится', body: `${p.name} может попробовать ещё раз`, icon: 'door-lock' });
    closePopover();
  });
}

// ——— Стены ———
export function wallPopover(ctx, id, anchor) {
  const render = () => {
    const w = ctx.scene.walls.find((x) => x.id === id);
    if (!w) return '';
    const k = WALL_KINDS[w.kind] || WALL_KINDS.wall;
    const len = Math.hypot(w.a.x - w.b.x, w.a.y - w.b.y) / gridSize(ctx.scene.grid) * (ctx.scene.grid.feet || 5);
    return `<div class="wall-pop">${head(`${k.name} · ${Math.round(len)} фт`)}
      <div class="panel-section"><div class="chips-wrap">${Object.entries(WALL_KINDS).map(([kk, v]) => `<button class="chip chip-md ${w.kind === kk ? 'chip-accent' : ''}" data-kind="${kk}">${esc(v.name)}</button>`).join('')}</div>
      <div class="setting-row">${icon('chess-pawn', 18)}<span class="titles"><span class="label-main">Не пускает</span><span class="hint">Токены не пройдут насквозь</span></span><span class="chip ${k.move ? 'chip-success' : ''}">${k.move ? 'да' : 'нет'}</span></div>
      <div class="setting-row">${icon('view-off', 18)}<span class="titles"><span class="label-main">Закрывает обзор</span><span class="hint">И свет, и взгляд героев</span></span><span class="chip ${k.sight ? 'chip-success' : ''}">${k.sight ? (k.door ? 'когда закрыта' : 'да') : 'нет'}</span></div>
      ${k.door ? `<div class="setting-row">${icon('door-lock', 18)}<span class="titles"><span class="label-main">Заперта</span></span><input type="checkbox" class="switch" data-lock ${w.locked ? 'checked' : ''}></div>` : ''}
      <button class="btn btn-ghost btn-sm" data-del style="align-self:flex-start;color:var(--text-negative)">${icon('delete-02', 14)}Удалить</button></div></div>`;
  };
  const pop = popover(render(), anchor, { placement: 'top', onClose: () => { ctx.ui.selectedWall = null; ctx.invalidate('walls'); } });
  pop.node.addEventListener('click', (e) => {
    const k = e.target.closest('[data-kind]');
    if (k) { setWall(ctx, id, { kind: k.dataset.kind, open: false }, 'Тип стены'); pop.node.innerHTML = render(); return; }
    if (e.target.closest('[data-lock]')) { setWall(ctx, id, { locked: e.target.checked }); return; }
    if (e.target.closest('[data-del]')) { deleteWall(ctx, id); closePopover(); }
  });
}

export function deleteWall(ctx, id) {
  const w = structuredClone(ctx.scene.walls.find((x) => x.id === id));
  if (!w) return;
  ctx.mutateScene((s) => { s.walls = s.walls.filter((x) => x.id !== id); }, { label: 'Удалить стену', undo: (s) => s.walls.push(structuredClone(w)), redo: (s) => { s.walls = s.walls.filter((x) => x.id !== id); } });
  ctx.ui.selectedWall = null;
}

// ——— Свет ———
export function addLight(ctx, p0, presetId, anchor) {
  const p = inMap(ctx, p0);
  const pr = LIGHTS.find((l) => l.id === presetId) || LIGHTS[0];
  const l = { id: uid('l-'), x: Math.round(p.x), y: Math.round(p.y), preset: pr.id, bright: pr.bright, dim: pr.dim, color: pr.color, flicker: pr.flicker, name: pr.name };
  ctx.mutateScene((s) => { s.lights.push(l); }, { label: 'Свет', undo: (s) => { s.lights = s.lights.filter((x) => x.id !== l.id); }, redo: (s) => s.lights.push(structuredClone(l)) });
  ctx.ui.selectedLight = l.id;
  if (anchor) setTimeout(() => lightPopover(ctx, l.id, anchor), 30);
}

export function lightPopover(ctx, id, anchor) {
  const render = () => {
    const l = ctx.scene.lights.find((x) => x.id === id);
    if (!l) return '';
    const pr = LIGHTS.find((x) => x.id === l.preset);
    return `<div class="light-pop">${head(l.name || pr?.name || 'Свет')}
      <div class="panel-section">
        <label class="slider-row"><span class="row"><span class="t-sm muted grow">Яркий свет</span><b class="t-sm">${l.bright} фт</b></span><input class="slider" type="range" min="0" max="60" step="5" value="${l.bright}" data-k="bright" style="--fill:${(l.bright / 60) * 100}%"></label>
        <label class="slider-row"><span class="row"><span class="t-sm muted grow">Тусклый свет</span><b class="t-sm">ещё ${l.dim} фт</b></span><input class="slider" type="range" min="0" max="60" step="5" value="${l.dim}" data-k="dim" style="--fill:${(l.dim / 60) * 100}%"></label>
        <div class="chips-wrap">${Object.entries(LIGHT_COLORS).map(([k, v]) => `<button class="chip chip-md ${l.color === k ? 'chip-accent' : ''}" data-color="${k}">${esc(v.name)}</button>`).join('')}</div>
        <div class="setting-row">${icon('fire', 18)}<span class="titles"><span class="label-main">Мерцание</span><span class="hint">Пламя чуть дрожит</span></span><input type="checkbox" class="switch" data-flicker ${l.flicker ? 'checked' : ''}></div>
        <button class="btn btn-ghost btn-sm" data-del style="align-self:flex-start;color:var(--text-negative)">${icon('delete-02', 14)}Убрать источник</button>
      </div></div>`;
  };
  ctx.ui.selectedLight = id;
  ctx.invalidate('markers', 'areas');
  const pop = popover(render(), anchor, { placement: 'top', onClose: () => { ctx.ui.selectedLight = null; ctx.invalidate('markers', 'areas'); } });
  const box = pop.node;
  let pending = null;
  box.addEventListener('input', (e) => {
    const k = e.target.dataset.k; if (!k) return;
    const v = Number(e.target.value);
    e.target.style.setProperty('--fill', `${(v / 60) * 100}%`);
    e.target.closest('.slider-row').querySelector('b').textContent = k === 'dim' ? `ещё ${v} фт` : `${v} фт`;
    const l = ctx.scene.lights.find((x) => x.id === id); if (l) { l[k] = v; ctx.invalidateVision(); ctx.invalidate('fog', 'areas'); }
    clearTimeout(pending);
    pending = setTimeout(() => ctx.mutateScene((s) => { const x = s.lights.find((q) => q.id === id); if (x) x[k] = v; }), 250);
  });
  box.addEventListener('click', (e) => {
    const c = e.target.closest('[data-color]');
    if (c) { ctx.mutateScene((s) => { const x = s.lights.find((q) => q.id === id); if (x) x.color = c.dataset.color; }); box.innerHTML = render(); }
    if (e.target.closest('[data-flicker]')) ctx.mutateScene((s) => { const x = s.lights.find((q) => q.id === id); if (x) x.flicker = e.target.checked; });
    if (e.target.closest('[data-del]')) { deleteLight(ctx, id); closePopover(); }
  });
}

export function deleteLight(ctx, id) {
  const l = structuredClone(ctx.scene.lights.find((x) => x.id === id));
  if (!l) return;
  ctx.mutateScene((s) => { s.lights = s.lights.filter((x) => x.id !== id); }, { label: 'Убрать свет', undo: (s) => s.lights.push(structuredClone(l)), redo: (s) => { s.lights = s.lights.filter((x) => x.id !== id); } });
  ctx.ui.selectedLight = null;
}

// ——— Метки ———
export function addPin(ctx, p0, kind, anchor) {
  const p = inMap(ctx, p0);
  const pin = { id: uid('p-'), x: Math.round(p.x), y: Math.round(p.y), kind, title: kind === 'secret' ? 'Заметка' : 'Новая метка', text: '', shown: false };
  ctx.mutateScene((s) => { s.pins.push(pin); }, { label: 'Метка', undo: (s) => { s.pins = s.pins.filter((x) => x.id !== pin.id); }, redo: (s) => s.pins.push(structuredClone(pin)) });
  setTimeout(() => pinPopover(ctx, pin.id, anchor, true), 30);
}

export function pinPopover(ctx, id, anchor, focus = false) {
  const pin = ctx.scene.pins.find((x) => x.id === id);
  if (!pin) return;
  if (!ctx.isMasterView) { ctx.panels.readAloud(pin); return; }
  const render = () => {
    const x = ctx.scene.pins.find((q) => q.id === id) || pin;
    const shown = x.shown && x.kind !== 'secret';
    return `<div class="pin-pop">${head(x.kind === 'secret' ? 'Заметка мастера' : 'Текст для чтения вслух', shown ? 'Игроки видят этот текст' : 'Игроки не видят')}
      <div class="panel-section">
        <div class="input"><input data-title value="${esc(x.title)}" maxlength="60" placeholder="Название"></div>
        <div class="input area"><textarea data-text rows="5" placeholder="Что видят и слышат герои">${esc(x.text)}</textarea></div>
        <div class="chips-wrap"><button class="chip chip-md ${x.kind === 'secret' ? 'chip-accent' : ''}" data-kind="secret">Только мастеру</button><button class="chip chip-md ${x.kind === 'read-aloud' ? 'chip-accent' : ''}" data-kind="read-aloud">Прочитаю вслух</button></div>
        <div class="row"><button class="btn btn-ghost btn-sm" data-del style="color:var(--text-negative)">${icon('delete-02', 14)}Удалить</button><span class="spacer"></span>${shown ? `<button class="btn btn-secondary" data-hide>${icon('view-off', 16)}Скрыть</button>` : ''}${x.kind === 'read-aloud' ? `<button class="btn btn-primary" data-show>${icon('view', 16)}${shown ? 'Ещё раз' : 'Показать игрокам'}</button>` : ''}</div>
      </div></div>`;
  };
  const pop = popover(render(), anchor, { placement: 'top' });
  const box = pop.node;
  if (focus) setTimeout(() => box.querySelector('[data-title]')?.select(), 40);
  const save = (patch) => ctx.mutateScene((s) => { const x = s.pins.find((q) => q.id === id); if (x) Object.assign(x, patch); });
  const x0 = () => ctx.scene.pins.find((q) => q.id === id) || pin;
  box.addEventListener('change', (e) => {
    if (e.target.matches('[data-title]')) save({ title: e.target.value.trim() || 'Метка' });
    if (e.target.matches('[data-text]')) save({ text: e.target.value });
  });
  box.addEventListener('click', (e) => {
    const k = e.target.closest('[data-kind]');
    // «Только мастеру» — выключить показ: метка и текст пропадают у игроков.
    if (k) { save(k.dataset.kind === 'secret' ? { kind: 'secret', shown: false } : { kind: k.dataset.kind }); box.innerHTML = render(); }
    if (e.target.closest('[data-hide]')) { save({ shown: false }); box.innerHTML = render(); ctx.toast({ title: 'Скрыто от игроков', body: x0().title, icon: 'view-off' }); }
    if (e.target.closest('[data-del]')) { const copy = structuredClone(ctx.scene.pins.find((q) => q.id === id)); ctx.mutateScene((s) => { s.pins = s.pins.filter((q) => q.id !== id); }, { label: 'Удалить метку', undo: (s) => s.pins.push(copy), redo: (s) => { s.pins = s.pins.filter((q) => q.id !== id); } }); closePopover(); }
    if (e.target.closest('[data-show]')) {
      const title = box.querySelector('[data-title]').value.trim(), text = box.querySelector('[data-text]').value;
      save({ title, text, shown: true });
      bus.send('read-aloud', { cid: ctx.cid, sceneId: ctx.sceneId, pinId: id, title, text });
      ctx.toast({ title: 'Игроки читают', body: title, icon: 'scroll' });
      closePopover();
    }
  });
}

// ——— Переходы между сценами ———
export function addPortal(ctx, p0, anchor) {
  const p = inMap(ctx, p0);
  const other = ctx.c.scenes.find((s) => s.id !== ctx.sceneId);
  const g = { id: uid('g-'), x: Math.round(p.x), y: Math.round(p.y), name: 'Переход', targetSceneId: other?.id || null, target: null, mode: 'ask', label: other?.name || '' };
  ctx.mutateScene((s) => { s.portals.push(g); }, { label: 'Переход', undo: (s) => { s.portals = s.portals.filter((x) => x.id !== g.id); }, redo: (s) => s.portals.push(structuredClone(g)) });
  setTimeout(() => portalPopover(ctx, g.id, anchor), 30);
}

export function portalPopover(ctx, id, anchor) {
  const p0 = ctx.scene.portals.find((x) => x.id === id);
  if (!p0) return;
  if (!ctx.isMasterView) {
    const target = sceneOf(ctx.c, p0.targetSceneId);
    popover(`<div class="pin-pop">${head(p0.name, target ? `Ведёт в «${target.name}»` : 'Куда ведёт — знает мастер')}<div class="panel-section"><p class="t-sm muted">Доведите героя до этой клетки — ${p0.mode === 'immediate' ? 'переход сработает сразу' : p0.mode === 'master' ? 'переход открывает мастер' : 'мастер получит запрос'}.</p></div></div>`, anchor, { placement: 'top' });
    return;
  }
  const render = () => {
    const p = ctx.scene.portals.find((x) => x.id === id) || p0;
    return `<div class="portal-pop">${head('Переход', p.name)}
      <div class="panel-section">
        <div class="input"><input data-name value="${esc(p.name)}" maxlength="40"></div>
        <div class="label">Куда ведёт</div>
        <div class="scene-pick">${ctx.c.scenes.filter((s) => s.id !== ctx.sceneId).map((s) => `<button class="scene-mini ${p.targetSceneId === s.id ? 'on' : ''}" data-target="${s.id}"><span style="background-image:url(${esc(srcOf(s.map.src))})"></span>${esc(s.name)}</button>`).join('') || '<span class="t-sm muted">Других сцен пока нет</span>'}</div>
        <div class="label">Кто решает</div>
        <div class="chips-wrap"><button class="chip chip-md ${p.mode === 'ask' ? 'chip-accent' : ''}" data-mode="ask">Спросить мастера</button><button class="chip chip-md ${p.mode === 'immediate' ? 'chip-accent' : ''}" data-mode="immediate">Сразу</button><button class="chip chip-md ${p.mode === 'master' ? 'chip-accent' : ''}" data-mode="master">Только мастер</button></div>
        <div class="row"><button class="btn btn-ghost btn-sm" data-del style="color:var(--text-negative)">${icon('delete-02', 14)}Удалить</button><span class="spacer"></span><button class="btn btn-primary" data-close>${icon('tick-02', 16)}Сохранить переход</button></div>
      </div></div>`;
  };
  const pop = popover(render(), anchor, { placement: 'top' });
  const box = pop.node;
  const save = (patch) => ctx.mutateScene((s) => { const x = s.portals.find((q) => q.id === id); if (x) Object.assign(x, patch); });
  box.addEventListener('change', (e) => { if (e.target.matches('[data-name]')) save({ name: e.target.value.trim() || 'Переход' }); });
  box.addEventListener('click', (e) => {
    const t = e.target.closest('[data-target]');
    if (t) { save({ targetSceneId: t.dataset.target, label: sceneOf(ctx.c, t.dataset.target)?.name || '' }); box.innerHTML = render(); }
    const m = e.target.closest('[data-mode]');
    if (m) { save({ mode: m.dataset.mode }); box.innerHTML = render(); }
    if (e.target.closest('[data-del]')) { ctx.mutateScene((s) => { s.portals = s.portals.filter((q) => q.id !== id); }); closePopover(); }
  });
}

/** Токен дошёл до перехода. */
export function portalReached(ctx, portal, token) {
  const target = sceneOf(ctx.c, portal.targetSceneId);
  if (!target) return;
  const st = tokenStats(ctx.c, token);
  if (ctx.isMaster) {
    const s = ctx.camera.toScreen(portal.x, portal.y);
    const pop = popover(`<div class="portal-pop">${head(`${st.name} у перехода`, `«${portal.name}» → «${target.name}»`)}<div class="panel-section"><button class="btn btn-primary btn-block" data-go>${icon('stairs-01', 16)}Перенести на «${esc(target.name)}»</button><button class="btn btn-ghost btn-block" data-close>Оставить здесь</button></div></div>`, s, { placement: 'top' });
    pop.node.querySelector('[data-go]').addEventListener('click', () => { transferTokens(ctx, [token.id], portal); closePopover(); });
    return;
  }
  if (portal.mode === 'master') { ctx.toast({ title: 'Этот переход открывает мастер', icon: 'stairs-01' }); return; }
  if (portal.mode === 'immediate') { transferTokens(ctx, [token.id], portal); return; }
  const req = { id: uid('q-'), tokenId: token.id, portalId: portal.id, sceneId: ctx.sceneId, userId: ctx.userId, at: Date.now() };
  updateCampaign(ctx.cid, (c) => { c.portalRequests = [...(c.portalRequests || []).filter((r) => r.tokenId !== token.id), req]; });
  const others = ctx.scene.tokens.filter((t) => t.kind === 'hero' && t.id !== token.id).map((t) => tokenStats(ctx.c, t).name);
  ctx.toast({ title: `Спуск в «${target.name}»`, body: `Ждём, пока мастер пустит.${others.length ? ` ${others.join(', ')} останутся здесь` : ''}`, icon: 'hourglass', timeout: 0, action: { label: 'Отменить', onClick: () => updateCampaign(ctx.cid, (c) => { c.portalRequests = (c.portalRequests || []).filter((r) => r.id !== req.id); }) } });
}

/** Перенести токены на сцену перехода. Отряд может разделиться — у игрока своя сцена. */
export function transferTokens(ctx, tokenIds, portal, fromSceneId = ctx.sceneId) {
  updateCampaign(ctx.cid, (c) => {
    const from = c.scenes.find((s) => s.id === fromSceneId);
    const to = c.scenes.find((s) => s.id === portal.targetSceneId);
    if (!from || !to) return;
    const g = gridSize(to.grid);
    const base = portal.target || { x: to.map.width / 2, y: to.map.height / 2 };
    tokenIds.forEach((id, i) => {
      const t = from.tokens.find((x) => x.id === id);
      if (!t) return;
      from.tokens = from.tokens.filter((x) => x.id !== id);
      const n = sizeById(t.size).cells;
      const col = Math.floor((base.x - (to.grid.offsetX || 0)) / g) + (i % 3), row = Math.floor((base.y - (to.grid.offsetY || 0)) / g) + Math.floor(i / 3);
      t.x = (to.grid.offsetX || 0) + (col + n / 2) * g; t.y = (to.grid.offsetY || 0) + (row + n / 2) * g;
      to.tokens.push(t);
      if (t.characterId) { const m = c.members.find((mm) => mm.characterId === t.characterId); if (m) m.sceneId = to.id; }
    });
    c.portalRequests = (c.portalRequests || []).filter((r) => !tokenIds.includes(r.tokenId));
    // Если на исходной сцене не осталось героев, весь отряд теперь на новой.
    const heroesLeft = from.tokens.some((t) => t.kind === 'hero' && c.members.some((m) => m.characterId === t.characterId && m.status === 'active'));
    if (!heroesLeft && c.activeSceneId === from.id) { c.activeSceneId = to.id; for (const m of c.members) if (m.sceneId === to.id) delete m.sceneId; }
    addLog(c, { kind: 'scene', text: `${tokenIds.length} → «${to.name}»` });
  });
}

// ——— Ловушки ———
export function addTrap(ctx, cells0, anchor) {
  const { cols, rows } = gridDims(ctx.scene.grid, ctx.scene.map.width, ctx.scene.map.height);
  const cells = cells0.filter((k) => { const [c, r] = k.split(',').map(Number); return c >= 0 && r >= 0 && c < cols && r < rows; });
  if (!cells.length) { ctx.ui.trapCells = null; ctx.invalidate('areas'); return; }
  const tr = { id: uid('tr-'), cells, name: 'Ловушка', save: 'dex', dc: 13, damage: '2d10', hidden: true, triggered: false, note: '' };
  ctx.mutateScene((s) => { s.traps.push(tr); }, { label: 'Ловушка', undo: (s) => { s.traps = s.traps.filter((x) => x.id !== tr.id); }, redo: (s) => s.traps.push(structuredClone(tr)) });
  setTimeout(() => trapPopover(ctx, tr.id, anchor), 30);
}

export function trapPopover(ctx, id, anchor) {
  if (!ctx.isMasterView) return;
  const render = () => {
    const t = ctx.scene.traps.find((x) => x.id === id);
    if (!t) return '';
    return `<div class="trap-pop">${head(t.name, `${t.cells.length} ${plural(t.cells.length, 'клетка', 'клетки', 'клеток')}${t.triggered ? ' · сработала' : ' · ждёт'}`)}
      <div class="panel-section">
        <div class="input"><input data-name value="${esc(t.name)}" maxlength="40"></div>
        <div class="label">Спасбросок</div>
        <div class="chips-wrap">${ABILITIES.map((a) => `<button class="chip chip-md ${t.save === a.id ? 'chip-accent' : ''}" data-save="${a.id}">${a.short}</button>`).join('')}</div>
        <div class="form-grid"><div class="field"><label>Сложность</label><div class="input"><input type="number" data-dc value="${t.dc}" min="1" max="30"></div></div><div class="field"><label>Урон</label><div class="input"><input data-dmg value="${esc(t.damage)}" placeholder="2d10"></div></div></div>
        <div class="setting-row">${icon('view-off', 18)}<span class="titles"><span class="label-main">Скрыта от игроков</span><span class="hint">${esc(t.note || 'После срабатывания станет видна')}</span></span><input type="checkbox" class="switch" data-hidden ${t.hidden ? 'checked' : ''}></div>
        ${t.triggered ? `<button class="btn btn-secondary btn-sm" data-rearm>${icon('reload', 14)}Взвести снова</button>` : ''}
        <div class="row"><button class="btn btn-ghost btn-sm" data-del style="color:var(--text-negative)">${icon('delete-02', 14)}Удалить</button><span class="spacer"></span><button class="btn btn-primary" data-close>Готово</button></div>
      </div></div>`;
  };
  const pop = popover(render(), anchor, { placement: 'top', onClose: () => { ctx.ui.trapCells = null; ctx.invalidate('areas'); } });
  const box = pop.node;
  const save = (patch) => ctx.mutateScene((s) => { const x = s.traps.find((q) => q.id === id); if (x) Object.assign(x, patch); });
  box.addEventListener('change', (e) => {
    if (e.target.matches('[data-name]')) save({ name: e.target.value.trim() || 'Ловушка' });
    if (e.target.matches('[data-dc]')) save({ dc: Math.max(1, Number(e.target.value) || 10) });
    if (e.target.matches('[data-dmg]')) save({ damage: e.target.value.trim() });
    if (e.target.matches('[data-hidden]')) save({ hidden: e.target.checked });
  });
  box.addEventListener('click', (e) => {
    const sv = e.target.closest('[data-save]');
    if (sv) { save({ save: sv.dataset.save }); box.innerHTML = render(); }
    if (e.target.closest('[data-rearm]')) { save({ triggered: false }); box.innerHTML = render(); }
    if (e.target.closest('[data-del]')) { ctx.mutateScene((s) => { s.traps = s.traps.filter((q) => q.id !== id); }); closePopover(); }
  });
}

export function trapTriggered(ctx, trap, token, remote = false) {
  if (!remote) {
    ctx.mutateScene((s) => { const t = s.traps.find((x) => x.id === trap.id); if (t) t.triggered = true; });
    bus.send('trap', { cid: ctx.cid, sceneId: ctx.sceneId, trapId: trap.id, tokenId: token.id });
  }
  const st = tokenStats(ctx.c, token);
  if (!ctx.isMaster) {
    if (!remote) ctx.toast({ title: 'Под ногой щёлкнуло!', body: 'Мастер решает, что будет дальше', icon: 'danger' });
    return;
  }
  const ab = ABILITIES.find((a) => a.id === trap.save);
  const s = ctx.camera.toScreen(token.x, token.y);
  const pop = popover(`<div class="trap-pop">${head('Ловушка сработала', `${st.name} · «${trap.name}»`)}
    <div class="panel-section"><button class="btn btn-primary btn-block" data-req>${icon('dice-faces-06', 16)}Запросить спасбросок ${ab?.short || ''}</button>
    <button class="btn btn-danger btn-block" data-dmg>${icon('flash', 16)}Сразу урон ${esc(trap.damage)}</button></div></div>`, s, { placement: 'top', keepOpen: true });
  pop.node.addEventListener('click', (e) => {
    if (e.target.closest('[data-req]')) { ctx.panels.requestSaves({ ability: trap.save, dc: trap.dc, label: trap.name, tokenIds: [token.id], damage: trap.damage, half: true }); closePopover(); }
    if (e.target.closest('[data-dmg]')) {
      const f = parseFormula(trap.damage);
      if (f) { const r = doRoll(ctx, { label: `${trap.name}: урон`, ...f }); ctx.panels.applyHp([token.id], -r.total); }
      closePopover();
    }
  });
}

// ——— Шаблоны ———
export function templatePopover(ctx, anchor) {
  const tpl = ctx.ui.template;
  if (!tpl) return;
  const sc = ctx.scene;
  const { cols, rows } = gridDims(sc.grid, sc.map.width, sc.map.height);
  const cells = new Set(templateCells(sc.grid, tpl, cols, rows).map((c) => key(c.c, c.r)));
  const targets = sc.tokens.filter((t) => {
    if (!ctx.tokenShown(t)) return false;
    const n = sizeById(t.size).cells;
    const fp = footprintAt(sc.grid, t.x, t.y, n);
    return footprintCells(fp.c, fp.r, n).some((x) => cells.has(key(x.c, x.r)));
  });
  const def = TEMPLATES.find((t) => t.id === tpl.type);
  ctx.ui.templateTargets = targets.map((t) => t.id);
  const list = targets.map((t) => { const st = tokenStats(ctx.c, t); return `<div class="list-row"><span class="avatar sm ${t.kind}"><img src="${esc(srcOf(t.img))}" alt=""></span><span class="primary grow">${esc(st.name)}</span></div>`; }).join('');
  const pop = popover(`<div class="tpl-pop">${head(`${def.name} · ${tpl.size} фт`, `В области: ${targets.length} ${plural(targets.length, 'цель', 'цели', 'целей')}`)}
    <div class="tpl-list scroll">${list || '<p class="t-sm muted" style="padding:0 16px">Никого не задевает</p>'}</div>
    <div class="panel-section">${ctx.isMaster
      ? `<p class="t-xs tertiary">Спасброски героев попросим у игроков, за существ бросите вы.</p>`
      : `<p class="t-xs tertiary">Мастер бросит за врагов спасброски и применит урон.</p>`}</div>
    <div class="panel-footer"><button class="btn btn-ghost" data-clear>Убрать</button><span class="spacer"></span>${ctx.isMaster
      ? `<button class="btn btn-secondary" data-dmg ${targets.length ? '' : 'disabled'}>${icon('first-aid-kit', 16)}Урон</button><button class="btn btn-primary" data-saves ${targets.length ? '' : 'disabled'}>${icon('dice-faces-06', 16)}Спасброски</button>`
      : `<button class="btn btn-primary" data-send>${icon('arrow-right-02', 16)}Отправить мастеру</button>`}</div></div>`, anchor, { placement: 'right', className: 'tpl-popover' });
  pop.node.addEventListener('click', (e) => {
    if (e.target.closest('[data-clear]')) { ctx.clearMeasure(); }
    if (e.target.closest('[data-dmg]')) { closePopover(); hpEditor(ctx, targets.map((t) => t.id), anchor, 'damage'); }
    if (e.target.closest('[data-saves]')) { closePopover(); ctx.panels.saveRequestPanel(targets.map((t) => t.id), { label: def.name }); }
    if (e.target.closest('[data-send]')) {
      bus.send('template-share', { cid: ctx.cid, sceneId: ctx.sceneId, tpl, targets: targets.map((t) => t.id), userId: ctx.userId, name: characterOf(ctx.c, ctx.myCharacterId)?.name || ctx.user.name });
      ctx.toast({ title: 'Отправлено мастеру', body: `${def.name} ${tpl.size} фт · ${targets.length} ${plural(targets.length, 'цель', 'цели', 'целей')}`, icon: 'arrow-right-02' });
      closePopover();
    }
  });
}

// ——— Атака по возможности ———
export function opportunityWarning(ctx, token, foes, handlers) {
  const names = foes.map((f) => tokenStats(ctx.c, f).name);
  const s = ctx.camera.toScreen(token.x, token.y);
  const pop = popover(`<div class="warn-pop"><div class="panel-header"><span class="status-badge negative">${icon('alert-circle', 13)}</span><div class="titles"><div class="title">${esc(names.join(', '))} ${names.length > 1 ? 'ударят' : 'ударит'} вслед</div></div></div>
    <div class="panel-section"><p class="t-sm muted">Вы выходите из досягаемости — у врага есть атака по возможности. «Отход» убережёт, но займёт действие.</p>
    <button class="btn btn-secondary btn-block" data-w="dis">${icon('shield-01', 16)}Сначала «Отход»</button>
    <div class="row"><button class="btn btn-ghost" data-w="cancel">Отмена</button><button class="btn btn-danger grow" data-w="go">Всё равно идти</button></div></div></div>`, s, { placement: 'left', keepOpen: true });
  pop.node.addEventListener('click', (e) => {
    const b = e.target.closest('[data-w]'); if (!b) return;
    closePopover();
    ({ go: handlers.go, dis: handlers.disengage, cancel: handlers.cancel })[b.dataset.w]?.();
  });
}

export function opportunityForMaster(ctx, p) {
  if (!ctx.isMaster) return;
  const sc = ctx.scene;
  const t = sc?.tokens.find((x) => x.id === p.tokenId);
  if (!t) return;
  const st = tokenStats(ctx.c, t);
  for (const fid of p.foes) {
    const f = sc.tokens.find((x) => x.id === fid);
    if (!f) continue;
    const fs = tokenStats(ctx.c, f);
    const m = monsterOf(ctx.c, f.monsterId);
    const a = m?.actions.find((x) => x.bonus);
    ctx.toast({
      title: `${st.name} выходит из досягаемости`, body: `${fs.name} может атаковать по возможности`, icon: 'sword-03', timeout: 12000,
      action: a ? { label: 'Атаковать', onClick: () => { const r = doRoll(ctx, { label: `${fs.name}: ${a.name} (по возможности)`, dice: { 20: 1 }, mod: a.bonus, kind: 'attack' }); const ac = tokenStats(ctx.c, t).ac; if (r.total >= ac || r.entry.nat === 20) { const f2 = parseFormula(a.damage); if (f2) { const d = doRoll(ctx, { label: `${fs.name}: урон`, ...f2 }); ctx.panels.applyHp([t.id], -(r.entry.nat === 20 ? d.total * 2 : d.total)); } } else ctx.toast({ title: 'Промах', body: `${r.total} против КД ${ac}`, icon: 'shield-01' }); } } : null,
    });
  }
}

// ——— Текст на карте ———
export function textPrompt(ctx, w, anchor, existing = null) {
  // existing — правка уже стоящей надписи (TASK-031).
  const pop = popover(`<div class="pin-pop">${head(existing ? 'Изменить надпись' : 'Надпись на карте')}<div class="panel-section"><div class="input"><input data-t maxlength="60" placeholder="Например, «Обвал»" value="${esc(existing?.text || '')}" autofocus></div><button class="btn btn-primary" data-ok>${existing ? 'Сохранить' : 'Поставить'}</button></div></div>`, anchor, { placement: 'top' });
  const inp = pop.node.querySelector('[data-t]');
  setTimeout(() => { inp.focus(); inp.select(); }, 30);
  const ok = () => {
    const text = inp.value.trim(); if (!text) return;
    if (existing) {
      const id = existing.id, before = existing.text;
      ctx.mutateScene((s) => { const x = s.drawings.find((q) => q.id === id); if (x) x.text = text; }, { label: 'Надпись', undo: (s) => { const x = s.drawings.find((q) => q.id === id); if (x) x.text = before; }, redo: (s) => { const x = s.drawings.find((q) => q.id === id); if (x) x.text = text; } });
      closePopover();
      return;
    }
    const d = { id: uid('d-'), type: 'text', x: Math.round(w.x), y: Math.round(w.y), text, color: '#e9b052', size: Math.round(gridSize(ctx.scene.grid) * 0.4), author: ctx.userId };
    ctx.mutateScene((s) => { s.drawings.push(d); }, { label: 'Надпись', undo: (s) => { s.drawings = s.drawings.filter((x) => x.id !== d.id); }, redo: (s) => s.drawings.push(structuredClone(d)) });
    closePopover();
  };
  pop.node.querySelector('[data-ok]').addEventListener('click', ok);
  inp.addEventListener('keydown', (e) => e.key === 'Enter' && ok());
}

export { cellOf, cellCenter, rollPool, describeRoll };
