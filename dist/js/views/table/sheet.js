// Лист Character и отдельный каталоговый статблок (TASK-004 / TASK-083).
import { esc, fmtMod, el } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { srcOf } from '../../core/assets.js';
import { tokenStats, monsterOf, characterOf, acWith } from '../../core/campaign.js';
import { npcMonster } from './sheet-creature.js';
import { conditionRoll, effectDamage, mergeDice, sheetWithEffects } from './effects-roll.js';
import { effectInstances } from '../../rules/effect-rows.js';
import { ABILITIES, SIZES, conditionById, woundLabel } from '../../data/rules.js';
import { conditionPicker } from './p-token.js';
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
  const view=()=>{const v=heroView(key);return v&&sheetWithEffects(v,characterOf(ctx.c,id),(ac)=>acWith(ac,ctx.c,id),effectInstances(ctx.c,id));};
  const render=()=>{const v=view();if(!v){closeSheet();return;}const y=box.querySelector('.s-drawer-scroll')?.scrollTop||0;box.innerHTML=`<div class="s-drawer-scroll">${drawerHTML(v,state.tab)}</div>`;box.querySelector('.s-drawer-scroll').scrollTop=y;};
  const L=(type,sel,fn)=>offs.push(on(box,type,sel,fn));
  hero={render,off:()=>offs.forEach(f=>f?.())};
  L('click','[data-close-sheet]',()=>closeSheet());
  L('click','[data-dtab]',(e,b)=>{state.tab=b.dataset.dtab;render();});
  bindSheet(box,L,view,render,{roll:(what,formula,v)=>heroRoll(ctx,v,what,formula),edit:()=>openCharacterSheet(ctx,id,'edit')});
  render();
}
/** Бросок из листа героя — кубами стола: «к20 +5» — проверка/атака, «2к8+3» — урон или лечение. */
function heroRoll(ctx,v,what,formula){
  const f=String(formula||'').replace(/\s+/g,'').replace(/[−–]/g,'-');
  const d20=/^к20([+-]\d+)?$/i.exec(f);
  if(d20){
   const kind=/атак|меч|лук|топор|кинжал|булав|посох|арбалет/i.test(what)?'attack':/спасбросок/i.test(what)?'save':'check';
   const cid=v.id?.split('~').pop(),plan=conditionRoll(characterOf(ctx.c,cid),{kind,what},effectInstances(ctx.c,cid));
   if(plan.autoFail){ctx.toast?.({title:`${v.name}: автопровал`,body:plan.why.join(', '),icon:'alert-circle'});return;}
   if(plan.adv)ctx.toast?.({title:plan.adv==='adv'?'С преимуществом':'С помехой',body:plan.why.join(', ')});
   doRoll(ctx,{label:`${v.name}: ${what}`,dice:{20:1,...plan.dice},mod:Number(d20[1]||0)+plan.mod,minus:plan.minus,adv:plan.adv,kind:kind==='attack'?'attack':'check',vis:poolVis(ctx)});return;
  }
  const p=parseFormula(f.replace(/\+мод\.?/,''));
  if(p){
   // Урон оружия: метки берём у атаки на листе; лечение и заклинания наложения не трогают.
   const cid=v.id?.split('~').pop(),name=String(what).split(':')[0],a=[...(v.actions?.action||[]),...(v.actions?.bonus||[])].find(x=>x.name===name&&x.tags);
   const e=a?effectDamage(characterOf(ctx.c,cid),['damage:weapon','attack:weapon',...a.tags],effectInstances(ctx.c,cid)):{dice:{},mod:0,minus:[],min:0};
   doRoll(ctx,{label:`${v.name}: ${what}`,dice:mergeDice(p.dice,e.dice),mod:p.mod+e.mod,minus:e.minus,min:e.min,kind:'damage',vis:poolVis(ctx)});return;}
  if(/^СЛ\d+$/i.test(f)){ctx.toast?.(`${what}: ${f.replace(/^СЛ/i,'СЛ ')} — бросает цель`);return;}
  ctx.toast?.(`${what}: не понял формулу «${formula}»`);
}
export function openStatblock(ctx,id){closeSheet();state={kind:'monster',id,tab:'main'};
  // Статблок существа свёрстан как лист героя (#203): те же шапка, хиты, плитки, характеристики и строки боя, без вкладок.
  drawer=el('<aside class="sheet-drawer panel hero-drawer monster-drawer" aria-label="Статблок"></aside>');ctx.root.append(drawer);
  drawer.addEventListener('click',e=>{
    if(e.target.closest('[data-close-sheet]')){closeSheet();return;}
    if(e.target.closest('[data-npc-edit]')){const t=sheetToken(ctx);if(t?.characterId)openCharacterSheet(ctx,t.characterId,'creature');return;}
    const desc=e.target.closest('[data-desc]');if(desc){const k=desc.dataset.desc;if(openDesc.has(k))openDesc.delete(k);else openDesc.add(k);desc.classList.toggle('open',openDesc.has(k));return;}
    const hp=e.target.closest('[data-mhp]');if(hp){monsterHp(ctx,hp);return;}
    const cond=e.target.closest('[data-mcond]');if(cond){const t=sheetToken(ctx);if(t&&canEditFoe(ctx,t))conditionPicker(ctx,[t.id],cond);return;}
    const b=e.target.closest('[data-roll]');if(b)monsterRoll(ctx,b);
  });refreshSheet(ctx);
}
export function refreshSheet(ctx){if(editor){editor.refresh();return;}if(state.kind==='hero'){hero?.render();return;}if(!drawer)return;
 const t=sheetToken(ctx);if(!t){closeSheet();return;}
 const y=drawer.querySelector('.s-drawer-scroll')?.scrollTop||0;
 drawer.innerHTML=`<div class="s-drawer-scroll">${monsterHTML(ctx,t)}</div>`;drawer.querySelector('.s-drawer-scroll').scrollTop=y;
}
const sheetToken=ctx=>ctx.scene?.tokens.find(x=>x.id===state.id);
// Хиты и состояния существа меняет тот, кто им управляет: мастер или хозяин призыва (TASK-183).
const canEditFoe=(ctx,t)=>(ctx.isMaster||ctx.owns?.(t))&&(ctx.canControl?ctx.canControl(t):!!ctx.isMaster);
function monsterHp(ctx,b){
 const t=sheetToken(ctx);if(!t||!canEditFoe(ctx,t))return;
 if(b.dataset.mhp==='pad')ctx.panels?.hpEditor?.(t.id,b);else ctx.panels?.applyHp?.([t.id],Number(b.dataset.mhp));
}

