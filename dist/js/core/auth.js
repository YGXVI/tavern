// Имитация входа через Discord. Это демо: личность не проверяется, пароля и токена нет.
// Настоящий провайдер выбирается в DEC-008 / TASK-002; сюда тогда придёт ответ OAuth.
import { getDB, commit } from './store.js';
import { uid, hueOf } from './dom.js';

const SESSION_KEY = 'rasputye-v2-session';   // sessionStorage: у каждой вкладки свой человек
const LAST_KEY = 'rasputye-v2-last-user';     // localStorage: кого подставить в новой вкладке

export function currentUserId() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (s?.userId && getDB().users[s.userId]) return s.userId;
  } catch { /* пусто */ }
  return null;
}

export function currentUser() {
  const id = currentUserId();
  return id ? getDB().users[id] : null;
}

export function lastUserId() {
  try { const id = localStorage.getItem(LAST_KEY); return id && getDB().users[id] ? id : null; } catch { return null; }
}

/** «Авторизация» выбранным демо-аккаунтом или новым ником. */
export function signIn({ userId, name }) {
  let id = userId;
  if (!id) {
    const nick = String(name || '').trim().slice(0, 32) || 'Гость';
    const existing = Object.values(getDB().users).find((u) => u.name.toLowerCase() === nick.toLowerCase());
    if (existing) id = existing.id;
    else {
      id = uid('u-');
      commit((db) => { db.users[id] = { id, name: nick, handle: nick.toLowerCase().replace(/\s+/g, '_'), hue: hueOf(nick), provider: 'discord-demo', createdAt: Date.now() }; });
    }
  }
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId: id, at: Date.now() }));
    localStorage.setItem(LAST_KEY, id);
  } catch { /* приватный режим — вход живёт до перезагрузки */ }
  return id;
}

export function restoreFromLast() {
  const id = lastUserId();
  if (id) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ userId: id, at: Date.now() })); } catch { /* */ } }
  return id;
}

export function signOut() {
  try { sessionStorage.removeItem(SESSION_KEY); localStorage.removeItem(LAST_KEY); } catch { /* */ }
}
