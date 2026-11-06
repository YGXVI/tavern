// TASK-004: реальные клики и броски, без 3D. Никаких автоматических эффектов текста/урона.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const browser=await chromium.launch({args:['--disable-webgl']});
try {
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());
 await page.goto('http://127.0.0.1:4173/?server=0');
 await page.evaluate(async()=>{(await import('/js/core/auth.js')).signIn({userId:'u-sol'});location.hash='#/c/c-crypt';});
 await page.waitForSelector('.viewport');
 await page.evaluate(async()=>{
  const {emptySheet}=await import('/js/views/table/sheet-creature.js');
  const {updateCampaign}=await import('/js/core/campaign.js');
  updateCampaign('c-crypt',c=>{
   const ch=emptySheet({id:'action-pc',ownerId:'u-sol',name:'Герой'});
   Object.assign(ch,{level:5,hp:9,hpMax:20,tempHp:4});ch.stats.str=16;
   ch.attacks=[{id:'calc',name:'Расчётная атака',ability:'str',proficient:true,bonus:null,damage:'1d6+3'},
    {id:'zero',name:'Нулевой итог',bonus:0,damage:'1d4'},
    {id:'unknown',name:'Неизвестный бонус',bonus:null,ability:'',damage:'1d4'}];
   ch.actions=[{id:'action',name:'Явная формула',formula:'1d4+2',description:'Описание наносит 999 урона, но не исполняется'},
    {id:'text',name:'Только текст',description:'Брось 20d20+999'},
    {id:'invalid',name:'Не формула',formula:'globalThis.executedFromAction=true'}];
   ch.bonusActions=[{id:'bonus',name:'Бонусный бросок',formula:'1d6'}];
   ch.reactions=[{id:'reaction',name:'Реакция вручную',formula:'1d8'}];
   ch.resources=[{id:'r',name:'Заряды',max:3,spent:1}];c.characters.push(ch);
   c.characters.push({...structuredClone(ch),id:'action-npc',profile:'creature',name:'NPC'});
  });
 });
 async function open(id,user='u-sol'){
  await page.evaluate(async({id,user})=>{
   const {openCharacterSheet}=await import('/js/views/table/sheet.js');
   const {getCampaign}=await import('/js/core/campaign.js');
   openCharacterSheet({cid:'c-crypt',userId:user,get c(){return getCampaign(this.cid)},isMaster:user==='u-sol',
    root:document.querySelector('.table'),ui:{},panels:{},toast:()=>{}},id,'combat');
  },{id,user});
  await page.waitForSelector('[data-attack="0"]');
 }
 const state=()=>page.evaluate(async()=>{const c=(await import('/js/core/campaign.js')).getCampaign('c-crypt');return{pc:c.characters.find(c=>c.id==='action-pc'),npc:c.characters.find(c=>c.id==='action-npc'),scenes:c.scenes,log:c.log};});
 await open('action-pc');
 const before=await state();
 assert.match(await page.locator('[data-attack="0"]').innerText(),/\+6/);
 await page.click('[data-attack="0"]');
 let after=await state();assert.equal(after.log.length,before.log.length+1);assert.equal(after.log[0].total-after.log[0].nat,6);
 await page.click('[data-attack="1"]');after=await state();assert.equal(after.log[0].total-after.log[0].nat,0);
 let count=after.log.length;await page.click('[data-attack="2"]');assert.equal((await state()).log.length,count);
 await page.click('[data-damage="0"]');count++;
 await page.click('[data-action-formula="actions.0"]');count++;
 assert.equal(await page.locator('[data-action-formula="actions.1"]').count(),0,'текст сам не становится формулой');
 await page.click('[data-action-formula="actions.2"]');assert.equal((await state()).log.length,count);
 assert.equal(await page.evaluate(()=>globalThis.executedFromAction),undefined);
 await page.click('[data-action-formula="bonusActions.0"]');count++;
 await page.click('[data-action-formula="reactions.0"]');count++;
 after=await state();assert.equal(after.log.length,count);assert.deepEqual(after.pc,before.pc);assert.deepEqual(after.scenes,before.scenes);
 await open('action-npc','u-asya');count=(await state()).log.length;await page.click('[data-attack="0"]');assert.equal((await state()).log.length,count,'игра за товарища не расширяется на NPC');
 await open('action-pc','u-asya');await page.click('[data-attack="0"]');assert.equal((await state()).log.length,count+1,'бросок за другого полноценного героя сохраняется');
 // Каталожный статблок: typed +0 — атака; null и legacy 0 не исполняются как атака.
 await page.evaluate(async()=>{
  const {monsterById}=await import('/js/data/bestiary.js'),m=monsterById('goblin');
  m.stats.str=null;m.stats.dex=0;m.saves={str:0};
  m.actions=[{name:'Явный ноль',attack:{bonus:0},bonus:0,damage:'0',desc:'Текст без применения эффекта'},
   {name:'Неизвестная атака',attack:{bonus:null},bonus:0,desc:'Не назначать +0'},
   {name:'Прежний маркер отсутствия атаки',bonus:0,desc:'Старый формат'}];
  const {openStatblock}=await import('/js/views/table/sheet.js');const {getCampaign}=await import('/js/core/campaign.js');
  const token={id:'catalogue-test',monsterId:'goblin',name:'Статблок',kind:'foe',hp:null,hpMax:20};
  openStatblock({cid:'c-crypt',userId:'u-sol',get c(){return getCampaign(this.cid)},isMaster:true,scene:{tokens:[token]},
    root:document.querySelector('.table'),ui:{},panels:{},toast:()=>{}},token.id);
 });
 assert.equal(await page.locator('[data-roll="mattack"][data-i="0"]').innerText(),'+0');
 assert.equal(await page.locator('[data-roll="mattack"][data-i="1"]').count(),0);
 assert.equal(await page.locator('[data-roll="mattack"][data-i="2"]').count(),0);
 assert.equal(await page.locator('[data-roll="mcheck"][data-ab="str"]').isDisabled(),true);
 assert.equal(await page.locator('[data-roll="mcheck"][data-ab="dex"]').innerText(),'−5');
 assert.equal(await page.locator('.sheet-drawer .vital.hp b').innerText(),'—/20');
 count=(await state()).log.length;await page.click('[data-roll="mattack"][data-i="0"]');after=await state();assert.equal(after.log.length,count+1);assert.equal(after.log[0].total-after.log[0].nat,0);
 assert.deepEqual(after.pc,before.pc);assert.deepEqual(after.npc,before.npc);assert.deepEqual(after.scenes,before.scenes);
 assert.deepEqual(errors,[]);
 console.log('actions browser OK: ability/PB once, zero/unknown, explicit dice only, unchanged HP/resources, PC/NPC roles, catalogue unknowns');
} finally {await browser.close();}
