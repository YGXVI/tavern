// Панели стола: принимает действия от кнопок интерфейса и раздаёт их модулям,
// ведёт виджеты, всплывающие карточки (спасброски, переходы), паузу, бой и события других вкладок.
import { el, esc, uid, plural, fmtMod } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { bus, emitLocal, isServerMode } from '../../core/store.js';
import { srcOf } from '../../core/assets.js';
import { tokenStats, characterOf, updateCampaign, addLog, sceneOf, userById, myCharacter } from '../../core/campaign.js';
import { ABILITIES, mod, profBonus, LIGHTS } from '../../data/rules.js';
import { monsterById } from '../../data/bestiary.js';
import { popover, closePopover, modal, panelHeader, copyText } from '../../ui/kit.js';
import { advanceTurn, endCombat, currentEntry, rollInitiative, initiativeOrder } from './combat.js';
import { diceAction, doRoll, showRollToast, parseFormula, rollPool, describeRoll, canSeeRoll } from './dice.js';
import { diceTray } from './dice-tray.js';
import { openCharacterSheet, openStatblock, closeSheet, refreshSheet } from './sheet.js';
import { applyCalibPreview } from './input.js';
import * as C from './chrome.js';
import { widgetHTML } from './p-widgets.js';
import * as T from './p-token.js';
import * as M from './p-map.js';
import * as S from './p-side.js';
import * as D from './p-dialogs.js';
import { snapCenter } from '../../rules/geometry.js';
import { sizeById } from '../../data/rules.js';

const DICE_ACTS = new Set(['die-add', 'die-remove', 'mod-inc', 'mod-dec', 'adv', 'dice-hidden', 'dice-vis', 'dice-clear', 'dice-reroll', 'dice-roll']);

/** Вкладка в фоне: «⚔ Ваш ход» в заголовке, пока игрок не вернётся. */
let baseTitle = null;
function flagTab(text) {
  if (!text) return;
  baseTitle ??= document.title;
  document.title = text;
  const back = () => { if (!document.hidden) { document.title = baseTitle; baseTitle = null; document.removeEventListener('visibilitychange', back); } };
  document.addEventListener('visibilitychange', back);
}

