// Проверка wiring/ошибок UI на fake Supabase. SQL/CAS/RLS проверяет local_pg.py.
import {createRequire} from 'node:module';import assert from 'node:assert/strict';
import {fakeServer} from '../server-e2e/harness.mjs';
import {seedDB} from '../../../dist/js/data/demo.js';import {explode,emptyRows} from '../../../dist/js/server/model.js';
const {chromium}=createRequire(import.meta.url)('playwright');
const A='00000000-0000-0000-0000-0000000000a1',B='00000000-0000-0000-0000-0000000000b2';
let lost=false,applied=0;const replies=new Map(),commands=[];
function merge(a,b){const out=structuredClone(a);for(const[k,v]of Object.entries(b))out[k]=v&&typeof v==='object'&&!Array.isArray(v)?merge(out[k]||{},v):structuredClone(v);return out;}
const fake=fakeServer({names:{[A]:'Мастер',[B]:'Игрок'},rpcOverride({name,args:a,tables:T}){
 if(!['read_character_sheet','character_command'].includes(name))return;
 const ch=T.characters.find(c=>c.id===a.p_character&&c.campaign_id===a.p_campaign);
 const snapshot=()=>({id:ch.id,campaignId:ch.campaign_id,ownerId:ch.owner_id,version:String(ch.sheet_version),managed:ch.sheet_managed,archivedAt:null,data:structuredClone(ch.data),controllers:[]});
 if(name==='read_character_sheet')return{data:snapshot(),error:null};
 commands.push(structuredClone(a));
 if(replies.has(a.p_operation))return{data:{...replies.get(a.p_operation),replayed:true},error:null};
 if(String(ch.sheet_version)!==a.p_expected_version)return{data:null,error:{code:'40001',message:'version conflict'}};
 ch.data=merge(ch.data,a.p_payload.patch||{});ch.data=merge(ch.data,a.p_payload.current||{});
 const d=a.p_payload.adjust||{};if(d.currentHp)ch.data.hp+=d.currentHp;if(d.tempHp)ch.data.tempHp+=d.tempHp;
 for(const c of d.counters||[]){const p=ch.data[c.field].find(p=>p.id===c.id);p.spent+=c.delta;}
 ch.sheet_version=String(BigInt(ch.sheet_version)+1n);ch.sheet_managed=true;applied++;
 const ack={ok:true,operationId:a.p_operation,replayed:false,sheet:snapshot()};replies.set(a.p_operation,structuredClone(ack));
 if(lost){lost=false;return{data:null,error:{message:'Failed to fetch'}};}return{data:ack,error:null};
}});
const c=seedDB().campaigns['c-crypt'];c.ownerId=A;c.members=[{userId:A,role:'master',status:'active',joinedAt:Date.now()},{userId:B,role:'player',status:'active',characterId:'ch-lira',joinedAt:Date.now()}];c.log=[];c.invite=null;c.characters.forEach(ch=>ch.ownerId=B);
const rows=explode(c,emptyRows());fake.ensureProfile(A);fake.ensureProfile(B);fake.sysInsert('campaigns',rows.campaign);
const maps={members:'campaign_members',characters:'characters',scenes:'scenes',secrets:'scene_secrets',explored:'scene_explored',tokens:'tokens',drawings:'drawings'};
for(const[key,table]of Object.entries(maps))for(const row of rows[key].values())fake.sysInsert(table,key==='characters'?{...row,sheet_version:'0',sheet_managed:false,archived_at:null}:row);
fake.sysInsert('combats',rows.combat);
const browser=await chromium.launch(),context=await browser.newContext(),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));await context.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());await fake.attach(context);
await page.addInitScript(A=>localStorage.setItem('fake-sb-user',A),A);await page.goto('http://127.0.0.1:4173/?server=1#/c/c-crypt');await page.waitForSelector('.viewport');
async function open(){await page.evaluate(async A=>{const{openCharacterSheet}=await import('/js/views/table/sheet.js');const{getCampaign}=await import('/js/core/campaign.js');openCharacterSheet({cid:'c-crypt',userId:A,get c(){return getCampaign(this.cid)},root:document.querySelector('.table'),toast:()=>{},ui:{},panels:{}},'ch-lira');},A);await page.waitForFunction(()=>document.querySelector('.sheet-head')?.textContent.includes('Лист загружен'));}
await open();await page.locator('[data-field="name"]').fill('Подтверждённое имя');await page.click('[data-save]');await page.waitForFunction(()=>document.querySelector('.sheet-head').textContent.includes('Сохранено'));
assert.equal(applied,1);assert.equal(fake.T.characters.find(c=>c.id==='ch-lira').data.name,'Подтверждённое имя');
// Потеря ACK после применения: тот же UUID переживает закрытие и открытие.
lost=true;await page.locator('[data-field="name"]').fill('ACK потерян');await page.click('[data-save]');await page.waitForSelector('[data-retry]');
await page.click('[data-close-sheet]');await page.click('[data-keep-close]');await open();await page.click('[data-save]');await page.waitForSelector('[data-retry]');await page.click('[data-retry]');await page.waitForFunction(()=>document.querySelector('.sheet-head').textContent.includes('Сохранено'));
assert.equal(applied,2);assert.equal(commands.at(-1).p_operation,commands.at(-2).p_operation);
// Старый token-bar/store проходит через тот же протокол после активации нового листа.
await page.evaluate(async()=>{const{updateCampaign}=await import('/js/core/campaign.js');updateCampaign('c-crypt',c=>c.characters.find(ch=>ch.id==='ch-lira').hp-=1);await(await import('/js/server/sync.js')).whenSynced('c-crypt');});
assert.equal(commands.at(-1).p_kind,'edit');assert.equal(commands.at(-1).p_payload.adjust.currentHp,-1);assert.equal(applied,3);
await page.waitForSelector('[data-sheet-version="3"]');
// Конфликт не стирает введённое: перечитывание показывает обе версии.
await page.locator('[data-field="name"]').fill('Локальная версия');
const changed=fake.T.characters.find(c=>c.id==='ch-lira');changed.data.name='Чужая версия';changed.sheet_version=String(BigInt(changed.sheet_version)+1n);
await page.click('[data-save]');await page.waitForSelector('[data-reload]');
assert.equal(await page.locator('[data-field="name"]').inputValue(),'Локальная версия');
await page.click('[data-reload]');await page.waitForSelector('[data-resolve="0"]');await page.click('[data-resolve="0"][data-choice="local"]');await page.click('[data-save]');
await page.waitForFunction(()=>document.querySelector('.sheet-head').textContent.includes('Сохранено'));
assert.equal(fake.T.characters.find(c=>c.id==='ch-lira').data.name,'Локальная версия');
assert.deepEqual(errors,[]);console.log('sheet server harness OK: ACK, lost ACK/reopen/same UUID, legacy store bridge, conflict choice');await browser.close();
