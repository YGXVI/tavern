// Локальный dist:4173, Playwright из окружения. Проверяет UI библиотеки и серверное сохранение.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { fakeServer } from './harness.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const A = '00000000-0000-0000-0000-0000000000a1', B = '00000000-0000-0000-0000-0000000000b2';
let rejectPlacement = false, fallback = false;
const fake = fakeServer({ names: { [A]: 'Соль', [B]: 'Ася' }, rpcOverride: ({ name }) => {
  if (name !== 'place_creature') return;
  if (rejectPlacement) return { data: null, error: { code: '42501', message: 'Тестовый отказ сохранения' } };
  if (fallback) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
} });
for (const uid of [A, B]) fake.ensureProfile(uid);
fake.sysInsert('campaigns', { id: 'c-own', owner_id: A, name: 'Проверка существ', data: { activeSceneId: 's-own', seats: 5, settings: { playersSeeHp: 'exact', sharedVision: true } } });
for (const uid of [A, B]) fake.sysInsert('campaign_members', { campaign_id: 'c-own', user_id: uid, role: uid === A ? 'master' : 'player', status: 'active', character_id: uid === B ? 'ch-player' : null });
fake.sysInsert('characters', { id: 'ch-player', campaign_id: 'c-own', owner_id: B, data: { name: 'Лира', portrait: 'lira', stats: { str: 10, dex: 14, con: 12, int: 16, wis: 12, cha: 10 }, hp: 20, hpMax: 20, ac: 12, speed: 30, saves: [], conditions: [], attacks: [], inventory: [], slots: {}, deathSaves: { s: 0, f: 0 } } });
fake.sysInsert('scenes', { id: 's-own', campaign_id: 'c-own', ord: 0, data: { name: 'Сцена', status: 'active', map: { src: 'map:crypt', width: 1185, height: 1259 }, grid: { size: 60, feet: 5, visible: true }, lighting: 'bright', fog: { mode: 'off', ops: [] }, walls: [], lights: [], terrain: { difficult: [], blocked: [] }, pins: [], portals: [], traps: [] } });
fake.sysInsert('tokens', { id: 't-player', campaign_id: 'c-own', scene_id: 's-own', character_id: 'ch-player', hidden: false, data: { kind: 'hero', name: 'Лира', img: 'lira', size: 'medium', x: 450, y: 500, conditions: [] } });
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'], ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}) });

