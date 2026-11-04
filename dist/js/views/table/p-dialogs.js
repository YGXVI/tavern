// Окна стола: меню кампании, приглашение, настройки, справка, пауза, начало боя, запрос спасброска.
import { esc, plural, timeAgo } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { srcOf } from '../../core/assets.js';
import { replaceDB, getDB, commit, isServerMode } from '../../core/store.js';
import { joinUrl } from '../../server/config.js';
import { characterOf, tokenStats, updateCampaign, userById, addLog, canFight } from '../../core/campaign.js';
import { ABILITIES } from '../../data/rules.js';
import { makeInviteCode } from '../../data/demo.js';
import { modal, panelHeader, popover, closePopover, menu, confirmDialog, copyText, userAvatar } from '../../ui/kit.js';
import { go } from '../screens.js';
import { startCombat, rollInitiative } from './combat.js';
import { initiativeDice } from './dice.js';
import { closeSheet } from './sheet.js';

// ——— Меню кампании (логотип) ———
export function campaignMenu(ctx, anchor) {
  const c = ctx.c;
  const items = [
    { icon: 'home-01', label: 'Все кампании', href: '#/campaigns', onClick: () => go('#/campaigns') },
    'divider',
    ctx.isMaster ? { icon: 'maps', label: 'Сцены', onClick: () => ctx.panels.toggleSide('scenes') } : null,
    ctx.isMaster ? { icon: 'user-add-01', label: 'Пригласить игроков', onClick: () => inviteModal(ctx) } : null,
    ctx.isMaster ? { icon: 'settings-01', label: 'Настройки кампании', onClick: () => settingsModal(ctx) } : null,
    !ctx.isMaster && ctx.myCharacterId ? { icon: 'book-open-01', label: 'Лист героя', href: `#/c/${ctx.cid}/sheet/${encodeURIComponent(ctx.myCharacterId)}`, onClick: () => ctx.panels.openSheetFor({ characterId: ctx.myCharacterId }) } : null,
    { icon: 'dice-faces-06', label: 'Журнал бросков', onClick: () => ctx.panels.openWidget('dice', true) },
    { icon: 'keyboard', label: 'Горячие клавиши', hint: '?', onClick: () => helpModal(ctx) },
    !ctx.isMaster ? 'divider' : null,
    !ctx.isMaster ? { icon: 'logout-01', label: 'Покинуть кампанию', danger: true, onClick: () => leaveCampaign(ctx) } : null,
  ].filter(Boolean);
  const p = menu(items, anchor, { placement: 'bottom' });
  p.node.querySelector('.menu')?.insertAdjacentHTML('afterbegin', `<div class="menu-title"><b>${esc(c.name)}</b><small>${ctx.isMaster ? 'Вы мастер' : 'Вы играете'} · ${c.members.filter((m) => m.status === 'active').length} ${plural(c.members.filter((m) => m.status === 'active').length, 'участник', 'участника', 'участников')}</small></div>`);
}

async function leaveCampaign(ctx) {
  const ok = await confirmDialog({ title: 'Покинуть кампанию?', body: 'Лист героя останется у мастера. Вернуться можно по новому приглашению.', ok: 'Покинуть', danger: true });
  if (!ok) return;
  updateCampaign(ctx.cid, (c) => {
    const m = c.members.find((x) => x.userId === ctx.userId);
    if (m?.characterId) { const ch = c.characters.find((x) => x.id === m.characterId); if (ch) ch.ownerId = null; }
    c.members = c.members.filter((x) => x.userId !== ctx.userId);
    addLog(c, { kind: 'member', text: `${ctx.user.name} покинул кампанию` });
  });
  go('#/campaigns');
}

