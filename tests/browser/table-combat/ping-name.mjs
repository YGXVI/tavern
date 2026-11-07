// Имя участника в метке за краем экрана — текст, а не разметка.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const browser=await chromium.launch({args:['--disable-webgl'],executablePath:process.env.BROWSER_EXECUTABLE_PATH||undefined});
try {
 const page=await browser.newPage({viewport:{width:1200,height:800}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());
 await page.goto('http://127.0.0.1:4173/?server=0');
 await page.evaluate(async()=>{(await import('/js/core/auth.js')).signIn({userId:'u-sol'});location.hash='#/c/c-crypt';});
 await page.waitForSelector('.viewport');
 const r=await page.evaluate(async()=>{
  const st=await import('/js/core/store.js'),{getCampaign}=await import('/js/core/campaign.js');
  const name='<img src=x onerror="window.__injected=1">';
  st.getDB().users['u-asya'].name=name;
  st.emitLocal('ping',{cid:'c-crypt',sceneId:getCampaign('c-crypt').activeSceneId,x:-99999,y:-99999,look:false,userId:'u-asya',master:false});
  await new Promise(r=>setTimeout(r,600));
  const edge=document.querySelector('.edge-indicator');
  return {injected:window.__injected||0,images:edge?.querySelectorAll('span img').length,text:edge?.textContent||'',name};
 });
 assert.equal(r.injected,0,'разметка из имени выполнилась');
 assert.equal(r.images,0);
 assert.ok(r.text.includes(r.name),'имя показано как текст: '+r.text);
 assert.deepEqual(errors,[]);
 console.log('ping name browser OK: имя показано текстом');
} finally { await browser.close(); }
