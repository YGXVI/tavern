// Вкладка «Обзор» дома кампании (#203): мастер — следующая сессия, отряд, заявки, приглашение, книга (60);
// игрок — свой герой, «в прошлый раз», отряд, раздатки (91).
import { html, raw, on, esc } from '../../core/dom.js';
import { userById, updateCampaign, addLog, characterOf, sceneOf } from '../../core/campaign.js';
import { joinUrl } from '../../server/config.js';
import { isServerMode } from '../../core/store.js';
import { modal, panelHeader, copyText, userAvatar, portrait } from '../../ui/kit.js';
import { mutateBook, sessionLive, fmtDate, ROMAN, heroOfUser, tzCity } from './book-store.js';
import { local, updateLocal } from './local.js';
import { encounters } from './encounters.js';
import { difficulty } from './encounter-math.js';
import { monsterById } from '../../data/bestiary.js';
import { ic, caps, cardHead, party, partyRow, levelsLine, slotsText, lastChapter, chapterName, chapterSummary, authorsOf, chapterDate, openHandout, handoutIcon } from './parts.js';
import { handoutsModal } from './handouts.js';

export function mountTab(ctx, body) {
  const offs = [];
  const L = (type, sel, fn) => offs.push(on(body, type, sel, fn));
  const render = () => { body.innerHTML = String(ctx.master ? master(ctx) : player(ctx)); };

  L('click', '[data-next]', () => editNext(ctx));
  L('click', '[data-intro]', () => editIntro(ctx));
  L('click', '[data-handouts]', () => handoutsModal(ctx));
  L('click', '[data-accept]', (e, b) => {
    const c = ctx.c; const players = c.members.filter((x) => x.role === 'player' && x.status === 'active').length;
    if (players >= c.seats) { ctx.toast({ title: 'Все места заняты', body: 'Добавьте мест в настройках кампании', icon: 'alert-circle' }); return; }
    updateCampaign(ctx.cid, (cc) => { const x = cc.members.find((q) => q.userId === b.dataset.accept); if (x) { x.status = 'active'; x.joinedAt = Date.now(); } addLog(cc, { kind: 'member', text: `${userById(b.dataset.accept)?.name || 'Игрок'} в кампании` }); });
  });
  L('click', '[data-decline]', (e, b) => updateCampaign(ctx.cid, (cc) => { cc.members = cc.members.filter((q) => q.userId !== b.dataset.decline || q.status !== 'pending'); }));
  L('click', '[data-copy-invite]', async () => {
    const ok = await copyText(joinUrl(ctx.c.invite?.code, isServerMode()));
    ctx.toast({ title: ok ? 'Ссылка скопирована' : 'Не удалось скопировать', icon: 'link-01' });
  });
  L('click', '[data-handout]', (e, b) => { const h = ctx.book().handouts.find((x) => x.id === b.dataset.handout); if (h) openHandout(h); });
  render();
  return { update: render, unmount() { for (const off of offs) off(); } };
}

// ——— Мастер ———
function prep(ctx) {
  const c = ctx.c, uid = ctx.user.id;
  const scene = sceneOf(c, c.activeSceneId) || c.scenes[0] || null;
  const encs = encounters(c.id, uid);
  const enc = encs.find((e) => scene && e.sceneId === scene.id && e.monsters.length) || encs.find((e) => e.monsters.length) || null;
  const sec = local('secret', c.id, uid);
  const drafts = (sec.handouts || []).filter((h) => !h.shown);
  const shown = ctx.book().handouts;
  const items = [];
  if (scene) {
    const walls = (scene.walls || []).filter((w) => w.kind !== 'door' && w.kind !== 'secret').length, doors = (scene.walls || []).filter((w) => w.kind === 'door' || w.kind === 'secret').length, lights = (scene.lights || []).length;
    const parts = [walls ? 'стены' : '', doors ? 'двери' : '', lights ? 'свет' : ''].filter(Boolean);
    items.push({ done: !!scene.map?.src, title: `Сцена «${scene.name}»`, sub: parts.length ? `${parts.join(', ').replace(/, ([^,]+)$/, ' и $1')} — на месте` : 'карта есть — стены и свет можно поставить на столе', href: ctx.href('scenes') });
  } else items.push({ done: false, title: 'Сцена', sub: 'ещё ни одной — загрузите карту', href: ctx.href('scenes') });
  if (enc) {
    const d = difficulty(c.characters.map((h) => h.level || 1), enc.monsters.map((m) => ({ cr: monsterById(m.id)?.cr, count: m.count })));
    items.push({ done: true, title: `Встреча «${enc.name}»`, sub: `${d.label} · ${d.count} ${d.count === 1 ? 'существо' : d.count < 5 ? 'существа' : 'существ'}${enc.opts?.hidden ? ', скрыты' : ''}`, href: ctx.href('encounters', enc.id) });
  } else items.push({ done: false, title: 'Встреча', sub: 'соберите из бестиария — сложность посчитаем', href: ctx.href('encounters') });
  const h = drafts[0] || shown[0];
  items.push(h ? { done: true, title: `Раздатка «${h.title}»`, sub: h.shown || shown.includes(h) ? 'уже у игроков' : 'откроете, когда придёт время', act: 'data-handouts' } : { done: false, title: 'Раздатка', sub: 'письмо, карта или записка для игроков', act: 'data-handouts' });
  items.push({ done: !!sec.intro?.trim(), title: 'Вступление — прочитать вслух', sub: sec.intro?.trim() ? `${sec.intro.trim().slice(0, 60)}${sec.intro.trim().length > 60 ? '…' : ''}` : 'пока пусто', act: 'data-intro' });
  return { scene, items };
}

