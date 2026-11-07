// Производные числа героя (#202, аудит 06.11, R1–R5): КД, инициатива и боевые особенности. Лист и стол считают их здесь,
// чтобы показывать одно и то же. У героя из конструктора `ac` и `initBonus` пусты: значения вычисляются, а не хранятся.
// Модуль без справочников: стол читает токены синхронно, поэтому доспехи — короткой таблицей (сверяется с каталогом в тестах).
import { mod } from '../data/rules.js';

const signed = (n) => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);
const tail = (id) => String(id || '').split(':').pop();

/** Базовый КД, прибавка Ловкости, её предел, требование Силы, помеха Скрытности: как в equipment-2014.json. */
export const ARMOR_TABLE = Object.freeze({
  padded: [11, true, null, null, true], leather: [11, true, null, null, false], 'studded-leather': [12, true, null, null, false],
  hide: [12, true, 2, null, false], 'chain-shirt': [13, true, 2, null, false], 'scale-mail': [14, true, 2, null, true], breastplate: [14, true, 2, null, false], 'half-plate': [15, true, 2, null, true],
  'ring-mail': [14, false, null, null, true], 'chain-mail': [16, false, null, 13, true], splint: [17, false, null, 15, true], plate: [18, false, null, 15, true],
});
const armorOnly = (() => {
  const byId = new Map([['srd51:equipment:shield', { id: 'srd51:equipment:shield', ru: 'Щит', kind: 'shield', armor: null, weapon: null }]]);
  for (const [k, [baseAc, addDex, dexMax, strength, stealthDisadvantage]] of Object.entries(ARMOR_TABLE)) byId.set(`srd51:equipment:${k}`, { id: `srd51:equipment:${k}`, ru: k, kind: 'armor', armor: { baseAc, addDex, dexMax, strength, stealthDisadvantage }, weapon: null });
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

const classLevel = (ch, id) => (ch?.classes || []).filter((c) => tail(c.ref) === id).reduce((n, c) => n + (c.levels || 1), 0) || (ch?.classId === id ? ch.level || 1 : 0);
const proficiencyOf = (ch) => 2 + Math.floor(((ch?.level || 1) - 1) / 4);
/** «Мастер на все руки» барда со 2 уровня: половина мастерства к проверкам без владения. */
export const jackBonus = (ch) => (classLevel(ch, 'bard') >= 2 ? Math.floor(proficiencyOf(ch) / 2) : 0);

/** Бонус инициативы: правка игрока, записанный на листе или Ловкость (инициатива — проверка, «Мастер на все руки» входит). */
export function heroInit(ch) {
  const has = Object.hasOwn(ch?.overrides || {}, 'initiative'), o = ch?.overrides?.initiative;
  if (o?.value != null) return o.value;
  if (!has && Number.isFinite(ch?.initBonus)) return ch.initBonus;
  return mod(ch?.stats?.dex) + jackBonus(ch);
}

// Движение без доспехов монаха по уровням: 2, 6, 10, 14, 18.
const monkMove = (level) => (level >= 18 ? 30 : level >= 14 ? 25 : level >= 10 ? 20 : level >= 6 ? 15 : level >= 2 ? 10 : 0);
/**
 * Скорость героя из конструктора: движение монаха без доспехов и щита, быстрое передвижение варвара не в тяжёлом доспехе,
 * −10 фт в доспехе не по Силе (дварфам он не мешает). Листы, перенесённые извне, ведут скорость сами.
 */
export function heroSpeed(ch) {
  const base = Number.isFinite(ch?.speed) ? ch.speed : 30;
  if (!ch?.creation) return base;
  const list = wornItems(ch.inventoryItems || [], armorOnly);
  const armor = list.find((x) => x.equipped && x.g?.kind === 'armor')?.g?.armor, shield = list.some((x) => x.equipped && x.g?.kind === 'shield');
  let speed = base;
  if (!armor && !shield) speed += monkMove(classLevel(ch, 'monk'));
  if (classLevel(ch, 'barbarian') >= 5 && (!armor || armor.addDex)) speed += 10;
  if (armor?.strength && (ch.stats?.str ?? 10) < armor.strength && ch.raceId !== 'dwarf') speed -= 10;
  return speed;
}

/** Сколько атак за действие «Атака». */
export function heroAttacks(ch) {
  const f = classLevel(ch, 'fighter');
  if (f >= 20) return 4;
  if (f >= 11) return 3;
  return f >= 5 || ['barbarian', 'monk', 'paladin', 'ranger'].some((id) => classLevel(ch, id) >= 5) ? 2 : 1;
}

/** Кость боевых искусств монаха по уровню. */
export const martialDie = (level) => (level >= 17 ? 10 : level >= 11 ? 8 : level >= 5 ? 6 : 4);
