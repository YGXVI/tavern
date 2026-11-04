// Реальный DOM/Chromium, два демо-пользователя; сервер и настоящая авторизация не затрагиваются.
// Запуск: локальный dist на 4173; Playwright из окружения. BROWSER_EXECUTABLE_PATH — необязательный Chrome.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true, ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath:process.env.BROWSER_EXECUTABLE_PATH } : {})});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const errors=[];
await context.route('**/js/views/table/index.js',async route=>{const r=await route.fetch(); await route.fulfill({response:r,body:(await r.text()).replace('ctx.panels = new Panels(ctx);','ctx.panels = new Panels(ctx); window.__ctx = ctx;')});});
await context.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());
async function login(user){
 const p=await context.newPage(); await p.addInitScript(()=>{localStorage.removeItem('rasputye-v2-last-user');sessionStorage.removeItem('rasputye-v2-session');}); p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://localhost:4173/?server=0#/login'); 
 await p.getByRole('button',{name:'Войти через Discord'}).click();
 await p.locator(`[data-u="${user}"]`).click(); await p.getByRole('button',{name:'Авторизовать'}).click(); 
 await p.locator('a[href="#/c/c-crypt"]').first().click();  await p.waitForFunction(()=>!!window.__ctx?.scene,{},{timeout:15000});
 return p;
}
try {
const page=await login('u-sol');
const player=await login('u-asya');
console.log('master/player login OK');
const heroId=await page.evaluate(()=>__ctx.scene.tokens.find(t=>t.characterId==='ch-lira').id);
async function hero(){return page.evaluate(()=>__ctx.c.characters.find(c=>c.id==='ch-lira'));}
async function setupHero(values){await page.evaluate(async values=>{const{updateCampaign}=await import('/js/core/campaign.js');updateCampaign(__ctx.cid,c=>Object.assign(c.characters.find(c=>c.id==='ch-lira'),values));},values);}
await setupHero({hp:10,hpMax:22,tempHp:2,conditions:['concentration'],deathSaves:{s:1,f:1}});
await page.evaluate(id=>__ctx.panels.hpEditor(id,{x:300,y:300},'dmg'),heroId);
await page.locator('.hp-editor [data-v]').fill('7');
await page.locator('.hp-editor [data-rel="resist"]').click();await page.locator('.hp-editor [data-dmg]').click();
assert.equal((await hero()).hp,9);assert.equal((await hero()).tempHp,0);
await page.evaluate(id=>__ctx.panels.commitHp(id,'0'),heroId);
assert.deepEqual((await hero()).conditions,['unconscious','prone']);
await page.evaluate(id=>__ctx.panels.applyHp([id],3),heroId);
assert.deepEqual((await hero()).conditions,['prone']);assert.deepEqual((await hero()).deathSaves,{s:0,f:0});
await player.waitForFunction(()=>__ctx.c.characters.find(c=>c.id==='ch-lira').hp===3);
console.log('HP editor resistance, temp HP, drop, heal, second tab sync OK');
await setupHero({hp:20,tempHp:2,conditions:['restrained']});
await page.evaluate(id=>__ctx.panels.requestSaves({ability:'dex',dc:1,label:'Проверка помехи',tokenIds:[id],damage:'1d4+11',half:true}),heroId);
await player.getByText('С помехой — опутан',{exact:true}).waitFor();
const reqId=await page.evaluate(()=>__ctx.c.saveRequests.at(-1).id);
await player.locator(`[data-act="save-roll"][data-id="${reqId}"]:not([data-adv])`).click();
await page.waitForFunction(({reqId,heroId})=>!!__ctx.c.saveRequests.find(r=>r.id===reqId)?.results[heroId],{reqId,heroId});
const res=await page.evaluate(({reqId,heroId})=>__ctx.c.saveRequests.find(r=>r.id===reqId).results[heroId],{reqId,heroId});
assert.match(res.detail,/С помехой — опутан/);assert.equal(res.ok,true);
assert.deepEqual(Object.keys(res).sort(),['by','detail','nat','ok','total']);
await page.locator(`[data-act="save-rel"][data-id="${reqId}"][data-rel="resist"]`).click();
await page.locator(`[data-act="save-apply"][data-id="${reqId}"]`).click();assert.equal((await hero()).hp,19);
console.log('restrained player DEX disadvantage, save schema, half then resistance then temp HP OK');
await setupHero({hp:0,tempHp:0,conditions:['unconscious','prone']});
await page.evaluate(id=>__ctx.panels.requestSaves({ability:'str',dc:10,label:'Автопровал героя',tokenIds:[id]}),heroId);
const autoId=await page.evaluate(()=>__ctx.c.saveRequests.at(-1).id);
await player.locator(`[data-act="save-roll"][data-id="${autoId}"]:not([data-adv])`).waitFor();
const before=await player.evaluate(()=>__ctx.c.log.filter(l=>l.kind==='save').length);
await player.locator(`[data-act="save-roll"][data-id="${autoId}"]:not([data-adv])`).click();
await page.waitForFunction(({autoId,heroId})=>__ctx.c.saveRequests.find(r=>r.id===autoId)?.results[heroId]?.nat===null,{autoId,heroId});
assert.equal(await player.evaluate(()=>__ctx.c.log.filter(l=>l.kind==='save').length),before);
console.log('unconscious player STR auto failure without roll OK');
await page.evaluate(async()=>{
 const{updateCampaign}=await import('/js/core/campaign.js'); const{loadSrdBestiary,BESTIARY}=await import('/js/data/bestiary.js');await loadSrdBestiary();
 const m=BESTIARY.find(m=>m.actions?.some(a=>/melee/i.test(a.desc||'')&&Number.isFinite(a.bonus))&&m.actions?.some(a=>a.ru));
 if(!m)throw Error('SRD creature with translated melee missing');
 updateCampaign(__ctx.cid,c=>{const sc=c.scenes.find(s=>s.id===__ctx.sceneId);sc.tokens.push({id:'test-srd',name:m.name,monsterId:m.id,kind:'foe',hp:m.hp,hpMax:m.hp,ac:m.ac,x:500,y:500,size:m.size});});
 const{openStatblock}=await import('/js/views/table/sheet.js');openStatblock(__ctx,'test-srd');
});
await page.locator('.sheet-drawer .atk-desc[lang="ru"]').first().waitFor();
const ru=await page.locator('.sheet-drawer .atk-desc').first().innerText();
await page.locator('[data-stat-lang="en"]').click();
assert.notEqual(await page.locator('.sheet-drawer .atk-desc').first().innerText(),ru);
assert.equal(await page.locator('.sheet-drawer .atk-desc').first().getAttribute('lang'),'en');
await page.locator('[data-close-sheet]').click();
await page.evaluate(async()=>{const{openStatblock}=await import('/js/views/table/sheet.js');openStatblock(__ctx,'test-srd');});
assert.equal(await page.locator('[data-stat-lang="en"]').getAttribute('aria-pressed'),'true');
assert.match(await page.locator('.sheet-drawer').innerText(),/CC BY 4.0/);
await page.locator('[data-close-sheet]').click();
console.log('RU/EN statblock, session choice, lang, attribution OK');
await page.evaluate(async heroId=>{
 const{opportunityForMaster}=await import('/js/views/table/p-map.js');
 window.savedToast=__ctx.toast;window.opportunityActions=[];window.opportunityMessages=[];
 __ctx.toast=opts=>{opportunityMessages.push(opts.title+' '+(opts.body||''));if(opts.action)opportunityActions.push(opts.action.onClick);};
 opportunityForMaster(__ctx,{tokenId:heroId,foes:['test-srd']});opportunityForMaster(__ctx,{tokenId:heroId,foes:['test-srd']});
 opportunityActions[0]();const n=__ctx.c.log.filter(x=>x.kind==='attack').length;
 opportunityActions[1]();if(__ctx.c.log.filter(x=>x.kind==='attack').length!==n)throw Error('repeated reaction roll');
 if(!opportunityMessages.some(t=>t.includes('Реакция уже потрачена')))throw Error('missing reaction explanation');
 __ctx.toast=savedToast;
},heroId);
console.log('opportunity attack duplicate notification blocked OK');
await page.evaluate(async heroId=>{
 const{updateCampaign}=await import('/js/core/campaign.js');
 updateCampaign(__ctx.cid,c=>{c.scenes.find(s=>s.id===__ctx.sceneId).tokens.find(t=>t.id==='test-srd').conditions=['stunned'];});
 const n=__ctx.c.log.filter(l=>l.kind==='save').length;
 __ctx.panels.requestSaves({ability:'str',dc:10,label:'Автопровал существа',tokenIds:['test-srd']});
 const r=__ctx.c.saveRequests.at(-1).results['test-srd'];
 if(r.nat!==null||r.ok!==false||r.by!=='master')throw Error('master automatic save schema');
 __ctx.panels.requestSaves({ability:'str',dc:10,label:'Мастер за героя',tokenIds:[heroId]});
 const id=__ctx.c.saveRequests.at(-1).id;__ctx.panels.rollSave(id,heroId,null,true);
 const hero=__ctx.c.saveRequests.at(-1).results[heroId];
 if(hero.nat!==null||hero.ok!==false||hero.by!=='master')throw Error('master rollSave automatic failure');
 if(__ctx.c.log.filter(l=>l.kind==='save').length!==n)throw Error('auto failure rolled a die');
},heroId);
console.log('master automatic creature saves and master rolling for hero without dice OK');
for(const p of [page,player]){
 for(const width of [390,720]){
  await p.setViewportSize({width,height:900});
  if(!await p.locator('.dice-rail').count())await p.locator('[data-act="w-dice"]').click();
  await p.locator('.dice-rail').waitFor();
  const boxes=await p.locator('.dice-rail button').evaluateAll(bs=>bs.map(b=>{const r=b.getBoundingClientRect();return{x:r.x,right:r.right,y:r.y,bottom:r.bottom};}));
  assert.equal(await p.locator('.rail-options-break').evaluate(b=>b.getBoundingClientRect().height),0);
  assert.ok(boxes.every(b=>b.x>=0&&b.right<=width),`all dice controls visible at ${width}: ${JSON.stringify(boxes)}`);
  for(const act of ['dice-vis-menu','dice-mod-menu','dice-adv'])assert.ok(await p.locator(`.dice-rail [data-act="${act}"]`).isVisible());
  await p.locator('.dice-rail [data-act="dice-mod-menu"]').click();await p.locator('.dice-pop').waitFor();
  await p.keyboard.press('Escape');
  if(p===page && process.env.TABLE_SCREENSHOT_DIR)await p.screenshot({path:`${process.env.TABLE_SCREENSHOT_DIR}/table-dice-${width}.png`});
 }
}
assert.deepEqual(errors,[]);
console.log('390/720 px dice controls for master/player and JS errors OK');
} finally { await browser.close(); }