// Статблок существа. Ручные существа: особенности — строки; SRD (TASK-083): { name, en, desc } с английским текстом SRD.
const MLISTS = { actions: ['Действие', '1 за ход'], bonusActions: ['Бонусное действие', '1 за ход'], reactions: ['Реакция', '1 за раунд'], legendary: ['Легендарные действия', 'в конце чужого хода'] };
// Подпись способности своего существа (TASK-179): урон и спасбросок по-русски, а не служебной строкой копии.
const AB_NAMES = { str: 'Силы', dex: 'Ловкости', con: 'Телосложения', int: 'Интеллекта', wis: 'Мудрости', cha: 'Харизмы' };
function libMeta(a) {
  const dmg = (a.damageComponents || []).filter((d) => d.dice || d.type).map((d) => [d.dice, d.type].filter(Boolean).join(' '));
  const sv = a.save ? `Спасбросок ${AB_NAMES[a.save.ability] || a.save.ability}${a.save.dc != null ? ` СЛ ${a.save.dc}` : ''}${a.save.who === 'self' ? ', бросает само существо' : ''}` : '';
  return [...dmg, sv, a.recharge ? `перезарядка ${a.recharge}` : ''].filter(Boolean).join(' · ');
}
const openDesc = new Set(); // раскрытые описания: «monsterId:list:i» — переживают перерисовку листа
const ruDice = (s) => String(s).replace(/(\d)d(\d)/gi, '$1к$2');
const SPEED_RU = { walk: 'ходьба', fly: 'летая', swim: 'плавая', climb: 'лазая', burrow: 'копая' };
const MOVE = /^(летая|плавая|лазая|копая|парит)/i;

