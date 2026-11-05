// Локальный dist:4173, Playwright из окружения. Проверяет UI библиотеки и серверное сохранение.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { fakeServer } from './harness.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const C = '00000000-0000-0000-0000-0000000000c3';
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

fake.ensureProfile(C);
fake.sysInsert('campaign_members', {campaign_id:'c-own',user_id:C,role:'player',status:'active',character_id:'ch-observer'});
fake.sysInsert('characters',{id:'ch-observer',campaign_id:'c-own',owner_id:C,data:{name:'Наблюдатель',hp:10,hpMax:10,ac:10,stats:{}}});
const pages=[];
async function open(uid,width) {
 const c=await browser.newContext({viewport:{width,height:900}});await fake.attach(c);
 await c.addInitScript(uid=>localStorage.setItem('fake-sb-user',uid),uid);
 await c.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());
 await c.route('**/js/views/table/index.js',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:(await r.text()).replace('ctx.panels = new Panels(ctx);','ctx.panels = new Panels(ctx);window.__ctx=ctx;')});});
 const p=await c.newPage();p.setDefaultTimeout(12000);pages.push(p);p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://localhost:4173/?server=1#/c/c-own');await p.waitForFunction(()=>!!window.__ctx?.scene);return p;
}
const errors=[];
try {
 const gm=await open(A,1440);console.log('GM открыт');const player=await open(B,390);console.log('игрок открыт');const other=await open(C,1000);console.log('зритель открыт');
 // Все источники каталога и ручного создания проходят одним маршрутом заявки.
 const ids=await player.evaluate(async()=>{
  const p=await import('/js/views/table/p-side.js');const own=await import('/js/views/table/own-creature.js');
  const {saveCreature,listCreatures}=await import('/js/core/library.js');
  await saveCreature({name:'Библиотечный страж',size:'medium',hp:8,ac:13,speed:{walk:30}});
  const lib=(await listCreatures())[0];
  await p.placeSummon(__ctx,'wolf');await p.placeCreatures(__ctx,'libsrc:'+lib.id);
  await p.placeOwnToken(__ctx,{name:'Метка'});
  await own.placeCreature(__ctx,{name:'Ручной',size:'tiny',side:'friendly',hp:'5',ac:'12',speed:'30',init:''});
  return __ctx.scene.tokens.filter(t=>t.ownerId===__ctx.userId).map(t=>t.id);
 });
 console.log('созданы',ids);assert.equal(ids.length,4);
 await gm.waitForFunction(ids=>ids.every(id=>__ctx.scene.tokens.some(t=>t.id===id&&t.pending)),ids);
 for(const id of ids){
  assert.equal(fake.T.tokens.find(t=>t.id===id).data.pending,true);
  assert.equal(await player.evaluate(id=>__ctx.canControl(__ctx.scene.tokens.find(t=>t.id===id)),id),false);
  await other.waitForFunction(id=>__ctx.scene.tokens.some(t=>t.id===id),id);
  assert.equal(await other.locator(`[data-token="${id}"]`).count(),0);
 }
 // Прямой UPDATE/patch не снимает ожидание.
 const err=await player.evaluate(async id=>{const sb=await(await import('/js/server/client.js')).supabase();return(await sb.rpc('patch_token',{p_id:id,p_set:{pending:false},p_unset:[]})).error;},ids[0]);
 assert.ok(err);
 console.log('ожидание/видимость/правка проверены');await gm.reload();await gm.waitForFunction(()=>!!window.__ctx?.scene);
 await gm.locator('[data-act="token-requests"]').click();await gm.locator('[data-request="0"]').click();
 await gm.locator('.cc-review [data-yes]').click();
 await player.waitForFunction(id=>!__ctx.scene.tokens.find(t=>t.id===id)?.pending,ids[0]);
 assert.equal(await player.evaluate(id=>__ctx.canControl(__ctx.scene.tokens.find(t=>t.id===id)),ids[0]),true);
 await other.locator(`[data-token="${ids[0]}"]`).waitFor();
 // Отказ мастера и отмена автором.
 await gm.locator('[data-act="token-requests"]').click();await gm.locator('[data-request="0"]').click();await gm.locator('.cc-review [data-no]').click();
 await player.waitForFunction(id=>!__ctx.scene.tokens.some(t=>t.id===id),ids[1]);
 await player.evaluate(async id=>{const p=await import('/js/views/table/p-token.js');p.deleteTokens(__ctx,[id]);},ids[2]);
 await gm.waitForFunction(id=>!__ctx.scene.tokens.some(t=>t.id===id),ids[2]);
 await player.reload();await player.waitForFunction(()=>!!window.__ctx?.scene);
 assert.equal(await player.evaluate(id=>__ctx.scene.tokens.find(t=>t.id===id).pending,ids[3]),true);
 // За мастера создание остаётся немедленным.
 const direct=await gm.evaluate(async()=>{const p=await import('/js/views/table/p-side.js');await p.placeCreatures(__ctx,'wolf');return __ctx.scene.tokens.at(-1);});
 assert.equal(!!direct.pending,false);
 const alt=structuredClone(fake.T.scenes.find(s=>s.id==='s-own'));alt.id='s-alt';alt.data.name='Другая сцена';fake.sysInsert('scenes',alt);
 fake.sysInsert('tokens',{id:'t-alt',campaign_id:'c-own',scene_id:'s-alt',owner_id:B,data:{kind:'custom',name:'На другой сцене',pending:true,x:200,y:200}});
 await gm.waitForFunction(()=>__ctx.c.scenes.some(s=>s.id==='s-alt'&&s.tokens.some(t=>t.id==='t-alt')));
 await gm.locator('[data-act="token-requests"]').click();
 await gm.locator('[data-request]').filter({hasText:'На другой сцене'}).click();
 assert.equal(await gm.evaluate(()=>__ctx.sceneId),'s-alt');
 await gm.locator('.cc-review [data-yes]').click();
 await gm.waitForFunction(()=>!__ctx.scene.tokens.find(t=>t.id==='t-alt').pending);
 assert.deepEqual(errors,[]);
 console.log('OK: каталог, библиотека, свой токен, ручная карточка → запрос; мастер/автор/другой игрок; разрешение/отказ/отмена/reload; игрок 390px; мастер создаёт сразу');
}finally{await browser.close();}
