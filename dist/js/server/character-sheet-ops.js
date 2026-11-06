// Независимые преобразования редактирования листа: dirty fields, delta ресурсов, сверка базы.
import { makeSheetCommand, SheetCommandError } from './character-sheet.js';

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
export function sameSheetValue(a, b) {
  if (a === b || (a == null && b == null)) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameSheetValue(v, b[i]));
  if (object(a) && object(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((k) => sameSheetValue(a[k], b[k]));
  }
  return false;
}

export function sheetChanges(before, after, path = []) {
  if (sameSheetValue(before, after)) return [];
  if (object(before) && object(after)) return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .flatMap((key) => sheetChanges(before[key], after[key], [...path, key]));
  return [{ path, before: structuredClone(before ?? null), after: structuredClone(after ?? null) }];
}

export const sheetPath = (o, path) => path.reduce((v, key) => v?.[key], o);
export function putSheetPath(o, path, value) {
  if (!path.length || path.some((p) => forbidden.has(p))) throw new TypeError('Недопустимое поле');
  let cursor = o;
  for (const key of path.slice(0, -1)) {
    if (!object(cursor[key])) Object.defineProperty(cursor, key, { value: {}, enumerable: true, configurable: true, writable: true });
    cursor = cursor[key];
  }
  Object.defineProperty(cursor, path.at(-1), { value: structuredClone(value), enumerable: true, configurable: true, writable: true });
  return o;
}

function countDeltas(field, before, after) {
  if (field === 'slots') {
    if (!object(before) || !object(after) || !sameSheetValue(Object.keys(before).sort(), Object.keys(after).sort())) return null;
    const result = [];
    for (const id of Object.keys(before)) {
      const a = before[id], b = after[id];
      if (!object(a) || !object(b)) return null;
      const { used: av, ...ap } = a, { used: bv, ...bp } = b;
      if (!sameSheetValue(ap, bp) || !Number.isSafeInteger(av) || !Number.isSafeInteger(bv)) return null;
      if (av !== bv) result.push({ field, id, delta: bv - av });
    }
    return result;
  }
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) return null;
  const result = [], seen = new Set();
  for (const a of before) {
    if (typeof a?.id !== 'string' || seen.has(a.id)) return null;
    seen.add(a.id);
    const found = after.filter((b) => b?.id === a.id);
    if (found.length !== 1) return null;
    const { spent: av, ...ap } = a, { spent: bv, ...bp } = found[0];
    if (!sameSheetValue(ap, bp) || !Number.isSafeInteger(av) || !Number.isSafeInteger(bv)) return null;
    if (av !== bv) result.push({ field, id: a.id, delta: bv - av });
  }
  // Смена порядка записей — явная правка списка, а не только расход.
  if (!sameSheetValue(before.map((v) => v.id), after.map((v) => v.id))) return null;
  return result;
}

/** Ресурсы идут delta, остальные dirty fields — patch; неизменённое не отправляется. */
export function characterEditPayload(before, after) {
  const patch = {}, current = {}, adjust = {}, counters = [];
  const roots = new Set(sheetChanges(before, after).map((c) => c.path[0]));
  for (const key of roots) {
    if (['hp', 'tempHp'].includes(key)) {
      if (Number.isSafeInteger(before[key]) && Number.isSafeInteger(after[key]) && (key !== 'hp' || Number.isSafeInteger(before.hpMax))) adjust[key === 'hp' ? 'currentHp' : 'tempHp'] = after[key] - before[key];
      else current[key] = after[key] ?? null;
    } else if (['conditions', 'deathSaves', 'concentration'].includes(key)) current[key] = structuredClone(after[key] ?? null);
    else if (['slots', 'slotPools', 'resources', 'hitDicePools'].includes(key)) {
      const deltas = countDeltas(key, before[key], after[key]);
      if (deltas === null) patch[key] = structuredClone(after[key] ?? null); else counters.push(...deltas);
    } else {
      for (const change of sheetChanges(before[key], after[key], [key])) putSheetPath(patch, change.path, change.after);
    }
  }
  if (counters.length) adjust.counters = counters;
  return { ...(Object.keys(patch).length ? { patch } : {}), ...(Object.keys(current).length ? { current } : {}), ...(Object.keys(adjust).length ? { adjust } : {}) };
}

function preconditions(before, after, server) {
  const conflicts = sheetChanges(before, after).filter((c) => !sameSheetValue(c.before, sheetPath(server, c.path)) && !sameSheetValue(c.after, sheetPath(server, c.path)));
  if (before.hp !== after.hp) for (const field of ['hp', 'hpMax', 'tempHp']) {
    if (!sameSheetValue(before[field], server[field]) && !conflicts.some((c) => c.path[0] === field)) conflicts.push({ path: [field], before: before[field], after: after[field] });
  }
  return conflicts;
}

/** Оптимистическая операция store → команда от последнего подтверждённого снимка. */
export function commandFromCharacterChange(operation, confirmed, operationId) {
  const before = operation.prev, after = operation.row;
  if (!before || !after || before.id !== confirmed?.id || before.campaign_id !== confirmed.campaign_id) throw new TypeError('Нет базы изменения листа');
  const conflicts = preconditions(before.data, after.data, confirmed.data);
  if (before.owner_id !== after.owner_id && before.owner_id !== confirmed.owner_id) conflicts.push({ path: ['ownerId'] });
  if (conflicts.length) throw new SheetCommandError('conflict', { details: { fields: conflicts.map((c) => c.path.join('.')) } });
  // Уже совпавшие с сервером dirty fields не применяются повторной delta.
  const local = structuredClone(confirmed.data);
  for (const change of sheetChanges(before.data, after.data)) putSheetPath(local, change.path, change.after);
  const payload = characterEditPayload(confirmed.data, local);
  if (before.owner_id !== after.owner_id) {
    payload.ownerId = after.owner_id;
    if (operation.membershipChanges?.length) payload.membership = operation.membershipChanges;
  }
  return makeSheetCommand({ campaignId: after.campaign_id, characterId: after.id, version: String(confirmed.sheet_version), kind: 'edit', payload, ...(operationId ? { operationId } : {}) });
}

/** Трёхсторонняя сверка. Конфликты сохраняют локальное и серверное значения для выбора человека. */
export function rebaseCharacterDraft(base, local, remote) {
  const data = structuredClone(remote), conflicts = [];
  for (const change of sheetChanges(base, local)) {
    const server = sheetPath(remote, change.path);
    if (!sameSheetValue(change.before, server) && !sameSheetValue(change.after, server)) conflicts.push({ ...change, remote: structuredClone(server ?? null) });
    putSheetPath(data, change.path, change.after);
  }
  return { data, conflicts };
}
