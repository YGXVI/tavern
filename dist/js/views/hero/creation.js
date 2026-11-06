// Мастер создания героя на настоящем конструкторе (#200/#202, P3): шаги окна sol0139 (views/hero/steps.js) получают
// данные из движка rules/character-builder.js, а выборы игрока превращаются в изменения черновика конструктора.
// Чистые функции: состояние (черновик конструктора и выборы окна) хранит вызывающий; справочники передаются явно.
import { createDraft, evaluateBuild, proposeBuildChange, confirmBuildChange, toCharacterData, creationContextFromCampaign } from '../../rules/character-builder.js';
import { creationHitPoints } from '../table/sheet-rules.js';
import { ABILITIES, SKILLS, mod } from '../../data/rules.js';
import { CREATION } from './fixture.js';
import { EQ_RU, GEAR_RU } from '../ref/world-text.js';
import { gearIndex, wornItems, armorClass } from './gear.js';

const MINUS = '−';
const signed = (n) => (Number.isFinite(n) ? (n < 0 ? `${MINUS}${Math.abs(n)}` : `+${n}`) : '—');
const tail = (id) => String(id || '').split(':').pop();
export const PORTS = Object.freeze({ abilityModifier: (s) => (Number.isInteger(s) ? mod(s) : null), creationHitPoints });
const LANG_RU = {
  common: 'Общий', dwarvish: 'Дварфийский', elvish: 'Эльфийский', giant: 'Великаний', gnomish: 'Гномий', goblin: 'Гоблинский', halfling: 'Полуросликов', orc: 'Орочий',
  abyssal: 'Бездны', celestial: 'Небесный', draconic: 'Драконий', 'deep-speech': 'Глубинная речь', infernal: 'Инфернальный', primordial: 'Первичный', sylvan: 'Сильван', undercommon: 'Подземный',
};
// Главные характеристики класса — для «Расставить как обычно» (стандартный набор по убыванию).
const PRIORITY = {
  barbarian: ['str', 'con', 'dex'], bard: ['cha', 'dex', 'con'], cleric: ['wis', 'con', 'str'], druid: ['wis', 'con', 'dex'],
  fighter: ['str', 'con', 'dex'], monk: ['dex', 'wis', 'con'], paladin: ['str', 'cha', 'con'], ranger: ['dex', 'wis', 'con'],
  rogue: ['dex', 'int', 'con'], sorcerer: ['cha', 'con', 'dex'], warlock: ['cha', 'con', 'dex'], wizard: ['int', 'con', 'dex'],
};
const METHOD_UI = { point_buy: 'buy', standard_array: 'array', rolled: 'roll' };
const UI_METHOD = { buy: 'point_buy', array: 'standard_array', roll: 'rolled' };

/** Справочники конструктора: { options, spells, equipment, features } (dist/js/data/*-2014.json) + справка заклинаний. */
export function indexCreation(cats, spellRef = {}) {
  const defs = new Map(cats.options.entries.map((e) => [e.id, e]));
  const spells = new Map(cats.spells.entries.map((e) => [e.id, e]));
  const equipment = new Map(cats.equipment.entries.map((e) => [e.id, e]));
  const features = new Map((cats.features?.entries || []).map((e) => [e.id, e]));
  return { cats, defs, spells, equipment, features, ref: spellRef.spells || {}, schools: spellRef.schools || {} };
}
// Снаряжение — русскими названиями справочника (как в сумке листа, gear.js): в каталоге SRD их часто нет.
const eqName = (e) => (e ? EQ_RU[e.name.en] || GEAR_RU[e.name.en] || EQ_RU[String(e.name.en).replace(/’/g, "'")] || GEAR_RU[String(e.name.en).replace(/’/g, "'")] || e.name.ru || e.name.en : '');
const nameOf = (ix, id) => ix.defs.get(id)?.name?.ru || ix.features.get(id)?.name?.ru || ix.features.get(id)?.name?.en || ix.spells.get(id)?.name?.ru || eqName(ix.equipment.get(id)) || tail(id);
const skillName = (id) => SKILLS.find((s) => s.id === id)?.name || id;
// Прочие выборы расы и класса (подкласс, боевой стиль, инструменты, излюбленные враг и местность, экспертиза,
// наследие драконорождённого, прибавки полуэльфа) — блоком «Ещё выбор» на шаге, откуда выбор пришёл.
const EXTRA_KINDS = { tool: 'Инструменты', subclass: 'Подкласс', feature_option: 'Особенность', favored_enemy: 'Излюбленный враг', terrain: 'Излюбленная местность', expertise: 'Экспертиза', ability_increase: 'Прибавка к характеристикам' };
const ENEMY_RU = { aberration: 'Аберрации', beast: 'Звери', celestial: 'Небожители', construct: 'Конструкты', dragon: 'Драконы', elemental: 'Элементали', fey: 'Феи', fiend: 'Исчадия', giant: 'Великаны', monstrosity: 'Чудовища', ooze: 'Слизи', plant: 'Растения', undead: 'Нежить', humanoid: 'Гуманоиды' };
const TERRAIN_RU = { arctic: 'Арктика', coast: 'Побережье', desert: 'Пустыня', forest: 'Лес', grassland: 'Равнины', mountain: 'Горы', swamp: 'Болота', underdark: 'Подземье' };
function extraOptionName(ix, kind, o) {
  if (kind === 'tool' || (kind === 'expertise' && !SKILLS.some((k) => k.id === o))) return nameOf(ix, `srd51:equipment:${o}`);
  if (kind === 'expertise' || kind === 'skill') return skillName(o);
  if (kind === 'favored_enemy') return ENEMY_RU[o] || o;
  if (kind === 'terrain') return TERRAIN_RU[o] || o;
  if (kind === 'ability_increase') return ABILITIES.find((a) => a.id === o)?.name || o;
  return nameOf(ix, o);
}
const stepOfChoice = (id = '') => (/^srd51:(race|subrace):/.test(id) ? 'race' : /:skills$/.test(id) || /^srd51:background:/.test(id) && !/starting/.test(id) ? 'background' : /starting/.test(id) ? 'equipment' : /:spells:/.test(id) ? 'spells' : 'class');
function extraBoxes(ix, ev) {
  const out = { race: [], class: [] };
  for (const c of ev.choices.filter((x) => EXTRA_KINDS[x.kind] || (x.kind === 'skill' && stepOfChoice(x.id) === 'race'))) {
    const step = stepOfChoice(c.id) === 'race' ? 'race' : 'class';
    const bad = new Set((c.unavailable || []).map((u) => u.option));
    out[step].push({
      title: `${EXTRA_KINDS[c.kind] || 'Навыки'}: ${nameOf(ix, c.origin?.definitionId)}`, note: `выбрано ${Array.isArray(c.selected) ? c.selected.length : c.selected ? 1 : 0} из ${c.count}`, choiceId: c.id,
      list: (c.options || []).filter((o) => !bad.has(o)).map((o) => ({ name: extraOptionName(ix, c.kind, o), value: o, on: (Array.isArray(c.selected) ? c.selected.includes(o) : c.selected === o) || undefined })),
    });
  }
  return out;
}

