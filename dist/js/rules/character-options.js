// TASK-186 P1: public character_option envelope (Definition/Grant/Choice). Pure validation only:
// no DOM/store/network/RNG/eval. Unknown kinds, operators or refs are errors, never "valid".
import { jsonErrors } from './catalogue.js';

export const DEFINITION_KINDS = Object.freeze(['class', 'subclass', 'race', 'subrace', 'background', 'feat']);
export const GRANT_KINDS = Object.freeze(['feature', 'proficiency', 'language', 'ability_increase', 'size', 'speed', 'sense', 'resistance', 'hit_points', 'spell', 'spell_list_addition']);
export const CHOICE_KINDS = Object.freeze(['skill', 'tool', 'language', 'expertise', 'feature_option', 'subclass', 'subrace', 'asi_or_feat', 'spell', 'ability_increase', 'favored_enemy', 'terrain']);
export const PREDICATE_OPERATORS = Object.freeze(['all', 'any', 'not', 'classLevel', 'characterLevel', 'abilityMinimum', 'hasFeature', 'hasSpell', 'sourceEnabled', 'unique']);
export const ABILITIES = Object.freeze(['str', 'dex', 'con', 'int', 'wis', 'cha']);
export const PROFICIENCY_CATEGORIES = Object.freeze(['armor', 'weapon', 'tool', 'skill', 'saving_throw']);
export const CHARACTER_OPTION_ID = /^srd51:(class|subclass|race|subrace|background|feat):[a-z0-9-]+(?::[a-z0-9-]+)?$/;
const FEATURE_ID = /^srd51:feature:[a-z0-9:-]+$/;
const SPELL_ID = /^dndsu:spell:\d+$/;
const SLUG = /^[a-z0-9_-]+$/;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isLevel = value => Number.isInteger(value) && value >= 1 && value <= 20;

export function predicateErrors(value, path = 'prerequisites', errors = []) {
  if (!isObject(value)) { errors.push({ path, message: 'Условие должно быть объектом.' }); return errors; }
  const keys = Object.keys(value);
  if (keys.length !== 1 || !PREDICATE_OPERATORS.includes(keys[0])) { errors.push({ path, message: `Неизвестный оператор условия: ${keys.join(',') || 'пусто'}.` }); return errors; }
  const [op] = keys, arg = value[op];
  if (op === 'all' || op === 'any') {
    if (!Array.isArray(arg) || !arg.length) errors.push({ path: `${path}.${op}`, message: 'Нужен непустой список условий.' });
    else arg.forEach((item, i) => predicateErrors(item, `${path}.${op}[${i}]`, errors));
  } else if (op === 'not') predicateErrors(arg, `${path}.not`, errors);
  else if (op === 'classLevel') { if (!isObject(arg) || !CHARACTER_OPTION_ID.test(arg.class || '') || !isLevel(arg.min)) errors.push({ path, message: 'classLevel требует class и min 1–20.' }); }
  else if (op === 'characterLevel') { if (!isObject(arg) || !isLevel(arg.min)) errors.push({ path, message: 'characterLevel требует min 1–20.' }); }
  else if (op === 'abilityMinimum') { if (!isObject(arg) || !ABILITIES.includes(arg.ability) || !Number.isInteger(arg.min) || arg.min < 1 || arg.min > 30) errors.push({ path, message: 'abilityMinimum требует ability и min.' }); }
  else if (op === 'hasFeature') { if (!FEATURE_ID.test(arg || '')) errors.push({ path, message: 'hasFeature требует ID способности.' }); }
  else if (op === 'hasSpell') { if (!SPELL_ID.test(arg || '')) errors.push({ path, message: 'hasSpell требует ID заклинания.' }); }
  else if (op === 'sourceEnabled') { if (typeof arg !== 'string' || !/^(rule|source):[a-z0-9-]+$/.test(arg)) errors.push({ path, message: 'sourceEnabled требует rule:<id> или source:<id>.' }); }
  else if (op === 'unique' && arg !== true) errors.push({ path, message: 'unique допускает только true.' });
  return errors;
}

