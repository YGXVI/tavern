// Стол кампании: связывает данные, камеру, слои мира, ввод, панели и события между вкладками.
import { el, throttle, debounce, uid } from '../../core/dom.js';
import { getDB, subscribe, bus, setPresence, onlineUsers, emitLocal, isServerMode } from '../../core/store.js';
import { currentUser } from '../../core/auth.js';
import {
  getCampaign, membership, roleIn, sceneOf, sceneIdFor, characterOf, canControlToken, updateCampaign, updateScene,
  tokenStats, userById,
} from '../../core/campaign.js';
import { Camera } from './camera.js';
import {
  buildWorld, sizeLayers, renderMap, renderGrid, renderTerrain, renderDrawings, renderWalls, renderMarkers,
  renderAreas, renderAuras, renderTokens, renderFog, renderOverlay, pingAt,
} from './world.js';
import { computeVision, isVisible, visibleCells } from './fog.js';
import { cellOf, gridSize, key } from '../../rules/geometry.js';
import { initiativeOrder } from './combat.js';
import { attachInput, remoteTrapCheck } from './input.js';
import { attachGizmo } from './gizmo.js';
import { attachDrawBar } from './drawings.js';
import { attachCreatureDrag } from './creature-drag.js';
import { loadSrdBestiary } from '../../data/bestiary.js';
import { refreshSheet } from './sheet.js';
import { renderChrome } from './chrome.js';
import { Panels } from './panels.js';
import { toast, closePopover, userAvatar } from '../../ui/kit.js';
import { History } from './history.js';
import { go } from '../screens.js';
import { icon } from '../../icons.js';

