// Атомарные локальные переходы песочницы; сервер выполняет их в SQL-транзакции.
export function applyZeroHp(character,previousHp) {
  if(!['pc','sidekick'].includes(character.profile||'pc')||character.hp===null||character.hp===previousHp)return;
  character.conditions??=[];
  if(character.hp===0&&!character.conditions.some(c=>(c.id||c)==='unconscious'))character.conditions.push('unconscious');
  if(previousHp===0&&character.hp>0){character.conditions=character.conditions.filter(c=>(c.id||c)!=='unconscious');character.deathSaves={s:0,f:0};}
}
export function archiveLocalCharacter(c,id) {
  const character=c.characters.find(ch=>ch.id===id);if(!character)throw new Error('Лист не найден');
  const removed=new Set(c.scenes.flatMap(s=>s.tokens.filter(t=>t.characterId===id).map(t=>t.id)));
  const scene=c.scenes.find(s=>s.id===c.combat?.sceneId);
  const order=(c.combat?.entries||[]).filter(e=>scene?.tokens.some(t=>t.id===e.tokenId)).map(e=>{const t=scene.tokens.find(t=>t.id===e.tokenId),ch=c.characters.find(ch=>ch.id===t.characterId);return {...e,bonus:(ch||t).initBonus??0,name:(ch||t).name||''};}).sort((a,b)=>(b.init??-99)-(a.init??-99)||b.bonus-a.bonus||a.name.localeCompare(b.name,'ru')); 
  const cb=c.combat,current=cb?.current||order[cb?.turn||0]?.tokenId;
  if(cb&&order.some(e=>removed.has(e.tokenId))){
    const kept=order.filter(e=>!removed.has(e.tokenId));let next=current,wrapped=false;
    if(removed.has(current)){const index=order.findIndex(e=>e.tokenId===current),following=order.slice(index+1).find(e=>!removed.has(e.tokenId));next=following?.tokenId||kept[0]?.tokenId;wrapped=!following&&!!kept.length;delete cb.ended;}
    cb.entries=kept.map(({tokenId,init})=>({tokenId,init}));cb.current=next||null;cb.turn=Math.max(0,kept.findIndex(e=>e.tokenId===next));
    if(!kept.length){cb.active=false;delete cb.current;delete cb.ended;}
    if(wrapped)cb.round=(cb.round||1)+1;
    cb.moved=Object.fromEntries(Object.entries(cb.moved||{}).filter(([id])=>!removed.has(id)));if(removed.has(cb.ended))delete cb.ended;
  }
  for(const s of c.scenes)s.tokens=s.tokens.filter(t=>!removed.has(t.id));
  c.characters=c.characters.filter(ch=>ch.id!==id);c.archivedCharacters??=[];c.archivedCharacters.push(character);
}
export function restoreLocalCharacter(c,id) {
  const character=c.archivedCharacters?.find(ch=>ch.id===id);if(!character)throw new Error('Лист не найден в архиве');
  c.archivedCharacters=c.archivedCharacters.filter(ch=>ch.id!==id);c.characters.push(character);
}