/** Новое состояние мастера создания для кампании. */
export function newCreation(ix, { campaign = null, userId = 'me', newId = () => crypto.randomUUID() } = {}) {
  const { context } = creationContextFromCampaign(campaign);
  const draft = createDraft({ draftId: newId(), accountScope: userId, mode: 'pc', context, rulesRevision: ix.cats.options.revision });
  return { v: 1, campaignId: campaign?.id ?? null, context, draft, tab: 0, focus: null, look: {}, ids: {}, characterId: null, operationId: null };
}

const evaluate = (ix, st) => evaluateBuild(st.context, ix.cats, st.draft, PORTS);
function change(ix, st, ch) {
  st.draft = confirmBuildChange(proposeBuildChange(st.draft, ch, st.context, ix.cats, PORTS));
  // Сборка изменилась — прежние ID экземпляров для отправки больше не подходят.
  st.ids = {}; st.characterId = null; st.operationId = null;
}
const choiceOf = (ev, pred) => ev.choices.find(pred);
const raceChoices = (ix, raceId) => [...ix.defs.values()].filter((d) => d.kind === 'subrace' && d.raceId === raceId);
const levels = (st) => Math.max(1, st.context.startLevel || 1);

/** Выбор окна → изменение черновика. Возвращает подсказку для экрана или null. */
export function applyCreationChoice(ix, st, { step, id, value } = {}) {
  const ev0 = evaluate(ix, st);
  const toggle = (choice, opt) => {
    if (!choice) return null;
    const cur = Array.isArray(choice.selected) ? [...choice.selected] : [];
    const at = cur.indexOf(opt);
    if (at >= 0) cur.splice(at, 1);
    else if (cur.length < choice.count) cur.push(opt);
    else return { title: 'Уже выбрано достаточно', body: `Снимите один из ${choice.count}, чтобы выбрать другой.` };
    change(ix, st, { type: 'setSelection', choiceId: choice.id, value: cur.length ? cur : undefined });
    return null;
  };
  if (step === 'race' && !value) {
    const raceId = `srd51:race:${id}`;
    if (!ix.defs.has(raceId)) return null;
    change(ix, st, { type: 'setRace', raceId });
    const subs = raceChoices(ix, raceId);
    if (subs.length === 1) change(ix, st, { type: 'setSubrace', subraceId: subs[0].id }); // в SRD у каждой расы одна подраса
    return null;
  }
  if (step === 'class' && !value) {
    const classId = `srd51:class:${id}`;
    if (!ix.defs.has(classId)) return null;
    change(ix, st, { type: 'setLevelHistory', levelHistory: Array.from({ length: levels(st) }, () => ({ classId })) });
    return null;
  }
  if (step === 'background' && !value && ix.defs.has(`srd51:background:${id}`)) { change(ix, st, { type: 'setBackground', backgroundId: `srd51:background:${id}` }); return null; }
  if (step === 'abilities') {
    if (id === 'abMode') {
      const method = UI_METHOD[value];
      if (!st.context.allowedAbilityMethods.includes(method)) return { title: 'Мастер этот способ не разрешил' };
      change(ix, st, { type: 'setAbilityMethod', method });
      change(ix, st, { type: 'setBaseScores', scores: Object.fromEntries(ABILITIES.map((a) => [a.id, null])) });
      return null;
    }
    if (id === 'auto') return autoAbilities(ix, st);
    if (id === 'abInc' || id === 'abDec') return stepAbility(ix, st, value, id === 'abInc' ? 1 : -1);
    return null;
  }
  if (id === 'extra') {
    const [choiceId, opt] = String(value).split('|');
    const c = ev0.choices.find((x) => x.id === choiceId);
    if (!c) return null;
    // Одиночный выбор (подкласс, стиль) хранится значением, множественный — списком.
    if (c.count === 1 && !Array.isArray(c.selected) && (c.kind === 'subclass' || c.kind === 'feature_option')) {
      change(ix, st, { type: 'setSelection', choiceId, value: c.selected === opt ? undefined : opt });
      return null;
    }
    return toggle(c, opt);
  }
  if (step === 'background' && id === 'skill') {
    const sid = SKILLS.find((s) => s.name === value)?.id;
    return toggle(choiceOf(ev0, (c) => c.kind === 'skill' && stepOfChoice(c.id) !== 'race' && c.options?.includes(sid)), sid);
  }
  if (step === 'background' && id === 'lang') {
    const lid = Object.keys(LANG_RU).find((k) => LANG_RU[k] === value) || value;
    const langs = ev0.choices.filter((c) => c.kind === 'language');
    const has = langs.find((c) => Array.isArray(c.selected) && c.selected.includes(lid));
    if (has) return toggle(has, lid);
    const free = langs.find((c) => (c.selected?.length || 0) < c.count && c.options?.includes(lid) && !(c.unavailable || []).some((u) => u.option === lid));
    return free ? toggle(free, lid) : { title: 'Языки уже выбраны', body: 'Снимите один, чтобы выбрать другой.' };
  }
  if (step === 'equipment' && id === 'eq') {
    const [title, name] = String(value).split('|');
    const g = equipmentGroups(ix, ev0).find((x) => x.title === title);
    const alt = g?.alts.find((a) => a.name === name);
    if (!g || !alt) return null;
    change(ix, st, { type: 'setSelection', choiceId: g.choice.id, value: { alternative: alt.id, picks: alt.picks } });
    return null;
  }
  if (step === 'spells') {
    if (id === 'spTab') { st.tab = Number(value) || 0; return null; }
    if (id === 'auto') return autoSpells(ix, st);
    if (id === 'spFocus') {
      const choice = spellChoices(evaluate(ix, st))[st.tab];
      const sid = choice && optionsOf(choice, ev0).find((x) => spellName(ix, x) === value);
      st.focus = value;
      return sid ? toggle(choice, sid) : null;
    }
    return null;
  }
  if (step === 'look') {
    if (id === 'name') { change(ix, st, { type: 'setIdentity', identity: { name: String(value ?? '').slice(0, 40) } }); return null; }
    st.look[id] = value;
    return null;
  }
  return null;
}