export function mountTable(root, cid) {
  const user = currentUser();
  root.innerHTML = '';
  const table = el(`<div class="table">
      <div class="viewport" tabindex="0" aria-label="Карта сцены"></div>
      <div class="edge-layer"></div>
      <div class="chrome"></div>
      <div class="toasts table-toasts" role="status" aria-live="polite"></div>
    </div>`);
  root.append(table);
  const viewport = table.querySelector('.viewport');
  const L = buildWorld(viewport);

  const ctx = {
    cid, userId: user.id, user, root: table, viewport, L,
    toastHost: table.querySelector('.table-toasts'),
    edgeLayer: table.querySelector('.edge-layer'),
    sceneId: null,
    ui: {
      tool: 'move', sub: {}, selection: new Set(), reach: null, threat: null, marquee: null, template: null, ruler: null,
      drag: null, viewAs: null, previewPlayers: false, selectedWall: null, selectedLight: null, brush: null,
      wallGhost: null, liveStroke: null, calib: null, shareRuler: true, widget: null, trapCells: null, layer: false,
    },
    remote: { rulers: new Map(), drags: new Map(), templates: new Map(), targets: new Map() },
    dragging: null,
    history: new History(),
    get c() { return getCampaign(this.cid); },
    get scene() { return sceneOf(this.c, this.sceneId); },
    get role() { return roleIn(this.c, this.userId); },
    get isMaster() { return this.role === 'master'; },
    get member() { return membership(this.c, this.userId); },
    get myCharacterId() { return this.member?.characterId || null; },
    get isMasterView() { return this.isMaster && !this.ui.viewAs && !this.ui.previewPlayers; },
  };

  // ——— Производные ———
  ctx.posOf = (t) => ctx.dragging?.get(t.id) || ctx.remote.drags.get(t.id) || t;
  // Режим стола: боевой — пока идёт бой на этой сцене, иначе обычный (исследование). TASK-028.
  ctx.inCombat = () => !!(ctx.c?.combat?.active && (!ctx.c.combat.sceneId || ctx.c.combat.sceneId === ctx.sceneId));
  ctx.isMine = (t) => !!t.characterId && t.characterId === ctx.myCharacterId;
  // Игрок может бросать и заканчивать ход за любого видимого героя — товарищ мог зайти в Discord с телефона (30.10).
  ctx.playsFor = (t) => !!t && (ctx.isMine(t) || (!!t.characterId && !t.hidden));
  // Хозяина героя нет за столом (или у героя нет игрока) — тогда остальным предлагаем бросить за него.
  ctx.ownerAway = (t) => {
    if (!t?.characterId || ctx.isMine(t)) return false;
    const owner = ctx.c?.members.find((m) => m.characterId === t.characterId && m.status === 'active');
    return !owner || !onlineUsers(ctx.cid).has(owner.userId);
  };
  ctx.canControl = (t) => canControlToken(ctx.c, ctx.userId, t) && !(ctx.c.paused && !ctx.isMaster);

  ctx.eyes = () => {
    const sc = ctx.scene; if (!sc) return [];
    const heroes = sc.tokens.filter((t) => t.kind === 'hero' && t.characterId && !t.hidden);
    if (ctx.ui.viewAs) return heroes.filter((t) => t.characterId === ctx.ui.viewAs);
    if (ctx.isMaster) return heroes;
    const mine = heroes.filter((t) => t.characterId === ctx.myCharacterId);
    if (ctx.c.settings.sharedVision) {
      // Общий обзор: видят все герои отряда, у которых есть игрок или которые стоят на сцене.
      return heroes;
    }
    return mine;
  };

  let visCache = null;
  // Обзор и свет идут за токеном в том же кадре (TASK-133): и за своим перетаскиванием, и за чужим (drag по шине).
  const movingNow = () => {
    const pos = {};
    for (const [id, d] of ctx.remote.drags) if (d.sceneId === ctx.sceneId) pos[id] = d;
    for (const [id, p] of ctx.dragging || []) pos[id] = p;
    return pos;
  };
  ctx.vision = () => {
    if (!visCache) visCache = computeVision(ctx.c, ctx.scene, ctx.eyes(), movingNow());
    return visCache;
  };
  ctx.invalidateVision = () => { visCache = null; };

  ctx.fogView = () => {
    const sc = ctx.scene;
    const relevant = sc.fog.mode !== 'off' || sc.lighting === 'dark' || (sc.fog.ops || []).length;
    if (!relevant) return 'none';
    if (!ctx.isMaster || ctx.ui.viewAs || ctx.ui.previewPlayers) return 'player';
    return 'master';
  };
  ctx.exploredSet = () => new Set(ctx.scene.fog.explored || []);
  ctx.pointVisibleNow = (p) => ctx.fogView() !== 'player' || isVisible(ctx.vision(), p, ctx.scene);
  ctx.pointKnown = (p) => {
    if (ctx.fogView() !== 'player') return true;
    if (isVisible(ctx.vision(), p, ctx.scene)) return true;
    const { c, r } = cellOf(ctx.scene.grid, p.x, p.y);
    return (ctx.scene.fog.explored || []).includes(key(c, r));
  };
  ctx.tokenShown = (t) => {
    if (ctx.isMasterView) return true;
    if (t.hidden) return false;
    if (ctx.fogView() !== 'player') return true;
    if (t.kind === 'hero') return true;
    return isVisible(ctx.vision(), ctx.posOf(t), ctx.scene);
  };
  // Имя для игроков: мастер может скрыть имя существа («Неизвестное существо»).
  ctx.nameOf = (t, st = tokenStats(ctx.c, t)) => (!ctx.isMasterView && t.nameHidden && t.kind !== 'hero' ? 'Неизвестное существо' : st.name);
  // Отношение существа: враг, нейтрал, союзник; «скрытый враг» игрокам виден союзником.
  ctx.dispositionOf = (t) => {
    if (t.kind === 'hero' || t.kind === 'item') return t.kind;
    const d = t.disposition || (t.kind === 'foe' ? 'hostile' : 'neutral');
    return d === 'secret' ? (ctx.isMasterView ? 'secret' : 'friendly') : d;
  };
  ctx.isDim = (t) => ctx.isMasterView && ctx.fogView() === 'master' && t.kind !== 'hero' && !t.hidden && !isVisible(ctx.vision(), ctx.posOf(t), ctx.scene);

  ctx.combatOrder = () => initiativeOrder(ctx.c, ctx.scene);
  ctx.currentTurnTokenId = () => {
    const cb = ctx.c.combat;
    if (!cb.active) return null;
    const o = ctx.combatOrder();
    return o[cb.turn % Math.max(1, o.length)]?.tokenId || null;
  };
  ctx.templates = () => {
    const list = [];
    if (ctx.ui.template) list.push(ctx.ui.template);
    for (const t of ctx.remote.templates.values()) if (t.sceneId === ctx.sceneId) list.push(t);
    return list;
  };
  ctx.rulers = () => {
    const list = [];
    if (ctx.ui.ruler?.pts?.length > 1) list.push(ctx.ui.ruler);
    for (const r of ctx.remote.rulers.values()) if (r.sceneId === ctx.sceneId && r.pts.length > 1) list.push({ ...r, remote: true });
    return list;
  };
  ctx.movePaths = () => {
    const list = [];
    if (ctx.ui.drag?.path) list.push(ctx.ui.drag.path);
    for (const d of ctx.remote.drags.values()) if (d.path && d.sceneId === ctx.sceneId) list.push({ ...d.path, remote: true });
    return list;
  };

  ctx.toast = (o) => toast({ ...(typeof o === 'string' ? { title: o } : o), host: ctx.toastHost });

  // ——— Изменения с историей ———
  ctx.mutateScene = (fn, undo) => {
    const sid = ctx.sceneId;
    const r = updateScene(ctx.cid, sid, (s, c) => fn(s, c));
    if (undo) ctx.history.push({ sceneId: sid, ...undo });
    return r;
  };
  ctx.mutate = (fn) => updateCampaign(ctx.cid, fn);

  // ——— Отрисовка по кадрам ———
  const dirty = new Set();
  let raf = 0;
  ctx.invalidate = (...what) => {
    for (const w of what.length ? what : ['all']) dirty.add(w);
    if (!raf) raf = requestAnimationFrame(flush);
  };
  function flush() {
    raf = 0;
    const sc = ctx.scene;
    if (!sc) return;
    const all = dirty.has('all');
    if (all || dirty.has('scene')) { sizeLayers(L, sc); renderMap(L, sc); }
    if (all || dirty.has('fog') || dirty.has('tokens')) ctx.invalidateVision();
    if (all || dirty.has('grid')) renderGrid(L, sc, true);
    if (all || dirty.has('terrain')) renderTerrain(L, sc, { showBlocked: ctx.isMasterView && ctx.ui.tool === 'terrain' });
    if (all || dirty.has('drawings')) renderDrawings(L, sc, ctx);
    if (all || dirty.has('walls')) renderWalls(L, sc, { edit: ctx.isMasterView && ctx.ui.tool === 'walls', selectedWall: ctx.ui.selectedWall, hoverWall: ctx.ui.hoverWall });
    // Туман и свет — в том же кадре, что и токены (TASK-133): неподвижные источники берутся из кэша fog.js,
    // каждый кадр пересчитываются только те, что сейчас тащат.
    if (all || dirty.has('fog') || dirty.has('tokens')) { renderFog(L, ctx); trackExplored(); }
    if (all || dirty.has('tokens')) renderTokens(L, ctx);
    if (all || dirty.has('markers') || dirty.has('fog') || dirty.has('tokens')) renderMarkers(L, ctx);
    if (all || dirty.has('areas') || dirty.has('tokens')) { renderAreas(L, ctx); renderAuras(L, ctx); }
    if (all || dirty.has('overlay') || dirty.has('tokens')) renderOverlay(L, ctx);
    if (all || dirty.has('chrome')) renderChrome(ctx);
    if (all || dirty.has('panels')) ctx.panels.refresh();
    updateEdges();
    dirty.clear();
  }

  // Пополнение «исследованного»: клетки, которые хоть раз видел отряд.
  const pendingExplored = new Set();
  const saveExplored = debounce(() => {
    if (!pendingExplored.size) return;
    const add = [...pendingExplored]; pendingExplored.clear();
    const sid = ctx.sceneId;
    updateScene(ctx.cid, sid, (s) => { const set = new Set(s.fog.explored || []); for (const k of add) set.add(k); s.fog.explored = [...set]; });
  }, 700);
  function trackExplored() {
    const sc = ctx.scene;
    if (ctx.dragging?.size) return;
    // Чужое перетаскивание ещё не ход: исследованное пополняется, когда токен отпустят.
    for (const d of ctx.remote.drags.values()) if (d.sceneId === ctx.sceneId) return;
    if (sc.fog.mode === 'off' && sc.lighting !== 'dark') return;
    if (ctx.ui.viewAs) return;
    const known = new Set(sc.fog.explored || []);
    const vis = ctx.vision();
    for (const k of visibleCells(vis, sc)) if (!known.has(k)) pendingExplored.add(k);
    if (pendingExplored.size) saveExplored();
  }

  // ——— Сцена ———
  ctx.switchScene = (sid, { fit = true } = {}) => {
    if (!sid || !sceneOf(ctx.c, sid)) { ctx.sceneId = null; showNoScene(); return; }
    const changed = ctx.sceneId !== sid;
    ctx.sceneId = sid;
    hideNoScene();
    if (changed) {
      ctx.ui.selection.clear(); ctx.ui.template = null; ctx.ui.ruler = null; ctx.ui.reach = null; ctx.ui.drag = null; ctx.ui.setup = null;
      ctx.dragging = null; ctx.remote.drags.clear();
      closePopover();
      L.map.dataset.ref = '';
      if (fit) requestAnimationFrame(() => ctx.fitScene(false));
    }
    setPresence({ userId: ctx.userId, campaignId: ctx.cid, sceneId: ctx.sceneId });
    ctx.invalidate('all', 'scene');
  };
  ctx.fitScene = (animate = true) => {
    const sc = ctx.scene; if (!sc) return;
    const saved = !animate && readCam();
    if (saved) { ctx.camera.set(saved.x, saved.y, saved.z); return; }
    // Игроку — показать своего героя крупнее, мастеру — всю карту.
    const mine = !ctx.isMaster && sc.tokens.find((t) => ctx.isMine(t));
    if (mine && !animate) {
      // На телефоне — ближе: столько клеток, чтобы фишки было удобно брать пальцем.
      const s = gridSize(sc.grid), vw = viewport.clientWidth;
      const cols = Math.max(5, Math.min(12, Math.round(vw / 80))), rows = Math.round(cols * 0.85);
      ctx.camera.fit({ x: mine.x - (s * cols) / 2, y: mine.y - (s * rows) / 2, w: s * cols, h: s * rows }, vw < 720 ? 12 : 40, false, 72, 72);
      return;
    }
    ctx.camera.fit({ x: 0, y: 0, w: sc.map.width, h: sc.map.height }, 40, animate, 72, 72);
  };
  const camKey = () => `rasputye-v2-cam:${ctx.cid}:${ctx.sceneId}`;
  function readCam() { try { return JSON.parse(sessionStorage.getItem(camKey()) || 'null'); } catch { return null; } }
  const saveCam = debounce(() => { try { sessionStorage.setItem(camKey(), JSON.stringify({ x: ctx.camera.x, y: ctx.camera.y, z: ctx.camera.z })); } catch { /* */ } }, 300);

  const noScene = el('<div class="no-scene hidden"></div>');
  table.insertBefore(noScene, table.querySelector('.chrome'));
  function showNoScene() { noScene.classList.remove('hidden'); ctx.panels?.renderNoScene(noScene); renderChrome(ctx); }
  function hideNoScene() { noScene.classList.add('hidden'); noScene.innerHTML = ''; }

  // ——— Индикаторы пингов за краем экрана ———
  const edgePings = new Map();
  function updateEdges() {
    const html = [];
    const vr = viewport.getBoundingClientRect();
    for (const [id, p] of edgePings) {
      if (Date.now() - p.at > 6000) { edgePings.delete(id); continue; }
      const s = ctx.camera.toScreen(p.x, p.y);
      const inside = s.x > vr.left + 40 && s.x < vr.right - 40 && s.y > vr.top + 40 && s.y < vr.bottom - 40;
      if (inside) continue;
      const cx = vr.left + vr.width / 2, cy = vr.top + vr.height / 2;
      const ang = Math.atan2(s.y - cy, s.x - cx);
      const k = Math.min((vr.width / 2 - 120) / Math.abs(Math.cos(ang) || 1e-6), (vr.height / 2 - 70) / Math.abs(Math.sin(ang) || 1e-6));
      const x = cx + Math.cos(ang) * k, y = cy + Math.sin(ang) * k;
      html.push(`<button class="edge-indicator" data-edge="${id}" style="left:${x}px;top:${y}px;--rot:${ang}rad;--pc:${p.color}">${p.avatar}<span>${p.name} отметил</span><i class="arr"></i></button>`);
    }
    ctx.edgeLayer.innerHTML = html.join('');
  }
  ctx.edgeLayer.addEventListener('click', (e) => {
    const b = e.target.closest('[data-edge]'); if (!b) return;
    const p = edgePings.get(b.dataset.edge); if (p) { ctx.camera.centerOn(p.x, p.y); edgePings.delete(b.dataset.edge); }
  });

  // ——— Пинги и «смотрите сюда» ———
  ctx.ping = (x, y, { look = false } = {}) => {
    const color = ctx.isMaster ? 'var(--ping-master)' : 'var(--ping-player)';
    pingAt(L, x, y, color, ctx.user.name, look);
    bus.send('ping', { cid: ctx.cid, sceneId: ctx.sceneId, x, y, look, userId: ctx.userId, master: ctx.isMaster });
    if (look) ctx.toast({ title: 'Игроки смотрят сюда', body: 'Камеры отряда переехали к этой точке', icon: 'location-01', action: { label: 'Отпустить', onClick: () => bus.send('look-release', { cid: ctx.cid }) } });
  };
  bus.on('ping', (p) => {
    if (p.cid !== ctx.cid || p.sceneId !== ctx.sceneId) return;
    const u = userById(p.userId);
    const color = p.master ? 'var(--ping-master)' : 'var(--ping-player)';
    pingAt(L, p.x, p.y, color, u?.name || '', p.look);
    if (p.look && !ctx.isMaster) {
      ctx.ui.lookLock = { x: p.x, y: p.y };
      ctx.camera.centerOn(p.x, p.y, Math.max(ctx.camera.z, 0.9));
      renderChrome(ctx);
    } else {
      edgePings.set(uid(), { x: p.x, y: p.y, at: Date.now(), name: u?.name || 'Кто-то', color, avatar: String(userAvatar(u, 'xs')) });
      updateEdges();
    }
  });
  bus.on('look-release', (p) => { if (p.cid === ctx.cid) { ctx.ui.lookLock = null; renderChrome(ctx); } });

  // ——— Перетаскивание и линейки других вкладок ———
  bus.on('drag', (p) => {
    if (p.cid !== ctx.cid) return;
    if (p.end) {
      for (const id of p.ids || []) ctx.remote.drags.delete(id);
      // Общее перемещение: если кто-то другой подвинул моего героя — скажем об этом.
      const mine = p.userId && p.userId !== ctx.userId && ctx.scene?.tokens.find((t) => (p.ids || []).includes(t.id) && ctx.isMine(t));
      if (mine && p.moved && ctx.inCombat()) { const u = userById(p.userId); ctx.toast({ title: `${u?.name || 'Кто-то'} подвинул вашего героя`, body: 'Ctrl+Z у него отменит перемещение', icon: 'cursor-hold-01', timeout: 3500 }); }
    }
    // by — кто тащит (TASK-162): у остальных токен в его цвете и с его именем; lead — ведущий токен группы.
    else for (const [id, pos] of Object.entries(p.positions)) ctx.remote.drags.set(id, { ...pos, sceneId: p.sceneId, path: id === p.leader ? p.path : null, by: p.userId, lead: id === p.leader || Object.keys(p.positions).length === 1 });
    ctx.invalidate('tokens');
  });
  bus.on('ruler', (p) => {
    if (p.cid !== ctx.cid) return;
    if (!p.pts) ctx.remote.rulers.delete(p.userId); else ctx.remote.rulers.set(p.userId, p);
    ctx.invalidate('overlay');
  });
  bus.on('target', (p) => {
    if (p.cid !== ctx.cid) return;
    if (!p.ids?.length) ctx.remote.targets.delete(p.userId); else ctx.remote.targets.set(p.userId, { sceneId: p.sceneId, ids: new Set(p.ids) });
    ctx.invalidate('tokens');
  });
  // Кто кого отметил целью: [{userId, hue}] для токена.
  ctx.targetersOf = (id) => {
    const out = [];
    if (ctx.ui.targets?.has(id)) out.push(ctx.user);
    for (const [uid2, v] of ctx.remote.targets) if (v.sceneId === ctx.sceneId && v.ids.has(id)) { const u = userById(uid2); if (u) out.push(u); }
    return out;
  };
  bus.on('template', (p) => {
    if (p.cid !== ctx.cid) return;
    if (!p.tpl) ctx.remote.templates.delete(p.userId); else ctx.remote.templates.set(p.userId, { ...p.tpl, sceneId: p.sceneId });
    ctx.invalidate('areas');
  });
  ctx.sendDrag = throttle((payload) => bus.send('drag', { cid: ctx.cid, sceneId: ctx.sceneId, userId: ctx.userId, ...payload }), 40);
  ctx.sendRuler = throttle((r) => bus.send('ruler', { cid: ctx.cid, sceneId: ctx.sceneId, userId: ctx.userId, ...(r || {}), pts: r?.pts || null }), 50);
  ctx.sendTemplate = throttle((tpl) => bus.send('template', { cid: ctx.cid, sceneId: ctx.sceneId, userId: ctx.userId, tpl }), 60);

  // ——— Камера ———
  ctx.camera = new Camera(viewport, L.world, () => {
    ctx.root.querySelector('[data-zoom-value]')?.replaceChildren(`${Math.round(ctx.camera.z * 100)}%`);
    // Издалека подписи токенов сливаются в кашу — прячем их, кроме выделенных, своих и того, чей ход.
    const far = ctx.camera.z * gridSize(ctx.scene?.grid || {}) < 34;
    if (far) viewport.dataset.far = '1'; else delete viewport.dataset.far;
    updateEdges();
    saveCam();
  });

  ctx.panels = new Panels(ctx);
  const detachInput = attachInput(ctx);
  attachGizmo(L, ctx);
  attachDrawBar(L, ctx);
  const detachCreatureDrag = attachCreatureDrag(ctx);

  // ——— Синхронизация с данными ———
  let lastSceneRev = null;
  let heroPos = { scene: null, map: new Map() };
  const unsub = subscribe((db, meta) => {
    const c = ctx.c;
    if (!c) { go('#/campaigns'); return; }
    const m = membership(c, ctx.userId);
    if (!m || m.status !== 'active') { go(`#/c/${ctx.cid}`); return; }
    if (m.role === 'player' && !m.characterId) { go(`#/c/${ctx.cid}`); return; }
    const want = ctx.isMaster ? (ctx.sceneId && sceneOf(c, ctx.sceneId) ? ctx.sceneId : c.activeSceneId || c.scenes[0]?.id) : sceneIdFor(c, ctx.userId);
    if (want !== ctx.sceneId) {
      const fromScene = ctx.sceneId;
      if (fromScene && !ctx.isMaster && want) ctx.panels.sceneTransition(sceneOf(c, want));
      ctx.switchScene(want);
      return;
    }
    if (!ctx.scene) { showNoScene(); return; }
    // Сервер: ловушки на пути чужого героя замечает клиент мастера (у игрока их нет).
    if (isServerMode() && ctx.isMaster && meta?.remote && heroPos.scene === ctx.sceneId) remoteTrapCheck(ctx, heroPos.map);
    heroPos = { scene: ctx.sceneId, map: new Map(ctx.scene.tokens.filter((t) => t.kind === 'hero').map((t) => [t.id, { x: t.x, y: t.y }])) };
    // Для оставшихся выделенных токенов, которые удалили.
    for (const id of [...ctx.ui.selection]) if (!ctx.scene.tokens.some((t) => t.id === id)) ctx.ui.selection.delete(id);
    ctx.invalidate('all');
    ctx.panels.onData(meta);
  });

  // Присутствие: обновляем «в сети» в чипах.
  const offPresence = bus.on('presence-change', () => ctx.invalidate('chrome', 'panels'));
  // Сервер: обрыв связи. Ходы ждут сети в очереди и уйдут сами; после переподключения кампания перечитывается.
  const offNet = bus.on('connection', (p) => {
    if (p.cid !== ctx.cid) return;
    ctx.root.querySelector('.net-pill')?.remove();
    if (!p.ok) ctx.root.append(el(`<div class="net-pill" role="status">${icon('wifi-disconnected-01', 16)}<span>Нет связи с сервером · ходы уйдут, когда сеть вернётся</span></div>`));
    else ctx.toast({ title: 'Связь восстановлена', icon: 'wifi-01', timeout: 2500 });
  });
  const offErr = bus.on('storage-error', (p) => ctx.toast({ title: 'Не сохранилось', body: p.message, icon: 'alert-circle' }));

  // ——— Старт ———
  // Полный бестиарий SRD (TASK-083) — отдельным файлом после открытия стола: подписи, листы и список существ дорисуются.
  let gone = false;
  loadSrdBestiary().then(() => {
    if (gone) return;
    ctx.invalidate('all');
    if (ctx.ui.panel === 'bestiary') ctx.panels.renderSide();
    refreshSheet(ctx);
  }, () => {
    if (!gone && ctx.isMaster) ctx.toast({ title: 'Бестиарий не загрузился', body: 'Доступны только основные существа. Обновите страницу, когда появится сеть.', icon: 'alert-circle' });
  });
  const c0 = ctx.c;
  ctx.switchScene(ctx.isMaster ? c0.activeSceneId || c0.scenes[0]?.id : sceneIdFor(c0, ctx.userId), { fit: true });
  renderChrome(ctx);
  ctx.panels.onEnter();
  // Лист героя по адресу #/c/<кампания>/sheet/<герой>: его можно открыть в новой вкладке (TASK-094).
  // Адрес сразу возвращается к столу, чтобы обновление страницы не открывало лист снова.
  const sheetFromHash = () => {
    const mm = location.hash.match(/^#\/c\/[^/]+\/sheet\/([^/?#]+)/);
    if (!mm) return;
    const chId = decodeURIComponent(mm[1]);
    history.replaceState(null, '', `#/c/${ctx.cid}`);
    if (characterOf(ctx.c, chId)) ctx.panels.openSheetFor({ characterId: chId });
  };
  sheetFromHash();
  setPresence({ userId: ctx.userId, campaignId: ctx.cid, sceneId: ctx.sceneId });
  const onResize = () => ctx.invalidate('chrome');
  addEventListener('resize', onResize);
  viewport.focus({ preventScroll: true });

  return {
    update: sheetFromHash,
    unmount() {
      gone = true;
      unsub(); offPresence(); offNet(); offErr(); detachInput(); detachCreatureDrag(); removeEventListener('resize', onResize);
      setPresence(null); closePopover(); ctx.panels.destroy();
      cancelAnimationFrame(raf);
    },
  };
}

export { emitLocal };