const errors=[];
const waitFor = async (fn) => { for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error('Сервер не подтвердил изменение'); };
try { for(const width of [1440,390]) {
 const context=await browser.newContext({viewport:{width,height:1000}});await fake.attach(context);
 await context.addInitScript(uid=>localStorage.setItem('fake-sb-user',uid),A);
 await context.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());
 await context.route('**/js/views/table/index.js',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:(await r.text()).replace('ctx.panels = new Panels(ctx);','ctx.panels = new Panels(ctx);window.__ctx=ctx;')});});
 const p=await context.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.stack));
 await p.goto('http://localhost:4173/?server=1#/camp/c-own/encounters');await p.locator('[data-new]').first().waitFor();
 const seeded=await p.evaluate(async width=>{
  const l=await import('/js/core/library.js');const c=document.createElement('canvas');c.width=100;c.height=300;const g=c.getContext('2d');g.fillStyle='red';g.fillRect(0,0,100,150);g.fillStyle='blue';g.fillRect(0,150,100,150);
  const blob=await new Promise(r=>c.toBlob(r,'image/png'));const img=await l.uploadLibraryImage(blob);
  const tpl=await l.saveCreature({name:'Личный страж '+width,size:'medium',hp:14,ac:16,cr:'2',img,speed:{walk:30},actions:[{name:'Копьё',text:'Страж бьёт',attack:{bonus:10,reach:10},damage:[{dice:'1d12+5',type:'колющий'},{dice:'3d10',type:'огонь'}]}]});
  return {id:tpl.id,png:c.toDataURL().split(',')[1]};
 },width);
 // Страница читает свежую личную библиотеку при входе.
 await p.reload();await p.locator('[data-new]').first().click();
 await p.locator('[data-name]').fill('Смешанная '+width);await p.locator('[data-name]').dispatchEvent('change');
 await p.locator('[data-msearch]').fill('Личный страж '+width);
 await p.locator(`[data-add="libsrc:${seeded.id}"]`).click();await p.locator('[data-inc="0"]').click();
 await p.locator('[data-msearch]').fill('Гоблин');await p.locator('.cp-mon-pick').filter({hasText:'Гоблин'}).first().click();
 await p.locator('[data-msearch]').fill('Дух встречи '+width);await p.locator('[data-quick]').click();
 const quick=p.locator('.enc-creature-modal');await quick.waitFor();await p.waitForTimeout(50);await quick.locator('[data-field="ac"]').fill('13');await quick.locator('[data-field="hp"]').fill('2к8+2');await quick.locator('[data-field="cr"]').fill('1/2');
 await quick.evaluate((n,png)=>{const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],'spirit.png',{type:'image/png'}));n.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));},seeded.png);
 await quick.locator('[data-face] img').evaluate(async i=>{for(let x=0;x<100&&!i.src.startsWith('blob:');x++)await new Promise(r=>setTimeout(r,30));});
 assert.equal(await quick.locator('[data-field="name"]').inputValue(),'Дух встречи '+width);
 await quick.locator('[data-save]').click();await quick.waitFor({state:'detached'});
 assert.ok(await p.locator('.cp-mon').filter({hasText:'Дух встречи '+width}).count());
 await p.locator('[data-quick]').click();await quick.locator('[data-field="name"]').fill('Отменён');await quick.getByRole('button',{name:'Отмена',exact:true}).click();

 const id=await p.evaluate(()=>JSON.parse(localStorage.getItem('rasputye-encounters:c-own:'+localStorage.getItem('fake-sb-user'))).list.at(-1).id);
 await p.reload();await p.locator('.cp-mon').filter({hasText:'Личный страж '+width}).waitFor();
 assert.equal(await p.evaluate(async()=> (await(await import('/js/core/library.js')).listCreatures()).some(c=>c.name==='Отменён')),false);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.equal(await p.locator('.cp-mon .avatar img').evaluateAll(imgs=>imgs.every(i=>i.getBoundingClientRect().height<=i.parentElement.getBoundingClientRect().height && Math.abs(i.getBoundingClientRect().height-i.getBoundingClientRect().width)<1)),true);
 await p.screenshot({path:`/tmp/encounters-page-${width}.png`});
 await p.goto('http://localhost:4173/?server=1#/c/c-own');await p.waitForFunction(()=>!!window.__ctx?.scene);
 await p.evaluate(()=>__ctx.panels.toggleSide('bestiary'));await p.locator('[data-act="b-src"][data-v="enc"]').click();
 const row=p.locator(`[data-act="enc-pick"][data-id="${id}"]`);await row.waitFor();

 await p.screenshot({path:`/tmp/encounters-table-${width}.png`});
 const before=await p.evaluate(()=>__ctx.scene.tokens.length);
 if(width===1440){const r=await row.boundingBox();await p.mouse.move(r.x+r.width/2,r.y+r.height/2);await p.mouse.down();await p.mouse.move(900,500,{steps:12});await p.mouse.up();}
 else {await row.click();await p.locator('[data-act="enc-place"]').click();}
 try { await p.waitForFunction(n=>__ctx.scene.tokens.length===n+4,before); }
 catch(e){console.log('DEBUG',width,await p.evaluate(()=>({count:__ctx.scene.tokens.length,busy:__ctx.ui.encounterPlacing,text:document.body.innerText.slice(-4500)})),errors,fake.T.tokens.length);throw e;}
 const placed=await p.evaluate(()=>__ctx.scene.tokens.filter(t=>__ctx.ui.selection.has(t.id)));
 assert.equal(placed.length,4);assert.equal(placed.filter(t=>t.name.startsWith('Личный страж')).length,2);assert.equal(placed.every(t=>t.hidden),true);
 const t=placed.find(t=>t.name.startsWith('Личный страж'));assert.match(t.img,/^sb:@tokens/);
 const st=await p.evaluate(t=>__ctx.c.creatures[t.monsterId.slice(4)],t);assert.equal(st.actions[0].damage.length,2);
 assert.equal(placed.filter(t=>t.monsterId.startsWith('lib:')).length,3);
 await p.reload();await p.waitForFunction(()=>!!window.__ctx?.scene);await p.locator(`[data-token="${t.id}"] .tok-ring img`).waitFor();
 await p.locator(`[data-token="${t.id}"] .tok-ring img`).evaluate(i=>i.decode());
 // Повторная постановка — новые id, снимки прежней копии не затираются.
 const ids=await p.evaluate(async id=>(await import('/js/views/table/encounters.js')).placeEncounter(__ctx,id),id);assert.equal(ids.length,4);assert.ok(ids.every(id=>!placed.some(t=>t.id===id)));
 // Одна отмена удаляет всю встречу, повтор возвращает весь состав.
 await p.evaluate(()=>__ctx.history.undo(__ctx));
 await p.waitForFunction(ids=>ids.every(id=>!__ctx.scene.tokens.some(t=>t.id===id)),ids);
 await waitFor(()=>ids.every(id=>!fake.T.tokens.some(t=>t.id===id)));
 await p.evaluate(async()=>{await(await import('/js/server/sync.js')).whenSynced(__ctx.cid);__ctx.history.redo(__ctx);});
 await p.waitForFunction(()=>!__ctx.history.pending);
 await p.waitForFunction(ids=>ids.every(id=>__ctx.scene.tokens.some(t=>t.id===id)),ids);
 await waitFor(()=>ids.every(id=>fake.T.tokens.some(t=>t.id===id)));
 // Отказ первого RPC не показывает ложный успех и не записывает токены.
 const unchanged=await p.evaluate(()=>__ctx.scene.tokens.length);rejectPlacement=true;
 const failed=await p.evaluate(async id=>(await import('/js/views/table/encounters.js')).placeEncounter(__ctx,id),id);rejectPlacement=false;
 assert.equal(failed.length,0);assert.equal(await p.evaluate(()=>__ctx.scene.tokens.length),unchanged);
 // Старый сервер без RPC также ставит несколько снимков.
 if(width===390){fallback=true;const retry=await p.evaluate(async id=>(await import('/js/views/table/encounters.js')).placeEncounter(__ctx,id),id);fallback=false;assert.equal(retry.length,4);}
 const fallbackResult=await p.evaluate(async()=>{
  const l=await import('/js/core/library.js'),e=await import('/js/views/camp/encounters.js'),m=await import('/js/views/table/encounters.js');
  const t=await l.saveCreature({name:'Удалённый шаблон',size:'medium',hp:5,ac:11});
  const enc=e.newEncounter(__ctx.cid,__ctx.userId,{name:'Сохранённая копия',monsters:[{id:'libsrc:'+t.id,count:1,creature:t}]});await l.deleteCreature(t.id);
  const ids=await m.placeEncounter(__ctx,enc.id);const invalid=e.newEncounter(__ctx.cid,__ctx.userId,{monsters:[{id:'libsrc:missing',count:1}]});const before=__ctx.scene.tokens.length;const bad=await m.placeEncounter(__ctx,invalid.id);
  return {ids,bad,unchanged:before===__ctx.scene.tokens.length};
 });assert.equal(fallbackResult.ids.length,1);assert.equal(fallbackResult.bad.length,0);assert.equal(fallbackResult.unchanged,true);
 console.log('OK',width,'поиск SRD/личное, краткая карточка+арт, отмена, состав/сложность/reload, встреча на карте целиком, несколько снимков+атаки+изображения/reload, повторная постановка');
 await context.close();
 }
 // Песочница: реальные IndexedDB и локальные встречи.
 const sandbox=await browser.newContext({viewport:{width:390,height:900}});
 await sandbox.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());
 await sandbox.route('**/js/views/table/index.js',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:(await r.text()).replace('ctx.panels = new Panels(ctx);','ctx.panels = new Panels(ctx);window.__ctx=ctx;')});});
 const demo=await sandbox.newPage();demo.setDefaultTimeout(15000);demo.on('pageerror',e=>errors.push(e.stack));
 await demo.goto('http://localhost:4173/?server=0#/login');await demo.getByRole('button',{name:'Войти через Discord'}).click();await demo.locator('[data-u="u-sol"]').click();await demo.getByRole('button',{name:'Авторизовать'}).click();
 await demo.goto('http://localhost:4173/?server=0#/camp/c-crypt/encounters');
 const local=await demo.evaluate(async()=>{
 const l=await import('/js/core/library.js'),e=await import('/js/views/camp/encounters.js');const c=document.createElement('canvas');c.width=30;c.height=90;c.getContext('2d').fillRect(0,0,30,90);const blob=await new Promise(r=>c.toBlob(r));const img=await l.uploadLibraryImage(blob);
 const a=await l.saveCreature({name:'Локальный страж',hp:12,ac:13,size:'medium',img}),b=await l.saveCreature({name:'Локальный дух',hp:3,size:'tiny'});
 return e.newEncounter('c-crypt','u-sol',{name:'Локальная встреча',monsters:[{id:'libsrc:'+a.id,count:2,creature:a},{id:'goblin',count:1},{id:'libsrc:'+b.id,count:1,creature:b}]}).id;
 });
 await demo.goto('http://localhost:4173/?server=0#/c/c-crypt');await demo.waitForFunction(()=>!!window.__ctx?.scene);
 const localIds=await demo.evaluate(async id=>(await import('/js/views/table/encounters.js')).placeEncounter(__ctx,id),local);assert.equal(localIds.length,4);
 const localToken=await demo.evaluate(id=>__ctx.scene.tokens.find(t=>t.id===id),localIds[0]);assert.match(localToken.img,/^idb:/);
 await demo.evaluate(()=>__ctx.history.undo(__ctx));assert.equal(await demo.evaluate(ids=>ids.some(id=>__ctx.scene.tokens.some(t=>t.id===id)),localIds),false);
 await demo.evaluate(()=>__ctx.history.redo(__ctx));assert.equal(await demo.evaluate(ids=>ids.every(id=>__ctx.scene.tokens.some(t=>t.id===id)),localIds),true);
 await demo.reload();await demo.waitForFunction(()=>!!window.__ctx?.scene);await demo.locator(`[data-token="${localIds[0]}"] .tok-ring img`).waitFor();await demo.locator(`[data-token="${localIds[0]}"] .tok-ring img`).evaluate(i=>i.decode());
 await sandbox.close();
 const pc=await browser.newContext();await fake.attach(pc);await pc.addInitScript(uid=>localStorage.setItem('fake-sb-user',uid),B);
 await pc.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());await pc.route('**/js/views/table/index.js',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:(await r.text()).replace('ctx.panels = new Panels(ctx);','ctx.panels = new Panels(ctx);window.__ctx=ctx;')});});
 const player=await pc.newPage();player.on('pageerror',e=>errors.push(e.stack));await player.goto('http://localhost:4173/?server=1#/c/c-own');await player.waitForFunction(()=>!!window.__ctx?.scene);
 assert.deepEqual(await player.evaluate(async()=>{const e=await import('/js/views/camp/encounters.js');const x=e.newEncounter(__ctx.cid,__ctx.userId,{monsters:[{id:'goblin',count:1}]});return(await import('/js/views/table/encounters.js')).placeEncounter(__ctx,x.id);}),[]);
 await pc.close();console.log('OK: песочница, IndexedDB, несколько снимков, общая отмена/повтор, reload; игрок не ставит встречи');
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
