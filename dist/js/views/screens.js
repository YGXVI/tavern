// Экраны вне стола: вход (имитация Discord), кампании, приглашение, ожидание, выбор героя.
import { html, raw, esc, el, plural, $ } from '../core/dom.js';
import { icon } from '../icons.js';
import { getDB, commit, onlineUsers, isServerMode } from '../core/store.js';
import { serverAllowed, setMode, guestAllowed } from '../server/config.js';
import { currentUser, signIn, signOut } from '../core/auth.js';
import { srcOf, BUILTIN_MAP_LIST, storeImage } from '../core/assets.js';
import { campaignsFor, membership, roleIn, userById, characterOf } from '../core/campaign.js';
import { modal, panelHeader, toast, userAvatar, portrait, menu, confirmDialog } from '../ui/kit.js';
import { newCampaign, DEMO_USERS, seedDB } from '../data/demo.js';
import { replaceDB } from '../core/store.js';
import { heroAc } from '../rules/hero-derived.js';
import { freeSpots } from '../rules/geometry.js';
import { creaturesPage, bindCreatures } from './creatures.js';

/** Модуль синхронизации — уже загружен в серверном режиме, import вернёт его из кэша. */
const server = () => import('../server/sync.js');
const toSandbox = () => { setMode('sandbox'); location.hash = '#/login'; location.reload(); };
const toServer = () => { setMode('server'); location.reload(); };

export const go = (path) => {
  if (location.hash === path) dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = path;
};

const d20 = raw(`<svg class="d20" viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="dg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3e8d2"/><stop offset=".55" stop-color="#d9c49c"/><stop offset="1" stop-color="#9a7f55"/></linearGradient></defs><path d="M50 4 90 27v46L50 96 10 73V27z" fill="url(#dg)"/><path d="M50 4 72 46H28zM28 46 50 96 72 46M10 27l18 19M90 27 72 46M10 73l18-27M90 73 72 46" fill="none" stroke="#9a7f55" stroke-width="1.5" opacity=".8"/><path d="M28 46h44L50 82z" fill="#f3e8d2" opacity=".55"/><text x="50" y="64" text-anchor="middle" font-family="Unbounded, sans-serif" font-weight="600" font-size="20" fill="#2b1e15">20</text></svg>`);

export function logoButton(cls = '') { return raw(`<span class="logo-btn ${cls}"><img src="assets/logo.webp" alt=""></span>`); }

function partyStrip(ids = ['elian', 'mira', 'lira', 'torin', 'garr'], names = ['Элиан', 'Мира', 'Лира', 'Торин', 'Гарр'], me = 'lira') {
  return raw(ids.map((id, i) => `<div class="ptoken ${id === me ? 'me' : ''}"><div class="ring"><img src="${srcOf(id)}" alt=""></div><span class="np">${esc(names[i])}</span></div>`).join(''));
}

// ——— Вход гостем (#194, вариант А): ник без Discord, только по ссылке ?guest=1 и только на сервере ———
const guestBlock = () => html`<form class="guest-login" data-guest-form>
    <div class="guest-or"><span>или для тестовой партии</span></div>
    <div class="row"><div class="input grow">${raw(icon('user', 18))}<input data-guest-name maxlength="40" autocomplete="nickname" placeholder="Ник гостя" aria-label="Ник гостя"></div><button class="btn btn-secondary" type="submit" data-guest>Войти гостем</button></div>
    <p class="fineprint">Гостевой вход — только на время тестов, до публичного запуска его уберём.</p>
  </form>`;
function bindGuest(root, returnHash) {
  const f = root.querySelector('[data-guest-form]'); if (!f) return;
  const inp = f.querySelector('[data-guest-name]');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = f.querySelector('[data-guest]'); b.disabled = true;
    try { await (await server()).signInAsGuest(inp.value, returnHash); location.reload(); }
    catch (err) { b.disabled = false; inp.focus(); toast({ title: 'Не получилось войти гостем', body: err.message, icon: 'alert-circle' }); }
  });
}

