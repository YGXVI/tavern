// Поля редактора и безопасная запись вложенного ввода. Текст правил ничего не исполняет.
import { parseSheetNumber, totalClassLevel, sheetProficiency, checkBonus, abilityModifier, resolveSheetValue } from './sheet-rules.js';
export const copy = (v) => structuredClone(v);
export const fieldValue = (o, path) => path.split('.').reduce((v, k) => v?.[k], o);
export function setField(o, path, value) {
  const keys = path.split('.');
  if (!keys.length || keys.some((k) => !k || ['__proto__', 'constructor', 'prototype'].includes(k))) throw new TypeError('Недопустимое поле');
  let at = o;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!at[key] || typeof at[key] !== 'object') at[key] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    at = at[key];
  }
  at[keys.at(-1)] = copy(value);
}
export function parseField(input, type = 'text', range = {}) {
  if (type === 'number' || type === 'decimal') return parseSheetNumber(input, { ...range, integer: type !== 'decimal' });
  if (type === 'boolean') return { valid: true, value: !!input };
  return { valid: true, value: String(input) };
}
export function sheetLevel(ch) { return Array.isArray(ch.classes) && ch.classes.length ? totalClassLevel(ch.classes) : ch.level ?? null; }
export function proficiencyValue(ch) { const o=ch.overrides?.proficiency;return resolveSheetValue(sheetProficiency(sheetLevel(ch)),o?.value==null?null:o); }
export function sheetBonus(ch, group, id, ability) {
  const multiplier = ch.proficiencies?.[group]?.[id] ?? (ch[group]?.includes(id) ? 1 : 0);
  return checkBonus({ score: ch.stats?.[ability], proficiency: proficiencyValue(ch).value, multiplier: Number(multiplier), override: ch.overrides?.[group]?.[id]?.value == null ? null : ch.overrides[group][id] });
}
export function sheetInitiative(ch) { const calc=abilityModifier(ch.stats?.dex);if(Object.hasOwn(ch.overrides||{},'initiative')){const o=ch.overrides.initiative;return resolveSheetValue(calc,o?.value==null?null:o).value;}return ch.initBonus??calc; }
export function prepareSheetDerived(ch){const next=copy(ch);if(next.initBonus==null&&!Object.hasOwn(next.overrides||{},'initiative')){next.overrides??={};next.overrides.initiative=null;}next.initBonus=sheetInitiative(next);next.profBonus=proficiencyValue(next).value;return next;}
export function validateDraft(ch) {
  const errors = [];
  if (!ch.name?.trim()) errors.push('Укажите имя');
  const level = sheetLevel(ch);
  if(ch.classes?.length&&level===null)errors.push('Укажите положительное число уровней каждого класса');
  if (level !== null && (!Number.isSafeInteger(level) || level < 1 || level > 20)) errors.push('Общий уровень должен быть от 1 до 20');
  if (Number.isFinite(ch.hp) && Number.isFinite(ch.hpMax) && ch.hp > ch.hpMax) errors.push('Текущие HP больше максимума');
  for (const field of ['resources', 'slotPools', 'hitDicePools']) {
    const entries = ch[field] || [], ids = new Set();
    for (const p of entries) {
      const max = p[field === 'hitDicePools' ? 'total' : 'max'];
      if (!p.id || ids.has(p.id)) errors.push(`Повтор ID в ${field}`); ids.add(p.id);
      if (p.spent !== null && p.spent !== undefined && max !== null && max !== undefined && p.spent > max) errors.push(`Расход больше максимума: ${p.name || p.id}`);
    }
  }
  for (const field of ['classes', 'attacks', 'actions', 'bonusActions', 'reactions', 'spellSources', 'knownSpells', 'inventoryItems', 'featureEntries']) {
    const entries = ch[field] || [], ids = entries.map((v) => v.id).filter(Boolean);
    if (new Set(ids).size !== ids.length) errors.push(`Повтор ID в ${field}`);
  }
  return errors;
}

export function attackBonus(ch,attack) {
  if(attack.bonus!==null&&attack.bonus!==undefined)return Number.isSafeInteger(attack.bonus)?attack.bonus:null;
  return checkBonus({score:ch.stats?.[attack.ability],proficiency:proficiencyValue(ch).value,multiplier:attack.proficient?1:0}).value;
}
