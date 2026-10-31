// Лист Character и отдельный каталоговый статблок (TASK-004 / TASK-083).
import { esc, fmtMod, el } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { srcOf } from '../../core/assets.js';
import { tokenStats } from '../../core/campaign.js';
import { ABILITIES, conditionById } from '../../data/rules.js';
import { monsterById } from '../../data/bestiary.js';
import { doRoll, parseFormula } from './dice.js';
import { abilityModifier } from './sheet-rules.js';
import { catalogueAttackBonus } from './sheet-fields.js';
import { createSheetEditor } from './sheet-editor.js';
const knownNumber = value => Number.isFinite(value) ? value : '—';
const knownBonus = value => Number.isSafeInteger(value) ? fmtMod(value) : '—';
let drawer=null, editor=null;
let state={kind:null,id:null,tab:'main'};
export function closeSheet(){editor?.close();editor=null;drawer?.remove();drawer=null;state={kind:null,id:null,tab:'main'};}
export const sheetOpenFor=()=>({...state,tab:editor?.tab||state.tab});
export function openCharacterSheet(ctx,id,tab){
  if(editor&&state.id===id&&!tab)return;
  closeSheet();state={kind:'character',id,tab:tab||'main'};
  drawer=el('<aside class="sheet-drawer panel sheet-editor" aria-label="Лист персонажа"></aside>');ctx.root.append(drawer);
  editor=createSheetEditor(ctx,drawer,id,state.tab,closeSheet,nextId=>openCharacterSheet(ctx,nextId));
}
export function openStatblock(ctx,id){closeSheet();state={kind:'monster',id,tab:'main'};
  drawer=el('<aside class="sheet-drawer panel" aria-label="Статблок"></aside>');ctx.root.append(drawer);
  drawer.addEventListener('click',e=>{
    if(e.target.closest('[data-close-sheet]')){closeSheet();return;}
    const desc=e.target.closest('[data-desc]');if(desc){const k=desc.dataset.desc;if(openDesc.has(k))openDesc.delete(k);else openDesc.add(k);desc.classList.toggle('open',openDesc.has(k));return;}
    const b=e.target.closest('[data-roll]');if(b)monsterRoll(ctx,b);
  });refreshSheet(ctx);
}
export function refreshSheet(ctx){if(editor){editor.refresh();return;}if(!drawer)return;
 const t=ctx.scene?.tokens.find(x=>x.id===state.id);if(!t){closeSheet();return;}drawer.innerHTML=monsterHTML(ctx,t);
}
// Статблок существа. Ручные существа: особенности — строки; SRD (TASK-083): { name, en, desc } с английским текстом SRD.
const MLISTS = { actions: 'Действия', reactions: 'Реакции', legendary: 'Легендарные действия' };
const openDesc = new Set(); // раскрытые описания: «monsterId:list:i» — переживают перерисовку листа

function traitHTML(x) {
  if (typeof x === 'string') return `<p class="t-para trait">${esc(x)}</p>`;
  return `<p class="t-para trait"><b>${esc(x.name)}.</b> <span lang="en">${esc(x.desc)}</span></p>`;
}

function actionHTML(m, list, a, i) {
  const meta = [a.type, a.note].filter(Boolean).join(' · ');
  const bonus = catalogueAttackBonus(a);
  const rolls = (bonus !== null ? `<button class="btn btn-sm btn-secondary" data-roll="mattack" data-list="${list}" data-i="${i}" aria-label="Атака: ${esc(a.name)}">${knownBonus(bonus)}</button>` : '')
    + (a.damage ? parseFormula(a.damage) ? `<button class="btn btn-sm btn-secondary" data-roll="mdamage" data-list="${list}" data-i="${i}" aria-label="Урон: ${esc(a.name)}">${esc(a.damage)}</button>`
      : `<span class="chip" title="Урон без броска">${esc(a.damage)} урон</span>` : '');
  const k = `${m.id}:${list}:${i}`;
  // Описание без бросков — единственное, что есть у действия: показываем целиком; у атак — две строки, тап раскрывает.
  const desc = a.desc ? `<p class="atk-desc ${!rolls || openDesc.has(k) ? 'open' : ''}" lang="en" ${rolls ? `data-desc="${esc(k)}" title="Показать целиком"` : ''}>${esc(a.desc)}</p>` : '';
  return `<div class="attack-row ${desc ? 'has-desc' : ''}"><div class="grow"><b>${esc(a.name)}</b>${meta ? `<small class="muted">${esc(meta)}</small>` : ''}${desc}</div>${rolls}</div>`;
}