// ——— Вход ———
export function mountLogin(root, { onSignedIn, message = null }) {
  const real = isServerMode();
  root.innerHTML = String(html`<div class="screen login-screen">
    <div class="backdrop" style="background-image:url(${srcOf('map:crypt')})"></div>
    <div class="center-stage">
      <div class="login-hero">
        <div class="login-party">${partyStrip()}</div>
        <div class="login-card">
          ${logoButton()}
          <h1>Drop Dice</h1>
          <p class="sub">Стол для D&amp;D 5e (2014): карта, листы героев и кубы в одной вкладке</p>
          ${message ? html`<p class="t-sm negative" role="alert">${message}</p>` : ''}
          <button class="btn btn-lg btn-discord btn-block" data-login>${raw(icon('discord', 20))}Войти через Discord</button>
          ${real && guestAllowed() ? guestBlock() : ''}
          ${real
            ? html`<button class="btn btn-ghost btn-block" data-sandbox>Попробовать без входа</button><p class="fineprint">Возьмём только ник и аватар. Пароли не нужны. Без входа — песочница: всё живёт только в этом браузере.</p>`
            : html`<p class="fineprint">Возьмём только ник и аватар. Пароли не нужны.</p>${serverAllowed() ? html`<button class="btn btn-ghost btn-sm" data-real style="align-self:center">Это песочница · войти по-настоящему</button>` : ''}`}
        </div>
      </div>
    </div>
    <span class="chip corner-chip">D&amp;D 5e · 2014</span>
  </div>`);
  root.querySelector('[data-login]').addEventListener('click', async (e) => {
    if (!real) { openOAuth(onSignedIn); return; }
    const b = e.currentTarget; b.disabled = true;
    try { await (await server()).signInWithDiscord(location.hash.startsWith('#/join/') ? location.hash : '#/campaigns'); }
    catch (err) { b.disabled = false; toast({ title: 'Не получилось открыть Discord', body: err.message, icon: 'alert-circle' }); }
  });
  root.querySelector('[data-sandbox]')?.addEventListener('click', toSandbox);
  root.querySelector('[data-real]')?.addEventListener('click', toServer);
  if (real) bindGuest(root, location.hash.startsWith('#/join/') ? location.hash : '#/campaigns');
  return {};
}

