// Панели по краям стола (как в макетах): слева сверху — логотип, виджеты, кубы, пауза;
// справа — сцены и отряд; снизу — инструменты или токен-бар; справа снизу — масштаб.
import { esc } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { onlineUsers } from '../../core/store.js';
import { srcOf } from '../../core/assets.js';
import { characterOf, ownerOfCharacter, myCharacter, sceneOf, membership } from '../../core/campaign.js';
import { TEMPLATES, LIGHTS } from '../../data/rules.js';
import { currentEntry } from './combat.js';
import { movementLeft } from './input.js';

const ib = (act, name, tip, { active = false, kbd = '', extra = '', disabled = false, count = 0 } = {}) =>
  `<button class="icon-btn ${active ? 'active' : ''}" data-act="${act}" ${extra} ${disabled ? 'disabled' : ''} data-tip="${esc(tip)}" ${kbd ? `data-kbd="${esc(kbd)}"` : ''} aria-label="${esc(tip)}" aria-pressed="${active}">${icon(name, 22)}${count ? `<span class="count">${count}</span>` : ''}</button>`;
const div = '<span class="divider"></span>';

function cache(node, html) {
  if (!node || node.__html === html) return;
  // Пока человек печатает в поле панели (например, хиты), не перерисовываем её под ним.
  const a = document.activeElement;
  if (a && node.contains(a) && a.matches('input:not([type="range"]):not([type="checkbox"]), textarea')) return;
  node.innerHTML = html; node.__html = html;
}

export function renderChrome(ctx) {
  const root = ctx.root.querySelector('.chrome');
  if (!root.__built) {
    root.innerHTML = `<div class="ch-tl"></div><div class="ch-tc"></div><div class="ch-tr"></div><div class="ch-widget"></div><div class="ch-bl"></div><div class="ch-bc"></div><div class="ch-br"></div>`;
    root.__built = true;
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      ctx.panels.action(b.dataset.act, b, e);
    });
    root.addEventListener('input', (e) => {
      const r = e.target.closest('[data-range]');
      if (r) { ctx.panels.range(r.dataset.range, Number(r.value), r); r.style.setProperty('--fill', `${((r.value - r.min) / (r.max - r.min)) * 100}%`); }
    });
    root.addEventListener('change', (e) => { const s = e.target.closest('[data-select]'); if (s) ctx.panels.selectChange(s.dataset.select, s.value); });
    // Хиты прямо в токен-баре: Enter — записать, Esc — вернуть как было.
    root.addEventListener('focusin', (e) => { const h = e.target.closest('[data-hp-input]'); if (h) { h.dataset.was = h.value; h.select(); h.dataset.fresh = '1'; } });
    // Первый mouseup после фокуса не сбрасывает выделение — можно сразу печатать новое число.
    root.addEventListener('mouseup', (e) => { const h = e.target.closest('[data-hp-input]'); if (h?.dataset.fresh) { e.preventDefault(); delete h.dataset.fresh; } });
    root.addEventListener('keydown', (e) => {
      const h = e.target.closest('[data-hp-input]'); if (!h) return;
      if (e.key === 'Enter') { e.preventDefault(); h.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); h.value = h.dataset.was ?? h.value; h.dataset.cancel = '1'; h.blur(); }
      e.stopPropagation();
    });
    root.addEventListener('focusout', (e) => {
      const h = e.target.closest('[data-hp-input]'); if (!h) return;
      const cancel = h.dataset.cancel; delete h.dataset.cancel;
      if (!cancel && h.value.trim() !== (h.dataset.was ?? '').trim()) {
        if (!ctx.panels.commitHp(h.dataset.hpInput, h.value)) { h.value = h.dataset.was ?? h.value; ctx.toast({ title: 'Не понял число', body: 'Впишите, сколько осталось (12), или урон −5 / лечение +3', icon: 'alert-circle' }); }
      }
      root.querySelector('.ch-bc').__html = ''; // перерисовать с новыми хитами
      requestAnimationFrame(() => renderChrome(ctx));
    });
  }
  const c = ctx.c;
  if (!c) return;
  cache(root.querySelector('.ch-tl'), topLeft(ctx));
  cache(root.querySelector('.ch-tc'), topCenter(ctx));
  cache(root.querySelector('.ch-tr'), topRight(ctx));
  cache(root.querySelector('.ch-bl'), `<div class="toolbar">${ib('help', 'bubble-chat-question', 'Справка и горячие клавиши', { kbd: '?' })}</div>`);
  cache(root.querySelector('.ch-bc'), ctx.scene ? bottomCenter(ctx) : '');
  cache(root.querySelector('.ch-br'), ctx.scene ? bottomRight(ctx) : '');
  root.dataset.role = ctx.isMaster ? 'master' : 'player';
}

