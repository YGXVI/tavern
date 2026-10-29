// Экраны вне стола: вход (имитация Discord), кампании, приглашение, ожидание, выбор героя.
import { html, raw, esc, el, plural, $ } from '../core/dom.js';
import { icon } from '../icons.js';
import { getDB, commit, onlineUsers } from '../core/store.js';
import { currentUser, signIn, signOut } from '../core/auth.js';
import { srcOf, BUILTIN_MAP_LIST, storeImage } from '../core/assets.js';
import { campaignsFor, membership, roleIn, userById, characterOf } from '../core/campaign.js';
import { modal, panelHeader, toast, userAvatar, portrait, menu, confirmDialog } from '../ui/kit.js';
import { newCampaign, makeCharacter, DEMO_USERS, seedDB } from '../data/demo.js';
import { CLASSES, RACES, classById, raceById } from '../data/rules.js';
import { replaceDB } from '../core/store.js';
import { freeSpots } from '../rules/geometry.js';

export const go = (path) => {
  if (location.hash === path) dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = path;
};

const d20 = raw(`<svg class="d20" viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="dg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3e8d2"/><stop offset=".55" stop-color="#d9c49c"/><stop offset="1" stop-color="#9a7f55"/></linearGradient></defs><path d="M50 4 90 27v46L50 96 10 73V27z" fill="url(#dg)"/><path d="M50 4 72 46H28zM28 46 50 96 72 46M10 27l18 19M90 27 72 46M10 73l18-27M90 73 72 46" fill="none" stroke="#9a7f55" stroke-width="1.5" opacity=".8"/><path d="M28 46h44L50 82z" fill="#f3e8d2" opacity=".55"/><text x="50" y="64" text-anchor="middle" font-family="Unbounded, sans-serif" font-weight="600" font-size="20" fill="#2b1e15">20</text></svg>`);

function logoButton(cls = '') { return raw(`<span class="logo-btn ${cls}"><img src="assets/logo.webp" alt=""></span>`); }

function partyStrip(ids = ['elian', 'mira', 'lira', 'torin', 'garr'], names = ['Элиан', 'Мира', 'Лира', 'Торин', 'Гарр'], me = 'lira') {
  return raw(ids.map((id, i) => `<div class="ptoken ${id === me ? 'me' : ''}"><div class="ring"><img src="${srcOf(id)}" alt=""></div><span class="np">${esc(names[i])}</span></div>`).join(''));
}

// ——— Вход ———
export function mountLogin(root, { onSignedIn }) {
  root.innerHTML = String(html`<div class="screen login-screen">
    <div class="backdrop" style="background-image:url(${srcOf('map:crypt')})"></div>
    <div class="center-stage">
      <div class="login-hero">
        <div class="login-party">${partyStrip()}</div>
        <div class="login-card">
          ${logoButton()}
          <h1>Распутье</h1>
          <p class="sub">Стол для D&amp;D 5e (2014): карта, листы героев и кубы в одной вкладке</p>
          <button class="btn btn-lg btn-discord btn-block" data-login>${raw(icon('discord', 20))}Войти через Discord</button>
          <p class="fineprint">Возьмём только ник и аватар. Пароли не нужны.</p>
        </div>
      </div>
    </div>
    <span class="chip corner-chip">D&amp;D 5e · 2014</span>
  </div>`);
  root.querySelector('[data-login]').addEventListener('click', () => openOAuth(onSignedIn));
  return {};
}