// ——— Характеристики ———
function stepAbility(ix, st, key, dir) {
  const m = st.draft.abilityMethod, scores = { ...st.draft.baseScores };
  if (m === 'standard_array') {
    const arr = [...ix.cats.options.abilityMethods.standardArray].sort((a, b) => b - a);
    const cur = scores[key];
    let next;
    if (cur == null) next = arr.find((v) => !Object.values(scores).includes(v)) ?? arr[arr.length - 1];
    else { const i = arr.indexOf(cur) - dir; if (i < 0 || i >= arr.length) return null; next = arr[i]; }
    const holder = Object.keys(scores).find((k) => k !== key && scores[k] === next);
    if (holder) scores[holder] = cur ?? null;
    scores[key] = next;
  } else if (m === 'point_buy') {
    const pb = ix.cats.options.abilityMethods.pointBuy;
    const cur = scores[key] ?? pb.min, next = cur + dir;
    if (next < pb.min || next > pb.max) return null;
    const spent = Object.entries({ ...scores, [key]: next }).reduce((s, [, v]) => s + (pb.cost[v ?? pb.min] || 0), 0);
    if (spent > pb.budget) return { title: 'Очки закончились', body: `Бюджет ${pb.budget}.` };
    for (const a of ABILITIES) scores[a.id] ??= pb.min;
    scores[key] = next;
  } else return { title: 'Броски характеристик — у мастера', body: 'Этот способ пока не подключён.' };
  change(ix, st, { type: 'setBaseScores', scores });
  return null;
}
function autoAbilities(ix, st) {
  const cls = tail(st.draft.levelHistory[0]?.classId);
  if (!cls) return { title: 'Сначала выберите класс' };
  if (st.draft.abilityMethod !== 'standard_array' && st.context.allowedAbilityMethods.includes('standard_array')) change(ix, st, { type: 'setAbilityMethod', method: 'standard_array' });
  const order = [...(PRIORITY[cls] || []), ...ABILITIES.map((a) => a.id)].filter((v, i, a) => a.indexOf(v) === i);
  const arr = [...ix.cats.options.abilityMethods.standardArray].sort((a, b) => b - a);
  change(ix, st, { type: 'setBaseScores', scores: Object.fromEntries(order.map((k, i) => [k, arr[i]])) });
  return { title: 'Характеристики расставлены', body: 'Можно поменять стрелками.' };
}

// ——— Снаряжение ———
const itemLabel = (ix, item) => (item.ref ? `${nameOf(ix, item.ref)}${item.quantity > 1 ? ` ×${item.quantity}` : ''}` : null);
function firstMatch(ix, filter) {
  return [...ix.equipment.values()].filter((e) => Object.entries(filter).every(([k, v]) => (k === 'exclude' ? !v.includes(e.id) : k === 'kind' ? e.kind === v : k === 'group' ? e.group === v : e.weapon?.[k] === v)))
    .sort((a, b) => nameOf(ix, a.id).localeCompare(nameOf(ix, b.id)))[0];
}
/** Группы выбора снаряжения: у каждой — варианты с готовыми picks (предмет «любой из группы» — первый подходящий). */
export function equipmentGroups(ix, ev) {
  const out = [];
  let n = 0;
  for (const c of ev.choices.filter((x) => x.kind === 'equipment')) {
    n += 1;
    const owner = nameOf(ix, c.origin?.definitionId);
    const alts = (c.alternatives || []).map((a) => {
      const picks = a.items.map((it) => (it.ref ? null : Array.from({ length: it.quantity }, () => firstMatch(ix, it.filter)?.id).filter(Boolean)));
      const name = a.items.map((it, i) => itemLabel(ix, it) || `${(picks[i] || []).map((id) => nameOf(ix, id)).join(', ') || 'на выбор'}`).join(' + ');
      return { id: a.id, name, picks, unavailable: (c.unavailable || []).some((u) => u.option === a.id) };
    });
    out.push({ title: `${owner} · ${n}`, choice: c, alts, selected: c.selected?.alternative });
  }
  return out;
}