function topLeft(ctx) {
  const w = ctx.ui.widget;
  const c = ctx.c;
  return `<button class="logo-btn chrome-logo" data-act="logo" data-tip="${esc(c.name)}" aria-label="Меню кампании"><img src="assets/logo.webp" alt=""></button>
    <div class="toolbar">${ib('w-vision', 'view', 'Зрение', { active: w === 'vision' })}${ib('w-party', 'user-group', 'Отряд', { active: w === 'party' })}${ib('w-initiative', 'sword-03', 'Инициатива', { active: w === 'initiative' || (c.combat.active && w !== 'initiative' && false) })}</div>
    <div class="toolbar">${ib('w-dice', 'dice-faces-06', 'Кубы', { active: w === 'dice' })}</div>
    ${ctx.isMaster ? `<div class="toolbar">${ib('pause', c.paused ? 'play' : 'pause', c.paused ? 'Снять паузу' : 'Пауза', { active: !!c.paused })}</div>` : ''}
    ${c.combat.active ? `<span class="chip chip-accent combat-chip">${icon('sword-03', 12)}Бой · раунд ${c.combat.round}</span>` : ''}`;
}

function banner(ic, title, sub, action = '', cls = '') {
  return `<div class="banner ${cls}">${icon(ic, 20)}<div class="titles"><div class="title">${esc(title)}</div>${sub ? `<div class="subtitle">${esc(sub)}</div>` : ''}</div>${action}</div>`;
}

