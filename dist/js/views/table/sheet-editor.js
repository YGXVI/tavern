// TASK-004: редактируемый черновик листа. Запись — явная, ACK не подменяется optimistic commit.
import { esc, fmtMod, uid } from '../../core/dom.js';
import { characterOf, updateCampaign, isMasterOf, membership } from '../../core/campaign.js';
import { isServerMode, bus } from '../../core/store.js';
import { modal, confirmDialog } from '../../ui/kit.js';
import { ABILITIES, SKILLS, CONDITIONS } from '../../data/rules.js';
import { readCharacterSheet, submitCharacterCommand, characterSheetMeta, createCharacterSheet } from '../../server/sync.js';
import { makeSheetCommand } from '../../server/character-sheet.js';
import { characterEditPayload, rebaseCharacterDraft, sameSheetValue, putSheetPath } from '../../server/character-sheet-ops.js';
import { copy, fieldValue, setField, parseField, sheetLevel, sheetBonus, sheetInitiative, validateDraft, attackBonus, proficiencyValue, prepareSheetDerived } from './sheet-fields.js';
import { abilityModifier, sheetProficiency, spellNumbers } from './sheet-rules.js';
import { emptySheet, sheetFromSrd, copySheet, validateSheetStatblock } from './sheet-creature.js';
import { storeImage, resolveSrc, srcOf } from '../../core/assets.js';
import { BESTIARY, loadSrdBestiary } from '../../data/bestiary.js';
import { applyZeroHp, archiveLocalCharacter, restoreLocalCharacter } from './sheet-lifecycle.js';
import { readCharacter } from './sheet-model.js';
import { previewSidekickGrowth, applySidekickGrowthPreview } from './sheet-growth.js';
import { partyLevelHint } from './sheet-rules.js';
import { previewRest } from './sheet-rest.js';
import { doRoll, parseFormula } from './dice.js';

const tabs = [['main','Личность'], ['skills','Характеристики'], ['combat','Бой'], ['spells','Магия'], ['gear','Снаряжение'], ['features','Способности'], ['notes','Заметки'], ['creature','Существо / Sidekick']];
const number = (name, label, min = 0, max = Number.MAX_SAFE_INTEGER) => ({ name, label, type: 'number', min, max });
const text = (name, label) => ({ name, label, type: 'text' });
const select = (name, label, options) => ({ name, label, type: 'select', options });
const recovery = select('recovery', 'Восстановление', [['manual','Вручную'],['short','Короткий'],['long','Продолжительный'],['both','Любой отдых']]);
const ability = select('ability','Характеристика', [['','Вручную'], ...ABILITIES.map((a) => [a.id,a.short])]);
const tables = {
  classes: ['Классы и мультикласс', [text('name','Класс'),text('subclass','Подкласс'),number('levels','Уровни',1,20)]],
  attacks: ['Атаки', [text('name','Название'),ability,{name:'proficient',label:'Владение атакой',type:'boolean'},number('bonus','Итог вручную (пусто — расчёт)',-100,100),text('damage','Формула урона'),text('type','Тип урона'),text('note','Описание')]],
  actions: ['Действия', [text('name','Название'),text('description','Текст'),text('formula','Формула броска')]],
  bonusActions: ['Бонусные действия', [text('name','Название'),text('description','Текст')]],
  reactions: ['Реакции', [text('name','Название'),text('description','Текст')]],
  hitDicePools: ['Кости хитов', [text('name','Источник'),select('die','Кость',[['','Неизвестна'],...[4,6,8,10,12,20].map((v)=>[String(v),`d${v}`])]),number('total','Всего'),number('spent','Потрачено')]],
  spellSources: ['Источники магии', [text('name','Источник'),ability,text('kind','Известные / подготовленные'),number('attackOverride','Атака вручную',-100,100),number('dcOverride','Сл вручную',0,100)]],
  knownSpells: ['Заклинания', [text('name','Название'),number('circle','Круг',0,9),text('sourceId','ID источника'),{name:'prepared',label:'Подготовлено',type:'boolean'},{name:'ritual',label:'Ритуал',type:'boolean'},text('description','Текст')]],
  slotPools: ['Пулы ячеек', [text('name','Источник'),number('circle','Круг',1,9),select('kind','Вид',[['spellcasting','Колдовство'],['pact','Магия договора'],['custom','Особый']]),number('max','Всего'),number('spent','Потрачено'),recovery]],
  inventoryItems: ['Предметы', [text('name','Название'),number('quantity','Количество'),{...number('weight','Вес'),type:'decimal'},{name:'equipped',label:'Надет / в руках',type:'boolean'},{name:'attuned',label:'Настроен',type:'boolean'},text('description','Описание')]],
  featureEntries: ['Способности', [text('name','Название'),text('source','Источник'),text('description','Текст')]],
  resources: ['Расходуемые ресурсы', [text('name','Название'),number('max','Всего'),number('spent','Потрачено'),recovery]],
};
const statAbilityFields=[text('name','Название'),text('text','Описание'),number('attack.bonus','Бонус атаки вручную',-100,100),number('attack.reach','Досягаемость, фт'),text('damage.0.dice','Первый компонент урона: формула'),text('damage.0.type','Тип урона'),select('save.ability','Спасбросок: характеристика',[['','Не задан'],...ABILITIES.map(a=>[a.id,a.short])]),number('save.dc','Сл спасброска'),select('save.who','Кто бросает',[['','Выберите явно'],['target','Цель'],['self','Само существо']]),number('rechargeMin','Перезарядка d6: от',1,6),number('rechargeMax','Перезарядка d6: до',1,6)];
for(const [key,title]of [['traits','Особенности существа'],['actions','Действия существа'],['bonusActions','Бонусные действия существа'],['reactions','Реакции существа'],['legendary.actions','Легендарные действия'],['lairActions','Логовные действия']])tables['statblock.'+key]=[title,statAbilityFields];
const currentFields = new Set(['hp','tempHp','conditions','deathSaves','concentration']);
const display = (n) => n === null || n === undefined ? '—' : fmtMod(n);
function blank(field) {
  const item = { id: uid('sheet-') };
  for (const f of tables[field][1].filter(f=>!f.name.includes('.'))) item[f.name] = f.type === 'number' ? null : f.type === 'boolean' ? false : f.options?.[0]?.[0] ?? '';
  if(field==='hitDicePools')item.die=null;
  return item;
}
function plain(ch) { const { id, ownerId, ...data } = ch; return copy(data); }
function source(ctx,id) { return characterOf(ctx.c,id) || ctx.c?.archivedCharacters?.find((c) => c.id === id); }