// ——— Участник: действия мастера ———
function memberMenu(ctx, userId, anchorEl, rerender, modalRef) {
  const c = ctx.c;
  const mm = c.members.find((x) => x.userId === userId); if (!mm) return;
  const u = userById(userId);
  const ch = characterOf(c, mm.characterId);
  const free = c.members.filter((x) => x.role === 'player' && x.status === 'active' && !x.characterId && x.userId !== userId);
  const r = anchorEl.getBoundingClientRect();
  const anchor = { x: r.left, y: r.bottom + 4 };
  menu([
    ch ? { icon: 'book-open-01', label: 'Открыть лист героя', href: `#/c/${ctx.cid}/sheet/${encodeURIComponent(ch.id)}`, onClick: () => { modalRef.close(); ctx.panels.openSheetFor({ characterId: ch.id }); } } : null,
    ch && free.length ? { icon: 'arrow-data-transfer-horizontal', label: 'Передать героя…', onClick: () => menu(free.map((f) => ({ icon: 'user', label: userById(f.userId)?.name || 'Игрок', onClick: () => { updateCampaign(ctx.cid, (cc) => { const a = cc.members.find((x) => x.userId === userId), b = cc.members.find((x) => x.userId === f.userId); if (a && b) { b.characterId = a.characterId; a.characterId = null; const h = cc.characters.find((x) => x.id === b.characterId); if (h) h.ownerId = f.userId; addLog(cc, { kind: 'member', text: `${h?.name || 'Герой'} теперь у ${userById(f.userId)?.name || 'игрока'}` }); } }); rerender(); } })), anchor, { placement: 'bottom', className: 'over-modal' }) } : null,
    ch ? { icon: 'shuffle', label: 'Сменить героя', hint: 'игрок выберет заново', onClick: () => { updateCampaign(ctx.cid, (cc) => { const a = cc.members.find((x) => x.userId === userId); const h = cc.characters.find((x) => x.id === a?.characterId); if (h) h.ownerId = null; if (a) a.characterId = null; addLog(cc, { kind: 'member', text: `${u?.name || 'Игрок'} выбирает другого героя` }); }); rerender(); } } : null,
    'divider',
    { icon: 'user-remove-01', label: 'Исключить из кампании', danger: true, onClick: async () => {
      const ok = await confirmDialog({ title: `Исключить ${u?.name || 'игрока'}?`, body: 'Он сразу потеряет доступ к кампании. Его герой останется у вас.', ok: 'Исключить', danger: true });
      if (!ok) return;
      updateCampaign(ctx.cid, (cc) => { const a = cc.members.find((x) => x.userId === userId); const h = a?.characterId && cc.characters.find((x) => x.id === a.characterId); if (h) h.ownerId = null; cc.members = cc.members.filter((x) => x.userId !== userId); addLog(cc, { kind: 'member', text: `${u?.name || 'Игрок'} исключён из кампании` }); });
      rerender();
    } },
  ].filter(Boolean), anchor, { placement: 'bottom', className: 'over-modal' });
}

