// Слои мира: карта, сетка, местность, рисунки, свечение, области, стены, маркеры, токены, туман, оверлей.
// Всё в координатах карты; камера двигает один контейнер .world.
import { el, esc, initials, hueOf } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { srcOf, resolveSrc } from '../../core/assets.js';
import { gridDims, gridSize, key, unkey, templatePolygon, templateCells } from '../../rules/geometry.js';
import { tokenStats, userById, isMasterOf } from '../../core/campaign.js';
import { sizeById, conditionById, LIGHT_COLORS, woundLabel, auraHex, auraAlpha } from '../../data/rules.js';
import { drawFog, drawLightGlow, ftToPx } from './fog.js';
import { tokenLook, renderGizmo } from './gizmo.js';
import { canEditDrawing, renderDrawBar, shapeMarkup, liveDrawing } from './drawings.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (cls) => { const s = document.createElementNS(SVGNS, 'svg'); s.setAttribute('class', `layer ${cls}`); return s; };

export function buildWorld(viewport) {
  const world = el('<div class="world"></div>');
  const L = {
    world,
    map: el('<img class="layer map-img" alt="" draggable="false">'),
    glow: el('<canvas class="layer glow-canvas"></canvas>'),
    grid: svg('grid-layer'),
    terrain: svg('terrain-layer'),
    drawings: svg('drawings-layer'),
    areas: svg('areas-layer'),
    auras: svg('auras-layer'),
    // Досягаемость и угроза — «поле» под токенами (TASK-130): клетки не ложатся на токены, подписи и рамку.
    ground: svg('ground-layer'),
    walls: svg('walls-layer'),
    markers: el('<div class="layer markers-layer"></div>'),
    tokens: el('<div class="layer tokens-layer"></div>'),
    auraLabels: el('<div class="layer aura-labels"></div>'),
    fog: el('<canvas class="layer fog-canvas"></canvas>'),
    overlay: svg('overlay-layer'),
    labels: el('<div class="layer labels-layer"></div>'),
    gizmo: el('<div class="layer gizmo-layer"></div>'),
    drawUi: el('<div class="layer gizmo-layer draw-ui"></div>'),
  };
  L.terrain.innerHTML = `<defs><pattern id="hatch" patternUnits="userSpaceOnUse" width="12" height="12" patternTransform="rotate(45)"><rect width="12" height="12" fill="rgba(0,0,0,.28)"/><line x1="0" y1="0" x2="0" y2="12" stroke="rgba(255,255,255,.42)" stroke-width="3"/></pattern><pattern id="hatch-red" patternUnits="userSpaceOnUse" width="12" height="12" patternTransform="rotate(-45)"><rect width="12" height="12" fill="rgba(229,88,79,.18)"/><line x1="0" y1="0" x2="0" y2="12" stroke="rgba(229,88,79,.5)" stroke-width="3"/></pattern></defs><g class="t"></g>`;
  world.append(L.map, L.glow, L.grid, L.terrain, L.drawings, L.walls, L.auras, L.ground, L.markers, L.tokens, L.auraLabels, L.fog, L.areas, L.overlay, L.labels, L.gizmo, L.drawUi);
  viewport.append(world);
  return L;
}

export function sizeLayers(L, scene) {
  const { width: W, height: H } = scene.map;
  for (const k of ['grid', 'terrain', 'drawings', 'areas', 'auras', 'ground', 'walls', 'overlay']) {
    L[k].setAttribute('viewBox', `0 0 ${W} ${H}`);
    L[k].setAttribute('width', W); L[k].setAttribute('height', H);
  }
  for (const k of ['fog', 'glow', 'markers', 'tokens', 'labels', 'auraLabels', 'gizmo', 'drawUi']) { L[k].style.width = `${W}px`; L[k].style.height = `${H}px`; }
  L.map.style.width = `${W}px`; L.map.style.height = `${H}px`;
  L.world.style.width = `${W}px`; L.world.style.height = `${H}px`;
}

