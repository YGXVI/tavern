// Локальный dist на 4173; Playwright из окружения, BROWSER_EXECUTABLE_PATH при необходимости.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const errors = [];
await context.route('**/js/views/table/index.js', async (route) => {
  const response = await route.fetch();
  await route.fulfill({ response, body: (await response.text()).replace('ctx.panels = new Panels(ctx);', 'ctx.panels = new Panels(ctx); window.__ctx = ctx;') });
});
await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
async function login(user) {
  const p = await context.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(() => {
    if (sessionStorage.getItem('token-image-test-login')) return;
    localStorage.removeItem('rasputye-v2-last-user'); sessionStorage.removeItem('rasputye-v2-session');
    sessionStorage.setItem('token-image-test-login', '1');
  });
  await p.goto('http://localhost:4173/?server=0#/login');
  await p.getByRole('button', { name: 'Войти через Discord' }).click();
  await p.locator(`[data-u="${user}"]`).click();
  await p.getByRole('button', { name: 'Авторизовать' }).click();
  await p.evaluate(() => { location.hash = '#/c/c-crypt'; });
  await p.waitForFunction(() => !!window.__ctx?.scene);
  return p;
}
async function open(p, id) {
  await p.evaluate(async (id) => (await import('/js/views/table/p-token.js')).setTokenImage(__ctx, id), id);
  await p.locator('[data-save]:enabled').waitFor();
}
const token = (p, id) => p.evaluate((id) => __ctx.scene.tokens.find((t) => t.id === id).img, id);
try {
  const page = await login('u-sol');
  await page.evaluate(() => __ctx.mutateScene((s) => {
    s.tokens.push({ id: 'image-test', kind: 'foe', monsterId: 'goblin', name: 'Гоблин', img: 'goblin', size: 'medium', x: 400, y: 400 });
    s.tokens.push({ id: 'image-own', kind: 'custom', ownerId: 'u-asya', name: 'Сова', img: 'ini:Сова', size: 'medium', x: 450, y: 400 });
  }));
  await open(page, 'image-test');
  const initial = await token(page, 'image-test');
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 100; c.height = 400;
    const g = c.getContext('2d');
    g.fillStyle = 'red'; g.fillRect(0, 0, 100, 100);
    g.fillStyle = 'blue'; g.fillRect(0, 100, 100, 200);
    g.fillStyle = 'lime'; g.fillRect(0, 300, 100, 100);
    return c.toDataURL('image/png').split(',')[1];
  });
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-upload]').click();
  await (await chooser).setFiles({ name: 'full-body.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.locator('[data-save]:enabled').waitFor();
  assert.equal(await token(page, 'image-test'), initial, 'загрузка не меняет токен до сохранения');
  const color = () => page.locator('[data-preview]').evaluate((c) => Array.from(c.getContext('2d').getImageData(256, 256, 1, 1).data));
  assert.deepEqual(await color(), [0, 0, 255, 255]);
  const bounds = await page.locator('[data-preview]').boundingBox();
  await page.mouse.move(bounds.x + 128, bounds.y + 128); await page.mouse.down();
  await page.mouse.move(bounds.x + 128, bounds.y + 128 + 256 * 1.5, { steps: 5 }); await page.mouse.up();
  assert.deepEqual(await color(), [255, 0, 0, 255], 'голова перемещается в центр');
  await page.locator('[data-fit]').click();
  assert.ok(Number(await page.locator('[data-zoom]').inputValue()) < 0.25);
  await page.locator('[data-save]').click();
  await page.locator('.token-image-modal').waitFor({ state: 'detached' });
  const cropped = await token(page, 'image-test'); assert.match(cropped, /^idb:/);
  const pixels = await page.evaluate(async (ref) => {
    const url = await (await import('/js/core/assets.js')).resolveSrc(ref);
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = c.height = 512;
    c.getContext('2d').drawImage(img, 0, 0);
    return [40, 256, 470].map((y) => Array.from(c.getContext('2d').getImageData(256, y, 1, 1).data));
  }, cropped);
  assert.ok(pixels[0][0] > 200 && pixels[0][1] < 40, 'голова видна целиком');
  assert.ok(pixels[2][1] > 200 && pixels[2][0] < 40, 'ноги видны целиком');
  await page.evaluate(() => __ctx.history.undo(__ctx)); assert.equal(await token(page, 'image-test'), initial);
  await page.evaluate(() => __ctx.history.redo(__ctx)); assert.equal(await token(page, 'image-test'), cropped);
  await page.reload(); await page.waitForFunction(() => !!window.__ctx?.scene);
  const reloadedFace = page.locator('[data-token="image-test"] .tok-ring');
  await reloadedFace.locator('img').waitFor({ timeout: 5000 });
  assert.equal(await reloadedFace.locator('img').evaluate(async (image) => { await image.decode(); return image.naturalWidth; }), 512);
  assert.equal(await reloadedFace.locator('.tok-initials').count(), 0);
  await open(page, 'image-test');
  await page.locator('[data-default]').click(); await page.locator('[data-save]:enabled').waitFor();
  await page.locator('[data-save]').click(); await page.locator('.token-image-modal').waitFor({ state: 'detached' });
  assert.equal(await token(page, 'image-test'), 'assets/portraits/srd/goblin.webp');
  await open(page, 'image-test'); await page.locator('[data-center]').click();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  assert.equal(await token(page, 'image-test'), 'assets/portraits/srd/goblin.webp');
  await page.evaluate((ref) => __ctx.mutateScene((s, c) => {
    const t = s.tokens.find((x) => x.id === 'image-own');
    const hero = s.tokens.find((x) => x.characterId === c.members.find((m) => m.userId === 'u-asya')?.characterId);
    t.img = ref;
    if (hero) { t.x = hero.x; t.y = hero.y; }
  }), cropped);
  console.log('мастер: кадрирование, полный рост, сохранение, undo/redo, перезагрузка, стандартный портрет, отмена OK');
  const player = await login('u-asya');
  await player.setViewportSize({ width: 390, height: 844 });
  await player.reload(); await player.waitForFunction(() => !!window.__ctx?.scene);
  const playerFace = player.locator('[data-token="image-own"] .tok-ring');
  await playerFace.locator('img').waitFor({ timeout: 5000 });
  assert.equal(await playerFace.locator('img').evaluate(async (image) => { await image.decode(); return image.naturalWidth; }), 512);
  assert.equal(await playerFace.locator('.tok-initials').count(), 0);
  await player.evaluate(async () => (await import('/js/views/table/p-token.js')).setTokenImage(__ctx, 'image-test'));
  assert.equal(await player.locator('.token-image-modal').count(), 0, 'игрок не меняет чужой токен');
  await open(player, 'image-own');
  await player.locator('[data-default]').click(); await player.locator('[data-save]:enabled').waitFor();
  const rect = await player.locator('.token-image-modal').boundingBox();
  assert.ok(rect.x >= 0 && rect.x + rect.width <= 390 && rect.y >= 0 && rect.y + rect.height <= 844);
  await player.locator('[data-save]').click(); await player.locator('.token-image-modal').waitFor({ state: 'detached' });
  assert.equal(await token(player, 'image-own'), 'ini:Сова');
  await open(player, 'image-own');
  await player.locator('[data-save]').click(); await player.locator('.token-image-modal').waitFor({ state: 'detached' });
  assert.equal(await token(player, 'image-own'), 'ini:Сова', 'сохранение без правок не создаёт файл');
  await player.evaluate(async () => {
    const { tokenImageEditor } = await import('/js/views/table/token-image.js');
    tokenImageEditor({ ref: 'ini:Сова', toast: __ctx.toast,
      store: async () => { throw new Error('Хранилище недоступно'); },
      done: () => { throw new Error('Ошибка загрузки не должна применять картинку'); },
    });
  });
  await player.locator('[data-save]:enabled').waitFor(); await player.locator('[data-center]').click();
  await player.locator('[data-save]').click();
  await player.getByText('Хранилище недоступно', { exact: true }).waitFor();
  assert.equal(await token(player, 'image-own'), 'ini:Сова');
  await player.keyboard.press('Escape'); await player.locator('.token-image-modal').waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  console.log('игрок: права владельца, стандартные инициалы, 390px, ошибок JS нет OK');
} finally { await browser.close(); }
