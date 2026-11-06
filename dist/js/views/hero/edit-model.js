// Правка героя (#203, 06.11 — sol0139: «я загрузил/создал, а редактировать больше не могу»). Чистые функции без DOM:
// черновик — копия данных листа; правки экрана (edit.js) — операции над черновиком; «Сохранить» — только изменённые
// верхние поля листа (сервер принимает их командой edit, «Мои герои» и песочница — как есть).
import { ABILITIES, SKILLS, CLASSES, RACES } from '../../data/rules.js';
import { readCharacter } from '../table/sheet-model.js';
import { sameSheetValue } from '../../server/character-sheet-ops.js';
import { wornItems, gearOf } from './gear.js';

const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const META = ['id', 'ownerId', 'updatedAt', 'archivedAt'];
const newId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
const abMod = (score) => Math.floor((Number(score) - 10) / 2);

/** Поля листа, которые сервер принимает командой edit (supabase/migrations/…_character_edits.sql, allowed). */
export const SERVER_EDITABLE = new Set(['name', 'portrait', 'profile', 'classId', 'className', 'raceId', 'raceName', 'level', 'classes', 'background', 'alignment', 'stats', 'saves', 'skills',
  'ac', 'hp', 'hpMax', 'tempHp', 'speed', 'darkvision', 'hitDice', 'hitDicePools', 'deathSaves', 'conditions', 'attacks', 'actions', 'bonusActions', 'reactions', 'slots', 'slotPools',
  'spells', 'spellSources', 'knownSpells', 'inventory', 'inventoryItems', 'features', 'featureEntries', 'resources', 'notes', 'initBonus', 'profBonus', 'light', 'aura',
  'sidekick', 'overrides', 'proficiencies', 'coins', 'movement', 'defenses', 'concentration', 'statblock']);

/** Разделы экрана правки и поля листа, которые они меняют (подпись «что изменено»). */
export const EDIT_SECTIONS = [
  { id: 'who', name: 'Кто это', icon: 'user', keys: ['name', 'raceName', 'raceId', 'background', 'alignment', 'classes', 'className', 'classId', 'level', 'hitDicePools'] },
  { id: 'stats', name: 'Характеристики', icon: 'dice-faces-06', keys: ['stats'] },
  { id: 'skills', name: 'Навыки', icon: 'target-02', keys: ['proficiencies.saves', 'proficiencies.skills', 'saves', 'skills'] },
  { id: 'combat', name: 'Бой', icon: 'shield-01', keys: ['hpMax', 'hp', 'ac', 'initBonus', 'overrides', 'speed', 'darkvision'] },
  { id: 'attacks', name: 'Атаки', icon: 'sword-01', keys: ['attacks'] },
  { id: 'magic', name: 'Магия', icon: 'sparkles', keys: ['spellSources', 'slotPools'] },
  { id: 'bag', name: 'Сумка', icon: 'backpack-01', keys: ['inventoryItems', 'coins'] },
  { id: 'features', name: 'Умения', icon: 'star', keys: ['featureEntries'] },
  { id: 'profs', name: 'Владения', icon: 'brain-02', keys: ['proficiencies.languages', 'proficiencies.tools', 'proficiencies.weapons'] },
  { id: 'person', name: 'Личность', icon: 'note-edit', keys: ['personality', 'notes'] },
];

/** Начать правку: база (как было) и черновик — копии данных листа без служебных полей. */
export function startEdit(ch) {
  const d = clone(ch || {});
  for (const k of META) delete d[k];
  return { base: clone(d), draft: d };
}

