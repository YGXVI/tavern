// Вход гостем (#194, вариант А) на поддельном Supabase: без ?guest=1 кнопки нет; гость по ссылке-приглашению
// входит по нику, садится в кампанию и видит стол; выключенный в Supabase анонимный вход даёт понятную ошибку;
// вход через Discord на месте.
//
// Запуск: `npm run dev` в одном терминале, затем `node tests/browser/server-e2e/guest.mjs`.
import { createRequire } from 'node:module';
import { fakeServer } from './harness.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const URL0 = 'http://localhost:4173/';
const OUT = process.env.SHOTS || (await import('node:os')).tmpdir();
const A = '00000000-0000-0000-0000-0000000000a1';
const fake = fakeServer({ names: { [A]: 'Соль' } });
const browser = await chromium.launch();
const errors = [];
const step = async (name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { errors.push(`STEP ${name}: ${e.message.split('\n').slice(0, 3).join(' | ')}`); console.log('✗', name); } };
async function newCtx(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await fake.attach(ctx);
  return ctx;
}
const watch = (p, tag) => {
  p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED') && !m.text().includes('ERR_ABORTED')) errors.push(`${tag} [console] ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`${tag} [pageerror] ${e.message}`));
};
const shot = async (p, n) => { await p.waitForTimeout(250); await p.screenshot({ path: `${OUT}/${n}.png` }); };
async function until(fn, ms = 5000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; }

const M = await (await newCtx()).newPage(); watch(M, 'M'); M.setDefaultTimeout(8000);
let code;
await step('мастер: кампания и приглашение', async () => {
  await M.goto(`${URL0}?server=1#/login`);
  await M.waitForSelector('[data-login]');
  if (await M.locator('[data-guest-form]').count()) throw new Error('кнопка гостя видна без ?guest=1');
  await M.evaluate((u) => localStorage.setItem('fake-sb-user', u), A);
  await M.goto(`${URL0}#/campaigns`);
  await M.waitForSelector('[data-new]');
  await M.click('[data-new]'); await M.fill('[data-name]', 'Тестовая партия'); await M.click('.modal [data-ok]');
  await M.waitForSelector('.viewport', { timeout: 10000 });
  await until(async () => fake.T.campaign_invites.length > 0);
  code = fake.T.campaign_invites[0].code;
  fake.T.campaign_invites[0].manual = false; // заходят сразу, без заявки
});

const G = await (await newCtx({ width: 390, height: 844 })).newPage(); watch(G, 'G'); G.setDefaultTimeout(8000);
await step('гость: выключенный анонимный вход — понятная ошибка', async () => {
  fake.auth.anonymous = false;
  await G.goto(`${URL0}?guest=1#/join/${code}`);
  await G.waitForSelector('[data-guest-form]');
  await G.fill('[data-guest-name]', 'Claude-1'); await G.click('[data-guest]');
  await G.waitForSelector('.toast');
  const t = await G.locator('.toast').last().innerText();
  if (!/Allow anonymous/.test(t)) throw new Error(`тост: ${t}`);
  fake.auth.anonymous = true;
});
await step('гость: вход по нику по ссылке-приглашению, место за столом', async () => {
  await shot(G, 'guest-01-join');
  await Promise.all([G.waitForEvent('load', { timeout: 10000 }), (async () => { await G.fill('[data-guest-name]', 'Claude-1'); await G.click('[data-guest]'); })()]);
  await until(async () => /Claude-1/.test(await G.locator('[data-join]').innerText().catch(() => '')), 8000);
  const btn = await G.locator('[data-join]').innerText();
  if (!/Claude-1/.test(btn)) throw new Error(`кнопка: ${btn}`);
  const prof = fake.T.profiles.find((p) => p.name === 'Claude-1');
  if (!prof) throw new Error('профиль гостя не создан');
  await G.click('[data-join]');
  await until(async () => fake.T.campaign_members.some((m) => m.user_id === prof.id));
  const mem = fake.T.campaign_members.find((m) => m.user_id === prof.id);
  if (!mem || mem.role !== 'player') throw new Error(`членство: ${JSON.stringify(mem)}`);
  await shot(G, 'guest-02-after-join');
});
await step('Discord на месте', async () => {
  const D = await (await newCtx()).newPage(); watch(D, 'D');
  await D.goto(`${URL0}?server=1&guest=1#/login`);
  await D.waitForSelector('[data-guest-form]');
  await shot(D, 'guest-03-login');
  await D.click('[data-login]');
  await until(async () => fake.oauth.length > 0);
  if (fake.oauth.at(-1)?.provider !== 'discord') throw new Error('Discord не вызван');
});
console.log(errors.length ? `ОШИБКИ:\n${errors.join('\n')}` : 'Без ошибок');
await browser.close();
process.exit(errors.length ? 1 : 0);
