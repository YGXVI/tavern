// Лист Character и отдельный каталоговый статблок (TASK-004 / TASK-083).
import { esc, fmtMod, el } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { srcOf } from '../../core/assets.js';
import { tokenStats, monsterOf } from '../../core/campaign.js';
import { ABILITIES, conditionById } from '../../data/rules.js';
import { doRoll, parseFormula, poolVis } from './dice.js';
import { abilityModifier } from './sheet-rules.js';
import { catalogueAttackBonus } from './sheet-fields.js';
import { createSheetEditor } from './sheet-editor.js';
const knownNumber = value => Number.isFinite(value) ? value : '—';
const knownBonus = value => Number.isSafeInteger(value) ? fmtMod(value) : '—';
let drawer=null, editor=null, hero=null;
let state={kind:null,id:null,tab:'main'};
export function closeSheet(){editor?.close();editor=null;hero?.off();hero=null;drawer?.remove();drawer=null;state={kind:null,id:null,tab:'main'};}
export const sheetOpenFor=()=>({...state,tab:editor?.tab||state.tab});
// Вкладки подробного редактора (sheet-editor.js) — по ним понятно, что открыть его, а не лист игры.
const EDITOR_TABS=new Set(['edit','main','skills','spells','gear','features','notes','creature']);
/**
 * Лист героя на столе (#203, макеты 61–63): по умолчанию — лист игры (тот же, что #/hero/…, в узкой панели), броски —
 * кубами стола. «Все поля листа» в «…» открывает подробный редактор (TASK-004) — tab 'edit' или вкладка редактора.
 */
