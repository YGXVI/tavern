// Реальный DOM/Chromium, песочница. Серверные права отдельно проверяются PostgreSQL.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium }=createRequire(import.meta.url)('playwright');
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:900}}), errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());
await page.goto('http://127.0.0.1:4173/?server=0');
await page.evaluate(async()=>{const{signIn}=await import('/js/core/auth.js');signIn({userId:'u-sol'});location.hash='#/c/c-crypt';});
await page.waitForSelector('.viewport');
async function open(user='u-sol',id='ch-lira'){
 await page.evaluate(async({user,id})=>{
 const {openCharacterSheet}=await import('/js/views/table/sheet.js');const {getCampaign}=await import('/js/core/campaign.js');
 const ctx={cid:'c-crypt',userId:user,get c(){return getCampaign(this.cid)},root:document.querySelector('.table'),toast:()=>{},ui:{},panels:{}};
 openCharacterSheet(ctx,id);},{user,id});
 await page.waitForSelector('[data-field="name"]');
}
await open();
await page.locator('[data-field="name"]').fill('Лира — черновик');
await page.click('[data-tab="notes"]');await page.locator('[data-field="notes"]').fill('Не потерять при закрытии');await page.click('[data-close-sheet]');await page.click('[data-keep-close]');await open();
assert.equal(await page.locator('[data-field="name"]').inputValue(),'Лира — черновик');await page.click('[data-save]');
assert.equal(await page.evaluate(async()=> (await import('/js/core/campaign.js')).getCampaign('c-crypt').characters.find(c=>c.id==='ch-lira').notes),'Не потерять при закрытии');
await page.click('[data-tab="combat"]');await page.locator('[data-field="hp"]').fill('');await page.click('[data-save]');
assert.equal(await page.evaluate(async()=> (await import('/js/core/campaign.js')).getCampaign('c-crypt').characters.find(c=>c.id==='ch-lira').hp),null);
await page.locator('[data-field="hp"]').fill('12');await page.click('[data-save]');
await page.click('[data-tab="skills"]');await page.locator('details').first().locator('summary').click();
await page.locator('[data-field="proficiencies.saves.str"]').selectOption('2');await page.click('[data-save]');
assert.equal(await page.evaluate(async()=> (await import('/js/core/campaign.js')).getCampaign('c-crypt').characters.find(c=>c.id==='ch-lira').proficiencies.saves.str),2);
await page.click('[data-tab="features"]');await page.click('[data-add="resources"]');
await page.locator('[data-field="resources.0.name"]').fill('Восстановимый ресурс');await page.locator('[data-field="resources.0.max"]').fill('2');await page.locator('[data-field="resources.0.spent"]').fill('1');await page.locator('[data-field="resources.0.recovery"]').selectOption('short');await page.click('[data-save]');
await page.click('[data-tab="combat"]');await page.click('[data-add="hitDicePools"]');await page.locator('[data-field="hitDicePools.0.die"]').selectOption('10');await page.locator('[data-field="hitDicePools.0.total"]').fill('5');await page.locator('[data-field="hitDicePools.0.spent"]').fill('3');await page.click('[data-save]');
await page.click('[data-rest="short"]');await page.check('[data-eligible]');await page.locator('[data-roll-value]').fill('5');await page.click('[data-add-die]');await page.click('[data-apply-rest]');
const rested=await page.evaluate(async()=> (await import('/js/core/campaign.js')).getCampaign('c-crypt').characters.find(c=>c.id==='ch-lira'));
assert.equal(rested.hp,18);assert.equal(rested.hitDicePools[0].spent,4);assert.equal(rested.resources[0].spent,0);
await page.click('[data-tab="combat"]');await page.click('[data-rest="long"]');
assert.equal(await page.locator('[data-apply-rest]').isDisabled(),true);
await page.check('[data-eligible]');await page.click('[data-apply-rest]');
assert.equal(await page.evaluate(async()=> (await import('/js/core/campaign.js')).getCampaign('c-crypt').characters.find(c=>c.id==='ch-lira').hp),22);
assert.equal(await page.evaluate(async()=> (await import('/js/core/campaign.js')).getCampaign('c-crypt').characters.find(c=>c.id==='ch-lira').hitDicePools[0].spent),2);
await page.click('[data-tab="notes"]');await page.click('[data-archive]');await page.click('.modal [data-ok]');
assert.equal(await page.evaluate(async()=> (await import('/js/core/campaign.js')).getCampaign('c-crypt').characters.some(c=>c.id==='ch-lira')),false);
await page.click('[data-archive]');await page.click('.modal [data-ok]');
assert.equal(await page.evaluate(async()=> (await import('/js/core/campaign.js')).getCampaign('c-crypt').characters.some(c=>c.id==='ch-lira')),true);
await page.click('[data-close-sheet]');await open('u-timur');assert.equal(await page.locator('[data-field="name"]').isDisabled(),true);
await page.click('[data-tab="combat"]');assert.equal(await page.locator('[data-field="hp"]').isDisabled(),true);
await page.click('[data-close-sheet]');await open();await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);await page.screenshot({path:'/tmp/task004-sheet-mobile.png'});
const rect=await page.locator('.sheet-drawer').boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=391);
// Новый Sidekick из SRD: профиль, независимая база и рост после предпросмотра.
await page.click('[data-new-sheet]');await page.locator('[data-create-name]').fill('Кошка-напарник');await page.locator('[data-create-profile]').selectOption('sidekick');await page.locator('[data-create-source]').selectOption('srd:cat');await page.click('[data-create-ok]');
await page.waitForFunction(()=>document.querySelector('[data-field="name"]')?.value==='Кошка-напарник');await page.click('[data-tab="creature"]');await page.locator('[data-field="sidekick.hitDie"]').selectOption('4');await page.click('[data-save]');
await page.click('[data-growth]');await page.locator('[data-target-level]').fill('2');await page.locator('[data-growth-rolls]').fill('3');await page.click('[data-preview-growth]');await page.click('[data-apply-growth]');
const sidekick=await page.evaluate(async()=> (await import('/js/core/campaign.js')).getCampaign('c-crypt').characters.find(c=>c.name==='Кошка-напарник'));
assert.equal(sidekick.level,2);assert.equal(sidekick.hp,2);assert.equal(sidekick.hpMax,5);assert.equal(sidekick.statblock.baseSnapshot.hp,2);assert.equal(sidekick.sidekick.growthHistory.length,1);assert.ok(sidekick.statblock.templateVersion.startsWith('sha256:'));
await page.click('[data-copy-sheet]');await page.locator('[data-create-name]').fill('Вторая кошка');await page.click('[data-create-ok]');await page.waitForFunction(()=>document.querySelector('[data-field="name"]')?.value==='Вторая кошка');
const cats=await page.evaluate(async()=> (await import('/js/core/campaign.js')).getCampaign('c-crypt').characters.filter(c=>c.name.includes('кошка')||c.name.includes('Кошка')));assert.equal(cats.length,2);assert.notEqual(cats[0].id,cats[1].id);
assert.deepEqual(errors,[]);console.log('sheet browser OK: draft, tabs, close/reopen, save, unknown HP, expertise, readonly, long rest, archive/restore, 390px');
await browser.close();
