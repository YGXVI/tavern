// Постоянный общий лист существа: каталог — снимок, текущие числа — прежние поля Character.
import { fromSrd, normalizeCreature, validateCreature } from '../../rules/creature.js';
import { abilityModifier } from './sheet-rules.js';
const copy=v=>structuredClone(v);
export function emptySheet({id,ownerId,name,profile='pc'}){
  return {id,ownerId,name,profile,level:profile==='creature'?null:1,className:'',raceName:'',background:'',alignment:'',stats:Object.fromEntries(['str','dex','con','int','wis','cha'].map(k=>[k,null])),hp:null,hpMax:null,tempHp:0,ac:null,speed:null,initBonus:null,conditions:[],deathSaves:{s:0,f:0},saves:[],skills:[],attacks:[],slots:{},spells:'',inventory:'',features:'',notes:''};
}
export function sheetFromSrd(monster,identity){
  const snapshot=fromSrd(monster),ch=emptySheet({...identity,profile:identity.profile||'creature'});
  ch.stats=copy(snapshot.stats);ch.hp=ch.hpMax=snapshot.hp;ch.ac=snapshot.ac;ch.speed=snapshot.speed.walk;ch.movement=copy(snapshot.speed);delete ch.movement.walk;ch.darkvision=snapshot.darkvision??null;ch.initBonus=abilityModifier(snapshot.stats.dex);ch.name=identity.name||snapshot.name;ch.alignment=snapshot.alignment;ch.portrait=snapshot.img;
  const {id,ownerId,updatedAt,...base}=snapshot;
  const {name:baseName,img,alignment,stats,hp,ac,speed,saves,skills,darkvision,...details}=base;
  ch.statblock={...copy(details),baseSnapshot:copy(base)};
  // Итоговые бонусы SRD — ручные итоги: повторный PB сюда не добавляется.
  ch.overrides={initiative:null,saves:Object.fromEntries(snapshot.saves.map(s=>[s.ability,{value:s.bonus,reason:'Базовый статблок SRD'}])),skills:Object.fromEntries(snapshot.skills.filter(s=>s.name).map(s=>[s.name,{value:s.bonus,reason:'Базовый статблок SRD'}]))};
  return ch;
}
export function copySheet(source,{id,ownerId,name},newId){
  const ch=copy(source);ch.id=id;ch.ownerId=ownerId;ch.name=name;
  delete ch.controllerIds;delete ch.controllers;
  // Связи и токены принадлежат кампании TASK-097; не создаются этой функцией.
  const ids=new Map();
  for(const key of ['classes','attacks','actions','bonusActions','reactions','spellSources','knownSpells','slotPools','hitDicePools','inventoryItems','featureEntries','resources']){
    for(const item of ch[key]||[])if(item&&typeof item==='object'&&item.id){const old=item.id;item.id=newId();ids.set(old,item.id);}
  }
  for(const spell of ch.knownSpells||[])if(ids.has(spell.sourceId))spell.sourceId=ids.get(spell.sourceId);
  if(ch.sidekick){ch.sidekick.baseLevel=ch.level;ch.sidekick.baseSnapshot={stats:copy(ch.stats),hpMax:ch.hpMax,hitDicePools:copy(ch.hitDicePools||[])};ch.sidekick.growthHistory=[];}
  return ch;
}

export function validateSheetStatblock(ch){
  if(!ch.statblock)return [];
  const candidate=normalizeCreature({...copy(ch.statblock),id:ch.id||'draft',ownerId:ch.ownerId||'unowned',name:ch.name,stats:null,speed:null,ac:null,hp:null});
  // Канонические HP/характеристики/скорости проверяются Character, здесь — текст/механика возможностей.
  const issues=validateCreature(candidate).errors;
  if(Array.isArray(ch.statblock.lairActions))issues.push(...validateCreature({...candidate,actions:ch.statblock.lairActions}).errors);
  return issues.map(e=>`${e.path}: ${e.message}`);
}
