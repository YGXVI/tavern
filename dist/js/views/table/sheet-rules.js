// Чистые расчёты листа D&D 5e 2014 (TASK-004). Нет записи, случайных бросков и исполнения текста.
export const knownInteger = (value) => Number.isSafeInteger(value) ? value : null;

/** Пустой ввод остаётся неизвестным; Number('') и неявное приведение здесь запрещены. */
export function parseSheetNumber(input, { nullable = true, min = -Infinity, max = Infinity } = {}) {
  if (typeof input !== 'string' && typeof input !== 'number') return { valid: false, error: 'Нужно число' };
  const text = String(input).trim().replace(/^−/, '-');
  if (!text) return nullable ? { valid: true, value: null } : { valid: false, error: 'Введите число' };
  if (!/^[+-]?\d+$/.test(text)) return { valid: false, error: 'Нужно целое число' };
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < min || value > max) return { valid: false, error: 'Число вне допустимого диапазона' };
  return { valid: true, value };
}

export function abilityModifier(score) {
  return knownInteger(score) === null || knownInteger(score - 10) === null ? null : Math.floor((score - 10) / 2);
}

export function totalClassLevel(classes) {
  if (!Array.isArray(classes) || !classes.length) return null;
  if (classes.some((c) => !c || knownInteger(c.levels) === null || c.levels < 1)) return null;
  return knownInteger(classes.reduce((sum, c) => sum + c.levels, 0));
}

export function sheetProficiency(level) {
  return knownInteger(level) !== null && level >= 1 && level <= 20 ? 2 + Math.floor((level - 1) / 4) : null;
}

/** Отдельно возвращаем расчёт и override: нулевое переопределение также действительно. */
export function resolveSheetValue(calculated, override = null) {
  const overridden = override !== null && override !== undefined;
  return {
    value: overridden ? knownInteger(override?.value) : knownInteger(calculated),
    calculated: knownInteger(calculated),
    overridden,
    reason: overridden && typeof override?.reason === 'string' ? override.reason : '',
  };
}

export function checkBonus({ score, proficiency, multiplier = 0, adjustments = [], override = null }) {
  const modifier = abilityModifier(score);
  const validMultiplier = [0, 0.5, 1, 2].includes(multiplier);
  const trained = validMultiplier && multiplier === 0 ? 0
    : validMultiplier && knownInteger(proficiency) !== null ? knownInteger(Math.floor(proficiency * multiplier)) : null;
  const validAdjustments = Array.isArray(adjustments) && adjustments.every((v) => knownInteger(v) !== null);
  const adjustment = validAdjustments ? knownInteger(adjustments.reduce((sum, v) => sum + v, 0)) : null;
  const calculated = modifier !== null && trained !== null && adjustment !== null ? knownInteger(modifier + trained + adjustment) : null;
  return { ...resolveSheetValue(calculated, override), components: { modifier, proficiency: trained, adjustment } };
}

export function passiveCheck(bonus, override = null) {
  return resolveSheetValue(knownInteger(bonus) === null ? null : knownInteger(10 + bonus), override);
}

export function spellNumbers({ score, proficiency, adjustments = [], attackOverride = null, dcOverride = null }) {
  const attack = checkBonus({ score, proficiency, multiplier: 1, adjustments });
  return {
    attack: resolveSheetValue(attack.calculated, attackOverride),
    dc: resolveSheetValue(attack.calculated === null ? null : knownInteger(8 + attack.calculated), dcOverride),
  };
}

/** Caller передаёт доступных героев; выбранные ID не дополняются по владельцу или токенам. */
export function partyLevelHint(characters, selectedIds) {
  if (!Array.isArray(characters) || !Array.isArray(selectedIds)) throw new TypeError('Нужны списки героев и выбранных ID');
  const selected = [...new Set(selectedIds)];
  const levels = [], missingIds = [], invalidIds = [];
  for (const id of selected) {
    const matches = characters.filter((c) => c?.id === id);
    if (!matches.length) { missingIds.push(id); continue; }
    const c = matches[0];
    const level = Array.isArray(c.classes) ? totalClassLevel(c.classes) : knownInteger(c.level);
    if (matches.length !== 1 || level === null || level < 1 || (c.profile && c.profile !== 'pc')) invalidIds.push(id);
    else levels.push({ id, level });
  }
  const total = knownInteger(levels.reduce((sum, c) => sum + c.level, 0));
  return {
    average: selected.length && !missingIds.length && !invalidIds.length && total !== null ? total / selected.length : null,
    levels, missingIds, invalidIds,
  };
}