/** Сервер недоступен (спит, нет сети, CDN не загрузился): повторить или уйти в песочницу. */
export function mountServerDown(root, err) {
  root.innerHTML = String(html`<div class="screen"><div class="backdrop" style="background-image:url(${srcOf('map:crypt')})"></div><div class="center-stage"><div class="panel wait-card">
    <div class="hourglass">${raw(icon('cloud', 28))}</div><h3>Сервер не отвечает</h3>
    <p class="muted t-para">Бесплатный сервер засыпает после недели без игр, или пропала связь. Подождите минуту и попробуйте снова — либо играйте в песочнице этого браузера.</p>
    <p class="t-xs tertiary">${String(err?.message || err || '').slice(0, 140)}</p>
    <div class="row"><button class="btn btn-primary" data-retry>${raw(icon('reload', 16))}Попробовать снова</button><button class="btn btn-ghost" data-sandbox>Песочница</button></div>
  </div></div></div>`);
  root.querySelector('[data-retry]').addEventListener('click', () => location.reload());
  root.querySelector('[data-sandbox]').addEventListener('click', toSandbox);
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
    <h3>Drop Dice хочет получить доступ к вашему аккаунту Discord</h3>
    <div class="who">Выберите аккаунт для входа</div>
    <div class="sect">
      <div class="accounts">${accounts.map((u) => `<button class="acc" data-u="${esc(u.id)}" aria-pressed="${u.id === pick}">${userAvatar(u, '')}<span>${esc(u.name)}</span><small>@${esc(u.handle || u.name)}</small></button>`).join('')}</div>
      <div class="custom"><input data-nick placeholder="Или другой ник…" maxlength="32"></div>
      <div class="label">Это позволит Drop Dice</div>
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

// ——— Шапка ——— (экраны героя тоже берут её: views/hero/index.js)
/** Шапка экранов вне стола. active — раздел навигации: campaigns | heroes | workshop | ref (#203); false — без навигации. */
export function appHeader(user, active = null) {
  return html`<header class="app-header">
    <a class="brand" href="#/campaigns">${logoButton()}<span>Drop Dice</span></a>
    <span class="spacer"></span>
    ${active === false ? '' : appNav(user, active)}
    <button class="user-pill" data-user>${userAvatar(user, 'sm')}<span class="who"><b>${user.name}</b><small>${isServerMode() ? (user.provider === 'guest' ? 'гость · тестовая партия' : 'через Discord') : 'песочница · демо'}</small></span>${raw(icon('logout-01', 18))}</button>
  </header>`;
}

/** Навигация (#203): один ряд, одно место — один путь. Карты и свои существа живут в «Мастерской» — она видна тому, кто ведёт кампанию. */
export function appNav(user, active) {
  const leads = campaignsFor(user.id).some((c) => roleIn(c, user.id) === 'master');
  const tabs = [['campaigns', 'Кампании', '#/campaigns'], ['heroes', 'Герои', '#/heroes'], leads || active === 'workshop' ? ['workshop', 'Мастерская', '#/maps'] : null, ['ref', 'Справочник', '#/ref']].filter(Boolean);
  return html`<nav class="app-nav" aria-label="Разделы">${tabs.map(([id, label, href]) => html`<a href="${href}" ${active === id ? raw('aria-current="page"') : ''}>${label}</a>`)}</nav>`;
}

/** Заголовок «Мастерской»: крупные слова-вкладки «Карты · Существа» вместо второго ряда кнопок. */
export function workshopSwitch(active) {
  const a = (id, href, label) => html`<a href="${href}" ${active === id ? raw('aria-current="page"') : ''}>${label}</a>`;
  return html`<nav class="page-switch" aria-label="Мастерская">${a('maps', '#/maps', 'Карты')}${a('creatures', '#/creatures', 'Существа')}</nav>`;
}

export function bindHeader(root, user) {
  root.querySelector('[data-user]')?.addEventListener('click', (e) => {
    if (isServerMode()) {
      menu([
        { icon: 'user', label: `${user.name} · @${user.handle || user.name}`, disabled: true },
        'divider',
        { icon: 'logout-01', label: 'Выйти', danger: true, onClick: async () => { await (await server()).signOutServer(); location.hash = '#/login'; location.reload(); } },
      ], e.currentTarget, { placement: 'bottom' });
      return;
    }
    menu([
      serverAllowed() ? { icon: 'discord', label: 'Войти через Discord по-настоящему', onClick: toServer } : null,
      { icon: 'user', label: `${user.name} · @${user.handle || user.name}`, disabled: true },
      { icon: 'reload', label: 'Сменить аккаунт', onClick: () => openOAuth(() => { location.hash = '#/campaigns'; dispatchEvent(new HashChangeEvent('hashchange')); }) },
      { icon: 'delete-02', label: 'Сбросить демо-данные', onClick: resetDemo },
      'divider',
      { icon: 'logout-01', label: 'Выйти', danger: true, onClick: () => { signOut(); go('#/login'); } },
    ].filter(Boolean), e.currentTarget, { placement: 'bottom' });
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
/** Адреса #/characters (теперь ведёт на #/heroes) и #/creatures (TASK-175, «Мастерская · Существа») обрабатывает этот же экран. */
const homeTab = () => (/^#\/characters\b/.test(location.hash) ? 'characters' : /^#\/creatures\b/.test(location.hash) ? 'creatures' : 'campaigns');

export function mountCampaigns(root) {
  let filter = 'all';
  const render = () => {
    const user = currentUser();
    if (homeTab() === 'creatures') {
      const { tools, body } = creaturesPage(user);
      root.innerHTML = String(html`<div class="screen">${appHeader(user, 'workshop')}
        <main class="page page-wide lib-page"><div class="title-row page-head">${workshopSwitch('creatures')}${raw(tools)}</div>${raw(body)}</main></div>`);
      bindHeader(root, user);
      bindCreatures(root, user, render);
      return;
    }
    // Старый список героев (TASK-096) заменён экраном «Герои» (#/heroes, #203): старые ссылки ведут туда.
    if (homeTab() === 'characters') { location.replace('#/heroes'); return; }
    const list = campaignsFor(user.id);
    const mine = list.filter((c) => roleIn(c, user.id) === 'master').length;
    const play = list.filter((c) => membership(c, user.id)?.role === 'player').length;
    const shown = list.filter((c) => filter === 'all' || (filter === 'master' ? roleIn(c, user.id) === 'master' : membership(c, user.id)?.role === 'player'));
    root.innerHTML = String(html`<div class="screen">${appHeader(user, 'campaigns')}
      <main class="page page-wide">
        ${list.length ? html`
          <div class="title-row page-head">
            <h1>Кампании</h1>
            <button class="chip chip-md" data-f="all" aria-pressed="${filter === 'all'}">Все · ${list.length}</button>
            <button class="chip chip-md" data-f="master" aria-pressed="${filter === 'master'}">Веду · ${mine}</button>
            <button class="chip chip-md" data-f="player" aria-pressed="${filter === 'player'}">Играю · ${play}</button>
            <span class="spacer"></span>
            <button class="btn btn-secondary" data-paste>${raw(icon('link-01', 18))}Вставить приглашение</button>
            <button class="btn btn-primary" data-new>${raw(icon('plus-sign', 18))}Новая кампания</button>
          </div>
          <div class="cards">${shown.map((c) => campaignCard(c, user))}${filter !== 'player' ? html`<button class="new-card" data-new>${raw(icon('plus-sign', 24))}<span>Новая кампания</span></button>` : ''}</div>`
        : html`<div class="title-row page-head"><h1>Кампании</h1></div><div class="empty-hero">${d20}<h2>Пока ни одной кампании</h2><p>Создайте свою и позовите друзей ссылкой —<br>или попросите ссылку у мастера, если вас позвали играть.</p>
            <div class="row"><button class="btn btn-primary btn-lg" data-new>${raw(icon('plus-sign', 18))}Создать кампанию</button><button class="btn btn-secondary btn-lg" data-paste>${raw(icon('link-01', 18))}У меня есть ссылка</button></div></div>`}
      </main></div>`);
    bindHeader(root, user);
    root.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; render(); }));
    root.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => newCampaignModal(user)));
    root.querySelectorAll('[data-paste]').forEach((b) => b.addEventListener('click', pasteInvite));
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
  // Ссылка, а не кнопка: карточку можно открыть в новой вкладке (TASK-094).
  return html`<a class="camp-card ${live ? 'live' : ''}" href="${m?.status === 'active' && (isMaster || m.characterId) ? `#/camp/${c.id}` : `#/c/${c.id}`}">
    <div class="cover" style="background-image:url(${srcOf(c.cover)})"><div class="chips"><span class="chip">${isMaster ? 'Мастер' : 'Игрок'}</span>${live ? html`<span class="chip live"><i class="dot"></i>Сессия идёт</span>` : ''}</div></div>
    <div class="body"><div class="name">${c.name}</div><div class="meta">${meta}</div></div>
    <div class="footer"><span class="avatar-stack">${heroes.map((h) => portrait(h.portrait, 'sm hero', h.name))}</span><span class="btn btn-sm ${live && !isMaster ? 'btn-primary' : 'btn-secondary'}">${isMaster ? 'Открыть' : 'Войти'}</span></div>
  </a>`;
}

export function pasteInvite() {
  const m = modal(html`${panelHeader('Вставить приглашение', 'Ссылка или код от мастера')}
    <div class="panel-section"><div class="input">${raw(icon('link-01', 18))}<input data-v placeholder="rasputye.vercel.app/#/join/RSP-7Q2K или RSP-7Q2K" autofocus></div>${isServerMode() ? '' : html`<p class="t-sm tertiary">Для проверки: код демо-кампании — RSP-7Q2K</p>`}</div>
    <div class="panel-footer"><span class="spacer"></span><button class="btn btn-ghost" data-close>Отмена</button><button class="btn btn-primary" data-ok>Открыть</button></div>`);
  const submit = () => {
    const v = m.box.querySelector('[data-v]').value.trim();
    const code = (v.match(/RSP-[A-Z0-9]{4,8}/i) || [])[0];
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
  let coverFile = null; // серверный режим: файл обложки загрузим, когда кампания появится на сервере
  box.querySelector('[data-upload]').addEventListener('change', async (e) => {
    try {
      let ref;
      if (isServerMode()) {
        const f = e.target.files[0];
        if (!f || !/^image\//.test(f.type)) throw new Error('Нужна картинка: JPG, PNG или WebP.');
        if (f.size > 25 * 1024 * 1024) throw new Error('Файл больше 25 МБ.');
        coverFile = f; ref = URL.createObjectURL(f);
      } else ({ ref } = await storeImage(e.target.files[0]));
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
    if (coverFile) c.cover = 'map:crypt';
    commit((db) => { db.campaigns[c.id] = c; });
    m.close();
    go(`#/c/${c.id}`);
    if (coverFile) {
      server().then(async (sv) => {
        await sv.whenSynced(c.id);
        const ref = await sv.uploadImage(c.id, coverFile);
        commit((db) => { if (db.campaigns[c.id]) db.campaigns[c.id].cover = ref; });
      }).catch((err) => toast({ title: 'Обложка не загрузилась', body: err.message, icon: 'alert-circle' }));
    }
  });
}