function grantErrors(grant, path, errors) {
  if (!isObject(grant) || typeof grant.id !== 'string' || !grant.id) { errors.push({ path, message: 'Выдаче нужен устойчивый id.' }); return; }
  if (!GRANT_KINDS.includes(grant.kind)) { errors.push({ path: `${path}.kind`, message: `Неизвестный вид выдачи: ${grant.kind}.` }); return; }
  const need = (ok, message) => { if (!ok) errors.push({ path, message }); };
  if (grant.kind === 'feature') need(FEATURE_ID.test(grant.ref || ''), 'feature требует ref способности.');
  if (grant.kind === 'proficiency') need(PROFICIENCY_CATEGORIES.includes(grant.category) && typeof grant.value === 'string' && grant.value, 'proficiency требует category и value.');
  if (grant.kind === 'language') need(SLUG.test(grant.value || ''), 'language требует value.');
  if (grant.kind === 'ability_increase') need(ABILITIES.includes(grant.ability) && Number.isInteger(grant.value) && grant.value > 0 && (grant.maximum === undefined || Number.isInteger(grant.maximum)), 'ability_increase требует ability и value.');
  if (grant.kind === 'size') need(['small', 'medium'].includes(grant.value), 'size требует small/medium.');
  if (grant.kind === 'speed') need(grant.mode === 'walk' && Number.isInteger(grant.value) && grant.value > 0, 'speed требует mode=walk и value.');
  if (grant.kind === 'sense') need(grant.sense === 'darkvision' && Number.isInteger(grant.range) && grant.range > 0, 'sense требует darkvision и range.');
  if (grant.kind === 'resistance') need(SLUG.test(grant.damageType || ''), 'resistance требует damageType.');
  if (grant.kind === 'hit_points') need((grant.perClassLevel === 1) !== (grant.perCharacterLevel === 1), 'hit_points требует perClassLevel или perCharacterLevel.');
  if (grant.kind === 'spell' || grant.kind === 'spell_list_addition') need(SPELL_ID.test(grant.ref || ''), `${grant.kind} требует ref заклинания.`);
  if (grant.prerequisites !== undefined) predicateErrors(grant.prerequisites, `${path}.prerequisites`, errors);
}

function choiceErrors(choice, path, errors) {
  if (!isObject(choice) || typeof choice.id !== 'string' || !choice.id) { errors.push({ path, message: 'Выбору нужен устойчивый id.' }); return; }
  if (!CHOICE_KINDS.includes(choice.kind)) errors.push({ path: `${path}.kind`, message: `Неизвестный вид выбора: ${choice.kind}.` });
  if (!Number.isInteger(choice.count) || choice.count < 1) errors.push({ path: `${path}.count`, message: 'count — целое число ≥1.' });
  const hasOptions = Array.isArray(choice.options) && choice.options.length > 0;
  const hasFilter = typeof choice.from === 'string' || isObject(choice.spellFilter);
  if (hasOptions === hasFilter) errors.push({ path, message: 'Нужен ровно один источник вариантов: options либо from/spellFilter.' });
  if (hasOptions && new Set(choice.options).size !== choice.options.length) errors.push({ path: `${path}.options`, message: 'Повторяющиеся варианты.' });
  if (hasOptions && choice.count > choice.options.length) errors.push({ path: `${path}.count`, message: 'Вариантов меньше, чем нужно выбрать.' });
  if (choice.featureRef !== undefined && !FEATURE_ID.test(choice.featureRef)) errors.push({ path: `${path}.featureRef`, message: 'featureRef должен быть ID способности.' });
  if (choice.prerequisites !== undefined) predicateErrors(choice.prerequisites, `${path}.prerequisites`, errors);
  if (!['none', 'one_per_level'].includes(choice.replacementPolicy ?? 'none')) errors.push({ path: `${path}.replacementPolicy`, message: 'Неизвестная политика замены.' });
}