// ——— Приглашение ———
let inviteRef = null;
export function inviteModal(ctx) {
  const render = () => {
    const c = ctx.c;
    const inv = c.invite || {};
    const link = joinUrl(inv.code, isServerMode());
    const players = c.members.filter((m) => m.role === 'player' && m.status === 'active').length;
    const pending = c.members.filter((m) => m.status === 'pending');
    const expired = inv.expiresAt && inv.expiresAt < Date.now();
    const left = inv.expiresAt ? Math.max(0, inv.expiresAt - Date.now()) : null;
    const leftText = left === null ? 'без срока' : expired ? 'истекла' : left > 86400000 ? `ещё ${Math.ceil(left / 86400000)} ${plural(Math.ceil(left / 86400000), 'день', 'дня', 'дней')}` : `ещё ${Math.ceil(left / 3600000)} ч`;
    const exp = !inv.expiresAt ? 'never' : (inv.expiresAt - (inv.createdAt || 0)) > 2 * 86400000 ? 'week' : 'day';
    return `${panelHeader(`Пригласить в «${c.name}»`, `${players} из ${c.seats} мест · ссылка ${leftText}`)}
      <div class="modal-body scroll">
      <div class="panel-section">
        <div class="invite-link"><div class="input grow">${icon('link-01', 18)}<input readonly value="${esc(link)}" aria-label="Ссылка-приглашение" data-link></div><button class="btn btn-primary" data-copy>${icon('copy-01', 16)}Копировать</button></div>
        <div class="row"><span class="t-sm muted">Код для вставки:</span><span class="code-chip mono">${esc(inv.code)}</span><span class="spacer"></span><button class="btn btn-sm btn-ghost" data-regen>${icon('reload', 14)}Новая ссылка</button></div>
        <div class="field"><label>Срок действия</label><div class="chips-wrap">${[['day', '24 часа'], ['week', '7 дней'], ['never', 'Без срока']].map(([v, l]) => `<button class="chip chip-md ${exp === v ? 'chip-accent' : ''}" data-exp="${v}">${l}</button>`).join('')}</div></div>
        <div class="setting-row">${icon('shield-user', 20)}<span class="titles"><span class="label-main">Одобрять вручную</span><span class="hint">Новый игрок ждёт, пока вы его примете</span></span><input type="checkbox" class="switch" data-manual ${inv.manual ? 'checked' : ''} aria-label="Одобрять вручную"></div>
        <p class="t-xs tertiary">Демо: ссылка работает только в этом браузере — откройте её в другой вкладке и войдите другим аккаунтом.</p>
      </div>
      ${pending.length ? `<hr class="panel-divider"><div class="panel-section"><div class="label">Заявки · ${pending.length}</div>${pending.map((m) => { const u = userById(m.userId); return `<div class="list-row">${userAvatar(u, 'sm')}<span class="grow col-tight"><span class="primary">${esc(u?.name || 'Игрок')}</span><span class="secondary">хочет присоединиться · ${esc(timeAgo(m.joinedAt))}</span></span><button class="btn btn-sm btn-ghost" data-decline="${esc(m.userId)}">Отклонить</button><button class="btn btn-sm btn-primary" data-accept="${esc(m.userId)}">${icon('tick-02', 14)}Принять</button></div>`; }).join('')}</div>` : ''}
      </div>
      <div class="panel-footer"><span class="spacer"></span><button class="btn btn-secondary" data-close>Готово</button></div>`;
  };
  const m = modal(render(), { onClose: () => { inviteRef = null; } });
  inviteRef = { m, render };
  m.box.addEventListener('click', async (e) => {
    if (e.target.closest('[data-copy]')) { const ok = await copyText(m.box.querySelector('[data-link]').value); ctx.toast({ title: ok ? 'Ссылка скопирована' : 'Не удалось скопировать — выделите вручную', icon: 'link-01' }); return; }
    if (e.target.closest('[data-regen]')) { updateCampaign(ctx.cid, (c) => { c.invite = { ...c.invite, code: makeInviteCode(), createdAt: Date.now(), expiresAt: c.invite?.expiresAt ? Date.now() + (c.invite.expiresAt - (c.invite.createdAt || Date.now())) : null }; }); ctx.toast({ title: 'Старая ссылка больше не работает', icon: 'reload' }); return; }
    const ex = e.target.closest('[data-exp]');
    if (ex) { const v = ex.dataset.exp; updateCampaign(ctx.cid, (c) => { c.invite = { ...c.invite, createdAt: Date.now(), expiresAt: v === 'never' ? null : Date.now() + (v === 'day' ? 86400000 : 7 * 86400000) }; }); return; }
    if (e.target.closest('[data-manual]')) { const v = e.target.checked; updateCampaign(ctx.cid, (c) => { c.invite = { ...c.invite, manual: v }; }); return; }
    const acc = e.target.closest('[data-accept]');
    if (acc) {
      const c = ctx.c;
      const players = c.members.filter((x) => x.role === 'player' && x.status === 'active').length;
      if (players >= c.seats) { ctx.toast({ title: 'Все места заняты', body: 'Добавьте мест в настройках кампании', icon: 'alert-circle' }); return; }
      updateCampaign(ctx.cid, (cc) => { const x = cc.members.find((q) => q.userId === acc.dataset.accept); if (x) { x.status = 'active'; x.joinedAt = Date.now(); } addLog(cc, { kind: 'member', text: `${userById(acc.dataset.accept)?.name || 'Игрок'} в кампании` }); });
      return;
    }
    const dec = e.target.closest('[data-decline]');
    if (dec) updateCampaign(ctx.cid, (cc) => { cc.members = cc.members.filter((q) => q.userId !== dec.dataset.decline || q.status !== 'pending'); });
  });
}
export function refreshInvite() { if (inviteRef?.m.root.isConnected) inviteRef.m.set(inviteRef.render()); }

