// TASK-083: бестиарий SRD 2014 для стола.
// Читает data/bestiary/bestiary-2014.json (каталог Яры, TASK-011) и пишет dist/js/data/bestiary-srd.js —
// существа со статблоками SRD в форме стола (как в dist/js/data/bestiary.js).
// Запуск: node tools/bestiary-srd.mjs [вход.json] [выход.js] [переводы.json]
// (без аргументов — пути по умолчанию; аргументы нужны тесту). Берёт ТОЛЬКО статблоки SRD (source = srd_api_2014):
// не-SRD существа в общий каталог сайта не попадают — только через личную библиотеку мастера (TASK-119, решение #116).
// Названия действий и особенностей — по-русски по словарю ниже (неизвестное осталось бы английским; сейчас переведено всё),
// desc — английский текст SRD 5.1 как есть; ru — самостоятельный перевод из srd-ru.json (TASK-117).
// Переведённые вручную существа стола не дублируются.
import { readFileSync, writeFileSync } from 'node:fs';
import { validateTranslations, translationFor } from './bestiary-srd-ru.mjs';

const root = new URL('../', import.meta.url);
const [inArg, outArg, ruArg] = process.argv.slice(2);
const src = JSON.parse(readFileSync(inArg || new URL('data/bestiary/bestiary-2014.json', root), 'utf8'));
const translations = JSON.parse(readFileSync(ruArg || new URL('data/bestiary/srd-ru.json', root), 'utf8'));
// Сначала проверяется весь канонический слой, включая HAND. Для тестового среза дополнительно
// проверяются все его SRD-описания; неиспользованные записи канонического перевода допустимы в срезе.
validateTranslations(inArg ? JSON.parse(readFileSync(new URL('data/bestiary/bestiary-2014.json', root), 'utf8')) : src, translations);
if (inArg) validateTranslations(src, translations, { allowUnused: true });
const HAND = new Set(['cultist', 'cult-fanatic', 'acolyte', 'goblin', 'hobgoblin', 'skeleton', 'zombie', 'wolf', 'bandit', 'giant-rat', 'ogre', 'gnoll']);

const TYPE = { beast: 'Зверь', humanoid: 'Гуманоид', dragon: 'Дракон', monstrosity: 'Чудовище', fiend: 'Исчадие', undead: 'Нежить', elemental: 'Элементаль', giant: 'Великан', 'swarm of Tiny beasts': 'Рой', construct: 'Конструкт', fey: 'Фея', plant: 'Растение', celestial: 'Небожитель', aberration: 'Аберрация', ooze: 'Слизь' };
const DMG = { piercing: 'колющий', slashing: 'рубящий', bludgeoning: 'дробящий', fire: 'огонь', poison: 'яд', acid: 'кислота', cold: 'холод', lightning: 'электричество', necrotic: 'некротический', radiant: 'излучение', psychic: 'психический', thunder: 'звук', force: 'силовое поле' };
const AB = { str: 'СИЛ', dex: 'ЛОВ', con: 'ТЕЛ', int: 'ИНТ', wis: 'МДР', cha: 'ХАР' };
const SENSE = { blindsight: 'слепое зрение', darkvision: 'тёмное зрение', tremorsense: 'чувство вибрации', truesight: 'истинное зрение' };