/** Окно, похожее на экран разрешений Discord. Это имитация — см. docs/features/auth.md. */
export function openOAuth(onDone, { hint } = {}) {
  const users = Object.values(getDB().users);
  const demo = DEMO_USERS.map((u) => users.find((x) => x.id === u.id)).filter(Boolean);
  const extra = users.filter((u) => !DEMO_USERS.some((d) => d.id === u.id)).slice(-3);
  let pick = (hint && users.find((u) => u.id === hint)?.id) || 'u-sol';
  const accounts = [...demo, ...extra];
  const body = el(`<div class="oauth" role="document">
    <div class="oauth-top"><span class="app"><img src="assets/logo.webp" alt=""></span><span class="dots">• • •</span><span class="me">${icon('discord', 34)}</span></div>
    <h3>Распутье хочет получить доступ к вашему аккаунту Discord</h3>
    <div class="who">Выберите аккаунт для входа</div>
    <div class="sect">
      <div class="accounts">${accounts.map((u) => `<button class="acc" data-u="${esc(u.id)}" aria-pressed="${u.id === pick}">${userAvatar(u, '')}<span>${esc(u.name)}</span><small>@${esc(u.handle || u.name)}</small></button>`).join('')}</div>
      <div class="custom"><input data-nick placeholder="Или другой ник…" maxlength="32"></div>
      <div class="label">Это позволит «Распутью»</div>
      <div class="scope">${icon('tick-02', 18)}Узнать ваш ник и аватар</div>
      <div class="scope">${icon('tick-02', 18)}Ничего не публиковать от вашего имени</div>
    </div>
    <div class="demo-note">Демо-режим: это имитация входа без настоящего Discord. Подключим позже — данные остаются в этом браузере.</div>
    <div class="oauth-foot"><button class="btn cancel" data-close>Отмена</button><button class="btn ok" data-ok>Авторизовать</button></div>
  </div>`);
  const m = modal(body, { className: 'oauth-modal' });
  m.box.classList.remove('panel'); m.box.style.background = 'none'; m.box.style.boxShadow = 'none';
  const nick = body.querySelector('[data-nick]');
  body.querySelector('.accounts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-u]'); if (!b) return;
    pick = b.dataset.u; nick.value = '';
    body.querySelectorAll('[data-u]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });
  nick.addEventListener('input', () => body.querySelectorAll('[data-u]').forEach((x) => x.setAttribute('aria-pressed', String(!nick.value && x.dataset.u === pick))));
  const ok = () => {
    const id = nick.value.trim() ? signIn({ name: nick.value }) : signIn({ userId: pick });
    m.close();
    onDone?.(id);
  };
  body.querySelector('[data-ok]').addEventListener('click', ok);
  nick.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
}

// ——— Шапка ———
function appHeader(user) {
  return html`<header class="app-header">
    <a class="brand" href="#/campaigns">${logoButton()}<span>Распутье</span></a>
    <span class="spacer"></span>
    <button class="user-pill" data-user>${userAvatar(user, 'sm')}<span class="who"><b>${user.name}</b><small>через Discord · демо</small></span>${raw(icon('logout-01', 18))}</button>
  </header>`;
}

function bindHeader(root, user) {
  root.querySelector('[data-user]')?.addEventListener('click', (e) => {
    menu([
      { icon: 'user', label: `${user.name} · @${user.handle || user.name}`, disabled: true },
      { icon: 'reload', label: 'Сменить аккаунт', onClick: () => openOAuth(() => { location.hash = '#/campaigns'; dispatchEvent(new HashChangeEvent('hashchange')); }) },
      { icon: 'delete-02', label: 'Сбросить демо-данные', onClick: resetDemo },
      'divider',
      { icon: 'logout-01', label: 'Выйти', danger: true, onClick: () => { signOut(); go('#/login'); } },
    ], e.currentTarget, { placement: 'bottom' });
  });
}

export async function resetDemo() {
  const ok = await confirmDialog({ title: 'Сбросить демо?', body: 'Все кампании, сцены и изменения в этом браузере вернутся к исходному примеру. Загруженные карты останутся в хранилище браузера, но пропадут из кампаний.', ok: 'Сбросить', danger: true });
  if (!ok) return;
  replaceDB(seedDB());
  toast({ title: 'Демо сброшено', icon: 'reload' });
  go('#/campaigns');
}

// ——— Кампании ———
export function mountCampaigns(root) {
  let filter = 'all';
  const render = () => {
    const user = currentUser();
    const list = campaignsFor(user.id);
    const mine = list.filter((c) => roleIn(c, user.id) === 'master').length;
    const play = list.filter((c) => membership(c, user.id)?.role === 'player').length;
    const shown = list.filter((c) => filter === 'all' || (filter === 'master' ? roleIn(c, user.id) === 'master' : membership(c, user.id)?.role === 'player'));
    root.innerHTML = String(html`<div class="screen">${appHeader(user)}
      <main class="page">
        ${list.length ? html`
          <div class="title-row">
            <h2>Кампании</h2>
            <button class="chip chip-md" data-f="all" aria-pressed="${filter === 'all'}">Все · ${list.length}</button>
            <button class="chip chip-md" data-f="master" aria-pressed="${filter === 'master'}">Веду · ${mine}</button>
            <button class="chip chip-md" data-f="player" aria-pressed="${filter === 'player'}">Играю · ${play}</button>
            <span class="spacer"></span>
            <button class="btn btn-secondary" data-paste>${raw(icon('link-01', 18))}Вставить приглашение</button>
            <button class="btn btn-primary" data-new>${raw(icon('plus-sign', 18))}Новая кампания</button>
          </div>
          <div class="cards">${shown.map((c) => campaignCard(c, user))}${filter !== 'player' ? html`<button class="new-card" data-new>${raw(icon('plus-sign', 24))}<span>Новая кампания</span></button>` : ''}</div>`
        : html`<div class="empty-hero">${d20}<h2>Пока ни одной кампании</h2><p>Создайте свою и позовите друзей ссылкой —<br>или попросите ссылку у мастера, если вас позвали играть.</p>
            <div class="row"><button class="btn btn-primary btn-lg" data-new>${raw(icon('plus-sign', 18))}Создать кампанию</button><button class="btn btn-secondary btn-lg" data-paste>${raw(icon('link-01', 18))}У меня есть ссылка</button></div></div>`}
      </main></div>`);
    bindHeader(root, user);
    root.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; render(); }));
    root.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => newCampaignModal(user)));
    root.querySelectorAll('[data-paste]').forEach((b) => b.addEventListener('click', pasteInvite));
    root.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => go(`#/c/${b.dataset.open}`)));
  };
  render();
  return { update: render };
}

