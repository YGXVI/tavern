// TASK-186 P2: pure character build engine (plan r1 D3–D4). No DOM/store/auth/network/RNG/eval and no clock:
// the same (context, catalogues, draft) always gives the same evaluation. Formulas that belong to the
// TASK-004 sheet are injected (`ports`), not re-implemented here.
import { mod } from '../data/rules.js';

export const ABILITY_IDS = Object.freeze(['str', 'dex', 'con', 'int', 'wis', 'cha']);
export const ABILITY_METHODS = Object.freeze(['standard_array', 'point_buy', 'rolled']);
export const OPTIONAL_RULES = Object.freeze(['feats', 'multiclass', 'flexibleRacialAsi']);
const SOURCE_SRD = 'srd51';
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const sorted = list => [...list].sort((a, b) => a - b);
const sameMultiset = (a, b) => a.length === b.length && sorted(a).every((v, i) => v === sorted(b)[i]);
const ABILITY_RU = { str: 'Сила', dex: 'Ловкость', con: 'Телосложение', int: 'Интеллект', wis: 'Мудрость', cha: 'Харизма' };

// Until TASK-004 re-exports its sheet rules, the shared dist/js/data/rules.js modifier is reused;
// unknown scores stay unknown instead of becoming 10.
export const DEFAULT_PORTS = Object.freeze({ abilityModifier: score => (Number.isInteger(score) ? mod(score) : null) });

/** Policy of a campaign that set nothing (plan r1 D3, approved defaults). */
export function defaultCreationContext({ campaignId = null, policyRevision = 'default-v1' } = {}) {
  return {
    campaignId, policyRevision, edition: '5e-2014', allowedSources: [SOURCE_SRD], startLevel: 1,
    allowedAbilityMethods: ['standard_array'], optionalRules: { feats: false, multiclass: false, flexibleRacialAsi: false },
    equipmentPolicy: 'packages', hpMethod: 'fixed_average',
  };
}

/** Read adapter: a legacy campaign.level is shown for the master to confirm, never applied silently. */
export function creationContextFromCampaign(campaign, policy = null) {
  const context = policy ? structuredClone(policy) : defaultCreationContext({ campaignId: campaign?.id ?? null });
  const notices = [], errors = validateCreationContext(context);
  const level = campaign?.level;
  if (level !== undefined && level !== null) {
    if (!Number.isInteger(level) || level < 1 || level > 20) errors.push({ code: 'legacy_level_invalid', message: `Уровень кампании ${level} вне 1–20; мастер должен задать стартовый уровень.` });
    else if (!policy && level !== 1) notices.push({ code: 'legacy_level', level, message: `В кампании указан уровень ${level}. Стартовый уровень героев — 1, пока мастер не подтвердит ${level}.` });
  }
  return { context, notices, errors };
}

export function validateCreationContext(c) {
  const errors = [], bad = (code, message) => errors.push({ code, message });
  if (!isObject(c)) return [{ code: 'context', message: 'Нет политики создания.' }];
  if (c.edition !== '5e-2014') bad('edition', 'Поддерживается только D&D 5e 2014.');
  if (!Number.isInteger(c.startLevel) || c.startLevel < 1 || c.startLevel > 20) bad('start_level', 'Стартовый уровень 1–20.');
  if (!Array.isArray(c.allowedAbilityMethods) || !c.allowedAbilityMethods.length || c.allowedAbilityMethods.some(m => !ABILITY_METHODS.includes(m))) bad('ability_methods', 'Неизвестный метод характеристик.');
  if (!Array.isArray(c.allowedSources) || !c.allowedSources.includes(SOURCE_SRD)) bad('sources', 'Нужен источник SRD 5.1.');
  if (!isObject(c.optionalRules) || Object.keys(c.optionalRules).some(k => !OPTIONAL_RULES.includes(k) || typeof c.optionalRules[k] !== 'boolean')) bad('optional_rules', 'Неизвестное опциональное правило.');
  if (c.optionalRules?.flexibleRacialAsi) bad('unsupported_rule', 'Перенос расовых прибавок (TCE) не поддержан этой ревизией; выключите его.');
  if (c.equipmentPolicy !== 'packages') bad('equipment_policy', 'Поддержаны только стартовые наборы класса и предыстории.');
  if (c.hpMethod !== 'fixed_average') bad('hp_method', 'Поддержаны только средние хиты после 1-го уровня.');
  return errors;
}

export function createDraft({ draftId, accountScope, mode, context, rulesRevision }) {
  return {
    schemaVersion: 1, draftId, accountScope, mode, campaignId: context.campaignId, policyRevision: context.policyRevision, rulesRevision,
    identity: { name: '', notes: '' }, abilityMethod: context.allowedAbilityMethods[0],
    baseScores: Object.fromEntries(ABILITY_IDS.map(a => [a, null])), rollReceipts: [],
    ancestry: { raceId: null, subraceId: null }, background: { backgroundId: null },
    levelHistory: [], selections: {}, manualOverrides: [], invalidationLog: [],
  };
}

/** Closed predicate set; an unknown operator is 'unknown', never true. */
export function evaluatePredicate(p, state) {
  if (!isObject(p)) return 'unknown';
  const [op] = Object.keys(p), arg = p[op];
  const all = values => values.includes(false) ? false : values.includes('unknown') ? 'unknown' : true;
  switch (op) {
    case 'all': return all(arg.map(x => evaluatePredicate(x, state)));
    case 'any': { const v = arg.map(x => evaluatePredicate(x, state)); return v.includes(true) ? true : v.includes('unknown') ? 'unknown' : false; }
    case 'not': { const v = evaluatePredicate(arg, state); return v === 'unknown' ? v : !v; }
    case 'classLevel': return (state.classLevels.get(arg.class) || 0) >= arg.min;
    case 'characterLevel': return state.characterLevel >= arg.min;
    case 'abilityMinimum': { const s = state.scores[arg.ability]; return Number.isInteger(s) ? s >= arg.min : 'unknown'; }
    case 'hasFeature': return state.features.has(arg);
    case 'hasSpell': return state.spells.has(arg);
    case 'sourceEnabled': return state.enabled.has(arg);
    case 'unique': return true; // checked by the caller against earlier selections
    default: return 'unknown';
  }
}