function topCenter(ctx) {
  const c = ctx.c, sc = ctx.scene;
  if (!sc) return '';
  const tool = ctx.ui.tool;
  if (ctx.ui.viewAs) {
    const ch = characterOf(c, ctx.ui.viewAs);
    const owner = ownerOfCharacter(c, ch);
    return banner('view', `Вы смотрите глазами ${ch?.name || 'героя'}`, `Так стол видит ${owner?.name || 'игрок'} — туман, свет и скрытые токены как у игрока`, `<button class="btn btn-sm btn-primary" data-act="exit-viewas">${icon('cancel-01', 14)}Выйти</button>`);
  }
  if (ctx.ui.previewPlayers) return banner('view', 'Как видят игроки', 'Слой мастера и скрытые токены спрятаны', `<button class="btn btn-sm btn-primary" data-act="exit-preview">${icon('cancel-01', 14)}Выйти</button>`);
  if (ctx.isMaster) {
    if (c.paused) return banner('pause', 'Стол на паузе', c.paused.silent ? 'Игроки видят карту, но ходить не могут' : 'У игроков экран паузы — можно незаметно переставить токены', `<button class="btn btn-sm btn-primary" data-act="pause">${icon('play', 14)}Продолжить</button>`);
    const modes = {
      walls: ['path', 'Стены и двери', 'Ставьте точки где угодно — концы прилипают друг к другу, Shift — по сетке. Enter или двойной клик — закончить'],
      lights: ['fire', 'Свет', sc.lighting === 'dark' ? 'Где темно — герои без тёмного зрения ничего не увидят' : 'Сцена освещена — включите темноту, чтобы свет имел значение'],
      fog: ['cloud', 'Туман войны', sc.fog.mode === 'vision' ? 'Затемнённое игроки не видят. Обзор героев открывает туман сам' : sc.fog.mode === 'manual' ? 'Игроки видят только открытое кистью' : 'Туман выключен — игроки видят всю карту'],
      terrain: ['mountain', 'Труднопроходимая местность', 'Каждый шаг по штриховке стоит вдвое. Красное — непроходимо'],
      gm: ['layers-01', 'Слой мастера', 'Ловушки, метки и переходы. Игроки этого слоя не видят'],
      grid: ['grid', `Сетка · ${sc.name}`, 'Подгоните одну клетку под плитку на карте — остальные выровняются сами'],
    };
    if (modes[tool]) return banner(...modes[tool]);
    if (c.activeSceneId !== sc.id) {
      const act = sceneOf(c, c.activeSceneId);
      return banner('maps', `Игроки ${act ? `в «${act.name}»` : 'ещё не видят ни одной сцены'}`, 'Вы готовите эту сцену — игрокам её не видно', `<button class="btn btn-sm btn-primary" data-act="scene-activate" data-id="${esc(sc.id)}">${icon('view', 14)}Показать игрокам</button>`);
    }
    return '';
  }
  // Игрок
  if (c.paused) return banner('pause', 'Пауза', 'Мастер остановил игру — ходить пока нельзя');
  if (ctx.ui.lookLock) return banner('location-01', 'Мастер показывает', 'Камера переехала сюда — вернуть по кнопке', `<button class="btn btn-sm btn-secondary" data-act="look-back">${icon('arrow-right-02', 14)}К ${esc(myCharacter(c, ctx.userId)?.name || 'герою')}</button>`);
  const cur = currentEntry(c, sc);
  const mine = cur && ctx.scene.tokens.find((t) => t.id === cur.tokenId && ctx.isMine(t));
  if (mine) {
    const left = movementLeft(ctx, mine);
    return banner('sword-03', `Ваш ход, ${cur.name}`, `Раунд ${c.combat.round} · ${left} фт движения, действие и бонусное действие`, `<button class="btn btn-sm" data-act="end-turn">${icon('tick-02', 14)}Закончить ход</button>`, 'turn');
  }
  const m = membership(c, ctx.userId);
  if (m?.sceneId && m.sceneId !== c.activeSceneId) {
    const main = sceneOf(c, c.activeSceneId);
    const others = c.members.filter((x) => x.role === 'player' && x.status === 'active' && x.userId !== ctx.userId && (x.sceneId || c.activeSceneId) !== m.sceneId).map((x) => characterOf(c, x.characterId)?.name).filter(Boolean);
    return banner('stairs-01', `Вы в «${sc.name}»`, others.length ? `${others.join(', ')} остались в «${main?.name || 'другой сцене'}»` : 'Отряд разделился');
  }
  return '';
}

function topRight(ctx) {
  const c = ctx.c;
  const online = onlineUsers(ctx.cid);
  const party = c.characters.filter((ch) => c.members.some((m) => m.characterId === ch.id && m.status === 'active') || ctx.scene?.tokens.some((t) => t.characterId === ch.id));
  const avatarBtn = (ch, cls = '') => {
    const owner = ownerOfCharacter(c, ch);
    const on = owner ? online.has(owner.id) : false;
    return `<button class="sheet-avatar ${cls}" data-act="sheet" data-id="${esc(ch.id)}" data-tip="${esc(ch.name)}${owner ? ` · ${esc(owner.name)}${on ? '' : ' · не в сети'}` : ' · без игрока'}"><img src="${esc(srcOf(ch.portrait))}" alt="">${owner ? `<span class="status ${on ? 'online' : ''}"></span>` : ''}</button>`;
  };
  if (ctx.isMaster) {
    const sc = ctx.scene;
    const pending = c.members.filter((m) => m.status === 'pending').length;
    return `<div class="tr-row"><button class="toolbar scene-pill ${ctx.ui.panel === 'scenes' ? 'active' : ''}" data-act="scenes" data-tip="Сцены"><span class="icon-btn icon-btn-sm ${ctx.ui.panel === 'scenes' ? 'active' : ''}">${icon('maps', 20)}</span><span class="scene-pill-text"><small>Сцена</small><b>${esc(sc?.name || 'нет сцен')}</b></span></button></div>
      ${party.length ? `<div class="toolbar toolbar-v party-col">${party.map((ch) => avatarBtn(ch)).join('')}</div>` : ''}
      <div class="toolbar">${ib('invite', 'user-add-01', pending ? `Заявки: ${pending}` : 'Пригласить игроков', { count: pending })}</div>`;
  }
  const me = myCharacter(c, ctx.userId);
  const others = party.filter((ch) => ch.id !== me?.id);
  return `${me ? `<div class="toolbar my-sheet">${avatarBtn(me, 'mine')}</div>` : ''}
    ${others.length ? `<div class="toolbar toolbar-v party-col">${others.map((ch) => avatarBtn(ch)).join('')}</div>` : ''}`;
}