function campaignCard(c, user) {
  const m = membership(c, user.id);
  const isMaster = m?.role === 'master';
  const master = userById(c.members.find((x) => x.role === 'master')?.userId);
  const online = onlineUsers(c.id);
  online.delete(user.id);
  const live = online.size > 0;
  const heroes = c.characters.slice(0, 4);
  const myChar = m?.characterId ? characterOf(c, m.characterId) : null;
  const meta = isMaster
    ? `${c.characters.length} ${plural(c.characters.length, 'герой', 'героя', 'героев')} · ${c.scenes.length} ${plural(c.scenes.length, 'сцена', 'сцены', 'сцен')}${c.status === 'draft' ? ' · черновик' : ''}`
    : m?.status === 'pending' ? `Ведёт ${master?.name || '—'} · ждёт одобрения` : `Ведёт ${master?.name || '—'}${myChar ? ` · вы играете ${myChar.name}` : ''}`;
  return html`<button class="camp-card ${live ? 'live' : ''}" data-open="${c.id}">
    <div class="cover" style="background-image:url(${srcOf(c.cover)})"><div class="chips"><span class="chip">${isMaster ? 'Мастер' : 'Игрок'}</span>${live ? html`<span class="chip live"><i class="dot"></i>Сессия идёт</span>` : ''}</div></div>
    <div class="body"><div class="name">${c.name}</div><div class="meta">${meta}</div></div>
    <div class="footer"><span class="avatar-stack">${heroes.map((h) => portrait(h.portrait, 'sm hero', h.name))}</span><span class="btn btn-sm ${live && !isMaster ? 'btn-primary' : 'btn-secondary'}">${isMaster ? 'Открыть' : 'Войти'}</span></div>
  </button>`;
}