// Частые названия SRD → по-русски (по смыслу, не копия чужого перевода).
const NAME = {
  Multiattack: 'Мультиатака', Bite: 'Укус', Bites: 'Укусы', Claw: 'Коготь', Claws: 'Когти', Tail: 'Хвост', 'Frightful Presence': 'Ужасающее присутствие',
  'Breath Weapons': 'Оружие дыхания', Slam: 'Удар', Hooves: 'Копыта', Beak: 'Клюв', Shortsword: 'Короткий меч', Longsword: 'Длинный меч', Longbow: 'Длинный лук',
  'Change Shape': 'Смена облика', Rock: 'Камень', 'Fire Breath': 'Огненное дыхание', Scimitar: 'Скимитар', Spear: 'Копьё', Talons: 'Когти',
  Greataxe: 'Секира', Gore: 'Бодание', Dagger: 'Кинжал', Ram: 'Таран', 'Poison Breath': 'Ядовитое дыхание', 'Lightning Breath': 'Дыхание молнией',
  'Cold Breath': 'Ледяное дыхание', Javelin: 'Метательное копьё', Invisibility: 'Невидимость', Greatsword: 'Двуручный меч', Pseudopod: 'Ложноножка',
  Sting: 'Жало', Swallow: 'Проглатывание', Fist: 'Кулак', Teleport: 'Телепортация', Morningstar: 'Моргенштерн', Club: 'Дубинка', 'Hand Crossbow': 'Ручной арбалет',
  Shortbow: 'Короткий лук', 'Healing Touch': 'Исцеляющее касание', Mace: 'Булава', Tentacles: 'Щупальца', Constrict: 'Сжатие', 'Heavy Crossbow': 'Тяжёлый арбалет',
  'Acid Breath': 'Кислотное дыхание', 'Hurl Flame': 'Бросок пламени', Etherealness: 'Эфирность', Greatclub: 'Палица', Tentacle: 'Щупальце', 'Life Drain': 'Высасывание жизни',
  Charm: 'Очарование', Stomp: 'Топот', 'Steam Breath': 'Паровое дыхание', 'War Pick': 'Боевая кирка', Touch: 'Касание', Web: 'Паутина',
  'Illusory Appearance': 'Иллюзорный облик', 'Rotting Fist': 'Гниющий кулак', 'Dreadful Glare': 'Жуткий взгляд', Glaive: 'Глефа', Engulf: 'Поглощение',
  Horns: 'Рога', Horn: 'Рог', Tusk: 'Бивень', Tusks: 'Бивни', 'Ink Cloud': 'Чернильное облако', 'Light Crossbow': 'Лёгкий арбалет', Pincer: 'Клешня',
  'Children of the Night': 'Дети ночи', Maul: 'Молот', 'Blood Drain': 'Высасывание крови', 'Fey Charm': 'Чары феи', Enlarge: 'Увеличение', Whirlwind: 'Вихрь',
  Battleaxe: 'Боевой топор', Sling: 'Праща', Sword: 'Меч', Roar: 'Рёв', Haste: 'Ускорение', Slow: 'Замедление', Possession: 'Одержимость',
  'Lightning Strike': 'Удар молнии', 'Death Glare': 'Смертельный взгляд', 'Luring Song': 'Манящая песня', Fling: 'Бросок', 'Strength Drain': 'Высасывание силы',
  'Petrifying Breath': 'Окаменяющее дыхание', 'Frost Breath': 'Морозное дыхание', 'Blinding Breath': 'Ослепляющее дыхание', 'Spit Poison': 'Плевок ядом',
  'Tail Spike': 'Шип хвоста', 'Tail Stinger': 'Жало хвоста', Harpoon: 'Гарпун', 'Snake Hair': 'Змеиные волосы', 'Tentacle Slam': 'Удар щупальцем',
  'Draining Kiss': 'Иссушающий поцелуй', 'Paralyzing Touch': 'Парализующее касание', 'Withering Touch': 'Иссушающее касание', 'Horrifying Visage': 'Ужасающий облик',
  Detect: 'Обнаружение', 'Tail Attack': 'Атака хвостом', 'Wing Attack': 'Атака крыльями', 'Wing Attack (Costs 2 Actions)': 'Атака крыльями (2 действия)',
  Parry: 'Парирование', 'Unnerving Mask': 'Пугающая маска', 'Slippery Bladder': 'Скользкий пузырь',
  // особенности
  'Magic Resistance': 'Сопротивление магии', Amphibious: 'Амфибия', 'Legendary Resistance': 'Легендарное сопротивление', 'Legendary Resistance (3/Day)': 'Легендарное сопротивление (3/день)',
  'Innate Spellcasting': 'Врождённое колдовство', Shapechanger: 'Перевёртыш', 'Keen Smell': 'Острый нюх', 'Keen Hearing and Smell': 'Острый слух и нюх',
  'Pack Tactics': 'Тактика стаи', 'False Appearance': 'Обманчивая внешность', 'Spider Climb': 'Паучье лазание', 'Magic Weapons': 'Магическое оружие',
  Spellcasting: 'Использование заклинаний', Charge: 'Натиск', Swarm: 'Рой', 'Water Breathing': 'Подводное дыхание', 'Hold Breath': 'Задержка дыхания',
  "Devil's Sight": 'Дьявольское зрение', 'Sunlight Sensitivity': 'Чувствительность к солнцу', 'Web Walker': 'Хождение по паутине', 'Keen Sight': 'Острое зрение',
  Regeneration: 'Регенерация', Pounce: 'Наскок', 'Web Sense': 'Чувство паутины', 'Stone Camouflage': 'Каменный камуфляж', 'Trampling Charge': 'Сбивающий натиск',
  'Death Burst': 'Предсмертный взрыв', 'Blood Frenzy': 'Кровавое бешенство', Echolocation: 'Эхолокация', Relentless: 'Неутомимость', 'Siege Monster': 'Осадное чудище',
  Illumination: 'Свечение', 'Incorporeal Movement': 'Бестелесное движение', 'Immutable Form': 'Неизменный облик', Rejuvenation: 'Восстановление', Amorphous: 'Аморфность',
  'Vampire Weaknesses': 'Слабости вампира', 'Standing Leap': 'Прыжок с места', 'Keen Hearing': 'Острый слух', 'Ice Walk': 'Ход по льду', 'Keen Sight and Smell': 'Острое зрение и нюх',
  'Heated Body': 'Раскалённое тело', 'Angelic Weapons': 'Ангельское оружие', Flyby: 'Облёт', 'Keen Hearing and Sight': 'Острый слух и зрение',
  'Antimagic Susceptibility': 'Уязвимость к антимагии', 'Sure-Footed': 'Устойчивость', 'Misty Escape': 'Туманное бегство', 'Dark Devotion': 'Тёмная преданность',
  Brute: 'Громила', 'Surprise Attack': 'Внезапная атака', 'Fey Ancestry': 'Наследие фей', 'Earth Glide': 'Скольжение сквозь землю', Wakeful: 'Бдительность',
  'Elemental Demise': 'Гибель элементаля', Stench: 'Вонь', Rampage: 'Буйство', Berserk: 'Берсерк', 'Lightning Absorption': 'Поглощение молний', Mimicry: 'Подражание',
  'Telepathic Bond': 'Телепатическая связь', 'Petrifying Gaze': 'Окаменяющий взгляд', 'Limited Telepathy': 'Ограниченная телепатия', 'Heated Weapons': 'Раскалённое оружие',
  Inscrutable: 'Непроницаемость', 'Undead Fortitude': 'Стойкость нежити', 'Divine Awareness': 'Божественное чутьё', 'Underwater Camouflage': 'Подводный камуфляж',
  'Damage Transfer': 'Перенос урона', Reckless: 'Безрассудство', Brave: 'Храбрость', 'Sneak Attack (1/Turn)': 'Скрытая атака (1/ход)', 'Air Form': 'Воздушный облик',
  'Fire Form': 'Огненный облик', 'Water Form': 'Водный облик', Freeze: 'Заморозка', 'Water Susceptibility': 'Уязвимость к воде', 'Tree Stride': 'Шаг сквозь деревья',
  'Speak with Beasts and Plants': 'Речь зверей и растений', 'Duergar Resilience': 'Стойкость дуэргара', 'Martial Advantage': 'Боевое превосходство', 'Nimble Escape': 'Шустрый побег',
  Aggressive: 'Агрессивность', 'Turn Defiance': 'Сопротивление изгнанию', 'Turn Immunity': 'Иммунитет к изгнанию', 'Magic Resistance.': 'Сопротивление магии',
  // остальное (TASK-083: полный охват)
  'Unarmed Strike': 'Безоружный удар', Move: 'Перемещение', 'Claw Attack': 'Атака когтем', 'Cast a Spell': 'Сотворение заклинания', Split: 'Разделение',
  Attack: 'Атака', Enslave: 'Порабощение', 'Tail Swipe': 'Взмах хвостом', 'Psychic Drain': 'Психическое высасывание', 'Mucous Cloud': 'Облако слизи',
  'Probing Telepathy': 'Зондирующая телепатия', 'Acid Spray': 'Кислотные брызги', Whip: 'Кнут', 'Death Throes': 'Предсмертная агония', 'Fire Aura': 'Огненная аура',
  Shock: 'Разряд', 'Consume Life': 'Поглощение жизни', Ephemeral: 'Эфемерность', 'Variable Illumination': 'Переменное свечение', 'Blinding Spittle': 'Ослепляющий плевок',
  'Aberrant Ground': 'Искажённая земля', Gibbering: 'Бормотание', Beard: 'Борода', Steadfast: 'Непоколебимость', Tendril: 'Усик', Reel: 'Подтягивание',
  'Grasping Tendrils': 'Хватающие усики', Stinger: 'Жало', Shriek: 'Визг', Whelm: 'Захлёстывание', Spores: 'Споры', 'Stunning Screech': 'Оглушающий визг',
  'Multiple Heads': 'Много голов', 'Reactive Heads': 'Бдительные головы', 'Shield Bash': 'Удар щитом', 'Acid Absorption': 'Поглощение кислоты',
  'Poisoned Dart': 'Отравленный дротик', 'Gnome Cunning': 'Гномья хитрость', 'Spiked Bone Club': 'Шипастая костяная дубина', 'Blind Senses': 'Слепые чувства',
  Rapier: 'Рапира', 'Create Whirlwind': 'Создание вихря', 'Read Thoughts': 'Чтение мыслей', Ambusher: 'Засадник', 'Fetid Cloud': 'Зловонное облако',
  Quarterstaff: 'Боевой посох', Chain: 'Цепь', 'Animate Chains': 'Оживление цепей', 'Shimmering Shield': 'Мерцающий щит', 'Heal Self': 'Самоисцеление',
  'Fire Absorption': 'Поглощение огня', 'Invisible Passage': 'Невидимый проход', 'Treasure Sense': 'Чутьё на сокровища', 'Fear Aura': 'Аура страха',
  'Ethereal Jaunt': 'Эфирный скачок', 'Rock Catching': 'Ловля камней', Scare: 'Испуг', Pike: 'Пика', 'Shielded Mind': 'Защищённый разум', Smother: 'Удушение',
  'Ethereal Stride': 'Эфирный шаг', 'Confer Fire Resistance': 'Дар сопротивления огню', 'Lightning Storm': 'Грозовая буря', 'Tentacle Attack or Fling': 'Щупальце или бросок',
  'Freedom of Movement': 'Свобода перемещения', 'Intoxicating Touch': 'Пьянящее касание', 'Running Leap': 'Прыжок с разбега', 'Wall of Ice': 'Ледяная стена',
  'Hellish Rejuvenation': 'Адское восстановление', 'Rotting Touch': 'Гниющее касание', Tunneler: 'Землекоп', Cantrip: 'Заговор', 'Frightening Gaze': 'Пугающий взгляд',
  'Disrupt Life': 'Разрушение жизни', 'Turn Resistance': 'Сопротивление изгнанию', 'Blinding Dust': 'Ослепляющая пыль', 'Blasphemous Word': 'Богохульное слово',
  'Channel Negative Energy': 'Поток отрицательной энергии', 'Whirlwind of Sand': 'Песчаный вихрь', 'Heavy Club': 'Тяжёлая дубина', 'Spiked Shield': 'Шипастый щит',
  'Ignited Illumination': 'Разгорающееся свечение', 'Tail Spike Regrowth': 'Отрастание шипов', Reactive: 'Бдительность', 'Adhesive (Object Form Only)': 'Клейкость (только в облике предмета)',
  Grappler: 'Борец', 'Labyrinthine Recall': 'Память лабиринта', 'Horrific Appearance': 'Жуткая внешность', 'Beast of Burden': 'Вьючное животное', 'Aversion of Fire': 'Боязнь огня',
  Assassinate: 'Убийство', Evasion: 'Увёртливость', 'Horror Nimbus': 'Ореол ужаса', 'Faultless Tracker': 'Безошибочный следопыт', 'Nightmare Haunting': 'Кошмарные визиты',
  'Night Hag Items': 'Предметы ночной карги', 'Deadly Leap': 'Смертельный прыжок', 'Two-Headed': 'Двухголовость', Moan: 'Стон', Phantasms: 'Фантазмы',
  'Light Sensitivity': 'Чувствительность к свету', 'Snow Camouflage': 'Снежный камуфляж', 'Ethereal Sight': 'Эфирное зрение', 'Create Specter': 'Создание призрака', Rake: 'Раздирание',
  'Keen Senses': 'Острые чувства', 'Limited Magic Immunity': 'Ограниченный иммунитет к магии', Antennae: 'Усики', 'Iron Scent': 'Нюх на железо', 'Rust Metal': 'Ржавление металла',
  Fork: 'Вилы', Beaks: 'Клювы', Leadership: 'Лидерство', 'Limited Amphibiousness': 'Ограниченная амфибийность', 'Shark Telepathy': 'Акулья телепатия',
  'Divine Eminence': 'Божественное величие', 'Corrode Metal': 'Разъедание металла', 'Slaying Longbow': 'Убийственный длинный лук', 'Flying Sword': 'Летающий меч',
  'Searing Burst': 'Обжигающая вспышка', 'Blinding Gaze': 'Ослепляющий взгляд', 'Heart Sight': 'Зрение сердца', 'Ooze Cube': 'Слизистый куб', Transparent: 'Прозрачность',
  Chomp: 'Укус', 'Reflective Carapace': 'Отражающий панцирь', Crush: 'Сокрушение', 'Darkness Aura': 'Аура тьмы', 'Shadow Stealth': 'Скрытность в тенях',
  'Sunlight Weakness': 'Слабость на солнце', 'Animate Trees': 'Оживление деревьев', 'Corrosive Form': 'Едкое тело', 'Sense Magic': 'Чувство магии', 'Barbed Hide': 'Колючая шкура',
  'Cunning Action': 'Хитрое действие', Bound: 'Привязанность', 'Spell Storing': 'Хранение заклинания', Shield: 'Щит', Warhammer: 'Боевой молот', 'Hellish Weapons': 'Адское оружие',
  'Two Heads': 'Две головы',
};
// «(Costs 2 Actions)» и прочие пометки в скобках.
const FORM = { Hag: 'карги', Oni: 'они', Fiend: 'исчадия', Object: 'предмета', 'Boar or Hybrid': 'кабана или гибрида' };
const PAREN = (p) => p.replace(/\(Costs (\d) Actions\)/i, (_, n) => `(${n} действия)`).replace(/\((\d)\/Day\)/i, '($1/день)').replace(/\((\d)\/Turn\)/i, '($1/ход)')
  .replace(/\((.+) Form Only\)/i, (all, f) => (FORM[f] ? `(только в облике ${FORM[f]})` : all)).replace(/\(Bite in Beast Form\)/i, '(в облике зверя — укус)');
