// TASK-186 / #202: «что поднимать этому герою» — один вызов для окна повышения уровня (вид — sol0139).
// Чистая функция без DOM, хранилища и случайности: строит план из неизменяемого блока creation героя
// и движка конструктора. Запись результата — отдельная команда листа (growth), не здесь.
import { createDraft, evaluateBuild, defaultCreationContext, toCharacterData, DEFAULT_PORTS } from './character-builder.js';
import { creationHitPoints } from '../views/table/sheet-rules.js';

const HP_PORT = { creationHitPoints };

/** Черновик конструктора из data.creation (форма — toCharacterData); null — герой создан не конструктором. */
export function draftFromCreation(creation, { campaignId = null } = {}) {
  if (!creation || creation.schemaVersion !== 1 || creation.edition !== '5e-2014' || !Array.isArray(creation.levelHistory)) return null;
  const context = { ...defaultCreationContext({ campaignId, policyRevision: creation.policyRevision ?? 'default-v1' }) };
  const draft = createDraft({ draftId: 'level-up', accountScope: 'level-up', mode: 'level-up', context, rulesRevision: creation.rulesRevision });
  return Object.assign(draft, {
    ancestry: structuredClone(creation.ancestry), background: structuredClone(creation.background),
    levelHistory: creation.levelHistory.map(e => ({ classId: e.classId })), selections: structuredClone(creation.selections || {}),
    abilityMethod: creation.abilityInput?.method, baseScores: structuredClone(creation.abilityInput?.scores || {}),
    rollReceipts: structuredClone(creation.rollReceipts || []), manualOverrides: structuredClone(creation.manualOverrides || []),
  });
}

const hpOf = (ev, ports) => {
  const h = ev.derivedInputs?.hitPointInputs;
  return h ? ports.creationHitPoints({ ...h, constitution: ev.derivedInputs.abilityScores?.con }) : null;
};

/**
 * План повышения героя на один уровень класса classId.
 * policy — политика кампании (как у создания: мультикласс и черты — по решению мастера); без неё — умолчания.
 * Возвращает { supported, reason?, fromLevel, toLevel, classId, classLevel, hitDie, hp, choices[], features[], errors[], warnings[],
 *   evaluation, nextDraft }. choices — решения нового уровня, которые нужно принять (как в окне создания: id, kind, count,
 *   варианты); features — способности, которые герой получает автоматически. Выбранное игроком применяется к nextDraft
 *   через proposeBuildChange/confirmBuildChange, итог — toCharacterData и команда листа.
 */
export function levelUpPlan(character, classId, catalogues, { policy = null, ports = {} } = {}) {
  const p = { ...DEFAULT_PORTS, ...HP_PORT, ...ports };
  const creation = character?.creation;
  const base = draftFromCreation(creation, { campaignId: character?.campaignId ?? null });
  if (!base) return simplePlan(character, classId, catalogues, policy, p);
  const fromLevel = base.levelHistory.length;
  if (fromLevel < 1 || fromLevel >= 20) return { supported: false, reason: fromLevel >= 20 ? 'Достигнут 20-й уровень.' : 'В истории уровней нет записей.' };
  const def = catalogues.options.entries.find(e => e.id === classId && e.kind === 'class');
  if (!def) return { supported: false, reason: 'Нет такого класса в справочнике.' };

  const known = new Set(base.levelHistory.map(e => e.classId));
  const contextFor = level => ({
    ...defaultCreationContext({ campaignId: base.campaignId, policyRevision: base.policyRevision }), ...(policy ? structuredClone(policy) : {}),
    startLevel: level, allowedAbilityMethods: [base.abilityMethod],
  });
  const before = evaluateBuild(contextFor(fromLevel), catalogues, base, p);
  const nextDraft = structuredClone(base);
  nextDraft.levelHistory.push({ classId });
  const context = contextFor(fromLevel + 1);
  const evaluation = evaluateBuild(context, catalogues, nextDraft, p);
  const toLevel = fromLevel + 1;

  // Недобор по выбору (например, «в книге нужно 8, выбрано 6») движок отдаёт ошибкой с choiceId — его закрывает
  // сам выбор, поэтому это пункт плана с пояснением, а не блокирующая ошибка.
  const need = new Map();
  for (const m of [...evaluation.missing, ...evaluation.errors]) if (m.choiceId && !need.has(m.choiceId)) need.set(m.choiceId, m.message);
  const errors = evaluation.errors.filter(e => !e.choiceId);
  if (!known.has(classId) && !context.optionalRules?.multiclass) errors.unshift({ code: 'multiclass_disabled', message: 'Мультикласс в этой кампании выключен — мастер может включить его в политике.' });
  const choices = evaluation.choices
    .filter(c => need.has(c.id) || (c.origin?.characterLevel === toLevel && nextDraft.selections[c.id] === undefined && !c.optional))
    .map(c => ({ ...c, need: need.get(c.id) ?? null }));
  const features = evaluation.grants.filter(g => g.kind === 'feature' && g.origin?.characterLevel === toLevel).map(g => ({ ref: g.ref, origin: g.origin }));
  const hpBefore = hpOf(before, p), hpAfter = hpOf(evaluation, p);
  const classLevel = nextDraft.levelHistory.filter(e => e.classId === classId).length;

  return {
    supported: true, fromLevel, toLevel, classId, classLevel, hitDie: def.class.hitDie,
    // Средние хиты при текущей Телосложении; прибавка Телосложения на этом уровне пересчитывает их (план — для показа).
    hp: { gain: hpBefore !== null && hpAfter !== null ? hpAfter - hpBefore : null, maxAfter: hpAfter, method: context.hpMethod },
    choices, features, errors, warnings: evaluation.warnings, evaluation, nextDraft, context,
  };
}