function pasteInvite() {
  const m = modal(html`${panelHeader('Вставить приглашение', 'Ссылка или код от мастера')}
    <div class="panel-section"><div class="input">${raw(icon('link-01', 18))}<input data-v placeholder="rasputye.vercel.app/#/join/RSP-7Q2K или RSP-7Q2K" autofocus></div><p class="t-sm tertiary">Для проверки: код демо-кампании — RSP-7Q2K</p></div>
    <div class="panel-footer"><span class="spacer"></span><button class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary" data-ok>Открыть</button></div>`);
  const submit = () => {
    const v = m.box.querySelector('[data-v]').value.trim();
    const code = (v.match(/RSP-[A-Z0-9]{4}/i) || [])[0];
    if (!code) { m.box.querySelector('.input').classList.add('error'); return; }
    m.close(); go(`#/join/${code.toUpperCase()}`);
  };
  m.box.querySelector('[data-ok]').addEventListener('click', submit);
  m.box.querySelector('[data-v]').addEventListener('keydown', (e) => e.key === 'Enter' && submit());
}

export function newCampaignModal(user) {
  let cover = 'map:crypt';
  const covers = () => BUILTIN_MAP_LIST.map((mp) => html`<button class="cover-opt" data-cover="${mp.id}" aria-pressed="${cover === mp.id}" style="background-image:url(${srcOf(mp.id)})" aria-label="${mp.name}"></button>`);
  const m = modal(html`${panelHeader('Новая кампания', 'D&D 5e · редакция 2014')}
    <div class="panel-section">
      <div class="field"><label>Обложка</label><div class="covers" data-covers>${covers()}<label class="cover-opt upload">${raw(icon('upload-01', 18))}Своя<input type="file" accept="image/*" hidden data-upload></label></div></div>
      <div class="field"><label for="cn">Название</label><div class="input"><input id="cn" data-name maxlength="60" placeholder="Например, Склеп культа" autofocus></div></div>
      <div class="field"><label for="cd">Описание — увидят игроки по ссылке</label><div class="input"><input id="cd" data-desc maxlength="160" placeholder="Пара строк о завязке"></div></div>
      <div class="form-grid">
        <div class="field"><label>Уровень героев</label><div class="input"><input type="number" data-level min="1" max="20" value="1"><span class="suffix">ур.</span></div></div>
        <div class="field"><label>Мест за столом</label><div class="input"><input type="number" data-seats min="1" max="12" value="5"><span class="suffix">игроков</span></div></div>
      </div>
    </div>
    <hr class="panel-divider"><div class="panel-footer"><span class="spacer"></span><button class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary" data-ok>${raw(icon('tick-02', 18))}Создать кампанию</button></div>`);
  const box = m.box;
  box.querySelector('[data-covers]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cover]'); if (!b) return;
    cover = b.dataset.cover;
    box.querySelectorAll('[data-cover]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.cover === cover)));
  });
  box.querySelector('[data-upload]').addEventListener('change', async (e) => {
    try {
      const { ref } = await storeImage(e.target.files[0]);
      cover = ref;
      const opt = el(`<button class="cover-opt" data-cover="${ref}" aria-pressed="true" style="background-image:url(${srcOf(ref)})"></button>`);
      box.querySelectorAll('[data-cover]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      box.querySelector('.cover-opt.upload').before(opt);
    } catch (err) { toast({ title: 'Не получилось загрузить', body: err.message, icon: 'alert-circle' }); }
  });
  box.querySelector('[data-ok]').addEventListener('click', () => {
    const name = box.querySelector('[data-name]').value.trim();
    if (!name) { box.querySelector('[data-name]').closest('.input').classList.add('error'); box.querySelector('[data-name]').focus(); return; }
    const c = newCampaign({
      name, description: box.querySelector('[data-desc]').value.trim(), cover,
      level: Math.min(20, Math.max(1, Number(box.querySelector('[data-level]').value) || 1)),
      seats: Math.min(12, Math.max(1, Number(box.querySelector('[data-seats]').value) || 5)),
      ownerId: user.id,
    });
    commit((db) => { db.campaigns[c.id] = c; });
    m.close();
    go(`#/c/${c.id}`);
  });
}