const ru = (en) => {
  const s = String(en);
  if (NAME[s]) return NAME[s];
  const m = s.match(/^(.*?)\s*(\(.*\))$/);
  if (m && NAME[m[1]]) return `${NAME[m[1]]} ${PAREN(m[2])}`;
  return s;
};

// Существа SRD без русского имени в индексе (формы, рои, вариации) — свои имена.
const MONSTER_RU = {
  'deep-gnome-svirfneblin': 'Глубинный гном (свирфнеблин)', 'giant-rat-diseased': 'Гигантская крыса (больная)', 'half-red-dragon-veteran': 'Ветеран-полудракон (красный)',
  'swarm-of-bats': 'Рой летучих мышей', 'swarm-of-beetles': 'Рой жуков', 'swarm-of-centipedes': 'Рой многоножек', 'swarm-of-insects': 'Рой насекомых',
  'swarm-of-poisonous-snakes': 'Рой ядовитых змей', 'swarm-of-quippers': 'Рой пираний', 'swarm-of-rats': 'Рой крыс', 'swarm-of-ravens': 'Рой воронов',
  'swarm-of-spiders': 'Рой пауков', 'swarm-of-wasps': 'Рой ос',
  'vampire-bat': 'Вампир (облик летучей мыши)', 'vampire-mist': 'Вампир (облик тумана)', 'vampire-vampire': 'Вампир (облик вампира)',
  'werebear-bear': 'Медведь-оборотень (облик медведя)', 'werebear-human': 'Медведь-оборотень (облик человека)', 'werebear-hybrid': 'Медведь-оборотень (гибрид)',
  'wereboar-boar': 'Кабан-оборотень (облик кабана)', 'wereboar-human': 'Кабан-оборотень (облик человека)', 'wereboar-hybrid': 'Кабан-оборотень (гибрид)',
  'wererat-human': 'Крыса-оборотень (облик человека)', 'wererat-hybrid': 'Крыса-оборотень (гибрид)', 'wererat-rat': 'Крыса-оборотень (облик крысы)',
  'weretiger-human': 'Тигр-оборотень (облик человека)', 'weretiger-hybrid': 'Тигр-оборотень (гибрид)', 'weretiger-tiger': 'Тигр-оборотень (облик тигра)',
  'werewolf-human': 'Волк-оборотень (облик человека)', 'werewolf-hybrid': 'Волк-оборотень (гибрид)', 'werewolf-wolf': 'Волк-оборотень (облик волка)',
};