function traitHTML(m, x, i, lib = false) {
  if (typeof x === 'string') return `<div class="s-note-card m-trait"><p>${esc(x)}</p></div>`;
  // Каталог SRD — по-русски; нет перевода — английский оригинал. Свои существа (lib:) показываются как записаны.
  const ru = !lib && x.ru;
  const text = String((ru ? x.ru : x.desc) || '');
  const k = `${m.id}:traits:${i}`;
  // Короткое — целиком; длинное («Колдовство» лича) — четыре строки, нажатие раскрывает.
  const long = text.length > 240;
  return `<div class="s-note-card m-trait"><b>${esc(x.name)}</b>${text ? `<p class="atk-desc ${!long || openDesc.has(k) ? 'open' : ''}" lang="${ru ? 'ru' : 'en'}" ${long ? `data-desc="${esc(k)}" title="Показать целиком"` : ''}>${esc(text)}</p>` : ''}</div>`;
}

function actionHTML(m, list, a, i) {
  if (typeof a === 'string') return `<div class="s-note-card m-trait"><p>${esc(a)}</p></div>`;
  const lib = String(m.id).startsWith('lib:');
  let meta = lib ? libMeta(a) : [a.type, a.note].filter(Boolean).join(' · ');
  // «СЛ 12» — отдельным чипом, как СЛ заклинания на листе героя; в подписи остаётся «спасбросок ЛОВ, успех — половина».
  const dcm = /\s*СЛ\s?(\d+)/.exec(meta);
  if (dcm) meta = meta.replace(dcm[0], '');
  const bonus = catalogueAttackBonus(a);
  const damage = lib ? a.damageComponents || [] : a.damage ? [{ dice: a.damage, type: a.type }] : [];
  const hit = bonus !== null ? `<button class="s-chip hit" data-roll="mattack" data-list="${list}" data-i="${i}" aria-label="Атака: ${esc(a.name)}" title="Бросить атаку">${icon('dice-faces-06', 12)}${knownBonus(bonus)}</button>` : '';
  const dc = dcm ? `<span class="s-chip dc">СЛ ${esc(dcm[1])}</span>` : '';
  const dmg = damage.map((d, part) => d.dice ? parseFormula(d.dice) ? `<button class="s-chip dmg" data-roll="mdamage" data-list="${list}" data-i="${i}" data-part="${part}" aria-label="Урон: ${esc(a.name)}${d.type ? ` (${esc(d.type)})` : ''}" title="Бросить урон${d.type ? `: ${esc(d.type)}` : ''}">${esc(ruDice(d.dice))}${damage.length > 1 && d.type ? ` <small>${esc(d.type)}</small>` : ''}</button>`
    : `<span class="s-chip dc" title="Урон без броска">${esc(ruDice(d.dice))}${d.type ? ` ${esc(d.type)}` : ''}</span>` : '').join('');
  const rolls = hit + dc + dmg;
  const kind = bonus !== null ? 'weapon' : damage.length || dcm ? 'area' : 'feature';
  const k = `${m.id}:${list}:${i}`;
  // Описание без бросков — единственное, что есть у действия: показываем целиком; у атак — две строки, тап раскрывает.
  const ru = !lib && a.ru;
  const text = ru ? a.ru : a.desc;
  const desc = text ? `<p class="atk-desc ${!rolls || openDesc.has(k) ? 'open' : ''}" lang="${ru ? 'ru' : 'en'}" ${rolls ? `data-desc="${esc(k)}" title="Показать целиком"` : ''}>${esc(text)}</p>` : '';
  return `<div class="s-act ${kind} ${desc ? 'has-desc' : ''}">
    <span class="s-act-ic">${icon({ weapon: 'sword-01', area: 'flash', feature: 'star' }[kind], 18)}</span>
    <span class="s-act-t"><b>${esc(a.name)}</b>${meta.replace(/^[\s·]+|[\s·]+$/g, '') ? `<small>${esc(meta.replace(/^[\s·]+|[\s·]+$/g, ''))}</small>` : ''}</span>
    ${rolls ? `<span class="s-chips">${rolls}</span>` : ''}${desc}</div>`;
}