// ——— Приглашение ———
export function findByCode(code) {
  return Object.values(getDB().campaigns).find((c) => c.invite?.code?.toUpperCase() === String(code).toUpperCase()) || null;
}

export function mountJoin(root, code, { onSignedIn }) {
  const render = () => {
    const c = findByCode(code);
    const user = currentUser();
    if (!c || (c.invite.expiresAt && c.invite.expiresAt < Date.now()) || c.invite.revoked) {
      root.innerHTML = String(html`<div class="screen"><div class="backdrop" style="background-image:url(${srcOf('map:crypt')})"></div><div class="center-stage"><div class="panel wait-card">
        <div class="hourglass">${raw(icon('link-04', 28))}</div><h3>Приглашение недействительно</h3><p class="muted t-para">Ссылка устарела или мастер её заменил. Попросите новую.</p>
        <button class="btn btn-secondary" data-home>К кампаниям</button></div></div></div>`);
      root.querySelector('[data-home]').addEventListener('click', () => go(user ? '#/campaigns' : '#/login'));
      return;
    }
    const m = user ? membership(c, user.id) : null;
    if (m?.status === 'active') { go(`#/c/${c.id}`); return; }
    if (m?.status === 'pending') { mountWaiting(root, c, user); return; }
    const master = userById(c.members.find((x) => x.role === 'master')?.userId);
    const taken = c.members.filter((x) => x.role === 'player' && x.status === 'active').length;
    const heroes = c.characters.slice(0, 4);
    root.innerHTML = String(html`<div class="screen"><div class="backdrop" style="background-image:url(${srcOf(c.cover)})"></div><div class="center-stage">
      <div class="invite-card">
        <div class="cover" style="background-image:url(${srcOf(c.cover)})"></div>
        <div class="body">
          <span class="chip chip-accent" style="align-self:flex-start">Вас зовут в кампанию</span>
          <h3>${c.name}</h3>
          ${c.description ? html`<p class="muted t-para">${c.description}</p>` : ''}
          <div class="meta"><span class="avatar-stack">${heroes.map((h) => portrait(h.portrait, 'sm hero', h.name))}</span><span>Ведёт ${master?.name || '—'} · D&amp;D 5e 2014 · ${taken} из ${c.seats} мест</span></div>
          ${user
            ? html`<button class="btn btn-lg btn-primary btn-block" data-join style="margin-top:12px">Присоединиться как ${user.name}</button><button class="btn btn-ghost btn-sm" data-switch style="align-self:center">Это не я — сменить аккаунт</button>`
            : html`<button class="btn btn-lg btn-discord btn-block" data-join style="margin-top:12px">${raw(icon('discord', 20))}Войти через Discord и присоединиться</button>`}
          <p class="fineprint" style="text-align:center">Возьмём только ник и аватар. Мастер увидит заявку и пустит за стол.</p>
        </div>
      </div></div></div>`);
    const join = (uidv) => {
      const u = getDB().users[uidv];
      const cc = findByCode(code);
      const existing = membership(cc, uidv);
      if (existing?.status === 'active') { go(`#/c/${cc.id}`); return; }
      if (!existing) {
        commit((db) => {
          const camp = db.campaigns[cc.id];
          camp.members.push({ userId: uidv, role: 'player', status: camp.invite.manual ? 'pending' : 'active', characterId: null, joinedAt: Date.now() });
        });
      }
      onSignedIn?.(uidv);
      toast({ title: `Заявка от ${u.name} отправлена`, icon: 'hourglass' });
      render();
    };
    root.querySelector('[data-join]').addEventListener('click', () => (user ? join(user.id) : openOAuth((id) => join(id), { hint: 'u-nika' })));
    root.querySelector('[data-switch]')?.addEventListener('click', () => openOAuth((id) => join(id), { hint: 'u-nika' }));
  };
  render();
  return { update: render };
}