// ——— Заклинания ———
const spellChoices = (ev) => ev.choices.filter((c) => c.kind === 'spell');
const spellName = (ix, id) => ix.spells.get(id)?.name?.ru || ix.spells.get(id)?.name?.en || id;
function optionsOf(choice, ev) {
  if (choice.options?.length) return choice.options;
  // «Подготовленные» волшебника — из книги: то, что выбрано в книге.
  const book = ev.choices.find((c) => c.kind === 'spell' && /spellbook/.test(c.id));
  return /prepared/.test(choice.id) && Array.isArray(book?.selected) ? book.selected : [];
}
function choiceLabel(c) {
  if (/cantrips/.test(c.id)) return 'Заговоры';
  if (/spellbook/.test(c.id)) return 'В книге';
  if (/prepared/.test(c.id)) return 'Готово к бою';
  return 'Заклинания';
}
function autoSpells(ix, st) {
  for (let guard = 0; guard < 6; guard += 1) {
    const ev = evaluate(ix, st);
    const c = spellChoices(ev).find((x) => (x.selected?.length || 0) < x.count && optionsOf(x, ev).length);
    if (!c) break;
    const have = new Set(c.selected || []);
    const pick = optionsOf(c, ev).filter((id) => !have.has(id) && !(c.unavailable || []).some((u) => u.option === id))
      .sort((a, b) => spellName(ix, a).localeCompare(spellName(ix, b), 'ru'));
    change(ix, st, { type: 'setSelection', choiceId: c.id, value: [...have, ...pick].slice(0, c.count) });
  }
  return { title: 'Заклинания выбраны', body: 'Поменять можно в списке.' };
}

// ——— Витрина для экранов ———
const card = (ix, def, img, sub, tags = []) => ({ id: tail(def.id), name: def.name.ru || def.name.en, sub, tags, img });
function raceSub(def) {
  const inc = (def.grants || []).filter((g) => g.kind === 'ability_increase');
  if (inc.length === 6) return '+1 ко всем шести';
  return inc.map((g) => `+${g.value} ${ABILITIES.find((a) => a.id === g.ability)?.short || ''}`).join(', ') || 'Без прибавок';
}

