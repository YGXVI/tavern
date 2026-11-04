// Серверный режим (TASK-002) целиком на поддельном Supabase: вход, кампания, приглашение, заявка, герой,
// стол онлайн, бой, двери, карта из файла. Настоящий Supabase не нужен: harness.mjs держит таблицы в памяти
// с той же схемой и упрощёнными правами (полные права проверяет supabase/tests/rls.sql на проекте).
//
// Запуск: `npm run dev` в одном терминале, затем `node tests/browser/server-e2e/e2e.mjs`.
// Нужен Playwright с Chromium (в зависимости проекта не входит). Снимки — в папку SHOTS (по умолчанию временная).
import { createRequire } from 'node:module';
import { fakeServer } from './harness.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const URL0 = 'http://localhost:4173/';
const OUT = process.env.SHOTS || (await import('node:os')).tmpdir();
const A = '00000000-0000-0000-0000-0000000000a1', B = '00000000-0000-0000-0000-0000000000b2';
const fake = fakeServer({ names: { [A]: 'Соль', [B]: 'Ася' } });
const browser = await chromium.launch();
const errors = [];
const step = async (name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { errors.push(`STEP ${name}: ${e.message.split('\n').slice(0, 3).join(' | ')}`); console.log('✗', name); } };
async function newCtx() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await fake.attach(ctx);
  return ctx;
}
const watch = (p, tag) => {
  p.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('ERR_FAILED') && !m.text().includes('ERR_ABORTED')) errors.push(`${tag} [${m.type()}] ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`${tag} [pageerror] ${e.message} ${e.stack?.split('\n')[1] || ''}`));
};
const shot = async (p, n) => { await p.waitForTimeout(250); await p.screenshot({ path: `${OUT}/${n}.png` }); };
const wait = (p, ms = 400) => p.waitForTimeout(ms);
async function until(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; }

// ——— Мастер входит ———
const cM = await newCtx(), cP = await newCtx();
const M = await cM.newPage(); watch(M, 'M'); M.setDefaultTimeout(6000);
const P = await cP.newPage(); watch(P, 'P'); P.setDefaultTimeout(6000);
let cid, code;

await step('login screen (server)', async () => {
  await M.goto(`${URL0}?server=1#/login`);
  await M.waitForSelector('[data-sandbox]');
  await M.click('[data-login]');
  await until(async () => fake.oauth.length > 0);
  if (!fake.oauth.length) throw new Error('signInWithOAuth не вызван');
  const o = fake.oauth[0]; console.log('  oauth', JSON.stringify(o));
  if (o.provider !== 'discord') errors.push('provider не discord');
  // Discord вернул код: сессия появилась.
  await M.evaluate((u) => localStorage.setItem('fake-sb-user', u), A);
  await M.goto(`${URL0}?code=abc#/campaigns`);
  await M.waitForSelector('[data-new]');
  const url = M.url(); console.log('  url after', url);
  if (url.includes('code=')) errors.push('код не убран из адреса');
  await shot(M, 'e2e-01-campaigns');
});

await step('master creates campaign', async () => {
  await M.click('[data-new]');
  await M.fill('[data-name]', 'Пробный склеп');
  await M.click('.modal [data-ok]');
  await M.waitForSelector('.viewport', { timeout: 8000 });
  await until(async () => fake.T.scenes.length > 0 && fake.T.campaign_invites.length > 0);
  const c = fake.T.campaigns[0]; cid = c?.id;
  console.log('  server rows', Object.entries(fake.T).map(([k, v]) => `${k}:${v.length}`).join(' '));
  if (!c) throw new Error('кампания не ушла на сервер');
  code = fake.T.campaign_invites[0]?.code; console.log('  code', code, 'members', fake.T.campaign_members.map((m) => m.role + ':' + m.status).join(','));
  if (!code) errors.push('нет приглашения на сервере');
  await shot(M, 'e2e-02-table');
});