function mountWaiting(root, c, user) {
  const master = userById(c.members.find((x) => x.role === 'master')?.userId);
  root.innerHTML = String(html`<div class="screen"><div class="backdrop" style="background-image:url(${srcOf(c.cover)})"></div><div class="center-stage">
    <div class="panel wait-card">
      <div class="hourglass">${raw(icon('hourglass', 30))}</div>
      <h3>Заявка отправлена</h3>
      <p class="muted t-para">${master?.name || 'Мастер'} увидит её в уведомлениях и пустит вас в «${c.name}». Эту вкладку можно не закрывать — всё откроется само.</p>
      <div class="row">${userAvatar(user, '')}<span class="chip chip-accent">заявка отправлена</span></div>
      <p class="fineprint">Демо: откройте в соседней вкладке кампанию под мастером (sol0139) и нажмите «Принять».</p>
      <button class="btn btn-secondary" data-cancel>Отменить заявку</button>
    </div></div></div>`);
  root.querySelector('[data-cancel]').addEventListener('click', () => {
    commit((db) => { const cc = db.campaigns[c.id]; cc.members = cc.members.filter((m) => m.userId !== user.id); });
    go('#/campaigns');
  });
}

// ——— Выбор героя ———
export function mountHeroPick(root, c0) {
  let pick = null;
  const render = () => {
    const user = currentUser();
    const c = getDB().campaigns[c0.id];
    if (!c) { go('#/campaigns'); return; }
    const m = membership(c, user.id);
    if (!m || m.status !== 'active') { go(`#/join/${c.invite.code}`); return; }
    if (m.characterId) { go(`#/c/${c.id}`); return; }
    const takenBy = (ch) => {
      const mm = c.members.find((x) => x.characterId === ch.id && x.status === 'active');
      return mm ? userById(mm.userId) : null;
    };
    const free = c.characters.filter((ch) => !takenBy(ch));
    if (!pick && free[0]) pick = free[0].id;
    const chosen = c.characters.find((x) => x.id === pick);
    root.innerHTML = String(html`<div class="screen">${appHeader(user)}<main class="page">
      <h2>Кем вы сядете за стол?</h2>
      <p class="muted t-para" style="margin-top:8px">Мастер подготовил героев для «${c.name}». Выберите свободного или создайте своего — подробный лист можно заполнить позже.</p>
      <div class="heroes">
        ${c.characters.map((ch) => {
          const owner = takenBy(ch);
          return html`<button class="hero-card" data-h="${ch.id}" aria-pressed="${pick === ch.id}" ${owner ? 'disabled' : ''}>
            <div class="portrait" style="background-image:url(${srcOf(ch.portrait)})">${pick === ch.id ? html`<span class="status-badge accent">${raw(icon('tick-02', 13))}</span>` : ''}</div>
            <div class="body"><div class="name">${ch.name}</div><div class="class">${ch.className} · ${ch.level} ур.</div>
            <div class="stats"><span class="chip">ХП ${ch.hpMax}</span><span class="chip">КД ${ch.ac}</span></div>
            <span class="chip ${owner ? '' : 'chip-success'}" style="align-self:flex-start">${owner ? `Играет ${owner.name}` : 'Свободен'}</span></div>
          </button>`;
        })}
        <button class="own-hero" data-own>${raw(icon('plus-sign', 28))}<b>Свой герой</b><span class="t-sm">Создать с нуля по шаблону класса</span></button>
      </div>
      <button class="btn btn-primary btn-lg" data-sit ${chosen ? '' : 'disabled'}>${raw(icon('chess-pawn', 20))}${chosen ? `Сесть за стол как ${chosen.name}` : 'Выберите героя'}</button>
    </main></div>`);
    bindHeader(root, user);
    root.querySelectorAll('[data-h]').forEach((b) => b.addEventListener('click', () => { pick = b.dataset.h; render(); }));
    root.querySelector('[data-own]').addEventListener('click', () => ownHeroModal(c, user));
    root.querySelector('[data-sit]').addEventListener('click', () => {
      if (!chosen) return;
      claim(c.id, user.id, chosen.id);
    });
  };
  render();
  return { update: render };
}

