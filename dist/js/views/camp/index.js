// Дом кампании (#203, макеты 60–63, 91): обложка, вкладки мастера и игрока, книга кампании.
// Адрес: #/camp/<кампания>[/<вкладка>[/…]]. Стол остаётся на #/c/<кампания>.
import { html, raw, on, plural } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { srcOf, resolveSrc } from '../../core/assets.js';
import { subscribe, onlineUsers, bus } from '../../core/store.js';
import { currentUser } from '../../core/auth.js';
import { getCampaign, membership, isMasterOf, userById } from '../../core/campaign.js';
import { toast } from '../../ui/kit.js';
import { appHeader, bindHeader, go } from '../screens.js';
import { readBook, foldInbox, startSession, sessionLive, fmtDate, fmtTime, tzCity, heroOfUser } from './book-store.js';
import { onLocal } from './local.js';
import { bindPaletteKeys } from '../ref/palette.js';

const ic = (n, s = 16) => raw(icon(n, s));
const MASTER_TABS = [['overview', 'Обзор'], ['scenes', 'Сцены'], ['encounters', 'Встречи'], ['heroes', 'Герои'], ['book', 'Книга кампании'], ['settings', 'Настройки']];
const PLAYER_TABS = [['overview', 'Обзор'], ['book', 'Книга кампании'], ['party', 'Отряд'], ['handouts', 'Раздатки']];
const BIG_COVER = new Set(['overview', 'book', 'party', 'handouts']);

/** Модули вкладок грузятся по требованию. */
const TAB = {
  overview: () => import('./overview.js'), scenes: () => import('./scenes.js'), encounters: () => import('./encounters-view.js'),
  heroes: () => import('./people.js'), party: () => import('./people.js'), settings: () => import('./people.js'),
  handouts: () => import('./handouts.js'), book: () => import('./book.js'),
};

export function parseCamp(hash) {
  const parts = String(hash || '').replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  return { cid: parts[1], tab: parts[2] || 'overview', rest: parts.slice(3).map(decodeURIComponent) };
}

/** Кто за столом прямо сейчас (без меня). */
export function atTable(c, userId) {
  const on = onlineUsers(c.id); on.delete(userId);
  return c.members.filter((m) => m.status === 'active' && on.has(m.userId));
}

