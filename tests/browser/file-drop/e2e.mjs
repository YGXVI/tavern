// Реальные File/DataTransfer/IndexedDB в Chromium, локальный dist:4173.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const errors = [];
await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
await context.route('**/js/views/table/index.js', async (route) => { const r = await route.fetch(); await route.fulfill({ response: r, body: (await r.text()).replace('ctx.panels = new Panels(ctx);', 'ctx.panels = new Panels(ctx); window.__ctx=ctx;') }); });
async function drop(page, selector, files, downloads = false) {
  const transfer = await page.evaluateHandle(({ files, downloads }) => {
    const dt = new DataTransfer();
    for (const f of files) { const bytes = f.large ? new Uint8Array(5 * 1024 * 1024 + 1) : Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0)); dt.items.add(new File([bytes], f.name, { type: f.type })); }
    if (downloads) dt.setData('DownloadURL', 'image/png:download.png:file:///Downloads/download.png');
    return dt;
  }, { files, downloads });
  const result = await page.evaluate(({ selector, transfer }) => {
    const node = document.querySelector(selector); if (!node) throw Error('Нет зоны '+selector);
    const r = node.getBoundingClientRect();
    node.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    const e = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
    node.dispatchEvent(e); return e.defaultPrevented;
  }, { selector, transfer });
  await transfer.dispose(); assert.equal(result, true, 'браузер не открывает файл вместо приложения');
}
async function login(user) {
  const p = await context.newPage(); p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(() => { if (!sessionStorage.getItem('drop-test-login')) { localStorage.removeItem('rasputye-v2-last-user'); sessionStorage.removeItem('rasputye-v2-session'); sessionStorage.setItem('drop-test-login', '1'); } });
  await p.goto('http://localhost:4173/?server=0#/login');
  await p.getByRole('button', { name: 'Войти через Discord' }).click(); await p.locator(`[data-u="${user}"]`).click(); await p.getByRole('button', { name: 'Авторизовать' }).click();
  await p.evaluate(() => { location.hash = '#/c/c-crypt'; }); await p.waitForFunction(() => !!window.__ctx?.scene); return p;
}
try {
for (const user of ['u-sol', 'u-asya']) {
  const page = await login(user);
  if (user === 'u-asya') await page.setViewportSize({ width: 390, height: 844 });
  const data = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 100; c.height = 400; const g = c.getContext('2d'); g.fillStyle = 'red'; g.fillRect(0, 0, 100, 100); g.fillStyle = 'blue'; g.fillRect(0, 100, 100, 200); g.fillStyle = 'lime'; g.fillRect(0, 300, 100, 100); return c.toDataURL('image/png').split(',')[1]; });
  const file = { name: `Страж ${user}.png`, type: user === 'u-sol' ? 'image/png' : '', data };
  const before = await page.evaluate(() => __ctx.scene.tokens.length), url = page.url();
  await drop(page, '.viewport', [file], user !== 'u-sol');
  const card = page.locator('.cc-popover'); await card.locator('[data-name]').waitFor();
  assert.equal(await card.locator('[data-name]').inputValue(), `Страж ${user}`);
  assert.ok(await card.locator('.cc-face img').evaluate((i) => !!i.src));
  assert.equal(await page.evaluate(() => __ctx.scene.tokens.length), before, 'пока открыт черновик, токен не создан');
  await card.locator('[data-n="ac"]').fill('12'); await card.locator('[data-n="hp"]').fill('8'); await card.locator('[data-opt="save"]').check();
  await card.locator('[data-ok]').click(); await card.waitFor({ state: 'detached' });
  const token = await page.evaluate(() => __ctx.scene.tokens.at(-1)); assert.match(token.img, /^idb:/); assert.equal(token.ac, 12);
  assert.equal(token.ownerId || null, user === 'u-sol' ? null : user); assert.equal(!!token.pending, user !== 'u-sol');
  await page.waitForFunction(async (name) => (await (await import('/js/core/library.js')).listCreatures()).some((c) => c.name === name), `Страж ${user}`);
  assert.equal(page.url(), url);
  await page.reload(); await page.waitForFunction(() => !!window.__ctx?.scene);
  const art = page.locator(`[data-token="${token.id}"] .tok-ring img`); await art.waitFor(); assert.equal(await art.evaluate(async (i) => { await i.decode(); return i.naturalWidth; }), 100);
  // Отказ без создания карточки, в том числе несколько файлов и слишком большой файл.
  for (const invalid of [[{ name: 'bad.pdf', type: 'application/pdf', data: btoa('PDF') }], [file, file], [{ name: 'large.png', type: 'image/png', data: '', large: true }]]) {
    await drop(page, '.viewport', invalid); await page.locator('.toast').filter({ hasText: /картинк|одну/i }).last().waitFor(); assert.equal(await card.count(), 0);
  }
  await page.evaluate(() => { location.hash = '#/creatures'; }); await page.locator('.lib-page [data-lib-new]').first().waitFor();
  const libraryFile = { ...file, name: `Библиотека ${user}.png`, type: 'image/png' };
  await drop(page, '.lib-page', [libraryFile]); const editor = page.locator('.lib-modal');
  await editor.getByRole('button', { name: 'Настроить картинку', exact: true }).waitFor();
  assert.equal(await editor.locator('[data-p="name"]').inputValue(), `Библиотека ${user}`);
  await editor.locator('[data-p="name"]').fill(`Своя форма ${user}`); await editor.locator('[data-p="ac"]').fill('17');
  const oldImage = await editor.locator('.lib-pic-face img').getAttribute('src');
  await drop(page, '.lib-modal', [{ ...libraryFile, name: 'replacement.png' }]);
  await editor.getByRole('button', { name: 'Настроить картинку', exact: true }).waitFor();
  assert.equal(await editor.count(), 1); assert.equal(await editor.locator('[data-p="name"]').inputValue(), `Своя форма ${user}`); assert.equal(await editor.locator('[data-p="ac"]').inputValue(), '17');
  assert.notEqual(await editor.locator('.lib-pic-face img').getAttribute('src'), oldImage);
  await editor.locator('[data-ok]').click(); await editor.waitFor({ state: 'detached' });
  await page.waitForFunction(async (name) => (await (await import('/js/core/library.js')).listCreatures()).some((c) => c.name === name && c.ac === 17 && c.img.startsWith('idb:')), `Своя форма ${user}`);
  // Ручное открытие новой полной формы также принимает файл и сохраняет введённое имя.
  await page.locator('[data-lib-new]').first().click(); await editor.locator('[data-p="name"]').fill('Черновик');
  await drop(page, '.lib-modal', [libraryFile]); await editor.getByRole('button', { name: 'Настроить картинку', exact: true }).waitFor(); assert.equal(await editor.locator('[data-p="name"]').inputValue(), 'Черновик');
  await editor.getByRole('button', { name: 'Отмена', exact: true }).click();
  assert.equal(await page.evaluate(async () => (await (await import('/js/core/library.js')).listCreatures()).some((c) => c.name === 'Черновик')), false);
  console.log(user, 'File/Downloads → карта → карточка → токен/библиотека → reload; страница/полная форма → арт; валидация/отмена OK');
  await page.close();
}
assert.deepEqual(errors, []);
} finally { await browser.close(); }