/** Сколько длится пауза: «3:42». */
export function pauseElapsed(p) { const sec = Math.max(0, Math.floor((Date.now() - (p?.at || Date.now())) / 1000)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }

export class Panels {
  constructor(ctx) {
    this.ctx = ctx;
    this.prev = null;
    this.shares = new Map();
    this.side = el('<aside class="side-panel panel hidden" aria-label="Боковая панель"></aside>');
    this.floats = el('<div class="float-stack" aria-live="polite"></div>');
    this.pauseEl = el('<div class="pause-screen hidden" role="dialog" aria-label="Пауза"></div>');
    ctx.root.append(this.side, this.floats, this.pauseEl);
    const clickAct = (e) => { const b = e.target.closest('[data-act]'); if (!b || b.disabled) return; this.action(b.dataset.act, b, e); };
    this.side.addEventListener('click', clickAct);
    this.floats.addEventListener('click', clickAct);
    this.side.addEventListener('input', (e) => S.sideInput(ctx, e));
    this.pauseTick = setInterval(() => this.tickPause(), 1000);
    const chromeRoot = ctx.root.querySelector('.chrome');
    chromeRoot.addEventListener('contextmenu', (e) => {
      const d = e.target.closest('[data-act="die-add"]');
      if (d) { e.preventDefault(); diceAction(ctx, 'die-remove', d, e); }
    });
    const mine = (p) => p?.cid === ctx.cid;
    this.offs = [
      bus.on('roll', (p) => {
        if (!mine(p)) return;
        showRollToast(ctx, p.entry);
        // Открытый бросок другого участника катится и в нашем лотке (TASK-092).
        if (p.dice?.length && canSeeRoll(ctx, p.entry)) diceTray(ctx)?.roll({ entry: p.entry, results: p.dice, dropped: p.dropped });
        if (ctx.ui.widget === 'dice') this.refreshWidget(true);
      }),
      bus.on('read-aloud', (p) => { if (mine(p) && p.sceneId === ctx.sceneId && !ctx.isMaster) this.readAloud({ title: p.title, text: p.text }); }),
      bus.on('lockpick', (p) => { if (mine(p)) M.lockpickResult(ctx, p); }),
      bus.on('door-ask', (p) => { if (mine(p) && ctx.isMaster) ctx.toast({ title: `${p.name} спрашивает про ключ`, body: 'Есть ли у отряда ключ от этой двери?', icon: 'key-01', timeout: 10000 }); }),
      bus.on('opportunity', (p) => { if (mine(p)) M.opportunityForMaster(ctx, p); }),
      bus.on('trap', (p) => {
        if (!mine(p) || p.sceneId !== ctx.sceneId) return;
        const tr = ctx.scene?.traps.find((x) => x.id === p.trapId), t = ctx.scene?.tokens.find((x) => x.id === p.tokenId);
        if (tr && t) M.trapTriggered(ctx, tr, t, true);
        // Сервер: ловушку у игрока не видно — сработавшую на его герое заметил мастер.
        else if (!tr && t && ctx.isMine(t)) ctx.toast({ title: 'Под ногой щёлкнуло!', body: 'Мастер решает, что будет дальше', icon: 'danger' });
      }),
      bus.on('template-share', (p) => {
        if (!mine(p) || !ctx.isMaster) return;
        this.shares.set(p.userId, { ...p, at: Date.now() });
        this.renderFloats();
      }),
      bus.on('portal-deny', (p) => { if (mine(p) && p.userId === ctx.userId) ctx.toast({ title: 'Мастер пока не пускает', body: 'Отряд остаётся на этой сцене', icon: 'stairs-01' }); }),
      bus.on('hp-flash', (p) => { if (mine(p)) this.flashTokens(p.ids, p.delta); }),
    ];
  }

  // ——— Жизненный цикл ———
  onEnter() {
    const ctx = this.ctx, c = ctx.c;
    this.prev = this.snapshot();
    if (!ctx.isMaster && c.combat.active) ctx.ui.widget = 'initiative';
    if (ctx.isMaster) {
      const pending = c.members.filter((m) => m.status === 'pending');
      if (pending.length) ctx.toast({ title: `${plural(pending.length, 'Заявка', 'Заявки', 'Заявок')} в кампанию: ${pending.length}`, body: pending.map((m) => userById(m.userId)?.name).filter(Boolean).join(', '), icon: 'user-add-01', action: { label: 'Открыть', onClick: () => D.inviteModal(ctx) } });
    } else {
      // С сервера токен только что выбранного героя приходит чуть позже стола — проверяем, когда всё доехало.
      const noHero = () => ctx.c && ctx.scene && !ctx.scene.tokens.some((t) => ctx.isMine(t));
      if (noHero()) setTimeout(() => { if (!this.gone && noHero()) ctx.toast({ title: 'Вашего героя пока нет на карте', body: 'Мастер поставит его, когда начнётся сцена', icon: 'chess-pawn' }); }, isServerMode() ? 1500 : 0);
    }
    this.refresh();
  }

  destroy() {
    this.gone = true;
    clearInterval(this.pauseTick);
    for (const off of this.offs) off();
    closeSheet();
    diceTray(this.ctx)?.destroy();
  }

  snapshot() {
    const ctx = this.ctx, c = ctx.c;
    const cur = ctx.scene ? currentEntry(c, ctx.scene) : null;
    return {
      combat: c.combat.active,
      turnKey: c.combat.active ? `${c.combat.round}:${c.combat.turn}:${cur?.tokenId}` : null,
      curToken: cur?.tokenId || null,
      pending: new Set(c.members.filter((m) => m.status === 'pending').map((m) => m.userId)),
      portals: new Set((c.portalRequests || []).map((r) => r.id)),
      saves: new Set((c.saveRequests || []).filter((r) => r.status === 'open').map((r) => r.id)),
      paused: !!c.paused,
    };
  }

  /** Изменились данные (своя вкладка или чужая). Здесь — только события; отрисовка в refresh(). */
  onData() {
    const ctx = this.ctx, c = ctx.c;
    if (!c) return;
    const was = this.prev || this.snapshot();
    const now = this.snapshot();
    this.prev = now;
    // Бой начался / закончился / сменился ход.
    if (!was.combat && now.combat) {
      if (!ctx.isMaster) {
        ctx.ui.widget = 'initiative';
        const mineEntry = c.combat.entries.find((e) => ctx.scene?.tokens.some((t) => t.id === e.tokenId && ctx.isMine(t)));
        ctx.toast({ title: 'Бой!', body: mineEntry?.init == null && mineEntry ? 'Бросьте инициативу' : `Ваша инициатива: ${mineEntry?.init ?? '—'}`, icon: 'sword-03', action: mineEntry && mineEntry.init == null ? { label: 'Бросить', onClick: () => this.rollMyInitiative(mineEntry.tokenId) } : null });
      }
    }
    if (was.combat && !now.combat && !ctx.isMaster) ctx.toast({ title: 'Бой окончен', icon: 'sword-03' });
    if (now.combat && now.turnKey !== was.turnKey && now.curToken) {
      const t = ctx.scene?.tokens.find((x) => x.id === now.curToken);
      const free = ['move', 'select'].includes(ctx.ui.tool) && !ctx.dragging?.size;
      if (t && !ctx.isMaster && ctx.isMine(t)) {
        ctx.toast({ title: `Ваш ход, ${tokenStats(c, t).name}`, body: `Раунд ${c.combat.round} · ${tokenStats(c, t).speed} фт движения`, icon: 'sword-03' });
        flagTab(document.hidden ? `⚔ Ваш ход — ${tokenStats(c, t).name}` : null);
        if (free) { queueMicrotask(() => ctx.select([t.id])); this.centerIfAway(t); }
      } else if (t && ctx.isMasterView && t.kind === 'foe' && free) {
        queueMicrotask(() => ctx.select([t.id]));
        this.centerIfAway(t);
      }
      if (t?.disengaged && ctx.isMaster) queueMicrotask(() => ctx.mutateScene((s) => { const x = s.tokens.find((q) => q.id === t.id); if (x) x.disengaged = false; }));
    }
    // Заявки в кампанию.
    if (ctx.isMaster) {
      for (const id of now.pending) if (!was.pending.has(id)) ctx.toast({ title: `${userById(id)?.name || 'Игрок'} хочет в кампанию`, icon: 'user-add-01', action: { label: 'Открыть', onClick: () => D.inviteModal(ctx) } });
      for (const r of c.portalRequests || []) if (!was.portals.has(r.id)) {
        const t = sceneOf(c, r.sceneId)?.tokens.find((x) => x.id === r.tokenId);
        if (t) ctx.toast({ title: `${tokenStats(c, t).name} у перехода`, body: 'Решите на карточке сверху', icon: 'stairs-01' });
      }
    } else {
      for (const r of c.saveRequests || []) {
        if (r.status !== 'open' || was.saves.has(r.id)) continue;
        if (this.mySaveTokens(r).length) ctx.toast({ title: 'Мастер просит спасбросок', body: `${ABILITIES.find((a) => a.id === r.ability)?.name} · ${r.label}`, icon: 'dice-faces-06' });
      }
    }
    D.refreshInvite();
    refreshSheet(ctx);
  }

  refresh() {
    this.refreshWidget();
    this.renderFloats();
    this.renderPause();
    if (this.ctx.ui.panel === 'scenes') this.renderSide();
  }

  // ——— Виджет слева ———
  refreshWidget(force = false) {
    const host = this.ctx.root.querySelector('.ch-widget');
    if (!host) return;
    const html = widgetHTML(this.ctx);
    if (force || host.__html !== html) {
      const scroll = host.querySelector('.scroll')?.scrollTop || 0;
      host.innerHTML = html; host.__html = html;
      const sc = host.querySelector('.scroll'); if (sc) sc.scrollTop = scroll;
      // Очередь боя: текущий ход всегда в поле зрения.
      host.querySelector('.init-row.current')?.scrollIntoView({ block: 'nearest' });
      // Анимация появления — только когда открыли другой виджет, а не на каждое обновление данных.
      if (this.lastWidget !== this.ctx.ui.widget) {
        this.lastWidget = this.ctx.ui.widget;
        host.classList.remove('opening'); void host.offsetWidth; host.classList.add('opening');
      }
    }
    // Лоток с объёмными кубами стоит рядом с виджетом «Кубы» и держит выбранные кубы (TASK-092).
    diceTray(this.ctx)?.syncPool(this.ctx.ui.dicePool);
  }

  openWidget(w, force = false) {
    const ctx = this.ctx;
    ctx.ui.widget = force || ctx.ui.widget !== w ? w : null;
    this.refreshWidget();
    ctx.invalidate('chrome');
  }

  // ——— Боковая панель ———
  toggleSide(name) {
    const ctx = this.ctx;
    ctx.ui.panel = ctx.ui.panel === name ? null : name;
    if (ctx.ui.panel) closeSheet();
    this.renderSide(true);
    ctx.invalidate('chrome');
  }

  renderSide(force = false) {
    const ctx = this.ctx;
    if (!ctx.ui.panel || !ctx.isMaster) { this.side.classList.add('hidden'); this.side.innerHTML = ''; this.side.__html = ''; return; }
    const html = S.sideHTML(ctx);
    this.side.classList.remove('hidden');
    this.side.dataset.panel = ctx.ui.panel;
    if (force || this.side.__html !== html) {
      const body = this.side.querySelector('.side-body');
      const top = body?.scrollTop || 0;
      const focusSearch = document.activeElement?.matches?.('[data-bsearch], [data-ssearch]') ? (document.activeElement.matches('[data-ssearch]') ? '[data-ssearch]' : '[data-bsearch]') : null;
      this.side.innerHTML = html; this.side.__html = html;
      const nb = this.side.querySelector('.side-body'); if (nb) nb.scrollTop = top;
      if (focusSearch) { const i = this.side.querySelector(focusSearch); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }
      S.hydrateImages(this.side);
    }
  }

  openBestiary(focus = false) {
    const ctx = this.ctx;
    if (ctx.ui.panel !== 'bestiary') this.toggleSide('bestiary'); else this.renderSide(true);
    if (focus) setTimeout(() => this.side.querySelector('[data-bsearch]')?.focus(), 30);
  }

  // ——— Сцены без карты ———
  renderNoScene(node) {
    const ctx = this.ctx, c = ctx.c;
    if (!node.__bound) {
      node.__bound = true;
      node.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) this.action(b.dataset.act, b, e); });
    }
    const ch = myCharacter(c, ctx.userId);
    node.innerHTML = ctx.isMaster
      ? `<div class="no-scene-card panel"><span class="empty-ic">${icon('maps', 32)}</span><h2>Сцен пока нет</h2><p class="t-para muted">Возьмите готовую карту — склеп, лес, таверну или пещеру — или загрузите свою. Игроки увидят сцену, когда вы её покажете.</p><div class="row"><button class="btn btn-primary btn-lg" data-act="add:map">${icon('plus-sign', 18)}Создать сцену</button><button class="btn btn-secondary btn-lg" data-act="invite">${icon('user-add-01', 18)}Пригласить</button></div></div>`
      : `<div class="no-scene-card panel"><span class="empty-ic hourglass">${icon('hourglass', 32)}</span><h2>Мастер готовит сцену</h2><p class="t-para muted">Как только он покажет карту, она появится здесь. А пока можно заглянуть в лист героя.</p>${ch ? `<button class="btn btn-secondary btn-lg" data-act="sheet" data-id="${esc(ch.id)}">${icon('book-open-01', 18)}Лист: ${esc(ch.name)}</button>` : ''}</div>`;
  }

  sceneTransition(scene) {
    if (!scene) return;
    const n = el(`<div class="scene-transition"><div><small>Новая сцена</small><b>${esc(scene.name)}</b></div></div>`);
    this.ctx.root.append(n);
    setTimeout(() => n.classList.add('out'), 1300);
    setTimeout(() => n.remove(), 1900);
  }

  // ——— Пауза ———
  renderPause() {
    const ctx = this.ctx, p = ctx.c?.paused;
    const show = p && !p.silent && !ctx.isMaster;
    this.pauseEl.classList.toggle('hidden', !show);
    if (!show) { this.pauseEl.innerHTML = ''; this.pauseEl.__key = ''; return; }
    const key = `${p.at}|${p.message}`;
    if (this.pauseEl.__key === key) return;
    this.pauseEl.__key = key;
    const by = userById(p.by);
    this.pauseEl.innerHTML = `<div class="pause-card"><span class="hourglass-big">${icon('hourglass', 40)}</span><h2>Мастер поставил стол на паузу</h2>${p.message ? `<p>«${esc(p.message)}»</p>` : '<p>Мастер ненадолго остановил игру</p>'}<b class="pause-timer" data-pause-timer>${pauseElapsed(p)}</b><small>${esc(by?.name || 'Мастер')} вернёт стол — продолжим с того же места. Лист героя и кубы работают.</small></div>`;
  }

  /** Раз в секунду обновлять таймеры паузы на экране. */
  tickPause() {
    const p = this.ctx.c?.paused;
    if (!p) return;
    for (const n of this.ctx.root.querySelectorAll('[data-pause-timer]')) n.textContent = pauseElapsed(p);
  }

  // ——— Чтение вслух ———
  readAloud(pin) {
    const m = modal(`<div class="read-aloud"><div class="ra-label">${icon('scroll', 16)}Мастер читает вслух</div><h2>${esc(pin.title)}</h2><p>${esc(pin.text || '').replace(/\n/g, '<br>')}</p><div class="row"><span class="spacer"></span><button class="btn btn-primary" data-close>Понятно</button></div></div>`, { className: 'ra-modal' });
    return m;
  }

  // ——— Всплывающие карточки сверху ———
  renderFloats() {
    const ctx = this.ctx, c = ctx.c;
    if (!c) return;
    const cards = [];
    const reqs = (c.saveRequests || []).filter((r) => r.status === 'open' && r.sceneId === ctx.sceneId);
    if (ctx.isMaster) {
      for (const r of reqs) cards.push(this.saveResultsCard(r));
      for (const r of c.portalRequests || []) {
        const sc = sceneOf(c, r.sceneId);
        const t = sc?.tokens.find((x) => x.id === r.tokenId);
        const p = sc?.portals.find((x) => x.id === r.portalId);
        const target = p && sceneOf(c, p.targetSceneId);
        if (!t || !target) continue;
        const st = tokenStats(c, t);
        cards.push(`<div class="float-card panel" data-key="portal-${esc(r.id)}"><span class="avatar sm hero"><img src="${esc(srcOf(t.img))}" alt=""></span><div class="titles"><b>${esc(st.name)} у перехода</b><small>«${esc(p.name)}» → «${esc(target.name)}»${sc.id !== ctx.sceneId ? ` · на сцене «${esc(sc.name)}»` : ''}</small></div><button class="btn btn-sm btn-ghost" data-act="portal-deny" data-id="${esc(r.id)}">Не сейчас</button><button class="btn btn-sm btn-primary" data-act="portal-allow" data-id="${esc(r.id)}">${icon('stairs-01', 14)}Пустить</button></div>`);
      }
      for (const [uidKey, s] of this.shares) {
        if (s.sceneId !== ctx.sceneId || Date.now() - s.at > 10 * 60000) { this.shares.delete(uidKey); continue; }
        const n = s.targets.length;
        cards.push(`<div class="float-card panel" data-key="share-${esc(uidKey)}">${icon('cone-01', 20)}<div class="titles"><b>${esc(s.name)}: шаблон ${s.tpl.size} фт</b><small>${n} ${plural(n, 'цель', 'цели', 'целей')} в области</small></div><button class="btn btn-sm btn-ghost" data-act="share-dismiss" data-id="${esc(uidKey)}">Убрать</button><button class="btn btn-sm btn-secondary" data-act="share-show" data-id="${esc(uidKey)}">${icon('location-01', 14)}Показать</button><button class="btn btn-sm btn-primary" data-act="share-saves" data-id="${esc(uidKey)}" ${n ? '' : 'disabled'}>${icon('dice-faces-06', 14)}Спасброски</button></div>`);
      }
    } else {
      for (const r of reqs) for (const t of this.mySaveTokens(r)) {
        const ab = ABILITIES.find((a) => a.id === r.ability);
        const m = this.saveMod(t, r.ability);
        cards.push(`<div class="float-card panel save-prompt" data-key="prompt-${esc(r.id)}-${esc(t.id)}"><span class="status-badge accent">${icon('dice-faces-06', 14)}</span><div class="titles"><b>Спасбросок: ${esc(ab.name)} · СЛ ${r.dc}</b><small>«${esc(r.label)}» · ${esc(tokenStats(c, t).name)} ${fmtMod(m)}</small></div><button class="btn btn-sm btn-ghost" data-act="save-roll" data-id="${esc(r.id)}" data-token="${esc(t.id)}" data-adv="dis">Помеха</button><button class="btn btn-sm btn-ghost" data-act="save-roll" data-id="${esc(r.id)}" data-token="${esc(t.id)}" data-adv="adv">Преим.</button><button class="btn btn-sm btn-primary" data-act="save-roll" data-id="${esc(r.id)}" data-token="${esc(t.id)}">${icon('dice-faces-06', 14)}Бросить к20</button></div>`);
      }
      // Герой товарища, которого нет за столом: тихая карточка «бросить за него».
      for (const r of reqs) for (const t of this.friendSaveTokens(r)) {
        const ab = ABILITIES.find((a) => a.id === r.ability);
        const name = tokenStats(c, t).name;
        cards.push(`<div class="float-card panel save-prompt friend" data-key="friend-${esc(r.id)}-${esc(t.id)}"><span class="avatar sm hero"><img src="${esc(srcOf(t.img))}" alt=""></span><div class="titles"><b>${esc(name)} не за столом</b><small>Спасбросок ${esc(ab.short)} СЛ ${r.dc} · «${esc(r.label)}» ${fmtMod(this.saveMod(t, r.ability))}</small></div><button class="btn btn-sm btn-secondary" data-act="save-roll" data-id="${esc(r.id)}" data-token="${esc(t.id)}">${icon('dice-faces-06', 14)}Бросить за него</button></div>`);
      }
    }
    const html = cards.join('');
    if (this.floats.__html !== html) {
      const before = new Set([...this.floats.children].map((n) => n.dataset.key));
      this.floats.innerHTML = html; this.floats.__html = html;
      for (const n of this.floats.children) if (!before.has(n.dataset.key)) n.classList.add('new');
    }
  }

  saveResultsCard(r) {
    const ctx = this.ctx, c = ctx.c;
    const ab = ABILITIES.find((a) => a.id === r.ability);
    const toks = r.tokenIds.map((id) => ctx.scene?.tokens.find((t) => t.id === id)).filter(Boolean);
    const done = toks.filter((t) => r.results[t.id]).length;
    const rows = toks.map((t) => {
      const st = tokenStats(c, t);
      const res = r.results[t.id];
      return `<div class="sv-row"><span class="avatar xs ${t.kind}"><img src="${esc(srcOf(t.img))}" alt=""></span><span class="grow ellipsis">${esc(st.name)}</span>${res ? `<b class="mono">${res.total}</b><span class="chip ${res.ok ? 'chip-success' : 'chip-negative'}">${res.ok ? 'успех' : 'провал'}</span>` : `<span class="t-xs tertiary">ждём игрока</span><button class="btn btn-sm btn-ghost" data-act="save-auto" data-id="${esc(r.id)}" data-token="${esc(t.id)}">Бросить за него</button>`}</div>`;
    }).join('');
    return `<div class="float-card panel save-card" data-key="save-${esc(r.id)}"><div class="sv-head"><span class="status-badge accent">${icon('dice-faces-06', 14)}</span><div class="titles"><b>${esc(r.label)} · ${esc(ab.short)} СЛ ${r.dc}</b><small>${done} из ${toks.length} бросили${r.damage ? ` · урон ${esc(r.damage)}${r.half ? ', при успехе половина' : ''}` : ''}</small></div><button class="icon-btn icon-btn-xs" data-act="save-close" data-id="${esc(r.id)}" aria-label="Закрыть">${icon('cancel-01', 14)}</button></div>
      <div class="sv-list">${rows}</div>
      ${r.damage ? `<div class="row"><span class="spacer"></span><button class="btn btn-sm btn-danger" data-act="save-apply" data-id="${esc(r.id)}" ${done ? '' : 'disabled'}>${icon('flash', 14)}Бросить урон и применить</button></div>` : ''}</div>`;
  }

  // ——— Спасброски ———
  mySaveTokens(r) {
    const ctx = this.ctx;
    return r.tokenIds.map((id) => ctx.scene?.tokens.find((t) => t.id === id)).filter((t) => t && ctx.isMine(t) && !r.results[t.id]);
  }

  /** Герои других игроков, которых нет за столом: за них можно бросить (решение 30.10). */
  friendSaveTokens(r) {
    const ctx = this.ctx;
    return r.tokenIds.map((id) => ctx.scene?.tokens.find((t) => t.id === id)).filter((t) => t && !r.results[t.id] && ctx.playsFor(t) && ctx.ownerAway(t));
  }

  saveMod(t, ability) {
    const c = this.ctx.c;
    if (t.characterId) {
      const ch = characterOf(c, t.characterId);
      if (ch) return mod(ch.stats[ability]) + (ch.saves.includes(ability) ? profBonus(ch.level) : 0);
    }
    const m = monsterById(t.monsterId);
    return m ? (m.saves?.[ability] ?? mod(m.stats[ability])) : 0;
  }

  needsPlayer(t) {
    const c = this.ctx.c;
    return !!t.characterId && c.members.some((m) => m.characterId === t.characterId && m.status === 'active' && m.role === 'player');
  }

  saveRequestPanel(ids, opts = {}) { D.saveConfig(this.ctx, ids, opts); }

  requestSaves({ ability, dc, label, tokenIds, damage = '', half = true }) {
    const ctx = this.ctx;
    const req = { id: uid('sv-'), ability, dc, label, tokenIds, damage, half, sceneId: ctx.sceneId, at: Date.now(), by: ctx.userId, results: {}, status: 'open' };
    for (const id of tokenIds) {
      const t = ctx.scene.tokens.find((x) => x.id === id);
      if (!t || this.needsPlayer(t)) continue;
      const r = rollPool({ dice: { 20: 1 }, mod: this.saveMod(t, ability) });
      req.results[id] = { total: r.total, nat: r.results[0].value, ok: r.total >= dc, by: 'master', detail: describeRoll(r) };
    }
    updateCampaign(ctx.cid, (c) => {
      c.saveRequests = [...(c.saveRequests || []).filter((x) => x.status === 'open' && Date.now() - x.at < 3600000).slice(-4), req];
      addLog(c, { kind: 'note', userId: ctx.userId, text: `Спасбросок ${ABILITIES.find((a) => a.id === ability)?.short} СЛ ${dc}: ${label}` });
    });
    ctx.clearMeasure();
    const waiting = tokenIds.length - Object.keys(req.results).length;
    ctx.toast({ title: 'Спасбросок запрошен', body: waiting ? `Ждём ${waiting} ${plural(waiting, 'игрока', 'игроков', 'игроков')}, за существ уже бросили` : 'За всех бросили — смотрите карточку сверху', icon: 'dice-faces-06' });
  }

  rollSave(reqId, tokenId, adv = null, byMaster = false) {
    const ctx = this.ctx, c = ctx.c;
    const r = (c.saveRequests || []).find((x) => x.id === reqId);
    const t = ctx.scene?.tokens.find((x) => x.id === tokenId);
    if (!r || !t || r.results[tokenId]) return;
    const ab = ABILITIES.find((a) => a.id === r.ability);
    const st = tokenStats(c, t);
    const rr = doRoll(ctx, { label: `${st.name}: спасбросок ${ab.short} (${r.label})`, dice: { 20: 1 }, mod: this.saveMod(t, r.ability), adv, kind: 'save' });
    const res = { total: rr.total, nat: rr.entry.nat, ok: rr.total >= r.dc, by: byMaster ? 'master' : 'player', detail: rr.entry.detail };
    updateCampaign(ctx.cid, (cc) => { const x = (cc.saveRequests || []).find((q) => q.id === reqId); if (x && !x.results[tokenId]) x.results[tokenId] = res; });
    if (!byMaster) ctx.toast({ title: res.ok ? 'Успех!' : 'Провал', body: `${rr.total} против СЛ ${r.dc}`, icon: res.ok ? 'shield-01' : 'flash' });
  }

  applySave(reqId) {
    const ctx = this.ctx, c = ctx.c;
    const r = (c.saveRequests || []).find((x) => x.id === reqId);
    if (!r) return;
    if (r.sceneId !== ctx.sceneId) { ctx.toast({ title: 'Перейдите на сцену запроса', icon: 'maps' }); return; }
    const f = parseFormula(r.damage);
    if (!f) { ctx.toast({ title: 'Не понимаю формулу урона', body: r.damage, icon: 'alert-circle' }); return; }
    const dmg = doRoll(ctx, { label: `${r.label}: урон`, ...f }).total;
    const fails = [], succ = [], skipped = [];
    for (const id of r.tokenIds) { const x = r.results[id]; if (!x) skipped.push(id); else (x.ok ? succ : fails).push(id); }
    if (fails.length) T.applyHp(ctx, fails, -dmg);
    if (succ.length && r.half && Math.floor(dmg / 2) > 0) T.applyHp(ctx, succ, -Math.floor(dmg / 2));
    updateCampaign(ctx.cid, (cc) => { const x = (cc.saveRequests || []).find((q) => q.id === reqId); if (x) x.status = 'done'; });
    if (skipped.length) ctx.toast({ title: 'Без броска — урон не применён', body: skipped.map((id) => { const t = ctx.scene.tokens.find((q) => q.id === id); return t ? tokenStats(c, t).name : ''; }).filter(Boolean).join(', '), icon: 'alert-circle' });
  }

  // ——— Хиты и смерть ———
  hpEditor(tokenId, anchor, mode) { T.hpEditor(this.ctx, Array.isArray(tokenId) ? tokenId : [tokenId], anchor, mode); }
  commitHp(tokenId, text) { return T.commitHpInput(this.ctx, tokenId, text); }
  copyTokens(ids) { T.copyTokens(this.ctx, ids); }
  auraPopover(id, anchor) { T.auraPopover(this.ctx, id, anchor); }
  pasteTokens(at) { T.pasteTokens(this.ctx, at); }
  applyHp(ids, delta) { T.applyHp(this.ctx, ids, delta); }

  deathSave(chId) {
    const ctx = this.ctx;
    const ch = characterOf(ctx.c, chId);
    if (!ch || ch.hp > 0) return;
    const r = doRoll(ctx, { label: `${ch.name}: спасбросок от смерти`, dice: { 20: 1 }, kind: 'save' });
    const nat = r.results[0].value;
    let out = null;
    updateCampaign(ctx.cid, (c) => {
      const x = c.characters.find((q) => q.id === chId); if (!x) return;
      const ds = x.deathSaves || (x.deathSaves = { s: 0, f: 0 });
      if (nat === 20) { x.hp = 1; x.deathSaves = { s: 0, f: 0 }; x.conditions = (x.conditions || []).filter((q) => q !== 'unconscious'); out = 'up'; }
      else if (nat === 1) ds.f = Math.min(3, ds.f + 2);
      else if (nat >= 10) ds.s = Math.min(3, ds.s + 1);
      else ds.f = Math.min(3, ds.f + 1);
      if (!out) out = ds.s >= 3 ? 'stable' : ds.f >= 3 ? 'dead' : `${ds.s}:${ds.f}`;
      addLog(c, { kind: 'save', userId: ctx.userId, text: `${x.name}: спасбросок от смерти — ${nat}` });
    });
    const msg = {
      up: [`${ch.name} приходит в себя!`, 'Натуральная 20 — 1 хит, можно действовать'],
      stable: [`${ch.name} стабилизирован`, 'Три успеха — без сознания, но больше не умирает'],
      dead: [`${ch.name} погибает…`, 'Три провала. Мастер решит, что дальше'],
    }[out] || [nat >= 10 ? 'Успех' : 'Провал', `Успехи ${out.split(':')[0]} из 3 · провалы ${out.split(':')[1]} из 3`];
    ctx.toast({ title: msg[0], body: msg[1], icon: out === 'dead' ? 'skull' : 'heart-check' });
  }

  flashTokens(ids, delta) {
    const ctx = this.ctx;
    for (const id of ids) {
      const n = ctx.L.tokens.querySelector(`[data-token="${CSS.escape(id)}"]`);
      const t = ctx.scene?.tokens.find((x) => x.id === id);
      if (!n || !t) continue;
      n.classList.remove('flash-dmg', 'flash-heal'); void n.offsetWidth;
      n.classList.add(delta < 0 ? 'flash-dmg' : 'flash-heal');
      setTimeout(() => n.classList.remove('flash-dmg', 'flash-heal'), 800);
      const showNum = ctx.isMasterView || t.kind === 'hero' || ctx.c.settings.playersSeeHp === 'exact';
      if (!showNum) continue;
      const g = ctx.scene.grid.size * sizeById(t.size).cells;
      const f = el(`<span class="hp-float ${delta < 0 ? 'dmg' : 'heal'}" style="left:${t.x}px;top:${t.y - g * 0.45}px">${delta < 0 ? '−' : '+'}${Math.abs(delta)}</span>`);
      ctx.L.labels.append(f);
      setTimeout(() => f.remove(), 1300);
    }
  }

  // ——— Бой ———
  combatToggle(ids) {
    const ctx = this.ctx, c = ctx.c;
    if (!c.combat.active) { D.combatSetup(ctx, ids); return; }
    const inCombat = new Set(c.combat.entries.map((e) => e.tokenId));
    const removeAll = ids.every((id) => inCombat.has(id));
    this.keepTurn((cc, sc) => {
      if (removeAll) cc.combat.entries = cc.combat.entries.filter((e) => !ids.includes(e.tokenId));
      else for (const id of ids) if (!inCombat.has(id)) { const t = sc.tokens.find((x) => x.id === id); if (t && t.kind !== 'item') cc.combat.entries.push({ tokenId: id, init: rollInitiative(cc, t).init }); }
    });
    ctx.toast({ title: removeAll ? 'Убраны из боя' : 'В бою', body: `${ids.length} ${plural(ids.length, 'участник', 'участника', 'участников')}`, icon: 'sword-03' });
  }

  /** Изменить участников боя, сохранив, чей сейчас ход. */
  keepTurn(fn) {
    const ctx = this.ctx, sid = ctx.sceneId;
    updateCampaign(ctx.cid, (c) => {
      const sc = c.scenes.find((s) => s.id === sid);
      const before = currentEntry(c, sc)?.tokenId;
      fn(c, sc);
      if (!c.combat.entries.length) { endCombat(c); return; }
      const order = initiativeOrder(c, sc);
      const i = order.findIndex((e) => e.tokenId === before);
      c.combat.turn = i >= 0 ? i : Math.min(c.combat.turn, order.length - 1);
    });
  }

  setInitiative(tokenId, v) { this.keepTurn((c) => { const e = c.combat.entries.find((x) => x.tokenId === tokenId); if (e) e.init = v; }); }

  rollMyInitiative(tokenId) {
    const ctx = this.ctx, c = ctx.c;
    const t = ctx.scene?.tokens.find((x) => x.id === tokenId);
    if (!t) return;
    const st = tokenStats(c, t);
    const r = doRoll(ctx, { label: `${st.name}: инициатива`, dice: { 20: 1 }, mod: st.initBonus || 0 });
    this.setInitiative(tokenId, r.total);
  }

  nextTurn(dir = 1) {
    const ctx = this.ctx, sid = ctx.sceneId;
    updateCampaign(ctx.cid, (c) => advanceTurn(c, c.scenes.find((s) => s.id === sid), dir));
  }

  endTurn() {
    const ctx = this.ctx;
    const cur = currentEntry(ctx.c, ctx.scene);
    if (!cur) return;
    if (!ctx.isMaster && !ctx.playsFor(cur.token)) return;
    this.nextTurn(1);
  }

  /** Открыть виджет «Зрение» с настройкой света и тёмного зрения героя (TASK-046). */
  openVisionFor(tokenId) {
    this.ctx.ui.visionEdit = tokenId;
    this.ctx.ui.widget = 'vision';
    this.refreshWidget(true);
    this.ctx.invalidate('chrome');
  }

  /** Свет и тёмное зрение правит мастер (любой токен) и игрок — своего героя. */
  canSetVision(tokenId) {
    const t = this.ctx.scene?.tokens.find((x) => x.id === tokenId);
    return !!t && (this.ctx.isMaster || this.ctx.isMine(t));
  }

  centerIfAway(t) {
    const v = this.ctx.camera.viewRect();
    const pad = Math.min(v.w, v.h) * 0.12;
    if (t.x < v.x + pad || t.x > v.x + v.w - pad || t.y < v.y + pad || t.y > v.y + v.h - pad) this.ctx.camera.centerOn(t.x, t.y);
  }

  // ——— Мосты для ввода и токенов ———
  tokenBar() { return T.tokenBarHTML(this.ctx); }
  contextMenu(target, w, screen) { T.contextMenu(this.ctx, target, w, screen); }
  deleteTokens(ids) { T.deleteTokens(this.ctx, ids); }
  toggleHidden(ids, force) { T.toggleHidden(this.ctx, ids, force); }
  deleteWall(id) { M.deleteWall(this.ctx, id); }
  deleteLight(id) { M.deleteLight(this.ctx, id); }
  doorClick(id, node) { M.doorClick(this.ctx, id, node); }
  wallPopover(id, a) { M.wallPopover(this.ctx, id, a); }
  lightPopover(id, a) { M.lightPopover(this.ctx, id, a); }
  addLight(p, preset, a) { M.addLight(this.ctx, p, preset, a); }
  pinPopover(id, a) { M.pinPopover(this.ctx, id, a); }
  addPin(p, kind, a) { M.addPin(this.ctx, p, kind, a); }
  portalPopover(id, a) { M.portalPopover(this.ctx, id, a); }
  addPortal(p, a) { M.addPortal(this.ctx, p, a); }
  portalReached(p, t) { M.portalReached(this.ctx, p, t); }
  trapPopover(id, a) { M.trapPopover(this.ctx, id, a); }
  addTrap(cells, a) { M.addTrap(this.ctx, cells, a); }
  trapTriggered(tr, t) { M.trapTriggered(this.ctx, tr, t); }
  templatePopover(a) { M.templatePopover(this.ctx, a); }
  opportunityWarning(t, foes, h) { M.opportunityWarning(this.ctx, t, foes, h); }
  textPrompt(w, a, d) { M.textPrompt(this.ctx, w, a, d); }
  help() { D.helpModal(this.ctx); }

  openSheetFor(t) {
    const ctx = this.ctx;
    if (!t) return;
    if (t.kind === 'item') return;
    ctx.ui.panel = null; this.renderSide();
    if (t.characterId) openCharacterSheet(ctx, t.characterId);
    else if (t.id) openStatblock(ctx, t.id);
    ctx.invalidate('chrome');
  }

  undo() { const e = this.ctx.history.undo(this.ctx); if (e) this.ctx.toast({ title: `Отменено: ${e.label || 'действие'}`, icon: 'undo-02', timeout: 1800 }); this.ctx.invalidate('chrome'); }
  redo() { const e = this.ctx.history.redo(this.ctx); if (e) this.ctx.toast({ title: `Повторено: ${e.label || 'действие'}`, icon: 'redo-02', timeout: 1800 }); this.ctx.invalidate('chrome'); }

  // ——— Ползунки и списки в панелях ———
  range(name, value, input) {
    const ctx = this.ctx;
    ctx.ui.sub[name] = value;
    const out = input.closest('.toolbar')?.querySelector(`[data-out="${name}"]`);
    if (out) out.textContent = name === 'terrainSize' ? `${value}×${value}` : `${value} кл.`;
    if (name === 'fogSize' && ctx.ui.brush) { ctx.ui.brush.r = (value * ctx.scene.grid.size) / 2; ctx.invalidate('overlay'); }
  }

  selectChange(name, value) {
    const ctx = this.ctx;
    if (name === 'fogMode') {
      const before = ctx.scene.fog.mode;
      ctx.mutateScene((s) => { s.fog.mode = value; }, { label: 'Режим тумана', undo: (s) => { s.fog.mode = before; }, redo: (s) => { s.fog.mode = value; } });
      ctx.toast({ title: { vision: 'Туман открывается обзором героев', manual: 'Туман открываете вы кистью', off: 'Туман выключен' }[value], icon: 'cloud' });
    }
    if (name === 'gridFeet') { ctx.scene.grid.feet = Number(value); ctx.ui.gridFeet = Number(value); ctx.invalidate('chrome', 'overlay'); }
  }

  // ——— Сетка ———
  gridDone() {
    const ctx = this.ctx;
    const k = ctx.ui.calib, before = ctx.ui.gridBefore;
    if (!k || !before) { ctx.setTool('move'); return; }
    applyCalibPreview(ctx);
    const after = { ...structuredClone(ctx.scene.grid), calibrated: true };
    const moved = {};
    ctx.ui.gridBefore = null;
    ctx.mutateScene((s) => {
      Object.assign(s.grid, after);
      // Токены встают в центры новых клеток; исследованное по старой сетке сбрасываем.
      for (const t of s.tokens) { const n = sizeById(t.size).cells; const p = snapCenter(s.grid, t.x, t.y, n); moved[t.id] = { from: { x: t.x, y: t.y }, to: p }; t.x = p.x; t.y = p.y; }
      s.fog.explored = [];
    }, {
      label: 'Сетка',
      undo: (s) => { Object.assign(s.grid, before); for (const t of s.tokens) if (moved[t.id]) { t.x = moved[t.id].from.x; t.y = moved[t.id].from.y; } },
      redo: (s) => { Object.assign(s.grid, after); for (const t of s.tokens) if (moved[t.id]) { t.x = moved[t.id].to.x; t.y = moved[t.id].to.y; } },
    });
    ctx.setTool('move');
    ctx.toast({ title: 'Сетка подогнана', body: `Клетка ${Math.round(after.size * 100) / 100} px = ${after.feet || 5} фт`, icon: 'grid' });
  }

  // ——— Главный диспетчер ———
  action(act, b, e) {
    const ctx = this.ctx, c = ctx.c;
    if (!c) return;
    if (DICE_ACTS.has(act)) { diceAction(ctx, act, b, e); return; }
    // Слой мастера (TASK-088): выбрать настройку карты; повторный клик закрывает её, слой остаётся.
    if (act.startsWith('layer:')) {
      const [, tool, sub] = act.split(':');
      if (C.layerItemActive(ctx, act)) { ctx.setTool('move'); return; }
      const cur = ctx.ui.sub.walls;
      const door = (v) => v === 'door' || v === 'secret';
      const s = tool !== 'walls' ? sub : sub === 'door' ? (door(cur) ? cur : 'door') : (cur && !door(cur) ? cur : 'wall');
      ctx.setTool(tool, s);
      return;
    }
    if (act.startsWith('tool:')) { ctx.setTool(act.slice(5)); if (act === 'tool:measure') ctx.ui.sub.measure = ctx.ui.sub.measure || 'ruler'; return; }
    if (act.startsWith('sub:')) {
      const [, tool, v] = act.split(':');
      if (tool === 'measure') { if ((ctx.ui.sub.measure || 'ruler') !== v) ctx.clearMeasure(false); ctx.setTool('measure', v); return; }
      ctx.ui.sub[tool] = v;
      ctx.invalidate('chrome', 'overlay', 'terrain');
      return;
    }
    if (act.startsWith('add:')) { this.addAction(act.slice(4), b); return; }
    if (S.sideAction(ctx, act, b, e)) return;
    const sel = [...ctx.ui.selection];
    const one = sel.length === 1 ? ctx.scene?.tokens.find((t) => t.id === sel[0]) : null;
    switch (act) {
      case 'logo': D.campaignMenu(ctx, b); break;
      case 'w-vision': this.openWidget('vision'); break;
      case 'w-party': this.openWidget('party'); break;
      case 'w-initiative': this.openWidget('initiative'); break;
      case 'w-dice': this.openWidget('dice'); break;
      case 'w-close': ctx.ui.widget = null; this.refreshWidget(); ctx.invalidate('chrome'); break;
      case 'pause': D.pausePopover(ctx, b); break;
      case 'exit-viewas': ctx.setViewAs(null); break;
      case 'viewas': ctx.setViewAs(ctx.ui.viewAs === b.dataset.id ? null : b.dataset.id); break;
      case 'vision-edit': ctx.ui.visionEdit = ctx.ui.visionEdit === b.dataset.id ? null : b.dataset.id; this.refreshWidget(true); break;
      case 'v-light': if (this.canSetVision(b.dataset.id)) T.setTokenLight(ctx, b.dataset.id, b.dataset.v); break;
      case 'v-dv': if (this.canSetVision(b.dataset.id)) T.setDarkvision(ctx, b.dataset.id, Number(b.dataset.v) || 0); break;
      case 'preview-players': ctx.ui.previewPlayers = !ctx.ui.previewPlayers; ctx.ui.viewAs = null; ctx.select([]); if (ctx.ui.previewPlayers && !['move', 'measure', 'draw'].includes(ctx.ui.tool)) ctx.setTool('move'); ctx.invalidate('all'); break;
      case 'exit-preview': ctx.ui.previewPlayers = false; ctx.invalidate('all'); break;
      case 'look-back': {
        ctx.ui.lookLock = null;
        const t = ctx.scene?.tokens.find((x) => ctx.isMine(x));
        if (t) ctx.camera.centerOn(t.x, t.y);
        ctx.invalidate('chrome');
        break;
      }
      case 'end-turn': this.endTurn(); break;
      case 'scenes': this.toggleSide('scenes'); break;
      case 'side-close': ctx.ui.panel = null; this.renderSide(); ctx.invalidate('chrome'); break;
      case 'sheet': {
        const id = b.dataset.id || one?.characterId;
        if (id) this.openSheetFor({ characterId: id });
        break;
      }
      case 'statblock': if (one) this.openSheetFor(one); break;
      case 'invite': D.inviteModal(ctx); break;
      case 'help': this.help(); break;
      case 'reference': D.referenceModal(this.ctx); break;
      case 'layer': ctx.setLayer(!ctx.ui.layer); break;
      // «Готово» слоя: подогнанная сетка сохраняется, а не теряется.
      case 'done': case 'layer-close': {
        // Сетку, которую подгоняли, «Готово» сохраняет; нетронутую не перезаписываем (токены не прыгают).
        const b = ctx.ui.gridBefore;
        if (ctx.ui.tool === 'grid' && b && ctx.ui.calib) {
          applyCalibPreview(ctx);
          const g = ctx.scene.grid, near = (x, y) => Math.abs((x || 0) - (y || 0)) < 0.01;
          if (!near(g.size, b.size) || !near(g.offsetX, b.offsetX) || !near(g.offsetY, b.offsetY) || (g.feet || 5) !== (b.feet || 5) || (g.visible !== false) !== (b.visible !== false)) this.gridDone();
        }
        ctx.setLayer(false);
        break;
      }
      case 'focus-toggle': ctx.ui.focusOff = !ctx.ui.focusOff; ctx.applyFocus(); ctx.invalidate('chrome'); break;
      case 'toggle-dark': {
        const before = ctx.scene.lighting, after = before === 'dark' ? 'bright' : 'dark';
        ctx.mutateScene((s) => { s.lighting = after; }, { label: 'Освещение', undo: (s) => { s.lighting = before; }, redo: (s) => { s.lighting = after; } });
        break;
      }
      case 'toggle-shared': ctx.mutate((cc) => { cc.settings.sharedVision = !cc.settings.sharedVision; }); ctx.invalidateVision(); break;
      case 'my-light': {
        const t = ctx.scene?.tokens.find((x) => ctx.isMine(x));
        if (!t) break;
        const torch = LIGHTS.find((l) => l.id === 'torch');
        const val = t.light ? null : { preset: torch.id, bright: torch.bright, dim: torch.dim, color: torch.color, flicker: torch.flicker };
        ctx.mutateScene((s, cc) => { const x = s.tokens.find((q) => q.id === t.id); if (x) x.light = val; const ch = cc.characters.find((q) => q.id === t.characterId); if (ch) ch.light = val; });
        ctx.toast({ title: val ? 'Факел зажжён' : 'Факел погашен', body: val ? 'Ярко 20 фт и ещё 20 фт тусклого света' : 'Вокруг снова темно', icon: 'fire' });
        break;
      }
      case 'fog-reveal-all': {
        const s0 = ctx.scene;
        const op = { id: uid('f-'), type: 'reveal', shape: 'rect', x: 0, y: 0, w: s0.map.width, h: s0.map.height };
        ctx.mutateScene((s) => { s.fog.ops = [...(s.fog.ops || []), op]; }, { label: 'Открыть всё', undo: (s) => { s.fog.ops = (s.fog.ops || []).filter((x) => x.id !== op.id); }, redo: (s) => { s.fog.ops = [...(s.fog.ops || []), op]; } });
        break;
      }
      case 'fog-hide-all': {
        const before = structuredClone(ctx.scene.fog);
        ctx.mutateScene((s) => { s.fog.ops = []; s.fog.explored = []; }, { label: 'Скрыть всё', undo: (s) => { s.fog.ops = structuredClone(before.ops || []); s.fog.explored = structuredClone(before.explored || []); }, redo: (s) => { s.fog.ops = []; s.fog.explored = []; } });
        ctx.toast({ title: 'Туман сгустился', body: 'Исследованное забыто — игроки видят только то, что видят сейчас', icon: 'cloud' });
        break;
      }
      case 'grid-smaller': case 'grid-bigger': {
        const k = ctx.ui.calib; if (!k) break;
        const d = (act === 'grid-bigger' ? 1 : -1) * (e?.shiftKey ? 2 : 0.25);
        k.size = Math.max(10, Math.round((k.size + d) * 4) / 4);
        applyCalibPreview(ctx);
        break;
      }
      case 'grid-toggle': ctx.scene.grid.visible = ctx.scene.grid.visible === false; ctx.invalidate('grid', 'chrome'); break;
      case 'grid-cancel': ctx.setTool('move'); break;
      case 'grid-done': this.gridDone(); break;
      case 'tpl-smaller': case 'tpl-bigger': {
        const s = ctx.ui.sub.measure;
        const sizes = ctx.ui.sub.templateSize || (ctx.ui.sub.templateSize = {});
        const cur = sizes[s] || ({ cone: 15, line: 30, cube: 15, sphere: 20 }[s] || 15);
        sizes[s] = Math.max(5, Math.min(120, cur + (act === 'tpl-bigger' ? 5 : -5)));
        if (ctx.ui.template?.type === s) { ctx.ui.template.size = sizes[s]; if (ctx.ui.shareRuler) ctx.sendTemplate(ctx.ui.template); }
        ctx.invalidate('chrome', 'areas');
        break;
      }
      case 'share-ruler': ctx.ui.shareRuler = !ctx.ui.shareRuler; if (!ctx.ui.shareRuler) { ctx.sendRuler(null); ctx.sendTemplate(null); } ctx.invalidate('chrome'); break;
      case 'measure-clear': ctx.clearMeasure(); break;
      case 'draw-clear': {
        const mineOnly = !ctx.isMaster;
        const removed = ctx.scene.drawings.filter((d) => !mineOnly || d.author === ctx.userId);
        if (!removed.length) { ctx.toast({ title: 'Рисунков нет', icon: 'pencil-edit-02' }); break; }
        const ids = new Set(removed.map((d) => d.id));
        ctx.mutateScene((s) => { s.drawings = s.drawings.filter((d) => !ids.has(d.id)); }, { label: 'Стереть рисунки', undo: (s) => { s.drawings.push(...structuredClone(removed)); }, redo: (s) => { s.drawings = s.drawings.filter((d) => !ids.has(d.id)); } });
        break;
      }
      case 'undo': this.undo(); break;
      case 'redo': this.redo(); break;
      case 'zoom-in': ctx.camera.zoomStep(1); break;
      case 'zoom-out': ctx.camera.zoomStep(-1); break;
      case 'fit': ctx.fitScene(true); break;
      // Отряд и инициатива
      case 'party-focus': case 'init-focus': {
        const t = act === 'init-focus' ? ctx.scene?.tokens.find((x) => x.id === b.dataset.id) : ctx.scene?.tokens.find((x) => x.characterId === b.dataset.id);
        if (!t) { if (act === 'party-focus') this.openSheetFor({ characterId: b.dataset.id }); break; }
        if (ctx.tokenShown(t)) { ctx.select([t.id]); ctx.camera.centerOn(t.x, t.y); }
        break;
      }
      case 'combat-start': D.combatSetup(ctx, sel); break;
      case 'setup-toggle': case 'setup-self': case 'setup-cancel': case 'setup-start': D.setupAction(ctx, act, b); break;
      case 'combat-next': this.nextTurn(1); break;
      case 'combat-prev': this.nextTurn(-1); break;
      case 'combat-end': updateCampaign(ctx.cid, (cc) => endCombat(cc)); ctx.toast({ title: 'Бой окончен', icon: 'sword-03' }); break;
      case 'combat-add': this.combatToggle(sel); break;
      case 'init-set': D.initEdit(ctx, b.dataset.id, b); break;
      case 'init-remove': this.keepTurn((cc) => { cc.combat.entries = cc.combat.entries.filter((x) => x.tokenId !== b.dataset.id); }); break;
      case 'init-roll': this.rollMyInitiative(b.dataset.id); break;
      // Токен-бар
      case 'focus': if (one) ctx.camera.centerOn(one.x, one.y); break;
      case 'hp': this.hpEditor(sel, b); break;
      case 'hp-dmg': this.hpEditor(sel, b, 'damage'); break;
      case 'hp-heal': this.hpEditor(sel, b, 'heal'); break;
      case 'death-save': if (one?.characterId) this.deathSave(one.characterId); break;
      case 'conditions': T.conditionPicker(ctx, sel, b); break;
      case 'visibility': T.toggleHidden(ctx, sel); break;
      case 'reveal': T.toggleHidden(ctx, sel, false); break;
      case 'quick-roll': this.openWidget('dice', true); break;
      case 'token-menu': {
        const t = one || ctx.scene?.tokens.find((x) => x.id === sel[0]);
        if (!t) break;
        const r = b.getBoundingClientRect();
        T.contextMenu(ctx, { kind: 'token', id: t.id }, { x: t.x, y: t.y }, { x: r.left + r.width / 2, y: r.top });
        break;
      }
      case 'token-settings': if (one) T.tokenSettings(ctx, one.id, b); break;
      case 'token-delete': T.deleteTokens(ctx, sel); break;
      case 'deselect': ctx.select([]); break;
      case 'ping-token': if (one) ctx.ping(one.x, one.y); break;
      case 'copy-code': copyText(ctx.c.invite?.code || '').then(() => ctx.toast({ title: 'Код скопирован', body: ctx.c.invite?.code, icon: 'copy-01' })); break;
      case 'target': if (one) T.toggleTarget(ctx, one.id); break;
      // Карточки сверху
      case 'save-roll': this.rollSave(b.dataset.id, b.dataset.token, b.dataset.adv || null); break;
      case 'save-auto': this.rollSave(b.dataset.id, b.dataset.token, null, true); break;
      case 'save-apply': this.applySave(b.dataset.id); break;
      case 'save-close': updateCampaign(ctx.cid, (cc) => { const x = (cc.saveRequests || []).find((q) => q.id === b.dataset.id); if (x) x.status = 'done'; }); break;
      case 'portal-allow': {
        const r = (c.portalRequests || []).find((x) => x.id === b.dataset.id);
        const p = r && sceneOf(c, r.sceneId)?.portals.find((x) => x.id === r.portalId);
        if (r && p) M.transferTokens(ctx, [r.tokenId], p, r.sceneId);
        break;
      }
      case 'portal-deny': {
        const r = (c.portalRequests || []).find((x) => x.id === b.dataset.id);
        updateCampaign(ctx.cid, (cc) => { cc.portalRequests = (cc.portalRequests || []).filter((x) => x.id !== b.dataset.id); });
        if (r) bus.send('portal-deny', { cid: ctx.cid, userId: r.userId });
        break;
      }
      case 'share-dismiss': this.shares.delete(b.dataset.id); this.renderFloats(); break;
      case 'share-show': { const s = this.shares.get(b.dataset.id); if (s) ctx.camera.centerOn(s.tpl.origin.x, s.tpl.origin.y); break; }
      case 'share-saves': { const s = this.shares.get(b.dataset.id); if (s) { this.saveRequestPanel(s.targets.filter((id) => ctx.scene.tokens.some((t) => t.id === id))); this.shares.delete(b.dataset.id); this.renderFloats(); } break; }
      default: console.warn('Неизвестное действие', act);
    }
  }

  addAction(what, b) {
    const ctx = this.ctx;
    switch (what) {
      case 'search': this.openBestiary(true); break;
      case 'creature': this.toggleSide('bestiary'); break;
      case 'hero': S.heroPicker(ctx, b); break;
      case 'item': S.itemPicker(ctx, b); break;
      case 'environment': ctx.setTool('lights'); break;
      case 'note': ctx.setTool('gm', 'note'); break;
      case 'map': S.newSceneModal(ctx); break;
      default: break;
    }
  }
}

export { emitLocal, popover, closePopover, panelHeader };
