// Что лист героя выводит сам из снаряжения и класса (#203, ревью листа): русские названия предметов, «надето»,
// КД из доспеха и щита, атаки оружием, умения класса с зарядами и строками боя. Только чтение и подсказки экрану:
// в данные героя это не записывается, пока игрок сам не нажмёт «Надеть», «Снять» или не потратит заряд.
import { GEAR_RU, EQ_RU } from '../ref/world-text.js';
import { SUM, SUB_INTRO } from '../ref/class-text.js';
import { RACE_SUM } from '../ref/world-text.js';
import { gearOf, wornItems, armorClass, martialDie } from '../../rules/hero-derived.js';

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
export { gearOf, wornItems, armorClass };

/**
 * Владеет ли оружием: «простое», «воинское» или само оружие названо в строке владений. Конструктор пишет названия
 * по-английски (Dagger, Rapier), старые листы — по-русски; сверяем в строке «Оружие:», если она есть.
 */
function proficientWith(g, text) {
  const all = String(text || '').toLowerCase();
  const t = /оружие:(.*)/.exec(all)?.[1] ?? all;
  if (/воинск/.test(t) && g.weapon?.category === 'martial') return true;
  if (/просто/.test(t) && g.weapon?.category === 'simple') return true;
  if (g.en && t.includes(String(g.en).toLowerCase())) return true;
  const stem = g.ru.toLowerCase().split(/[\s,]+/).map((w) => w.slice(0, 5)).find((w) => w.length >= 4);
  return !!stem && t.includes(stem);
}

const dieSize = (dice) => Number(/к?d?(\d+)$/.exec(String(dice).replace('к', 'd'))?.[1]) || 0;
// Оружие монаха: короткий меч и простое рукопашное, если оно не двуручное и не тяжёлое.
const monkWeapon = (g) => g.id === 'srd51:equipment:shortsword' || (g.weapon.category === 'simple' && g.weapon.range !== 'ranged' && !(g.weapon.properties || []).some((p) => ['two-handed', 'heavy'].includes(p)));

/**
 * Атаки надетым оружием: бонус = характеристика + мастерство (если владеет), урон = кость + характеристика.
 * perks — heroPerks: стрельба, дуэлянт, боевые искусства монаха.
 */
export function weaponAttacks(list, mods, prof, profText, perks = {}) {
  return list.filter((x) => x.equipped && x.g?.weapon).map((x) => {
    const w = x.g.weapon, props = w.properties || [], ranged = w.range === 'ranged';
    const monk = perks.monkLevel > 0 && monkWeapon(x.g);
    const best = mods.dex > mods.str ? 'dex' : 'str';
    const ab = props.includes('finesse') || monk ? best : ranged ? 'dex' : 'str';
    const m = mods[ab], own = proficientWith(x.g, profText);
    const style = ranged && perks.archery ? 2 : 0;
    const duel = !ranged && perks.dueling && !props.includes('two-handed') ? 2 : 0;
    const hit = m + (own ? prof : 0) + style, dmgMod = m + duel;
    const die = monk && martialDie(perks.monkLevel) > dieSize(w.damage.dice) ? `1к${martialDie(perks.monkLevel)}` : k(w.damage.dice);
    const range = w.normalRange ? `${w.normalRange}/${w.longRange} фт` : props.includes('reach') ? '10 фт' : '5 фт';
    return {
      id: `weapon-${x.id || x.g.id}`, name: x.g.ru, icon: 'weapon', hit: signed(hit), dmg: `${die}${dmgMod ? signed(dmgMod) : ''}`,
      sub: [DMG_RU[w.damage.type] || w.damage.type, range, w.versatileDice ? `двумя руками ${k(w.versatileDice)}` : '', ...props.filter((p) => !['versatile', 'ammunition'].includes(p)).map((p) => PROP_RU[p] || p), duel ? 'дуэлянт +2, если другая рука без оружия' : ''].filter(Boolean).join(' · '),
      explain: `${x.g.ru}: к20 ${signed(hit)} = ${ab === 'dex' ? 'Ловкость' : 'Сила'} ${signed(m)}${own ? ` + мастерство ${signed(prof)}` : ' (не владеет — без мастерства)'}${style ? ' + стрельба +2' : ''}`,
    };
  });
}