/** creationView(): объект формы CREATION (fixture.js) по текущему состоянию. */
export function creationModel(ix, st, { campaignName = '', userName = '' } = {}) {
  const ev = evaluate(ix, st), d = st.draft, di = ev.derivedInputs;
  const raceId = d.ancestry.raceId, classId = d.levelHistory[0]?.classId, bgId = d.background.backgroundId;
  const cls = ix.defs.get(classId);
  const races = [...ix.defs.values()].filter((x) => x.kind === 'race').map((r) => {
    const speed = (r.grants || []).find((g) => g.kind === 'speed')?.value;
    return card(ix, r, `assets/hero/race-${tail(r.id)}.webp`, raceSub(r), speed ? [`Скорость ${speed} фт`] : []);
  });
  const classes = [...ix.defs.values()].filter((x) => x.kind === 'class').map((c) => {
    const ab = c.class?.spellcasting?.ability;
    return card(ix, c, `assets/hero/class-${tail(c.id)}.webp`, `к${c.class?.hitDie} · ${ab ? ABILITIES.find((a) => a.id === ab)?.name : (PRIORITY[tail(c.id)] || []).slice(0, 1).map((k) => ABILITIES.find((a) => a.id === k)?.name).join('')}`, c.class?.spellcasting ? ['Магия'] : ['Оружие']);
  });
  const backgrounds = [...ix.defs.values()].filter((x) => x.kind === 'background').map((b) => ({
    id: tail(b.id), name: b.name.ru || b.name.en, icon: 'sun-03', tags: [],
    sub: (b.grants || []).filter((g) => g.kind === 'skill').map((g) => skillName(g.value)).join(', '), text: 'Предыстория SRD 5.1',
  }));

  // Характеристики
  const method = d.abilityMethod, pb = ix.cats.options.abilityMethods.pointBuy;
  const assigned = ABILITIES.filter((a) => Number.isInteger(d.baseScores[a.id])).length;
  const spent = method === 'point_buy' ? ABILITIES.reduce((s, a) => s + (pb.cost[d.baseScores[a.id] ?? pb.min] || 0), 0) : assigned;
  const of = method === 'point_buy' ? pb.budget : 6;
  const main = PRIORITY[tail(classId)]?.[0];
  const abilities = {
    mode: METHOD_UI[method],
    modes: [['buy', 'Покупка очков', 'point_buy'], ['array', 'Стандартный набор', 'standard_array'], ['roll', 'Бросить 4к6', 'rolled']]
      .map(([id, name, m]) => ({ id, name, disabled: !st.context.allowedAbilityMethods.includes(m) || m === 'rolled' })),
    budget: { spent, of, left: Math.max(0, of - spent) },
    list: ABILITIES.map((a) => {
      const base = d.baseScores[a.id], fin = di?.abilityScores?.[a.id];
      const race = (di?.abilityIncreases || []).filter((x) => x.ability === a.id).reduce((s, x) => s + x.value, 0);
      return { key: a.id, name: a.name, base: base ?? '—', cost: method === 'point_buy' ? pb.cost[base ?? pb.min] : '—', race: race ? `+${race}` : '—',
        final: fin ?? '—', mod: Number.isInteger(fin) ? signed(mod(fin)) : '—', main: a.id === main || undefined };
    }),
    asi: { title: 'Улучшение характеристик — с 4 уровня', note: `Герой начинает с ${levels(st)} уровня`, options: [] },
    auto: cls ? `Расставить как обычно: ${cls.name.ru}` : 'Расставить как обычно', autoNote: 'Стандартный набор по главным характеристикам класса. Стрелки меняют значения местами.',
    gave: Number.isInteger(di?.abilityScores?.con) ? [`Телосложение ${di.abilityScores.con}: ${signed(mod(di.abilityScores.con))} к хитам за уровень`] : ['Задайте все шесть характеристик'],
  };

  // Навыки и языки
  const skillC = ev.choices.find((c) => c.kind === 'skill' && stepOfChoice(c.id) !== 'race');
  const fixedSkills = new Map();
  // «Уже есть» у навыка — откуда: «предыстория «Прислужник»», «раса «Полуорк»» (без склонения названия).
  const KIND_RU = { background: 'предыстория', race: 'раса', subrace: 'раса', class: 'класс', subclass: 'подкласс' };
  for (const g of ev.grants.filter((x) => x.kind === 'proficiency' && x.category === 'skill')) { const def = ix.defs.get(g.origin?.definitionId); fixedSkills.set(g.value, KIND_RU[def?.kind] ? `${KIND_RU[def.kind]} «${nameOf(ix, def.id)}»` : nameOf(ix, g.origin?.definitionId)); }
  const backgroundSkills = skillC ? {
    title: `Навыки: ${cls?.name.ru || 'класс'}`, note: `выбрано ${skillC.selected?.length || 0} из ${skillC.count}`,
    hint: fixedSkills.size ? `Уже есть: ${[...fixedSkills.keys()].map(skillName).join(', ')}.` : '',
    list: [...[...fixedSkills].map(([k, from]) => ({ name: skillName(k), from })),
      ...skillC.options.filter((o) => !fixedSkills.has(o)).map((o) => (!skillC.selected?.includes(o) && (skillC.unavailable || []).some((u) => u.option === o)
        ? { name: skillName(o), from: 'уже есть' } : { name: skillName(o), on: skillC.selected?.includes(o) || undefined }))],
  } : { title: 'Навыки', note: 'сначала выберите класс', list: [...fixedSkills].map(([k, from]) => ({ name: skillName(k), from })) };
  const langCs = ev.choices.filter((c) => c.kind === 'language');
  const langNeed = langCs.reduce((s, c) => s + c.count, 0), langHave = langCs.reduce((s, c) => s + (c.selected?.length || 0), 0);
  const knownLangs = new Set(ev.grants.filter((g) => g.kind === 'language').map((g) => g.value));
  const backgroundLangs = {
    title: `Языки: ещё ${langNeed}`, note: `выбрано ${langHave} из ${langNeed}`,
    list: [...[...knownLangs].map((l) => ({ name: LANG_RU[l] || l, from: 'уже есть' })),
      ...Object.keys(LANG_RU).filter((l) => !knownLangs.has(l) && langCs.some((c) => c.options?.includes(l))).map((l) => ({ name: LANG_RU[l], on: langCs.some((c) => c.selected?.includes(l)) || undefined }))],
  };

  // Снаряжение
  const groups = equipmentGroups(ix, ev);
  const equipment = {
    modes: [{ id: 'kit', name: 'Набор класса и предыстории' }],
    groups: groups.map((g) => ({ title: g.title, note: g.alts.length > 1 ? `одно из ${g.alts.length}` : 'без выбора', options: g.alts.filter((a) => !a.unavailable).map((a) => ({ name: a.name, sub: '', icon: 'bag', on: a.id === g.selected || undefined })) })),
    always: [],
    gave: [di?.equipment?.currency?.gp ? `${di.equipment.currency.gp} зм` : 'Стартовое снаряжение класса и предыстории'],
  };
  equipment.always = Object.entries(di?.equipment?.currency || {}).filter(([, v]) => v).map(([k, v]) => ({ text: `${v} ${k === 'gp' ? 'зм' : k === 'sp' ? 'см' : k === 'cp' ? 'мм' : k}`, icon: 'bag' }));

  // Заклинания
  const sc = spellChoices(ev);
  const tab = Math.min(st.tab, Math.max(0, sc.length - 1));
  const curC = sc[tab];
  const meta = (id) => { const p = ix.ref[id] || [], e = ix.spells.get(id); return [ix.schools[e?.school], p[1], p[0]].filter(Boolean).join(' · '); };
  const list = curC ? optionsOf(curC, ev).map((id) => ({ name: spellName(ix, id), meta: meta(id), on: curC.selected?.includes(id) || undefined, conc: ix.spells.get(id)?.concentration || undefined, ritual: ix.spells.get(id)?.ritual || undefined, focus: spellName(ix, id) === st.focus || undefined })) : [];
  const focusId = curC && optionsOf(curC, ev).find((id) => spellName(ix, id) === st.focus);
  const spells = sc.length ? {
    live: true,
    progress: sc.map((c) => ({ label: choiceLabel(c), now: c.selected?.length || 0, max: c.count })),
    tabs: sc.map(choiceLabel), tab, list,
    detail: focusId ? { tag: `${ix.spells.get(focusId)?.level ? `${ix.spells.get(focusId).level} уровень` : 'Заговор'} · ${ix.schools[ix.spells.get(focusId)?.school] || ''}`, name: spellName(ix, focusId), text: (ix.ref[focusId] || []).slice(0, 4).filter(Boolean).join(' · ') }
      : { tag: 'Заклинание', name: 'Выберите в списке', text: 'Нажмите на заклинание, чтобы взять его или убрать.' },
    full: curC && (curC.selected?.length || 0) >= curC.count ? { title: `${choiceLabel(curC)}: выбрано ${curC.count} из ${curC.count}`, text: 'Чтобы взять другое, сначала уберите одно.', action: 'Понятно' }
      : { title: curC ? `${choiceLabel(curC)}: ${curC.selected?.length || 0} из ${curC.count}` : '', text: 'Отмечайте заклинания в списке.', action: 'Понятно' },
    gave: ['Заклинания попадут в лист вместе с ячейками'],
  } : { live: true, progress: [], tabs: ['Без заклинаний'], tab: 0, list: [], detail: { tag: '', name: cls ? `${cls.name.ru}: заклинаний на старте нет` : 'Сначала выберите класс', text: '' }, full: { title: 'Шаг можно пропустить', text: 'Магия этого класса появится позже или её нет.', action: 'Понятно' }, gave: [] };

  const look = { ...CREATION.look, name: d.identity.name || '', pronoun: st.look.pronoun || 'он', alignment: st.look.alignment || '', fields: CREATION.look.fields.map((f) => ({ ...f, value: st.look[f.id] || '' })), gave: ['Имя и мировоззрение попадут в лист'] };

  const missing = [...ev.errors, ...(ev.missing || [])];
  const stepOfMissing = (m) => (m.choiceId ? stepOfChoice(m.choiceId) : /abilit/.test(m.code) ? 'abilities' : /race/.test(m.code) ? 'race' : /class|level/.test(m.code) ? 'class' : /background/.test(m.code) ? 'background' : 'look');
  const done = {
    checks: [
      { name: 'Раса', ok: !!raceId && !missing.some((m) => stepOfMissing(m) === 'race'), step: 'race' }, { name: 'Класс', ok: !!classId && !missing.some((m) => stepOfMissing(m) === 'class'), step: 'class' },
      { name: 'Характеристики', ok: assigned === 6, step: 'abilities' }, { name: 'Предыстория', ok: !!bgId && !missing.some((m) => stepOfMissing(m) === 'background'), step: 'background' },
      { name: 'Снаряжение', ok: !missing.some((m) => stepOfMissing(m) === 'equipment'), step: 'equipment' },
      { name: 'Заклинания', ok: !missing.some((m) => stepOfMissing(m) === 'spells'), step: 'spells' },
      { name: 'Имя', ok: !!d.identity.name, step: 'look' },
    ],
    note: campaignName ? `Герой сохранится в «Моих героях», а потом предложим привести его в «${campaignName}».` : 'Герой сохранится в «Моих героях» — в кампанию приведёте его потом, в любую, где играете.',
  };

  const rules = [`Старт: ${levels(st)} уровень`, `Характеристики: ${st.context.allowedAbilityMethods.map((m) => ({ point_buy: 'покупка очков', standard_array: 'стандартный набор', rolled: 'броски' }[m])).join(' или ')}`,
    `Черты: ${st.context.optionalRules.feats ? 'включены' : 'выключены'}`, 'Книги: SRD 5.1', 'Снаряжение: стартовые наборы'];
  const methodsRu = st.context.allowedAbilityMethods.map((m) => ({ point_buy: 'покупка очков', standard_array: 'стандартный набор', rolled: 'броски' }[m])).join(' или ');
  const HINTS = {
    race: ['Раса даёт прибавки к характеристикам, скорость и врождённые умения. Её выборы — под карточками.', 'Расы SRD 5.1', 'information-circle'],
    class: ['Класс решает хиты, владения и магию. Подкласс, боевой стиль и другие выборы класса — под карточками.', `Кость хитов и спасброски — справа`, 'information-circle'],
    abilities: ['Шесть чисел, из которых растут все броски. «Расставить как обычно» поставит большие значения в главные характеристики класса.', `Мастер разрешил: ${methodsRu}`, 'crown'],
    background: ['Предыстория даёт навыки и языки. Здесь же — навыки класса и языки на выбор.', 'Навыки «от: …» уже есть', 'information-circle'],
    equipment: ['Стартовые наборы класса и предыстории: в каждой группе один вариант.', 'Купленное позже появится в «Сумке» листа', 'information-circle'],
    spells: ['Заговоры и заклинания на старте. Нажмите, чтобы взять или убрать; «Собрать за меня» возьмёт подходящие по алфавиту.', 'Ячейки появятся в листе сами', 'information-circle'],
    look: ['Имя и мировоззрение попадут в лист. Черты характера пока остаются только в этом окне.', 'Портрет можно поменять за столом', 'information-circle'],
  };
  // ok — шаг без пропущенных выборов (у пройденного шага с пропуском вместо ✓ будет «!»).
  const steps = CREATION.steps.map((x) => ({ ...(HINTS[x.id] ? { ...x, hint: HINTS[x.id][0], tip: HINTS[x.id][1], tipIcon: HINTS[x.id][2] } : x), ok: done.checks.find((c) => c.step === x.id)?.ok ?? true }));
  return {
    ...CREATION, steps, live: true, status: ev.status, missing,
    campaign: { name: campaignName || 'кампании', level: levels(st), rules },
    selected: { race: tail(raceId) || null, class: tail(classId) || null, background: tail(bgId) || null, abMode: METHOD_UI[method] },
    extra: extraBoxes(ix, ev), races, classes, abilities, backgrounds, backgroundSkills, backgroundLangs, equipment, spells, look, done,
    raceGave: raceId ? { [tail(raceId)]: [raceSub(ix.defs.get(raceId)), ...(Number.isFinite(di?.speed) ? [`Скорость ${di.speed} фт`] : [])] } : {},
    classGave: classId ? { [tail(classId)]: [`Кость хитов к${cls.class.hitDie}`, `Спасброски: ${cls.class.savingThrows.map((k) => ABILITIES.find((a) => a.id === k)?.name).join(', ')}`] } : {},
    backgroundGave: [...fixedSkills.keys()].length ? [`Навыки: ${[...fixedSkills.keys()].map(skillName).join(', ')}`] : ['Навыки и языки предыстории'],
    userName,
  };
}