// ——— Настройки кампании ———
let settingsTab = 'general';
export function settingsModal(ctx) {
  const render = () => {
    const c = ctx.c;
    const tabs = [['general', 'Общее'], ['members', 'Участники'], ['rules', 'Правила']];
    let body = '';
    if (settingsTab === 'general') {
      body = `<div class="panel-section">
        <div class="field"><label for="cs-name">Название</label><div class="input"><input id="cs-name" maxlength="60" value="${esc(c.name)}"></div></div>
        <div class="field"><label for="cs-desc">Описание для игроков</label><div class="input area"><textarea id="cs-desc" rows="3" maxlength="400">${esc(c.description || '')}</textarea></div></div>
        <div class="form-grid"><div class="field"><label for="cs-level">Уровень отряда</label><div class="input"><input id="cs-level" type="number" min="1" max="20" value="${c.level || 1}"></div></div><div class="field"><label for="cs-seats">Мест для игроков</label><div class="input"><input id="cs-seats" type="number" min="1" max="12" value="${c.seats || 5}"></div></div></div>
        <div class="row"><span class="spacer"></span><button class="btn btn-primary" data-save-general>${icon('tick-02', 16)}Сохранить</button></div>
      </div><hr class="panel-divider"><div class="panel-section"><div class="label negative">Опасная зона</div><div class="row"><span class="t-sm muted grow">Удалить кампанию со всеми сценами и листами — только в этом браузере.</span><button class="btn btn-sm btn-danger" data-delete>${icon('delete-02', 14)}Удалить</button></div></div>`;
    } else if (settingsTab === 'members') {
      body = `<div class="panel-section">${c.members.map((m) => {
        const u = userById(m.userId); const ch = characterOf(c, m.characterId);
        return `<div class="list-row">${userAvatar(u, 'sm')}<span class="grow col-tight"><span class="primary">${esc(u?.name || 'Игрок')}</span><span class="secondary">${m.role === 'master' ? 'Мастер' : m.status === 'pending' ? 'Ждёт одобрения' : ch ? `играет за ${esc(ch.name)}` : 'выбирает героя'}</span></span>${m.role === 'master' ? `<span class="chip chip-accent">${icon('crown', 12)}мастер</span>` : `<button class="icon-btn icon-btn-sm" data-member="${esc(m.userId)}" aria-label="Действия с участником" data-tip="Действия">${icon('more-horizontal', 18)}</button>`}</div>`;
      }).join('')}<p class="t-xs tertiary">Исключённый игрок сразу теряет доступ к кампании; его герой остаётся у мастера.</p></div>`;
    } else {
      const s = c.settings;
      body = `<div class="panel-section">
        <div class="field"><label>Диагонали</label><div class="chips-wrap"><button class="chip chip-md ${s.diagonal !== '5-10-5' ? 'chip-accent' : ''}" data-diag="5">Каждая 5 фт</button><button class="chip chip-md ${s.diagonal === '5-10-5' ? 'chip-accent' : ''}" data-diag="5-10-5">5 — 10 — 5 фт</button></div><span class="t-xs tertiary">Книга игрока — каждая клетка 5 фт; вариант из Руководства мастера — каждая вторая диагональ 10 фт.</span></div>
        <div class="setting-row">${icon('cursor-hold-01', 20)}<span class="titles"><span class="label-main">Игроки двигают любые токены</span><span class="hint">Иначе — только своего героя. Хиты и листы чужих токенов всё равно меняет мастер</span></span><input type="checkbox" class="switch" data-openmove ${s.openMovement !== false ? 'checked' : ''} aria-label="Игроки двигают любые токены"></div>
        <div class="setting-row">${icon('user-group', 20)}<span class="titles"><span class="label-main">Общий обзор отряда</span><span class="hint">Игроки видят то, что видит любой герой</span></span><input type="checkbox" class="switch" data-shared ${s.sharedVision ? 'checked' : ''} aria-label="Общий обзор"></div>
        <div class="field"><label>Хиты врагов для игроков</label><div class="chips-wrap">${[['status', 'Только состояние'], ['exact', 'Точные числа']].map(([v, l]) => `<button class="chip chip-md ${s.playersSeeHp === v ? 'chip-accent' : ''}" data-hpview="${v}">${l}</button>`).join('')}</div><span class="t-xs tertiary">«Состояние» — «цел», «ранен», «тяжело ранен», «при смерти».</span></div>
      </div>`;
    }
    return `${panelHeader('Настройки кампании', c.name)}<div class="tabs settings-tabs">${tabs.map(([v, l]) => `<button class="tab" aria-selected="${settingsTab === v}" data-tab="${v}">${l}</button>`).join('')}</div><div class="modal-body scroll">${body}</div>`;
  };
  const m = modal(render(), { wide: false });
  const rerender = () => m.set(render());
  m.box.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab]'); if (t) { settingsTab = t.dataset.tab; rerender(); return; }
    if (e.target.closest('[data-save-general]')) {
      const name = m.box.querySelector('#cs-name').value.trim();
      if (!name) { m.box.querySelector('#cs-name').closest('.input').classList.add('error'); return; }
      updateCampaign(ctx.cid, (c) => { c.name = name; c.description = m.box.querySelector('#cs-desc').value.trim(); c.level = Math.max(1, Math.min(20, Number(m.box.querySelector('#cs-level').value) || 1)); c.seats = Math.max(1, Math.min(12, Number(m.box.querySelector('#cs-seats').value) || 5)); });
      ctx.toast({ title: 'Сохранено', icon: 'tick-02' }); rerender(); return;
    }
    if (e.target.closest('[data-delete]')) {
      const ok = await confirmDialog({ title: `Удалить «${ctx.c.name}»?`, body: 'Сцены, листы героев и журнал исчезнут. Отменить нельзя.', ok: 'Удалить навсегда', danger: true });
      if (!ok) return;
      m.close(); closeSheet();
      commit((db) => { delete db.campaigns[ctx.cid]; });
      go('#/campaigns');
      return;
    }
    const mb = e.target.closest('[data-member]');
    if (mb) { memberMenu(ctx, mb.dataset.member, mb, rerender, m); return; }
    const k = e.target.closest('[data-kick]');
    if (k) {
      const u = userById(k.dataset.kick);
      const ok = await confirmDialog({ title: `Убрать ${u?.name || 'игрока'} из кампании?`, body: 'Его герой останется в кампании без игрока.', ok: 'Убрать', danger: true });
      if (!ok) return;
      updateCampaign(ctx.cid, (c) => { const mm = c.members.find((x) => x.userId === k.dataset.kick); const ch = mm?.characterId && c.characters.find((x) => x.id === mm.characterId); if (ch) ch.ownerId = null; c.members = c.members.filter((x) => x.userId !== k.dataset.kick); });
      rerender(); return;
    }
    const d = e.target.closest('[data-diag]'); if (d) { updateCampaign(ctx.cid, (c) => { c.settings.diagonal = d.dataset.diag; }); rerender(); return; }
    const hv = e.target.closest('[data-hpview]'); if (hv) { updateCampaign(ctx.cid, (c) => { c.settings.playersSeeHp = hv.dataset.hpview; }); rerender(); return; }
    if (e.target.closest('[data-shared]')) { const v = e.target.checked; updateCampaign(ctx.cid, (c) => { c.settings.sharedVision = v; }); }
    if (e.target.closest('[data-openmove]')) { const v = e.target.checked; updateCampaign(ctx.cid, (c) => { c.settings.openMovement = v; }); }
  });
}

