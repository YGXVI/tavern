// #193, этап 2: состояния меняют бросок на обоих листах героя, на листе существа и в скорости токена.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const browser=await chromium.launch({args:['--disable-webgl'],executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined});
const base=process.env.SHEET_BASE||'http://127.0.0.1:4173/?server=0';
try {
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());
 await page.goto(base);
 await page.evaluate(async()=>{(await import('/js/core/auth.js')).signIn({userId:'u-sol'});location.hash='#/c/c-crypt';});
 await page.waitForSelector('.viewport');
 await page.evaluate(async()=>{
  const {emptySheet}=await import('/js/views/table/sheet-creature.js');
  const {updateCampaign}=await import('/js/core/campaign.js');
  updateCampaign('c-crypt',c=>{
   const ch=emptySheet({id:'cond-pc',ownerId:'u-sol',name:'Герой'});
   Object.assign(ch,{level:5,hp:20,hpMax:20,speed:30});ch.stats.str=16;ch.stats.dex=14;
   ch.attacks=[{id:'a',name:'Удар',ability:'str',proficient:true,bonus:null,damage:'1d6+3'}];
   c.characters.push(ch);
  });
 });
 const setConditions=(conditions,exhaustion=0)=>page.evaluate(async({conditions,exhaustion})=>{
  (await import('/js/core/campaign.js')).updateCampaign('c-crypt',c=>{Object.assign(c.characters.find(x=>x.id==='cond-pc'),{conditions,exhaustion});});
 },{conditions,exhaustion});
 const logs=()=>page.evaluate(async()=>(await import('/js/core/campaign.js')).getCampaign('c-crypt').log);
 const open=(tab)=>page.evaluate(async({tab})=>{
  const {openCharacterSheet}=await import('/js/views/table/sheet.js');
  const {getCampaign}=await import('/js/core/campaign.js');
  window.__toasts=[];
  openCharacterSheet({cid:'c-crypt',userId:'u-sol',get c(){return getCampaign(this.cid)},isMaster:true,
   root:document.querySelector('.table'),ui:{},panels:{},toast:(t)=>window.__toasts.push(t)},'cond-pc',tab);
 },{tab});
 const toasts=()=>page.evaluate(()=>window.__toasts);
 const closeAll=()=>page.evaluate(async()=>(await import('/js/views/table/sheet.js')).closeSheet?.());

 // Лист редактирования
 await setConditions(['poisoned']);await open('edit');
 await page.click('[data-tab="combat"]');await page.waitForSelector('[data-attack="0"]');
 await page.click('[data-attack="0"]');
 let last=(await logs())[0];
 assert.match(JSON.stringify(last),/помех|"adv":"dis"/,'отравленный атакует с помехой: '+JSON.stringify(last).slice(0,300));
 await closeAll();

 await setConditions([]);await open('edit');
 await page.click('[data-tab="combat"]');await page.waitForSelector('[data-attack="0"]');
 await page.click('[data-attack="0"]');
 assert.doesNotMatch(JSON.stringify((await logs())[0]),/помех|"adv":"dis"/,'без состояний бросок обычный');
 await closeAll();

 // Наложения: Благословение бросает свой куб, Порча вычитает свой
 const setEffects=(effects)=>page.evaluate(async({effects})=>{(await import('/js/core/campaign.js')).updateCampaign('c-crypt',c=>{c.effects=effects;});},{effects});
 await page.waitForFunction(async()=>!!(await import('/js/rules/effect-rows.js')).recipeOf('dndsu:spell:9'));
 await setEffects([{id:'e1',target:'cond-pc',ref:'dndsu:spell:9',cast:'k1'}]);await open('edit');
 await page.click('[data-tab="combat"]');await page.waitForSelector('[data-attack="0"]');
 await page.click('[data-attack="0"]');
 assert.match((await logs())[0].detail,/4/,'Благословение добавляет к4: '+(await logs())[0].detail);
 assert.match((await logs())[0].detail,/\+/);
 const blessed=(await logs())[0].detail;
 await closeAll();
 await setEffects([{id:'e2',target:'cond-pc',ref:'dndsu:spell:254',cast:'k2'}]);await open('edit');
 await page.click('[data-tab="combat"]');await page.waitForSelector('[data-attack="0"]');
 await page.click('[data-attack="0"]');
 assert.match((await logs())[0].label,/Порча −[1-4]/,'Порча вычитает: '+(await logs())[0].label);
 await closeAll();await setEffects([]);
 console.log('blessed roll:',blessed);

 // Лист героя
 await setConditions(['paralyzed']);await open();
 await page.waitForSelector('[data-roll^="Проверка"]');
 await page.click('[data-dtab="skills"]').catch(()=>{});
 const save=page.locator('[data-roll^="Спасбросок"][data-roll*="Сил"]').first();
 await save.waitFor({state:'attached',timeout:5000});
 const count=(await logs()).length;
 await save.evaluate(n=>n.click());
 assert.equal((await logs()).length,count,'парализованный не бросает спасбросок Силы');
 assert.match(JSON.stringify(await toasts()),/автопровал/);
 await closeAll();

 // Скорость на токене
 const speed=(conditions,exhaustion)=>page.evaluate(async({conditions,exhaustion})=>{
  const {tokenStats,updateCampaign,getCampaign}=await import('/js/core/campaign.js');
  updateCampaign('c-crypt',c=>{Object.assign(c.characters.find(x=>x.id==='cond-pc'),{conditions,exhaustion});});
  return tokenStats(getCampaign('c-crypt'),{characterId:'cond-pc'}).speed;
 },{conditions,exhaustion});
 assert.equal(await speed(['grappled'],0),0,'схваченный стоит');
 assert.equal(await speed([],2),15,'истощение 2 — половина');
 assert.equal(await speed([],0),30);
 assert.deepEqual(errors,[]);
 console.log('conditions browser OK: помеха и обычный бросок, автопровал, скорость схваченного и истощённого');
} finally { await browser.close(); }
