// Постоянный NPC (TASK-004 5.1–5.4), песочница: новый лист из панели мастера, статблок на столе, независимость копий и токена.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.setDefaultTimeout(10000);
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
await page.goto('http://127.0.0.1:4173/?server=0');
await page.evaluate(async () => { const { signIn } = await import('/js/core/auth.js'); signIn({ userId: 'u-sol' }); location.hash = '#/c/c-crypt'; });
await page.waitForSelector('.viewport');
await page.waitForTimeout(800);
const chars = () => page.evaluate(async () => (await import('/js/core/campaign.js')).getCampaign('c-crypt').characters);
const tokenOf = (id) => page.evaluate(async (id) => (await import('/js/core/campaign.js')).getCampaign('c-crypt').scenes.flatMap((s) => s.tokens).filter((t) => t.characterId === id).length, id);

async function newNpc(name, value) {
  await page.click('[data-act="add:hero"]');
  await page.click('[data-new-npc]');
  await page.waitForSelector('[data-create-source]');
  await page.fill('[data-create-name]', name);
  if (value) await page.selectOption('[data-create-source]', value);
  await page.click('[data-create-ok]');
  await page.waitForSelector('.sheet-editor');
  await page.click('[data-close-sheet]');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return (await chars()).find((c) => c.name === name);
}

// Создание: из каталога (в том числе встроенный гоблин) и вручную.
const a = await newNpc('Снага', 'goblin'), b = await newNpc('Гришнак', 'goblin'), manual = await newNpc('Безымянный', '');
assert.equal(a.profile, 'creature'); assert.equal(a.ac, 15); assert.equal(a.hpMax, 7);
assert.ok(a.portrait, 'портрет из каталога');
assert.equal(manual.hp, null, 'неизвестные числа остаются неизвестными');
assert.equal(await tokenOf(a.id), 0, 'лист создан без токена');

// На карту — из того же списка; статблок, а не лист героя.
await page.click('[data-act="add:hero"]');
await page.locator('.pick-pop .list-row', { hasText: 'Снага' }).locator('[data-place]').click();
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
assert.equal(await tokenOf(a.id), 1);
// Хиты одного экземпляра не трогают другой.
await page.evaluate(async (id) => { const { updateCampaign } = await import('/js/core/campaign.js'); updateCampaign('c-crypt', (c) => { c.characters.find((x) => x.id === id).hp = 2; }); }, a.id);
assert.equal((await chars()).find((c) => c.id === b.id).hp, 7, 'копии шаблона независимы');

const box = await page.evaluate(() => { const t = [...document.querySelectorAll('.tok')].find((e) => /Снага/.test(e.innerText)); const r = t.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await page.mouse.dblclick(box.x, box.y);
await page.waitForSelector('.monster-drawer');
const text = await page.locator('.monster-drawer').innerText();
assert.match(text, /Скимитар/, 'действия статблока видны');
assert.doesNotMatch(text, /null|undefined/);

// Копия раненого: новые ID, текущие числа, без управляющих и токена.
await page.click('[data-npc-edit]');
await page.waitForSelector('[data-copy-sheet]');
await page.click('[data-copy-sheet]');
await page.fill('[data-create-name]', 'Снага второй');
await page.click('[data-create-ok]');
await page.waitForTimeout(600);
const copy = (await chars()).find((c) => c.name === 'Снага второй');
assert.equal(copy.hp, 2); assert.notEqual(copy.id, a.id); assert.equal(copy.controllerIds, undefined); assert.equal(await tokenOf(copy.id), 0);

// Токен убран — лист остался.
await page.evaluate(async (id) => { const { updateCampaign } = await import('/js/core/campaign.js'); updateCampaign('c-crypt', (c) => { for (const s of c.scenes) s.tokens = s.tokens.filter((t) => t.characterId !== id); }); }, a.id);
assert.ok((await chars()).some((c) => c.id === a.id), 'лист живёт без токена');

assert.deepEqual(errors, []);
console.log('npc browser OK: панель мастера, каталог и ручной лист, статблок, независимость копий и токена, копия раненого');
await browser.close();