// ——— чтение черновика ———
export const profLevel = (d, kind, id) => {
  const p = d.proficiencies?.[kind]?.[id];
  if (p !== undefined && p !== null) return Number(p) || 0;
  return Array.isArray(d[kind]) && d[kind].includes(id) ? 1 : 0;
};
/** Инициатива вручную: переопределение в overrides или старое число листа, не равное Ловкости. */
export function initManual(d) {
  const o = d.overrides || {};
  if (Object.hasOwn(o, 'initiative')) return o.initiative !== null && o.initiative !== undefined;
  return Number.isFinite(d.initBonus) && d.initBonus !== abMod(d.stats?.dex ?? 10);
}
export const acManual = (d) => Number.isFinite(d.ac);
/** Классы черновика списком (у старого листа — из className/level). */
export function classList(d) {
  if (Array.isArray(d.classes) && d.classes.length) return d.classes;
  if (!d.className && !d.classId) return [];
  const base = CLASSES.find((c) => c.id === d.classId || c.name === d.className);
  return [{ id: 'legacy-class', name: d.className || base?.name || '', subclass: '', levels: Number(d.level) || 1, ...(base ? { ref: `srd51:class:${base.id}` } : {}) }];
}
/** Сумка списком (у старого листа — разбор строки, монеты отдельно). */
export function itemList(d) {
  if (Array.isArray(d.inventoryItems)) return d.inventoryItems;
  if (Array.isArray(d.inventory)) return d.inventory;
  return String(d.inventory || '').split(/[,\n]+/).map((x) => x.trim().replace(/\.$/, '')).filter(Boolean)
    .filter((x) => !/^\d+\s*(зм|см|мм|пм|эм)$/i.test(x)).map((name, i) => ({ id: `legacy-item-${i}`, name: name[0].toUpperCase() + name.slice(1), quantity: 1 }));
}
export function featureList(d) {
  if (Array.isArray(d.featureEntries)) return d.featureEntries;
  if (Array.isArray(d.features)) return d.features;
  return d.features ? [{ id: 'legacy-features', name: 'Умения', source: 'с листа', description: String(d.features) }] : [];
}
/** Пулы ячеек черновика (у старого листа — из старого объекта slots, как читает лист). */
export const slotList = (d) => (Array.isArray(d.slotPools) ? d.slotPools : readCharacter(d).slotPools || []);