// ——— Приглашение ———
export function findByCode(code) {
  return Object.values(getDB().campaigns).find((c) => c.invite?.code?.toUpperCase() === String(code).toUpperCase()) || null;
}

export function mountJoin(root, code, { onSignedIn }) {
  if (isServerMode()) return mountJoinServer(root, code);
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
          <p class="fineprint" style="text-align:center">${c.invite?.manual === false ? 'Возьмём только ник и аватар — и сразу за стол.' : 'Возьмём только ник и аватар. Мастер увидит заявку и пустит за стол.'}</p>
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
      const now = membership(findByCode(code), uidv);
      if (now?.status === 'active') { toast({ title: `${u.name}, вы в кампании`, icon: 'tick-02' }); go(`#/c/${cc.id}`); return; }
      toast({ title: `Заявка от ${u.name} отправлена`, icon: 'hourglass' });
      render();
    };
    root.querySelector('[data-join]').addEventListener('click', () => (user ? join(user.id) : openOAuth((id) => join(id), { hint: 'u-nika' })));
    root.querySelector('[data-switch]')?.addEventListener('click', () => openOAuth((id) => join(id), { hint: 'u-nika' }));
  };
  render();
  return { update: render };
}

/** Приглашение в серверную кампанию: карточку отдаёт функция invite_preview, вступление — join_campaign. */
function mountJoinServer(root, code) {
  let alive = true;
  const invalid = () => {
    root.innerHTML = String(html`<div class="screen"><div class="backdrop" style="background-image:url(${srcOf('map:crypt')})"></div><div class="center-stage"><div class="panel wait-card">
      <div class="hourglass">${raw(icon('link-04', 28))}</div><h3>Приглашение недействительно</h3><p class="muted t-para">Ссылка устарела или мастер её заменил. Попросите новую.</p>
      <button class="btn btn-secondary" data-home>К кампаниям</button></div></div></div>`);
    root.querySelector('[data-home]').addEventListener('click', () => go(currentUser() ? '#/campaigns' : '#/login'));
  };
  root.innerHTML = '<div class="screen boot-screen"><div class="center-stage"><div class="boot-spinner" aria-label="Загрузка"></div></div></div>';
  (async () => {
    const sv = await server();
    let p;
    try { p = await sv.rpc('invite_preview', { p_code: code }); } catch { p = null; }
    if (!alive) return;
    if (!p?.ok) { invalid(); return; }
    const user = currentUser();
    if (user && p.myStatus) { go(`#/c/${p.campaignId}`); return; }
    const cover = String(p.cover || '').startsWith('sb:') ? 'map:crypt' : p.cover || 'map:crypt';
    root.innerHTML = String(html`<div class="screen"><div class="backdrop" style="background-image:url(${srcOf(cover)})"></div><div class="center-stage">
      <div class="invite-card">
        <div class="cover" style="background-image:url(${srcOf(cover)})"></div>
        <div class="body">
          <span class="chip chip-accent" style="align-self:flex-start">Вас зовут в кампанию</span>
          <h3>${p.name}</h3>
          ${p.description ? html`<p class="muted t-para">${p.description}</p>` : ''}
          <div class="meta"><span class="avatar-stack">${(p.heroes || []).map((h) => portrait(h.portrait, 'sm hero', h.name))}</span><span>Ведёт ${p.master || '—'} · D&amp;D 5e 2014 · ${p.taken} из ${p.seats} мест</span></div>
          ${user
            ? html`<button class="btn btn-lg btn-primary btn-block" data-join style="margin-top:12px">Присоединиться как ${user.name}</button>`
            : html`<button class="btn btn-lg btn-discord btn-block" data-join style="margin-top:12px">${raw(icon('discord', 20))}Войти через Discord и присоединиться</button>`}
          ${!user && guestAllowed() ? guestBlock() : ''}
          <p class="fineprint" style="text-align:center">Возьмём только ник и аватар.${p.manual ? ' Мастер увидит заявку и пустит за стол.' : ''}</p>
        </div>
      </div></div></div>`);
    if (!user) bindGuest(root, `#/join/${code}`);
    root.querySelector('[data-join]').addEventListener('click', async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try {
        if (!currentUser()) { await sv.signInWithDiscord(`#/join/${code}`); return; }
        const r = await sv.rpc('join_campaign', { p_code: code });
        if (!r?.ok) {
          b.disabled = false;
          if (r?.error === 'full') toast({ title: 'Мест за столом нет', body: 'Попросите мастера освободить место', icon: 'user-group' });
          else invalid();
          return;
        }
        await sv.loadCampaign(r.campaignId);
        if (r.status === 'pending') toast({ title: 'Заявка отправлена', body: 'Мастер увидит её и пустит за стол', icon: 'hourglass' });
        go(`#/c/${r.campaignId}`);
      } catch (err) { b.disabled = false; toast({ title: 'Не получилось', body: err.message, icon: 'alert-circle' }); }
    });
  })();
  return { unmount() { alive = false; } };
}

