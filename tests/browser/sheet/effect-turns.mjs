// #193: смена хода на настоящем столе: Героизм даёт временные хиты, Удержание бросает спасбросок, длительность кончается.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const browser=await chromium.launch({args:['--disable-webgl'],executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined});
try {
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());
 await page.goto('http://127.0.0.1:4173/?server=0');
 await page.evaluate(async()=>{(await import('/js/core/auth.js')).signIn({userId:'u-sol'});location.hash='#/c/c-crypt';});
 await page.waitForSelector('.viewport');
 await page.waitForFunction(async()=>!!(await import('/js/rules/effect-rows.js')).recipeOf('dndsu:spell:42'));
 const setup=await page.evaluate(async()=>{
  const {updateCampaign,getCampaign}=await import('/js/core/campaign.js');
  const {startCombat,initiativeOrder}=await import('/js/views/table/combat.js');
  let ids;
  updateCampaign('c-crypt',c=>{
   const s=c.scenes.find(x=>x.id===c.activeSceneId)||c.scenes[0];
   const ts=s.tokens.filter(t=>t.kind==='foe'||t.kind==='hero').slice(0,3);
   for(const t of ts)t.hidden=false;
   const rolls=Object.fromEntries(ts.map((t,i)=>[t.id,20-i]));
   startCombat(c,s,ts.map(t=>t.id),rolls);
   ids=initiativeOrder(c,s).map(e=>e.tokenId);
   const [a,b]=ids;
   c.effects=[
    {id:'hold-1',target:a,ref:'dndsu:spell:356',cast:'k1',dc:99},
    {id:'hero-1',target:b,ref:'dndsu:spell:42',cast:'k2',casterMod:4},
    {id:'bless-1',target:b,ref:'dndsu:spell:9',cast:'k3',until:1}];
  });
  return {ids,round:getCampaign('c-crypt').combat.round};
 });
 assert.ok(setup.ids.length>=2,'нужны два участника: '+JSON.stringify(setup));
 await page.waitForTimeout(100);
 const next=()=>page.evaluate(async()=>{
  const {updateCampaign}=await import('/js/core/campaign.js');
  const {advanceTurn}=await import('/js/views/table/combat.js');
  updateCampaign('c-crypt',c=>advanceTurn(c,c.scenes.find(x=>x.id===c.activeSceneId)||c.scenes[0]));
 });
 await next();
 await page.waitForFunction(async()=>{const c=(await import('/js/core/campaign.js')).getCampaign('c-crypt');return c.log.some(l=>/спасбросок/.test(l.label||''));});
 const s=await page.evaluate(async(b)=>{
  const {getCampaign,tokenStats}=await import('/js/core/campaign.js');
  const c=getCampaign('c-crypt'),sc=c.scenes.find(x=>x.id===c.activeSceneId)||c.scenes[0];
  return {temp:tokenStats(c,sc.tokens.find(t=>t.id===b)).tempHp,effects:c.effects.map(e=>e.id),save:c.log.find(l=>/спасбросок/.test(l.label||''))?.label,text:c.log.slice(0,6).map(l=>l.text||l.label)};
 },setup.ids[1]);
 assert.equal(s.temp,4,'Героизм: '+JSON.stringify(s));
 assert.match(s.save,/Мудрость|Мудр/);assert.match(s.save,/СЛ 99/);
 assert.ok(s.effects.includes('hold-1'),'СЛ 99 не пройти: Удержание держится');
 assert.ok(!s.effects.includes('bless-1'),'длительность кончилась в начале хода цели');
 assert.deepEqual(errors,[]);
 console.log('effect turns browser OK: временные хиты, спасбросок, истечение');
} finally { await browser.close(); }