export function openCharacterSheet(ctx,id,tab){
  if((editor||hero)&&state.id===id&&!tab)return;
  if(tab&&EDITOR_TABS.has(tab)){
    closeSheet();state={kind:'character',id,tab:tab==='edit'?'main':tab};
    drawer=el('<aside class="sheet-drawer panel sheet-editor" aria-label="Лист персонажа"></aside>');ctx.root.append(drawer);
    editor=createSheetEditor(ctx,drawer,id,state.tab,closeSheet,nextId=>openCharacterSheet(ctx,nextId,'edit'));
    return;
  }
  closeSheet();state={kind:'hero',id,tab:tab||'combat'};
  drawer=el('<aside class="sheet-drawer panel hero-drawer" aria-label="Лист героя"></aside>');ctx.root.append(drawer);
  openHeroDrawer(ctx,id,drawer);
}
async function openHeroDrawer(ctx,id,box){
  const [{drawerHTML,bindSheet},{heroView,heroKey},{on}]=await Promise.all([import('../hero/sheet.js'),import('../hero/contract.js'),import('../../core/dom.js')]);
  if(drawer!==box)return; // закрыли, пока грузилось
  const key=heroKey(ctx.cid,id),offs=[];
  const render=()=>{const v=heroView(key);if(!v){closeSheet();return;}const y=box.querySelector('.s-drawer-scroll')?.scrollTop||0;box.innerHTML=`<div class="s-drawer-scroll">${drawerHTML(v,state.tab)}</div>`;box.querySelector('.s-drawer-scroll').scrollTop=y;};
  const L=(type,sel,fn)=>offs.push(on(box,type,sel,fn));
  hero={render,off:()=>offs.forEach(f=>f?.())};
  L('click','[data-close-sheet]',()=>closeSheet());
  L('click','[data-dtab]',(e,b)=>{state.tab=b.dataset.dtab;render();});
  bindSheet(box,L,()=>heroView(key),render,{roll:(what,formula,v)=>heroRoll(ctx,v,what,formula),edit:()=>openCharacterSheet(ctx,id,'edit')});
  render();
}
/** Бросок из листа героя — кубами стола: «к20 +5» — проверка/атака, «2к8+3» — урон или лечение. */
function heroRoll(ctx,v,what,formula){
  const f=String(formula||'').replace(/\s+/g,'').replace(/[−–]/g,'-');
  const d20=/^к20([+-]\d+)?$/i.exec(f);
  if(d20){doRoll(ctx,{label:`${v.name}: ${what}`,dice:{20:1},mod:Number(d20[1]||0),kind:/атак|меч|лук|топор|кинжал|булав|посох|арбалет/i.test(what)?'attack':'check',vis:poolVis(ctx)});return;}
  const p=parseFormula(f.replace(/\+мод\.?/,''));
  if(p){doRoll(ctx,{label:`${v.name}: ${what}`,dice:p.dice,mod:p.mod,kind:'damage',vis:poolVis(ctx)});return;}
  if(/^СЛ\d+$/i.test(f)){ctx.toast?.(`${what}: ${f.replace(/^СЛ/i,'СЛ ')} — бросает цель`);return;}
  ctx.toast?.(`${what}: не понял формулу «${formula}»`);
}
export function openStatblock(ctx,id){closeSheet();state={kind:'monster',id,tab:'main'};
  drawer=el('<aside class="sheet-drawer panel" aria-label="Статблок"></aside>');ctx.root.append(drawer);
  drawer.addEventListener('click',e=>{
    if(e.target.closest('[data-close-sheet]')){closeSheet();return;}
    const desc=e.target.closest('[data-desc]');if(desc){const k=desc.dataset.desc;if(openDesc.has(k))openDesc.delete(k);else openDesc.add(k);desc.classList.toggle('open',openDesc.has(k));return;}
    const b=e.target.closest('[data-roll]');if(b)monsterRoll(ctx,b);
  });refreshSheet(ctx);
}
export function refreshSheet(ctx){if(editor){editor.refresh();return;}if(state.kind==='hero'){hero?.render();return;}if(!drawer)return;
 const t=ctx.scene?.tokens.find(x=>x.id===state.id);if(!t){closeSheet();return;}drawer.innerHTML=monsterHTML(ctx,t);
}
// Статблок существа. Ручные существа: особенности — строки; SRD (TASK-083): { name, en, desc } с английским текстом SRD.
const MLISTS = { actions: 'Действия', bonusActions: 'Бонусные действия', reactions: 'Реакции', legendary: 'Легендарные действия' };
// Подпись способности своего существа (TASK-179): урон и спасбросок по-русски, а не служебной строкой копии.
const AB_NAMES = { str: 'Силы', dex: 'Ловкости', con: 'Телосложения', int: 'Интеллекта', wis: 'Мудрости', cha: 'Харизмы' };
function libMeta(a) {
  const dmg = (a.damageComponents || []).filter((d) => d.dice || d.type).map((d) => [d.dice, d.type].filter(Boolean).join(' '));
  const sv = a.save ? `Спасбросок ${AB_NAMES[a.save.ability] || a.save.ability}${a.save.dc != null ? ` СЛ ${a.save.dc}` : ''}${a.save.who === 'self' ? ', бросает само существо' : ''}` : '';
  return [...dmg, sv, a.recharge ? `перезарядка ${a.recharge}` : ''].filter(Boolean).join(' · ');
}
const openDesc = new Set(); // раскрытые описания: «monsterId:list:i» — переживают перерисовку листа

function traitHTML(x, lib = false) {
  if (typeof x === 'string') return `<p class="t-para trait">${esc(x)}</p>`;
  // Каталог SRD — по-русски; нет перевода — английский оригинал. Свои существа (lib:) показываются как записаны.
  const ru = !lib && x.ru;
  return `<p class="t-para trait"><b>${esc(x.name)}.</b> <span lang="${ru ? 'ru' : 'en'}">${esc(ru ? x.ru : x.desc)}</span></p>`;
}