await step('master creates scene (shown to players)', async () => {
  await M.click('[data-act="add:map"]');
  await M.waitForSelector('.modal #ns-name');
  await M.click('.modal [data-ok]');
  await until(async () => fake.T.scenes.length > 0 && !!fake.T.campaigns[0].data.activeSceneId);
  console.log('  scenes', fake.T.scenes.length, 'active', fake.T.campaigns[0].data.activeSceneId, 'secrets', fake.T.scene_secrets.length);
  if (!fake.T.scenes.length) throw new Error('сцена не ушла на сервер');
});

// ——— Игрок по ссылке ———
await step('player opens invite (not logged)', async () => {
  await P.goto(`${URL0}?server=1#/join/${code}`);
  await P.waitForSelector('[data-join]');
  const txt = await P.locator('.invite-card').innerText(); console.log('  card:', txt.replace(/\n/g, ' / ').slice(0, 140));
  await P.click('[data-join]');
  await until(async () => fake.oauth.length > 1);
  await P.evaluate((u) => localStorage.setItem('fake-sb-user', u), B);
  await P.goto(`${URL0}?code=xyz`);
  await P.waitForSelector('[data-join]');
  console.log('  hash after login', new URL(P.url()).hash);
  await P.click('[data-join]');
  await P.waitForSelector('.wait-card');
  const m = fake.T.campaign_members.find((x) => x.user_id === B); console.log('  member', m?.status);
  await shot(P, 'e2e-03-waiting');
});

await step('master sees request and accepts', async () => {
  await until(async () => (await M.locator('.toast').count()) > 0, 3000);
  await M.click('[data-act="invite"]').catch(() => {});
  await M.waitForSelector('[data-accept]');
  await shot(M, 'e2e-04-invite');
  const link = await M.locator('.modal [data-link]').inputValue().catch(() => '');
  console.log('  invite link', link, JSON.stringify((await M.evaluate(async (cid) => { const st = await import('./js/core/store.js'); return st.getDB().campaigns[cid]?.invite; }, cid))));
  if (!link.endsWith(`?server=1#/join/${code}`)) errors.push('ссылка-приглашение без ?server=1 — друг попадёт в песочницу');
  await M.click('[data-accept]');
  await until(async () => fake.T.campaign_members.find((x) => x.user_id === B)?.status === 'active');
  if (fake.T.campaign_members.find((x) => x.user_id === B)?.status !== 'active') throw new Error('статус не active');
  await M.keyboard.press('Escape');
});

await step('player picks own hero', async () => {
  await P.waitForSelector('[data-own]', { timeout: 6000 });
  await P.click('[data-own]');
  await P.fill('.modal [data-n]', 'Лиса');
  await P.click('.modal [data-ok]');
  await P.waitForSelector('.viewport', { timeout: 8000 });
  await until(async () => fake.T.tokens.some((t) => t.character_id));
  const ch = fake.T.characters.find((x) => x.owner_id === B); const tok = fake.T.tokens.find((t) => t.character_id === ch?.id);
  console.log('  hero', ch?.data?.name, 'token', !!tok, 'member char', fake.T.campaign_members.find((x) => x.user_id === B)?.character_id);
  if (!tok) throw new Error('токен героя не на сервере');
  await shot(P, 'e2e-05-player-table');
});

const tokOn = (p, id) => p.evaluate((id) => { const el = document.querySelector(`[data-token="${CSS.escape(id)}"]`); return el ? el.getAttribute('style') : null; }, id);
await step('master sees player hero live', async () => {
  const tok = fake.T.tokens.find((t) => t.character_id);
  const ok = await until(async () => !!(await tokOn(M, tok.id)), 4000);
  if (!ok) throw new Error('у мастера нет токена героя');
});

await step('player moves hero → master sees', async () => {
  const tok = fake.T.tokens.find((t) => t.character_id);
  const before = { ...tok.data };
  await P.evaluate(async ([cid, id]) => {
    const st = await import('./js/core/store.js');
    st.commit((db) => { const c = db.campaigns[cid]; for (const s of c.scenes) for (const t of s.tokens) if (t.id === id) { t.x += 50; t.movedAt = Date.now(); } });
  }, [cid, tok.id]);
  await until(async () => fake.T.tokens.find((t) => t.id === tok.id).data.x === before.x + 50);
  const now = fake.T.tokens.find((t) => t.id === tok.id).data.x; console.log('  server x', before.x, '→', now);
  if (now !== before.x + 50) throw new Error('сервер не получил ход');
  const mx = await until(async () => (await M.evaluate(async ([cid, id]) => { const st = await import('./js/core/store.js'); const c = st.getDB().campaigns[cid]; return c.scenes.flatMap((s) => s.tokens).find((t) => t.id === id)?.x; }, [cid, tok.id])) === now);
  if (!mx) throw new Error('мастер не увидел ход игрока');
});