function describePredicate(p, names) {
  const [op] = Object.keys(p || {}), arg = p?.[op];
  if (op === 'all' || op === 'any') return arg.map(x => describePredicate(x, names)).join(op === 'all' ? ' и ' : ' или ');
  if (op === 'not') return `не (${describePredicate(arg, names)})`;
  if (op === 'classLevel') return `${names(arg.class)} ${arg.min}-го уровня`;
  if (op === 'characterLevel') return `${arg.min}-й уровень персонажа`;
  if (op === 'abilityMinimum') return `${ABILITY_RU[arg.ability]} ${arg.min}+`;
  if (op === 'hasFeature') return `способность «${names(arg)}»`;
  if (op === 'hasSpell') return `заклинание «${names(arg)}»`;
  if (op === 'sourceEnabled') return arg === 'rule:feats' ? 'черты разрешены мастером' : arg === 'rule:multiclass' ? 'мультикласс разрешён мастером' : arg;
  return 'неизвестное условие';
}

function indexCatalogues({ options, spells, equipment, features }) {
  const defs = new Map(options.entries.map(e => [e.id, e]));
  const spellById = new Map(spells.entries.map(s => [s.id, s]));
  const equipmentById = new Map(equipment.entries.map(e => [e.id, e]));
  const featureById = new Map((features?.entries || []).map(f => [f.id, f]));
  const names = id => defs.get(id)?.name.ru || spellById.get(id)?.name.ru || featureById.get(id)?.name.ru || equipmentById.get(id)?.name.en
    || defs.get(id)?.name.en || spellById.get(id)?.name.en || featureById.get(id)?.name.en || id;
  return { options, spells, equipment, defs, spellById, equipmentById, names };
}

function abilityInputErrors(draft, context, methods) {
  const errors = [], warnings = [], base = draft.baseScores || {};
  const values = ABILITY_IDS.map(a => base[a]);
  if (!context.allowedAbilityMethods.includes(draft.abilityMethod)) errors.push({ code: 'ability_method', message: 'Этот метод характеристик не разрешён мастером.' });
  if (values.some(v => v === null || v === undefined)) return { errors, warnings, complete: false };
  if (values.some(v => !Number.isInteger(v))) { errors.push({ code: 'ability_scores', message: 'Характеристики — целые числа.' }); return { errors, warnings, complete: true }; }
  if (draft.abilityMethod === 'standard_array' && !sameMultiset(values, methods.standardArray)) errors.push({ code: 'standard_array', message: `Нужен стандартный набор ${methods.standardArray.join(', ')} — каждое значение один раз.` });
  if (draft.abilityMethod === 'point_buy') {
    const pb = methods.pointBuy;
    if (values.some(v => v < pb.min || v > pb.max)) errors.push({ code: 'point_buy_range', message: `При покупке очков значения ${pb.min}–${pb.max} до расовых прибавок.` });
    else {
      const spent = values.reduce((n, v) => n + pb.cost[String(v)], 0);
      if (spent > pb.budget) errors.push({ code: 'point_buy_budget', message: `Потрачено ${spent} очков из ${pb.budget}.` });
      else if (spent < pb.budget) warnings.push({ code: 'point_buy_left', message: `Осталось ${pb.budget - spent} очков.` });
    }
  }
  if (draft.abilityMethod === 'rolled') {
    const receipts = draft.rollReceipts || [];
    const okDice = r => Array.isArray(r?.dice) && r.dice.length === 4 && r.dice.every(d => Number.isInteger(d) && d >= 1 && d <= 6);
    if (receipts.length !== methods.roll.scores || !receipts.every(okDice)) errors.push({ code: 'roll_receipts', message: 'Нужно 6 записанных бросков 4d6.' });
    else {
      const totals = receipts.map(r => r.dice.reduce((a, b) => a + b, 0) - Math.min(...r.dice));
      if (!sameMultiset(values, totals)) errors.push({ code: 'rolled_scores', message: `Характеристики должны совпадать с бросками: ${totals.join(', ')}.` });
      if (receipts.some(r => r.source !== 'server')) warnings.push({ code: 'manual_rolls', message: 'Броски записаны вручную: нужно подтверждение мастера.' });
    }
  }
  return { errors, warnings, complete: true };
}

/** Max spell level a class can learn at a class level — from that class's own table, not shared multiclass slots. */
function classMaxSpellLevel(cls, classLevel) {
  const sc = cls.class.spellcasting;
  if (!sc || classLevel < sc.startLevel) return null;
  const row = cls.progression[classLevel - 1];
  if (sc.slots === 'pact') return row.values.pactSlotLevel;
  const top = row.spellSlots.findLastIndex(n => n > 0);
  return top >= 0 ? top + 1 : 0;
}

const fullTable = cls => cls.progression.map(r => r.spellSlots);

/**
 * Evaluate a draft. Returns {status, choices, grants, derivedInputs, errors, warnings, sourceTrace}.
 * status: 'valid' (all required decisions, no errors), 'incomplete' (missing input), 'invalid' (errors).
 */