const cr = (s, cat) => cat?.challenge_rating?.text || ({ 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' }[s.challenge_rating] ?? String(s.challenge_rating));
const ft = (x) => x?.distance?.value ?? null;
const shortAb = (idx) => AB[String(idx || '').slice(0, 3)] || String(idx || '').toUpperCase();

function action(a, monsterId, section) {
  const dmg = (a.damage || []).filter((d) => d.formula);
  const first = dmg[0];
  const parts = [];
  if (a.attack?.reach?.value) parts.push(`досягаемость ${a.attack.reach.value} фт`);
  if (a.attack?.range?.normal) parts.push(`дальность ${a.attack.range.normal}${a.attack.range.long ? `/${a.attack.range.long}` : ''} фт`);
  if (a.saving_throw?.dc_value) parts.push(`спасбросок ${shortAb(a.saving_throw.dc_type?.index)} СЛ ${a.saving_throw.dc_value}${a.saving_throw.success_type === 'half' ? ', успех — половина' : ''}`);
  if (dmg.length > 1) parts.push(dmg.slice(1).map((d) => `+ ${d.formula.replace(/d/g, 'к')} ${DMG[d.type] || d.type || ''}`.trim()).join(' '));
  if (a.usage?.type === 'recharge on roll' || a.usage?.min_value) parts.push(`перезарядка ${a.usage.min_value || ''}\u2060–\u20606`);
  else if (a.usage?.times) parts.push(`${a.usage.times}/${a.usage.type === 'per day' ? 'день' : 'отдых'}`);
  const out = { name: ru(a.name_en), bonus: a.attack?.bonus ?? 0, damage: first ? first.formula : '', type: first ? (DMG[first.type] || first.type || '') : '', note: parts.join(' · ') };
  if (a.description_en) out.desc = a.description_en;
  out.ru = translationFor(translations, monsterId, section, a);
  return out;
}

const list = [];
for (const m of src.monsters) {
  const s = m.stat_block; if (!s || s.source !== 'srd_api_2014') continue; // только SRD 5.1
  const slug = m.identity?.srd_index || m.identity?.slug;
  if (!slug || HAND.has(slug)) continue;
  const id = `srd:${slug}`;
  if (list.some((x) => x.id === id)) continue;
  const ab = s.abilities || {};
  const stats = { str: ab.strength?.score ?? 10, dex: ab.dexterity?.score ?? 10, con: ab.constitution?.score ?? 10, int: ab.intelligence?.score ?? 10, wis: ab.wisdom?.score ?? 10, cha: ab.charisma?.score ?? 10 };
  const saves = {};
  for (const p of [...(s.saving_throws || []), ...(s.proficiencies || [])]) {
    const idx = p.proficiency?.index || '';
    if (idx.startsWith('saving-throw-')) saves[idx.slice(13)] = p.value;
  }
  const senses = Object.entries(s.senses || {}).filter(([k]) => SENSE[k]).map(([k, v]) => `${SENSE[k]} ${ft(v) ?? ''} фт`.replace('  ', ' '));
  if (s.senses?.passive_perception != null) senses.push(`пассивное Восприятие ${s.senses.passive_perception}`);
  const other = Object.entries(s.speed || {}).filter(([k]) => k !== 'walk' && ft(s.speed[k])).map(([k, v]) => `${{ fly: 'летая', swim: 'плавая', climb: 'лазая', burrow: 'копая' }[k] || k} ${ft(v)} фт`);
  // Особенность/реакция: { name — по-русски, en — как в SRD, desc — английский текст SRD }.
  const trait = (a, section) => ({ name: ru(a.name_en), en: a.name_en, desc: a.description_en || '', ru: translationFor(translations, m.id, section, a) });
  const out = {
    id, name: m.name?.ru || MONSTER_RU[slug] || s.name_en, en: s.name_en, type: TYPE[s.type] || s.type, size: s.size, cr: cr(s, m.catalogue),
    ac: s.armor_class?.[0]?.value ?? 10, hp: s.hit_points?.average ?? 1, hpDice: s.hit_points?.formula || s.hit_points?.hit_dice || '',
    speed: ft(s.speed?.walk) ?? 0, stats, img: `ini:${m.name?.ru || MONSTER_RU[slug] || s.name_en}`, init: Math.floor((stats.dex - 10) / 2),
    darkvision: ft(s.senses?.darkvision) || 0, senses: [...(other.length ? [`скорость: ${other.join(', ')}`] : []), ...senses].join(', '),
    traits: (s.special_abilities || []).map((a) => trait(a, 'special_abilities')),
    actions: (s.actions || []).map((a) => action(a, m.id, 'actions')),
    srd: true,
  };
  if (Object.keys(saves).length) out.saves = saves;
  if (s.reactions?.length) out.reactions = s.reactions.map((a) => trait(a, 'reactions'));
  if (s.legendary_actions?.length) out.legendary = s.legendary_actions.map((a) => action(a, m.id, 'legendary_actions'));
  list.push(out);
}
list.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

const head = `// СГЕНЕРИРОВАНО tools/bestiary-srd.mjs из data/bestiary/bestiary-2014.json (TASK-083) — не править руками.
// Существа со статблоками SRD 5.1. This work includes material taken from the System Reference Document 5.1
// ("SRD 5.1") by Wizards of the Coast LLC, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/legalcode).
// Адаптация: числа и английские описания SRD; русские имена существ — из открытого индекса dnd.su (каталог TASK-011),
// русские названия действий и особенностей — свои; ru — самостоятельный перевод английского SRD (TASK-117).
// Английский desc сохранён. ${list.length} существ.
`;
writeFileSync(outArg || new URL('dist/js/data/bestiary-srd.js', root), `${head}export default ${JSON.stringify(list)};\n`);
const named = list.flatMap((m) => [...m.actions, ...m.traits, ...(m.reactions || []), ...(m.legendary || [])]);
console.log('существ:', list.length, 'названий по-русски:', named.filter((a) => /[а-яё]/i.test(a.name)).length, '/', named.length);
