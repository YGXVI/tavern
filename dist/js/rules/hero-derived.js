// Производные числа героя (#202, аудит 06.11, R1–R5): КД, инициатива и боевые особенности. Лист и стол считают их здесь,
// чтобы показывать одно и то же. У героя из конструктора `ac` и `initBonus` пусты: значения вычисляются, а не хранятся.
// Модуль без справочников: стол читает токены синхронно, поэтому доспехи — короткой таблицей (сверяется с каталогом в тестах).
import { mod } from '../data/rules.js';

const signed = (n) => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);
const tail = (id) => String(id || '').split(':').pop();

/** Базовый КД, прибавка Ловкости и её предел: как в equipment-2014.json. */
export const ARMOR_TABLE = Object.freeze({
  padded: [11, true, null], leather: [11, true, null], 'studded-leather': [12, true, null],
  hide: [12, true, 2], 'chain-shirt': [13, true, 2], 'scale-mail': [14, true, 2], breastplate: [14, true, 2], 'half-plate': [15, true, 2],
  'ring-mail': [14, false, null], 'chain-mail': [16, false, null], splint: [17, false, null], plate: [18, false, null],
});
const armorOnly = (() => {
  const byId = new Map([['srd51:equipment:shield', { id: 'srd51:equipment:shield', ru: 'Щит', kind: 'shield', armor: null, weapon: null }]]);
  for (const [k, [baseAc, addDex, dexMax]] of Object.entries(ARMOR_TABLE)) byId.set(`srd51:equipment:${k}`, { id: `srd51:equipment:${k}`, ru: k, kind: 'armor', armor: { baseAc, addDex, dexMax }, weapon: null });
  return { byId, byName: new Map() };
})();

export const gearOf = (gear, x) => (gear ? gear.byId.get(x?.ref) || gear.byName.get(String(x?.name || x || '').toLowerCase()) || null : null);

/**
 * Предметы героя глазами листа: вид, вес и «надето». Если игрок ещё ничего не надевал (новый герой из мастера создания),
 * надеты лучший доспех, щит и оружие — как на старте приключения.
 */
export function wornItems(items, gear) {
  const list = items.map((x) => ({ ...x, g: gearOf(gear, x) }));
  if (!list.some((x) => x.equipped)) {
    const armor = list.filter((x) => x.g?.kind === 'armor').sort((a, b) => (b.g.armor?.baseAc || 0) - (a.g.armor?.baseAc || 0))[0];
    const shield = list.find((x) => x.g?.kind === 'shield');
    for (const x of list) if (x === armor || x === shield || x.g?.kind === 'weapon') x.equipped = true, x.auto = true;
  }
  return list;
}

/** Что из умений героя меняет числа боя. Умения записаны в featureEntries, подкласс — в classes. */
export function heroPerks(ch) {
  const refs = (ch?.featureEntries || []).map((f) => String(f?.ref || ''));
  const has = (re) => refs.some((r) => re.test(r));
  const classes = ch?.classes || [];
  const monk = classes.find((c) => tail(c.ref) === 'monk');
  return {
    draconic: classes.some((c) => /draconic-bloodline/.test(c.subclassRef || '')) || has(/:draconic-resilience$/),
    defense: has(/^srd51:feature:[a-z-]+:defense$/), archery: has(/^srd51:feature:[a-z-]+:archery$/), dueling: has(/^srd51:feature:[a-z-]+:dueling$/),
    monkLevel: monk ? monk.levels || 1 : ch?.classId === 'monk' ? ch.level || 1 : 0,
  };
}
export const heroClassIds = (ch) => {
  const ids = (ch?.classes || []).map((c) => tail(c.ref)).filter(Boolean);
  return ids.length ? ids : [ch?.classId].filter(Boolean);
};

/** КД: доспех + Ловкость (с пределом), щит +2; без доспеха — лучшая из защит без доспехов. Стиль «Оборона» — +1 в доспехе. */
export function armorClass(list, mods, classIds = [], perks = {}) {
  const armor = list.filter((x) => x.equipped && x.g?.kind === 'armor').map((x) => x.g)[0];
  const shield = list.some((x) => x.equipped && x.g?.kind === 'shield');
  const parts = [];
  let ac, note = armor ? armor.ru : shield ? 'щит' : 'без доспехов';
  if (armor) {
    const a = armor.armor, dex = a.addDex ? (a.dexMax == null ? mods.dex : Math.min(mods.dex, a.dexMax)) : 0;
    ac = a.baseAc + dex; parts.push(`${armor.ru} ${a.baseAc}`); if (a.addDex) parts.push(`Ловкость ${signed(dex)}${a.dexMax != null ? ` (не больше ${a.dexMax})` : ''}`);
    if (perks.defense) { ac += 1; parts.push('Оборона +1'); }
  } else {
    const ways = [{ ac: 10 + mods.dex, parts: ['10', `Ловкость ${signed(mods.dex)} (без доспехов)`] }];
    if (classIds.includes('barbarian')) ways.push({ ac: 10 + mods.dex + mods.con, parts: ['10', `Ловкость ${signed(mods.dex)}`, `Телосложение ${signed(mods.con)} (Защита без доспехов)`] });
    if (classIds.includes('monk') && !shield) ways.push({ ac: 10 + mods.dex + mods.wis, parts: ['10', `Ловкость ${signed(mods.dex)}`, `Мудрость ${signed(mods.wis)} (Защита без доспехов)`] });
    if (perks.draconic) ways.push({ ac: 13 + mods.dex, note: 'Драконья стойкость', parts: ['13', `Ловкость ${signed(mods.dex)} (Драконья стойкость)`] });
    const best = ways.reduce((a, b) => (b.ac > a.ac ? b : a));
    ac = best.ac; parts.push(...best.parts); if (best.note) note = best.note;
  }
  if (shield) { ac += 2; parts.push('щит +2'); }
  return { value: ac, note, explain: `КД ${ac} = ${parts.join(' + ')}` };
}

const modsOf = (ch) => Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map((k) => [k, mod(ch?.stats?.[k])]));

/** КД героя для стола и списков: записанный на листе или вычисленный. */
export function heroAc(ch) {
  if (Number.isFinite(ch?.ac)) return ch.ac;
  return armorClass(wornItems(ch?.inventoryItems || [], armorOnly), modsOf(ch), heroClassIds(ch), heroPerks(ch)).value;
}

/** Бонус инициативы: правка игрока, записанный на листе или Ловкость. */
export function heroInit(ch) {
  const o = ch?.overrides?.initiative;
  if (o?.value != null) return o.value;
  return Number.isFinite(ch?.initBonus) ? ch.initBonus : mod(ch?.stats?.dex);
}

/** Кость боевых искусств монаха по уровню. */
export const martialDie = (level) => (level >= 17 ? 10 : level >= 11 ? 8 : level >= 5 ? 6 : 4);
