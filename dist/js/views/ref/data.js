// Справочник (#203): данные из публичных каталогов проекта и бестиария, приведённые к одному виду для списка,
// поиска и карточки. Каталоги грузятся по требованию; секретов и данных пользователей здесь нет.
import { BESTIARY, loadSrdBestiary } from '../../data/bestiary.js';
import { CONDITIONS, CLASSES, RACES, ABILITIES, mod } from '../../data/rules.js';
import { RULES } from './rules-text.js';

const url = (f) => new URL(`../../data/${f}`, import.meta.url);
const cache = new Map();
function json(file) {
  if (!cache.has(file)) {
    const p = fetch(url(file), { credentials: 'omit' }).then((r) => { if (!r.ok) throw new Error(`Каталог не загрузился (${r.status})`); return r.json(); });
    p.catch(() => cache.delete(file));
    cache.set(file, p);
  }
  return cache.get(file);
}

// ——— Нормализация и поиск ———
export const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/[«»"'’().,:;!?/\\-]+/g, ' ').replace(/\s+/g, ' ').trim();
const EN = 'qwertyuiop[]asdfghjkl;\'zxcvbnm,.`';
const RU = 'йцукенгшщзхъфывапролджэячсмитьбюё';
const swapMap = new Map([...EN].map((c, i) => [c, RU[i]]).concat([...RU].map((c, i) => [c, EN[i]])));
/** Текст, набранный не в той раскладке: «ujykby» → «гоблин». */
export const swapLayout = (s) => [...String(s).toLowerCase()].map((c) => swapMap.get(c) || c).join('');

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Очки совпадения запроса с записью: 0 — не подходит. Опечатки прощаются в словах от 4 букв. */
export function score(item, q) {
  if (!q) return 1;
  const name = item.n, all = item.hay;
  if (name === q || item.ne === q) return 100;
  if (name.startsWith(q) || item.ne.startsWith(q)) return 85;
  const words = all.split(' ');
  if (words.some((w) => w.startsWith(q))) return 70;
  if (all.includes(q)) return 55;
  const qw = q.split(' ');
  if (qw.length > 1 && qw.every((w) => words.some((x) => x.startsWith(w)))) return 50;
  if (q.length >= 4) {
    const max = q.length >= 8 ? 2 : 1;
    if (lev(q, name.slice(0, q.length + 1), max) <= max || lev(q, name, max) <= max || lev(q, item.ne, max) <= max) return 30;
    if (qw.every((w) => w.length < 4 ? words.some((x) => x.startsWith(w)) : words.some((x) => lev(w, x.slice(0, w.length + 1), 1) <= 1 || lev(w, x, 1) <= 1))) return 25;
  }
  return 0;
}

/** Поиск по списку: сначала как набрано, потом в другой раскладке. typo — запрос похож на опечатку. */
export function search(items, query, limit = 400) {
  const q = norm(query);
  if (!q) return { list: items.slice(0, limit), q, alt: null };
  const run = (qq) => items.map((it) => [it, score(it, qq)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name, 'ru'));
  let res = run(q), alt = null, typo = res.length > 0 && res[0][1] <= 30;
  if (!res.length || res[0][1] < 55) {
    const sw = norm(swapLayout(query)); // до нормализации: «,» и «.» в чужой раскладке — это «б» и «ю»
    if (sw !== q) { const r2 = run(sw); if (r2.length && (!res.length || r2[0][1] > res[0][1])) { res = r2; alt = sw; typo = false; } }
  }
  return { list: res.slice(0, limit).map((x) => x[0]), q, alt, typo };
}

const item = (o) => ({ ...o, n: norm(o.name), ne: norm(o.en || ''), hay: norm(`${o.name} ${o.en || ''} ${o.alias || ''}`) });

// ——— Разделы ———
export const SECTIONS = [
  { id: 'spells', name: 'Заклинания', icon: 'magic-wand-01', hint: 'Огненный шар · Щит · Лечение ран · Контрзаклинание' },
  { id: 'creatures', name: 'Существа', icon: 'monster', hint: 'Гоблин · Огр · Скелет · Молодой красный дракон' },
  { id: 'classes', name: 'Классы', icon: 'shield-01', hint: 'Что даёт каждый уровень — с 1-го по 20-й' },
  { id: 'races', name: 'Расы', icon: 'user-group', hint: 'Черты, скорость, языки и тёмное зрение' },
  { id: 'backgrounds', name: 'Предыстории', icon: 'scroll', hint: 'Навыки, снаряжение и зацепки для истории' },
  { id: 'equipment', name: 'Снаряжение', icon: 'sword-01', hint: 'Оружие, доспехи, наборы и цены в золоте' },
  { id: 'items', name: 'Магические предметы', icon: 'gem', hint: 'От зелья лечения до посоха магов' },
  { id: 'rules', name: 'Правила и состояния', icon: 'book-open-01', hint: 'Опутан, ничком, укрытие, отдых, падение' },
];
export const sectionById = (id) => SECTIONS.find((s) => s.id === id);

const loaded = new Map();
/** Записи раздела (Promise). Повторный вызов отдаёт тот же список. */
export function loadSection(id) {
  if (!loaded.has(id)) {
    const p = (LOADERS[id] || (async () => []))();
    p.catch(() => loaded.delete(id));
    loaded.set(id, p);
  }
  return loaded.get(id);
}
/** Уже загруженный раздел или null — для мгновенного поиска. */
const ready = new Map();
export const sectionNow = (id) => ready.get(id) || null;
export async function loadAll() { await Promise.all(SECTIONS.map((s) => loadSection(s.id).catch(() => []))); }

const LOADERS = {
  async spells() {
    const [cat, ref] = await Promise.all([json('spells-2014.json'), json('spells-ref-2014.json')]);
    const list = cat.entries.map((e) => {
      const p = ref.spells[e.id] || [];
      const classes = (e.classes?.base || []).map((c) => ref.classes[c]).filter(Boolean);
      return item({
        section: 'spells', id: e.id.split(':').pop(), name: e.name.ru || e.name.en, en: e.name.en, level: e.level, school: e.school,
        schoolName: ref.schools[e.school] || e.school, ritual: !!e.ritual, conc: !!e.concentration, classes, srd: !!e.srd,
        time: p[0] || '', range: p[1] || '', duration: p[2] || '', comp: p[3] || '', damage: (p[4] || []).map((d) => ref.damage[d] || d), link: p[5] || '',
        sub: `${e.level ? `${e.level} уровень` : 'Заговор'} · ${ref.schools[e.school] || e.school}`,
      });
    }).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    ready.set('spells', list);
    SPELL_CLASSES = Object.values(ref.classes);
    SCHOOLS = ref.schools;
    return list;
  },
  async creatures() {
    await loadSrdBestiary().catch(() => null);
    const list = BESTIARY.map((m) => item({ section: 'creatures', id: m.id.replace(/^srd:/, ''), monsterId: m.id, name: m.name, en: m.en || '', m, cr: crNum(m.cr), sub: `Опасн. ${m.cr ?? '—'}` }))
      .sort((a, b) => a.cr - b.cr || a.name.localeCompare(b.name, 'ru'));
    ready.set('creatures', list);
    return list;
  },
  async classes() {
    const [opt, feat] = await Promise.all([json('character-options-2014.json'), json('features-2014.json')]);
    const fById = new Map(feat.entries.map((f) => [f.id, f]));
    const list = opt.entries.filter((e) => e.kind === 'class').map((e) => {
      const key = e.id.split(':').pop();
      const base = CLASSES.find((c) => c.id === key) || {};
      const levels = (e.progression || []).map((row) => ({ level: row.level, prof: row.proficiencyBonus, slots: row.spellSlots,
        features: (row.grants || []).filter((g) => g.kind === 'feature').map((g) => fById.get(g.ref)).filter(Boolean) }));
      const subs = opt.entries.filter((x) => x.kind === 'subclass' && x.classId === e.id).map((x) => x.name.ru || x.name.en);
      return item({ section: 'classes', id: key, name: e.name.ru, en: e.name.en, hd: base.hd, saves: base.saves || [], spell: base.spell || null, levels, subs, sub: `Кость хитов к${base.hd || '?'}` });
    });
    ready.set('classes', list);
    return list;
  },
  async races() {
    const [opt, feat] = await Promise.all([json('character-options-2014.json'), json('features-2014.json')]);
    const fById = new Map(feat.entries.map((f) => [f.id, f]));
    const list = opt.entries.filter((e) => e.kind === 'race').map((e) => {
      const key = e.id.split(':').pop();
      const g = e.grants || [];
      const speed = g.find((x) => x.kind === 'speed')?.value;
      const dv = g.find((x) => x.kind === 'sense' && x.sense === 'darkvision')?.range || 0;
      const inc = g.filter((x) => x.kind === 'ability_increase').map((x) => `${ABILITIES.find((a) => a.id === x.ability)?.short || x.ability} +${x.value}`);
      const traits = (e.featureRefs || []).map((r) => fById.get(r)).filter((f) => f && !/(age|alignment|size|speed|languages|ability-score-increase)$/.test(f.id));
      const subs = opt.entries.filter((x) => x.kind === 'subrace' && x.raceId === e.id).map((x) => ({ name: x.name.ru || x.name.en, traits: (x.featureRefs || []).map((r) => fById.get(r)).filter(Boolean) }));
      const size = g.find((x) => x.kind === 'size')?.value;
      const langs = g.filter((x) => x.kind === 'language').map((x) => LANGS[x.value] || x.value);
      return item({ section: 'races', id: key, name: e.name.ru, en: e.name.en, speed: speed || RACES.find((r) => r.id === key)?.speed, darkvision: dv, inc, traits, subs, langs, size: SIZE_RU[size] || '', sub: `Скорость ${speed || '—'} фт${dv ? ` · тёмное зрение ${dv} фт` : ''}` });
    });
    ready.set('races', list);
    return list;
  },
  async backgrounds() {
    const [opt, feat] = await Promise.all([json('character-options-2014.json'), json('features-2014.json')]);
    const fById = new Map(feat.entries.map((f) => [f.id, f]));
    const list = opt.entries.filter((e) => e.kind === 'background' || e.kind === 'feat').map((e) => {
      const g = e.grants || [];
      const skills = g.filter((x) => x.kind === 'proficiency' && x.category === 'skill').map((x) => SKILL_RU[x.value] || x.value);
      return item({ section: 'backgrounds', id: e.id.split(':').pop(), name: e.name.ru || e.name.en, en: e.name.en, kind: e.kind, skills,
        features: (e.featureRefs || []).map((r) => fById.get(r)).filter(Boolean), sub: e.kind === 'feat' ? 'Черта' : skills.join(', ') || 'Предыстория' });
    });
    ready.set('backgrounds', list);
    return list;
  },
  async equipment() {
    const cat = await json('equipment-2014.json');
    const list = cat.entries.map((e) => {
      const en = e.name.en;
      const name = e.name.ru || EQ_RU[en] || en;
      const w = e.weapon, a = e.armor;
      const sub = w ? `${w.damage?.dice || '—'} ${DMG_RU[w.damage?.type] || ''}`.trim() : a ? `КД ${a.baseAc}${a.addDex ? (a.dexMax ? ` + ЛОВ (макс ${a.dexMax})` : ' + ЛОВ') : ''}` : e.kind === 'shield' ? 'КД +2' : EQ_KIND[e.kind] || e.kind;
      return item({ section: 'equipment', id: e.id.split(':').pop(), name, en: name === en ? '' : en, kind: e.kind, kindName: EQ_KIND[e.kind] || e.kind, cost: e.cost, weight: e.weight?.lb, w, a, contents: e.contents || [], sub });
    }).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    ready.set('equipment', list);
    return list;
  },
  async items() {
    const cat = await json('magic-items-2014.json');
    const list = cat.entries.map((e) => item({ section: 'items', id: e.id.split(':').pop(), name: e.name.ru || e.name.en, en: e.name.en, type: e.type?.name_ru || '', typeCode: e.type?.code, rarity: e.rarity?.name_ru || '', rarityCode: e.rarity?.code,
      attune: !!e.attunement?.required, attuneText: e.attunement?.requirement_en || '', text: e.description?.en || null, link: e.sources?.dndsu || '', sub: [e.type?.name_ru, e.rarity?.name_ru].filter(Boolean).join(' · ') }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    ready.set('items', list);
    return list;
  },
  async rules() {
    const list = [
      ...CONDITIONS.map((c) => item({ section: 'rules', id: c.id, name: c.name, en: CONDITION_EN[c.id] || '', group: 'Состояния', text: c.text, sub: 'Состояние' })),
      ...RULES.map((r) => item({ section: 'rules', id: r.id, name: r.name, en: r.en || '', alias: r.alias || '', group: r.group, text: r.text, sub: r.group })),
    ];
    ready.set('rules', list);
    return list;
  },
};

// ——— Справочники ———
export let SPELL_CLASSES = ['Бард', 'Жрец', 'Друид', 'Паладин', 'Следопыт', 'Чародей', 'Колдун', 'Волшебник', 'Изобретатель'];
export let SCHOOLS = { evocation: 'Воплощение', abjuration: 'Ограждение', illusion: 'Иллюзия', necromancy: 'Некромантия', enchantment: 'Очарование', transmutation: 'Преобразование', divination: 'Прорицание', conjuration: 'Вызов' };
export function crNum(cr) { if (cr == null || cr === '') return 99; const s = String(cr); if (s.includes('/')) { const [a, b] = s.split('/'); return Number(a) / Number(b); } return Number(s) || 0; }
const XP = { 0: 10, 0.125: 25, 0.25: 50, 0.5: 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900, 9: 5000, 10: 5900, 11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000, 16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000, 21: 33000, 22: 41000, 23: 50000, 24: 62000, 25: 75000, 26: 90000, 27: 105000, 28: 120000, 29: 135000, 30: 155000 };
/** Опыт за существо по показателю опасности (DMG 2014). */
export const xpFor = (cr) => XP[crNum(cr)] ?? 0;
export const abilityMod = (v) => mod(v);
export const ABIL = ABILITIES;

const LANGS = { common: 'Общий', dwarvish: 'Дварфский', elvish: 'Эльфийский', giant: 'Великаний', gnomish: 'Гномий', goblin: 'Гоблинский', halfling: 'Полуросликов', orc: 'Орочий', abyssal: 'Бездны', celestial: 'Небесный', draconic: 'Драконий', 'deep-speech': 'Глубинная речь', infernal: 'Инфернальный', primordial: 'Первичный', sylvan: 'Сильван', undercommon: 'Подземный', choice: 'Ещё один на выбор', any: 'Ещё один на выбор' };
const SIZE_RU = { tiny: 'Крошечный', small: 'Маленький', medium: 'Средний', large: 'Большой', huge: 'Огромный', gargantuan: 'Громадный' };
export const SKILL_RU = { acrobatics: 'Акробатика', 'animal-handling': 'Уход за животными', animal_handling: 'Уход за животными', arcana: 'Магия', athletics: 'Атлетика', deception: 'Обман', history: 'История', insight: 'Проницательность', intimidation: 'Запугивание', investigation: 'Анализ', medicine: 'Медицина', nature: 'Природа', perception: 'Восприятие', performance: 'Выступление', persuasion: 'Убеждение', religion: 'Религия', 'sleight-of-hand': 'Ловкость рук', sleight_of_hand: 'Ловкость рук', stealth: 'Скрытность', survival: 'Выживание' };
export const DMG_RU = { slashing: 'рубящий', piercing: 'колющий', bludgeoning: 'дробящий', fire: 'огонь', cold: 'холод', lightning: 'электричество', thunder: 'звук', acid: 'кислота', poison: 'яд', necrotic: 'некротическая энергия', radiant: 'излучение', force: 'силовое поле', psychic: 'психическая энергия' };
const EQ_KIND = { gear: 'Снаряжение', weapon: 'Оружие', tool: 'Инструменты', focus: 'Фокусировка', armor: 'Доспех', pack: 'Набор', ammunition: 'Боеприпасы', shield: 'Щит' };
export const EQ_KINDS = EQ_KIND;
export const WEAPON_PROPS = { versatile: 'универсальное', finesse: 'фехтовальное', light: 'лёгкое', heavy: 'тяжёлое', 'two-handed': 'двуручное', two_handed: 'двуручное', thrown: 'метательное', reach: 'досягаемость', loading: 'перезарядка', ammunition: 'боеприпасы', special: 'особое', monk: 'монашеское' };
const EQ_RU = {
  Battleaxe: 'Боевой топор', Blowgun: 'Духовая трубка', 'Blowgun needles': 'Иглы для трубки', Breastplate: 'Кираса', 'Chain mail': 'Кольчуга', 'Chain shirt': 'Кольчужная рубаха', Club: 'Дубинка',
  'Crossbow bolts': 'Арбалетные болты', 'Crossbow, hand': 'Ручной арбалет', 'Crossbow, heavy': 'Тяжёлый арбалет', 'Crossbow, light': 'Лёгкий арбалет', Dagger: 'Кинжал', Dart: 'Дротик', Flail: 'Цеп', Glaive: 'Глефа',
  Greataxe: 'Секира', Greatclub: 'Палица', Greatsword: 'Двуручный меч', Halberd: 'Алебарда', 'Half plate': 'Полулаты', Handaxe: 'Ручной топор', Hide: 'Шкурный доспех', Javelin: 'Метательное копьё', Lance: 'Длинное копьё',
  Leather: 'Кожаный доспех', 'Light hammer': 'Лёгкий молот', Longbow: 'Длинный лук', Longsword: 'Длинный меч', Mace: 'Булава', Maul: 'Молот', Morningstar: 'Моргенштерн', Net: 'Сеть', Padded: 'Стёганый доспех', Pike: 'Пика',
  Plate: 'Латы', Quarterstaff: 'Боевой посох', Rapier: 'Рапира', 'Ring mail': 'Колечный доспех', 'Scale mail': 'Чешуйчатый доспех', Scimitar: 'Скимитар', Shield: 'Щит', Shortbow: 'Короткий лук', Shortsword: 'Короткий меч',
  Sickle: 'Серп', Sling: 'Праща', 'Sling bullets': 'Снаряды для пращи', Spear: 'Копьё', Splint: 'Наборный доспех', 'Studded leather': 'Проклёпанный кожаный доспех', Trident: 'Трезубец', 'War pick': 'Боевая кирка', Warhammer: 'Боевой молот', Whip: 'Кнут',
  Arrows: 'Стрелы', Crystal: 'Кристалл', Orb: 'Сфера', Rod: 'Жезл', Staff: 'Посох', Wand: 'Волшебная палочка', Amulet: 'Амулет', Emblem: 'Эмблема', Reliquary: 'Реликварий', 'Sprig of mistletoe': 'Веточка омелы', Totem: 'Тотем', 'Wooden staff': 'Деревянный посох', 'Yew wand': 'Тисовая палочка',
  'Burglar’s Pack': 'Набор взломщика', 'Diplomat’s Pack': 'Набор дипломата', 'Dungeoneer’s Pack': 'Набор исследователя подземелий', 'Entertainer’s Pack': 'Набор артиста', 'Explorer’s Pack': 'Набор путешественника', 'Priest’s Pack': 'Набор священника', 'Scholar’s Pack': 'Набор учёного',
};
const CONDITION_EN = { blinded: 'Blinded', charmed: 'Charmed', deafened: 'Deafened', frightened: 'Frightened', grappled: 'Grappled', incapacitated: 'Incapacitated', invisible: 'Invisible', paralyzed: 'Paralyzed', petrified: 'Petrified', poisoned: 'Poisoned', prone: 'Prone', restrained: 'Restrained', stunned: 'Stunned', unconscious: 'Unconscious', exhaustion: 'Exhaustion', concentration: 'Concentration' };

/** Количество записей раздела: точное — когда раздел загружен, иначе по известным размерам каталогов. */
export const COUNTS = { spells: 524, creatures: 334, classes: 12, races: 9, backgrounds: 2, equipment: 201, items: 934, rules: CONDITIONS.length + RULES.length };