export async function renderMap(L, scene) {
  const ref = scene.map.src;
  if (L.map.dataset.ref === ref) return;
  L.map.dataset.ref = ref;
  L.map.src = srcOf(ref) || (await resolveSrc(ref)) || '';
}

export function renderGrid(L, scene, show) {
  const g = scene.grid;
  if (!show || g.visible === false) { L.grid.innerHTML = ''; return; }
  const s = gridSize(g), W = scene.map.width, H = scene.map.height;
  const { cols, rows } = gridDims(g, W, H);
  let d = '';
  const ox = g.offsetX || 0, oy = g.offsetY || 0;
  const x0 = ox - Math.ceil(ox / s) * s, y0 = oy - Math.ceil(oy / s) * s;
  for (let x = x0; x <= W + 0.5; x += s) if (x >= 0) d += `M${x.toFixed(2)} 0V${H}`;
  for (let y = y0; y <= H + 0.5; y += s) if (y >= 0) d += `M0 ${y.toFixed(2)}H${W}`;
  L.grid.innerHTML = `<path d="${d}" class="grid-lines"/>`;
  L.grid.dataset.cols = cols; L.grid.dataset.rows = rows;
}

export function renderTerrain(L, scene, { showBlocked = false } = {}) {
  const s = gridSize(scene.grid), ox = scene.grid.offsetX || 0, oy = scene.grid.offsetY || 0;
  const rect = (k, fill) => { const { c, r } = unkey(k); return `<rect x="${ox + c * s}" y="${oy + r * s}" width="${s}" height="${s}" fill="url(#${fill})"/>`; };
  const t = scene.terrain || { difficult: [], blocked: [] };
  let out = (t.difficult || []).map((k) => rect(k, 'hatch')).join('');
  if (showBlocked) out += (t.blocked || []).map((k) => rect(k, 'hatch-red')).join('');
  L.terrain.querySelector('g.t').innerHTML = out;
}