function actionHTML(m, list, a, i) {
  const meta = String(m.id).startsWith('lib:') ? libMeta(a) : [a.type, a.note].filter(Boolean).join(' · ');
  const bonus = catalogueAttackBonus(a);
  const damage = String(m.id).startsWith('lib:') ? a.damageComponents || [] : a.damage ? [{ dice: a.damage, type: a.type }] : [];
  const rolls = (bonus !== null ? `<button class="btn btn-sm btn-secondary" data-roll="mattack" data-list="${list}" data-i="${i}" aria-label="Атака: ${esc(a.name)}">${knownBonus(bonus)}</button>` : '')
    + damage.map((d, part) => d.dice ? parseFormula(d.dice) ? `<button class="btn btn-sm btn-secondary" data-roll="mdamage" data-list="${list}" data-i="${i}" data-part="${part}" aria-label="Урон: ${esc(a.name)}${d.type ? ` (${esc(d.type)})` : ''}">${esc(d.dice)}${d.type ? ` · ${esc(d.type)}` : ''}</button>`
      : `<span class="chip" title="Урон без броска">${esc(d.dice)}${d.type ? ` ${esc(d.type)}` : ''} урон</span>` : '').join('');
  const k = `${m.id}:${list}:${i}`;
  // Описание без бросков — единственное, что есть у действия: показываем целиком; у атак — две строки, тап раскрывает.
  const lib = String(m.id).startsWith('lib:');
  const ru = !lib && a.ru;
  const text = ru ? a.ru : a.desc;
  const lang = ru ? 'ru' : 'en';
  const desc = text ? `<p class="atk-desc ${!rolls || openDesc.has(k) ? 'open' : ''}" lang="${lang}" ${rolls ? `data-desc="${esc(k)}" title="Показать целиком"` : ''}>${esc(text)}</p>` : '';
  return `<div class="attack-row ${desc ? 'has-desc' : ''}"><div class="grow"><b>${esc(a.name)}</b>${meta ? `<small class="muted">${esc(meta)}</small>` : ''}${desc}</div>${rolls ? `<div class="monster-rolls">${rolls}</div>` : ''}</div>`;
}

