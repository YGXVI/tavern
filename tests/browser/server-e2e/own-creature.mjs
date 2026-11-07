// Локальный dist:4173, Playwright из окружения. Проверяет UI библиотеки и серверное сохранение.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { fakeServer } from './harness.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const A = '00000000-0000-0000-0000-0000000000a1', B = '00000000-0000-0000-0000-0000000000b2';
let rejectPlacement = false, fallback = false;
const fake = fakeServer({ names: { [A]: 'Соль', [B]: 'Ася' }, rpcOverride: ({ name }) => {
  if (name !== 'place_creature') return;
  if (rejectPlacement) return { data: null, error: { code: '42501', message: 'Тестовый отказ сохранения' } };
  if (fallback) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
} });
for (const uid of [A, B]) fake.ensureProfile(uid);
fake.sysInsert('campaigns', { id: 'c-own', owner_id: A, name: 'Проверка существ', data: { activeSceneId: 's-own', seats: 5, settings: { playersSeeHp: 'exact', sharedVision: true } } });
for (const uid of [A, B]) fake.sysInsert('campaign_members', { campaign_id: 'c-own', user_id: uid, role: uid === A ? 'master' : 'player', status: 'active', character_id: uid === B ? 'ch-player' : null });
fake.sysInsert('characters', { id: 'ch-player', campaign_id: 'c-own', owner_id: B, data: { name: 'Лира', portrait: 'lira', stats: { str: 10, dex: 14, con: 12, int: 16, wis: 12, cha: 10 }, hp: 20, hpMax: 20, ac: 12, speed: 30, saves: [], conditions: [], attacks: [], inventory: [], slots: {}, deathSaves: { s: 0, f: 0 } } });
fake.sysInsert('scenes', { id: 's-own', campaign_id: 'c-own', ord: 0, data: { name: 'Сцена', status: 'active', map: { src: 'map:crypt', width: 1185, height: 1259 }, grid: { size: 60, feet: 5, visible: true }, lighting: 'bright', fog: { mode: 'off', ops: [] }, walls: [], lights: [], terrain: { difficult: [], blocked: [] }, pins: [], portals: [], traps: [] } });
fake.sysInsert('tokens', { id: 't-player', campaign_id: 'c-own', scene_id: 's-own', character_id: 'ch-player', hidden: false, data: { kind: 'hero', name: 'Лира', img: 'lira', size: 'medium', x: 450, y: 500, conditions: [] } });
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'], ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) });
const errors = [];
const waitFor = async (fn) => { for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error('Сервер не подтвердил изменение'); };
try {
for (const uid of [A, B]) {
  const context = await browser.newContext({ viewport: { width: uid === A ? 1440 : 390, height: 900 }, reducedMotion: 'reduce' });
  await fake.attach(context);
  await context.addInitScript((uid) => localStorage.setItem('fake-sb-user', uid), uid);
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await context.route('**/js/views/table/index.js', async (route) => { const r = await route.fetch(); await route.fulfill({ response: r, body: (await r.text()).replace('ctx.panels = new Panels(ctx);', 'ctx.panels = new Panels(ctx); window.__ctx = ctx;') }); });
  const page = await context.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:4173/?server=1#/creatures');
  await page.locator('[data-lib-new]').first().click();
  const modal = page.locator('.lib-modal');
  await modal.locator('[data-p="name"]').fill('Нарзугон');
  for (const [path, value] of Object.entries({ ac: '20', hp: '112', hpFormula: '15к8+45', 'stats.str': '20', 'stats.dex': '10' })) await modal.locator(`[data-p="${path}"]`).fill(value);
  await modal.locator('[data-act="add"][data-p="actions"]').click();
  await modal.locator('[data-p="actions.0.name"]').fill('Адское копьё');
  await modal.locator('[data-p="actions.0.text"]').fill('Рукопашная атака оружием. Досягаемость 10 футов.');
  await modal.locator('[data-act="attack"][data-p="actions.0"]').click();
  await modal.locator('[data-p="actions.0.attack.bonus"]').fill('10');
  await modal.locator('[data-p="actions.0.attack.reach"]').fill('10');
  for (const [i, dice, type] of [[0, '1к12 + 5', 'колющий'], [1, '3к10', 'огонь']]) {
    await modal.locator('[data-act="damage"][data-p="actions.0"]').click();
    await modal.locator(`[data-p="actions.0.damage.${i}.dice"]`).fill(dice);
    await modal.locator(`[data-p="actions.0.damage.${i}.type"]`).fill(type);
  }
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 100; c.height = 400; const g = c.getContext('2d'); g.fillStyle = 'red'; g.fillRect(0, 0, 100, 100); g.fillStyle = 'blue'; g.fillRect(0, 100, 100, 200); g.fillStyle = 'lime'; g.fillRect(0, 300, 100, 100); return c.toDataURL('image/png').split(',')[1]; });
  await modal.evaluate((node, png) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], 'narzugon.png', { type: 'image/png' }));
    node.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, png);
  await modal.getByRole('button', { name: 'Настроить картинку', exact: true }).waitFor();
  assert.equal(await modal.locator('[data-p="name"]').inputValue(), 'Нарзугон');
  assert.equal(await modal.locator('[data-p="actions.0.damage.1.dice"]').inputValue(), '3к10');
  await modal.locator('[data-act="pic"]').click();
  await page.locator('.token-image-modal button[data-save]:enabled').waitFor(); await page.locator('[data-fit]').click(); await page.locator('.token-image-modal button[data-save]').click();
  await page.locator('.token-image-modal').waitFor({ state: 'detached' });
  await modal.getByRole('button', { name: 'Настроить картинку', exact: true }).waitFor();
  const face = await modal.locator('.lib-pic-face').boundingBox(); assert.equal(face.width, face.height);
  await modal.locator('[data-ok]').click(); await modal.waitFor({ state: 'detached' }); 
  const template = fake.T.creatures.find((c) => c.owner_id === uid); assert.ok(template); assert.match(template.data.img, /^library:/);
  await page.goto('http://localhost:4173/?server=1#/c/c-own'); await page.waitForFunction(() => !!window.__ctx?.scene);
  const place = () => page.evaluate(async ({ id, uid, A }) => { const { listCreatures } = await import('/js/core/library.js'); if (!__ctx.ui.myLib) __ctx.ui.myLib = { list: await listCreatures() }; const p = await import('/js/views/table/p-side.js'); if (uid === A) await p.placeCreatures(__ctx, `libsrc:${id}`); else await p.placeSummon(__ctx, `libsrc:${id}`); }, { id: template.id, uid, A });
  // Задержка сервера: до ACK токен и ложное уведомление об успехе отсутствуют.
  let release; fake.net.writeGate = new Promise((r) => { release = r; });
  const beforeVisible = await page.evaluate(() => __ctx.scene.tokens.filter((t) => t.name.startsWith('Нарзугон')).length);
  const writeStart = fake.log.length;
  const before = fake.T.tokens.length, pending = place(); pending.catch(() => {});
  await waitFor(() => fake.log.slice(writeStart).includes('rpc'));
  await page.waitForFunction(() => __ctx.ui.creaturePlacing === true);
  await waitFor(() => fake.files.size >= 2);
  assert.equal(await page.evaluate(() => __ctx.scene.tokens.filter((t) => t.name.startsWith('Нарзугон')).length), beforeVisible);
  release(); fake.net.writeGate = null; await pending;
  assert.equal(fake.T.tokens.length, before + 1);
  const token = fake.T.tokens.at(-1); assert.match(token.data.img, /^sb:@tokens\//);
  const copy = fake.T.campaign_creatures.find((c) => c.id === token.data.monsterId.slice(4)); assert.equal(copy.data.img, token.data.img); assert.equal(copy.data.actions[0].damage.length, 2);
  // Подписанный URL приходит после первой отрисовки: проверяем сам токен, не только портрет статблока.
  let releaseImage; fake.net.signGate = new Promise((r) => { releaseImage = r; });
  await page.reload(); await page.waitForFunction(() => !!window.__ctx?.scene);
  assert.ok(await page.evaluate((id) => __ctx.scene.tokens.some((t) => t.id === id), token.id));
  const tokenFace = page.locator(`[data-token="${token.id}"] .tok-ring`);
  await tokenFace.locator('.tok-initials').waitFor();
  releaseImage(); fake.net.signGate = null;
  await page.waitForFunction(async (id) => {
    const { srcOf } = await import('/js/core/assets.js');
    return !!srcOf(__ctx.scene.tokens.find((t) => t.id === id)?.img);
  }, token.id);
  await tokenFace.locator('img').waitFor({ timeout: 5000 });
  assert.equal(await tokenFace.locator('img').evaluate(async (image) => { await image.decode(); return image.naturalWidth; }), 512);
  assert.equal(await tokenFace.locator('.tok-initials').count(), 0);
  await page.evaluate(async (id) => (await import('/js/views/table/sheet.js')).openStatblock(__ctx, id), token.id);
  await page.getByRole('button', { name: 'Атака: Адское копьё', exact: true }).waitFor();
  const labels = ['Урон: Адское копьё (колющий)', 'Урон: Адское копьё (огонь)'];
  for (const label of labels) { const b = page.getByRole('button', { name: label, exact: true }); await b.click(); }
  await page.evaluate(async () => (await import('/js/server/sync.js')).whenSynced(__ctx.cid));
  assert.ok(fake.T.log_entries.some((l) => l.author === uid && /колющий/.test(l.data.label || ''))); assert.ok(fake.T.log_entries.some((l) => l.author === uid && /огонь/.test(l.data.label || '')));
  const loadedPortrait = await page.waitForFunction(async () => {
    const node = document.querySelector('.sheet-drawer .s-portrait img'); if (!node) return false;
    const url = node.getAttribute('src');
    if (!url) return false;
    const image = new Image(); image.src = url;
    try { await image.decode(); return image.naturalWidth === 512 ? image.naturalWidth : false; } catch { return false; }
  });
  assert.equal(await loadedPortrait.jsonValue(), 512); await loadedPortrait.dispose();
  await page.getByRole('button', { name: 'Атака: Адское копьё', exact: true }).waitFor();
  const rects = await page.locator('.sheet-drawer .s-chips button').evaluateAll((buttons) => buttons.map((b) => b.getBoundingClientRect().toJSON()));
  assert.equal(rects.length, 3); for (const r of rects) assert.ok(r.x >= 0 && r.x + r.width <= (uid === A ? 1440 : 390));
  // Изменения библиотеки влияют на новые постановки, прежняя копия остаётся прежней.
  await page.evaluate(async (id) => { const lib = await import('/js/core/library.js'); const c = (await lib.listCreatures()).find((x) => x.id === id); __ctx.ui.myLib = { list: [structuredClone(c)] }; c.actions[0].attack.bonus = 12; await lib.saveCreature(c); }, template.id);
  if (uid === A) {
    rejectPlacement = true; const count = fake.T.tokens.length; await place(); assert.equal(fake.T.tokens.length, count);
    await page.getByText('Существо не поставлено', { exact: true }).waitFor(); rejectPlacement = false;
  }
  fallback = uid === B; await place();
  const next = fake.T.tokens.at(-1); assert.notEqual(next.data.monsterId, token.data.monsterId);
  assert.equal(fake.T.campaign_creatures.find((c) => c.id === next.data.monsterId.slice(4)).data.actions[0].attack.bonus, 12);
  assert.equal(copy.data.actions[0].attack.bonus, 10);
  await page.reload(); await page.waitForFunction(() => !!window.__ctx?.scene);
  assert.ok(await page.evaluate((id) => __ctx.scene.tokens.some((t) => t.id === id), next.id));
  const cardToken = await page.evaluate(async () => {
    const { placeCreature } = await import('/js/views/table/own-creature.js');
    const t = await placeCreature(__ctx, { name: 'Карточка', size: 'tiny', side: 'friendly', hidden: false, ac: '12', hp: '7', speed: '30', fly: '', init: '', img: '' });
    return t.id;
  });
  assert.ok(fake.T.tokens.some((t) => t.id === cardToken));
  const ownToken = await page.evaluate(async () => (await (await import('/js/views/table/p-side.js')).placeOwnToken(__ctx, { name: 'Сова', size: 'tiny' })).id);
  assert.ok(fake.T.tokens.some((t) => t.id === ownToken));
  await page.reload(); await page.waitForFunction(() => !!window.__ctx?.scene);
  assert.ok(await page.evaluate((id) => __ctx.scene.tokens.some((t) => t.id === id), cardToken));
  assert.ok(await page.evaluate((id) => __ctx.scene.tokens.some((t) => t.id === id), ownToken));
  console.log(uid === A ? 'Мастер 1440px: библиотека, кадр, RPC/ACK, отказ, reload, оба типа урона, новая версия OK' : 'Игрок 390px: библиотека, кадр, призыв, fallback, reload, оба типа урона OK');
  await context.close();
}
assert.deepEqual(errors, []);
} finally { await browser.close(); }