/** Validates one definition. Cross-catalogue refs are checked by resolveCharacterOptionRefs. */
export function validateCharacterOption(value) {
  const errors = jsonErrors(value);
  if (errors.length) return { valid: false, errors };
  if (!isObject(value)) return { valid: false, errors: [{ path: '', message: 'Нужен объект.' }] };
  if (!DEFINITION_KINDS.includes(value.kind)) errors.push({ path: 'kind', message: `Неизвестный вид определения: ${value.kind}.` });
  if (!CHARACTER_OPTION_ID.test(value.id || '') || !String(value.id).startsWith(`srd51:${value.kind}:`)) errors.push({ path: 'id', message: 'ID должен быть srd51:<kind>:<slug>.' });
  if (!isObject(value.name) || typeof value.name.en !== 'string' || !value.name.en) errors.push({ path: 'name', message: 'Нужно английское имя источника.' });
  if (!isObject(value.source) || value.source.kind !== 'srd51' || !/^[a-f0-9]{64}$/.test(value.source.sha256 || '') || !Array.isArray(value.source.pages) || !value.source.pages.length) errors.push({ path: 'source', message: 'Нужен источник SRD5.1 с hash и страницами.' });
  if (!isObject(value.review) || typeof value.review.required !== 'boolean' || !Array.isArray(value.review.reasons)) errors.push({ path: 'review', message: 'Нужен review {required,reasons}.' });
  for (const field of ['featureRefs', 'grants', 'choices', 'aliases']) if (!Array.isArray(value[field])) errors.push({ path: field, message: 'Нужен массив.' });
  (value.featureRefs || []).forEach((ref, i) => { if (!FEATURE_ID.test(ref)) errors.push({ path: `featureRefs[${i}]`, message: 'Некорректный ID способности.' }); });
  (value.grants || []).forEach((g, i) => grantErrors(g, `grants[${i}]`, errors));
  (value.choices || []).forEach((c, i) => choiceErrors(c, `choices[${i}]`, errors));
  if (value.prerequisites !== undefined) predicateErrors(value.prerequisites, 'prerequisites', errors);
  if (value.kind === 'subclass' && (!CHARACTER_OPTION_ID.test(value.classId || '') || !isLevel(value.selectionLevel))) errors.push({ path: 'classId', message: 'Подклассу нужны classId и selectionLevel.' });
  if (value.kind === 'subrace' && !CHARACTER_OPTION_ID.test(value.raceId || '')) errors.push({ path: 'raceId', message: 'Подрасе нужен raceId.' });
  if (value.kind === 'class' || value.kind === 'subclass') {
    const rows = value.progression;
    if (!Array.isArray(rows) || rows.length !== 20) errors.push({ path: 'progression', message: 'Нужно ровно 20 строк уровней.' });
    else rows.forEach((row, i) => {
      const path = `progression[${i}]`;
      if (!isObject(row) || row.level !== i + 1) { errors.push({ path, message: 'Уровни идут 1…20 без пропусков.' }); return; }
      if (value.kind === 'class' && (!Number.isInteger(row.proficiencyBonus) || row.proficiencyBonus < 2 || row.proficiencyBonus > 6)) errors.push({ path: `${path}.proficiencyBonus`, message: 'Бонус мастерства 2–6.' });
      for (const field of ['grants', 'choices']) if (!Array.isArray(row[field])) errors.push({ path: `${path}.${field}`, message: 'Нужен массив.' });
      (row.grants || []).forEach((g, j) => grantErrors(g, `${path}.grants[${j}]`, errors));
      (row.choices || []).forEach((c, j) => choiceErrors(c, `${path}.choices[${j}]`, errors));
      if (row.spellSlots !== undefined && row.spellSlots !== null && (!Array.isArray(row.spellSlots) || row.spellSlots.length !== 9 || row.spellSlots.some(n => !Number.isInteger(n) || n < 0))) errors.push({ path: `${path}.spellSlots`, message: 'spellSlots — 9 целых чисел ≥0 или null.' });
    });
  }
  const ids = new Set();
  const walk = list => (list || []).forEach(item => { if (item?.id) { if (ids.has(item.id)) errors.push({ path: item.id, message: 'Повторяющийся ID выдачи/выбора.' }); ids.add(item.id); } });
  walk(value.grants); walk(value.choices);
  (value.progression || []).forEach(row => { walk(row?.grants); walk(row?.choices); });
  return { valid: errors.length === 0, errors };
}

/** Cross-catalogue check: every feature/spell/definition ref resolves; returns unresolved refs (empty = OK). */
export function resolveCharacterOptionRefs(options, { featureIds, spellIds }) {
  const definitions = new Set(options.entries.map(e => e.id)), missing = [];
  const check = (ref, kind, at) => {
    const known = kind === 'feature' ? featureIds.has(ref) : kind === 'spell' ? spellIds.has(ref) : definitions.has(ref);
    if (!known) missing.push({ at, kind, ref });
  };
  const visitPredicate = (p, at) => {
    if (!isObject(p)) return;
    const [op] = Object.keys(p), arg = p[op];
    if (op === 'all' || op === 'any') arg.forEach(x => visitPredicate(x, at));
    else if (op === 'not') visitPredicate(arg, at);
    else if (op === 'classLevel') check(arg.class, 'definition', at);
    else if (op === 'hasFeature') check(arg, 'feature', at);
    else if (op === 'hasSpell') check(arg, 'spell', at);
  };
  const visitGrant = (g, at) => {
    if (g.kind === 'feature') check(g.ref, 'feature', at);
    if (g.kind === 'spell' || g.kind === 'spell_list_addition') check(g.ref, 'spell', at);
    if (g.prerequisites) visitPredicate(g.prerequisites, at);
  };
  const visitChoice = (c, at) => {
    if (c.featureRef) check(c.featureRef, 'feature', at);
    if (c.kind === 'feature_option') (c.options || []).forEach(ref => check(ref, 'feature', at));
    if (c.kind === 'subclass' || c.kind === 'subrace') (c.options || []).forEach(ref => check(ref, 'definition', at));
    if (c.prerequisites) visitPredicate(c.prerequisites, at);
  };
  for (const e of options.entries) {
    e.featureRefs.forEach(ref => check(ref, 'feature', e.id));
    e.grants.forEach(g => visitGrant(g, e.id)); e.choices.forEach(c => visitChoice(c, e.id));
    (e.progression || []).forEach(row => { row.grants.forEach(g => visitGrant(g, `${e.id}@${row.level}`)); row.choices.forEach(c => visitChoice(c, `${e.id}@${row.level}`)); });
    if (e.prerequisites) visitPredicate(e.prerequisites, e.id);
    for (const field of ['classId', 'raceId']) if (e[field]) check(e[field], 'definition', e.id);
  }
  return missing;
}
