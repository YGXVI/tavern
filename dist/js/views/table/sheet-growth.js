// Ограниченный предпросмотр роста Sidekick. Классовые таблицы не подменяются догадками.
import { abilityModifier, knownInteger, sheetProficiency } from './sheet-rules.js';

export function previewSidekickGrowth({ level, targetLevel, hpMax, constitution, hitDie, rolls, proficiencyLinks = [] }) {
  const errors = [], manual = [], changes = [];
  if (sheetProficiency(level) === null || sheetProficiency(targetLevel) === null || targetLevel <= level) errors.push('Нужен рост от текущего уровня к уровню не выше 20');
  if (knownInteger(hpMax) === null || hpMax < 0 || abilityModifier(constitution) === null) errors.push('Уточните максимум HP и Телосложение');
  if (![4, 6, 8, 10, 12, 20].includes(hitDie)) errors.push('Уточните кость базового статблока');
  if (!Array.isArray(rolls) || rolls.length !== targetLevel - level
    || rolls.some((r) => knownInteger(r) === null || r < 1 || r > hitDie)) errors.push('Нужен результат кости для каждого нового уровня');
  if (!Array.isArray(proficiencyLinks)) errors.push('Нужен список явных зависимостей от мастерства');
  if (errors.length) return { changes, manual, errors };
  const con = abilityModifier(constitution);
  const increase = rolls.reduce((sum, roll) => sum + Math.max(1, roll + con), 0);
  const nextHp = knownInteger(hpMax + increase);
  if (nextHp === null) return { changes: [], manual, errors: ['Прирост HP вне допустимого диапазона'] };
  const oldPb = sheetProficiency(level), newPb = sheetProficiency(targetLevel);
  changes.push({ field: 'level', from: level, to: targetLevel });
  changes.push({ field: 'hpMax', from: hpMax, to: nextHp });
  changes.push({ field: 'hitDice', added: targetLevel - level, die: hitDie });
  if (oldPb !== newPb) changes.push({ field: 'proficiency', from: oldPb, to: newPb });
  const seen = new Set();
  for (const link of proficiencyLinks) {
    if (typeof link?.id !== 'string' || !link.id || seen.has(link.id)) { errors.push('Зависимостям нужны уникальные ID'); continue; }
    seen.add(link.id);
    const multiplier = link.multiplier ?? 1;
    if (link.dependsOnProficiency !== true || knownInteger(link.value) === null || ![0.5, 1, 2].includes(multiplier)) {
      manual.push({ id: link.id, reason: 'Основание бонуса требует ручного уточнения' }); continue;
    }
    if (link.overridden === true) {
      manual.push({ id: link.id, reason: 'Ручное переопределение сохранено' }); continue;
    }
    const next = knownInteger(link.value + Math.floor(newPb * multiplier) - Math.floor(oldPb * multiplier));
    if (next === null) { errors.push('Бонус вне допустимого диапазона'); continue; }
    if (next !== link.value) changes.push({ field: 'proficiencyLink', id: link.id, from: link.value, to: next });
  }
  manual.push({ field: 'classChoices', reason: 'Уточните классовые способности и выборы новых уровней' });
  return { changes: errors.length ? [] : changes, manual, errors };
}

/** Подтверждение готового расчёта. Каждая операция хранит собственный пул прироста. */
export function applySidekickGrowthPreview(character, preview, { operationId, poolId }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId || '')
    || typeof poolId !== 'string' || !poolId) throw new TypeError('Нужны ID операции и пула');
  if (character?.profile !== 'sidekick' || !preview || !Array.isArray(preview.errors) || preview.errors.length || !Array.isArray(preview.changes)) throw new TypeError('Нужен подтверждаемый расчёт Sidekick');
  const level = preview.changes.find(c => c.field === 'level');
  const hp = preview.changes.find(c => c.field === 'hpMax');
  const dice = preview.changes.find(c => c.field === 'hitDice');
  if (!level || !hp || !dice || sheetProficiency(level.to)===null || knownInteger(hp.to)===null || hp.to<hp.from || level.from !== character.level || hp.from !== character.hpMax
    || !Number.isSafeInteger(dice.added) || dice.added < 1 || dice.added !== level.to - level.from
    || dice.die !== character.sidekick?.hitDie) throw new TypeError('Расчёт устарел: проверьте уровень, HP и кость');
  if (character.hitDicePools?.some(p => p.id === poolId || p.operationId === operationId)
    || character.sidekick?.growthHistory?.some(h => h.operationId === operationId || h.id === operationId)) throw new TypeError('Развитие с этим ID уже записано');
  const next = structuredClone(character);
  next.level = level.to; next.hpMax = hp.to;
  next.sidekick.baseLevel ??= character.level;
  next.sidekick.baseSnapshot ??= structuredClone(character.statblock?.baseSnapshot || { stats: character.stats, hpMax: character.hpMax });
  next.hitDicePools ??= [];
  next.hitDicePools.push({ id: poolId, name: `Прирост Sidekick ${level.from} → ${level.to}`, source: 'sidekick-growth',
    operationId, die: dice.die, total: dice.added, spent: 0 });
  next.sidekick.growthHistory ??= [];
  next.sidekick.growthHistory.push({ id: operationId, operationId, kind: 'growth', from: level.from, to: level.to,
    hpFrom: hp.from, hpTo: hp.to, note: 'Классовые выборы и неописанные зависимости вручную' });
  return next;
}

/** Только начальные условия согласованного варианта Sidekick; не проверка всей D&D-сборки. */
export function sidekickEligibility(character) {
  const sidekick = character?.sidekick || {}, block = character?.statblock || {};
  const base = Object.hasOwn(block.baseSnapshot || {}, 'cr') ? block.baseSnapshot
    : Object.hasOwn(sidekick.baseSnapshot || {}, 'cr') ? sidekick.baseSnapshot : block;
  const raw = base.cr;
  let cr = null;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) cr = raw;
  else if (typeof raw === 'string') {
    const value = raw.trim(), fractions = { '1/8': 0.125, '1/4': 0.25, '1/2': 0.5 };
    if (Object.hasOwn(fractions, value)) cr = fractions[value];
    else if (/^\d+$/.test(value) && Number.isSafeInteger(Number(value))) cr = Number(value);
  }
  const supportedClass = ['warrior', 'expert', 'spellcaster'].includes(sidekick.class);
  const checks = [
    { id: 'class', state: supportedClass ? 'pass' : 'unknown', message: supportedClass ? 'Класс Sidekick выбран' : 'Выберите класс Sidekick' },
    { id: 'cr', state: cr === null ? 'unknown' : cr <= 0.5 ? 'pass' : 'fail',
      message: cr === null ? 'CR основы неизвестен: уточните его вручную' : cr <= 0.5 ? 'CR основы не выше 1/2' : 'CR основы выше 1/2' },
  ];
  if (['expert', 'spellcaster'].includes(sidekick.class)) {
    const speaks = sidekick.canSpeakLanguage;
    checks.push({ id: 'speech', state: speaks === true ? 'pass' : speaks === false ? 'fail' : 'unknown',
      message: speaks === true ? 'Говоримый язык подтверждён' : speaks === false ? 'Говоримого языка нет' : 'Подтвердите говоримый язык: текст языков сам это не доказывает' });
  }
  const eligible = checks.every(c => c.state === 'pass');
  const hasException = typeof sidekick.eligibilityNote === 'string' && sidekick.eligibilityNote.trim().length > 0;
  return { checks, eligible, hasException, canProceed: supportedClass && (eligible || hasException) };
}