/** Классы старого листа: classes[] с ref или прежние classId/level. null — не понять. */
function legacyClasses(ch) {
  if (Array.isArray(ch?.classes) && ch.classes.length) return ch.classes.every(c => typeof c?.ref === 'string' && Number.isInteger(c.levels)) ? ch.classes : null;
  return typeof ch?.classId === 'string' && Number.isInteger(ch.level) ? [{ ref: `srd51:class:${ch.classId}`, name: ch.className ?? null, levels: ch.level }] : null;
}

/**
 * Простое повышение героя без конструктора (#202): уровень, класс и кость хитов; выборы уровня — вручную на листе.
 * Сервер принимает только level/classes/hitDicePools и сам прибавляет среднее кости + модификатор Телосложения.
 */
function simplePlan(character, classId, catalogues, policy, ports) {
  if (character?.profile && character.profile !== 'pc') return { supported: false, reason: 'Повышение — только для героя.' };
  const classes = legacyClasses(character);
  if (!classes) return { supported: false, reason: 'На листе не указаны класс и уровень — повысьте уровень вручную.' };
  const fromLevel = classes.reduce((n, c) => n + c.levels, 0);
  if (fromLevel >= 20) return { supported: false, reason: 'Достигнут 20-й уровень.' };
  const def = catalogues.options.entries.find(e => e.id === classId && e.kind === 'class');
  if (!def) return { supported: false, reason: 'Нет такого класса в справочнике.' };
  const known = classes.some(c => c.ref === classId);
  const context = { ...defaultCreationContext(), ...(policy ? structuredClone(policy) : {}) };
  const errors = [];
  if (!known && !context.optionalRules?.multiclass) errors.push({ code: 'multiclass_disabled', message: 'Мультикласс в этой кампании выключен — мастер может включить его в политике.' });
  const m = ports.abilityModifier(character?.stats?.con);
  if (m === null) errors.push({ code: 'constitution', message: 'Укажите Телосложение на листе: от него зависят хиты.' });
  const die = def.class.hitDie;
  return {
    supported: true, mode: 'simple', fromLevel, toLevel: fromLevel + 1, classId, hitDie: die,
    classLevel: (classes.find(c => c.ref === classId)?.levels ?? 0) + 1,
    hp: { gain: m === null ? null : die / 2 + 1 + m, maxAfter: m === null || !Number.isFinite(character.hpMax) ? null : character.hpMax + die / 2 + 1 + m, method: 'fixed_average' },
    choices: [], features: [], errors, warnings: [], className: def.name,
    note: 'Герой создан без конструктора: черты, заклинания и прибавки характеристик этого уровня внесите на листе вручную.',
  };
}

/** Поля сборки, которые меняет повышение (тот же список проверяет сервер, level_up_character). */
export const GROWTH_FIELDS = Object.freeze(['level', 'classes', 'classId', 'className', 'stats', 'proficiencies', 'speed', 'darkvision',
  'hitDicePools', 'slotPools', 'resources', 'spellSources', 'knownSpells', 'featureEntries']);