function claim(cid, userId, chId) {
  commit((db) => {
    const c = db.campaigns[cid];
    if (c.members.some((x) => x.characterId === chId && x.status === 'active' && x.userId !== userId)) return;
    const m = c.members.find((x) => x.userId === userId);
    m.characterId = chId;
    const ch = c.characters.find((x) => x.id === chId);
    ch.ownerId = userId;
    // Герой сразу встаёт на сцену, которую видят игроки, — рядом с отрядом или в центре карты.
    const sc = c.scenes.find((s) => s.id === c.activeSceneId);
    if (sc && !c.scenes.some((s) => s.tokens.some((t) => t.characterId === chId))) {
      const friend = sc.tokens.find((t) => t.kind === 'hero');
      const [p] = freeSpots(sc, friend || { x: sc.map.width / 2, y: sc.map.height / 2 }, 1, 1);
      sc.tokens.push({ id: `t-${crypto.randomUUID().slice(0, 8)}`, kind: 'hero', characterId: chId, name: ch.name, img: ch.portrait, size: 'medium', x: p.x, y: p.y, hidden: false, conditions: [], light: ch.light || null, aura: ch.aura || null });
    }
    c.log.unshift({ id: crypto.randomUUID(), at: Date.now(), userId, kind: 'join', text: `${db.users[userId].name} за столом — ${ch.name}` });
  });
  go(`#/c/${cid}`);
}

function ownHeroModal(c, user) {
  const m = modal(html`${panelHeader('Свой герой', 'Базовый шаблон — детали заполните в листе')}
    <div class="panel-section">
      <div class="field"><label>Имя</label><div class="input"><input data-n maxlength="40" placeholder="Как зовут героя" autofocus></div></div>
      <div class="form-grid">
        <div class="field"><label>Класс</label><div class="input"><select data-cl>${CLASSES.map((k) => html`<option value="${k.id}">${k.name}</option>`)}</select></div></div>
        <div class="field"><label>Раса</label><div class="input"><select data-r>${RACES.map((r) => html`<option value="${r.id}">${r.name}</option>`)}</select></div></div>
      </div>
    </div>
    <div class="panel-footer"><span class="spacer"></span><button class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary" data-ok>Создать и сесть</button></div>`);
  m.box.querySelector('[data-ok]').addEventListener('click', () => {
    const name = m.box.querySelector('[data-n]').value.trim() || user.name;
    const cl = classById(m.box.querySelector('[data-cl]').value);
    const race = raceById(m.box.querySelector('[data-r]').value);
    const level = c.level || 1;
    const conMod = 1;
    const hpMax = cl.hd + conMod + Math.max(0, level - 1) * (Math.floor(cl.hd / 2) + 1 + conMod);
    const ch = makeCharacter({ name, portrait: `ini:${name}`, classId: cl.id, className: cl.name, raceId: race.id, raceName: race.name, level, hd: cl.hd, saves: cl.saves, hpMax, hp: hpMax, ac: 12, speed: race.speed, darkvision: race.darkvision, stats: { str: 12, dex: 14, con: 13, int: 10, wis: 12, cha: 10 } });
    commit((db) => { db.campaigns[c.id].characters.push(ch); });
    m.close();
    claim(c.id, user.id, ch.id);
  });
}