function monsterHTML(ctx, t) {
  const st = tokenStats(ctx.c, t);
  const m = monsterById(t.monsterId);
  const isM = ctx.isMaster;
  const currentHp = t.characterId ? st.hp : t.hp, maxHp = t.characterId ? st.hpMax : t.hpMax;
  if (!m) return `<header class="sheet-head"><div class="titles grow"><b>${esc(t.name)}</b>${t.monsterId?.startsWith('srd:') ? '<div class="t-sm muted">Бестиарий загружается…</div>' : ''}</div><button class="icon-btn icon-btn-sm" data-close-sheet>${icon('cancel-01', 18)}</button></header>`;
  const saves = m.saves ? ABILITIES.filter((a) => Number.isSafeInteger(m.saves[a.id])).map((a) => `${a.short} ${fmtMod(m.saves[a.id])}`).join(', ') : '';
  return `<header class="sheet-head">
      <span class="sheet-portrait foe" style="background-image:url(&quot;${esc(srcOf(t.img))}&quot;)"></span>
      <div class="titles grow"><b class="t-lg">${esc(t.name)}</b><div class="t-sm muted">${esc(m.name)}${m.en && isM ? ` <span lang="en">(${esc(m.en)})</span>` : ''} · ${esc(m.type)} · КО ${esc(m.cr)}</div></div>
      <button class="icon-btn icon-btn-sm" data-close-sheet aria-label="Закрыть">${icon('cancel-01', 18)}</button>
    </header>
    <div class="sheet-vitals">
      <div class="vital hp"><small>Хиты</small><b>${isM ? `${knownNumber(currentHp)}<span>/${knownNumber(maxHp)}</span>` : '?'}</b><small class="tertiary">${esc(m.hpDice)}</small></div>
      <div class="vital"><small>КД</small><b>${isM ? knownNumber(m.ac) : '?'}</b></div>
      <div class="vital"><small>Скорость</small><b>${knownNumber(m.speed)}<span> фт</span></b></div>
      <div class="vital"><small>Иниц.</small><b>${knownBonus(m.init)}</b></div>
    </div>
    <div class="sheet-body scroll">
      ${isM ? `<div class="abilities">${ABILITIES.map((a) => {const score=m.stats?.[a.id],bonus=abilityModifier(score);return `<div class="ability"><span class="ab-name">${a.short}</span><button class="ab-mod" data-roll="mcheck" data-ab="${a.id}" ${bonus===null?'disabled':''}>${knownBonus(bonus)}</button><span class="ab-score">${knownNumber(score)}</span></div>`;}).join('')}</div>
      ${saves ? `<p class="t-sm muted" style="margin:12px 0 0">Спасброски: ${saves}</p>` : ''}
      <p class="t-sm muted" style="margin:12px 0">${esc(m.senses)}</p>
      ${(m.traits||[]).map(traitHTML).join('')}
      ${Object.entries(MLISTS).filter(([list]) => m[list]?.length).map(([list, title]) => `<div class="section-label" style="margin:16px 0 8px">${title}</div>
      ${list === 'reactions' ? m.reactions.map(traitHTML).join('') : `<div class="attacks">${m[list].map((a, i) => actionHTML(m, list, a, i)).join('')}</div>`}`).join('')}
      <p class="t-xs tertiary" style="margin-top:16px">${m.srd ? 'Числа и английские описания — SRD 5.1 (CC BY 4.0), русские названия — наши.' : 'Числа — SRD 5.1 (CC BY 4.0).'}</p>` : '<p class="muted t-para">Подробности о существе знает только мастер.</p>'}
    </div>`;
}

function monsterRoll(ctx,b){
 if(!ctx.isMaster)return;
 const t=ctx.scene?.tokens.find(x=>x.id===state.id),m=monsterById(t?.monsterId);if(!m)return;
 const kind=b.dataset.roll,hidden=!!ctx.ui.dicePool?.hidden;
 if(kind==='mcheck'){const ab=ABILITIES.find(a=>a.id===b.dataset.ab);if(ab){const bonus=abilityModifier(m.stats?.[ab.id]);if(bonus===null){ctx.toast('Характеристика неизвестна: бросок не выполнен');return;}doRoll(ctx,{label:`${t.name}: проверка ${ab.name}`,dice:{20:1},mod:bonus,hidden});}}
 const a=(m[b.dataset.list]||m.actions)?.[Number(b.dataset.i)];
 if(kind==='mattack'&&a){const bonus=catalogueAttackBonus(a);if(bonus===null){ctx.toast('Бонус атаки неизвестен: бросок не выполнен');return;}doRoll(ctx,{label:`${t.name}: ${a.name}`,dice:{20:1},mod:bonus,kind:'attack',hidden});}
 if(kind==='mdamage'&&a){const f=parseFormula(a.damage);if(f)doRoll(ctx,{label:`${t.name}: ${a.name} — урон`,...f,hidden});}
}
export {conditionById};
