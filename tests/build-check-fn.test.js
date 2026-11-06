// Обработчик Edge Function validate-build (P4b, #202): без сети, с подставным fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../supabase/functions/validate-build/handler.js';

const env = { url: 'https://x.supabase.co', anonKey: 'anon', key: 'секрет' };
const req = (body, auth = 'Bearer jwt') => new Request('https://f/validate-build', { method: 'POST', headers: auth ? { Authorization: auth } : {}, body: JSON.stringify(body) });
function deps({ ok = true, campaign = [{ data: {} }] } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes('/campaigns')) return new Response(JSON.stringify(campaign), { status: 200 });
    return new Response('{"ok":true}', { status: 200 });
  };
  const check = { checkCreate: () => ({ ok, errors: ok ? [] : [{ code: 'mismatch', field: 'stats' }] }), checkLevelUp: () => ({ ok, errors: [] }) };
  return { calls, d: { check, catalogues: {}, env, fetch } };
}
const create = { kind: 'create', args: { p_campaign: 'c1', p_character: 'h', p_operation: 'o', p_payload: {}, p_claim: false, p_evil: 1 } };

test('честная сборка: команда вызывается с токеном игрока и секретным заголовком, лишние аргументы отброшены', async () => {
  const { calls, d } = deps();
  const res = await handle(req(create), d);
  assert.equal(res.status, 200);
  const rpc = calls.find((c) => c.url.includes('/rpc/create_character_sheet'));
  assert.equal(rpc.init.headers.Authorization, 'Bearer jwt');
  assert.equal(rpc.init.headers['x-build-check'], 'секрет');
  assert.ok(!('p_evil' in JSON.parse(rpc.init.body)));
  assert.ok(!(await res.text()).includes('секрет'));
});

test('нечестная сборка: 422, команда не вызывается и ключ никуда не уходит', async () => {
  const { calls, d } = deps({ ok: false });
  const res = await handle(req(create), d);
  assert.equal(res.status, 422);
  assert.equal((await res.json()).errors[0].field, 'stats');
  assert.ok(!calls.some((c) => c.url.includes('/rpc/')));
});

test('без входа, чужая кампания, неизвестная команда и CORS', async () => {
  assert.equal((await handle(req(create, null), deps().d)).status, 401);
  assert.equal((await handle(req(create), deps({ campaign: [] }).d)).status, 403);
  assert.equal((await handle(req({ kind: 'delete', args: {} }), deps().d)).status, 400);
  assert.equal((await handle(new Request('https://f/', { method: 'OPTIONS' }), deps().d)).status, 204);
});