export function mountWaiting(root, c, user) {
  const master = userById(c.members.find((x) => x.role === 'master')?.userId);
  root.innerHTML = String(html`<div class="screen"><div class="backdrop" style="background-image:url(${srcOf(c.cover)})"></div><div class="center-stage">
    <div class="panel wait-card">
      <div class="hourglass">${raw(icon('hourglass', 30))}</div>
      <h3>Заявка отправлена</h3>
      <p class="muted t-para">${master?.name || 'Мастер'} увидит её в уведомлениях и пустит вас в «${c.name}». Эту вкладку можно не закрывать — всё откроется само.</p>
      <div class="row">${userAvatar(user, '')}<span class="chip chip-accent">заявка отправлена</span></div>
      ${isServerMode() ? '' : html`<p class="fineprint">Демо: откройте в соседней вкладке кампанию под мастером (sol0139) и нажмите «Принять».</p>`}
      <button class="btn btn-secondary" data-cancel>Отменить заявку</button>
    </div></div></div>`);
  root.querySelector('[data-cancel]').addEventListener('click', async () => {
    if (isServerMode()) {
      try { await (await server()).leaveCampaign(c.id); } catch (err) { toast({ title: 'Не получилось', body: err.message, icon: 'alert-circle' }); return; }
      go('#/campaigns'); return;
    }
    commit((db) => { const cc = db.campaigns[c.id]; cc.members = cc.members.filter((m) => m.userId !== user.id); });
    go('#/campaigns');
  });
  return {};
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
      <p class="muted t-para" style="margin-top:8px">${c.characters?.some((x) => !x.archivedAt) ? `Мастер подготовил героев для «${c.name}». Выберите свободного или создайте своего — подробный лист можно заполнить позже.` : `Готовых героев в «${c.name}» пока нет: создайте своего — подробный лист можно заполнить позже.`}</p>
      <div class="heroes">
        ${c.characters.map((ch) => {
          const owner = takenBy(ch);
          return html`<button class="hero-card" data-h="${ch.id}" aria-pressed="${pick === ch.id}" ${owner ? 'disabled' : ''}>
            <div class="portrait" style="background-image:url(${srcOf(ch.portrait)})">${pick === ch.id ? html`<span class="status-badge accent">${raw(icon('tick-02', 13))}</span>` : ''}</div>
            <div class="body"><div class="name">${ch.name}</div><div class="class">${ch.className} · ${ch.level} ур.</div>
            <div class="stats"><span class="chip">ХП ${ch.hpMax}</span><span class="chip">КД ${heroAc(ch)}</span></div>
            <span class="chip ${owner ? '' : 'chip-success'}" style="align-self:flex-start">${owner ? `Играет ${owner.name}` : 'Свободен'}</span></div>
          </button>`;
        })}
        <button class="own-hero" data-own>${raw(icon('plus-sign', 28))}<b>Свой герой</b><span class="t-sm">Собрать пошагово по правилам кампании</span></button>
      </div>
      <button class="btn btn-primary btn-lg" data-sit ${chosen ? '' : 'disabled'}>${raw(icon('chess-pawn', 20))}${chosen ? `Сесть за стол как ${chosen.name}` : 'Выберите героя'}</button>
    </main></div>`);
    bindHeader(root, user);
    root.querySelectorAll('[data-h]').forEach((b) => b.addEventListener('click', () => { pick = b.dataset.h; render(); }));
    // «Свой герой» — мастер создания этой кампании (#203); после «Создать» игрок садится за стол новым героем.
    root.querySelector('[data-own]').addEventListener('click', () => go(`#/hero/new?c=${encodeURIComponent(c.id)}`));
    root.querySelector('[data-sit]').addEventListener('click', () => {
      if (!chosen) return;
      claim(c.id, user.id, chosen.id);
    });
  };
  render();
  return { update: render };
}