export function mountCamp(root, hash) {
  let st = parseCamp(hash);
  let lastHash = hash;
  let tabApi = null;
  let token = 0;
  const offs = [];
  const user = currentUser();
  const L = (type, sel, fn) => offs.push(on(root, type, sel, fn));

  const ctx = {
    root, user, get cid() { return st.cid; }, get c() { return getCampaign(st.cid); },
    get master() { return isMasterOf(getCampaign(st.cid), user.id); }, get st() { return st; },
    book: () => readBook(getCampaign(st.cid), user.id),
    href: (tab, ...rest) => `#/camp/${st.cid}${tab ? `/${tab}` : ''}${rest.length ? `/${rest.map(encodeURIComponent).join('/')}` : ''}`,
    go: (tab, ...rest) => go(ctx.href(tab, ...rest)),
    rerender: () => render(),
    toast,
  };

  function cover(c, big) {
    const master = ctx.master;
    const book = ctx.book();
    const sessions = book.chapters.filter((ch) => ch.startedAt).length;
    const owner = userById(c.members.find((m) => m.role === 'master')?.userId);
    const hero = heroOfUser(c, user.id);
    const heroes = c.characters.length;
    const lvl = [...new Set(c.characters.map((h) => h.level).filter(Boolean))];
    const meta = master
      ? `Вы ведёте · ${heroes} ${plural(heroes, 'герой', 'героя', 'героев')}${lvl.length === 1 ? ` ${lvl[0]} уровня` : ''} · ${sessions ? `${sessions} ${plural(sessions, 'сессия', 'сессии', 'сессий')}` : 'ещё не играли'}`
      : `Ведёт ${owner?.name || 'мастер'}${hero ? ` · ваш герой — ${hero.name}` : ''} · ${sessions ? `${sessions} ${plural(sessions, 'сессия', 'сессии', 'сессий')}` : 'ещё не играли'}`;
    const live = sessionLive(book);
    const city = tzCity();
    const when = live ? `Идёт сейчас — с ${fmtTime(book.session.startedAt)}${city ? ` по ${city}` : ''}`
      : book.next?.at && book.next.at > Date.now() - 3 * 3600000 ? `${sessions ? 'Следующая' : 'Первая сессия'} — ${fmtDate(book.next.at, { weekday: true, time: true })}${city ? ` по ${city}` : ''}` : master ? 'Дата следующей игры не назначена' : '';
    const here = atTable(c, user.id);
    const players = c.members.filter((m) => m.role === 'player' && m.status === 'active').length;
    const actions = master
      ? html`<button class="btn btn-glass btn-sm" data-invite>${ic('user-add-01')}Пригласить</button><button class="btn btn-primary ${big ? 'btn-lg' : ''}" data-start>${ic('play', 18)}${live ? 'Вернуться за стол' : 'Начать игру'}</button>`
      : html`${here.length ? html`<span class="chip chip-accent cv-live">${here.length} из ${players} уже за столом</span>` : ''}<a class="btn btn-primary ${big ? 'btn-lg' : ''}" href="#/c/${c.id}">${ic('play', 18)}Войти за стол</a>`;
    if (!big) {
      return html`<div class="cv-small"><span class="cv-thumb" style="background-image:url(${srcOf(c.cover)})"></span><div class="cv-titles"><h1>${c.name}</h1><p>${meta}${when ? ` · ${when.toLowerCase()}` : ''}</p></div><span class="spacer"></span><div class="cv-actions">${actions}</div></div>`;
    }
    // Адрес картинки — абсолютный: url() в переменной CSS иначе считается от файла стилей.
    const cov = srcOf(c.cover); const abs = cov ? new URL(cov, location.href).href : '';
    return html`<section class="cv-big" style="${abs ? `--cover:url('${abs}')` : ''}" ${c.cover && !cov ? html`data-bgcover="${c.cover}"` : ''}>
      ${master ? '' : html`<a class="cv-back" href="#/campaigns">${ic('arrow-left-02', 14)}Кампании</a>`}
      <div class="cv-text"><h1>${c.name}</h1><p>${meta}</p>${when ? html`<p class="cv-when">${ic('calendar-03', 14)}${when}</p>` : ''}</div>
      <div class="cv-actions">${actions}</div>
    </section>`;
  }

  function tabsRow(c) {
    const tabs = ctx.master ? MASTER_TABS : PLAYER_TABS;
    const book = ctx.book();
    const count = { scenes: c.scenes.length, heroes: c.characters.length, handouts: book.handouts.length };
    let encN = null;
    try { encN = JSON.parse(localStorage.getItem(`rasputye-encounters:${c.id}:${user.id}`) || '{}').list?.length; } catch { /* */ }
    if (encN) count.encounters = encN;
    return html`<nav class="h-seg dark cp-tabs" aria-label="Разделы кампании">${tabs.map(([id, label]) => html`<a href="${ctx.href(id === 'overview' ? '' : id)}" aria-selected="${st.tab === id}">${label}${count[id] ? ` · ${count[id]}` : ''}</a>`)}</nav>`;
  }

  function render() {
    const c = ctx.c;
    if (!c) { root.innerHTML = String(html`<div class="screen">${appHeader(user, 'campaigns')}<main class="page"><div class="empty-hero"><h2>Кампания не найдена</h2><p>Возможно, её удалили или вы вышли из неё.</p><a class="btn btn-primary" href="#/campaigns">К кампаниям</a></div></main></div>`); bindHeader(root, user); return; }
    const m = membership(c, user.id);
    if (!m || m.status !== 'active') { go(`#/c/${c.id}`); return; }
    const tabs = (ctx.master ? MASTER_TABS : PLAYER_TABS).map((t) => t[0]);
    if (!tabs.includes(st.tab)) { st = { ...st, tab: 'overview', rest: [] }; }
    const my = ++token;
    const big = BIG_COVER.has(st.tab);
    const scroll = root.querySelector('.cp-screen') ? scrollY : 0;
    root.innerHTML = String(html`<div class="screen cp-screen">${appHeader(user, 'campaigns')}
      <main class="page cp-page cp-tab-${st.tab}">${cover(c, big)}<div class="cp-bar">${tabsRow(c)}<div class="cp-bar-tools" data-tools></div></div><div class="cp-body" data-body></div></main></div>`);
    bindHeader(root, user);
    hydrateCover();
    TAB[st.tab]().then((mod) => {
      if (my !== token) return;
      tabApi?.unmount?.();
      tabApi = mod.mountTab(ctx, root.querySelector('[data-body]'), root.querySelector('[data-tools]'), st.tab) || null;
      if (scroll) scrollTo(0, scroll);
    }).catch((err) => { console.error(err); root.querySelector('[data-body]').textContent = `Не удалось открыть вкладку: ${err.message}`; });
  }

  // ——— Действия обложки ———
  L('click', '[data-invite]', async () => {
    const { inviteModal } = await import('../table/p-dialogs.js');
    inviteModal({ cid: st.cid, get c() { return getCampaign(st.cid); }, toast });
  });
  L('click', '[data-start]', () => {
    const c = ctx.c; if (!c) return;
    if (!sessionLive(ctx.book())) { const n = startSession(c.id); toast({ title: `Глава ${n} началась`, body: 'Игроки увидят, что сессия идёт', icon: 'play' }); }
    go(`#/c/${c.id}`);
  });

  // Мастер переплетает присланные записи; данные и устройство меняются — перерисовка вкладки.
  const refresh = () => {
    const c = ctx.c;
    if (!c || membership(c, user.id)?.status !== 'active') { render(); return; }
    if (ctx.master) foldInbox(st.cid, user.id);
    refreshCoverOnly();
    const nav = root.querySelector('.cp-tabs'); if (nav) { const n = document.createElement('div'); n.innerHTML = String(tabsRow(c)); nav.replaceWith(n.firstElementChild); }
    // Пока человек печатает во вкладке, не перерисовываем её поверх ввода.
    const a = document.activeElement;
    if (a && root.querySelector('[data-body]')?.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    if (tabApi?.update) tabApi.update(); else render();
  };
  offs.push(subscribe(() => refresh()));
  offs.push(onLocal(() => refresh()));
  offs.push(bus.on('presence-change', () => { const chip = root.querySelector('.cv-live'); if (chip || !ctx.master) refreshCoverOnly(); }));
  /** Обложка из хранилища (idb:, sb:) — адрес приходит не сразу. */
  function hydrateCover() {
    const n = root.querySelector('[data-bgcover]'); if (!n) return;
    resolveSrc(n.dataset.bgcover).then((u) => { if (u) n.style.setProperty('--cover', `url("${new URL(u, location.href).href}")`); });
  }
  function refreshCoverOnly() {
    const c = ctx.c; if (!c) return;
    const box = root.querySelector('.cv-big, .cv-small'); if (!box) return;
    const n = document.createElement('div'); n.innerHTML = String(cover(c, BIG_COVER.has(st.tab))); box.replaceWith(n.firstElementChild);
    hydrateCover();
  }
  offs.push(bindPaletteKeys());
  if (isMasterOf(getCampaign(st.cid), user.id)) foldInbox(st.cid, user.id);
  render();
  return {
    update(h) {
      // main.js зовёт update и на любое изменение данных — их мы ловим своей подпиской; здесь — только смена адреса.
      h = h || location.hash;
      if (h === lastHash) return;
      lastHash = h;
      const prev = st; st = parseCamp(h);
      if (prev.cid === st.cid && prev.tab === st.tab && tabApi?.route) { tabApi.route(st.rest); return; }
      render();
    },
    unmount() { token++; tabApi?.unmount?.(); for (const off of offs) off(); },
  };
}