export function evaluateBuild(context, catalogues, draft, ports = DEFAULT_PORTS) {
  const cat = indexCatalogues(catalogues), { defs, names } = cat;
  const errors = [...validateCreationContext(context)], warnings = [], choices = [], grants = [], missing = [];
  const err = (code, message, extra = {}) => errors.push({ code, message, ...extra });
  if (draft?.schemaVersion !== 1) return { status: 'invalid', choices, grants, derivedInputs: null, errors: [{ code: 'draft_schema', message: 'Неизвестная версия черновика: открыть только для просмотра.' }], warnings, sourceTrace: [] };
  if (draft.policyRevision !== context.policyRevision) err('stale_policy', 'Политика кампании изменилась: проверьте выбор заново.');
  if (draft.rulesRevision !== catalogues.options.revision) err('stale_rules', 'Справочник обновился: проверьте выбор заново.');
  const methods = catalogues.options.abilityMethods;
  const enabled = new Set(Object.entries(context.optionalRules || {}).filter(([, v]) => v).map(([k]) => `rule:${k}`));
  const srdOnly = context.allowedSources?.length === 1;
  const selections = draft.selections || {};

  const abilities = abilityInputErrors(draft, context, methods);
  errors.push(...abilities.errors); warnings.push(...abilities.warnings);
  if (!abilities.complete) missing.push({ code: 'abilities', message: 'Задайте все шесть характеристик.' });
  const base = { ...draft.baseScores };
  const scores = Object.fromEntries(ABILITY_IDS.map(a => [a, Number.isInteger(base[a]) ? base[a] : null]));
  const caps = Object.fromEntries(ABILITY_IDS.map(a => [a, 20]));
  const increaseTrace = [];
  const raise = (ability, value, origin, maximum) => {
    if (maximum) caps[ability] = Math.max(caps[ability], maximum);
    if (scores[ability] === null) return;
    if (scores[ability] + value > caps[ability]) err('ability_cap', `${ABILITY_RU[ability]} не может превысить ${caps[ability]}.`, { origin });
    scores[ability] = Math.min(caps[ability], scores[ability] + value);
    increaseTrace.push({ ability, value, origin });
  };

  const state = { scores, classLevels: new Map(), characterLevel: 0, features: new Set(), spells: new Set(), enabled };
  const selectedFeatureOptions = new Set();
  const pendingSpellGrants = [];

  // A grant is applied once, at the event that brings it; prerequisites are checked at that moment.
  function applyGrant(g, origin) {
    if (g.prerequisites) {
      const ok = evaluatePredicate(g.prerequisites, state);
      if (g.kind === 'spell' && g.prerequisites.characterLevel) { pendingSpellGrants.push({ g, origin }); return; }
      if (ok !== true) return;
    }
    grants.push({ ...g, origin });
    if (g.kind === 'feature') state.features.add(g.ref);
    if (g.kind === 'spell') state.spells.add(g.ref);
    if (g.kind === 'ability_increase') raise(g.ability, g.value, origin, g.maximum);
  }
  function addChoice(c, origin, extra = {}) {
    const instance = { ...c, origin, selected: selections[c.id], ...extra };
    choices.push(instance);
    return instance;
  }
  const requireSelection = (instance, label) => {
    const v = instance.selected;
    if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) {
      if (!instance.optional) missing.push({ code: 'choice', choiceId: instance.id, message: `Не выбрано: ${label}.` });
      return false;
    }
    return true;
  };

  // Ancestry.
  const race = defs.get(draft.ancestry?.raceId);
  if (!draft.ancestry?.raceId) missing.push({ code: 'race', message: 'Выберите расу.' });
  else if (race?.kind !== 'race') err('race', 'Раса недоступна в разрешённых источниках.');
  let subrace = null;
  state.characterLevel = 0;
  if (race?.kind === 'race') {
    const origin = { definitionId: race.id };
    race.grants.forEach(g => applyGrant(g, origin));
    for (const c of race.choices) {
      if (c.kind === 'subrace') {
        const sub = draft.ancestry.subraceId;
        if (!sub) missing.push({ code: 'subrace', message: 'Выберите подрасу.' });
        else if (!c.options.includes(sub)) err('subrace', 'Подраса не относится к выбранной расе.');
        else subrace = defs.get(sub);
      } else addChoice(c, origin);
    }
  }
  if (subrace) { const origin = { definitionId: subrace.id }; subrace.grants.forEach(g => applyGrant(g, origin)); subrace.choices.forEach(c => addChoice(c, origin)); }
  else if (draft.ancestry?.subraceId && !race?.choices.some(c => c.kind === 'subrace')) err('subrace', 'У этой расы нет подрас в разрешённых источниках.');

  // Background.
  const background = defs.get(draft.background?.backgroundId);
  if (!draft.background?.backgroundId) missing.push({ code: 'background', message: 'Выберите предысторию.' });
  else if (background?.kind !== 'background') err('background', 'Предыстория недоступна.');
  if (background?.kind === 'background') { const origin = { definitionId: background.id }; background.grants.forEach(g => applyGrant(g, origin)); background.choices.forEach(c => addChoice(c, origin)); }

  // Racial ability choices apply at creation, before any class event.
  for (const c of choices.filter(x => x.kind === 'ability_increase')) {
    if (!requireSelection(c, 'прибавки характеристик')) continue;
    const v = c.selected;
    if (!Array.isArray(v) || v.length !== c.count || new Set(v).size !== v.length || v.some(a => !c.options.includes(a))) { err('ability_choice', `Выберите ${c.count} разные характеристики из допустимых.`, { choiceId: c.id }); continue; }
    v.forEach(a => raise(a, c.value, c.origin));
  }

  // Class level events, in order.
  const history = draft.levelHistory || [];
  if (history.length < context.startLevel) missing.push({ code: 'levels', message: `Распределите уровни: ${history.length} из ${context.startLevel}.` });
  if (history.length > context.startLevel) err('levels', `Уровней больше стартового (${context.startLevel}).`);
  const classIds = [...new Set(history.map(e => e.classId))];
  if (classIds.length > 1 && !enabled.has('rule:multiclass')) err('multiclass_disabled', 'Мультикласс не разрешён мастером.');
  const subclassOf = new Map(), takenFeats = new Set();
  let startingClass = null;
  history.slice(0, context.startLevel).forEach((event, i) => {
    const cls = defs.get(event.classId);
    if (cls?.kind !== 'class') { err('class', `Уровень ${i + 1}: класс недоступен.`); return; }
    const classLevel = (state.classLevels.get(cls.id) || 0) + 1;
    state.characterLevel = i + 1;
    const origin = { definitionId: cls.id, characterLevel: i + 1, classLevel };
    if (i === 0) {
      startingClass = cls;
      cls.grants.forEach(g => applyGrant(g, origin));
      cls.choices.forEach(c => addChoice(c, origin));
    } else if (classLevel === 1) {
      for (const id of [...state.classLevels.keys(), cls.id]) {
        const p = defs.get(id).class.multiclass.prerequisites, ok = evaluatePredicate(p, state);
        if (ok !== true) err('multiclass_prerequisite', `Уровень ${i + 1}: для мультикласса нужно ${describePredicate(p, names)} (${names(id)}).`, { level: i + 1 });
      }
      cls.class.multiclass.grants.forEach(g => applyGrant(g, origin));
      cls.class.multiclass.choices.forEach(c => addChoice(c, origin));
    }
    state.classLevels.set(cls.id, classLevel);
    const row = cls.progression[classLevel - 1];
    row.grants.forEach(g => applyGrant(g, origin));
    for (const c of row.choices) {
      const instance = addChoice(c, origin);
      if (c.kind === 'subclass') {
        if (requireSelection(instance, `подкласс (${names(cls.id)})`)) {
          if (!c.options.includes(instance.selected)) err('subclass', 'Подкласс не относится к классу.', { choiceId: c.id });
          else subclassOf.set(cls.id, defs.get(instance.selected));
        }
      }
      if (c.kind === 'asi_or_feat') applyAsi(instance, origin);
      if (c.kind === 'feature_option') applyFeatureOptions(instance, origin);
    }
    const sub = subclassOf.get(cls.id);
    if (sub && classLevel >= sub.selectionLevel) {
      const subOrigin = { definitionId: sub.id, characterLevel: i + 1, classLevel };
      const subRow = sub.progression[classLevel - 1];
      subRow.grants.forEach(g => applyGrant(g, subOrigin));
      for (const c of subRow.choices) { const instance = addChoice(c, subOrigin); if (c.kind === 'feature_option') applyFeatureOptions(instance, subOrigin); }
    }
  });
  for (const { g, origin } of pendingSpellGrants) if (evaluatePredicate(g.prerequisites, state) === true) { grants.push({ ...g, origin }); state.spells.add(g.ref); }

  function applyAsi(instance, origin) {
    if (!requireSelection(instance, `увеличение характеристик или черта (${origin.characterLevel}-й уровень)`)) return;
    const v = instance.selected;
    if (v?.type === 'asi') {
      const inc = v.increases || {}, keys = Object.keys(inc), total = Object.values(inc).reduce((a, b) => a + b, 0);
      const shape = keys.length === 1 ? inc[keys[0]] === 2 : keys.length === 2 && keys.every(k => inc[k] === 1);
      if (!shape || total !== 2 || keys.some(k => !ABILITY_IDS.includes(k))) { err('asi', 'Увеличение: +2 к одной или +1 к двум характеристикам.', { choiceId: instance.id }); return; }
      keys.forEach(k => raise(k, inc[k], origin));
    } else if (v?.type === 'feat') {
      const feat = defs.get(v.featId);
      if (!enabled.has('rule:feats')) { err('feats_disabled', 'Черты не разрешены мастером: выберите увеличение характеристик.', { choiceId: instance.id }); return; }
      if (feat?.kind !== 'feat') { err('feat', 'Черта недоступна.', { choiceId: instance.id }); return; }
      if (!feat.repeatable && takenFeats.has(feat.id)) { err('feat_repeat', `Черту «${names(feat.id)}» нельзя взять повторно.`, { choiceId: instance.id }); return; }
      // Prerequisites are checked with the scores before this level's increase.
      const ok = feat.prerequisites ? evaluatePredicate(feat.prerequisites, state) : true;
      if (ok !== true) { err('feat_prerequisite', `«${names(feat.id)}» требует ${describePredicate(feat.prerequisites, names)} на ${origin.characterLevel}-м уровне.`, { choiceId: instance.id }); return; }
      takenFeats.add(feat.id);
      feat.grants.forEach(g => applyGrant(g, { ...origin, definitionId: feat.id }));
    } else err('asi', 'Выберите увеличение характеристик или черту.', { choiceId: instance.id });
  }
  function applyFeatureOptions(instance, origin) {
    // Availability is computed for this level event, exactly as the selection is checked below.
    const atEvent = () => ({ ...state, spells: new Set([...state.spells, ...selectedSpellIds()]) });
    instance.unavailable = instance.options.map(option => {
      const p = instance.optionPrerequisites?.[option];
      if (selectedFeatureOptions.has(option) && ![].concat(instance.selected).includes(option)) return { option, reason: 'уже выбран' };
      return p && evaluatePredicate(p, atEvent()) !== true ? { option, reason: describePredicate(p, names) } : null;
    }).filter(Boolean);
    if (!requireSelection(instance, names(instance.featureRef) || 'вариант')) return;
    const v = Array.isArray(instance.selected) ? instance.selected : [instance.selected];
    if (v.length !== instance.count) err('choice_count', `Нужно выбрать ${instance.count}.`, { choiceId: instance.id });
    for (const option of v) {
      if (!instance.options.includes(option)) { err('choice_option', 'Недопустимый вариант.', { choiceId: instance.id }); continue; }
      if (selectedFeatureOptions.has(option)) { err('choice_repeat', `«${names(option)}» уже выбран.`, { choiceId: instance.id }); continue; }
      const p = instance.optionPrerequisites?.[option];
      if (p) {
        const ok = evaluatePredicate(p, atEvent());
        if (ok !== true) { err('option_prerequisite', `«${names(option)}» требует ${describePredicate(p, names)}.`, { choiceId: instance.id }); continue; }
      }
      selectedFeatureOptions.add(option); state.features.add(option);
      grants.push({ id: `${instance.id}:${option}`, kind: 'feature', ref: option, origin });
    }
  }
  function selectedSpellIds() {
    return Object.entries(selections).filter(([id]) => /:spells:/.test(id)).flatMap(([, v]) => (Array.isArray(v) ? v : []));
  }

  // Proficiencies and languages: fixed grants first; a duplicate skill/tool gets a same-kind replacement (SRD p.60).
  const held = { skill: new Map(), tool: new Map(), language: new Map(), armor: new Set(), weapon: new Set(), saving_throw: new Set() };
  const sameKind = { skill: catalogues.options.skills, tool: [...cat.equipmentById.values()].filter(e => e.kind === 'tool').map(e => e.id.split(':')[2]) };
  for (const g of grants) {
    if (g.kind === 'language') held.language.set(g.value, g.id);
    if (g.kind !== 'proficiency') continue;
    if (g.category === 'skill' || g.category === 'tool') {
      if (held[g.category].has(g.value)) {
        const replacement = addChoice({ id: `${g.id}:replacement`, kind: g.category, count: 1, distinct: true, replaces: g.value, options: sameKind[g.category] }, g.origin);
        replacement.reason = `«${g.value}» уже есть от другого источника: выберите другое владение того же вида.`;
      } else held[g.category].set(g.value, g.id);
    } else held[g.category].add(g.value);
  }
  for (const c of choices.filter(x => ['skill', 'tool', 'language'].includes(x.kind))) {
    const label = c.kind === 'skill' ? 'навыки' : c.kind === 'tool' ? 'инструменты' : 'языки';
    c.unavailable = c.options.filter(o => held[c.kind].has(o)).map(option => ({ option, reason: 'уже есть' }));
    if (!requireSelection(c, `${label}${c.featureRef ? ` (${names(c.featureRef)})` : ''}`)) continue;
    const v = Array.isArray(c.selected) ? c.selected : [c.selected];
    if (v.length !== c.count || new Set(v).size !== v.length) { err('choice_count', `Нужно выбрать ${c.count}: ${label}.`, { choiceId: c.id }); continue; }
    for (const option of v) {
      if (!c.options.includes(option)) err('choice_option', `Недопустимый вариант: ${option}.`, { choiceId: c.id });
      else if (held[c.kind].has(option)) err('duplicate_proficiency', `«${option}» уже есть.`, { choiceId: c.id });
      else held[c.kind].set(option, c.id);
    }
  }
  for (const c of choices.filter(x => x.kind === 'expertise')) {
    c.options = [...held.skill.keys(), ...(c.from === 'proficient_skills_or_thieves_tools' && held.tool.has('thieves-tools') ? ['thieves-tools'] : [])];
    if (!requireSelection(c, 'компетентность')) continue;
    const v = c.selected, earlier = choices.filter(x => x.kind === 'expertise' && x !== c && choices.indexOf(x) < choices.indexOf(c)).flatMap(x => x.selected || []);
    if (!Array.isArray(v) || v.length !== c.count || new Set(v).size !== v.length || v.some(o => !c.options.includes(o))) err('expertise', 'Компетентность — только для навыков (или воровских инструментов), которыми вы владеете.', { choiceId: c.id });
    else if (v.some(o => earlier.includes(o))) err('expertise_repeat', 'Компетентность к одному навыку дважды не берётся.', { choiceId: c.id });
  }
  for (const c of choices.filter(x => x.kind === 'favored_enemy' || x.kind === 'terrain')) {
    if (!requireSelection(c, c.kind === 'terrain' ? 'избранная местность' : 'избранный враг')) continue;
    const v = Array.isArray(c.selected) ? c.selected : [c.selected], earlier = choices.filter(x => x.kind === c.kind && choices.indexOf(x) < choices.indexOf(c)).flatMap(x => x.selected || []);
    if (v.length !== c.count || v.some(o => !c.options.includes(o) || earlier.includes(o))) err('choice_option', 'Выберите новый вариант из списка.', { choiceId: c.id });
  }

  // Spells: list filters, then each class's cantrips/known/spellbook/prepared at its final class level.
  const spellIds = list => cat.spells.entries.filter(s => (!srdOnly || s.srd) && (list === 'any' || s.classes.base.includes(list)));
  const listOf = classDefId => defs.get(classDefId)?.class.spellcasting?.listRef;
  const spellbook = [];
  const checkSpells = (c, pool, label) => {
    c.options = pool.map(s => s.id);
    if (!requireSelection(c, label)) return [];
    const v = Array.isArray(c.selected) ? c.selected : [c.selected];
    if (c.optional ? v.length > c.count : v.length !== c.count) err('spell_count', `${label}: нужно ${c.optional ? 'не больше ' : ''}${c.count}, выбрано ${v.length}.`, { choiceId: c.id });
    if (new Set(v).size !== v.length) err('spell_repeat', `${label}: заклинание выбрано дважды.`, { choiceId: c.id });
    const allowed = new Set(c.options);
    for (const id of v) if (!allowed.has(id)) err('spell_option', `${label}: «${names(id)}» недоступно (список, круг или источник).`, { choiceId: c.id });
    v.forEach(id => state.spells.add(id));
    return v;
  };
  for (const c of choices.filter(x => x.kind === 'spell')) {
    const owner = c.origin.definitionId, f = c.spellFilter, ownerClass = defs.get(owner)?.kind === 'subclass' ? defs.get(owner).classId : owner;
    const classLevel = c.origin.classLevel ?? null;
    let pool = f.lists === 'spellbook' ? null : f.lists === 'any' ? spellIds('any') : f.lists === 'class' ? spellIds(listOf(ownerClass)) : f.lists.flatMap(l => spellIds(listOf(`srd51:class:${l}`)));
    const max = f.maxLevel === 'castable' ? classMaxSpellLevel(defs.get(ownerClass), classLevel) : null;
    if (pool) pool = pool.filter(s => (f.level === undefined || s.level === f.level) && (max === null || (s.level >= 1 && s.level <= max)));
    if (f.lists === 'spellbook') c.dependsOnSpellbook = true; else checkSpells(c, pool, names(c.featureRef) || 'заклинания');
  }
  for (const [classId, classLevel] of state.classLevels) {
    const cls = defs.get(classId), sc = cls.class.spellcasting;
    if (!sc || classLevel < sc.startLevel) continue;
    const row = cls.progression[classLevel - 1], max = classMaxSpellLevel(cls, classLevel), list = spellIds(sc.listRef);
    const origin = { definitionId: classId, classLevel, characterLevel: state.characterLevel };
    const label = `${names(classId)}: `;
    if (row.values.cantripsKnown) checkSpells(addChoice({ id: `${classId}:spells:cantrips`, kind: 'spell', count: row.values.cantripsKnown, distinct: true }, origin), list.filter(s => s.level === 0), `${label}заговоры`);
    if (sc.mode === 'known') checkSpells(addChoice({ id: `${classId}:spells:known`, kind: 'spell', count: row.values.spellsKnown, distinct: true }, origin), list.filter(s => s.level >= 1 && s.level <= max), `${label}известные заклинания`);
    if (sc.mode === 'spellbook') spellbook.push(...checkSpells(addChoice({ id: `${classId}:spells:spellbook`, kind: 'spell', count: sc.spellbook.initial + sc.spellbook.perLevel * (classLevel - 1), distinct: true }, origin), list.filter(s => s.level >= 1 && s.level <= max), `${label}книга заклинаний`));
    if (sc.mode === 'prepared' || sc.mode === 'spellbook') {
      const m = ports.abilityModifier(scores[sc.ability]);
      if (m === null) { missing.push({ code: 'prepared_limit', message: `${label}число подготовленных заклинаний зависит от ${ABILITY_RU[sc.ability]}.` }); continue; }
      const levelPart = sc.prepared === 'ability_plus_half_level' ? Math.floor(classLevel / 2) : classLevel;
      const pool = sc.mode === 'spellbook' ? list.filter(s => spellbook.includes(s.id)) : list.filter(s => s.level >= 1 && s.level <= max);
      checkSpells(addChoice({ id: `${classId}:spells:prepared`, kind: 'spell', count: Math.max(1, m + levelPart), distinct: true, optional: true }, origin), pool, `${label}подготовленные заклинания`);
    }
  }
  for (const c of choices.filter(x => x.dependsOnSpellbook)) {
    const f = c.spellFilter;
    checkSpells(c, cat.spells.entries.filter(s => spellbook.includes(s.id) && (f.level === undefined || s.level === f.level)), names(c.featureRef) || 'заклинания из книги');
  }

  // Starting equipment: first class and background packages only.
  const items = [], currency = {};
  const proficient = need => need.category === 'armor' ? held.armor.has(need.value)
    : held.weapon.has(need.value) || held.weapon.has(cat.equipmentById.get(`srd51:equipment:${need.value}`)?.weapon?.category);
  const matches = (filter, e) => e && Object.entries(filter).every(([k, v]) => k === 'exclude' ? !v.includes(e.id) : k === 'kind' ? e.kind === v : k === 'group' ? e.group === v : e.weapon?.[k] === v);
  for (const def of [startingClass, background].filter(Boolean)) {
    const se = def.startingEquipment, origin = { definitionId: def.id };
    const takeItem = (item, picks, choiceId) => {
      if (item.ref) { items.push({ ref: item.ref, quantity: item.quantity, origin }); return; }
      const p = picks || [];
      if (p.length !== item.quantity || p.some(id => !matches(item.filter, cat.equipmentById.get(id)))) { err('equipment_pick', `Выберите ${item.quantity} подходящих предмета.`, { choiceId }); return; }
      p.forEach(id => items.push({ ref: id, quantity: 1, origin }));
    };
    se.grants.forEach((g, i) => {
      if (g.kind === 'currency') currency[g.unit] = (currency[g.unit] || 0) + g.value;
      else if (g.filter) {
        const instance = addChoice({ id: `${g.id}:pick`, kind: 'equipment', count: 1, alternatives: [{ id: 'a', items: [g] }] }, origin);
        if (requireSelection(instance, 'предмет из стартового снаряжения')) takeItem(g, instance.selected.picks?.[0], instance.id);
      } else takeItem(g);
    });
    for (const c of se.choices) {
      const instance = addChoice(c, origin);
      instance.unavailable = c.alternatives.filter(a => a.requiresProficiency && !proficient(a.requiresProficiency)).map(a => ({ option: a.id, reason: 'нет владения' }));
      if (!requireSelection(instance, 'стартовое снаряжение')) continue;
      const alt = c.alternatives.find(a => a.id === instance.selected.alternative);
      if (!alt) { err('equipment_choice', 'Выберите один из вариантов снаряжения.', { choiceId: c.id }); continue; }
      if (alt.requiresProficiency && !proficient(alt.requiresProficiency)) { err('equipment_proficiency', 'Этот вариант доступен только при владении.', { choiceId: c.id }); continue; }
      alt.items.forEach((item, i) => takeItem(item, instance.selected.picks?.[i], c.id));
    }
  }

  // Derived inputs for the TASK-004 sheet; HP/AC/attack formulas stay with the sheet rules.
  const first = startingClass;
  const classes = [...state.classLevels].map(([classId, levels]) => ({ classId, levels, subclassId: subclassOf.get(classId)?.id ?? null, hitDie: defs.get(classId).class.hitDie }));
  const casterLevel = classes.reduce((n, c) => { const s = defs.get(c.classId).class.spellcasting; return n + (!s ? 0 : s.slots === 'full' ? c.levels : s.slots === 'half' ? Math.floor(c.levels / 2) : 0); }, 0);
  const slotCasters = classes.filter(c => ['full', 'half'].includes(defs.get(c.classId).class.spellcasting?.slots));
  const spellSlots = slotCasters.length === 0 ? null : slotCasters.length === 1
    ? defs.get(slotCasters[0].classId).progression[slotCasters[0].levels - 1].spellSlots
    : (casterLevel ? fullTable(defs.get('srd51:class:wizard'))[casterLevel - 1] : null); // SRD multiclass table = full caster table
  const pact = classes.find(c => defs.get(c.classId).class.spellcasting?.slots === 'pact');
  const derivedInputs = {
    abilityScores: { ...scores }, baseScores: base, abilityIncreases: increaseTrace,
    characterLevel: state.characterLevel, proficiencyBonus: first && state.characterLevel ? first.progression[state.characterLevel - 1].proficiencyBonus : null,
    classes, size: grants.find(g => g.kind === 'size')?.value ?? null, speed: grants.find(g => g.kind === 'speed')?.value ?? null,
    senses: grants.filter(g => g.kind === 'sense').map(g => ({ sense: g.sense, range: g.range })),
    resistances: [...new Set(grants.filter(g => g.kind === 'resistance').map(g => g.damageType))],
    proficiencies: { savingThrows: [...held.saving_throw], armor: [...held.armor], weapons: [...held.weapon], tools: [...held.tool.keys()], skills: [...held.skill.keys()],
      expertise: choices.filter(c => c.kind === 'expertise').flatMap(c => c.selected || []) },
    languages: [...held.language.keys()],
    features: grants.filter(g => g.kind === 'feature').map(g => ({ ref: g.ref, origin: g.origin })),
    spells: { granted: grants.filter(g => g.kind === 'spell').map(g => ({ ref: g.ref, alwaysPrepared: Boolean(g.alwaysPrepared), ability: g.ability ?? null, uses: g.uses ?? null, origin: g.origin })),
      selected: choices.filter(c => c.kind === 'spell').map(c => ({ choiceId: c.id, refs: Array.isArray(c.selected) ? c.selected : c.selected ? [c.selected] : [] })),
      expandedList: grants.filter(g => g.kind === 'spell_list_addition').map(g => g.ref), slots: spellSlots,
      pact: pact ? { slots: defs.get(pact.classId).progression[pact.levels - 1].values.pactSlots, slotLevel: defs.get(pact.classId).progression[pact.levels - 1].values.pactSlotLevel } : null },
    hitPointInputs: first ? { method: context.hpMethod, firstLevelHitDie: first.class.hitDie, hitDice: classes.map(c => ({ classId: c.classId, die: c.hitDie, count: c.levels })),
      perLevelBonus: grants.filter(g => g.kind === 'hit_points').map(g => ({ perClassLevel: g.perClassLevel ? defs.get(g.origin.definitionId)?.classId ?? null : null, perCharacterLevel: Boolean(g.perCharacterLevel), origin: g.origin })) } : null,
    equipment: { items, currency },
  };
  const status = errors.length ? 'invalid' : missing.length ? 'incomplete' : 'valid';
  return { status, choices, grants, derivedInputs, errors, warnings, missing,
    sourceTrace: [...grants.map(g => ({ id: g.id, origin: g.origin })), ...choices.map(c => ({ id: c.id, origin: c.origin }))] };
}

