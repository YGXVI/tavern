// TASK-186 / #202: «что поднимать этому герою» — один вызов для окна повышения уровня (вид — sol0139).
// Чистая функция без DOM, хранилища и случайности: строит план из неизменяемого блока creation героя
// и движка конструктора. Запись результата — отдельная команда листа (growth), не здесь.
import { createDraft, evaluateBuild, defaultCreationContext, DEFAULT_PORTS } from './character-builder.js';
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
  if (!base) return { supported: false, reason: 'Герой создан без конструктора: уровень повышают вручную на листе.' };
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
    choices, features, errors, warnings: evaluation.warnings, evaluation, nextDraft,
  };
}
