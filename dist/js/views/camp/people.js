// Вкладки «Герои» (мастер), «Отряд» (игрок) и «Настройки» (мастер) дома кампании (#203).
import { html, raw, on, timeAgo } from '../../core/dom.js';
import { commit, isServerMode } from '../../core/store.js';
import { userById, updateCampaign, addLog, characterOf } from '../../core/campaign.js';
import { confirmDialog, menu, userAvatar, portrait } from '../../ui/kit.js';
import { go } from '../screens.js';
import { ic, paint, caps, party, heroSub } from './parts.js';

export function mountTab(ctx, body, tools, tab) {
  const offs = [];
  const L = (type, sel, fn) => offs.push(on(body, type, sel, fn));
  const render = () => { paint(body, tab === 'settings' ? settings(ctx) : heroes(ctx, tab === 'heroes')); };

  L('click', '[data-accept]', (e, b) => {
    const c = ctx.c; const players = c.members.filter((x) => x.role === 'player' && x.status === 'active').length;
    if (players >= c.seats) { ctx.toast({ title: 'Все места заняты', body: 'Добавьте мест в настройках', icon: 'alert-circle' }); return; }
    updateCampaign(ctx.cid, (cc) => { const x = cc.members.find((q) => q.userId === b.dataset.accept); if (x) { x.status = 'active'; x.joinedAt = Date.now(); } addLog(cc, { kind: 'member', text: `${userById(b.dataset.accept)?.name || 'Игрок'} в кампании` }); });
  });
  L('click', '[data-decline]', (e, b) => updateCampaign(ctx.cid, (cc) => { cc.members = cc.members.filter((q) => q.userId !== b.dataset.decline || q.status !== 'pending'); }));
  L('click', '[data-member]', (e, b) => memberMenu(ctx, b.dataset.member, b));
  // Настройки
  L('click', '[data-save-general]', () => {
    const v = (id) => body.querySelector(id).value;
    const name = v('#cs-name').trim(); if (!name) { body.querySelector('#cs-name').closest('.input').classList.add('error'); return; }
    updateCampaign(ctx.cid, (c) => { c.name = name; c.description = v('#cs-desc').trim(); c.level = Math.max(1, Math.min(20, Number(v('#cs-level')) || 1)); c.seats = Math.max(1, Math.min(12, Number(v('#cs-seats')) || 5)); });
    ctx.toast({ title: 'Сохранено', icon: 'tick-02' });
  });
  L('click', '[data-diag]', (e, b) => updateCampaign(ctx.cid, (c) => { c.settings.diagonal = b.dataset.diag; }));
  L('click', '[data-hpview]', (e, b) => updateCampaign(ctx.cid, (c) => { c.settings.playersSeeHp = b.dataset.hpview; }));
  L('change', '[data-set]', (e, inp) => updateCampaign(ctx.cid, (c) => { c.settings[inp.dataset.set] = inp.checked; }));
  L('change', '[data-manual]', (e, inp) => updateCampaign(ctx.cid, (c) => { c.invite = { ...c.invite, manual: inp.checked }; }));
  L('click', '[data-delete]', async () => {
    const c = ctx.c;
    if (!(await confirmDialog({ title: `Удалить «${c.name}»?`, body: 'Сцены, листы героев, книга и журнал исчезнут. Отменить нельзя.', ok: 'Удалить навсегда', danger: true }))) return;
    commit((db) => { delete db.campaigns[ctx.cid]; });
    go('#/campaigns');
  });
  render();
  return { update: render, unmount() { for (const off of offs) off(); } };
}