// Записи списков сопоставляются со старыми, чтобы сохранить их ID и потраченное: кость хитов — по кости,
// ячейки — по виду и кругу, остальное — по ссылке на справочник или имени.
const MATCH = {
  hitDicePools: e => `d${e.die}`, slotPools: e => `${e.kind}:${e.circle}`,
  resources: e => e.ref ?? e.name, spellSources: e => e.ref ?? e.name, knownSpells: e => `${e.sourceId ?? ''}:${e.ref ?? e.name}`, featureEntries: e => e.ref ?? e.name,
};
function keepIdentity(field, next, prev) {
  const key = MATCH[field];
  if (!key || !Array.isArray(next) || !Array.isArray(prev)) return next;
  const old = new Map(prev.filter(Boolean).map(e => [key(e), e]));
  return next.map(e => {
    const o = old.get(key(e));
    if (!o) return e;
    const kept = { ...e, id: o.id ?? e.id };
    if (Number.isInteger(o.spent)) kept.spent = Math.min(o.spent, e.max ?? e.total ?? o.spent);
    return kept;
  });
}

/**
 * Тело команды level_up_character из плана, в котором окно приняло все выборы (plan.nextDraft после confirmBuildChange).
 * Хиты не передаются — их прибавляет сервер. Бросает ошибку, если сборка ещё не полная.
 */
export function levelUpPayload(character, plan, catalogues, { makeId, ports = {} } = {}) {
  if (!plan?.supported) throw new TypeError(plan?.reason || 'Нет плана повышения');
  if (plan.mode === 'simple') return simplePayload(character, plan, makeId, catalogues);
  const p = { ...DEFAULT_PORTS, ...HP_PORT, ...ports };
  const ev = evaluateBuild(plan.context, catalogues, plan.nextDraft, p);
  if (ev.status !== 'valid') {
    const first = [...ev.errors, ...ev.missing][0];
    throw Object.assign(new Error(first?.message || 'Сборка не завершена'), { evaluation: ev });
  }
  const { data } = toCharacterData(ev, plan.nextDraft, catalogues, { makeId }, p);
  const patch = {};
  const sourceIds = new Map(); // новый ID источника магии → сохранённый прежний: на него ссылаются заклинания
  for (const f of GROWTH_FIELDS) {
    if (!(f in data)) continue;
    let next = data[f];
    if (f === 'knownSpells' && Array.isArray(next)) next = next.map(e => (sourceIds.has(e.sourceId) ? { ...e, sourceId: sourceIds.get(e.sourceId) } : e));
    const value = keepIdentity(f, next, character[f]);
    if (f === 'spellSources' && Array.isArray(value)) value.forEach((e, i) => sourceIds.set(data[f][i].id, e.id));
    if (JSON.stringify(value) !== JSON.stringify(character[f])) patch[f] = value;
  }
  return { creation: data.creation, patch };
}

/** Тело простого повышения: +1 уровень классу (или новый класс), кость хитов — к пулу этой кости. */
function simplePayload(character, plan, makeId, catalogues) {
  if (plan.errors.length) throw new Error(plan.errors[0].message);
  const dieOf = ref => catalogues.options.entries.find(e => e.id === ref && e.kind === 'class')?.class.hitDie ?? null;
  const before = legacyClasses(character);
  const classes = structuredClone(before);
  const grown = classes.find(c => c.ref === plan.classId);
  if (grown) grown.levels += 1;
  else classes.push({ id: makeId(), name: plan.className ?? plan.classId, subclass: '', levels: 1, ref: plan.classId });
  const level = classes.reduce((n, c) => n + c.levels, 0);
  let pools = Array.isArray(character.hitDicePools) ? structuredClone(character.hitDicePools) : null;
  if (!pools) {
    // У старого листа пулов нет: по пулу на кость прежних классов, потраченное неизвестно — 0.
    pools = [];
    for (const c of before) {
      const die = dieOf(c.ref);
      if (!die) throw new Error(`Неизвестная кость хитов класса ${c.ref}`);
      const same = pools.find(x => x.die === die);
      if (same) same.total += c.levels; else pools.push({ id: makeId(), name: `d${die}`, die, total: c.levels, spent: 0 });
    }
  }
  const pool = pools.find(x => x.die === plan.hitDie);
  if (pool) pool.total += 1; else pools.push({ id: makeId(), name: `d${plan.hitDie}`, die: plan.hitDie, total: 1, spent: 0 });
  return { patch: { level, classes, hitDicePools: pools } };
}