/** Живой лист справа: { name, summary, stats, facts }. */
export function creationLiveModel(ix, st) {
  const ev = evaluate(ix, st), d = st.draft, di = ev.derivedInputs;
  const cls = ix.defs.get(d.levelHistory[0]?.classId), race = ix.defs.get(d.ancestry.raceId);
  const hp = di ? creationHitPoints({ ...di.hitPointInputs, constitution: di.abilityScores?.con }) : null;
  const skills = di?.proficiencies?.skills || [];
  return {
    name: d.identity.name || 'Новый герой',
    summary: [race?.name.ru, cls ? `${cls.name.ru} ${levels(st)}` : ''].filter(Boolean).join(' · ') || 'Начните с расы',
    stats: ABILITIES.map((a) => { const s = di?.abilityScores?.[a.id]; return { short: a.short, mod: Number.isInteger(s) ? signed(mod(s)) : '—', score: Number.isInteger(s) ? s : '—' }; }),
    facts: [
      ['Скорость', Number.isFinite(di?.speed) ? `${di.speed} фт` : undefined],
      ['Хиты', Number.isInteger(hp) ? String(hp) : undefined],
      ['Мастерство', di?.proficiencyBonus ? signed(di.proficiencyBonus) : undefined],
      ['Навыки', skills.length ? skills.map(skillName).join(', ') : undefined],
      ['Языки', di?.languages?.length ? di.languages.map((l) => LANG_RU[l] || l).join(', ') : undefined],
      ['Заклинания', di?.spells?.length ? `${di.spells.length}` : undefined],
    ],
  };
}

