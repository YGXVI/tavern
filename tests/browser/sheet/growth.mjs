// TASK-004: реальный DOM песочницы; отмена, устаревший расчёт и выбранная группа Sidekick.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.goto('http://127.0.0.1:4173/?server=0');
  await page.evaluate(async () => {
    (await import('/js/core/auth.js')).signIn({ userId: 'u-sol' });
    location.hash = '#/c/c-crypt';
  });
  await page.waitForSelector('.viewport');
  await page.evaluate(async () => {
    const { emptySheet } = await import('/js/views/table/sheet-creature.js');
    const { updateCampaign, getCampaign } = await import('/js/core/campaign.js');
    const { openCharacterSheet } = await import('/js/views/table/sheet.js');
    updateCampaign('c-crypt', c => {
      const ch = emptySheet({ id: 'growth-sk', ownerId: 'u-sol', name: 'Напарник', profile: 'sidekick' });
      Object.assign(ch, { level: 4, hp: 6, hpMax: 20, tempHp: 3 });
      ch.stats.con = 14;
      ch.sidekick = { class: 'warrior', hitDie: 8, baseLevel: 4, baseSnapshot: { hp: 11 }, growthHistory: [] };
      ch.hitDicePools = [{ id: 'base', name: 'Базовые', die: 8, total: 2, spent: 1 }];
      c.characters.push(ch);
      for (const [id, level] of [['chosen-5', 5], ['chosen-6', 6], ['chosen-unknown', null]]) {
        const hero = emptySheet({ id, ownerId: 'u-sol', name: id }); hero.level = level; c.characters.push(hero);
      }
    });
    openCharacterSheet({ cid: 'c-crypt', userId: 'u-sol', get c() { return getCampaign(this.cid); },
      root: document.querySelector('.table'), ui: {}, panels: {}, toast: () => {} }, 'growth-sk', 'creature');
  });
  const actor = () => page.evaluate(async () => (await import('/js/core/campaign.js')).getCampaign('c-crypt').characters.find(c => c.id === 'growth-sk'));
  async function preview(target, rolls) {
    await page.click('[data-growth]');
    await page.locator('[data-target-level]').fill(String(target));
    await page.locator('[data-growth-rolls]').fill(rolls);
    await page.click('[data-preview-growth]');
  }
  const initial = await actor();
  await preview(5, '3');
  await page.locator('.modal [data-close]').click();
  assert.deepEqual(await actor(), initial, 'отмена не меняет лист');

  await preview(5, '3');
  await page.locator('[data-growth-rolls]').fill('4');
  await page.click('[data-apply-growth]');
  assert.match(await page.locator('[data-growth-preview]').innerText(), /Ввод изменился/);
  assert.deepEqual(await actor(), initial, 'изменённый ввод не применяет прежний расчёт');
  await page.click('[data-preview-growth]');
  await page.click('[data-apply-growth]');
  let current = await actor();
  assert.equal(current.level, 5); assert.equal(current.hpMax, 26); assert.equal(current.hp, 6);
  assert.deepEqual(current.sidekick.baseSnapshot, initial.sidekick.baseSnapshot);
  assert.equal(current.hitDicePools[1].operationId, current.sidekick.growthHistory[0].operationId);

  await preview(6, '1');
  await page.evaluate(async () => {
    (await import('/js/core/campaign.js')).updateCampaign('c-crypt', c => { c.characters.find(c => c.id === 'growth-sk').stats.con = 18; });
  });
  await page.click('[data-apply-growth]');
  assert.match(await page.locator('[data-growth-preview]').innerText(), /Лист изменился/);
  assert.equal(await page.locator('[data-growth-rolls]').inputValue(), '1');
  assert.equal((await actor()).level, 5);
  await page.click('[data-preview-growth]');
  await page.click('[data-apply-growth]');
  current = await actor();
  assert.equal(current.level, 6); assert.equal(current.hpMax, 31); assert.equal(current.hp, 6); assert.equal(current.tempHp, 3);
  assert.equal(current.sidekick.growthHistory.length, 2); assert.equal(current.hitDicePools.length, 3);
  assert.notEqual(current.hitDicePools[1].operationId, current.hitDicePools[2].operationId);

  await page.check('[data-party="chosen-5"]');
  assert.match(await page.locator('[data-party-hint]').innerText(), /Средний уровень: 5\./);
  await page.check('[data-party="chosen-6"]');
  assert.match(await page.locator('[data-party-hint]').innerText(), /Средний уровень: 5\.5/);
  await page.click('[data-save]');
  assert.deepEqual((await actor()).sidekick.partyIds,['chosen-5','chosen-6']);
  await page.check('[data-party="chosen-unknown"]');
  assert.match(await page.locator('[data-party-hint]').innerText(), /не определён/);
  for (const id of ['chosen-unknown', 'chosen-5', 'chosen-6']) await page.uncheck(`[data-party="${id}"]`);
  assert.match(await page.locator('[data-party-hint]').innerText(), /не определён/);
  await page.click('[data-save]');
  assert.deepEqual((await actor()).sidekick.partyIds,[]);
  assert.equal((await actor()).level, 6, 'подсказка не меняет уровень');
  assert.deepEqual(errors, []);
  console.log('growth browser OK: cancel, changed roll, stale CON/recalculate, operation pools, explicit group/fraction/unknown');
} finally { await browser.close(); }
