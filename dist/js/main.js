// Точка входа: хранилище, маршруты по адресу после #, переключение экранов.
//   #/login            — вход (имитация Discord)
//   #/campaigns        — мои кампании
//   #/join/RSP-XXXX    — приглашение по ссылке
//   #/c/<id>           — стол кампании (или ожидание одобрения / выбор героя)
import { initStore, subscribe, bus, onlineUsers, useServerBackend, setDB, deliver, emitLocal, commit, getDB, isServerMode } from './core/store.js';
import { seedDB } from './data/demo.js';
import { currentUser, restoreFromLast } from './core/auth.js';
import { initTooltips, closePopover } from './ui/kit.js';
import { mountLogin, mountCampaigns, mountJoin, mountHeroPick, mountWaiting, mountServerDown, go } from './views/screens.js';
import { mountTable } from './views/table/index.js';
import { getCampaign, membership } from './core/campaign.js';
import { debounce } from './core/dom.js';
import { getMode } from './server/config.js';
import { useRemoteAssets } from './core/assets.js';

let sync = null;          // server/sync.js — только в серверном режиме
let loginMessage = null;  // «Вход через Discord отменён» и т. п.

const root = document.getElementById('app');
let current = null;
let currentKey = '';

function show(key, mount) {
  if (key === currentKey && current) { current.update?.(); return; }
  current?.unmount?.();
  closePopover();
  currentKey = key;
  current = mount() || {};
  document.body.dataset.screen = key.split(':')[0];
}

function route() {
  const parts = (location.hash || '#/').replace(/^#\/?/, '').split('/');
  const [page, arg] = parts;
  let user = currentUser();
  // Новая вкладка: подставляем последний вход. По ссылке-приглашению — нет: там часто входят другим аккаунтом.
  if (!user && page !== 'join' && restoreFromLast()) user = currentUser();

  if (page === 'join' && arg) {
    const code = decodeURIComponent(arg).toUpperCase();
    show(`join:${code}:${user?.id || ''}`, () => mountJoin(root, code, { onSignedIn: () => route() }));
    return;
  }
  if (!user) { show('login', () => mountLogin(root, { onSignedIn: () => go('#/campaigns'), message: loginMessage })); loginMessage = null; return; }
  if (page === 'login' || !page) { go('#/campaigns'); return; }

  if (page === 'c' && arg) {
    const c = getCampaign(arg);
    if (!c) {
      // Серверный режим: кампания могла появиться только что (вступили по ссылке) — догружаем один раз.
      if (sync && !route.tried?.has(arg)) { (route.tried ||= new Set()).add(arg); sync.loadCampaign(arg).catch(() => go('#/campaigns')); return; }
      go('#/campaigns'); return;
    }
    const m = membership(c, user.id);
    if (!m) { go(c.invite?.code ? `#/join/${c.invite.code}` : '#/campaigns'); return; }
    if (m.status === 'pending') {
      if (isServerMode()) { show(`wait:${c.id}:${user.id}`, () => mountWaiting(root, c, user)); return; }
      show(`join:${c.invite.code}:${user.id}`, () => mountJoin(root, c.invite.code, { onSignedIn: () => route() })); return;
    }
    if (m.role === 'player' && !m.characterId) { show(`pick:${c.id}:${user.id}`, () => mountHeroPick(root, c)); return; }
    show(`table:${c.id}:${user.id}`, () => mountTable(root, c.id));
    return;
  }
  show(`campaigns:${user.id}`, () => mountCampaigns(root));
}

async function boot() {
  initTooltips();
  if (getMode() === 'server') {
    root.innerHTML = '<div class="screen boot-screen"><div class="center-stage"><div class="boot-spinner" aria-label="Загрузка"></div></div></div>';
    try {
      sync = await import('./server/sync.js');
      useServerBackend(sync.backend);
      useRemoteAssets({ get: sync.signedUrl, resolve: sync.resolveSigned, upload: sync.uploadImage });
      const res = await sync.startServer({ getDB, setDB, deliver, emitLocal, commit });
      loginMessage = res.error;
      if (res.user) { const back = sync.takeReturnHash(); if (back && back !== location.hash) { location.hash = back; } }
    } catch (err) {
      console.error(err);
      mountServerDown(root, err);
      return;
    }
  } else {
    initStore(seedDB);
  }
  addEventListener('hashchange', route);
  route();
}

// Данные поменялись (в этой или соседней вкладке): стол обновляется сам, остальные экраны — через маршрут.
subscribe(() => {
  if (currentKey.startsWith('table:')) {
    const [, cid, uidv] = currentKey.split(':');
    const c = getCampaign(cid);
    const m = c && membership(c, uidv);
    if (!c || !m || m.status !== 'active' || (m.role === 'player' && !m.characterId)) route();
    return;
  }
  route();
});

// «Сессия идёт» на карточках кампаний: обновляем, только когда изменился состав онлайн.
let onlineSig = '';
bus.on('presence-change', debounce(() => {
  if (!currentKey.startsWith('campaigns:')) return;
  const sig = [...onlineUsers()].sort().join(',');
  if (sig === onlineSig) return;
  onlineSig = sig;
  current?.update?.();
}, 400));

boot();