/** Безоружный удар есть у всех: 1 + Сила; у монаха — кость боевых искусств и лучшая из Силы и Ловкости. */
export function unarmedAttack(mods, prof, perks = {}) {
  const monk = perks.monkLevel > 0, ab = monk && mods.dex > mods.str ? 'dex' : 'str', m = mods[ab], hit = m + prof;
  const dmg = monk ? `1к${martialDie(perks.monkLevel)}${m ? signed(m) : ''}` : String(Math.max(0, 1 + m));
  return { id: 'weapon-unarmed', name: 'Безоружный удар', icon: 'weapon', hit: signed(hit), dmg, sub: monk ? 'дробящий · 5 фт · боевые искусства' : 'дробящий · 5 фт',
    explain: `Безоружный удар: к20 ${signed(hit)} = ${ab === 'dex' ? 'Ловкость' : 'Сила'} ${signed(m)} + мастерство ${signed(prof)}` };
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

// Умения, которых нет в справочнике (#203, аудит мастера 06.11): боевые стили, умения подрас, предыстория, цвет предка.
const FIGHTING = {
  archery: 'Стрельба: +2 к броскам атаки дальнобойным оружием.',
  defense: 'Оборона: +1 к КД, пока на вас доспех.',
  dueling: 'Дуэлянт: +2 к урону, если в одной руке рукопашное оружие, а другого оружия нет.',
  'great-weapon-fighting': 'Бой двуручным оружием: 1 и 2 на костях урона двуручного или универсального оружия можно один раз перебросить.',
  protection: 'Защита союзника: со щитом в руке реакцией даёте помеху атаке по союзнику в 5 футах от вас.',
  'two-weapon-fighting': 'Бой двумя оружиями: к урону атаки второй рукой прибавляется модификатор характеристики.',
};
const MORE = {
  'dwarven-toughness': 'Максимум хитов +1 и ещё +1 с каждым новым уровнем.',
  'elf-weapon-training': 'Владение длинным и коротким мечом, длинным и коротким луком.',
  cantrip: 'Один заговор волшебника на выбор; колдуете его Интеллектом.',
  'extra-language': 'Ещё один язык на выбор: говорите, читаете и пишете на нём.',
  'naturally-stealthy': 'Можете прятаться даже за существом, которое больше вас хотя бы на один размер.',
  tinker: 'Владение инструментами ремонтника: за час и 10 зм собираете крошечный механизм — игрушку, зажигалку или музыкальную шкатулку.',
  'artificer-s-lore': 'Проверки Истории о магических, алхимических и технических предметах — с удвоенным мастерством.',
  'shelter-of-the-faithful': 'Храмы вашей веры принимают вас и спутников: кров, бесплатное лечение и помощь жрецов в разумных пределах.',
};
const DRAGON = { black: ['чёрный', 'кислота'], blue: ['синий', 'электричество'], brass: ['латунный', 'огонь'], bronze: ['бронзовый', 'электричество'], copper: ['медный', 'кислота'], gold: ['золотой', 'огонь'], green: ['зелёный', 'яд'], red: ['красный', 'огонь'], silver: ['серебряный', 'холод'], white: ['белый', 'холод'] };

/** Русский текст умения по ref каталога (srd51:feature:<класс|раса>:<умение>) — из справочника. */
export function featureText(ref) {
  const m = /^srd51:feature:([^:]+):(.+)$/.exec(ref || '');
  if (!m) return '';
  const segs = m[2].split(':'), last = segs[segs.length - 1];
  const dragon = segs.includes('dragon-ancestor') && DRAGON[last];
  // Заголовок подкласса («Домен жизни», «Исчадие») — описание самого подкласса.
  const head = segs.length === 2 && (last.includes(segs[0]) || last === `the-${segs[0]}`) ? SUM[`${m[1]}:${segs[0]}`] || SUB_INTRO[`${m[1]}:${segs[0]}`] : '';
  return SUM[`${m[1]}:${m[2]}`] || RACE_SUM[m[2]] || SUM[`${m[1]}:${last}`] || RACE_SUM[last] || FIGHTING[last] || MORE[last] || head
    || (dragon ? `Предок — ${dragon[0]} дракон, его стихия — ${dragon[1]}. Говорите на драконьем; проверки Харизмы с драконами — с удвоенным мастерством.` : '');
}
// Расовые «паспортные» строки — возраст, размер, мировоззрение, языки, скорость, прибавки — на листе уже видны числами.
export const flavorFeature = (ref) => /:(age|alignment|size|languages|speed|ability-score-increase|subrace)$/.test(ref || '');
