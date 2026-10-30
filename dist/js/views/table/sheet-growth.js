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