await step('master hides token → player loses it', async () => {
  const foe = await M.evaluate(async (cid) => {
    const st = await import('./js/core/store.js');
    let id = null;
    st.commit((db) => { const c = db.campaigns[cid]; const s = c.scenes.find((x) => x.id === c.activeSceneId); id = 't-ogre1'; s.tokens.push({ id, kind: 'foe', name: 'Огр', img: 'ogre', size: 'large', x: 300, y: 300, hidden: false, conditions: [] }); });
    return id;
  }, cid);
  await until(async () => !!(await tokOn(P, foe)));
  if (!(await tokOn(P, foe))) throw new Error('игрок не увидел нового огра');
  await M.evaluate(async ([cid, id]) => { const st = await import('./js/core/store.js'); st.commit((db) => { const c = db.campaigns[cid]; for (const s of c.scenes) for (const t of s.tokens) if (t.id === id) t.hidden = true; }); }, [cid, foe]);
  const gone = await until(async () => !(await tokOn(P, foe)));
  if (!gone) throw new Error('скрытый огр остался у игрока');
  const inPlayerDb = await P.evaluate(async ([cid, id]) => { const st = await import('./js/core/store.js'); return st.getDB().campaigns[cid].scenes.some((s) => s.tokens.some((t) => t.id === id)); }, [cid, foe]);
  if (inPlayerDb) errors.push('огр остался в данных игрока');
  await M.evaluate(async ([cid, id]) => { const st = await import('./js/core/store.js'); st.commit((db) => { const c = db.campaigns[cid]; for (const s of c.scenes) for (const t of s.tokens) if (t.id === id) t.hidden = false; }); }, [cid, foe]);
  if (!(await until(async () => !!(await tokOn(P, foe))))) errors.push('показанный огр не вернулся к игроку');
});

await step('player tries forbidden edit → rejected and restored', async () => {
  const foe = 't-ogre1';
  await P.evaluate(async ([cid, id]) => { const st = await import('./js/core/store.js'); st.commit((db) => { const c = db.campaigns[cid]; for (const s of c.scenes) for (const t of s.tokens) if (t.id === id) t.hp = 1; }); }, [cid, foe]);
  await wait(P, 900);
  const srv = fake.T.tokens.find((t) => t.id === foe).data.hp;
  const loc = await P.evaluate(async ([cid, id]) => { const st = await import('./js/core/store.js'); return st.getDB().campaigns[cid].scenes.flatMap((s) => s.tokens).find((t) => t.id === id)?.hp; }, [cid, foe]);
  console.log('  server hp', srv, 'player hp', loc);
  if (srv === 1) errors.push('сервер принял хиты чужого токена');
  if (loc === 1) errors.push('у игрока не откатилось');
});

await step('broadcast ping + presence', async () => {
  const on = await M.evaluate(async (cid) => { const st = await import('./js/core/store.js'); return [...st.onlineUsers(cid)]; }, cid);
  console.log('  master sees online', on.length);
  if (on.length < 2) errors.push('мастер не видит игрока в сети');
});