export function renderDrawings(L, scene, ctx = null) {
  // Рисунки — объекты (TASK-031): свои (мастеру — все) можно выделить и тянуть в «Перемещении» и «Выделении».
  const mv = ctx?.ui.drawMove;
  const live = ctx && ['move', 'select', 'text'].includes(ctx.ui.tool) && !ctx.viewport.dataset.focus;
  const selId = ctx?.ui.selDrawing;
  const group = ctx?.ui.selDrawings; // выделенные рамкой вместе с токенами (TASK-169)
  L.drawings.innerHTML = (scene.drawings || []).map((d0) => {
    const d = ctx ? liveDrawing(ctx, d0) : d0;
    const ed = live && canEditDrawing(ctx, d);
    const attr = ed ? ` data-drawing="${d.id}"` : '';
    const cls = `${ed ? ' ed' : ''}${selId === d.id || group?.has(d.id) ? ' sel' : ''}`;
    if (d.type === 'text') return `<text x="${d.x}" y="${d.y}" class="draw-text${cls}" fill="${esc(d.color)}" style="font-size:${d.size || 28}px" data-did="${d.id}"${attr}>${esc(d.text)}</text>`;
    if (d.type === 'shape') return shapeMarkup(scene.grid, d, cls, ` data-did="${d.id}"`) + (ed ? shapeMarkup(scene.grid, d, ' draw-hit', attr) : '');
    const pts = (d.pts || []).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    return `<polyline points="${pts}" class="draw-line${cls}" stroke="${esc(d.color)}" data-did="${d.id}"/>${ed ? `<polyline points="${pts}" class="draw-hit"${attr}/>` : ''}`;
  }).join('');
  let bbox = null;
  const selNode = selId && L.drawings.querySelector(`[data-did="${CSS.escape(selId)}"]`);
  if (selNode) {
    const b = selNode.getBBox(), pad = 8 * (1 / (ctx.camera?.z || 1));
    bbox = { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
    L.drawings.insertAdjacentHTML('beforeend', `<rect class="draw-sel" x="${bbox.x}" y="${bbox.y}" width="${bbox.width}" height="${bbox.height}" rx="${pad}"/>`);
  }
  if (group?.size) {
    const pad = 8 * (1 / (ctx.camera?.z || 1));
    let out = '';
    for (const id of group) {
      const n = L.drawings.querySelector(`[data-did="${CSS.escape(id)}"]`); if (!n) continue;
      const b = n.getBBox();
      out += `<rect class="draw-sel" x="${b.x - pad}" y="${b.y - pad}" width="${b.width + pad * 2}" height="${b.height + pad * 2}" rx="${pad}"/>`;
    }
    L.drawings.insertAdjacentHTML('beforeend', out);
  }
  if (ctx) renderDrawBar(L, ctx, bbox);
}

/** Стены: мастеру — в режиме редактирования стен; остальным — ничего (двери идут маркерами). */
export function renderWalls(L, scene, { edit, selectedWall, hoverWall }) {
  if (!edit) { L.walls.innerHTML = ''; return; }
  const out = [];
  for (const w of scene.walls) {
    const cls = `wall k-${w.kind} ${w.open ? 'open' : ''} ${selectedWall === w.id ? 'sel' : ''} ${hoverWall === w.id ? 'hover' : ''}`;
    out.push(`<line class="${cls}" data-wall="${w.id}" x1="${w.a.x}" y1="${w.a.y}" x2="${w.b.x}" y2="${w.b.y}"/>`);
  }
  const pts = new Map();
  for (const w of scene.walls) for (const p of [w.a, w.b]) pts.set(`${p.x},${p.y}`, p);
  for (const p of pts.values()) out.push(`<circle class="wall-handle" cx="${p.x}" cy="${p.y}" data-handle="${p.x},${p.y}"/>`);
  L.walls.innerHTML = out.join('');
}

/** Маркеры постоянного экранного размера: двери, свет, метки, переходы, ловушки. */
export function renderMarkers(L, ctx) {
  const { scene, isMasterView } = ctx;
  const tool = ctx.ui.tool;
  const out = [];
  const visible = (p) => isMasterView || ctx.pointKnown(p);
  for (const w of scene.walls) {
    const door = w.kind === 'door' || w.kind === 'secret';
    if (!door) continue;
    if (w.kind === 'secret' && !w.discovered && !isMasterView) continue;
    const mid = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
    if (!visible(mid)) continue;
    const ic = w.open ? 'door-02' : w.locked ? 'door-lock' : w.kind === 'secret' ? 'mask' : 'door-01';
    out.push(`<button class="marker door ${w.open ? 'open' : ''} ${w.locked ? 'locked' : ''} ${w.kind === 'secret' ? 'secret' : ''}" data-door="${w.id}" style="left:${mid.x}px;top:${mid.y}px" aria-label="Дверь">${icon(ic, 16)}</button>`);
  }
  if (isMasterView && (tool === 'lights' || ctx.ui.showLightIcons)) {
    for (const l of scene.lights) out.push(`<button class="marker light ${ctx.ui.selectedLight === l.id ? 'sel' : ''}" data-light="${l.id}" style="left:${l.x}px;top:${l.y}px" aria-label="Свет">${icon(l.preset === 'campfire' ? 'campfire' : l.preset === 'lantern' || l.preset === 'candle' ? 'bulb' : l.preset === 'light' ? 'sun-03' : 'fire', 16)}</button>`);
  }
  for (const p of scene.pins || []) {
    // Заметка «Только мастеру» игрокам не видна никогда, даже если раньше её показывали (TASK-027).
    const shown = p.shown && p.kind !== 'secret';
    if (!isMasterView && !shown) continue;
    if (!visible(p)) continue;
    out.push(`<button class="marker pin k-${p.kind} ${shown ? 'shown' : ''}" data-pin="${p.id}" style="left:${p.x}px;top:${p.y}px">${icon(p.kind === 'secret' ? 'view-off' : 'scroll', 16)}<span class="marker-label">${esc(p.title)}</span></button>`);
  }
  for (const g of scene.portals || []) {
    if (!visible(g)) continue;
    out.push(`<button class="marker portal" data-portal="${g.id}" style="left:${g.x}px;top:${g.y}px">${icon('stairs-01', 16)}<span class="marker-label">↓ ${esc(g.label || g.name)}</span></button>`);
  }
  if (isMasterView) {
    for (const tr of scene.traps || []) {
      const s = gridSize(scene.grid);
      for (const k of tr.cells) {
        const { c, r } = unkey(k);
        const x = (scene.grid.offsetX || 0) + (c + 0.5) * s, y = (scene.grid.offsetY || 0) + (r + 0.5) * s;
        out.push(`<button class="marker trap ${tr.triggered ? 'triggered' : ''}" data-trap="${tr.id}" style="left:${x}px;top:${y}px">${icon('danger', 16)}</button>`);
      }
    }
  } else {
    for (const tr of scene.traps || []) if (tr.triggered) for (const k of tr.cells) {
      const s = gridSize(scene.grid); const { c, r } = unkey(k);
      const x = (scene.grid.offsetX || 0) + (c + 0.5) * s, y = (scene.grid.offsetY || 0) + (r + 0.5) * s;
      if (visible({ x, y })) out.push(`<span class="marker trap triggered" style="left:${x}px;top:${y}px">${icon('danger', 16)}</span>`);
    }
  }
  L.markers.innerHTML = out.join('');
}

/** Области: радиусы света, шаблоны, клетки ловушки — над токенами; досягаемость и угроза — под ними (слой ground). */
export function renderAreas(L, ctx) {
  const { scene } = ctx;
  const s = gridSize(scene.grid), ox = scene.grid.offsetX || 0, oy = scene.grid.offsetY || 0;
  const out = [], ground = [];
  // Досягаемость движения — под токенами (слой ground)
  if (ctx.ui.reach?.size) {
    for (const [k] of ctx.ui.reach) { const { c, r } = unkey(k); ground.push(`<rect class="cell reach" x="${ox + c * s}" y="${oy + r * s}" width="${s}" height="${s}"/>`); }
  }
  // Радиусы света в режиме «Свет»
  if (ctx.isMasterView && ctx.ui.tool === 'lights') {
    for (const l of scene.lights) {
      const b = ftToPx(scene, l.bright), d = ftToPx(scene, l.bright + l.dim);
      const sel = ctx.ui.selectedLight === l.id ? 'sel' : '';
      out.push(`<circle class="light-radius dim ${sel}" cx="${l.x}" cy="${l.y}" r="${d}"/><circle class="light-radius bright ${sel}" cx="${l.x}" cy="${l.y}" r="${b}"/>`);
    }
  }
  // Шаблоны (свои и присланные)
  for (const tpl of ctx.templates()) {
    const poly = templatePolygon(scene.grid, tpl);
    const { cols, rows } = gridDims(scene.grid, scene.map.width, scene.map.height);
    for (const cell of templateCells(scene.grid, tpl, cols, rows)) out.push(`<rect class="cell template" x="${ox + cell.c * s}" y="${oy + cell.r * s}" width="${s}" height="${s}"/>`);
    out.push(`<polygon class="template-shape" points="${poly.map((p) => `${p.x},${p.y}`).join(' ')}"/>`);
    out.push(`<circle class="template-origin" cx="${tpl.origin.x}" cy="${tpl.origin.y}" r="${s * 0.12}"/>`);
  }
  // Угроза (атака по возможности)
  for (const k of ctx.ui.threat || []) { const { c, r } = unkey(k); ground.push(`<rect class="cell threat" x="${ox + c * s}" y="${oy + r * s}" width="${s}" height="${s}"/>`); }
  // Выделенные клетки ловушки
  if (ctx.ui.trapCells?.length) for (const k of ctx.ui.trapCells) { const { c, r } = unkey(k); out.push(`<rect class="cell template" x="${ox + c * s}" y="${oy + r * s}" width="${s}" height="${s}"/>`); }
  L.areas.innerHTML = out.join('');
  L.ground.innerHTML = ground.join('');
}

/** Ауры — отдельным слоем под всеми токенами, со своим цветом и прозрачностью. */
export function renderAuras(L, ctx) {
  const { scene } = ctx;
  const s = gridSize(scene.grid);
  const out = [], labels = [];
  for (const t of scene.tokens) {
    if (!t.aura || !ctx.tokenShown(t)) continue;
    const p = ctx.posOf(t);
    const n = sizeById(t.size).cells;
    const rad = ftToPx(scene, t.aura.radius) + (n * s) / 2;
    const hex = auraHex(t.aura), a = auraAlpha(t.aura);
    out.push(`<circle class="aura" cx="${p.x}" cy="${p.y}" r="${rad}" style="--ac:${hex};--aa:${a};--as:${Math.min(1, a + 0.45)}"/>`);
    labels.push(`<button class="aura-label" data-aura="${esc(t.id)}" style="left:${p.x}px;top:${p.y - rad}px;--ac:${hex}">${esc(t.aura.name)} · ${t.aura.radius} фт</button>`);
  }
  L.auras.innerHTML = out.join('');
  L.auraLabels.innerHTML = labels.join('');
}

// ——— Токены ———
function tokenMarkup(ctx, t, st, n, d, name = st.name) {
  const conds = (st.conditions || []).slice(0, 3).map((id) => { const c = conditionById(id); return c ? `<span class="tok-cond" title="${esc(c.name)}">${icon(c.icon, 12)}</span>` : ''; }).join('');
  const more = (st.conditions || []).length > 3 ? `<span class="tok-cond more">+${st.conditions.length - 3}</span>` : '';
  const src = srcOf(t.img);
  const face = src ? `<img alt="" draggable="false" src="${esc(src)}">` : `<span class="tok-initials" style="--h:${hueOf(name)}">${esc(initials(name))}</span>`;
  return `<div class="tok-ring">${face}</div>
    <svg class="tok-hp" viewBox="0 0 100 100"><circle cx="50" cy="50" r="47.5" class="hp-track"/><circle cx="50" cy="50" r="47.5" class="hp-arc"/></svg>
    <span class="tok-badge hp-b"></span>
    <span class="tok-badge ac-b"></span>
    <span class="tok-badge hidden-b">${icon('view-off', 12)}</span>
    <span class="tok-badge down-b">${icon(t.kind === 'foe' ? 'skull' : 'sleeping', 12)}</span>
    <span class="tok-conds">${conds}${more}</span>
    ${t.elevation ? `<span class="tok-badge elev" title="Высота ${t.elevation} фт">${t.elevation > 0 ? '↑' : '↓'}${Math.abs(t.elevation)}</span>` : ''}
    <span class="tok-name">${esc(name)}</span>`;
}

/**
 * Порядок наложения токенов: кого двигали последним — выше; кого не двигали — по порядку на сцене.
 * Возвращает Map<id, z> (1…N).
 */
export function stackOrder(tokens) {
  const order = tokens.map((t, i) => ({ id: t.id, at: Number(t.movedAt) || 0, i })).sort((a, b) => a.at - b.at || a.i - b.i);
  return new Map(order.map((o, k) => [o.id, k + 1]));
}

export function renderTokens(L, ctx) {
  const { scene, c } = ctx;
  const s = gridSize(scene.grid);
  const seen = new Set();
  const layer = stackOrder(scene.tokens);
  const top = scene.tokens.length + 10;
  const currentId = ctx.currentTurnTokenId();
  for (const t of scene.tokens) {
    if (!ctx.tokenShown(t)) continue;
    seen.add(t.id);
    const st = tokenStats(c, t);
    const size = sizeById(t.size);
    const n = size.cells;
    const look = tokenLook(ctx, t); // поворот и свободный масштаб (TASK-030)
    const d = n * s * 0.9 * (size.scale || 1) * look.scale;
    let node = L.tokens.querySelector(`[data-token="${CSS.escape(t.id)}"]`);
    const name = ctx.nameOf(t, st);
    const sig = `${t.img}|${name}|${(st.conditions || []).join(',')}|${t.elevation || 0}`;
    if (!node) {
      node = el(`<div class="tok" data-token="${esc(t.id)}"></div>`);
      L.tokens.append(node);
    }
    if (node.dataset.sig !== sig) { node.innerHTML = tokenMarkup(ctx, t, st, n, d, name); node.dataset.sig = sig; node.dataset.tg = ''; node.dataset.by = ''; }
    const p = ctx.posOf(t);
    node.style.width = `${d}px`; node.style.height = `${d}px`;
    // Поверх всех — тот, кого тянут сейчас (свой или чужой), затем — кого двигали последним.
    node.style.setProperty('--rot', `${look.rot}deg`);
    node.style.zIndex = ctx.dragging?.has(t.id) || ctx.remote.drags.has(t.id) ? top : layer.get(t.id);
    node.style.transform = `translate(${p.x - d / 2}px, ${p.y - d / 2}px)`;
    node.style.setProperty('--fs', `${Math.max(7, s * 0.15)}px`);
    node.style.setProperty('--bw', `${Math.max(2, s * 0.045)}px`);
    const down = st.hpMax > 0 && st.hp <= 0;
    const mine = ctx.isMine(t);
    node.className = `tok ${t.kind} disp-${ctx.dispositionOf(t)} ${ctx.ui.selection.has(t.id) ? 'selected' : ''} ${currentId === t.id ? 'turn' : ''} ${t.hidden ? 'is-hidden' : ''} ${down ? 'downed' : ''} ${mine ? 'mine' : ''} ${ctx.dragging?.has(t.id) ? 'dragging' : ''} ${ctx.canControl(t) && !t.locked ? 'can' : ''} ${t.locked ? 'locked' : ''} ${ctx.isDim?.(t) ? 'dim' : ''}`;
    // Прицелы: кто отметил этот токен целью.
    const tg = ctx.targetersOf?.(t.id) || [];
    const tgSig = tg.map((u) => u.id).join(',');
    if (node.dataset.tg !== tgSig) {
      node.querySelector('.tok-tg')?.remove();
      if (tg.length) node.insertAdjacentHTML('beforeend', `<span class="tok-tg" title="Цель: ${esc(tg.map((u) => u.name).join(', '))}">${tg.map((u) => `<i style="--pc:hsl(${u.hue ?? 32} 80% 62%)">${icon('target-02', 12)}</i>`).join('')}</span>`);
      node.dataset.tg = tgSig;
    }
    // Кто тащит (TASK-162) или выделил (TASK-164) токен: кольцо цвета участника и плашка с именем.
    // Перетаскивание ярче и важнее выделения; свои действия не помечаем.
    const rd = ctx.remote.drags.get(t.id);
    const byId = rd && rd.sceneId === ctx.sceneId && rd.by && rd.by !== ctx.userId ? rd.by : '';
    const sels = byId ? [] : ctx.selectorsOf?.(t.id) || [];
    const colorOf = (id, u) => (isMasterOf(c, id) ? '#e9b052' : `hsl(${u?.hue ?? 32} 80% 62%)`);
    const bySig = byId ? `d|${byId}|${rd.lead ? 1 : 0}` : sels.length ? `s|${sels.map((u) => u.id).join(',')}` : '';
    if (node.dataset.by !== bySig) {
      node.querySelector('.tok-by')?.remove();
      if (byId) {
        const u = userById(byId);
        node.style.setProperty('--dc', colorOf(byId, u));
        if (rd.lead) node.insertAdjacentHTML('beforeend', `<span class="tok-by">${icon('cursor-hold-01', 12)}${esc(u?.name || 'Кто-то')}</span>`);
      } else if (sels.length) {
        node.style.setProperty('--dc', colorOf(sels[0].id, sels[0]));
        const names = sels.slice(0, 2).map((u) => esc(u.name)).join(', ') + (sels.length > 2 ? ` +${sels.length - 2}` : '');
        node.insertAdjacentHTML('beforeend', `<span class="tok-by sel" title="Выделили: ${esc(sels.map((u) => u.name).join(', '))}">${icon('cursor-01', 12)}${names}</span>`);
      } else node.style.removeProperty('--dc');
      node.dataset.by = bySig;
    }
    if (byId) node.classList.add('remote-drag'); else if (sels.length) node.classList.add('remote-sel');
    // Кольцо хитов: всем — у героев; у врагов — только мастеру (игроку — по настройке).
    const showHp = st.hpMax > 0 && (ctx.isMasterView || t.kind === 'hero' || ctx.c.settings.playersSeeHp === 'exact');
    // Бейджи (TASK-029): слева красным — хиты и временные хиты, справа синим — КД. Порядок инициативы на токене не показываем.
    const hb = node.querySelector('.tok-badge.hp-b'), ab = node.querySelector('.tok-badge.ac-b');
    const tmp = st.tempHp > 0 ? `<i>+${st.tempHp}</i>` : '';
    const hpHtml = showHp ? `${Math.max(0, st.hp)}${tmp}` : '';
    if (hb.dataset.v !== hpHtml) { hb.innerHTML = hpHtml; hb.dataset.v = hpHtml; hb.title = st.tempHp > 0 ? `Хиты ${st.hp} из ${st.hpMax}, временные ${st.tempHp}` : `Хиты ${st.hp} из ${st.hpMax}`; }
    hb.style.display = showHp ? '' : 'none';
    const showAc = st.ac != null && (ctx.isMasterView || t.kind === 'hero');
    const acTxt = showAc ? String(st.ac) : '';
    if (ab.textContent !== acTxt) { ab.textContent = acTxt; ab.title = `Класс доспеха ${st.ac}`; }
    ab.style.display = showAc ? '' : 'none';
    const arc = node.querySelector('.hp-arc');
    const frac = Math.max(0, Math.min(1, st.hp / Math.max(1, st.hpMax)));
    if (showHp && frac < 1) { arc.style.strokeDasharray = `${frac * 298.5} 400`; node.querySelector('.tok-hp').style.display = ''; } else node.querySelector('.tok-hp').style.display = 'none';
    node.title = `${name}${t.elevation ? ` · высота ${t.elevation} фт` : ''}${showHp ? ` · ${st.hp}/${st.hpMax}` : st.hpMax ? ` · ${woundLabel(st.hp, st.hpMax)}` : ''}`;
  }
  for (const node of [...L.tokens.children]) if (!seen.has(node.dataset.token)) node.remove();
  renderGizmo(L, ctx);
}

export function renderFog(L, ctx) {
  const view = ctx.fogView();
  const vis = ctx.vision();
  // Пока токен тащат (сам или кто-то другой) — туман грубее и быстрее, чтобы успевать каждый кадр.
  let moving = !!ctx.dragging?.size;
  for (const d of ctx.remote.drags.values()) if (d.sceneId === ctx.sceneId) moving = true;
  drawFog(L.fog, ctx.scene, vis, ctx.exploredSet(), view, { strong: ctx.ui.tool === 'fog', hi: !moving && !ctx.ui.liveFogOp });
  if (view === 'player' || (ctx.isMasterView && ctx.scene.lighting === 'dark')) drawLightGlow(L.glow, ctx.scene, vis);
  else drawLightGlow(L.glow, ctx.scene, { dark: false });
}

/** Оверлей поверх тумана: линейки, путь перемещения, рамка выделения, пинги. */
export function renderOverlay(L, ctx) {
  const { scene } = ctx;
  const s = gridSize(scene.grid);
  const out = [];
  const labels = [];
  const lbl = (x, y, text, cls = '') => labels.push(`<span class="map-label ${cls}" style="left:${x}px;top:${y}px">${esc(text)}</span>`);
  for (const r of ctx.rulers()) {
    const pts = r.pts;
    out.push(`<polyline class="ruler ${r.remote ? 'remote' : ''}" points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}" style="--rc:${r.color || 'var(--brand-500)'}"/>`);
    for (const p of pts) out.push(`<circle class="ruler-dot" cx="${p.x}" cy="${p.y}" r="${s * 0.09}" style="--rc:${r.color || 'var(--brand-500)'}"/>`);
    const last = pts.at(-1);
    lbl(last.x, last.y - s * 0.55, r.label, r.remote ? 'remote' : '');
  }
  for (const m of ctx.movePaths()) {
    if (m.quiet) continue; // вне боя прямой путь не рисуем — токен и так идёт за курсором
    const pts = m.pts;
    out.push(`<polyline class="move-path ${m.over ? 'over' : ''} ${m.blocked ? 'blocked' : ''}" points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}"/>`);
    for (const p of pts.slice(1, -1)) out.push(`<circle class="move-dot ${m.over ? 'over' : ''}" cx="${p.x}" cy="${p.y}" r="${s * 0.07}"/>`);
    const last = pts.at(-1);
    if (m.label) lbl(last.x, last.y - s * 0.62, m.label, m.over ? 'over' : '');
  }
  const mq = ctx.ui.marquee;
  if (mq) out.push(`<rect class="marquee" x="${Math.min(mq.x0, mq.x1)}" y="${Math.min(mq.y0, mq.y1)}" width="${Math.abs(mq.x1 - mq.x0)}" height="${Math.abs(mq.y1 - mq.y0)}"/>`);
  const ghost = ctx.ui.wallGhost;
  if (ghost) out.push(`<line class="wall-ghost k-${ghost.kind}" x1="${ghost.a.x}" y1="${ghost.a.y}" x2="${ghost.b.x}" y2="${ghost.b.y}"/><circle class="wall-handle ghost" cx="${ghost.b.x}" cy="${ghost.b.y}"/>`);
  const brush = ctx.ui.brush;
  if (brush) out.push(`<circle class="brush ${brush.mode}" cx="${brush.x}" cy="${brush.y}" r="${brush.r}"/>`);
  if (ctx.ui.liveShape) out.push(shapeMarkup(scene.grid, ctx.ui.liveShape, ' live'));
  // Размер и угол шаблона линейки, пока его тянут (TASK-178).
  const tl = ctx.ui.templateLabel;
  if (tl) lbl(tl.at.x, tl.at.y - s * 0.45, tl.text, 'accent');
  if (ctx.ui.liveStroke) out.push(`<polyline class="draw-line live" stroke="${esc(ctx.ui.liveStroke.color)}" points="${ctx.ui.liveStroke.pts.map((p) => `${p.x},${p.y}`).join(' ')}"/>`);
  if (ctx.ui.calib) {
    const k = ctx.ui.calib;
    out.push(`<rect class="calib" x="${k.x}" y="${k.y}" width="${k.size}" height="${k.size}"/>`);
    for (const [hx, hy] of [[k.x, k.y], [k.x + k.size, k.y], [k.x, k.y + k.size], [k.x + k.size, k.y + k.size]]) out.push(`<circle class="calib-handle" cx="${hx}" cy="${hy}" data-calib="1"/>`);
    lbl(k.x + k.size / 2, k.y - 14, `1 клетка = ${Math.round(k.size)} px = ${scene.grid.feet || 5} фт`, 'accent');
  }
  L.overlay.innerHTML = out.join('');
  L.labels.innerHTML = labels.join('');
}

/** Пинг: волна в точке мира. */
export function pingAt(L, x, y, color = 'var(--ping-player)', name = '', big = false) {
  const node = el(`<div class="ping ${big ? 'big' : ''}" style="left:${x}px;top:${y}px;--pc:${color}"><i></i><i></i><i></i>${name ? `<span class="ping-name">${esc(name)}</span>` : ''}</div>`);
  L.labels.after(node);
  setTimeout(() => node.remove(), big ? 3200 : 2300);
  return node;
}

export { LIGHT_COLORS, key };