async function claimServer(cid, userId, chId) {
  const sv = await server();
  try {
    const r = await sv.rpc('claim_character', { p_campaign: cid, p_character: chId });
    if (!r?.ok) { toast({ title: 'Этого героя уже взяли', body: 'Выберите другого', icon: 'user-group' }); await sv.loadCampaign(cid); return; }
    // Тихо: стол откроется уже с токеном героя (commit ниже), без «Вашего героя пока нет на карте».
    await sv.loadCampaign(cid, { silent: true });
  } catch (err) { toast({ title: 'Не получилось сесть за стол', body: err.message, icon: 'alert-circle' }); return; }
  // Герой встаёт на сцену, которую видят игроки; членство и владелец уже записаны функцией сервера.
  commit((db) => {
    const c = db.campaigns[cid]; if (!c) return;
    const ch = c.characters.find((x) => x.id === chId); if (!ch) return;
    const sc = c.scenes.find((s) => s.id === c.activeSceneId);
    if (sc && !c.scenes.some((s) => s.tokens.some((t) => t.characterId === chId))) {
      const friend = sc.tokens.find((t) => t.kind === 'hero');
      const [p] = freeSpots(sc, friend || { x: sc.map.width / 2, y: sc.map.height / 2 }, 1, 1);
      sc.tokens.push({ id: `t-${crypto.randomUUID().slice(0, 8)}`, kind: 'hero', characterId: chId, name: ch.name, img: ch.portrait, size: 'medium', x: p.x, y: p.y, hidden: false, conditions: [], light: ch.light || null, aura: ch.aura || null });
    }
    c.log.unshift({ id: crypto.randomUUID(), at: Date.now(), userId, kind: 'join', text: `${db.users[userId]?.name || 'Игрок'} за столом — ${ch.name}` });
  });
  go(`#/c/${cid}`);
}

