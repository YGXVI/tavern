// TASK-186 P1b: public SRD 5.1 equipment projection (plan r1 task 2.5). Pure validation only.
// Costs keep the source unit plus an exact copper value; weights keep pounds; unknown stays null.
import { jsonErrors } from './catalogue.js';

export const EQUIPMENT_KINDS = Object.freeze(['weapon', 'armor', 'shield', 'ammunition', 'focus', 'gear', 'tool', 'pack']);
export const WEAPON_PROPERTIES = Object.freeze(['ammunition', 'finesse', 'heavy', 'light', 'loading', 'reach', 'special', 'thrown', 'two-handed', 'versatile']);
export const EQUIPMENT_ID = /^srd51:equipment:[a-z0-9-]+$/;
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const CP = { cp: 1, sp: 10, gp: 100 };

export function validateEquipmentEntry(value) {
  const errors = jsonErrors(value);
  if (errors.length) return { valid: false, errors };
  const add = (path, message) => errors.push({ path, message });
  if (!isObject(value)) return { valid: false, errors: [{ path: '', message: 'Нужен объект.' }] };
  if (!EQUIPMENT_ID.test(value.id || '')) add('id', 'ID должен быть srd51:equipment:<slug>.');
  if (!EQUIPMENT_KINDS.includes(value.kind)) add('kind', `Неизвестный вид снаряжения: ${value.kind}.`);
  if (!isObject(value.name) || typeof value.name.en !== 'string' || !value.name.en || (value.name.ru !== null && typeof value.name.ru !== 'string')) add('name', 'Нужно имя en (ru — строка или null).');
  if (value.cost !== null && (!isObject(value.cost) || !Number.isInteger(value.cost.value) || !CP[value.cost.unit] || value.cost.cp !== value.cost.value * CP[value.cost.unit])) add('cost', 'Цена {value,unit,cp} с точной конверсией либо null.');
  if (value.weight !== null && (!isObject(value.weight) || !(typeof value.weight.lb === 'number' && value.weight.lb >= 0))) add('weight', 'Вес {lb} либо null.');
  if (!isObject(value.source) || value.source.kind !== 'srd51' || !/^[a-f0-9]{64}$/.test(value.source.sha256 || '') || !Array.isArray(value.source.pages) || !value.source.pages.length) add('source', 'Нужен источник SRD5.1 со страницами.');
  if (value.kind === 'weapon') {
    const w = value.weapon;
    if (!isObject(w) || !['simple', 'martial'].includes(w.category) || !['melee', 'ranged'].includes(w.range)) add('weapon', 'Оружию нужны category и range.');
    else {
      if (w.damage !== null && (!isObject(w.damage) || !/^(\d+d\d+|\d+)$/.test(w.damage.dice) || typeof w.damage.type !== 'string')) add('weapon.damage', 'Урон {dice,type} либо null.');
      if (!Array.isArray(w.properties) || w.properties.some(p => !WEAPON_PROPERTIES.includes(p))) add('weapon.properties', 'Неизвестное свойство оружия.');
      const ranged = w.properties?.includes('ammunition') || w.properties?.includes('thrown');
      if (ranged !== (Number.isInteger(w.normalRange) && Number.isInteger(w.longRange))) add('weapon.range', 'Дальность задаётся только у ammunition/thrown.');
      if (w.properties?.includes('versatile') !== /^\d+d\d+$/.test(w.versatileDice || '')) add('weapon.versatileDice', 'versatile требует кость.');
    }
  }
  if (value.kind === 'armor' || value.kind === 'shield') {
    const a = value.armor;
    if (!isObject(a) || !['light', 'medium', 'heavy', 'shield'].includes(a.category) || !Number.isInteger(a.baseAc) || typeof a.addDex !== 'boolean'
      || !(a.dexMax === null || Number.isInteger(a.dexMax)) || !(a.strength === null || Number.isInteger(a.strength)) || typeof a.stealthDisadvantage !== 'boolean') add('armor', 'Доспеху нужны category/baseAc/addDex/dexMax/strength/stealthDisadvantage.');
    else if ((value.kind === 'shield') !== (a.category === 'shield')) add('armor.category', 'Щит — отдельная категория.');
  }
  if (value.kind === 'pack' && (!Array.isArray(value.contents) || !value.contents.length || value.contents.some(c => !EQUIPMENT_ID.test(c.ref || '') || !Number.isInteger(c.quantity) || c.quantity < 1))) add('contents', 'Набор содержит {ref,quantity}.');
  return { valid: errors.length === 0, errors };
}