function bottomRight(ctx) {
  const g = ctx.scene.grid;
  return `<div class="toolbar zoom-bar">${ib('zoom-out', 'minus-sign', 'Отдалить', { kbd: '−' })}<button class="tb-text zoom-value" data-act="fit" data-tip="Показать всю сцену" data-kbd="0" data-zoom-value>${Math.round(ctx.camera.z * 100)}%</button>${ib('zoom-in', 'plus-sign', 'Приблизить', { kbd: '+' })}${div}<span class="tb-text">клетка ${g.feet || 5} фт</span></div>`;
}

function bottomCenter(ctx) {
  const tool = ctx.ui.tool;
  const sub = ctx.ui.sub;
  if (ctx.isMasterView) {
    if (tool === 'walls') {
      const s = sub.walls || 'wall';
      return `<div class="toolbar">${ib('sub:walls:wall', 'path', 'Стена', { active: s === 'wall' })}${ib('sub:walls:window', 'grid-02', 'Окно: не пускает, но видно', { active: s === 'window' })}${ib('sub:walls:invisible', 'view-off-slash', 'Невидимая: только для движения', { active: s === 'invisible' })}${ib('sub:walls:door', 'door-01', 'Дверь', { active: s === 'door' })}${ib('sub:walls:secret', 'mask', 'Потайная дверь', { active: s === 'secret' })}${ib('tool:terrain', 'mountain', 'Местность', {})}${div}${ib('sub:walls:erase', 'eraser', 'Стереть стену', { active: s === 'erase' })}${undoRedo(ctx)}${div}<button class="btn btn-primary" data-act="done">${icon('tick-02', 18)}Готово</button></div>`;
    }
    if (tool === 'terrain') {
      const s = sub.terrain || 'difficult';
      const size = sub.terrainSize || 1;
      return `<div class="toolbar">${ib('sub:terrain:difficult', 'mountain', 'Труднопроходимая', { active: s === 'difficult' })}${ib('sub:terrain:blocked', 'stop-circle', 'Непроходимая', { active: s === 'blocked' })}${ib('sub:terrain:erase', 'eraser', 'Стереть', { active: s === 'erase' })}${div}<label class="tb-slider"><span class="tb-label">Кисть</span><input class="slider" type="range" min="1" max="5" step="2" value="${size}" data-range="terrainSize" style="--fill:${((size - 1) / 4) * 100}%"><span class="tb-label" data-out="terrainSize">${size}×${size}</span></label>${undoRedo(ctx)}${div}${ib('tool:walls', 'path', 'К стенам')}<button class="btn btn-primary" data-act="done">${icon('tick-02', 18)}Готово</button></div>`;
    }
    if (tool === 'lights') {
      const s = sub.lights || 'torch';
      const dark = ctx.scene.lighting === 'dark';
      return `<div class="toolbar">${LIGHTS.filter((l) => l.id !== 'candle').map((l) => ib(`sub:lights:${l.id}`, l.icon, `${l.name}: ${l.bright}+${l.dim} фт`, { active: s === l.id })).join('')}${div}<button class="btn btn-sm ${dark ? 'btn-primary' : 'btn-secondary'}" data-act="toggle-dark">${icon(dark ? 'moon-02' : 'sun-01', 16)}${dark ? 'Темно' : 'Светло'}</button>${div}${ib('sub:lights:erase', 'eraser', 'Убрать источник', { active: s === 'erase' })}${undoRedo(ctx)}${div}<button class="btn btn-primary" data-act="done">${icon('tick-02', 18)}Готово</button></div>`;
    }
    if (tool === 'fog') {
      const s = sub.fog || 'reveal';
      const size = sub.fogSize || 2;
      const mode = ctx.scene.fog.mode;
      return `<div class="toolbar">${ib('sub:fog:reveal', 'paint-brush-01', 'Открыть кистью', { active: s === 'reveal' })}${ib('sub:fog:hide', 'paint-brush-02', 'Скрыть кистью', { active: s === 'hide' })}${ib('sub:fog:rect', 'cursor-rectangle-selection-01', 'Открыть область', { active: s === 'rect' })}${div}<label class="tb-slider"><span class="tb-label">Кисть</span><input class="slider" type="range" min="1" max="8" value="${size}" data-range="fogSize" style="--fill:${((size - 1) / 7) * 100}%"><span class="tb-label" data-out="fogSize">${size} кл.</span></label>${div}<label class="tb-select" data-tip="Как работает туман"><select data-select="fogMode"><option value="vision" ${mode === 'vision' ? 'selected' : ''}>Обзор героев</option><option value="manual" ${mode === 'manual' ? 'selected' : ''}>Вручную</option><option value="off" ${mode === 'off' ? 'selected' : ''}>Без тумана</option></select></label>${ib('fog-reveal-all', 'view', 'Открыть всё')}${ib('fog-hide-all', 'view-off', 'Скрыть всё и забыть исследованное')}${undoRedo(ctx)}${div}<button class="btn btn-primary" data-act="done">${icon('tick-02', 18)}Готово</button></div>`;
    }
    if (tool === 'gm') {
      const s = sub.gm || 'trap';
      return `<div class="toolbar">${ib('sub:gm:trap', 'danger', 'Ловушка: обвести клетки', { active: s === 'trap' })}${ib('sub:gm:pin', 'scroll', 'Метка с текстом для чтения вслух', { active: s === 'pin' })}${ib('sub:gm:portal', 'stairs-01', 'Переход на другую сцену', { active: s === 'portal' })}${ib('sub:gm:note', 'sticky-note-01', 'Заметка только для мастера', { active: s === 'note' })}${div}${ib('preview-players', 'view-off', 'Как видят игроки')}${undoRedo(ctx)}${div}<button class="btn btn-primary" data-act="done">${icon('tick-02', 18)}Готово</button></div>`;
    }
    if (tool === 'grid') {
      const g = ctx.scene.grid;
      return `<div class="toolbar">${ib('grid-smaller', 'minus-sign', 'Меньше')}<span class="tb-text mono">${(Math.round(g.size * 4) / 4).toFixed(2).replace(/\.?0+$/, '')} px</span>${ib('grid-bigger', 'plus-sign', 'Больше')}${div}${ib('grid-toggle', 'grid', g.visible === false ? 'Показать сетку' : 'Скрыть сетку', { active: g.visible !== false })}<label class="tb-select"><select data-select="gridFeet"><option value="5" ${(g.feet || 5) === 5 ? 'selected' : ''}>клетка 5 фт</option><option value="10" ${g.feet === 10 ? 'selected' : ''}>клетка 10 фт</option></select></label>${div}<button class="btn btn-ghost" data-act="grid-cancel">Отмена</button><button class="btn btn-primary" data-act="grid-done">${icon('tick-02', 18)}Готово</button></div>`;
    }
  }
  if (tool === 'measure') {
    const s = sub.measure || 'ruler';
    const tpl = TEMPLATES.find((t) => t.id === s);
    const size = tpl ? sub.templateSize?.[s] || tpl.size : null;
    return `<div class="toolbar">${ib('sub:measure:ruler', 'ruler', 'Линейка', { active: s === 'ruler', kbd: 'R' })}${TEMPLATES.map((t) => ib(`sub:measure:${t.id}`, t.icon, `${t.name}`, { active: s === t.id })).join('')}${div}${tpl ? `${ib('tpl-smaller', 'minus-sign', 'Меньше')}<span class="tb-text">${size} фт</span>${ib('tpl-bigger', 'plus-sign', 'Больше')}${div}` : ''}${ib('share-ruler', 'view', ctx.ui.shareRuler ? 'Видно всем за столом' : 'Видно только вам', { active: ctx.ui.shareRuler })}${ib('measure-clear', 'delete-02', 'Убрать')}${div}${ib('tool:move', 'cancel-01', 'Закрыть')}</div>`;
  }
  if (tool === 'draw') {
    const s = sub.draw || 'pen';
    return `<div class="toolbar">${ib('sub:draw:pen', 'pencil-edit-02', 'Рисовать', { active: s === 'pen' })}${ib('sub:draw:erase', 'eraser', 'Стереть линию', { active: s === 'erase' })}${ib('draw-clear', 'delete-02', ctx.isMaster ? 'Стереть все рисунки' : 'Стереть мои рисунки')}${undoRedo(ctx)}${div}${ib('tool:move', 'cancel-01', 'Закрыть')}</div>`;
  }
  // Выделение → токен-бар
  if (ctx.ui.selection.size && (tool === 'move' || tool === 'select' || tool === 'ping')) {
    const bar = ctx.panels.tokenBar();
    if (bar) return bar;
  }
  if (ctx.isMasterView) {
    return `<div class="toolbar add-bar">${ib('add:search', 'search-01', 'Найти существо')}${div}${ib('add:hero', 'chess-pawn', 'Герой на сцену')}${ib('add:creature', 'monster', 'Существа', { active: ctx.ui.panel === 'bestiary' })}${ib('add:item', 'potion', 'Предмет')}${ib('add:environment', 'pine-tree', 'Окружение и свет')}${ib('add:note', 'note-edit', 'Заметка')}${ib('add:map', 'maps', 'Новая сцена')}</div>
      <div class="toolbar tools-bar">${ib('tool:move', 'cursor-hold-01', 'Перемещение', { active: tool === 'move', kbd: 'V' })}${ib('tool:select', 'cursor-rectangle-selection-01', 'Выделение рамкой', { active: tool === 'select', kbd: 'S' })}${ib('tool:draw', 'pencil-edit-02', 'Рисование', { active: tool === 'draw', kbd: 'D' })}${ib('tool:measure', 'ruler', 'Линейка и шаблоны', { active: tool === 'measure', kbd: 'R' })}${ib('tool:walls', 'path', 'Стены и двери', { kbd: 'W' })}${ib('tool:fog', 'cloud', 'Туман войны', { kbd: 'F' })}${ib('tool:gm', 'layers-01', 'Слой мастера', { kbd: 'G' })}${ib('tool:text', 'text-font', 'Текст', { active: tool === 'text' })}${div}${undoRedo(ctx, false)}</div>`;
  }
  const lock = ctx.c.paused;
  return `<div class="toolbar tools-bar">${ib('tool:move', 'cursor-hold-01', 'Перемещение', { active: tool === 'move', kbd: 'V', disabled: lock })}${ib('tool:measure', 'ruler', 'Линейка и шаблоны', { active: tool === 'measure', kbd: 'R' })}${ib('tool:ping', 'location-01', 'Пинг: показать точку', { active: tool === 'ping', kbd: 'P' })}${ib('tool:draw', 'pencil-edit-02', 'Рисование', { active: tool === 'draw', kbd: 'D' })}${div}${undoRedo(ctx, false)}</div>`;
}

function undoRedo(ctx, withDiv = true) {
  return `${withDiv ? div : ''}${ib('undo', 'undo-02', 'Отменить', { kbd: 'Ctrl Z', disabled: !ctx.history.canUndo })}${ib('redo', 'redo-02', 'Повторить', { kbd: 'Ctrl ⇧ Z', disabled: !ctx.history.canRedo })}`;
}
