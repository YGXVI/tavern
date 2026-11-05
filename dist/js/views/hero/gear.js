// Что лист героя выводит сам из снаряжения и класса (#203, ревью листа): русские названия предметов, «надето»,
// КД из доспеха и щита, атаки оружием, умения класса с зарядами и строками боя. Только чтение и подсказки экрану:
// в данные героя это не записывается, пока игрок сам не нажмёт «Надеть», «Снять» или не потратит заряд.
import { GEAR_RU, EQ_RU } from '../ref/world-text.js';
import { SUM } from '../ref/class-text.js';
import { RACE_SUM } from '../ref/world-text.js';

const DMG_RU = { acid: 'кислота', bludgeoning: 'дробящий', cold: 'холод', fire: 'огонь', force: 'силовое поле', lightning: 'электричество', necrotic: 'некротический', piercing: 'колющий', poison: 'яд', psychic: 'психический', radiant: 'излучение', slashing: 'рубящий', thunder: 'звук' };
const PROP_RU = { finesse: 'фехтовальное', light: 'лёгкое', heavy: 'тяжёлое', 'two-handed': 'двуручное', versatile: 'универсальное', thrown: 'метательное', reach: 'досягаемость', loading: 'перезарядка', ammunition: 'боеприпасы' };
const signed = (n) => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);
const k = (dice) => String(dice || '').replace(/d/g, 'к');

/** Снаряжение SRD: по ID (ref предмета) и по русскому названию (старые листы — строкой). */
export function gearIndex(equipment) {
  const byId = new Map(), byName = new Map();
  for (const e of equipment?.entries || []) {
    const ru = EQ_RU[e.name.en] || GEAR_RU[e.name.en] || e.name.ru || e.name.en;
    const g = { id: e.id, ru, en: e.name.en, kind: e.kind, weight: e.weight?.lb, armor: e.armor || null, weapon: e.weapon || null };
    byId.set(e.id, g); byName.set(ru.toLowerCase(), g); byName.set(String(e.name.en).toLowerCase(), g);
  }
  return { byId, byName };
}
export const gearOf = (gear, x) => (gear ? gear.byId.get(x?.ref) || gear.byName.get(String(x?.name || x || '').toLowerCase()) || null : null);

/**
 * Предметы героя глазами листа: русское имя, вид, вес и «надето». Если игрок ещё ничего не надевал (новый герой из
 * мастера создания), надеты лучший доспех, щит и оружие — как на старте приключения.
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

/** КД: доспех + Ловкость (с пределом), щит +2; без доспеха — 10 + Ловкость, у варвара и монаха — их Защита без доспехов. */
export function armorClass(list, mods, classIds = []) {
  const armor = list.filter((x) => x.equipped && x.g?.kind === 'armor').map((x) => x.g)[0];
  const shield = list.some((x) => x.equipped && x.g?.kind === 'shield');
  const parts = [];
  let ac;
  if (armor) {
    const a = armor.armor, dex = a.addDex ? (a.dexMax == null ? mods.dex : Math.min(mods.dex, a.dexMax)) : 0;
    ac = a.baseAc + dex; parts.push(`${armor.ru} ${a.baseAc}`); if (a.addDex) parts.push(`Ловкость ${signed(dex)}${a.dexMax != null ? ` (не больше ${a.dexMax})` : ''}`);
  } else if (classIds.includes('barbarian')) { ac = 10 + mods.dex + mods.con; parts.push('10', `Ловкость ${signed(mods.dex)}`, `Телосложение ${signed(mods.con)} (Защита без доспехов)`); }
  else if (classIds.includes('monk') && !shield) { ac = 10 + mods.dex + mods.wis; parts.push('10', `Ловкость ${signed(mods.dex)}`, `Мудрость ${signed(mods.wis)} (Защита без доспехов)`); }
  else { ac = 10 + mods.dex; parts.push('10', `Ловкость ${signed(mods.dex)} (без доспехов)`); }
  if (shield) { ac += 2; parts.push('щит +2'); }
  return { value: ac, note: armor ? armor.ru : shield ? 'щит' : 'без доспехов', explain: `КД ${ac} = ${parts.join(' + ')}` };
}

/** Владеет ли оружием: «простое», «воинское» или само оружие названо в строке владений. */
function proficientWith(g, text) {
  const t = String(text || '').toLowerCase();
  if (/воинск/.test(t) && g.weapon?.category === 'martial') return true;
  if (/просто/.test(t) && g.weapon?.category === 'simple') return true;
  const stem = g.ru.toLowerCase().split(/[\s,]+/).map((w) => w.slice(0, 5)).find((w) => w.length >= 4);
  return !!stem && t.includes(stem);
}