const gears = new WeakMap();
const gearOf = (ix) => { if (!gears.has(ix)) gears.set(ix, gearIndex(ix.cats.equipment)); return gears.get(ix); };
/** Итог «Герой готов» для экрана 53. */
export function creationDoneModel(ix, st) {
  const ev = evaluate(ix, st), di = ev.derivedInputs, live = creationLiveModel(ix, st);
  const cls = ix.defs.get(st.draft.levelHistory[0]?.classId);
  const hp = di ? creationHitPoints({ ...di.hitPointInputs, constitution: di.abilityScores?.con }) : null;
  const dex = di?.abilityScores?.dex, prof = di?.proficiencyBonus;
  const saves = new Set(cls?.class?.savingThrows || []);
  const castAb = cls?.class?.spellcasting?.ability, castMod = castAb && Number.isInteger(di?.abilityScores?.[castAb]) ? mod(di.abilityScores[castAb]) : null;
  // КД — по выбранному стартовому снаряжению (доспех, щит, Защита без доспехов), как его посчитает лист (gear.js).
  const mods = Object.fromEntries(ABILITIES.map((a) => [a.id, Number.isInteger(di?.abilityScores?.[a.id]) ? mod(di.abilityScores[a.id]) : 0]));
  const items = (di?.equipment?.items || []).map((it, i) => ({ id: `eq-${i}`, ref: it.ref, quantity: it.quantity }));
  const ac = Number.isInteger(dex) ? armorClass(wornItems(items, gearOf(ix)), mods, [tail(cls?.id)]) : null;
  return {
    name: live.name, line: [live.summary, ix.defs.get(st.draft.background.backgroundId)?.name.ru, st.look.alignment].filter(Boolean).join(' · '),
    art: cls ? `assets/hero/class-${tail(cls.id)}.webp` : 'assets/hero/race-human.webp',
    facts: [
      { label: 'Хиты', value: Number.isInteger(hp) ? String(hp) : '—', sub: cls ? `к${cls.class.hitDie} за уровень` : '' },
      { label: 'Класс доспеха', value: ac ? String(ac.value) : '—', sub: ac?.note || 'без доспехов' },
      { label: 'Инициатива', value: Number.isInteger(dex) ? signed(mod(dex)) : '—', sub: 'Ловкость' },
      ...(castMod !== null && prof ? [{ label: 'Сл заклинаний', value: String(8 + prof + castMod), sub: `атака ${signed(prof + castMod)}` }] : []),
      { label: 'Скорость', value: Number.isFinite(di?.speed) ? `${di.speed} фт` : '—', sub: 'ходьба' },
    ],
    abilities: ABILITIES.map((a, k) => { const s = di?.abilityScores?.[a.id]; return { ...live.stats[k], name: a.name, save: Number.isInteger(s) ? signed(mod(s) + (saves.has(a.id) ? prof || 0 : 0)) : '—', saveProf: saves.has(a.id) }; }),
    status: ev.status, missing: [...ev.errors, ...(ev.missing || [])].map((m) => m.message),
  };
}

/** Данные листа для команды создания. IDs сохраняются в состоянии: повтор после обрыва шлёт тот же запрос. */
export function creationCharacter(ix, st, { newId = () => crypto.randomUUID(), userId = null } = {}) {
  const ev = evaluate(ix, st);
  if (ev.status !== 'valid') { const e = new Error('Сборка не закончена'); e.missing = [...ev.errors, ...(ev.missing || [])]; throw e; }
  const res = toCharacterData(ev, st.draft, ix.cats, { ids: st.ids, makeId: () => newId() }, PORTS);
  st.ids = res.ids;
  st.characterId ||= newId(); st.operationId ||= newId();
  const data = { ...res.data, alignment: st.look.alignment || res.data.alignment || '' };
  // Черты с шага «Образ» — в личность героя (пустые не пишем).
  const personality = Object.fromEntries(['traits', 'ideals', 'bonds', 'flaws'].map((k) => [k, String(st.look[k] ?? '').trim()]).filter(([, v]) => v));
  if (Object.keys(personality).length) data.personality = personality;
  // Образ правят и после неудачной отправки: другой запрос — другой ID операции, иначе сервер откажет.
  const lookSig = JSON.stringify([data.alignment, data.personality ?? null]);
  if (st.lookSig && st.lookSig !== lookSig) st.operationId = newId();
  st.lookSig = lookSig;
  return { characterId: st.characterId, operationId: st.operationId, data, ownerId: userId };
}