// Чувства, скорости кроме ходьбы, языки — короткой карточкой. В SRD «скорость: летая 80 фт, …» записана в начале чувств.
function factsHTML(m) {
  const parts = String(m.senses || '').replace(/^скорость:\s*/i, '').split(/,\s*/).map((s) => s.trim()).filter(Boolean);
  let speeds = parts.filter((s) => MOVE.test(s));
  const senses = parts.filter((s) => !MOVE.test(s));
  if (!speeds.length && m.speedDetails && typeof m.speedDetails === 'object') {
    speeds = Object.entries(m.speedDetails).filter(([k, v]) => k !== 'walk' && SPEED_RU[k] && v).map(([k, v]) => `${SPEED_RU[k]} ${Number.isFinite(v) ? `${v} фт` : String(v).replace(/ft\.?/, 'фт')}`);
  }
  const rows = [
    speeds.length ? ['Скорость', [Number.isFinite(m.speed) ? `ходьба ${m.speed} фт` : '', ...speeds].filter(Boolean).join(', ')] : null,
    senses.length ? ['Чувства', senses.join(', ')] : null,
    m.languages ? ['Языки', m.languages] : null,
  ].filter(Boolean);
  return rows.length ? `<div class="m-facts">${rows.map(([k, v]) => `<div class="m-fact"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>` : '';
}

// Постоянный NPC показывается своим листом как статблок; остальные существа — из каталога.
const tokenMonster = (ctx, t) => { const ch = t.characterId ? characterOf(ctx.c, t.characterId) : null; return ch?.statblock ? npcMonster(ch) : monsterOf(ctx.c, t.monsterId); };
function monsterHTML(ctx, t) {
  const st = tokenStats(ctx.c, t);
  const m = tokenMonster(ctx, t);
  const isM = ctx.isMaster || ctx.owns?.(t); // свой призыв владелец видит целиком (TASK-183)
  const can = canEditFoe(ctx, t);
  const lib = String(t.monsterId || '').startsWith('lib:');
  const copyOwner = lib ? ctx.c.creatures?.[t.monsterId.slice(4)]?.ownerId : null;
  const close = `<button class="icon-btn icon-btn-sm" data-close-sheet aria-label="Закрыть">${icon('cancel-01', 18)}</button>`;
  // Скрытое имя (nameHidden) игрок не узнаёт и из статблока: ни имени, ни вида, ни КО.
  const masked = !isM && t.nameHidden && t.kind !== 'hero';
  const name = isM ? t.name : ctx.nameOf ? ctx.nameOf(t, st) : t.name;
  const side = t.kind === 'foe' ? 'foe' : t.ownerId || t.summonedBy || t.kind === 'hero' ? 'ally' : 'neutral';
  const edit = t.characterId && can ? `<button class="icon-btn icon-btn-sm" data-npc-edit aria-label="Все поля листа" title="Все поля листа">${icon('pencil-edit-02', 18)}</button>` : '';
  const head = (sub) => `<header class="s-head"><span class="s-portrait ${side}"><img src="${esc(srcOf(t.img))}" alt=""></span>
    <span class="s-who"><b class="s-name" title="${esc(name)}">${esc(name)}</b>${sub ? `<small><span>${sub}</span></small>` : ''}</span>${edit}${close}</header>`;
  if (!m) return head(t.monsterId?.startsWith('srd:') ? 'Бестиарий загружается…' : '');
  const sizeName = SIZES.find((s) => s.id === m.size)?.name;
  const sub = masked ? 'Неизвестное существо' : [`${esc(m.name)}${m.en && isM ? ` <span lang="en">(${esc(m.en)})</span>` : ''}`, esc(m.type || ''), sizeName ? esc(sizeName.toLowerCase()) : ''].filter(Boolean).join(' · ');

  // Хиты: мастеру и хозяину — числа с полосой и кнопками, игроку — как на панели токена (числа союзника или «ранен»).
  const cur = t.characterId ? st.hp : t.hp, max = t.characterId ? st.hpMax : t.hpMax;
  const seeHp = isM || t.ownerId || t.summonedBy || ctx.c.settings?.playersSeeHp === 'exact';
  const pct = Number.isFinite(cur) && max > 0 ? Math.max(0, Math.min(100, Math.round((cur / max) * 100))) : 0;
  const low = max > 0 && cur > 0 && cur / max <= 0.3;
  const wound = max > 0 ? woundLabel(st.hp, st.hpMax) : '';
  const mid = seeHp && max > 0 || isM
    ? `<span class="s-hp-row"><span class="k">Хиты</span><b data-hp-now>${knownNumber(cur)}</b><span class="max">/ ${knownNumber(max)}</span>${st.tempHp ? `<span class="s-temp">${icon('shield-01', 12)}+${esc(st.tempHp)}</span>` : ''}${isM && m.hpDice ? `<span class="m-hp-dice">${esc(ruDice(m.hpDice))}</span>` : ''}</span><span class="s-hp-bar"><i style="width:${pct}%"></i></span>`
    : `<span class="s-hp-row"><span class="k">Хиты</span><b class="m-wound">${wound ? esc(wound[0].toUpperCase() + wound.slice(1)) : '?'}</b></span>`;
  const hpCard = `<div class="s-hp ${seeHp && max > 0 && cur === 0 ? 'zero' : ''} ${seeHp && low ? 'low' : ''}">
    ${can ? `<button class="s-hp-btn" data-mhp="-1" aria-label="Урон 1" title="−1">${icon('minus-sign', 18)}</button><button class="s-hp-mid" data-mhp="pad" aria-label="Урон, лечение, временные хиты" title="Урон, лечение, временные хиты — числом">${mid}</button><button class="s-hp-btn" data-mhp="1" aria-label="Лечение 1" title="+1">${icon('plus-sign', 18)}</button>` : `<div class="s-hp-mid">${mid}</div>`}
  </div>`;

  // Плитки — как у героя: КД, инициатива (бросок), скорость, а вместо мастерства — класс опасности.
  const ac = Number.isFinite(t.ac) ? t.ac : m.ac;
  const init = Number.isSafeInteger(t.initBonus) ? t.initBonus : m.init;
  const speed = Number.isFinite(t.speed) ? t.speed : m.speed;
  const vitals = `<div class="s-vitals">
    <span class="s-vital ac">${icon('shield-01', 16)}<b>${isM ? knownNumber(ac) : '?'}</b><small>КД</small></span>
    ${isM && Number.isSafeInteger(init) ? `<button class="s-vital" data-roll="minit" title="Бросить инициативу">${icon('flash', 16)}<b>${knownBonus(init)}</b><small>Инициатива</small></button>` : `<span class="s-vital">${icon('flash', 16)}<b>${masked ? '?' : knownBonus(init)}</b><small>Инициатива</small></span>`}
    <span class="s-vital">${icon('running-shoes', 16)}<b>${knownNumber(speed)}</b><small>фт ходьба</small></span>
    <span class="s-vital">${icon('skull', 16)}<b>${!masked && m.cr != null && m.cr !== '' ? esc(m.cr) : '—'}</b><small>КО</small></span></div>`;

  if (!isM) return `${head(sub)}${hpCard}${vitals}<p class="s-none">Подробности о существе знает только мастер.</p>`;

  const conds = st.conditions.map((id) => conditionById(id)).filter(Boolean);
  const condRow = conds.length || can ? `<div class="s-conc">${conds.map((c) => can ? `<button class="s-cond" data-mcond title="Состояния">${esc(c.name)}</button>` : `<span class="s-cond">${esc(c.name)}</span>`).join('')}${can ? `<button class="s-add" data-mcond>${icon('plus-sign', 14)}Состояние</button>` : ''}</div>` : '';
  // Характеристика: проверка — по карточке, спасбросок — строкой под ней (золотая точка — владеет), как у героя.
  const stats = `<div class="s-stats row6">${ABILITIES.map((a) => {
    const score = m.stats?.[a.id], mod = abilityModifier(score);
    const prof = Number.isSafeInteger(m.saves?.[a.id]);
    const save = prof ? m.saves[a.id] : mod;
    return `<div class="s-stat"><button class="s-stat-main" data-roll="mcheck" data-ab="${a.id}" ${mod === null ? 'disabled' : ''} title="Проверка: ${esc(a.name)}"><small>${a.short}</small><b>${knownBonus(mod)}</b><span>${knownNumber(score)}</span></button><button class="s-stat-save ${prof ? 'prof' : ''}" data-roll="msave" data-ab="${a.id}" ${save === null ? 'disabled' : ''} title="Спасбросок: ${esc(a.name)}${prof ? ' (владеет)' : ''}"><i></i>спас ${knownBonus(save)}</button></div>`;
  }).join('')}</div>`;
  const legendaryNote = Number.isSafeInteger(m.legendaryCount) && m.legendaryCount > 0 ? `${m.legendaryCount} за раунд` : null;
  const groups = Object.entries(MLISTS).filter(([list]) => m[list]?.length).map(([list, [title, note]]) => `<div class="s-group"><span class="h-caps">${title}</span><small>${list === 'legendary' && legendaryNote ? legendaryNote : note}</small></div>
    ${m[list].map((a, i) => actionHTML(m, list, a, i)).join('')}`).join('');
  return `${head(sub)}${hpCard}${vitals}${condRow}${stats}${factsHTML(m)}
    ${m.statblockImage ? `<img class="sheet-source-image" src="${esc(srcOf(m.statblockImage))}" alt="Статблок: ${esc(m.name)}" loading="lazy">` : ''}
    ${m.traits?.length ? `<div class="s-group"><span class="h-caps">Особенности</span></div>${m.traits.map((x, i) => traitHTML(m, x, i, lib)).join('')}` : ''}
    ${groups}
    <p class="m-source">${lib ? `Своё существо — копия из ${copyOwner === ctx.userId ? 'вашей библиотеки' : copyOwner ? 'библиотеки игрока' : 'библиотеки мастера'} в этой кампании${m.provenance ? '; основа — SRD 5.1 (CC BY 4.0)' : ''}.` : m.srd ? 'Числа и описания — SRD 5.1 (CC BY 4.0); русские названия и перевод описаний — наши.' : 'Числа — SRD 5.1 (CC BY 4.0).'}</p>`;
}

function monsterRoll(ctx,b){
 const t=sheetToken(ctx);
 if(!t||!(ctx.isMaster||ctx.owns?.(t)))return; // свой призыв бросает и владелец (TASK-183)
 const m=tokenMonster(ctx,t);if(!m)return;
 const kind=b.dataset.roll,vis=poolVis(ctx,!!t.hidden),who=ctx.nameOf?ctx.nameOf(t):t.name;
 if(kind==='minit'){const init=Number.isSafeInteger(t.initBonus)?t.initBonus:m.init;if(Number.isSafeInteger(init))doRoll(ctx,{label:`${who}: инициатива`,dice:{20:1},mod:init,adv:conditionRoll(t,{kind:'check',ability:'dex'}).adv,vis});return;}
 if(kind==='mcheck'||kind==='msave'){const ab=ABILITIES.find(a=>a.id===b.dataset.ab);if(!ab)return;
  const mod=abilityModifier(m.stats?.[ab.id]),bonus=kind==='msave'&&Number.isSafeInteger(m.saves?.[ab.id])?m.saves[ab.id]:mod;
  if(bonus===null){ctx.toast('Характеристика неизвестна: бросок не выполнен');return;}
  const plan=conditionRoll(t,{kind:kind==='msave'?'save':'check',ability:ab.id},effectInstances(ctx.c,t.id));
  if(plan.autoFail){ctx.toast({title:`${who}: автопровал`,body:plan.why.join(', '),icon:'alert-circle'});return;}
  doRoll(ctx,{label:`${who}: ${kind==='msave'?'спасбросок':'проверка'} ${AB_NAMES[ab.id]||ab.name}`,dice:{20:1,...plan.dice},mod:bonus+plan.mod,minus:plan.minus,adv:plan.adv,vis});return;}
 const a=(m[b.dataset.list]||m.actions)?.[Number(b.dataset.i)];
 if(kind==='mattack'&&a){const bonus=catalogueAttackBonus(a);if(bonus===null){ctx.toast('Бонус атаки неизвестен: бросок не выполнен');return;}const plan=conditionRoll(t,{kind:'attack'},effectInstances(ctx.c,t.id));doRoll(ctx,{label:`${who}: ${a.name}`,dice:{20:1,...plan.dice},mod:bonus+plan.mod,minus:plan.minus,adv:plan.adv,kind:'attack',vis});}
 if(kind==='mdamage'&&a){const part=String(m.id).startsWith('lib:')?a.damageComponents?.[Number(b.dataset.part)]:{dice:a.damage,type:a.type};const f=part&&parseFormula(part.dice);if(f){const e=Number(b.dataset.part||0)===0?effectDamage(t,['damage:weapon','attack:weapon'],effectInstances(ctx.c,t.id)):{dice:{},mod:0,minus:[],min:0};doRoll(ctx,{label:`${who}: ${a.name} — урон${part.type?` (${part.type})`:''}`,dice:mergeDice(f.dice,e.dice),mod:f.mod+e.mod,minus:e.minus,min:e.min,vis});}}
}
export {conditionById};
