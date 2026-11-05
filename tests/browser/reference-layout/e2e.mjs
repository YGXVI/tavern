import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile, mkdir } from 'node:fs/promises';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE_PATH || '/usr/bin/chromium' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
// REFERENCE_OFFLINE_FONTS=1 also exercises fallback typography.
if (process.env.REFERENCE_OFFLINE_FONTS) await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
const page = await context.newPage(); const errors = [], reports = [];
page.on('pageerror', e => errors.push(e.message));
await mkdir('/tmp/ref-layout', { recursive: true });
const base = process.env.REFERENCE_BASE || 'http://localhost:4173/?server=0';
async function audit(label) {
  await page.waitForTimeout(100);
  await page.evaluate(() => document.fonts.ready);
  const report = await page.evaluate(() => {
    const clipped = n => { for(let p=n.parentElement;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p);if(/auto|scroll|hidden|clip/.test(s.overflowX))return true;}return false; };
    const over = [...document.querySelectorAll('main *, .ref-pal *')].flatMap(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);if(!r.width||!r.height||s.position==='absolute'||s.position==='fixed'||clipped(n))return [];if(r.right>innerWidth+2||r.left< -2)return [{tag:n.tagName,cls:String(n.className).slice(0,100),text:n.textContent.trim().slice(0,65),x:Math.round(r.x),w:Math.round(r.width)}];return []}).slice(0,20);
    const squeezed=[...document.querySelectorAll('.cls-pick .chip,.cls-hero-text,.cls-passport,.cls-now,.ref-card-body,.cls-tile,.cls-pick,.ref-top,.ref-pal-top,.rx-body,.rx-name')].filter(n=>n.clientWidth&&n.scrollWidth>n.clientWidth+3).map(n=>({cls:n.className,w:n.clientWidth,scroll:n.scrollWidth})).slice(0,15);
    return {pageWidth:document.documentElement.scrollWidth,vw:innerWidth,over,squeezed};
  }); reports.push({label,...report});
  if(report.over.length||report.squeezed.length||report.pageWidth>report.vw+2)console.log('LAYOUT',label,JSON.stringify(report));
  if(/^(1440|390)-/.test(label))await page.screenshot({path:`/tmp/ref-layout/${label}.png`});
}
try {
 await page.goto(base+'#/ref');await page.locator('.ref-home').waitFor();
 const sections=await page.evaluate(async()=>{const d=await import('/js/views/ref/data.js');await d.loadAll();return d.SECTIONS.map(s=>{const a=d.sectionNow(s.id);return {id:s.id,first:a[0].id,classes:s.id==='classes'?a.map(x=>x.id):[],long:[...a].sort((x,y)=>y.name.length-x.name.length)[0].id};});});
 for(const width of [1440,1024,768,390,320]) {
  await page.setViewportSize({width,height:1000});
  await page.goto(base+'#/ref');await audit(`${width}-home`);
  for(const section of sections) {
   await page.goto(base+'#/ref/'+section.id);await audit(`${width}-${section.id}-gallery`);
   const colorFilter = page.locator('button.rx-color-chip').first();
   if(await colorFilter.count()) {
    await colorFilter.click();await audit(`${width}-${section.id}-filtered`);
    assert.equal(await page.locator('button.rx-color-chip[aria-pressed="true"]').count(),1);
   }
   await page.goto(base+'#/ref/'+section.id+'/'+encodeURIComponent(section.long));await audit(`${width}-${section.id}-card`);
   await page.goto(base+'#/ref/'+section.id+'?view=table');await audit(`${width}-${section.id}-table`);
  }
  await page.goto(base+'#/ref');await page.locator('[data-palette]').first().click();await page.locator('.ref-pal').waitFor();
  await page.locator('.ref-pal [data-q]').fill('дракон');await audit(`${width}-search`);if(width===320) { await page.locator('[data-pal-close]').focus();await page.keyboard.press('Enter'); }
  else await page.locator('[data-pal-close]').click();
  assert.equal(await page.locator('.ref-pal').count(),0,'Search closes by touch');
 }
 // All class timelines at level 20, and their progression tables.
 for(const width of [1440,320]) {
  await page.setViewportSize({width,height:1000});
  for(const id of sections.find(s=>s.id==='classes').classes) {
   await page.goto(base+'#/ref/classes/'+id+'?lvl=20');await page.locator('[data-scrub]').focus();await page.keyboard.press('Home');
   assert.equal(await page.locator('[data-scrub]').getAttribute('aria-valuenow'),'1');
   await page.keyboard.press('End');
   assert.equal(await page.locator('[data-scrub]').getAttribute('aria-valuenow'),'20');
   await page.evaluate(()=>document.querySelectorAll('details').forEach(d=>d.open=true));
   await audit(`${width}-class-${id}`);
  }
 }
 // Use the same entry point as the map, for both role-specific footers.
 for(const [width,height] of [[1440,1000],[390,844],[320,640],[844,390]]) {
  await page.setViewportSize({width,height});await page.goto(base+'#/ref');
  for(const isMaster of [true,false])for(const section of sections) {
   await page.evaluate(async({section,isMaster})=>{
    const {loadSection}=await import('/js/views/ref/data.js');
    const entries=await loadSection(section.id);const it=entries.find(x=>x.id===section.long);
    const {openTableReference}=await import('/js/views/ref/table-ref.js');
    openTableReference({isMaster,toast:()=>{}},it.name);
   },{section,isMaster});
   const row=page.locator('.ref-pal-row').filter({hasText:await page.evaluate(async(section)=>{
    const {loadSection}=await import('/js/views/ref/data.js');return (await loadSection(section.id)).find(x=>x.id===section.long).name;
   },section)}).first();
   await row.click();await page.locator('.ref-modal').waitFor();
   await audit(`${width}-${height}-modal-${isMaster?'master':'player'}-${section.id}`);
   const geometry=await page.locator('.ref-modal').evaluate(n=>{
    const r=n.getBoundingClientRect(),f=n.querySelector('.ref-card-foot').getBoundingClientRect();
    const body=n.querySelector('.ref-card-body');
    return {top:r.top,bottom:r.bottom,height:innerHeight,footerBottom:f.bottom,bodyHeight:body.clientHeight,bodyScroll:body.scrollHeight};
   });
   assert.ok(geometry.top>=0 && geometry.bottom<=height+1 && geometry.footerBottom<=height+1 && geometry.bodyHeight>40,JSON.stringify({section:section.id,width,height,geometry}));
   if(section.id==='creatures')assert.equal(await page.locator('[data-place]').count(),isMaster?1:0);
   await page.locator('.ref-modal [data-close]').click();
  }
 }
 await writeFile('/tmp/ref-layout/report.json',JSON.stringify({reports,errors},null,2));
 assert.deepEqual(errors,[],'No JavaScript errors');
 assert.deepEqual(reports.filter(r=>r.over.length||r.squeezed.length||r.pageWidth>r.vw+2),[],'Reference content fits its container');
 console.log('AUDIT',reports.length,'pages; JS errors:',JSON.stringify(errors));
}finally{await browser.close();}