// ——— Быстрый герой ———
export const quickClass = (role, talk) => ({
  front: talk === 'fist' ? 'barbarian' : talk === 'word' ? 'paladin' : 'fighter', range: 'ranger',
  magic: talk === 'word' ? 'sorcerer' : talk === 'trick' ? 'warlock' : 'wizard', heal: talk === 'word' ? 'bard' : talk === 'fist' ? 'druid' : 'cleric',
  shadow: talk === 'fist' ? 'monk' : 'rogue',
}[role] || 'fighter');
// Раса — из подходящих классу (прибавка к главной характеристике), с уклоном второго ответа: кулак — полуорк и дварф,
// слово — полуэльф и драконорождённый, хитрость — полурослик и тифлинг, знание — гном и эльф (#203, аудит C3).
const QUICK_FIT = {
  barbarian: ['half-orc', 'dragonborn', 'human', 'dwarf'], fighter: ['human', 'half-orc', 'dragonborn', 'dwarf', 'halfling', 'elf'], paladin: ['dragonborn', 'half-elf', 'human', 'half-orc'],
  ranger: ['elf', 'halfling', 'human', 'half-elf', 'dwarf'], wizard: ['gnome', 'elf', 'tiefling', 'human'], sorcerer: ['tiefling', 'half-elf', 'dragonborn', 'human', 'gnome'],
  warlock: ['tiefling', 'half-elf', 'human', 'halfling', 'gnome'], cleric: ['dwarf', 'human', 'half-elf', 'half-orc', 'elf'], bard: ['half-elf', 'tiefling', 'halfling', 'human', 'gnome'],
  druid: ['elf', 'dwarf', 'human', 'half-orc', 'gnome'], rogue: ['halfling', 'elf', 'tiefling', 'human'], monk: ['elf', 'halfling', 'human', 'dwarf'],
};
const QUICK_TALK_RACE = { fist: ['half-orc', 'dwarf', 'dragonborn'], word: ['half-elf', 'dragonborn', 'human'], trick: ['halfling', 'tiefling'], book: ['gnome', 'elf', 'human'] };
const quickRace = (cls, talk) => { const fit = QUICK_FIT[cls] || ['human']; return fit.find((r) => (QUICK_TALK_RACE[talk] || []).includes(r)) || fit[0]; };
// Навыки по второму ответу — те, что класс разрешает, раньше остальных.
const QUICK_SKILLS = {
  fist: ['athletics', 'intimidation', 'survival', 'perception', 'animal'], word: ['persuasion', 'insight', 'performance', 'deception', 'medicine'],
  trick: ['deception', 'sleight', 'stealth', 'acrobatics', 'perception'], book: ['history', 'investigation', 'arcana', 'religion', 'nature', 'medicine'],
};
const SKILL_ID = Object.fromEntries(SKILLS.map((s) => [s.name, s.id]));
const byTalk = (list, talk, key) => { const want = QUICK_SKILLS[talk] || []; const rank = (x) => { const i = want.indexOf(key(x)); return i < 0 ? 99 : i; }; return [...list].sort((a, b) => rank(a) - rank(b)); };
const full = (b) => !b || /выбрано (\d+) из \1/.test(b.note);
/**
 * Быстрый герой (89–90, #203): ответы { role, talk, name } → новый черновик кампании campaign. Класс — по обоим
 * ответам, раса — подходящая классу с уклоном второго ответа, навыки класса и расы — сначала обещанные вторым ответом,
 * остальные выборы — первые подходящие, характеристики — стандартный набор под класс.
 */
export function quickCreation(ix, { campaign = null, userId = 'me', answers = {}, newId } = {}) {
  const next = newCreation(ix, { campaign, userId, ...(newId ? { newId } : {}) });
  const ch = (x) => applyCreationChoice(ix, next, x);
  const m = () => creationModel(ix, next);
  const cls = quickClass(answers.role, answers.talk);
  ch({ step: 'race', id: quickRace(cls, answers.talk) }); ch({ step: 'class', id: cls }); ch({ step: 'background', id: m().backgrounds[0]?.id || 'acolyte' }); ch({ step: 'abilities', id: 'auto' });
  for (let i = 0; i < 10; i += 1) {
    const box = [...m().extra.race, ...m().extra.class].find((b) => !full(b)); if (!box) break;
    for (const it of byTalk(box.list, answers.talk, (x) => x.value)) { if (full([...m().extra.race, ...m().extra.class].find((x) => x.choiceId === box.choiceId))) break; ch({ step: 'class', id: 'extra', value: `${box.choiceId}|${it.value}` }); }
    if (!full([...m().extra.race, ...m().extra.class].find((x) => x.choiceId === box.choiceId))) break;
  }
  for (const s of byTalk(m().backgroundSkills?.list?.filter((x) => !x.from) || [], answers.talk, (x) => SKILL_ID[x.name])) if (!full(m().backgroundSkills)) ch({ step: 'background', id: 'skill', value: s.name });
  for (const l of m().backgroundLangs?.list?.filter((x) => !x.from) || []) { if (full(m().backgroundLangs)) break; ch({ step: 'background', id: 'lang', value: l.name }); }
  for (const g of m().equipment?.groups || []) ch({ step: 'equipment', id: 'eq', value: `${g.title}|${g.options[0].name}` });
  ch({ step: 'spells', id: 'auto' });
  if (answers.name) ch({ step: 'look', id: 'name', value: answers.name });
  return next;
}
