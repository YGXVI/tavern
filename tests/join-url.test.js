// Ссылка-приглашение (#194): вход гостем передаётся приглашённому, сервер — пока он включён не для всех.
import test from 'node:test';
import assert from 'node:assert/strict';

function storage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
function page(search) {
  globalThis.location = { origin: 'https://stand.test', pathname: '/', search };
  globalThis.sessionStorage = storage();
  globalThis.localStorage = storage();
}
const { joinUrl, SERVER_ENABLED } = await import('../dist/js/server/config.js');
const server = SERVER_ENABLED ? '' : 'server=1';
const withQuery = (...parts) => { const q = parts.filter(Boolean).join('&'); return `https://stand.test/${q ? `?${q}` : ''}#/join/ABCD1234`; };

test('joinUrl: вкладка с ?guest=1 передаёт вход гостем приглашённому', () => {
  page('?guest=1');
  assert.equal(joinUrl('ABCD1234', true), withQuery(server, 'guest=1'));
});

test('joinUrl: без гостевого входа ссылка его не добавляет', () => {
  page('');
  assert.equal(joinUrl('ABCD1234', true), withQuery(server));
});

test('joinUrl: песочница не добавляет ни сервер, ни гостя', () => {
  page('?guest=1');
  assert.equal(joinUrl('ABCD1234', false), withQuery());
});