// ——— Справочник (TASK-094): кнопка «?» слева снизу. Пока заглушка; управление — по ссылке и на клавише «?» ———
export function referenceModal(ctx) {
  const parts = [['book-open-01', 'Правила', 'Действия в бою, укрытие, падение, отдых'], ['magic-wand-01', 'Заклинания', 'Круги, школы, концентрация, компоненты'], ['potion', 'Предметы', 'Оружие, доспехи, магические вещи'], ['monster', 'Существа', 'Статблоки бестиария'], ['sparkles', 'Состояния', 'Что делает «Сбит с ног», «Отравлен» и другие']];
  const m = modal(`${panelHeader('Справочник', 'Скоро: правила D&D 5e 2014 с поиском прямо за столом')}
    <div class="modal-body"><div class="panel-section ref-soon">${parts.map(([ic, t, s]) => `<div class="ref-row">${icon(ic, 18)}<span><b>${esc(t)}</b><small>${esc(s)}</small></span></div>`).join('')}</div></div>
    <div class="panel-footer"><button class="btn btn-ghost" data-keys>${icon('keyboard', 16)}Управление и горячие клавиши</button><span class="spacer"></span><button class="btn btn-secondary" data-close>Понятно</button></div>`);
  m.box.querySelector('[data-keys]').addEventListener('click', () => { m.close(); helpModal(ctx); });
  return m;
}