/** Новый герой из мастера создания (#203) садится за стол: токен — на сцену игроков, запись в журнал, открывается стол. */
export function seatHero(cid, userId, chId) {
  commit((db) => {
    const c = db.campaigns[cid]; if (!c) return;
    const ch = c.characters.find((x) => x.id === chId); if (!ch) return;
    const sc = c.scenes.find((s) => s.id === c.activeSceneId);
    if (sc && !c.scenes.some((s) => s.tokens.some((t) => t.characterId === chId))) {
      const friend = sc.tokens.find((t) => t.kind === 'hero');
      const [p] = freeSpots(sc, friend || { x: sc.map.width / 2, y: sc.map.height / 2 }, 1, 1);
      sc.tokens.push({ id: `t-${crypto.randomUUID().slice(0, 8)}`, kind: 'hero', characterId: chId, name: ch.name, img: ch.portrait, size: 'medium', x: p.x, y: p.y, hidden: false, conditions: [], light: ch.light || null, aura: ch.aura || null });
    }
    c.log.unshift({ id: crypto.randomUUID(), at: Date.now(), userId, kind: 'join', text: `${db.users[userId]?.name || 'Игрок'} за столом — ${ch.name}` });
  });
  go(`#/c/${cid}`);
}

/** Сесть за стол героем chId (выбор героя, перенос из LSS, «Привести в кампанию»): членство, токен, стол. */
export function claim(cid, userId, chId) {
  if (isServerMode()) { claimServer(cid, userId, chId); return; }
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