const PRESERVED = ['identity', 'baseScores', 'abilityMethod', 'rollReceipts', 'manualOverrides'];
const CHANGES = {
  setRace: (d, c) => { d.ancestry = { raceId: c.raceId, subraceId: null }; },
  setSubrace: (d, c) => { d.ancestry = { ...d.ancestry, subraceId: c.subraceId }; },
  setBackground: (d, c) => { d.background = { backgroundId: c.backgroundId }; },
  setLevelHistory: (d, c) => { d.levelHistory = c.levelHistory.map(e => ({ classId: e.classId })); },
  setAbilityMethod: (d, c) => { d.abilityMethod = c.method; },
  setBaseScores: (d, c) => { d.baseScores = { ...d.baseScores, ...c.scores }; },
  setRollReceipts: (d, c) => { d.rollReceipts = structuredClone(c.receipts); },
  setSelection: (d, c) => { if (c.value === undefined) delete d.selections[c.choiceId]; else d.selections[c.choiceId] = structuredClone(c.value); },
  setIdentity: (d, c) => { d.identity = { ...d.identity, ...c.identity }; },
  rebase: (d, c) => { d.policyRevision = c.policyRevision; d.rulesRevision = c.rulesRevision; },
};

/** Preview a change: which earlier decisions it would invalidate. Nothing is deleted until confirmBuildChange. */
export function proposeBuildChange(draft, change, context, catalogues, ports = DEFAULT_PORTS) {
  if (!CHANGES[change?.type]) throw new TypeError(`Неизвестное изменение: ${change?.type}`);
  const nextDraft = structuredClone(draft);
  CHANGES[change.type](nextDraft, change);
  const after = evaluateBuild(context, catalogues, nextDraft, ports);
  const live = new Map(after.choices.map(c => [c.id, c]));
  const badChoices = new Set(after.errors.filter(e => e.choiceId).map(e => e.choiceId));
  const invalidated = Object.entries(nextDraft.selections)
    .filter(([id]) => id !== change.choiceId && (!live.has(id) || badChoices.has(id)))
    .map(([choiceId, previousValue]) => ({ choiceId, previousValue, reason: live.has(choiceId) ? 'Выбор больше не подходит после изменения.' : 'Этот выбор больше не нужен после изменения.' }));
  return { change: structuredClone(change), nextDraft, invalidated, preservedInputs: PRESERVED.filter(k => JSON.stringify(nextDraft[k]) === JSON.stringify(draft[k])), evaluation: after };
}