export function createSheetEditor(ctx, host, id, initialTab, onClose, onOpen) {
  const key = `rasputye:sheet-draft:${isServerMode()?'server':'sandbox'}:${ctx.userId}:${ctx.cid}:${id}`;
  let ch = source(ctx,id), base = plain(ch), draft = copy(base), version = null, controllers = [], archived = false;
  let tab = tabs.some(([t])=>t===initialTab) ? initialTab : 'main', status = '', busy = false, reading = false, conflicts = [], error = null, pending = null;
  const invalid = new Map(); let dead = false;
  try { const saved = JSON.parse(sessionStorage.getItem(key)); if (saved?.base && saved?.draft) { base=saved.base; draft=saved.draft; pending=saved.pending||null; for(const [k,v] of saved.invalid||[]) invalid.set(k,v); status='Черновик восстановлен'; } } catch { /* хранилище может быть недоступно */ }
  const dirty = () => invalid.size > 0 || !sameSheetValue(base,draft);
  const active = () => membership(ctx.c,ctx.userId)?.status === 'active';
  const builder = () => active() && (isMasterOf(ctx.c,ctx.userId) || source(ctx,id)?.ownerId === ctx.userId);
  const control = () => !archived && (builder() || (active() && controllers.includes(ctx.userId)));
  const permitted = (path) => !archived && (currentFields.has(path.split('.')[0]) || /^(slots\.[^.]+\.used|(?:resources|slotPools|hitDicePools)\.\d+\.spent)$/.test(path) ? control() : builder());
  function persist() {
    try { if (dirty()||pending) sessionStorage.setItem(key,JSON.stringify({base,draft,invalid:[...invalid],pending})); else sessionStorage.removeItem(key); } catch { status='Черновик хранится только в открытом окне'; }
  }
  function field(path,label,type='text',opts={}) {
    const f = { path,label,type,...opts }, value = invalid.has(path) ? invalid.get(path).raw : fieldValue(draft,path) ?? opts.defaultValue;
    const disabled = busy || reading || (isServerMode()&&version===null) || !!pending || !permitted(path) || (path==='level' && ((draft.classes?.length>0)||draft.profile==='sidekick'));
    const attr = `data-field="${esc(path)}" data-type="${type}" ${disabled?'disabled':''} ${opts.min!==undefined?`data-min="${opts.min}"`:''} ${opts.max!==undefined?`data-max="${opts.max}"`:''}`;
    const issue = invalid.get(path)?.error;
    let input;
    if (type==='select') input=`<select ${attr}>${f.options.map(([v,n])=>`<option value="${esc(v)}" ${String(value??'')===String(v)?'selected':''}>${esc(n)}</option>`).join('')}</select>`;
    else if(type==='boolean') input=`<input type="checkbox" ${attr} ${value?'checked':''}>`;
    else if(type==='textarea') input=`<textarea ${attr} rows="4">${esc(value)}</textarea>`;
    else input=`<input type="text" ${type==='number'||type==='decimal'?'inputmode="decimal"':''} ${attr} value="${esc(value)}" ${issue?'aria-invalid="true"':''}>`;
    return `<label class="sheet-field ${type==='textarea'?'sheet-wide':''}"><span>${esc(label)}</span>${input}${issue?`<small class="sheet-error">${esc(issue)}</small>`:''}</label>`;
  }
  function group(fieldName) {
    const [title, fs] = tables[fieldName], entries = Array.isArray(fieldValue(draft,fieldName)) ? fieldValue(draft,fieldName) : [];
    return `<section class="sheet-sect"><h3>${title}</h3>${entries.map((entry,i)=>`<fieldset class="sheet-entry"><legend>${esc(entry.name||`Запись ${i+1}`)}</legend><div class="sheet-form-grid">${fs.map((f)=>{if(fieldName==='knownSpells'&&f.name==='sourceId')return field(`${fieldName}.${i}.sourceId`,'Источник магии','select',{options:[['','Не выбран'],...(draft.spellSources||[]).map(s=>[s.id,s.name||'Без названия'])]});return field(`${fieldName}.${i}.${f.name}`,f.label,f.type,f);}).join('')}</div>${builder()&&!archived?`<button class="btn btn-sm btn-ghost" data-remove="${fieldName}" data-i="${i}">Убрать запись</button>`:''}${fieldName.startsWith('statblock.')?`<div class="row wrap"><button class="btn btn-sm btn-secondary" data-static-attack="${fieldName}.${i}">Атака ${display(entry.attack?.bonus)}</button>${(entry.damage||[]).map((part,j)=>`<button class="btn btn-sm btn-secondary" data-static-damage="${fieldName}.${i}.damage.${j}">Компонент ${j+1}: ${esc(part.dice??'—')}</button>`).join('')}</div>${(entry.damage||[]).slice(1).map((part,j)=>`<div class="sheet-form-grid">${field(`${fieldName}.${i}.damage.${j+1}.dice`,`Компонент ${j+2}: формула`)}${field(`${fieldName}.${i}.damage.${j+1}.type`,'Тип урона')}</div>`).join('')}${builder()&&!archived?`<button class="btn btn-sm btn-ghost" data-add-component="${fieldName}.${i}">Добавить компонент урона</button>`:''}`:''}${fieldName==='attacks'?`<button class="btn btn-sm btn-secondary" data-attack="${i}">Атака</button><button class="btn btn-sm btn-secondary" data-damage="${i}">Урон</button>`:''}${fieldName==='spellSources'?spellInfo(entry):''}</fieldset>`).join('')}${builder()&&!archived?`<button class="btn btn-sm btn-secondary" data-add="${fieldName}">Добавить</button>`:''}</section>`;
  }
  function spellInfo(s) {
    const result=spellNumbers({score:draft.stats?.[s.ability],proficiency:proficiencyValue(draft).value});
    return `<p class="muted t-sm">По характеристике и мастерству: атака ${display(result.attack.value)}, Сл ${result.dc.value??'—'}${s.attackOverride!=null||s.dcOverride!=null?' · действуют ручные значения выше':''}</p>`;
  }
  function legacy(fieldName,label) { return typeof draft[fieldName]==='string' ? field(fieldName,`${label} — прежняя запись`,'textarea') : ''; }
  function body() {
    if(tab==='main') return `<div class="sheet-form-grid">${field('name','Имя')}${field('raceName','Раса / происхождение')}${field('background','Предыстория')}${field('alignment','Мировоззрение')}${field('className','Название класса (старый лист)')}${field('level','Уровень', 'number',{min:1,max:20})}</div>${group('classes')}<p class="muted t-sm">Общий уровень: ${sheetLevel(draft)??'неизвестен'}. Список классов имеет приоритет для расчёта. Выбор способностей и законность сборки проверяются вручную.</p>`;
    if(tab==='skills') return `<div class="sheet-form-grid">${ABILITIES.map((a)=>`<div>${field(`stats.${a.id}`,a.name,'number')}<button class="btn btn-sm btn-secondary" data-ability="${a.id}">Проверка ${display(abilityModifier(draft.stats?.[a.id]))}</button></div>`).join('')}</div><p class="muted t-sm">Бонус мастерства: ${display(proficiencyValue(draft).value)}. Пассивное Восприятие: ${sheetBonus(draft,'skills','perception','wis').value===null?'—':10+sheetBonus(draft,'skills','perception','wis').value}. Пустое число означает «неизвестно».</p>${field('overrides.proficiency.value','Бонус мастерства вручную (пусто — расчёт)','number',{min:0,max:100})}${field('overrides.proficiency.reason','Основание переопределения мастерства')}${[['saves',ABILITIES],['skills',SKILLS]].map(([kind,list])=>`<section class="sheet-sect"><h3>${kind==='saves'?'Спасброски':'Навыки'}</h3>${list.map((a)=>{
      const result=sheetBonus(draft,kind,a.id,a.ab||a.id), mult=draft.proficiencies?.[kind]?.[a.id]??(draft[kind]?.includes(a.id)?1:0);
      return `<details class="sheet-check"><summary><button class="btn btn-sm btn-secondary" data-check="${kind}" data-id="${a.id}">${display(result.value)}</button> ${esc(a.name)} <small>${mult===2?'экспертиза':mult===1?'владение':mult===0.5?'½ мастерства':''}${result.overridden?' · вручную':''}</small></summary><div class="sheet-form-grid">${field(`proficiencies.${kind}.${a.id}`,'Мастерство','select',{defaultValue:mult,options:[['0','Нет'],['0.5','Половина'],['1','Владение'],['2','Экспертиза']]})}${field(`overrides.${kind}.${a.id}.value`,'Итог вручную (пусто — расчёт)','number',{min:-100,max:100})}${field(`overrides.${kind}.${a.id}.reason`,'Основание исключения')}</div><p class="t-sm muted">Расчёт ${display(result.calculated)}: характеристика ${display(result.components.modifier)}, мастерство ${display(result.components.proficiency)}.</p></details>`;
    }).join('')}</section>`).join('')}${field('proficiencies.languages','Языки')}${field('proficiencies.tools','Инструменты и другие владения','textarea')}`;
    if(tab==='combat') return `<div class="sheet-form-grid">${[['hp','Текущие HP'],['hpMax','Максимум HP'],['tempHp','Временные HP'],['ac','КД'],['speed','Ходьба, фт'],['darkvision','Тёмное зрение, фт']].map(([k,l])=>field(k,l,k==='speed'?'decimal':'number',{min:k==='initBonus'?-100:0})).join('')}${field('overrides.initiative.value','Инициатива вручную (пусто — DEX)','number',{min:-100,defaultValue:Object.hasOwn(draft.overrides||{},'initiative')?null:draft.initBonus})}${field('overrides.initiative.reason','Основание инициативы')}${['fly','swim','climb','burrow'].map((k,i)=>field(`movement.${k}`,['Полёт','Плавание','Лазание','Копание'][i]+', фт','decimal',{min:0})).join('')}</div>${field('movement.hover','Парение (не даёт скорость полёта)','boolean')}<p class="t-sm muted">Инициатива: ${display(sheetInitiative(draft))}. КД и скорость заданы вручную; доспехи и эффекты не меняют их автоматически.</p><div class="row wrap">${control()?'<button class="btn btn-secondary" data-hp="damage">Урон</button><button class="btn btn-secondary" data-hp="heal">Лечение</button>':''}<button class="btn btn-secondary" data-init>Инициатива</button></div><button class="btn btn-secondary" data-death>Спасбросок от смерти</button>${group('hitDicePools')}${field('hitDice','Прежняя запись костей (не заменяет пулы)')}<div class="row wrap">${control()?'<button class="btn btn-secondary" data-rest="short">Короткий отдых</button><button class="btn btn-secondary" data-rest="long">Продолжительный отдых</button>':''}</div><section class="sheet-sect"><h3>Состояния</h3><div class="cond-chips">${CONDITIONS.map(c=>`<button class="chip ${(draft.conditions||[]).some(x=>(x.id||x)===c.id)?'chip-accent':''}" data-condition="${c.id}" ${control()?'':'disabled'}>${esc(c.name)}</button>`).join('')}</div><div class="sheet-form-grid">${field('deathSaves.s','Успехи от смерти','number',{min:0,max:3})}${field('deathSaves.f','Провалы от смерти','number',{min:0,max:3})}</div></section>${group('attacks')}${group('actions')}${group('bonusActions')}${group('reactions')}`;
    if(tab==='spells') return `${group('spellSources')}${group('knownSpells')}${group('slotPools')}<section class="sheet-sect"><h3>Прежние ячейки</h3>${Object.keys(draft.slots||{}).map(l=>`<div class="sheet-form-grid">${field(`slots.${l}.max`,`${l} круг: всего`,'number',{min:0})}${field(`slots.${l}.used`,'Потрачено','number',{min:0})}</div>`).join('')||'<p class="muted">Не заданы</p>'}</section>${field('concentration.name','Концентрация (учёт вручную)')}${legacy('spells','Заклинания')}<p class="t-sm muted">Описание и ритуал не расходуют ячейки и не применяют эффект. Обычные ячейки и Магия договора — отдельные пулы.</p>`;
    if(tab==='gear') return `${group('inventoryItems')}<div class="sheet-form-grid">${['cp','sp','ep','gp','pp'].map((k,i)=>field(`coins.${k}`,['Медные','Серебряные','Электрумовые','Золотые','Платиновые'][i],'number',{min:0})).join('')}</div><p class="muted t-sm">Настроено предметов: ${(draft.inventoryItems||[]).filter(i=>i.attuned).length}. Лимит и исключения проверяются вручную.</p>${legacy('inventory','Снаряжение')}`;
    if(tab==='features') return `${group('featureEntries')}${group('resources')}${legacy('features','Особенности')}<p class="muted t-sm">Текст способности — описание. Приложение не исполняет его как правило.</p>`;
    if(tab==='creature')return creatureBody();
    return `${field('notes','Заметки (видны всем участникам)','textarea')}<section class="sheet-sect"><h3>Управление</h3><p class="t-sm muted">Полный лист видят все участники. Управляющий меняет текущие ресурсы; сборку — владелец и мастер.</p>${builder()&&!archived?ctx.c.members.filter(m=>m.status==='active'&&m.userId!==ch.ownerId).map(m=>`<label class="row"><input type="checkbox" data-controller="${esc(m.userId)}" ${controllers.includes(m.userId)?'checked':''} ${busy?'disabled':''}> ${esc(m.name||m.userId)}</label>`).join(''):''}${builder()?`<button class="btn btn-secondary" data-archive>${archived?'Восстановить лист':'Архивировать лист'}</button>`:''}</section>`;
  }
  function render() {
    if(dead)return;host.dataset.sheetVersion=version??'';
    const scroll=host.querySelector('.sheet-body')?.scrollTop||0;
    host.innerHTML=`<header class="sheet-head"><div class="titles grow"><b class="t-lg">${esc(draft.name||'Лист персонажа')}</b><div class="t-sm muted">${esc(status|| (dirty()?'Есть несохранённые изменения':'Изменений нет'))}${busy?' · сохраняем…':''}${!builder()?' · сборка только для просмотра':''}</div></div><button class="icon-btn" data-close-sheet aria-label="Закрыть">×</button></header><div class="row sheet-actor-tools">${active()?'<button class="btn btn-sm btn-secondary" data-new-sheet>Новый лист</button>':''}${builder()?'<button class="btn btn-sm btn-secondary" data-copy-sheet>Копировать</button>':''}</div><label class="sheet-actor-switch"><span class="sr-only">Листы кампании</span><select data-open-actor>${[...(ctx.c.characters||[]),...(ctx.c.archivedCharacters||[])].map(c=>`<option value="${esc(c.id)}" ${c.id===id?'selected':''}>${ctx.c.archivedCharacters?.some(a=>a.id===c.id)?'Архив · ':''}${esc(c.name)}</option>`).join('')}</select></label><nav class="sheet-tabs">${tabs.map(([t,n])=>`<button class="tab" data-tab="${t}" aria-selected="${t===tab}">${n}</button>`).join('')}</nav><div class="sheet-body scroll">${error?`<p role="alert" class="sheet-error">${esc(error.message||error)}${pending?'<button class="btn btn-sm" data-retry>Повторить тот же запрос</button>':''}<button class="btn btn-sm" data-reload-error>Сверить с сервером</button></p>`:''}${conflicts.length?`<section class="sheet-conflicts"><h3>Одновременные изменения</h3>${conflicts.map((c,i)=>`<div><b>${esc(c.path.join('.'))}</b><p>Ваше: ${esc(JSON.stringify(c.after))}</p><p>На сервере: ${esc(JSON.stringify(c.remote))}</p><button class="btn btn-sm" data-resolve="${i}" data-choice="local">Оставить своё</button><button class="btn btn-sm" data-resolve="${i}" data-choice="remote">Взять серверное</button></div>`).join('')}</section>`:''}${body()}</div><footer class="sheet-editor-footer"><button class="btn btn-primary" data-save ${busy||conflicts.length||!control()?'disabled':''}>Сохранить</button><button class="btn btn-ghost" data-reload ${busy||reading?'disabled':''}>Сверить</button><button class="btn btn-ghost" data-discard ${busy?'disabled':''}>Отменить ввод</button><span class="t-xs muted" data-dirty>${dirty()?'Черновик сохранён в этой вкладке':''}</span></footer>`;
    const area=host.querySelector('.sheet-body'); if(area)area.scrollTop=scroll;
  }
  function change() { error=null;status='Есть несохранённые изменения';persist(); const label=host.querySelector('[data-dirty]');if(label)label.textContent='Есть несохранённые изменения'; }
  async function load() {
    if(busy||reading)return;reading=true;
    try {
      let remote;
      if(isServerMode()) { status='Загружаем лист…'; render(); const snapshot=await readCharacterSheet(ctx.cid,id); if(dead)return; version=snapshot.version;controllers=snapshot.controllers||[];archived=!!snapshot.archivedAt; remote=snapshot.data;if(remote.statblock?.statblockImage)await resolveSrc(remote.statblock.statblockImage).catch(()=>{}); }
      else { ch=source(ctx,id);if(!ch)return;archived=!!ctx.c.archivedCharacters?.some(x=>x.id===id);controllers=ch.controllerIds||[];remote=plain(ch); }
      const result=rebaseCharacterDraft(base,draft,remote); base=copy(remote);draft=result.data;conflicts=result.conflicts;status=dirty()?'Черновик сверён с актуальным листом':'Лист загружен';error=pending?new Error('Результат предыдущего запроса не подтверждён. Повторите тот же запрос.'):null;persist();render();
    } catch(e) { if(dead)return;error=e;status='Не удалось загрузить лист'; } finally {reading=false;if(!dead)render();}
  }
  async function save(retry=false) {
    if(busy||conflicts.length||(!control()&&!(retry&&pending&&(builder()||(active()&&controllers.includes(ctx.userId))))))return false;
    const errors=[...invalid.values()].map(v=>v.error).concat(validateDraft(draft),validateSheetStatblock({...draft,id,ownerId:ch.ownerId}));
    if(errors.length){error=new Error(errors.join('; '));render();return false;}
    if(pending&&!retry){error=new Error('Сначала повторите незавершённый запрос с тем же ID');render();return false;}
    if(!dirty()&&!retry){status='Изменений нет';render();return true;}
    if(!retry&&builder())draft=prepareSheetDerived(draft);
    const sent=retry&&pending?copy(pending.sent):copy(draft); busy=true;error=null;render();
    try {
      let remote;
      if(isServerMode()) {
        if(!retry||!pending){ if(version===null)throw new Error('Сначала загрузите подтверждённую версию листа'); pending={request:makeSheetCommand({campaignId:ctx.cid,characterId:id,version,kind:'edit',payload:characterEditPayload(base,sent)}),sent:copy(sent)};persist(); }
        const result=await submitCharacterCommand(pending.request);remote=result.sheet.data;version=result.sheet.version;controllers=result.sheet.controllers||[];archived=!!result.sheet.archivedAt;
      } else {
        const current=plain(source(ctx,id));const rebased=rebaseCharacterDraft(base,sent,current);
        if(rebased.conflicts.length){conflicts=rebased.conflicts;base=current;draft=rebased.data;throw new Error('Лист изменился в другой вкладке. Выберите значения.');}
        remote=rebased.data;applyZeroHp(remote,current.hp);
        updateCampaign(ctx.cid,c=>{const current=c.characters.find(x=>x.id===id);if(!current)throw new Error('Лист больше не активен');Object.assign(current,copy(remote));});
      }
      const result=rebaseCharacterDraft(sent,draft,remote);base=copy(remote);draft=result.data;conflicts=result.conflicts;pending=null;status='Сохранено';persist();return true;
    } catch(e) {
      error=e;
      if(e.acknowledged){version=e.acknowledged.sheet.version;const result=rebaseCharacterDraft(sent,draft,e.acknowledged.sheet.data);base=copy(e.acknowledged.sheet.data);draft=result.data;conflicts=result.conflicts;pending=null;status='Запись подтверждена; обновите кампанию';}
      else if(!e.retryable)pending=null;
      persist();return false;
    } finally {busy=false;if(!dead)render();}
  }
  function roll(value,label,kind) { if(value==null)return ctx.toast('Бонус неизвестен: уточните поле'); if(archived||!active()||((draft.profile||'pc')!=='pc'&&!control()))return;doRoll(ctx,{label:`${draft.name}: ${label}`,dice:{20:1},mod:value,...(kind?{kind}:{})}); }
  function hpDialog(kind) {
    if(!control()||busy||pending)return;
    const m=modal(`<div class="panel-section"><h3>${kind==='damage'?'Урон':'Лечение'}</h3><label>Количество <input data-amount inputmode="numeric" autofocus></label><p data-error role="alert"></p><button class="btn btn-primary" data-ok>Применить к черновику</button><button class="btn" data-close>Отмена</button></div>`);
    m.box.querySelector('[data-ok]').onclick=()=>{
      const parsed=parseField(m.box.querySelector('[data-amount]').value,'number',{nullable:false,min:0});
      if(!parsed.valid||!Number.isSafeInteger(draft.hp)||!Number.isSafeInteger(draft.hpMax)||!Number.isSafeInteger(draft.tempHp)){m.box.querySelector('[data-error]').textContent='Уточните HP, максимум и временные HP; количество — целое неотрицательное';return;}
      let n=parsed.value;
      if(kind==='damage'){const absorbed=Math.min(draft.tempHp,n);draft.tempHp-=absorbed;n-=absorbed;draft.hp=Math.max(0,draft.hp-n);}else draft.hp=Math.min(draft.hpMax,draft.hp+n);
      change();m.close();render();
    };
  }
  async function special(kind,payload,after,operationId) {
    if(dirty()||pending){ctx.toast('Сначала сохраните или отмените черновик');return false;}
    const old=copy(draft);draft=copy(after);
    if(isServerMode()){pending={request:makeSheetCommand({campaignId:ctx.cid,characterId:id,version,kind,payload,...(operationId?{operationId}:{})}),sent:copy(after)};persist();return save(true);}
    // Песочница использует ту же явную операцию, без обещания серверных прав.
    if(sameSheetValue(old,after)){status='Изменений нет';render();return true;}
    return save();
  }
  function restDialog(kind) {
    if(!control()||busy||pending)return;
    if(dirty()||pending){ctx.toast('Сначала сохраните или отмените черновик');return;}
    const source=readCharacter(draft), rolls=[], recover={}; let eligible=false, result=null;
    const revision=copy(base);
    const m=modal('<div class="panel-section" data-rest-body></div>');
    function draw(){
      result=previewRest(source,{kind,eligible,hitDieRolls:rolls,recoverDice:kind==='long'&&Object.keys(recover).length?recover:null});
      m.box.querySelector('[data-rest-body]').innerHTML=`<h3>${kind==='short'?'Короткий':'Продолжительный'} отдых</h3><p class="muted t-sm">Вручную: закройте окно и измените HP и ресурсы в листе. Расчёт ниже меняет только поддерживаемые значения.</p><label class="row"><input type="checkbox" data-eligible ${eligible?'checked':''}> Условия отдыха соблюдены</label>${kind==='short'?`<div class="sheet-form-grid"><label class="sheet-field">Пул костей<select data-pool>${source.hitDice.map(p=>`<option value="${esc(p.id)}">${esc(p.name||p.id)} d${p.die}: ${p.spent??'?'} / ${p.total??'?'}</option>`).join('')}</select></label><label class="sheet-field">Результат одной кости<input data-roll-value inputmode="numeric"></label></div><button class="btn btn-secondary" data-add-die>Добавить результат к расчёту</button><p class="t-sm">Выбрано костей: ${rolls.length}</p>`:source.hitDice.map(p=>`<label class="sheet-field">Вернуть ${esc(p.name||p.id)} d${p.die}<input data-recover="${esc(p.id)}" value="${recover[p.id]??''}" inputmode="numeric"></label>`).join('')}<ul>${result.changes.map(c=>`<li>${esc(c.target.section)} ${esc(c.target.id||c.target.field)}: ${esc(c.from)} → ${esc(c.to)} (${esc(c.rule)})</li>`).join('')}</ul>${result.manual.map(c=>`<p class="t-sm muted">${esc(c.reason)}</p>`).join('')}${result.errors.map(e=>`<p class="sheet-error">${esc(e)}</p>`).join('')}<div class="row"><button class="btn btn-primary" data-apply-rest ${result.errors.length?'disabled':''}>Подтвердить восстановление</button><button class="btn" data-close>Вручную / отмена</button></div>`;
    }
    m.box.addEventListener('change',e=>{if(e.target.hasAttribute('data-eligible')){eligible=e.target.checked;draw();}if(e.target.dataset.recover){const p=parseField(e.target.value,'number',{min:0});if(p.valid){if(p.value===null)delete recover[e.target.dataset.recover];else recover[e.target.dataset.recover]=p.value;draw();}}});
    m.box.addEventListener('click',async e=>{
      if(e.target.closest('[data-add-die]')){const poolId=m.box.querySelector('[data-pool]').value,p=parseField(m.box.querySelector('[data-roll-value]').value,'number',{nullable:false,min:1});if(p.valid){rolls.push({poolId,roll:p.value});draw();}return;}
      if(!e.target.closest('[data-apply-rest]')||result.errors.length)return;
      if(!sameSheetValue(revision,base)||dirty()){m.close();ctx.toast('Лист изменился. Рассчитайте отдых заново');return;}
      const after=copy(draft);
      for(const c of result.changes){const t=c.target;if(t.section==='hp')after[{current:'hp',temp:'tempHp'}[t.field]]=c.to;
        else if(t.section==='hitDice'){if(!Array.isArray(after.hitDicePools))continue;const p=after.hitDicePools.find(p=>p.id===t.id);if(p)p.spent=c.to;}
        else{const p=after[t.section]?.find(p=>p.id===t.id);if(p)p[t.field]=c.to;}}
      const payload=characterEditPayload(base,after);m.close();await special('rest',{kind,conditionsConfirmed:true,adjust:payload.adjust||{}},after);
    });draw();
  }
  async function archive(){
    if(!builder()||busy||pending)return;
    if(dirty()){ctx.toast('Сначала сохраните или отмените черновик');return;}
    if(!await confirmDialog({title:archived?'Восстановить лист?':'Архивировать лист?',body:archived?'Лист вернётся в кампанию. Токены и прежний ход не восстанавливаются.':'Лист и история сохранятся. Все его токены и участие в бою будут сняты.',ok:archived?'Восстановить':'Архивировать',danger:!archived}))return;
    if(isServerMode())await special(archived?'restore':'archive',{},draft);
    else{updateCampaign(ctx.cid,c=>(archived?restoreLocalCharacter:archiveLocalCharacter)(c,id));archived=!archived;status=archived?'Лист в архиве':'Лист восстановлен';render();}
  }
  function creatureBody(){
    return `<p class="t-sm muted">Общий лист ${draft.profile==='sidekick'?'Sidekick':draft.profile==='creature'?'NPC':'героя'}. Полные сведения видят все участники кампании. Библиотека мастера и вражеские статблоки остаются отдельными.</p>${field('statblock.type','Вид существа')}${field('statblock.size','Размер','select',{options:[['','Неизвестен'],['tiny','Крошечный'],['small','Маленький'],['medium','Средний'],['large','Большой'],['huge','Огромный'],['gargantuan','Громадный']]})}${field('statblock.senses','Чувства')}${field('statblock.languages','Языки')}${field('defenses.resistances','Сопротивления','textarea')}${field('defenses.immunities','Иммунитеты','textarea')}${field('defenses.vulnerabilities','Уязвимости','textarea')}${field('defenses.conditionImmunities','Иммунитеты к состояниям','textarea')}${field('statblock.hpFormula','Формула HP (описание, не бросок)')}${field('statblock.cr','Опасность (описание)')}${group('statblock.traits')}${group('statblock.actions')}${group('statblock.bonusActions')}${group('statblock.reactions')}${field('statblock.legendary.count','Легендарных действий за раунд (учёт вручную)','number',{min:0})}${group('statblock.legendary.actions')}${group('statblock.lairActions')}<p class="t-sm muted">Текст и формулы не применяют эффект. Перезарядку и бюджет легендарных действий отмечайте вручную в ресурсах.</p>${builder()&&!archived&&(isMasterOf(ctx.c,ctx.userId)||!isServerMode())?'<label class="sheet-field">Изображение статблока<input type="file" accept="image/png,image/jpeg,image/webp" data-statblock-image></label>':''}${draft.statblock?.statblockImage?`<img class="sheet-source-image" src="${esc(srcOf(draft.statblock.statblockImage))}" alt="Изображение-источник статблока"><p class="t-sm muted">Числа с изображения вводятся вручную, OCR не выполняется.</p>`:''}${draft.profile==='sidekick'?`${field('sidekick.class','Класс Sidekick','select',{options:[['warrior','Воитель'],['expert','Эксперт'],['spellcaster','Заклинатель']]})}${field('sidekick.hitDie','Кость базового существа','select',{options:[['','Неизвестна'],...[4,6,8,10,12,20].map(n=>[String(n),`d${n}`])]})}<p class="t-sm muted">Уровень подтверждает мастер. Пригодность базы, классовые способности и исключения проверяет мастер. Базовые кости и их расход уточняются отдельно.</p><section class="sheet-sect"><h3>Группа для подсказки</h3>${ctx.c.characters.filter(c=>(c.profile||'pc')==='pc').map(c=>`<label class="row"><input type="checkbox" data-party="${esc(c.id)}" ${draft.sidekick?.partyIds?.includes(c.id)?'checked':''} ${builder()&&!archived?'':'disabled'}>${esc(c.name)}</label>`).join('')}<p class="t-sm muted" data-party-hint>Средний уровень: ${partyLevelHint(ctx.c.characters,draft.sidekick?.partyIds||[]).average??'не определён'}. Подсказка не меняет уровень.</p></section>${isMasterOf(ctx.c,ctx.userId)&&!archived?'<button class="btn btn-secondary" data-growth>Рассчитать развитие</button><button class="btn btn-ghost" data-manual-level>Уточнить уровень вручную</button>':''}<p class="t-sm muted">Базовый уровень: ${draft.sidekick?.baseLevel??'требует подтверждения'}. Подтверждённых записей развития: ${draft.sidekick?.growthHistory?.length||0}.</p>`:''}`;
  }
  async function creation(copyCurrent=false){
    if(!active()||busy||pending)return;
    if(dirty()){ctx.toast('Сначала сохраните или отмените черновик');return;}
    try{await loadSrdBestiary();}catch{/* ручное создание остаётся доступно */}
    const master=isMasterOf(ctx.c,ctx.userId),newActorId=uid('ch-');let created=null;
    const m=modal(`<div class="panel-section"><h3>${copyCurrent?'Копия листа':'Новый общий лист'}</h3><label class="sheet-field">Имя<input data-create-name value="${esc(copyCurrent?draft.name+' — копия':'')}"></label><label class="sheet-field">Профиль<select data-create-profile ${master&&!copyCurrent?'':'disabled'}>${[['pc','Полноценный герой'],['creature','NPC со статблоком'],['sidekick','Sidekick']].map(([k,n])=>`<option value="${k}" ${k===(copyCurrent?draft.profile||'pc':master?'creature':'pc')?'selected':''}>${n}</option>`).join('')}</select></label><label class="sheet-field">Владелец<select data-create-owner><option value="${ctx.userId}">Я</option>${master?`<option value="">Без владельца</option>${ctx.c.members.filter(m=>m.status==='active'&&m.userId!==ctx.userId).map(m=>`<option value="${esc(m.userId)}">${esc(m.name||m.userId)}</option>`).join('')}`:''}</select></label>${!copyCurrent?`<label class="sheet-field">Основа<select data-create-source><option value="">Ручной лист — неизвестные числа не заполняются</option>${BESTIARY.filter(m=>m.srd===true).map(m=>`<option value="${esc(m.id)}">SRD · ${esc(m.name)}</option>`).join('')}</select></label>`:''}<p class="t-sm muted">Токены, управление, связи и ход не создаются автоматически. Числа экземпляра независимы от каталога.</p><p class="sheet-error" data-create-error role="alert"></p><button class="btn btn-primary" data-create-ok>Создать лист</button><button class="btn" data-close>Отмена</button></div>`);
    m.box.querySelector('[data-create-ok]').onclick=async()=>{
      const button=m.box.querySelector('[data-create-ok]');button.disabled=true;
      try{
        if(!created){const name=m.box.querySelector('[data-create-name]').value.trim(),profile=m.box.querySelector('[data-create-profile]').value,ownerId=m.box.querySelector('[data-create-owner]').value||null;
          const identity={id:newActorId,ownerId,name,profile},catalogueId=m.box.querySelector('[data-create-source]')?.value;
          created=copyCurrent?copySheet({...draft,id,ownerId:ch.ownerId},identity,()=>uid('entry-')):catalogueId?sheetFromSrd(BESTIARY.find(m=>m.id===catalogueId),identity):emptySheet(identity);
          created.profile=profile;
          if(created.statblock?.baseSnapshot&&!copyCurrent){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(created.statblock.baseSnapshot)));created.statblock.templateVersion='sha256:'+Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');}
          if(profile==='sidekick'&&!created.sidekick)created.sidekick={class:'warrior',baseLevel:created.level,baseSnapshot:copy(created.statblock?.baseSnapshot||{stats:created.stats,hpMax:created.hpMax}),hitDie:null,growthHistory:[]};
          if(profile==='sidekick'&&!created.hitDicePools?.length)created.hitDicePools=[{id:uid('hd-'),name:'Базовые кости — уточните',source:'base-statblock',die:null,total:null,spent:null}];
          created=prepareSheetDerived(created);const issues=validateDraft(created);if(issues.length){created=null;throw new Error(issues.join('; '));}
        }
        if(isServerMode())await createCharacterSheet(ctx.cid,created);else updateCampaign(ctx.cid,c=>c.characters.push(copy(created)));
        m.close();onOpen?.(created.id);
      }catch(e){m.box.querySelector('[data-create-error]').textContent=e.message||'Не удалось создать лист';if(created){for(const input of m.box.querySelectorAll('input,select'))input.disabled=true;button.textContent='Повторить создание с тем же ID';}}
      finally{button.disabled=false;}
    };
  }
  function growthDialog(manual=false){
    if(!isMasterOf(ctx.c,ctx.userId)||draft.profile!=='sidekick'||archived||busy||pending)return;
    if(dirty()){ctx.toast('Сначала сохраните или отмените черновик');return;}
    let revision=copy(base),result=null,previewInput=null;
    const m=modal(`<div class="panel-section"><h3>${manual?'Уточнение уровня без перерасчёта':'Развитие Sidekick'}</h3><label class="sheet-field">Новый уровень<input data-target-level inputmode="numeric" value="${draft.level??1}"></label>${manual?'<p class="muted t-sm">Это ручная корректировка: HP, кости и бонусы не пересчитываются. Подтверждает мастер.</p><label class="sheet-field">Причина<input data-level-reason></label>':`<p class="muted t-sm">Текущие HP сохраняются. Кость d${draft.sidekick?.hitDie??'?'}, CON ${display(abilityModifier(draft.stats?.con))}. Выбор классовых способностей остаётся ручным.</p><label class="sheet-field">Результат кости каждого нового уровня через пробел<input data-growth-rolls></label><button class="btn btn-secondary" data-preview-growth>Рассчитать</button>`}<div data-growth-preview></div><button class="btn btn-primary" data-apply-growth ${manual?'':'disabled'}>Подтвердить мастером</button><button class="btn" data-close>Отмена</button></div>`);
    m.box.querySelector('[data-preview-growth]')?.addEventListener('click',()=>{
      const target=parseField(m.box.querySelector('[data-target-level]').value,'number',{nullable:false,min:1,max:20});
      const raw=m.box.querySelector('[data-growth-rolls]').value.trim(),rolls=raw?raw.split(/[\s,;]+/).map(v=>parseField(v,'number',{nullable:false,min:1}).value):[];
      revision=copy(base);previewInput=JSON.stringify([m.box.querySelector('[data-target-level]').value,m.box.querySelector('[data-growth-rolls]').value]);
      result=previewSidekickGrowth({level:draft.level,targetLevel:target.valid?target.value:null,hpMax:draft.hpMax,constitution:draft.stats?.con,hitDie:draft.sidekick?.hitDie,rolls});
      m.box.querySelector('[data-growth-preview]').innerHTML=`${result.errors.map(e=>`<p class="sheet-error">${esc(e)}</p>`).join('')}<ul>${result.changes.map(c=>`<li>${esc(c.field)}: ${c.from??'добавить'} → ${c.to??c.added}</li>`).join('')}</ul>${result.manual.map(v=>`<p class="muted t-sm">${esc(v.reason)}</p>`).join('')}<p class="muted t-sm">Итоги базового статблока не получают PB повторно. Неизвестные зависимости корректируются вручную.</p>`;
      m.box.querySelector('[data-apply-growth]').disabled=!!result.errors.length;
    });
    m.box.querySelector('[data-apply-growth]').onclick=async()=>{
      if(!sameSheetValue(base,revision)||dirty()){result=null;revision=copy(base);m.box.querySelector('[data-growth-preview]').textContent='Лист изменился. Проверьте новые исходные значения и рассчитайте развитие заново. Введённые результаты сохранены.';m.box.querySelector('[data-apply-growth]').disabled=!manual;return;}
      const target=parseField(m.box.querySelector('[data-target-level]').value,'number',{nullable:false,min:1,max:20});if(!target.valid)return;
      const operationId=crypto.randomUUID();let after;
      if(manual){
        after=copy(draft);after.level=target.value;after.sidekick??={};after.sidekick.baseLevel??=draft.level;
        after.sidekick.baseSnapshot??=copy(draft.statblock?.baseSnapshot||{stats:draft.stats,hpMax:draft.hpMax});
        after.sidekick.growthHistory??=[];after.sidekick.growthHistory.push({id:operationId,operationId,kind:'manual-level',from:draft.level,to:after.level,hpFrom:draft.hpMax,hpTo:after.hpMax,note:m.box.querySelector('[data-level-reason]').value});
      }else{
        if(previewInput!==JSON.stringify([m.box.querySelector('[data-target-level]').value,m.box.querySelector('[data-growth-rolls]').value])){m.box.querySelector('[data-growth-preview]').textContent='Ввод изменился. Рассчитайте развитие заново.';return;}
        if(!result||result.errors.length||result.changes.find(c=>c.field==='level')?.to!==target.value)return;
        try{after=applySidekickGrowthPreview({...draft,profile:'sidekick'},result,{operationId,poolId:uid('hd-')});}
        catch(e){m.box.querySelector('[data-growth-preview]').textContent=e.message;return;}
      }
      const normalized=prepareSheetDerived(after);const patch=characterEditPayload(base,normalized).patch||{};m.close();await special('growth',{patch},normalized,operationId);
    };
  }
  function requestClose(){
    if(!dirty()&&!pending){onClose();return;}
    const m=modal('<div class="panel-section"><h3>Несохранённый лист</h3><p>Черновик можно сохранить в этой вкладке и продолжить позже.</p><div class="row wrap"><button class="btn btn-primary" data-save-close>Сохранить и закрыть</button><button class="btn btn-secondary" data-keep-close>Оставить черновик</button><button class="btn" data-close>Продолжить ввод</button></div></div>');
    m.box.querySelector('[data-keep-close]').onclick=()=>{persist();m.close();onClose();};
    m.box.querySelector('[data-save-close]').onclick=async()=>{m.close();if(await save(!!pending))onClose();};
  }
  async function click(e) {
    const b=e.target.closest('button'); if(!b)return;
    if(b.hasAttribute('data-close-sheet')){requestClose();return;}
    if(b.hasAttribute('data-growth')){growthDialog();return;}
    if(b.hasAttribute('data-manual-level')){growthDialog(true);return;}
    if(b.hasAttribute('data-new-sheet')){await creation();return;}
    if(b.hasAttribute('data-copy-sheet')){await creation(true);return;}
    if(b.dataset.tab){tab=b.dataset.tab;render();return;}
    if(b.hasAttribute('data-save')){await save();return;}
    if(b.hasAttribute('data-retry')){await save(true);return;}
    if(b.hasAttribute('data-reload')||b.hasAttribute('data-reload-error')){await load();return;}
    if(b.hasAttribute('data-discard')){if(pending){error=new Error('Результат запроса неизвестен. Сначала повторите его или сверьте лист.');render();return;}if(await confirmDialog({title:'Отменить несохранённый ввод?',body:'Сохранённый лист останется без изменений.',ok:'Отменить ввод'})){draft=copy(base);invalid.clear();conflicts=[];pending=null;error=null;status='Ввод отменён';persist();render();}return;}
    if(b.dataset.resolve!==undefined){const i=Number(b.dataset.resolve),c=conflicts[i];if(b.dataset.choice==='remote')putSheetPath(draft,c.path,c.remote);conflicts.splice(i,1);change();render();return;}
    if(b.dataset.staticAttack){const a=fieldValue(draft,b.dataset.staticAttack);roll(a.attack?.bonus??null,a.name,'attack');return;}
    if(b.dataset.staticDamage){const p=fieldValue(draft,b.dataset.staticDamage),f=parseFormula(p?.dice);if(f&&!archived&&control())doRoll(ctx,{label:`${draft.name}: компонент урона ${p.type||''}`,...f});else ctx.toast('Формула неизвестна или нужна отметка управляющего');return;}
    if(b.dataset.addComponent&&builder()&&!archived&&!busy&&!pending){const path=b.dataset.addComponent+'.damage';setField(draft,path,[...(fieldValue(draft,path)||[]),{dice:null,type:null}]);change();render();return;}
    if(b.dataset.add&&builder()&&!archived&&!busy&&!pending){const name=b.dataset.add;const items=fieldValue(draft,name)||[];setField(draft,name,[...items,blank(name)]);change();render();return;}
    if(b.dataset.remove&&builder()&&!archived&&!busy&&!pending){if(b.dataset.remove==='inventoryItems'&&draft.inventoryItems[Number(b.dataset.i)]?.attuned&&!await confirmDialog({title:'Убрать настроенный предмет?',body:'Отметка настройки будет удалена вместе с записью предмета.',ok:'Убрать'}))return;fieldValue(draft,b.dataset.remove).splice(Number(b.dataset.i),1);if(b.dataset.remove==='classes'&&draft.classes.length)draft.level=sheetLevel(draft);change();render();return;}
    if(b.dataset.condition&&control()&&!busy&&!pending){const key=b.dataset.condition;draft.conditions??=[];draft.conditions=draft.conditions.some(x=>(x.id||x)===key)?draft.conditions.filter(x=>(x.id||x)!==key):[...draft.conditions,key];change();render();return;}
    if(b.hasAttribute('data-archive')){await archive();return;}
    if(b.dataset.rest){restDialog(b.dataset.rest);return;}
    if(b.dataset.hp){hpDialog(b.dataset.hp);return;}
    if(b.dataset.ability){const a=ABILITIES.find(a=>a.id===b.dataset.ability);roll(abilityModifier(draft.stats?.[a.id]),a.name);return;}
    if(b.dataset.check){const kind=b.dataset.check,def=(kind==='saves'?ABILITIES:SKILLS).find(a=>a.id===b.dataset.id);roll(sheetBonus(draft,kind,def.id,def.ab||def.id).value,def.name,kind==='saves'?'save':undefined);return;}
    if(b.hasAttribute('data-death')){if(dirty()){ctx.toast('Сначала сохраните или отмените черновик');return;}if(control()&&ctx.panels?.deathSave)ctx.panels.deathSave(id);else roll(0,'спасбросок от смерти','save');return;}
    if(b.hasAttribute('data-init')){roll(sheetInitiative(draft),'инициатива');return;}
    if(b.dataset.attack!==undefined){const a=draft.attacks[Number(b.dataset.attack)];roll(attackBonus(draft,a),a.name,'attack');return;}
    if(b.dataset.damage!==undefined){const a=draft.attacks[Number(b.dataset.damage)],f=parseFormula(a.damage);if(f&&!archived&&active()&&((draft.profile||'pc')==='pc'||control()))doRoll(ctx,{label:`${draft.name}: ${a.name} — урон`,...f});else ctx.toast('Уточните формулу урона или права управления');}
  }
  function input(e) {
    const t=e.target;if(t.dataset.party){if(builder()&&!archived&&!busy&&!pending){const chosen=draft.sidekick?.partyIds||[];setField(draft,'sidekick.partyIds',t.checked?[...new Set([...chosen,t.dataset.party])]:chosen.filter(id=>id!==t.dataset.party));change();const hint=host.querySelector('[data-party-hint]');if(hint)hint.textContent=`Средний уровень: ${partyLevelHint(ctx.c.characters,draft.sidekick?.partyIds||[]).average??'не определён'}. Подсказка не меняет уровень.`;}return;}if(t.hasAttribute('data-statblock-image'))return;if(t.dataset.openActor){persist();onOpen?.(t.value);return;}const path=t.dataset.field;if(!path||!permitted(path)||busy||pending)return;
    const type=t.dataset.type, raw=type==='boolean'?t.checked:t.value;
    const p=parseField(raw,type,{...(t.dataset.min!==undefined?{min:Number(t.dataset.min)}:{}),...(t.dataset.max!==undefined?{max:Number(t.dataset.max)}:{})});
    if(!p.valid){invalid.set(path,{raw,error:p.error});t.setAttribute('aria-invalid','true');}
    else {invalid.delete(path);t.removeAttribute('aria-invalid');let value=p.value;if(path.startsWith('proficiencies.skills.')||path.startsWith('proficiencies.saves.'))value=Number(value);if(/hitDicePools\.\d+\.die$/.test(path)||path==='sidekick.hitDie')value=value===''?null:Number(value);setField(draft,path,value);if(path.startsWith('classes.')&&path.endsWith('.levels'))draft.level=sheetLevel(draft);
      // Пустой override действительно отключён, причина остаётся доступна.
      if(['statblock.cr','statblock.size'].includes(path)&&value==='')setField(draft,path,null);
      if(path.startsWith('overrides.')&&path.endsWith('.value')&&value===null)setField(draft,path.split('.').slice(0,-1).join('.'),null);
    }
    change();
    // Не заменяем DOM при blur: иначе исчезнет кнопка, на которую нажал пользователь.
  }
  async function controllerChange(e) {
    const target=e.target.dataset.controller;if(!target||!builder())return;
    if(dirty()){e.target.checked=!e.target.checked;ctx.toast('Сначала сохраните или отмените черновик');return;}
    if(isServerMode()){await special('controller',{userId:target,enabled:e.target.checked},draft);return;}
    controllers=e.target.checked?[...controllers,target]:controllers.filter(x=>x!==target);
    updateCampaign(ctx.cid,c=>{c.characters.find(x=>x.id===id).controllerIds=controllers;});base=plain(source(ctx,id));draft=copy(base);render();
  }
  async function imageChange(e){
    const file=e.target.hasAttribute('data-statblock-image')&&e.target.files?.[0];if(!file||!builder()||busy||pending)return;
    try{const image=await storeImage(file,{campaignId:isServerMode()?ctx.cid:null});if(dead)return;setField(draft,'statblock.statblockImage',image.ref);setField(draft,'statblock.source','image');await resolveSrc(image.ref);change();render();}catch(e){error=e;render();}
  }
  host.addEventListener('click',click);host.addEventListener('input',input);host.addEventListener('change',input);host.addEventListener('change',controllerChange);host.addEventListener('change',imageChange);
  const off=bus.on('sheet-write-error',(event)=>{if(event.cid!==ctx.cid||event.characterId!==id)return;const result=rebaseCharacterDraft(event.before,event.after,base);draft=result.data;conflicts=result.conflicts;error=new Error('Изменение стола отклонено; ввод сохранён в черновике');persist();render();});
  render();load();
  return { refresh(){if(dead||busy)return;const remote=source(ctx,id);if(!remote)return;const meta=isServerMode()?characterSheetMeta(ctx.cid,id):null;if(isServerMode()){if(meta&&version!==null&&BigInt(meta.version)>BigInt(version)&&!host.contains(document.activeElement))load();}else{const data=plain(remote);if(!sameSheetValue(base,data)){const result=rebaseCharacterDraft(base,draft,data);base=data;draft=result.data;conflicts=result.conflicts;persist();if(!host.contains(document.activeElement))render();}}}, close(){persist();dead=true;off();host.removeEventListener('click',click);host.removeEventListener('input',input);host.removeEventListener('change',input);host.removeEventListener('change',controllerChange);host.removeEventListener('change',imageChange);}, get tab(){return tab;} };
}