await step('roll: hidden master roll redacted for player', async () => {
  await M.evaluate(async (cid) => { const st = await import('./js/core/store.js'); st.commit((db) => { db.campaigns[cid].log.unshift({ id: 'r-hid', at: Date.now(), userId: db.campaigns[cid].ownerId, kind: 'roll', label: 'Огр: атака', total: 19, detail: '1к20 (15) +4', hidden: true, vis: 'gm' }); }); }, cid);
  await until(async () => fake.T.log_secrets.some((x) => x.id === 'r-hid'));
  const pub = fake.T.log_entries.find((x) => x.id === 'r-hid'); const sec = fake.T.log_secrets.find((x) => x.id === 'r-hid');
  console.log('  public', JSON.stringify(pub?.data), 'secret', JSON.stringify(sec?.data));
  if (pub?.data?.total !== undefined || pub?.data?.label) errors.push('сумма скрытого броска в открытой записи');
  await wait(P, 600);
  const pe = await P.evaluate(async (cid) => { const st = await import('./js/core/store.js'); return st.getDB().campaigns[cid].log.find((x) => x.id === 'r-hid'); }, cid);
  console.log('  player sees', JSON.stringify(pe));
  if (pe?.total !== undefined) errors.push('игрок видит сумму скрытого броска');
});


const getC = (p) => p.evaluate(async (cid) => { const st = await import('./js/core/store.js'); return st.getDB().campaigns[cid]; }, cid);
const openInit = async (p) => { if (!(await p.locator('.init-widget').count())) { await p.click('[data-act="w-initiative"]'); await wait(p, 300); } };
await step('trap: master client stops hero on hidden trap', async () => {
  const hero = fake.T.tokens.find((t) => t.character_id);
  const info = await M.evaluate(async ([cid, id]) => {
    const st = await import('./js/core/store.js');
    const c = st.getDB().campaigns[cid]; const s = c.scenes.find((x) => x.id === c.activeSceneId); const t = s.tokens.find((x) => x.id === id);
    const g = s.grid, size = g.size, ox = g.offsetX || 0, oy = g.offsetY || 0;
    const col = Math.floor((t.x - ox) / size), row = Math.floor((t.y - oy) / size);
    st.commit((db) => { const cs = db.campaigns[cid].scenes.find((x) => x.id === s.id); cs.traps.push({ id: 'tr-1', name: 'Нажимная плита', cells: [`${col + 1},${row}`], save: 'dex', dc: 13, damage: '2к6', triggered: false }); });
    return { size, ox, oy, col, row, x: t.x, y: t.y, sid: s.id };
  }, [cid, hero.id]);
  await until(async () => fake.T.scene_secrets.some((x) => (x.data.traps || []).some((t) => t.id === 'tr-1')));
  const pSees = await P.evaluate(async (cid) => { const st = await import('./js/core/store.js'); return st.getDB().campaigns[cid].scenes.some((s) => (s.traps || []).length); }, cid);
  if (pSees) errors.push('игрок видит ловушку');
  // Игрок ведёт героя на три клетки вправо — через ловушку.
  await P.evaluate(async ([cid, id, dx]) => { const st = await import('./js/core/store.js'); st.commit((db) => { for (const s of db.campaigns[cid].scenes) for (const t of s.tokens) if (t.id === id) { t.x += dx; t.movedAt = Date.now(); } }); }, [cid, hero.id, info.size * 3]);
  const stopX = info.ox + (info.col + 1.5) * info.size;
  const ok = await until(async () => Math.abs(fake.T.tokens.find((t) => t.id === hero.id).data.x - stopX) < 1, 5000);
  console.log('  hero x on server', fake.T.tokens.find((t) => t.id === hero.id).data.x, 'trap cell center', stopX, 'triggered', fake.T.scene_secrets.find((x) => x.scene_id === info.sid)?.data.traps.find((t) => t.id === 'tr-1')?.triggered);
  if (!ok) throw new Error('мастер не остановил героя на ловушке');
  const toast = await until(async () => (await P.locator('.toast', { hasText: 'Под ногой щёлкнуло' }).count()) > 0, 3000);
  if (!toast) errors.push('игрок не узнал, что сработала ловушка');
  await shot(M, 'e2e-10-trap-master');
  await M.keyboard.press('Escape');
});