/** Атаки надетым оружием: бонус = характеристика + мастерство (если владеет), урон = кость + характеристика. */
export function weaponAttacks(list, mods, prof, profText) {
  return list.filter((x) => x.equipped && x.g?.weapon).map((x) => {
    const w = x.g.weapon, props = w.properties || [];
    const ab = w.range === 'ranged' ? 'dex' : props.includes('finesse') ? (mods.dex > mods.str ? 'dex' : 'str') : 'str';
    const m = mods[ab], own = proficientWith(x.g, profText);
    const hit = m + (own ? prof : 0);
    const range = w.normalRange ? `${w.normalRange}/${w.longRange} фт` : props.includes('reach') ? '10 фт' : '5 фт';
    return {
      id: `weapon-${x.id || x.g.id}`, name: x.g.ru, icon: 'weapon', hit: signed(hit), dmg: `${k(w.damage.dice)}${m ? signed(m) : ''}`,
      sub: [DMG_RU[w.damage.type] || w.damage.type, range, w.versatileDice ? `двумя руками ${k(w.versatileDice)}` : '', ...props.filter((p) => !['versatile', 'ammunition'].includes(p)).map((p) => PROP_RU[p] || p)].filter(Boolean).join(' · '),
      explain: `${x.g.ru}: к20 ${signed(hit)} = ${ab === 'dex' ? 'Ловкость' : 'Сила'} ${signed(m)}${own ? ` + мастерство ${signed(prof)}` : ' (не владеет — без мастерства)'}`,
    };
  });
}

// Умения класса с зарядами (PHB 2014): сколько на уровне и когда восстанавливаются.
const RAGE = [2, 2, 3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 99];
export const CLASS_RES = [
  { cls: 'barbarian', id: 'rage', name: 'Ярость', from: 1, max: (lv) => RAGE[lv - 1], rec: 'long', row: 'bonus', sub: 'бонусное действие · минута' },
  { cls: 'bard', id: 'bardic-inspiration', name: 'Вдохновение барда', from: 1, max: (lv, m) => Math.max(1, m.cha), rec: (lv) => (lv >= 5 ? 'short' : 'long'), row: 'bonus', sub: (lv) => `бонусное действие · к${lv >= 15 ? 12 : lv >= 10 ? 10 : lv >= 5 ? 8 : 6}` },
  { cls: 'cleric', id: 'channel-divinity', name: 'Божественный канал', from: 2, max: (lv) => (lv >= 18 ? 3 : lv >= 6 ? 2 : 1), rec: 'short', row: 'action', sub: 'действие · Изгнание нежити и свой вариант' },
  { cls: 'druid', id: 'wild-shape', name: 'Дикий облик', from: 2, max: () => 2, rec: 'short', row: 'action', sub: 'действие · облик зверя' },
  { cls: 'fighter', id: 'second-wind', name: 'Второе дыхание', from: 1, max: () => 1, rec: 'short', row: 'bonus', sub: (lv) => `бонусное действие · 1к10+${lv} хитов` },
  { cls: 'fighter', id: 'action-surge', name: 'Всплеск действий', from: 2, max: (lv) => (lv >= 17 ? 2 : 1), rec: 'short', row: 'special', sub: 'ещё одно действие в этот ход' },
  { cls: 'monk', id: 'ki', name: 'Ци', from: 2, max: (lv) => lv, rec: 'short', row: 'bonus', sub: 'град ударов, терпеливая оборона, шаг ветра' },
  { cls: 'paladin', id: 'lay-on-hands', name: 'Наложение рук', from: 1, max: (lv) => 5 * lv, rec: 'long', row: 'action', sub: 'действие · запас хитов' },
  { cls: 'paladin', id: 'divine-sense', name: 'Божественное чувство', from: 1, max: (lv, m) => 1 + Math.max(0, m.cha), rec: 'long', row: 'action', sub: 'действие · нежить, исчадия, небожители в 60 фт' },
  { cls: 'sorcerer', id: 'sorcery-points', name: 'Единицы чародейства', from: 2, max: (lv) => lv, rec: 'long', row: null },
  { cls: 'wizard', id: 'arcane-recovery', name: 'Магическое восстановление', from: 1, max: () => 1, rec: 'long', row: null },
];
const val = (f, ...a) => (typeof f === 'function' ? f(...a) : f);

/** Заряды умений класса, которых ещё нет на листе: { id, name, total, left, recovery, row?, sub? }. */
export function classResources(classes, mods, existing = []) {
  const have = new Set(existing.map((r) => String(r.name || '').toLowerCase()));
  const out = [];
  for (const c of classes) for (const r of CLASS_RES) {
    if (r.cls !== c.id || c.level < r.from || have.has(r.name.toLowerCase())) continue;
    const id = `cls-${r.id}`, spent = existing.find((x) => x.id === id)?.spent || 0, total = val(r.max, c.level, mods);
    out.push({ id, name: r.name, total, left: Math.max(0, total - spent), recovery: val(r.rec, c.level), row: r.row, sub: val(r.sub, c.level) });
  }
  return out;
}

/** Русский текст умения по ref каталога (srd51:feature:<класс|раса>:<умение>) — из справочника. */
export function featureText(ref) {
  const m = /^srd51:feature:([^:]+):(.+)$/.exec(ref || '');
  if (!m) return '';
  return SUM[`${m[1]}:${m[2]}`] || RACE_SUM[m[2]] || '';
}
// Расовые «паспортные» строки — возраст, размер, мировоззрение, языки, скорость, прибавки — на листе уже видны числами.
export const flavorFeature = (ref) => /:(age|alignment|size|languages|speed|ability-score-increase|subrace)$/.test(ref || '');