// ——— Справка по управлению ———
export function helpModal(ctx) {
  const k = (keys, text) => `<div class="hk-row"><span class="hk-keys">${keys.map((x) => `<kbd class="key">${esc(x)}</kbd>`).join('')}</span><span>${esc(text)}</span></div>`;
  const master = ctx.isMaster;
  const m = modal(`${panelHeader('Как управлять столом', master ? 'Вы мастер: видите всё и ведёте сцену' : 'Вы игрок: ведёте своего героя')}
    <div class="modal-body scroll"><div class="help-grid">
      <div class="panel-section"><div class="label">Карта</div>
        ${k(['Колесо'], 'Приблизить или отдалить к курсору (на тачпаде — два пальца или щипок)')}
        ${k(['Пробел', 'тянуть'], 'Двигать карту')}
        ${k(['Пробел', 'колесо'], 'Двигать карту; Shift + колесо — вбок')}
        ${k(['Правая кнопка'], 'Тянуть — двигать, клик — меню')}
        ${k(['Alt', 'клик'], 'Пинг: показать точку')}
        ${master ? k(['⇧', 'Alt', 'клик'], 'Все смотрят сюда') : ''}
        ${k(['0'], 'Показать всю сцену')}
        ${k(['+', '−'], 'Масштаб')}
      </div>
      <div class="panel-section"><div class="label">Токены</div>
        ${k(['Тянуть'], 'Свободно, у центра клетки — магнит; путь в обход стен')}
        ${k(['⇧', 'тянуть'], 'Ровно по клеткам')}
        ${master ? k(['Alt', 'тянуть'], 'Переставить свободно, сквозь стены') : ''}
        ${k(['⇧', 'клик'], 'Выделить несколько')}
        ${k(['Стрелки'], 'Сдвинуть на клетку')}
        ${k(['Двойной клик'], 'Лист героя или статблок')}
        ${master ? k(['H'], 'Скрыть или показать игрокам') : ''}
        ${master ? k(['Del'], 'Удалить выделенное') : ''}
        ${k(['Esc'], 'Снять выделение, закрыть')}
      </div>
      <div class="panel-section"><div class="label">Инструменты</div>
        ${k(['V'], 'Перемещение')}${k(['R'], 'Линейка и шаблоны')}${k(['D'], 'Рисование')}${master ? '' : k(['P'], 'Пинг')}
        ${master ? `${k(['S'], 'Выделение рамкой')}${k(['W'], 'Стены и двери')}${k(['L'], 'Свет')}${k(['F'], 'Туман войны')}${k(['T'], 'Местность')}${k(['G'], 'Слой мастера: настройка карты')}${k(['⇧'], 'Стены и свет — по сетке')}` : ''}
        ${k(['Ctrl', 'Z'], 'Отменить')}${k(['Ctrl', '⇧', 'Z'], 'Повторить')}
      </div>
    </div>
    <div class="panel-section"><p class="t-xs tertiary">Демо-режим: «онлайн» работает между вкладками одного браузера. Откройте кампанию во второй вкладке другим аккаунтом — и увидите стол глазами игрока.</p></div></div>
    <div class="panel-footer"><span class="spacer"></span><button class="btn btn-secondary" data-close>Понятно</button></div>`, { wide: true });
  return m;
}