/** Apply a previewed change; invalidated selections move to invalidationLog instead of disappearing. */
export function confirmBuildChange(proposal) {
  const draft = structuredClone(proposal.nextDraft);
  for (const item of proposal.invalidated) {
    delete draft.selections[item.choiceId];
    draft.invalidationLog.push({ change: proposal.change.type, ...structuredClone(item) });
  }
  return draft;
}

/** Port DTO for P4 (plan r1 D6). IDs come from the caller and are kept for retries; derived values are not trusted input. */
export function toCreationProposal(evaluation, draft, { operationId, characterId }) {
  if (evaluation.status !== 'valid') throw new Error('Сборка не завершена: исправьте ошибки и заполните выборы.');
  if (!operationId || !characterId) throw new TypeError('Нужны operationId и characterId, созданные до первой отправки.');
  return {
    operationId, characterId, campaignId: draft.campaignId, contextRevision: draft.policyRevision, rulesRevision: draft.rulesRevision,
    identity: { name: draft.identity.name, portrait: draft.identity.portrait ?? null },
    build: { ancestry: structuredClone(draft.ancestry), background: structuredClone(draft.background), levelHistory: structuredClone(draft.levelHistory), selections: structuredClone(draft.selections) },
    abilityInput: { method: draft.abilityMethod, scores: structuredClone(draft.baseScores) },
    rollReceipts: structuredClone(draft.rollReceipts), manualOverrides: structuredClone(draft.manualOverrides),
  };
}