await step('combat: player rolls init, master passes turn, player ends turn', async () => {
  const hero = fake.T.tokens.find((t) => t.character_id).id;
  await M.evaluate(async ([cid, hero]) => { const st = await import('./js/core/store.js'); st.commit((db) => { const c = db.campaigns[cid]; c.combat = { active: true, sceneId: c.activeSceneId, round: 1, turn: 0, entries: [{ tokenId: 't-ogre1', init: 15 }, { tokenId: hero, init: null }], moved: {}, startedAt: Date.now() }; }); }, [cid, hero]);
  await until(async () => fake.T.combats[0]?.data?.active === true);
  console.log('  server combat current', fake.T.combats[0].data.current);
  if (fake.T.combats[0].data.current !== 't-ogre1') errors.push('мастер не записал current');
  await until(async () => (await getC(P)).combat.active);
  await openInit(P);
  await P.click(`.init-widget [data-act="init-roll"][data-id="${hero}"]`);
  await until(async () => fake.T.combats[0].data.entries.find((e) => e.tokenId === hero)?.init != null);
  console.log('  player local combat', JSON.stringify((await getC(P)).combat), 'calls', fake.log.slice(-6).join(','));
  const e = fake.T.combats[0].data.entries.find((x) => x.tokenId === hero); console.log('  hero init on server', e.init, 'turn', fake.T.combats[0].data.turn);
  if (e.init == null) throw new Error('инициатива игрока не дошла');
  // Мастер передаёт ход.
  const order = (await getC(M)).combat.entries.map((x) => x.tokenId + ':' + x.init).join(','); console.log('  master entries', order);
  await openInit(M);
  const curBefore = fake.T.combats[0].data.current;
  await M.click('.init-widget [data-act="combat-next"]');
  await until(async () => fake.T.combats[0].data.current !== curBefore);
  console.log('  current after next', fake.T.combats[0].data.current);
  // Ход героя: игрок заканчивает его.
  if (fake.T.combats[0].data.current === hero) {
    await until(async () => (await P.locator('.init-widget [data-act="end-turn"]').count()) > 0);
    await shot(P, 'e2e-07-my-turn');
    await P.click('.init-widget [data-act="end-turn"]');
    const passed = await until(async () => fake.T.combats[0].data.current !== hero && !fake.T.combats[0].data.ended, 4000);
    console.log('  after end-turn current', fake.T.combats[0].data.current, 'ended', fake.T.combats[0].data.ended, 'round', fake.T.combats[0].data.round);
    if (!passed) throw new Error('ход игрока не передан мастером');
  } else errors.push('после «следующий ход» ходит не герой');
  await M.evaluate(async (cid) => { const st = await import('./js/core/store.js'); st.commit((db) => { const c = db.campaigns[cid]; c.combat = { active: false, round: 0, turn: 0, entries: [], moved: {} }; }); }, cid);
  await until(async () => fake.T.combats[0].data.active === false);
});

await step('door: master adds door, player opens it', async () => {
  await M.evaluate(async (cid) => { const st = await import('./js/core/store.js'); st.commit((db) => { const c = db.campaigns[cid]; const s = c.scenes.find((x) => x.id === c.activeSceneId); s.walls.push({ id: 'w-door1', kind: 'door', a: { x: 100, y: 100 }, b: { x: 160, y: 100 }, open: false, locked: false }); }); }, cid);
  await until(async () => (fake.T.scenes[0].data.walls || []).some((w) => w.id === 'w-door1'));
  await until(async () => (await getC(P)).scenes[0].walls.some((w) => w.id === 'w-door1'));
  await P.evaluate(async (cid) => { const st = await import('./js/core/store.js'); st.commit((db) => { const c = db.campaigns[cid]; const w = c.scenes[0].walls.find((x) => x.id === 'w-door1'); w.open = true; }); }, cid);
  const ok = await until(async () => fake.T.scenes[0].data.walls.find((w) => w.id === 'w-door1')?.open === true);
  if (!ok) throw new Error('дверь не открылась на сервере');
  const mOpen = await until(async () => (await getC(M)).scenes[0].walls.find((w) => w.id === 'w-door1')?.open === true);
  if (!mOpen) errors.push('мастер не увидел открытую дверь');
});

