// Мини-очередь боя (#203): пока идёт бой, а полная «Инициатива» закрыта, очередь видна слева.
// Реальный DOM/Chromium, песочница (без сервера). Запуск: локальный dist на 4173 (`npm run dev`);
// Playwright из окружения, BROWSER_EXECUTABLE_PATH — необязательный Chrome.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) });
const errors = [];
// Один профиль браузера на всех: песочница делит кампанию между вкладками одного профиля.
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.route('**/js/views/table/index.js', async (route) => { const r = await route.fetch(); await route.fulfill({ response: r, body: (await r.text()).replace('ctx.panels = new Panels(ctx);', 'ctx.panels = new Panels(ctx); window.__ctx = ctx;') }); });
await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
async function open(user) {
  const p = await context.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.addInitScript(() => { localStorage.removeItem('rasputye-v2-last-user'); sessionStorage.removeItem('rasputye-v2-session'); });
  await p.goto('http://localhost:4173/?server=0#/login');
  await p.locator('[data-login]').click();
  await p.locator(`[data-u="${user}"]`).click(); await p.locator('[data-ok]').click();
  await p.waitForFunction(() => location.hash === '#/campaigns');
  await p.evaluate(() => { location.hash = '#/c/c-crypt'; });
  await p.waitForFunction(() => !!window.__ctx?.scene, {}, { timeout: 15000 });
  return p;
}
const widget = (p, w) => p.evaluate((w) => { __ctx.ui.widget = w; __ctx.panels.refreshWidget(); __ctx.invalidate('chrome'); }, w);
const mini = (p) => p.locator('.ch-init .init-mini');

try {
  const master = await open('u-sol');
  // Без боя мини-очереди нет.
  await widget(master, 'dice');
  assert.equal(await mini(master).count(), 0);
  // Бой: у Лиры инициатива не брошена — бросит игрок.
  await master.evaluate(async () => {
    const { updateCampaign } = await import('/js/core/campaign.js');
    const { startCombat } = await import('/js/views/table/combat.js');
    updateCampaign(__ctx.cid, (c) => {
      const sc = c.scenes.find((s) => s.id === __ctx.sceneId);
      const ids = sc.tokens.filter((t) => t.kind !== 'item').map((t) => t.id);
      const lira = sc.tokens.find((t) => t.characterId === 'ch-lira').id;
      startCombat(c, sc, ids, { [lira]: null });
    });
  });
  await widget(master, 'dice');
  await mini(master).waitFor();
  const total = await master.evaluate(() => __ctx.combatOrder().length);
  assert.equal(await mini(master).locator('.im-row').count(), total, 'мастер видит всех участников');
  assert.equal(await mini(master).locator('.im-row.current').count(), 1);
  assert.equal(await mini(master).evaluate((n) => n.classList.contains('rail')), false, 'рядом с кубами — строки с именами');
  // Не налезает на виджет кубов справа.
  const [mBox, dBox] = [await mini(master).boundingBox(), await master.locator('.ch-widget .dice-widget').boundingBox()];
  assert.ok(mBox.x + mBox.width <= dBox.x, 'мини-очередь левее кубов');
  console.log('dice open: mini queue on the left, all rows, current marked OK');

  // «Следующий ход» из мини-очереди.
  const before = await master.evaluate(() => __ctx.c.combat.turn);
  await mini(master).locator('[data-act="combat-next"]').click();
  await master.waitForFunction((b) => __ctx.c.combat.turn !== b, before);
  console.log('master next turn from mini OK');

  // Клик по строке — токен выделен.
  const id = await mini(master).locator('.im-who').nth(2).getAttribute('data-id');
  await mini(master).locator('.im-who').nth(2).click();
  assert.ok(await master.evaluate((id) => __ctx.ui.selection.has(id), id));
  console.log('row click selects token OK');

  // «Отряд» и «Зрение» — колонка портретов, не налезает на виджет.
  for (const w of ['party', 'vision']) {
    await widget(master, w);
    await master.waitForFunction(() => !!document.querySelector('.ch-init .init-mini.rail'));
    const [r, wb] = [await mini(master).boundingBox(), await master.locator('.ch-widget .widget').boundingBox()];
    assert.ok(r.x + r.width <= wb.x, `колонка левее виджета ${w}`);
    assert.equal(await mini(master).locator('.im-row').count(), total);
  }
  console.log('party/vision: portrait rail beside the widget OK');

  // Полная очередь открыта — мини нет; заголовок мини открывает полную.
  await widget(master, 'initiative');
  await master.waitForFunction(() => !document.querySelector('.ch-init .init-mini'));
  await widget(master, null);
  await mini(master).waitFor();
  await mini(master).locator('.im-head').click();
  await master.waitForFunction(() => __ctx.ui.widget === 'initiative' && !document.querySelector('.ch-init .init-mini'));
  console.log('header opens full initiative, mini hides OK');

  // Игрок: открыл кубы — очередь осталась; свою инициативу бросает прямо из мини.
  const player = await open('u-asya');
  await widget(player, 'dice');
  await mini(player).waitFor();
  const shown = await player.evaluate(() => __ctx.combatOrder().filter((e) => __ctx.tokenShown(e.token)).length);
  assert.equal(await mini(player).locator('.im-row').count(), shown, 'игрок видит только видимых ему');
  await mini(player).locator('[data-act="init-roll"]').click();
  await player.waitForFunction(() => {
    const t = __ctx.scene.tokens.find((x) => x.characterId === 'ch-lira');
    return __ctx.c.combat.entries.find((e) => e.tokenId === t.id)?.init != null;
  });
  console.log('player rolls own initiative from mini OK');

  // Телефон: при открытом виджете мини скрыта, без него — колонка портретов.
  await master.setViewportSize({ width: 390, height: 844 });
  await widget(master, 'dice');
  await master.waitForFunction(() => !document.querySelector('.ch-init .init-mini'));
  await widget(master, null);
  await master.waitForFunction(() => !!document.querySelector('.ch-init .init-mini.rail'));
  console.log('phone: hidden under widgets, rail otherwise OK');

  assert.deepEqual(errors, []);
  console.log('init-mini: all OK');
} finally {
  await browser.close();
}