function monsterHTML(ctx, t) {
  const st = tokenStats(ctx.c, t);
  const m = monsterOf(ctx.c, t.monsterId);
  const isM = ctx.isMaster || ctx.owns?.(t); // свой призыв владелец видит целиком (TASK-183)
  const lib = String(t.monsterId || '').startsWith('lib:');
  const copyOwner = lib ? ctx.c.creatures?.[t.monsterId.slice(4)]?.ownerId : null;
  const currentHp = t.characterId ? st.hp : t.hp, maxHp = t.characterId ? st.hpMax : t.hpMax;
  if (!m) return `<header class="sheet-head"><div class="titles grow"><b>${esc(t.name)}</b>${t.monsterId?.startsWith('srd:') ? '<div class="t-sm muted">Бестиарий загружается…</div>' : ''}</div><button class="icon-btn icon-btn-sm" data-close-sheet>${icon('cancel-01', 18)}</button></header>`;
  const saves = m.saves ? ABILITIES.filter((a) => Number.isSafeInteger(m.saves[a.id])).map((a) => `${a.short} ${fmtMod(m.saves[a.id])}`).join(', ') : '';
  return `<header class="sheet-head">
      <span class="sheet-portrait foe" style="background-image:url(&quot;${esc(srcOf(t.img))}&quot;)"></span>
      <div class="titles grow"><b class="t-lg">${esc(t.name)}</b><div class="t-sm muted">${esc(m.name)}${m.en && isM ? ` <span lang="en">(${esc(m.en)})</span>` : ''}${m.type ? ` · ${esc(m.type)}` : ''}${m.cr != null ? ` · КО ${esc(m.cr)}` : ''}</div></div>
      <button class="icon-btn icon-btn-sm" data-close-sheet aria-label="Закрыть">${icon('cancel-01', 18)}</button>
    </header>
    <div class="sheet-vitals">
      <div class="vital hp"><small>Хиты</small><b>${isM ? `${knownNumber(currentHp)}<span>/${knownNumber(maxHp)}</span>` : '?'}</b><small class="tertiary">${esc(m.hpDice)}</small></div>
      <div class="vital"><small>КД</small><b>${isM ? knownNumber(m.ac) : '?'}</b></div>
      <div class="vital"><small>Скорость</small><b>${knownNumber(m.speed)}<span> фт</span></b></div>
      <div class="vital"><small>Иниц.</small><b>${knownBonus(m.init)}</b></div>
    </div>
    <div class="sheet-body scroll">
      ${isM && m.statblockImage ? `<img class="sheet-source-image" src="${esc(srcOf(m.statblockImage))}" alt="Статблок: ${esc(m.name)}" loading="lazy">` : ''}
      ${isM ? `<div class="abilities">${ABILITIES.map((a) => {const score=m.stats?.[a.id],bonus=abilityModifier(score);return `<div class="ability"><span class="ab-name">${a.short}</span><button class="ab-mod" data-roll="mcheck" data-ab="${a.id}" ${bonus===null?'disabled':''}>${knownBonus(bonus)}</button><span class="ab-score">${knownNumber(score)}</span></div>`;}).join('')}</div>
      ${saves ? `<p class="t-sm muted" style="margin:12px 0 0">Спасброски: ${saves}</p>` : ''}
      ${m.senses ? `<p class="t-sm muted" style="margin:12px 0">${esc(m.senses)}</p>` : ''}
      ${(m.traits||[]).map((x) => traitHTML(x, lib)).join('')}
      ${Object.entries(MLISTS).filter(([list]) => m[list]?.length).map(([list, title]) => `<div class="section-label" style="margin:16px 0 8px">${title}</div>
      <div class="attacks">${m[list].map((a, i) => typeof a === 'string' ? traitHTML(a, lib) : actionHTML(m, list, a, i)).join('')}</div>`).join('')}
      <p class="t-xs tertiary" style="margin-top:16px">${lib ? `Своё существо — копия из ${copyOwner === ctx.userId ? 'вашей библиотеки' : copyOwner ? 'библиотеки игрока' : 'библиотеки мастера'} в этой кампании${m.provenance ? '; основа — SRD 5.1 (CC BY 4.0)' : ''}.` : m.srd ? 'Числа и описания — SRD 5.1 (CC BY 4.0); русские названия и перевод описаний — наши.' : 'Числа — SRD 5.1 (CC BY 4.0).'}</p>` : '<p class="muted t-para">Подробности о существе знает только мастер.</p>'}
    </div>`;
}

function monsterRoll(ctx,b){
 const t=ctx.scene?.tokens.find(x=>x.id===state.id);
 if(!t||!(ctx.isMaster||ctx.owns?.(t)))return; // свой призыв бросает и владелец (TASK-183)
 const m=monsterOf(ctx.c,t.monsterId);if(!m)return;
 const kind=b.dataset.roll,vis=poolVis(ctx,!!t.hidden),who=ctx.nameOf?ctx.nameOf(t):t.name;
 if(kind==='mcheck'){const ab=ABILITIES.find(a=>a.id===b.dataset.ab);if(ab){const bonus=abilityModifier(m.stats?.[ab.id]);if(bonus===null){ctx.toast('Характеристика неизвестна: бросок не выполнен');return;}doRoll(ctx,{label:`${who}: проверка ${AB_NAMES[ab.id]||ab.name}`,dice:{20:1},mod:bonus,vis});}}
 const a=(m[b.dataset.list]||m.actions)?.[Number(b.dataset.i)];
 if(kind==='mattack'&&a){const bonus=catalogueAttackBonus(a);if(bonus===null){ctx.toast('Бонус атаки неизвестен: бросок не выполнен');return;}doRoll(ctx,{label:`${who}: ${a.name}`,dice:{20:1},mod:bonus,kind:'attack',vis});}
 if(kind==='mdamage'&&a){const part=String(m.id).startsWith('lib:')?a.damageComponents?.[Number(b.dataset.part)]:{dice:a.damage,type:a.type};const f=part&&parseFormula(part.dice);if(f)doRoll(ctx,{label:`${who}: ${a.name} — урон${part.type?` (${part.type})`:''}`,...f,vis});}
}
export {conditionById};