const SPELL_MODE_RU = { known: 'известные', prepared: 'подготовленные', spellbook: 'книга заклинаний', pact: 'магия договора', innate: 'врождённые' };
const ARMOR_RU = { light: 'лёгкие', medium: 'средние', heavy: 'тяжёлые', shield: 'щиты' };
const WEAPON_RU = { simple: 'простое', martial: 'воинское' };
const RESOURCES = [['rages', 'Ярость', 'long'], ['kiPoints', 'Ки', 'short'], ['sorceryPoints', 'Очки чародейства', 'long']];

/**
 * Character.data for the agreed create command (#61 task186-p4-create-dto-answers-1), in the TASK-004 sheet
 * vocabulary. Instance IDs are stable per key: pass back the returned `ids` (kept with the draft) so a retry sends
 * the same payload. `makeId` is injected; HP comes from the sheet rules port `creationHitPoints` or stays null.
 * Not filled on purpose: ac, attacks, initBonus, profBonus (the sheet computes or keeps them manual).
 */
export function toCharacterData(evaluation, draft, catalogues, { ids = {}, makeId }, ports = DEFAULT_PORTS) {
  if (evaluation.status !== 'valid') throw new Error('Сборка не завершена: исправьте ошибки и заполните выборы.');
  if (typeof makeId !== 'function') throw new TypeError('Нужен генератор ID экземпляров.');
  const cat = indexCatalogues(catalogues), { defs, names } = cat, d = evaluation.derivedInputs;
  const used = { ...ids }, id = key => (used[key] ??= makeId(key));
  const ru = ref => cat.spellById.get(ref)?.name.ru || cat.spellById.get(ref)?.name.en || names(ref);
  const race = defs.get(draft.ancestry.raceId), subrace = draft.ancestry.subraceId ? defs.get(draft.ancestry.subraceId) : null;
  const background = defs.get(draft.background.backgroundId);
  const first = defs.get(d.classes[0].classId);
  const legacyId = def => def.aliases.find(a => /^[a-z-]+$/.test(a)) ?? null;
  const vocab = catalogues.options.vocabularies.languages, langName = l => vocab.standard[l] || vocab.exotic[l] || vocab.secret[l] || l;
  const ownerClass = definitionId => { const def = defs.get(definitionId); return def?.kind === 'subclass' ? def.classId : def?.kind === 'class' ? def.id : null; };

  const classes = d.classes.map(c => {
    const sub = c.subclassId ? defs.get(c.subclassId) : null;
    return { id: id(`class:${c.classId}`), name: names(c.classId), subclass: sub ? names(sub.id) : '', levels: c.levels, ref: c.classId, ...(sub ? { subclassRef: sub.id } : {}) };
  });
  const hitDicePools = d.classes.map(c => ({ id: id(`hitDice:${c.classId}`), name: `d${c.hitDie} · ${names(c.classId)}`, die: c.hitDie, total: c.levels, spent: 0 }));
  const slotPools = (d.spells.slots || []).map((max, i) => max ? { id: id(`slots:${i + 1}`), name: 'Ячейки заклинаний', circle: i + 1, kind: 'spellcasting', max, spent: 0, recovery: 'long' } : null).filter(Boolean);
  if (d.spells.pact) slotPools.push({ id: id('slots:pact'), name: 'Магия договора', circle: d.spells.pact.slotLevel, kind: 'pact', max: d.spells.pact.slots, spent: 0, recovery: 'short' });
  const resources = [];
  for (const c of d.classes) {
    const values = defs.get(c.classId).progression[c.levels - 1].values;
    // Unlimited rages (Barbarian 20) and unknown values are not turned into numbers.
    for (const [key, name, recovery] of RESOURCES) if (Number.isInteger(values[key])) resources.push({ id: id(`resource:${c.classId}:${key}`), name, max: values[key], spent: 0, recovery });
  }

  // Spells: one source per casting class and one for innate (race/subrace) magic.
  const sources = new Map(), knownSpells = new Map();
  const sourceFor = definitionId => {
    const classId = ownerClass(definitionId);
    if (classId) {
      const sc = defs.get(classId).class.spellcasting;
      if (!sources.has(classId)) sources.set(classId, { id: id(`spellSource:${classId}`), name: names(classId), ability: sc?.ability ?? null, kind: SPELL_MODE_RU[sc?.slots === 'pact' ? 'pact' : sc?.mode] ?? '', attackOverride: null, dcOverride: null });
      return sources.get(classId);
    }
    const key = `innate:${definitionId}`;
    if (!sources.has(key)) sources.set(key, { id: id(`spellSource:${key}`), name: names(definitionId), ability: null, kind: SPELL_MODE_RU.innate, attackOverride: null, dcOverride: null });
    return sources.get(key);
  };
  const addSpell = (ref, definitionId, prepared, ability, always = false) => {
    const source = sourceFor(definitionId);
    if (ability && !source.ability) source.ability = ability;
    const key = `spell:${source.id}:${ref}`, spell = cat.spellById.get(ref), prior = knownSpells.get(key);
    if (prior) { prior.prepared ||= prepared; if (always) prior.alwaysPrepared = true; return; }
    knownSpells.set(key, { id: id(`spell:${definitionId}:${ref}`), name: ru(ref), circle: spell?.level ?? null, sourceId: source.id, prepared, ritual: Boolean(spell?.ritual), description: null, ref, ...(always ? { alwaysPrepared: true } : {}) });
  };
  const preparedSel = new Set(d.spells.selected.filter(s => s.choiceId.endsWith(':spells:prepared')).flatMap(s => s.refs));
  for (const s of d.spells.selected) {
    const choice = evaluation.choices.find(c => c.id === s.choiceId), definitionId = choice.origin.definitionId;
    if (s.choiceId.endsWith(':spells:prepared') && defs.get(definitionId)?.class.spellcasting.mode === 'spellbook') continue; // marks spellbook entries
    const book = s.choiceId.endsWith(':spells:spellbook');
    if (choice.dependsOnSpellbook) continue; // Spell Mastery / Signature Spells pick spells already in the book
    s.refs.forEach(ref => addSpell(ref, definitionId, book ? preparedSel.has(ref) : true, choice.ability));
  }
  for (const g of d.spells.granted) addSpell(g.ref, g.origin.definitionId, true, g.ability, g.alwaysPrepared);

  // Features: one entry per feature ref, labelled by where it first came from.
  const featureEntries = new Map();
  for (const f of d.features) if (!featureEntries.has(f.ref)) {
    const o = f.origin, where = o.classLevel ? `${names(o.definitionId)}, ${o.classLevel}-й уровень` : names(o.definitionId);
    featureEntries.set(f.ref, { id: id(`feature:${f.ref}`), name: names(f.ref), source: where, description: null, ref: f.ref });
  }

  // Equipment: packs open into their contents; the same item from several lines is one stack.
  const stacks = new Map();
  const put = (ref, quantity, fromPack) => {
    const key = `${ref}|${fromPack ?? ''}`, e = cat.equipmentById.get(ref);
    if (stacks.has(key)) { stacks.get(key).quantity += quantity; return; }
    stacks.set(key, { id: id(`item:${key}`), name: e.name.ru || e.name.en, quantity, weight: e.weight ? e.weight.lb / (e.bundleSize || 1) : null, equipped: false, attuned: false, description: '', ref, ...(fromPack ? { fromPack } : {}) });
  };
  for (const item of d.equipment.items) {
    const e = cat.equipmentById.get(item.ref);
    if (e.kind === 'pack') for (let n = 0; n < item.quantity; n++) e.contents.forEach(c => put(c.ref, c.quantity, item.ref));
    else put(item.ref, item.quantity);
  }

  const p = d.proficiencies;
  const toolNames = p.tools.map(t => cat.equipmentById.get(`srd51:equipment:${t}`)?.name.en || t);
  const weaponNames = p.weapons.map(w => WEAPON_RU[w] || cat.equipmentById.get(`srd51:equipment:${w}`)?.name.en || w);
  const toolsText = [p.armor.length ? `Доспехи: ${p.armor.map(a => ARMOR_RU[a] || a).join(', ')}` : '', weaponNames.length ? `Оружие: ${weaponNames.join(', ')}` : '', toolNames.length ? `Инструменты: ${toolNames.join(', ')}` : ''].filter(Boolean).join('\n');
  const hpMax = typeof ports.creationHitPoints === 'function' ? ports.creationHitPoints({ ...d.hitPointInputs, constitution: d.abilityScores.con }) : null;

  const data = {
    name: draft.identity.name, profile: 'pc', alignment: draft.identity.alignment ?? '', notes: draft.identity.notes ?? '', portrait: draft.identity.portrait ?? null,
    level: d.characterLevel, classes,
    classId: legacyId(first), className: names(first.id), raceId: legacyId(race), raceName: names((subrace || race).id), background: names(background.id),
    stats: { ...d.abilityScores },
    proficiencies: { saves: Object.fromEntries(p.savingThrows.map(a => [a, 1])), skills: Object.fromEntries(p.skills.map(s => [s, p.expertise.includes(s) ? 2 : 1])), languages: d.languages.map(langName).join(', '), tools: toolsText },
    speed: d.speed, darkvision: d.senses.find(s => s.sense === 'darkvision')?.range ?? null,
    hp: Number.isInteger(hpMax) ? hpMax : null, hpMax: Number.isInteger(hpMax) ? hpMax : null, tempHp: 0,
    hitDicePools, slotPools, resources,
    spellSources: [...sources.values()], knownSpells: [...knownSpells.values()],
    featureEntries: [...featureEntries.values()],
    inventoryItems: [...stacks.values()], coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...d.equipment.currency },
    creation: { schemaVersion: 1, edition: '5e-2014', verified: 'client', rulesRevision: draft.rulesRevision, policyRevision: draft.policyRevision,
      ancestry: structuredClone(draft.ancestry), background: structuredClone(draft.background), levelHistory: structuredClone(draft.levelHistory),
      selections: structuredClone(draft.selections), abilityInput: { method: draft.abilityMethod, scores: structuredClone(draft.baseScores) },
      rollReceipts: structuredClone(draft.rollReceipts), manualOverrides: structuredClone(draft.manualOverrides) },
  };
  return { data, ids: used };
}
