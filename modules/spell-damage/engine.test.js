import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {calculate,aggregate,formula,allLevels} from './engine.js';
const read=n=>JSON.parse(fs.readFileSync(new URL(n,import.meta.url)));
const {entries}=read('damage.json'),srd=read('srd-2014.json').spells;
const entry=n=>entries.find(e=>e.apiIndex===n);
const cast=(name,slotLevel,options={})=>calculate(entry(name),{slotLevel,...options});
for(const e of entries.filter(x=>x.status==='supported')) {
 test(`${e.apiIndex}: all legal levels, boundaries, immutable inputs`,()=>{
  const before=JSON.stringify(e);
  for(const options of allLevels(e)) {
   const r=calculate(e,options);
   assert.equal(r.status,'supported');
   for(const c of r.components)assert.match(c.formula,/^\d+d\d+(?:[+]\d+d\d+|[+-]\d+)*(?:[+]MOD)?$/);
   assert.equal(r.concentration,e.concentration);
  }
  for(let slotLevel=1;slotLevel<=9;slotLevel++) {
   if(!e.baseLevel||slotLevel<e.baseLevel)assert.throws(()=>calculate(e,{slotLevel}),RangeError);
   else assert.equal(calculate(e,{slotLevel}).slotLevel,slotLevel);
  }
  assert.throws(()=>calculate(e,{slotLevel:10,characterLevel:21}),RangeError);
  assert.equal(JSON.stringify(e),before);
 });
}
test('independent SRD tables agree where complete; incomplete tables are not interpolated',()=>{
 for(const e of entries.filter(e=>e.status==='supported'&&!['eldritch-blast'].includes(e.apiIndex))) {
  const api=srd.find(s=>s.index===e.apiIndex);
  const first=api.damage?.[0];if(!first)continue;
  const table=first.damage_at_slot_level||first.damage_at_character_level;
  for(const [level,expected] of Object.entries(table||{})) {
   const r=calculate(e,e.baseLevel?{slotLevel:Number(level)}:{characterLevel:Number(level)});
   const actual=e.apiIndex==='magic-missile'?aggregate(r,{damage:r.units})[0].formula:r.components[0].formula;
   assert.equal(actual,expected.replace(/\s/g,''),e.apiIndex+' '+level);
  }
 }
});
test('cantrip character thresholds and Eldritch Blast per-beam versus total',()=>{
 for(let level=1;level<=20;level++) {
  const n=1+[5,11,17].filter(x=>level>=x).length;
  assert.equal(calculate(entry('fire-bolt'),{characterLevel:level}).components[0].formula,n+'d10');
  const r=calculate(entry('eldritch-blast'),{characterLevel:level});
  assert.equal(r.units,n);assert.equal(r.components[0].formula,'1d10');
  assert.equal(aggregate(r,{damage:n})[0].formula,n+'d10');
 }
});
test('Magic Missile and Scorching Ray all slots: per unit versus all units reaching one target',()=>{
 for(let slot=1;slot<=9;slot++) {
  const r=cast('magic-missile',slot),n=slot+2;
  assert.equal(r.units,n);assert.equal(r.unitKind,'dart');assert.equal(r.components[0].formula,'1d4+1');
  assert.equal(aggregate(r,{damage:n})[0].formula,`${n}d4+${n}`);
  if(slot>=2) {const rays=cast('scorching-ray',slot);assert.equal(rays.units,slot+1);assert.equal(aggregate(rays,{damage:slot+1})[0].formula,`${2*(slot+1)}d6`);}
 }
});
test('delayed components and different increments',()=>{
 for(let slot=2;slot<=9;slot++) {
  assert.deepEqual(cast('acid-arrow',slot).components.map(c=>c.formula),[`${slot+2}d4`,`${slot}d4`]);
  if(slot>=6)assert.deepEqual(cast('wall-of-ice',slot).components.map(c=>c.formula),[`${10+2*(slot-6)}d6`,`${5+slot-6}d6`]);
  if(slot>=4)assert.deepEqual(cast('ice-storm',slot).components.map(c=>c.formula),[`${slot-2}d8`,'4d6']);
 }
});
test('two-slot increments, explicit ability modifiers and storm conditions',()=>{
 for(let slot=2;slot<=9;slot++) {
  const n=1+Math.floor((slot-2)/2);
  assert.equal(cast('spiritual-weapon',slot,{spellModifier:4}).components[0].formula,`${n}d8+4`);
  assert.equal(cast('flame-blade',slot).components[0].formula,`${n+2}d6`);
 }
 for(let slot=3;slot<=9;slot++)assert.equal(cast('call-lightning',slot,{storm:true}).components[0].formula,`${slot+1}d10`);
});
test('fixed damage stays fixed; target upcasting is not extra damage',()=>{
 for(let slot=6;slot<=9;slot++) {const r=cast('chain-lightning',slot);assert.equal(r.components[0].formula,'10d8');assert.equal(r.targetLimit,slot-2);}
 for(let slot=7;slot<=9;slot++)assert.equal(cast('finger-of-death',slot).components[0].formula,'7d8+30');
 assert.deepEqual(cast('meteor-swarm',9).components.map(c=>c.formula),['20d6','20d6']);
 for(let slot=2;slot<=9;slot++)assert.equal(cast('spike-growth',slot).components[0].formula,'2d4');
});
test('manual review is not zero damage; Sleep is never imported as damage',()=>{
 assert.equal(entry('sleep').status,'manual_review');
 for(const e of entries.filter(e=>e.status!=='supported')) {assert.equal(calculate(e).status,'manual_review');assert.deepEqual(allLevels(e),[]);}
});
test('explicit aggregation validates hit counts, symbolic modifiers and formula inputs',()=>{
 const r=cast('scorching-ray',2);
 assert.throws(()=>aggregate(r,{damage:4}));assert.throws(()=>aggregate(r,{}));assert.throws(()=>aggregate(r,{damage:1.2}));
 assert.equal(aggregate(r,{damage:0})[0].formula,'0');
 assert.throws(()=>aggregate(cast('spiritual-weapon',2),{damage:1}));
 assert.equal(formula(['1d8','-3'],2),'2d8-6');
 for(const s of ['eval(1)','2d6x','-1d6','1d0'])assert.throws(()=>formula([s]));
});
test('every catalogue ID has exactly one status; persisted levels equal runtime',()=>{
 assert.equal(entries.length,524);assert.equal(new Set(entries.map(x=>x.id)).size,524);
 for(const row of read('levels.json'))assert.deepEqual(row.levels,allLevels(entries.find(x=>x.id===row.id)).map(o=>calculate(entries.find(x=>x.id===row.id),o)));
});
// Stable IDs and verified names remain authoritative on a later import.
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
test('import rejects identity drift without overwriting catalogue or delivered artifacts',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'spell-match-'));
 try {
  const rules=read('rules.json'), api=srd.find(x=>x.index==='fireball');
  const spells=Array.from({length:524},(_,i)=>({id:`test:${i}`,name_en:`Unmatched ${i}`,level:1,concentration:false}));
  spells[0]={id:'wrong:identity',name_en:api.name,level:3,concentration:false};
  const fixture=JSON.stringify({edition:'5e-2014',spells});const input=path.join(temp,'catalogue.json');fs.writeFileSync(input,fixture);
  execFileSync(process.execPath,[new URL('build.mjs',import.meta.url).pathname,input],{env:{...process.env,SPELL_DAMAGE_OUTPUT:temp}});
  const report=JSON.parse(fs.readFileSync(path.join(temp,'damage.json')));
  assert.equal(report.entries[0].reason,'stable_identity_conflict');
  assert.equal(fs.readFileSync(input,'utf8'),fixture);
  assert.notEqual(rules.profiles.fireball.catalogueId,'wrong:identity');
 } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