function heroes(ctx, masterView) {
  const c = ctx.c, me = ctx.user.id;
  const ps = party(c);
  const pending = c.members.filter((m) => m.status === 'pending');
  const free = c.members.filter((m) => m.role === 'player' && m.status === 'active' && !m.characterId);
  return html`<div class="cp-people">
    <div class="cp-heroes">${ps.map((p) => html`<article class="cp-hero-card ${p.online ? 'online' : ''}">
      <a class="cp-hero-art" href="#/hero/${c.id}~${encodeURIComponent(p.ch.id)}">${portrait(p.ch.portrait, 'xl hero', p.ch.name, p.member ? p.online : null)}</a>
      <div class="cp-hero-t"><b>${p.ch.name}</b><small>${[p.ch.raceName, heroSub(p.ch)].filter(Boolean).join(' · ')}</small>
        <div class="cp-hero-stats"><span><small>Хиты</small><b>${p.ch.hp ?? '—'}/${p.ch.hpMax ?? '—'}</b></span><span><small>КД</small><b>${p.ch.ac ?? '—'}</b></span><span><small>Скорость</small><b>${p.ch.speed ?? 30}</b></span></div>
        <p class="t-xs tertiary">${p.user ? `${p.user.name}${p.user.id === me ? ' — вы' : ''} · ${p.online ? 'за столом' : 'не в сети'}` : 'без игрока — свободен'}${(p.ch.conditions || []).length ? ` · ${p.ch.conditions.map((x) => x.name || x).join(', ')}` : ''}</p>
        <div class="row"><a class="btn btn-secondary btn-sm" href="#/hero/${c.id}~${encodeURIComponent(p.ch.id)}">${ic('book-open-01')}Лист</a>${masterView && p.member ? html`<button class="icon-btn icon-btn-sm" data-member="${p.member.userId}" aria-label="Действия">${ic('more-horizontal', 18)}</button>` : ''}</div></div>
    </article>`)}${!ps.length ? html`<div class="cp-empty">${ic('user-group', 28)}<h3>Героев пока нет</h3><p>Игроки соберут их, когда придут по ссылке-приглашению.</p></div>` : ''}</div>
    ${masterView && (pending.length || free.length) ? html`<aside class="cp-card cp-people-side">
      ${pending.length ? html`${caps(`Ждут одобрения · ${pending.length}`)}${pending.map((m) => { const u = userById(m.userId); return html`<div class="cp-pending">${userAvatar(u, 'sm')}<span><b>${u?.name || 'Игрок'}</b><small>заявка ${timeAgo(m.joinedAt)}</small></span><button class="icon-btn icon-btn-sm" data-decline="${m.userId}" aria-label="Отклонить">${ic('cancel-01', 18)}</button><button class="icon-btn icon-btn-sm cp-yes" data-accept="${m.userId}" aria-label="Принять">${ic('tick-02', 18)}</button></div>`; })}` : ''}
      ${free.length ? html`${caps('Выбирают героя')}${free.map((m) => { const u = userById(m.userId); return html`<div class="cp-pending">${userAvatar(u, 'sm')}<span><b>${u?.name || 'Игрок'}</b><small>ещё без героя</small></span><button class="icon-btn icon-btn-sm" data-member="${m.userId}" aria-label="Действия">${ic('more-horizontal', 18)}</button></div>`; })}` : ''}
    </aside>` : ''}
  </div>`;
}

function memberMenu(ctx, userId, anchor) {
  const c = ctx.c; const mm = c.members.find((x) => x.userId === userId); if (!mm) return;
  const u = userById(userId); const ch = characterOf(c, mm.characterId);
  menu([
    ch ? { icon: 'book-open-01', label: 'Открыть лист', href: `#/hero/${c.id}~${encodeURIComponent(ch.id)}` } : null,
    ch ? { icon: 'shuffle', label: 'Сменить героя', hint: 'игрок выберет заново', onClick: () => updateCampaign(ctx.cid, (cc) => { const a = cc.members.find((x) => x.userId === userId); const h = cc.characters.find((x) => x.id === a?.characterId); if (h) h.ownerId = null; if (a) a.characterId = null; addLog(cc, { kind: 'member', text: `${u?.name || 'Игрок'} выбирает другого героя` }); }) } : null,
    'divider',
    { icon: 'user-remove-01', label: 'Исключить из кампании', danger: true, onClick: async () => {
      if (!(await confirmDialog({ title: `Исключить ${u?.name || 'игрока'}?`, body: 'Он сразу потеряет доступ. Его герой останется у вас.', ok: 'Исключить', danger: true }))) return;
      updateCampaign(ctx.cid, (cc) => { const a = cc.members.find((x) => x.userId === userId); const h = a?.characterId && cc.characters.find((x) => x.id === a.characterId); if (h) h.ownerId = null; cc.members = cc.members.filter((x) => x.userId !== userId); addLog(cc, { kind: 'member', text: `${u?.name || 'Игрок'} исключён из кампании` }); });
    } },
  ].filter(Boolean), anchor, { placement: 'bottom' });
}