// ——— Пауза ———
export function pausePopover(ctx, anchor) {
  const c = ctx.c;
  if (c.paused) { updateCampaign(ctx.cid, (cc) => { cc.paused = null; addLog(cc, { kind: 'pause', text: 'Игра продолжается' }); }); return; }
  const pop = popover(`<div class="pause-pop"><div class="panel-header"><div class="titles"><div class="title">Пауза</div><div class="subtitle">Игроки не смогут ходить, пока вы не продолжите</div></div><button class="icon-btn icon-btn-sm" data-close>${icon('cancel-01', 18)}</button></div>
    <div class="panel-section"><div class="input"><input data-msg maxlength="80" placeholder="Например, перерыв на 10 минут"></div>
    <button class="btn btn-primary btn-block" data-p="screen">${icon('pause', 16)}Пауза с экраном для игроков</button>
    <button class="btn btn-secondary btn-block" data-p="silent">${icon('hourglass', 16)}Тихая пауза — карта видна</button></div></div>`, anchor, { placement: 'bottom' });
  pop.node.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    const msg = pop.node.querySelector('[data-msg]').value.trim();
    updateCampaign(ctx.cid, (cc) => { cc.paused = { silent: b.dataset.p === 'silent', message: msg, at: Date.now(), by: ctx.userId }; addLog(cc, { kind: 'pause', text: 'Пауза' }); });
    closePopover();
  });
}

// ——— Начать бой ———
/**
 * Подготовка боя — в виджете инициативы, как в макете: список участников с уже брошенной
 * инициативой, «Перебросить врагов», «Начать бой». Состояние — в ctx.ui.setup.
 */
export function combatSetup(ctx, preselect = []) {
  const sc = ctx.scene;
  const toks = sc.tokens.filter(canFight);
  const pre = new Set(preselect);
  // Свои токены и призывы игроков сами в бой не попадают — мастер отмечает их в списке (TASK-183).
  const on = toks.filter((t) => (pre.size ? pre.has(t.id) || t.kind === 'hero' : t.kind === 'hero' || (!t.hidden && !t.ownerId && !t.summonedBy))).map((t) => t.id);
  // Инициатива бросается при «Начать бой» (TASK-038), здесь — только кто участвует. Мастер по умолчанию бросает за всех (TASK-111).
  ctx.ui.setup = { ids: new Set(on), pool: toks.map((t) => t.id), self: false };
  ctx.panels.openWidget('initiative', true);
  ctx.panels.refreshWidget(true);
}

export const hasPlayerHero = (ctx, t) => !!t.characterId && ctx.c.members.some((mm) => mm.characterId === t.characterId && mm.status === 'active' && mm.role === 'player');

/** Действия подготовки боя из виджета. */
export function setupAction(ctx, act, b) {
  const st = ctx.ui.setup; if (!st) return;
  const sc = ctx.scene;
  if (act === 'setup-toggle') { const id = b.dataset.id; st.ids.has(id) ? st.ids.delete(id) : st.ids.add(id); }
  else if (act === 'setup-self') st.self = !st.self;
  else if (act === 'setup-cancel') ctx.ui.setup = null;
  else if (act === 'setup-start') {
    const ids = sc.tokens.filter((t) => st.ids.has(t.id)).map((t) => t.id);
    if (!ids.length) return;
    const use = {}, rolled = [];
    // Свежий бросок к20 + инициатива для всех, кроме героев, за которых бросают игроки (null).
    // Бросаем до записи: те же к20 падают на стол (TASK-106).
    for (const id of ids) {
      const t = sc.tokens.find((x) => x.id === id);
      if (st.self && hasPlayerHero(ctx, t)) { use[id] = null; continue; }
      const r = rollInitiative(ctx.c, t);
      use[id] = r.init; rolled.push({ tokenId: id, ...r });
    }
    const sid = ctx.sceneId;
    ctx.ui.setup = null;
    updateCampaign(ctx.cid, (c) => startCombat(c, c.scenes.find((s) => s.id === sid), ids, use));
    initiativeDice(ctx, rolled);
    ctx.select([]);
  }
  ctx.panels.refreshWidget(true);
}