await step('map upload by master (storage)', async () => {
  await M.keyboard.press('Escape'); await M.keyboard.press('Escape'); await wait(M, 200);
  await M.click('[data-act="add:map"]');
  await M.waitForSelector('.modal [data-upload]', { state: 'attached' });
  const { readFileSync } = await import('node:fs');
  await M.setInputFiles('.modal [data-upload]', { name: 'map.webp', mimeType: 'image/webp', buffer: readFileSync(new URL('../../../dist/assets/maps/cave.webp', import.meta.url)) });
  await until(async () => fake.files.size > 0);
  console.log('  files', [...fake.files.keys()].join(','));
  if (!fake.files.size) throw new Error('файл не загружен: ' + await M.locator('.modal [data-up-msg]').innerText().catch(() => '?'));
  await M.fill('.modal #ns-name', 'Своя карта');
  await M.click('.modal [data-ok]');
  await until(async () => fake.T.scenes.some((s) => String(s.data.map?.src).startsWith('sb:')));
  const sc = fake.T.scenes.find((s) => String(s.data.map?.src).startsWith('sb:'));
  if (!sc) throw new Error('сцена со своей картой не на сервере');
  await wait(M, 600);
  const src = await M.evaluate(() => document.querySelector('.map-layer img, img.map, .world img')?.getAttribute('src') || '');
  console.log('  map img src', src.slice(0, 40));
  await shot(M, 'e2e-08-own-map');
  // Мастер показывает сцену — у игрока карта по подписанной ссылке.
  await M.evaluate(async ([cid, sid]) => { const st = await import('./js/core/store.js'); st.commit((db) => { db.campaigns[cid].activeSceneId = sid; }); }, [cid, sc.id]);
  const got = await until(async () => (await P.evaluate(() => [...document.querySelectorAll('img')].some((i) => (i.getAttribute('src') || '').startsWith('data:image/svg+xml,%3Csvg')))), 5000);
  console.log('  player map via signed url', got);
  if (!got) errors.push('игрок не получил карту из хранилища');
  await shot(P, 'e2e-09-player-own-map');
});

await step('offline: move waits for network, then lands', async () => {
  const hero = fake.T.tokens.find((t) => t.character_id);
  const x0 = hero.data.x;
  fake.net.down = true;
  await P.evaluate(async ([cid, id]) => { const st = await import('./js/core/store.js'); st.commit((db) => { for (const s of db.campaigns[cid].scenes) for (const t of s.tokens) if (t.id === id) { t.x += 20; t.movedAt = Date.now(); } }); }, [cid, hero.id]);
  const pill = await until(async () => (await P.locator('.net-pill').count()) > 0, 3000);
  await shot(P, 'e2e-11-offline');
  if (!pill) errors.push('нет плашки «нет связи»');
  const toastBad = await P.locator('.toast', { hasText: 'Сервер не принял' }).count();
  if (toastBad) errors.push('обрыв сети показан как отказ сервера');
  fake.net.down = false;
  const landed = await until(async () => fake.T.tokens.find((t) => t.id === hero.id).data.x === x0 + 20, 8000);
  if (!landed) throw new Error('ход не дошёл после восстановления сети');
  const gone = await until(async () => (await P.locator('.net-pill').count()) === 0, 3000);
  if (!gone) errors.push('плашка не исчезла');
});

await step('reload keeps session and table', async () => {
  await P.reload(); await P.waitForSelector('.viewport', { timeout: 8000 });
  await shot(P, 'e2e-06-reload');
});

await step('server state sanity', async () => {
  console.log('  rows', Object.entries(fake.T).map(([k, v]) => `${k}:${v.length}`).join(' '));
  if (fake.T.scene_secrets.length !== fake.T.scenes.length) errors.push('scene_secrets не у каждой сцены');
  const mm = await M.evaluate(async (cid) => { const st = await import('./js/core/store.js'); const c = st.getDB().campaigns[cid]; return { members: c.members.map((m) => m.role + ':' + m.status + ':' + (m.characterId || '-')), log: c.log.length, chars: c.characters.length }; }, cid);
  console.log('  master view', JSON.stringify(mm));
});


const real = errors.filter((e) => !e.includes('Поле hp чужого токена')); // этот отказ сервера проверка вызывает нарочно
console.log('\n' + (real.length ? real.join('\n') : 'OK'));
process.exitCode = real.length ? 1 : 0;
console.log('calls:', fake.log.length);
await browser.close();