function master(ctx) {
  const c = ctx.c, book = ctx.book();
  const { scene, items } = prep(ctx);
  const done = items.filter((i) => i.done).length;
  const live = sessionLive(book);
  const pending = c.members.filter((m) => m.status === 'pending');
  const last = [...book.chapters].reverse().find((ch) => ch.startedAt) || null;
  const pen = book.pen?.userId ? (heroOfUser(c, book.pen.userId)?.name || userById(book.pen.userId)?.name) : null;
  const inv = c.invite || {};
  const code = String(inv.code || '').replace(/^RSP-/, '');
  const city = tzCity();
  const item = (i) => html`<${i.href ? 'a' : 'button'} class="cp-check-row" ${raw(i.href ? `href="${esc(i.href)}"` : `${i.act}`)}><span class="cp-check ${i.done ? 'on' : ''}">${i.done ? ic('tick-02', 12) : ''}</span><span><b class="${i.done ? '' : 'muted'}">${i.title}</b><small>${i.sub}</small></span></${i.href ? 'a' : 'button'}>`;
  return html`<div class="cp-grid cp-grid-master">
    <section class="cp-card cp-next">
      ${cardHead(live ? 'Сессия идёт' : 'Следующая сессия', html`<span class="chip ${done === items.length ? 'chip-accent' : ''}">Готово ${done} из ${items.length}</span>`)}
      <button class="cp-date" data-next>${live ? `Глава ${ROMAN(book.session.n)} · с ${new Date(book.session.startedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : book.next?.at ? fmtDate(book.next.at, { weekday: true, time: true }).replace(/^./, (x) => x.toUpperCase()).replace(/, (\d\d:\d\d)$/, ' · $1') : 'Назначить дату'}${ic('edit-02', 16)}</button>
      ${book.next?.at && city ? html`<p class="t-xs tertiary cp-tz">по ${city}</p>` : ''}
      <div class="cp-checks">${items.map(item)}</div>
      <div class="row cp-next-actions">
        ${scene ? html`<a class="btn btn-primary btn-sm" href="#/c/${c.id}/do/start/${encodeURIComponent(scene.id)}">${ic('play')}${live ? `За стол — «${scene.name}»` : `Начать с «${scene.name}»`}</a>` : html`<a class="btn btn-primary btn-sm" href="#/c/${c.id}/do/new-scene">${ic('plus-sign')}Создать сцену</a>`}
        <button class="btn btn-ghost btn-sm" data-intro>${ic('note-edit')}${local('secret', c.id, ctx.user.id).intro ? 'Вступление' : 'Написать вступление'}</button>
      </div>
    </section>
    <div class="cp-col">
      <section class="cp-card">${cardHead('Отряд', html`<span class="t-xs tertiary">${levelsLine(c)}</span>`)}
        <div class="cp-party-list">${party(c).map((p) => partyRow(c, p, ctx.user.id))}${!c.characters.length ? html`<p class="t-sm muted">Героев пока нет — игроки соберут их, когда придут по ссылке.</p>` : ''}</div></section>
      ${pending.length ? html`<section class="cp-card">${cardHead(`Ждут одобрения · ${pending.length}`)}${pending.map((m) => { const u = userById(m.userId); return html`<div class="cp-pending">${userAvatar(u, 'sm')}<span><b>${u?.name || 'Игрок'}</b><small>хочет за стол</small></span><button class="icon-btn icon-btn-sm" data-decline="${m.userId}" data-tip="Отклонить" aria-label="Отклонить">${ic('cancel-01', 18)}</button><button class="icon-btn icon-btn-sm cp-yes" data-accept="${m.userId}" data-tip="Принять" aria-label="Принять">${ic('tick-02', 18)}</button></div>`; })}</section>` : ''}
    </div>
    <div class="cp-col">
      <section class="cp-card">${cardHead('Приглашение')}
        <div class="cp-code"><b>${code.replace(/^(.{4})(.+)$/, '$1 $2')}</b><button class="icon-btn icon-btn-sm" data-copy-invite data-tip="Скопировать ссылку" aria-label="Скопировать ссылку">${ic('copy-01', 18)}</button></div>
        <p class="t-xs tertiary">Ссылка ведёт сразу к выбору героя.${inv.manual ? ' Новых игроков вы одобряете сами.' : ' Игроки входят без одобрения.'}</p></section>
      <section class="cp-card">${cardHead('Книга кампании')}
        <p class="cp-book-line">${last ? `${chapterName(last)}${last.title ? '' : ''} ${last.endedAt ? (last.boundAt ? 'переплетена' : 'закрыта на столе') : 'пишется'}` : 'Книга пока пуста'}</p>
        <p class="t-xs tertiary">${pen ? `Летописец следующей сессии — ${pen}` : 'Летописец не выбран — передайте перо в книге'}</p>
        <a class="link-accent" href="${ctx.href('book')}">Открыть книгу ${ic('arrow-right-02', 14)}</a></section>
    </div>
  </div>`;
}

function editNext(ctx) {
  const book = ctx.book();
  const d = book.next?.at ? new Date(book.next.at) : (() => { const x = new Date(); x.setDate(x.getDate() + ((6 - x.getDay() + 7) % 7 || 7)); x.setHours(19, 0, 0, 0); return x; })();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const m = modal(html`${panelHeader('Следующая игра', 'Игроки увидят дату на обложке; до неё сохнут чернила главы')}
    <div class="panel-section"><div class="field"><label for="cp-when">Когда</label><div class="input"><input id="cp-when" type="datetime-local" value="${local}"></div></div><p class="t-xs tertiary">Время — по часам вашего устройства${tzCity() ? ` (${tzCity()})` : ''}. Игроки увидят его в своём часовом поясе.</p></div>
    <div class="panel-footer">${book.next?.at ? html`<button class="btn btn-ghost" data-clear>Снять дату</button>` : ''}<span class="spacer"></span><button class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary" data-ok>${ic('tick-02')}Сохранить</button></div>`);
  m.box.querySelector('[data-ok]').addEventListener('click', () => {
    const v = m.box.querySelector('#cp-when').value; if (!v) return;
    const at = new Date(v).getTime();
    mutateBook(ctx.cid, (b) => { b.next = { at }; const s = b.session; if (s?.endedAt) { const ch = b.chapters.find((x) => x.n === s.n); if (ch && !ch.boundAt && (!ch.inkUntil || ch.inkUntil > Date.now())) ch.inkUntil = at; } });
    m.close();
  });
  m.box.querySelector('[data-clear]')?.addEventListener('click', () => { mutateBook(ctx.cid, (b) => { b.next = null; }); m.close(); });
}

function editIntro(ctx) {
  const sec = local('secret', ctx.cid, ctx.user.id);
  const m = modal(html`${panelHeader('Вступление', 'Прочитаете вслух в начале сессии. Видите только вы — хранится на этом устройстве')}
    <div class="panel-section"><div class="input area cp-intro"><textarea rows="9" maxlength="4000" placeholder="Сырой воздух склепа пахнет воском…">${sec.intro || ''}</textarea></div></div>
    <div class="panel-footer"><span class="spacer"></span><button class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary" data-ok>${ic('tick-02')}Сохранить</button></div>`, { wide: true });
  m.box.querySelector('[data-ok]').addEventListener('click', () => { const v = m.box.querySelector('textarea').value; updateLocal('secret', ctx.cid, ctx.user.id, (s) => { s.intro = v; }); m.close(); });
}

// ——— Игрок ———
function player(ctx) {
  const c = ctx.c, book = ctx.book(), me = ctx.user.id;
  const hero = heroOfUser(c, me);
  const last = lastChapter(book);
  const ps = party(c);
  const online = ps.filter((p) => p.online).length;
  const withPlayers = ps.filter((p) => p.member).length;
  const threads = book.threads.slice(-4);
  // «Позже — напомню перед игрой»: обещанная версия главы, пока не высохли чернила.
  const later = local('mine', c.id, me).later;
  const owed = later ? book.chapters.find((ch) => ch.n === later && (!ch.inkUntil || ch.inkUntil > Date.now()) && !ch.entries.some((e) => e.userId === me)) : null;
  return html`<div class="cp-grid cp-grid-player">
    <section class="cp-card cp-hero">${cardHead('Ваш герой')}
      ${hero ? html`<div class="cp-hero-head">${portrait(hero.portrait, 'lg hero', hero.name)}<span><b>${hero.name}</b><small>${[hero.raceName, `${hero.className || ''} ${hero.level || ''}`.trim()].filter(Boolean).join(' · ')}</small></span></div>
        <div class="cp-stats"><div><small>Хиты</small><b>${hero.hp ?? '—'}/${hero.hpMax ?? '—'}</b></div><div><small>КД</small><b>${hero.ac ?? '—'}</b></div><div><small>Ячейки</small><b>${slotsText(hero)}</b></div></div>
        <div class="row"><a class="btn btn-secondary btn-sm" href="#/c/${c.id}/sheet/${encodeURIComponent(hero.id)}">Открыть лист</a><a class="btn btn-ghost btn-sm" href="${ctx.href('book', 'mine')}">${ic('book-open-01')}Книга героя</a></div>
        <p class="t-xs tertiary">${(hero.conditions || []).length ? `Сейчас: ${hero.conditions.map((x) => x.name || x).join(', ')}` : hero.hp < hero.hpMax ? `Ранен: не хватает ${hero.hpMax - hero.hp} хитов` : 'Цел и готов — всё восстановлено'}</p>`
    : html`<p class="t-sm muted">Героя ещё нет.</p><a class="btn btn-primary btn-sm" href="#/c/${c.id}">Выбрать героя</a>`}
    </section>
    <section class="cp-card cp-last">${cardHead('В прошлый раз', last ? html`<span class="t-xs tertiary">Глава ${ROMAN(last.n)}${chapterDate(last) ? ` · ${chapterDate(last)}` : ''}</span>` : '')}
      ${last ? html`<h2 class="cp-last-title">${chapterName(last)}</h2><p class="cp-last-text">${chapterSummary(last) || 'Глава закрыта — запишите свою версию, пока не высохли чернила.'}</p>
        ${authorsOf(c, last).length ? html`<div class="cp-authors"><span class="t-xs tertiary">Записали:</span>${authorsOf(c, last).map((a) => html`<span class="chip ${a.master ? 'chip-accent' : ''}">${a.name}</span>`)}</div>` : ''}`
    : html`<h2 class="cp-last-title">Книга пока пуста</h2><p class="cp-last-text">Первая глава появится после первой игры. Во время игры закладывайте ленточки — из них вырастет ваша версия.</p>`}
      ${threads.length ? html`${caps('Нити')}<div class="cp-threads">${threads.map((t) => html`<span class="cp-thread ${t.closed ? 'on' : ''}"><span class="cp-check ${t.closed ? 'on' : ''}">${t.closed ? ic('tick-02', 12) : ''}</span>${t.title}</span>`)}</div>` : ''}
      ${owed ? html`<div class="cp-owed">${ic('pencil-edit-02', 16)}<span>Вы собирались вписать свою версию главы ${ROMAN(owed.n)}${owed.inkUntil ? ` — чернила сохнут до ${fmtDate(owed.inkUntil, { time: true })}` : ''}.</span><a class="btn btn-primary btn-sm" href="${ctx.href('book', 'write')}">Вписать</a></div>` : ''}
      <a class="link-accent" href="${ctx.href('book')}">Открыть книгу кампании ${ic('arrow-right-02', 14)}</a>
    </section>
    <div class="cp-col">
      <section class="cp-card">${cardHead('Отряд', html`<span class="t-xs tertiary">${online} из ${withPlayers} онлайн</span>`)}<div class="cp-party-list">${ps.map((p) => partyRow(c, p, me, { hp: false }))}</div></section>
      <section class="cp-card">${cardHead('Раздатки от мастера')}
        ${book.handouts.length ? html`<div class="cp-handouts">${book.handouts.map((h) => html`<button class="cp-handout-row" data-handout="${h.id}">${ic(handoutIcon(h), 18)}<span>${h.title}</span>${ic('arrow-right-02', 16)}</button>`)}</div>` : html`<p class="t-sm muted">Пока ничего. Письма, карты и записки появятся здесь, когда мастер их покажет.</p>`}
      </section>
    </div>
  </div>`;
}
export { characterOf };