// ——— запись в черновик ———
const LISTS = { attacks: () => [], inventoryItems: itemList, featureEntries: featureList };
function own(d, list) {
  if (list === 'attacks') { if (!Array.isArray(d.attacks)) d.attacks = []; return d.attacks; }
  if (list === 'slotPools') { if (!Array.isArray(d.slotPools)) d.slotPools = clone(slotList(d)); return d.slotPools; }
  if (list === 'classes') { if (!Array.isArray(d.classes) || !d.classes.length) d.classes = clone(classList(d)).map((c) => ({ ...c, id: c.id === 'legacy-class' ? newId() : c.id })); return d.classes; }
  if (!Array.isArray(d[list])) {
    // Старый лист: сумка и умения строкой — при первой правке становятся списком (строку не трогаем, список главнее).
    d[list] = clone(LISTS[list](d)).map((x) => ({ ...x, id: /^legacy-/.test(x.id || '') || !x.id ? newId() : x.id }));
    if (list === 'inventoryItems' && !Object.values(d.coins || {}).some((v) => v > 0)) {
      const COIN = { зм: 'gp', см: 'sp', мм: 'cp', пм: 'pp', эм: 'ep' }, coins = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
      for (const x of String(typeof d.inventory === 'string' ? d.inventory : '').split(/[,\n]+/)) { const m = /^\s*(\d+)\s*(зм|см|мм|пм|эм)\s*\.?$/i.exec(x); if (m) coins[COIN[m[2].toLowerCase()]] += Number(m[1]); }
      if (Object.values(coins).some((v) => v > 0)) d.coins = coins;
    }
  }
  return d[list];
}
function put(o, path, value) {
  const keys = path.split('.');
  if (keys.some((k) => ['__proto__', 'prototype', 'constructor'].includes(k))) return;
  let cur = o;
  for (const k of keys.slice(0, -1)) { if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {}; cur = cur[k]; }
  if (value === undefined) delete cur[keys.at(-1)]; else cur[keys.at(-1)] = value;
}
const int = (v, lo, hi) => { if (v === '' || v === null || v === undefined) return null; const n = Math.round(Number(String(v).replace(',', '.').replace('−', '-'))); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
const dec = (v, lo = 0) => { if (v === '' || v === null || v === undefined) return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? Math.max(lo, n) : null; };
// Числовые поля: путь → границы. Остальное — текст.
const NUMBERS = { hpMax: [1, 999], speed: [0, 300], darkvision: [0, 300], ac: [0, 40] };
const syncInit = (d) => { if (!initManual(d)) { d.overrides = { ...(d.overrides || {}), initiative: null }; d.initBonus = abMod(d.stats?.dex ?? 10); } };

/**
 * Правка черновика. op — имя операции экрана, p — её поля. Возвращает подсказку для экрана или null.
 * ctx.gear — снаряжение SRD (надетое по умолчанию у героя из конструктора).
 */
export function editOp(d, op, p = {}, ctx = {}) {
  switch (op) {
    case 'set': {
      const path = String(p.path || '');
      if (!path) return null;
      if (/^stats\.(str|dex|con|int|wis|cha)$/.test(path)) {
        const v = int(p.value, 1, 30);
        if (v === null) return null;
        put(d, path, v);
        if (path === 'stats.dex') syncInit(d);
        return null;
      }
      if (/^coins\.(cp|sp|ep|gp|pp)$/.test(path)) { d.coins = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...(d.coins || {}) }; put(d, path, int(p.value, 0, 9999999) ?? 0); return null; }
      if (NUMBERS[path]) {
        const v = path === 'speed' || path === 'darkvision' ? dec(p.value) : int(p.value, ...NUMBERS[path]);
        if (path === 'hpMax' && v === null) return null;
        put(d, path, path === 'darkvision' && !v ? null : v);
        return null;
      }
      if (path === 'name' || path === 'background' || path === 'alignment' || path === 'notes' || /^personality\.\w+$/.test(path) || /^proficiencies\.(languages|tools|weapons)$/.test(path)) { put(d, path, String(p.value ?? '')); return null; }
      if (path === 'raceName') {
        const v = String(p.value ?? '').trim(), r = RACES.find((x) => x.name.toLowerCase() === v.toLowerCase());
        d.raceName = String(p.value ?? '');
        if (r) d.raceId = r.id; else delete d.raceId;
        return null;
      }
      return null;
    }
    case 'step': { // −/+ у характеристики
      const id = String(p.id), cur = Number(d.stats?.[id] ?? 10);
      return editOp(d, 'set', { path: `stats.${id}`, value: cur + Number(p.by || 0) }, ctx);
    }
    case 'prof': { // спасбросок: нет ↔ владение; навык: нет → владение → компетентность → нет
      const kind = p.kind === 'saves' ? 'saves' : 'skills', ids = kind === 'saves' ? ABILITIES.map((a) => a.id) : SKILLS.map((s) => s.id);
      if (!ids.includes(p.id)) return null;
      const now = profLevel(d, kind, p.id), next = kind === 'saves' ? (now >= 1 ? 0 : 1) : now >= 2 ? 0 : now >= 1 ? 2 : 1;
      const map = {};
      for (const id of ids) { const v = id === p.id ? next : profLevel(d, kind, id); if (v) map[id] = v; }
      d.proficiencies = { ...(d.proficiencies || {}), [kind]: map };
      if (Array.isArray(d[kind])) d[kind] = ids.filter((id) => map[id] >= 1);
      return null;
    }
    case 'class': {
      const list = own(d, 'classes'), c = list[Number(p.i)];
      if (!c) return null;
      if (p.field === 'name') {
        const v = String(p.value ?? ''), base = CLASSES.find((x) => x.id === v || x.name.toLowerCase() === v.trim().toLowerCase());
        c.name = base ? base.name : v;
        if (base) c.ref = `srd51:class:${base.id}`; else delete c.ref;
      } else if (p.field === 'levels') c.levels = int(p.value, 1, 20) ?? c.levels ?? 1;
      else if (p.field === 'subclass') c.subclass = String(p.value ?? '');
      return null;
    }
    case 'addClass': {
      const list = own(d, 'classes'), taken = new Set(list.map((c) => c.ref));
      const base = CLASSES.find((x) => !taken.has(`srd51:class:${x.id}`)) || CLASSES[0];
      list.push({ id: newId(), name: base.name, subclass: '', levels: 1, ref: `srd51:class:${base.id}` });
      return null;
    }
    case 'dropClass': { const list = own(d, 'classes'); if (list.length > 1) list.splice(Number(p.i), 1); return null; }
    case 'acMode': {
      if (p.manual) d.ac = int(p.value, 0, 40) ?? 10; else d.ac = null;
      return null;
    }
    case 'initMode': {
      if (p.manual) { const v = int(p.value, -20, 30) ?? abMod(d.stats?.dex ?? 10); d.overrides = { ...(d.overrides || {}), initiative: { value: v } }; d.initBonus = v; }
      else { d.overrides = { ...(d.overrides || {}), initiative: null }; d.initBonus = abMod(d.stats?.dex ?? 10); }
      return null;
    }
    case 'initValue': {
      const v = int(p.value, -20, 30);
      if (v === null) return null;
      d.overrides = { ...(d.overrides || {}), initiative: { value: v } }; d.initBonus = v;
      return null;
    }
    case 'add': {
      const list = own(d, p.list);
      if (p.list === 'attacks') list.push({ id: newId(), name: '', ability: 'str', proficient: true, bonus: null, damage: '', type: '', note: '' });
      else if (p.list === 'inventoryItems') list.push({ id: newId(), name: '', quantity: 1, weight: null, equipped: false, attuned: false, description: '' });
      else if (p.list === 'featureEntries') list.push({ id: newId(), name: '', source: '', description: '' });
      else return null;
      return null;
    }
    case 'drop': { const list = own(d, p.list); const i = list.findIndex((x) => x.id === p.id); if (i >= 0) list.splice(i, 1); return null; }
    case 'item': { // поле строки списка: { list, id, field, value }
      if (!['attacks', 'inventoryItems', 'featureEntries'].includes(p.list)) return null;
      const x = own(d, p.list).find((y) => y.id === p.id);
      if (!x) return null;
      const f = String(p.field);
      if (['quantity'].includes(f)) x[f] = int(p.value, 0, 99999) ?? 0;
      else if (f === 'weight') x.weight = dec(p.value);
      else if (f === 'bonus') x.bonus = int(p.value, -30, 30);
      else if (f === 'proficient' || f === 'attuned') x[f] = !!p.value;
      else if (f === 'ability') x.ability = ['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(p.value) ? p.value : '';
      else if (['name', 'damage', 'type', 'note', 'description', 'source'].includes(f)) {
        x[f] = String(p.value ?? '');
        // Переименованный предмет снаряжения больше не тот предмет справочника: имя — как написано.
        if (p.list === 'inventoryItems' && f === 'name') delete x.ref;
        if (p.list === 'featureEntries' && f === 'description') delete x.ref;
      }
      return null;
    }
    case 'equip': { // надеть/снять: стартовый комплект, показанный надетым, сначала записывается как есть
      const list = own(d, 'inventoryItems');
      if (!list.some((x) => x.equipped)) {
        const worn = wornItems(list, ctx.gear || null);
        list.forEach((x, i) => { if (worn[i]?.auto) x.equipped = true; });
      }
      const x = list.find((y) => y.id === p.id);
      if (x) x.equipped = !x.equipped;
      return null;
    }
    case 'slots': { // ячейки круга (кроме магии договора): сколько всего
      const circle = int(p.circle, 1, 9), max = int(p.value, 0, 9) ?? 0;
      if (!circle) return null;
      const list = own(d, 'slotPools'), i = list.findIndex((x) => x.circle === circle && x.kind !== 'pact');
      if (i >= 0 && !max) list.splice(i, 1);
      else if (i >= 0) { list[i].max = max; list[i].spent = Math.min(Number(list[i].spent) || 0, max); }
      else if (max) list.push({ id: newId(), name: `Ячейки ${circle} круга`, circle, kind: 'spellcasting', max, spent: 0, recovery: 'long' });
      list.sort((a, b) => (a.kind === 'pact') - (b.kind === 'pact') || a.circle - b.circle);
      return null;
    }
    case 'srcAbility': {
      const s = (d.spellSources || [])[Number(p.i)];
      if (s && ['int', 'wis', 'cha'].includes(p.value)) s.ability = p.value;
      return null;
    }
    default: return null;
  }
}

/**
 * Итог правки: изменённые поля листа. Заодно — то, что следует из правки: уровень и кости хитов из классов, хиты не
 * выше максимума. server — лист кампании на сервере: поля, которых сервер не хранит (черты характера), уходят в dropped.
 */
export function finishEdit(base, draft, { server = false } = {}) {
  const d = clone(draft);
  if (!String(d.name || '').trim()) return { error: 'Введите имя героя' };
  d.name = String(d.name).trim();
  if (!sameSheetValue(base.classes, d.classes) && Array.isArray(d.classes) && d.classes.length) {
    for (const c of d.classes) if (!String(c.name || '').trim()) return { error: 'У класса нет названия' };
    d.level = d.classes.reduce((n, c) => n + (Number(c.levels) || 1), 0);
    d.className = d.classes[0].name;
    const first = CLASSES.find((x) => `srd51:class:${x.id}` === d.classes[0].ref);
    if (first) d.classId = first.id; else delete d.classId;
    // Кости хитов — по классам: потраченные сохраняются, всего = уровни класса.
    const old = Array.isArray(base.hitDicePools) ? base.hitDicePools : [];
    d.hitDicePools = d.classes.map((c, i) => {
      const hd = CLASSES.find((x) => `srd51:class:${x.id}` === c.ref)?.hd || old[i]?.die || null;
      return { id: old[i]?.id || newId(), name: `${hd ? `d${hd}` : 'Кость'} · ${c.name}`, die: hd, total: Number(c.levels) || 1, spent: Math.min(Number(old[i]?.spent) || 0, Number(c.levels) || 1) };
    });
  }
  if (Number.isFinite(d.hpMax) && Number.isFinite(d.hp) && d.hp > d.hpMax) d.hp = d.hpMax;
  const keys = [...new Set([...Object.keys(base), ...Object.keys(d)])].filter((k) => !META.includes(k) && !sameSheetValue(base[k], d[k]));
  const changed = server ? keys.filter((k) => SERVER_EDITABLE.has(k)) : keys;
  const dropped = keys.filter((k) => !changed.includes(k));
  return { patch: Object.fromEntries(changed.map((k) => [k, clone(d[k])])), changed, dropped };
}

/** Применить итог к персонажу (данные кампании или «Моих героев»): изменённые поля целиком. */
export function applyEdit(ch, patch) {
  for (const [k, v] of Object.entries(patch || {})) { if (META.includes(k)) continue; if (v === undefined) delete ch[k]; else ch[k] = clone(v); }
  return ch;
}

/** Какие разделы изменены (для подписи и точек в навигации). */
export function changedSections(base, draft) {
  const at = (o, path) => path.split('.').reduce((v, k) => v?.[k], o);
  return EDIT_SECTIONS.filter((s) => s.keys.some((k) => !sameSheetValue(at(base, k), at(draft, k)))).map((s) => s.id);
}

/** Имя предмета для экрана: русское из снаряжения SRD, иначе как записано. */
export const itemName = (x, gear) => gearOf(gear, x)?.ru || x?.name || '';