// ——— Запрос спасброска ———
export function saveConfig(ctx, ids, { label = '', anchor = null } = {}) {
  const state = { ability: 'dex', dc: 13, damage: '', half: true };
  const names = ids.map((id) => ctx.scene.tokens.find((t) => t.id === id)).filter(Boolean).map((t) => tokenStats(ctx.c, t).name);
  const render = () => `${panelHeader('Спасбросок', `${names.length} ${plural(names.length, 'цель', 'цели', 'целей')}: ${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''}`)}
    <div class="panel-section">
      <div class="field"><label>Характеристика</label><div class="chips-wrap">${ABILITIES.map((a) => `<button class="chip chip-md ${state.ability === a.id ? 'chip-accent' : ''}" data-ab="${a.id}">${a.short}</button>`).join('')}</div></div>
      <div class="form-grid"><div class="field"><label for="sv-dc">Сложность</label><div class="input"><input id="sv-dc" type="number" min="1" max="30" value="${state.dc}"></div></div><div class="field"><label for="sv-dmg">Урон, если есть</label><div class="input"><input id="sv-dmg" value="${esc(state.damage)}" placeholder="8d6"></div></div></div>
      <div class="field"><label for="sv-label">Что это</label><div class="input"><input id="sv-label" value="${esc(label)}" placeholder="Огненный шар"></div></div>
      <label class="check t-sm"><input type="checkbox" data-half ${state.half ? 'checked' : ''}>Половина урона при успехе</label>
    </div>
    <div class="panel-footer"><span class="t-xs tertiary grow">За существ бросим сразу, игроки бросят сами</span><button class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary" data-ok>${icon('dice-faces-06', 16)}Запросить</button></div>`;
  const m = modal(render());
  m.box.addEventListener('click', (e) => {
    const a = e.target.closest('[data-ab]');
    if (a) { state.dc = Number(m.box.querySelector('#sv-dc').value) || state.dc; state.damage = m.box.querySelector('#sv-dmg').value; label = m.box.querySelector('#sv-label').value; state.half = m.box.querySelector('[data-half]').checked; state.ability = a.dataset.ab; m.set(render()); return; }
    if (e.target.closest('[data-ok]')) {
      const dc = Math.max(1, Math.min(30, Number(m.box.querySelector('#sv-dc').value) || 13));
      const damage = m.box.querySelector('#sv-dmg').value.trim();
      ctx.panels.requestSaves({ ability: state.ability, dc, damage, half: m.box.querySelector('[data-half]').checked, label: m.box.querySelector('#sv-label').value.trim() || 'Спасбросок', tokenIds: ids });
      m.close();
    }
  });
  return { anchor };
}

// ——— Инициатива вручную ———
export function initEdit(ctx, tokenId, anchor) {
  const e0 = ctx.c.combat.entries.find((x) => x.tokenId === tokenId);
  if (!e0) return;
  const pop = popover(`<div class="pick-pop"><div class="panel-section"><div class="label">Инициатива</div><div class="row"><div class="input" style="width:88px"><input type="number" data-v value="${e0.init ?? ''}" min="-5" max="40" autofocus></div><button class="btn btn-primary" data-ok>Готово</button></div></div></div>`, anchor, { placement: 'right' });
  const inp = pop.node.querySelector('[data-v]');
  setTimeout(() => { inp.focus(); inp.select(); }, 20);
  const ok = () => { const v = Number(inp.value); if (Number.isFinite(v)) ctx.panels.setInitiative(tokenId, v); closePopover(); };
  pop.node.querySelector('[data-ok]').addEventListener('click', ok);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
}

export { getDB, replaceDB };