function settings(ctx) {
  const c = ctx.c, s = c.settings || {};
  const sw = (key, label, hint, value) => html`<label class="setting-row">${ic('settings-01', 18)}<span class="titles"><span class="label-main">${label}</span><span class="hint">${hint}</span></span><input type="checkbox" class="switch" data-set="${key}" ${value ? 'checked' : ''}></label>`;
  return html`<div class="cp-settings">
    <section class="cp-card">${caps('Общее')}
      <div class="field"><label for="cs-name">Название</label><div class="input"><input id="cs-name" maxlength="60" value="${c.name}"></div></div>
      <div class="field"><label for="cs-desc">Описание для игроков</label><div class="input area"><textarea id="cs-desc" rows="3" maxlength="400">${c.description || ''}</textarea></div></div>
      <div class="form-grid"><div class="field"><label for="cs-level">Уровень отряда</label><div class="input"><input id="cs-level" type="number" min="1" max="20" value="${c.level || 1}"></div></div><div class="field"><label for="cs-seats">Мест для игроков</label><div class="input"><input id="cs-seats" type="number" min="1" max="12" value="${c.seats || 5}"></div></div></div>
      <div class="row"><span class="spacer"></span><button class="btn btn-primary btn-sm" data-save-general>${ic('tick-02')}Сохранить</button></div>
    </section>
    <section class="cp-card">${caps('Правила стола')}
      <div class="field"><label>Диагонали</label><div class="chips-wrap"><button class="chip chip-md ${s.diagonal !== '5-10-5' ? 'chip-accent' : ''}" data-diag="5">Каждая 5 фт</button><button class="chip chip-md ${s.diagonal === '5-10-5' ? 'chip-accent' : ''}" data-diag="5-10-5">5 — 10 — 5 фт</button></div></div>
      ${sw('openMovement', 'Игроки двигают любые токены', 'Иначе — только своего героя', s.openMovement !== false)}
      ${sw('sharedVision', 'Общий обзор отряда', 'Игроки видят то, что видит любой герой', !!s.sharedVision)}
      <div class="field"><label>Хиты врагов для игроков</label><div class="chips-wrap">${[['status', 'Только состояние'], ['exact', 'Точные числа']].map(([v, l]) => html`<button class="chip chip-md ${s.playersSeeHp === v ? 'chip-accent' : ''}" data-hpview="${v}">${l}</button>`)}</div></div>
    </section>
    <section class="cp-card">${caps('Участники')}
      ${c.members.map((m) => { const u = userById(m.userId); const ch = characterOf(c, m.characterId); return html`<div class="list-row">${userAvatar(u, 'sm')}<span class="grow col-tight"><span class="primary">${u?.name || 'Игрок'}</span><span class="secondary">${m.role === 'master' ? 'Мастер' : m.status === 'pending' ? 'Ждёт одобрения' : ch ? `играет за ${ch.name}` : 'выбирает героя'}</span></span>${m.role === 'master' ? html`<span class="chip chip-accent">${ic('crown', 12)}мастер</span>` : html`<button class="icon-btn icon-btn-sm" data-member="${m.userId}" aria-label="Действия">${ic('more-horizontal', 18)}</button>`}</div>`; })}
      <label class="setting-row">${ic('shield-user', 18)}<span class="titles"><span class="label-main">Одобрять новых вручную</span><span class="hint">Пришедший по ссылке ждёт, пока вы его примете</span></span><input type="checkbox" class="switch" data-manual ${c.invite?.manual ? 'checked' : ''}></label>
    </section>
    <section class="cp-card cp-danger">${caps('Опасная зона')}<div class="row"><span class="t-sm muted grow">${isServerMode() ? 'Удалить кампанию со всеми сценами, листами и книгой — для всех участников, без возврата.' : 'Удалить кампанию со всеми сценами, листами и книгой — в этом браузере.'}</span><button class="btn btn-sm btn-danger" data-delete>${ic('delete-02', 14)}Удалить</button></div></section>
  </div>`;
}
export { raw };
