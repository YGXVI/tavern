// Демонстрационные данные: аккаунты-заглушки, кампании, сцены, герои и враги из макетов.
// Используются при первом запуске и при «Сбросить демо». Реальных людей и личных данных здесь нет.
import { uid } from '../core/dom.js';
import { monsterById } from './bestiary.js';
import { mod, profBonus } from './rules.js';

const now = Date.now();
const DAY = 86400000;

export const DEMO_USERS = [
  { id: 'u-sol', name: 'sol0139', handle: 'sol0139', hue: 32 },
  { id: 'u-asya', name: 'Ася', handle: 'asya.rolls', hue: 205 },
  { id: 'u-yara', name: 'Яра', handle: 'ygxvi', hue: 140 },
  { id: 'u-timur', name: 'Тимур', handle: 'timur.exe', hue: 0 },
  { id: 'u-nika', name: 'Ника', handle: 'nika_dnd', hue: 280 },
  { id: 'u-roma', name: 'Рома', handle: 'roma_bard', hue: 90 },
];

export function makeCharacter(o) {
  const level = o.level || 1;
  return {
    id: o.id || uid('ch-'),
    ownerId: o.ownerId || null,
    name: o.name || 'Новый герой',
    portrait: o.portrait || null,
    classId: o.classId || 'fighter',
    className: o.className || 'Воин',
    raceId: o.raceId || 'human',
    raceName: o.raceName || 'Человек',
    level,
    background: o.background || '',
    alignment: o.alignment || '',
    stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...(o.stats || {}) },
    saves: o.saves || [],
    skills: o.skills || [],
    ac: o.ac ?? 10,
    hpMax: o.hpMax ?? 10,
    hp: o.hp ?? o.hpMax ?? 10,
    tempHp: 0,
    speed: o.speed ?? 30,
    darkvision: o.darkvision ?? 0,
    hitDice: `${level}к${o.hd || 8}`,
    deathSaves: { s: 0, f: 0 },
    conditions: [],
    attacks: o.attacks || [],
    slots: o.slots || {},
    spells: o.spells || '',
    inventory: o.inventory || '',
    features: o.features || '',
    notes: o.notes || '',
    initBonus: o.initBonus ?? mod(o.stats?.dex ?? 10),
    profBonus: profBonus(level),
    light: o.light || null,
    aura: o.aura || null,
  };
}

const HEROES = {
  lira: () => makeCharacter({
    id: 'ch-lira', name: 'Лира', portrait: 'lira', classId: 'wizard', className: 'Волшебница', raceId: 'halfelf', raceName: 'Полуэльфийка', level: 5, hd: 6,
    background: 'Мудрец', alignment: 'Нейтрально-добрая',
    stats: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 12 }, saves: ['int', 'wis'], skills: ['arcana', 'history', 'investigation', 'insight'],
    ac: 13, hpMax: 22, hp: 17, speed: 30, darkvision: 60,
    attacks: [
      { name: 'Огненный снаряд', bonus: 7, damage: '2d10', type: 'огонь', note: 'заговор, 120 фт' },
      { name: 'Кинжал', bonus: 5, damage: '1d4+2', type: 'колющий', note: 'фехтовальное, метательное' },
    ],
    slots: { 1: { max: 4, used: 1 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } },
    spells: 'Заговоры: Огненный снаряд, Свет, Волшебная рука, Луч холода\n1: Щит, Волшебная стрела, Маскировка\n2: Туманный шаг, Паутина\n3: Огненный шар, Контрзаклинание',
    inventory: 'Книга заклинаний, магическая фокусировка (жезл), кинжал, мешочек с компонентами, 23 зм',
    features: 'Магическое восстановление. Школа воплощения: безопасные заклинания для союзников.',
  }),
  torin: () => makeCharacter({
    id: 'ch-torin', name: 'Торин', portrait: 'torin', classId: 'fighter', className: 'Воин', raceId: 'dwarf', raceName: 'Дварф', level: 5, hd: 10,
    background: 'Солдат', alignment: 'Законно-нейтральный',
    stats: { str: 16, dex: 12, con: 16, int: 10, wis: 12, cha: 8 }, saves: ['str', 'con'], skills: ['athletics', 'intimidation', 'perception', 'survival'],
    ac: 18, hpMax: 38, hp: 29, speed: 25, darkvision: 60, initBonus: 1,
    attacks: [
      { name: 'Боевой топор', bonus: 6, damage: '1d8+3', type: 'рубящий', note: 'универсальное (1d10)' },
      { name: 'Метательный топорик', bonus: 6, damage: '1d6+3', type: 'рубящий', note: '20/60 фт' },
    ],
    inventory: 'Кольчуга, щит, боевой топор, 2 топорика, факелы (5), верёвка 50 фт',
    features: 'Боевой стиль: оборона. Второе дыхание. Всплеск действий. Дополнительная атака.',
    light: { preset: 'torch', bright: 20, dim: 20, color: 'warm', flicker: true },
  }),
  garr: () => makeCharacter({
    id: 'ch-garr', name: 'Гарр', portrait: 'garr', classId: 'barbarian', className: 'Варвар', raceId: 'halforc', raceName: 'Полуорк', level: 5, hd: 12,
    background: 'Чужеземец', alignment: 'Хаотично-добрый',
    stats: { str: 17, dex: 14, con: 16, int: 8, wis: 12, cha: 10 }, saves: ['str', 'con'], skills: ['athletics', 'intimidation', 'survival', 'perception'],
    ac: 15, hpMax: 52, hp: 40, speed: 40, darkvision: 60, initBonus: 2,
    attacks: [{ name: 'Секира', bonus: 6, damage: '1d12+3', type: 'рубящий', note: 'двуручное, тяжёлое' }, { name: 'Метательное копьё', bonus: 6, damage: '1d6+3', type: 'колющий', note: '30/120 фт' }],
    inventory: 'Секира, 4 метательных копья, набор путешественника, волчья шкура',
    features: 'Ярость (3/день). Безрассудная атака. Чувство опасности. Дополнительная атака. Быстрое передвижение.',
  }),
  elian: () => makeCharacter({
    id: 'ch-elian', name: 'Элиан', portrait: 'elian', classId: 'ranger', className: 'Следопыт', raceId: 'elf', raceName: 'Лесной эльф', level: 5, hd: 10,
    background: 'Отшельник', alignment: 'Нейтрально-добрый',
    stats: { str: 12, dex: 17, con: 13, int: 10, wis: 14, cha: 10 }, saves: ['str', 'dex'], skills: ['stealth', 'perception', 'survival', 'nature'],
    ac: 15, hpMax: 31, hp: 31, speed: 35, darkvision: 60,
    attacks: [{ name: 'Длинный лук', bonus: 6, damage: '1d8+3', type: 'колющий', note: '150/600 фт' }, { name: 'Короткий меч', bonus: 6, damage: '1d6+3', type: 'колющий', note: 'фехтовальное' }],
    slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } },
    spells: '1: Метка охотника, Лечение ран\n2: Бесследное передвижение',
    inventory: 'Кожаный доспех, длинный лук, 40 стрел, 2 коротких меча',
    features: 'Избранный враг: нежить. Исследователь природы. Дополнительная атака.',
  }),
  mira: () => makeCharacter({
    id: 'ch-mira', name: 'Мира', portrait: 'mira', classId: 'cleric', className: 'Жрица', raceId: 'human', raceName: 'Человек', level: 5, hd: 8,
    background: 'Прислужница', alignment: 'Законно-добрая',
    stats: { str: 14, dex: 10, con: 14, int: 10, wis: 17, cha: 12 }, saves: ['wis', 'cha'], skills: ['medicine', 'religion', 'insight', 'persuasion'],
    ac: 16, hpMax: 26, hp: 26, speed: 30, darkvision: 0, initBonus: 0,
    attacks: [{ name: 'Булава', bonus: 5, damage: '1d6+2', type: 'дробящий' }, { name: 'Священное пламя', bonus: 0, damage: '2d8', type: 'излучение', note: 'спасбросок ЛОВ СЛ 14' }],
    slots: { 1: { max: 4, used: 1 }, 2: { max: 3, used: 1 }, 3: { max: 2, used: 1 } },
    spells: 'Заговоры: Священное пламя, Указание, Свет\n1: Лечение ран, Благословение, Щит веры\n2: Духовное оружие, Малое восстановление\n3: Духовные стражи, Возрождение',
    inventory: 'Чешуйчатый доспех, щит, булава, священный символ солнца',
    features: 'Домен Света: Вспышка защиты. Божественный канал: Изгнание нежити, Сияние рассвета.',
    aura: { name: 'Духовные стражи', radius: 15, color: 'magic', concentration: true, text: 'Враги в 15 фт от Миры двигаются вдвое медленнее. В начале их хода — спасбросок Мудрости или 3к8 излучением.' },
  }),
};

function heroToken(ch, c, r, grid) {
  return {
    id: uid('t-'), kind: 'hero', characterId: ch.id, name: ch.name, img: ch.portrait, size: 'medium',
    x: (c + 0.5) * grid.size + (grid.offsetX || 0), y: (r + 0.5) * grid.size + (grid.offsetY || 0),
    hidden: false, conditions: [], light: ch.light || null, aura: ch.aura || null,
  };
}

export function monsterToken(monsterId, name, c, r, grid, extra = {}) {
  const m = monsterById(monsterId);
  const n = { tiny: 1, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 }[m.size] || 1;
  return {
    id: uid('t-'), kind: 'foe', monsterId, name, img: m.img, size: m.size,
    x: (c + n / 2) * grid.size + (grid.offsetX || 0), y: (r + n / 2) * grid.size + (grid.offsetY || 0),
    hp: m.hp, hpMax: m.hp, tempHp: 0, ac: m.ac, initBonus: m.init, speed: m.speed, darkvision: m.darkvision || 0,
    hidden: false, conditions: [], light: null, aura: null, ...extra,
  };
}

const W = (x1, y1, x2, y2, kind = 'wall', extra = {}) => ({ id: uid('w-'), a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, kind, open: false, locked: false, ...extra });

function cryptWalls() {
  return [
    // Зал
    W(288, 186, 708, 186),
    W(288, 186, 288, 570), W(288, 570, 288, 640, 'door', { name: 'Дверь в зал' }), W(288, 640, 288, 1030),
    W(708, 186, 708, 565), W(708, 565, 708, 635, 'door', { name: 'Дверь в галерею' }), W(708, 635, 708, 1030),
    W(288, 410, 470, 410), W(470, 410, 520, 410, 'door', { locked: true, name: 'Дверь к алтарю', lockDc: 15 }), W(520, 410, 708, 410),
    W(288, 800, 470, 800), W(470, 800, 520, 800, 'door', { name: 'Дверь на юг' }), W(520, 800, 708, 800),
    W(288, 1030, 368, 1030), W(635, 1030, 708, 1030),
    W(368, 1030, 368, 1145), W(368, 1145, 635, 1145), W(635, 1145, 635, 1030),
    W(400, 800, 400, 1030), W(595, 800, 595, 1030), W(288, 905, 400, 905), W(595, 905, 708, 905),
    // Левое крыло
    W(95, 262, 288, 262),
    W(95, 262, 95, 340), W(0, 340, 95, 340), W(0, 410, 95, 410), W(95, 410, 95, 492),
    W(0, 492, 160, 492), W(205, 492, 288, 492),
    W(95, 492, 95, 560), W(95, 650, 95, 720),
    W(0, 720, 160, 720), W(205, 720, 288, 720),
    W(95, 720, 95, 800), W(0, 800, 95, 800), W(0, 880, 95, 880), W(95, 880, 95, 955),
    W(95, 955, 288, 955),
    // Галерея справа
    W(708, 300, 850, 300),
    W(850, 108, 850, 335), W(850, 335, 850, 375, 'door', { name: 'Дверь в святилище' }), W(850, 375, 850, 835),
    W(850, 835, 850, 875, 'secret', { name: 'Потайная дверь', perceptionDc: 14 }), W(850, 875, 850, 1110),
    W(708, 910, 850, 910),
    // Святилище
    W(850, 108, 1185, 108), W(850, 1110, 1185, 1110),
    W(850, 757, 975, 757), W(1010, 757, 1185, 757),
    W(1010, 757, 1010, 925), W(1010, 990, 1010, 1090),
  ];
}

const L = (x, y, preset = 'torch', bright = 20, dim = 20, extra = {}) => ({ id: uid('l-'), x, y, preset, bright, dim, color: 'warm', flicker: true, ...extra });

export function makeScene(o) {
  return {
    id: o.id || uid('s-'),
    name: o.name || 'Новая сцена',
    note: o.note || '',
    status: o.status || 'ready',
    map: o.map,
    grid: { size: 70, offsetX: 0, offsetY: 0, feet: 5, visible: true, ...(o.grid || {}) },
    lighting: o.lighting || 'bright',
    fog: { mode: 'off', ops: [], explored: [], ...(o.fog || {}) },
    walls: o.walls || [],
    lights: o.lights || [],
    terrain: o.terrain || { difficult: [], blocked: [] },
    tokens: o.tokens || [],
    drawings: [],
    pins: o.pins || [],
    portals: o.portals || [],
    traps: o.traps || [],
    createdAt: now,
  };
}

function cryptScene(chars) {
  const grid = { size: 74.0625, offsetX: 0, offsetY: 0, feet: 5, visible: true };
  const [lira, torin, garr, elian, mira] = chars;
  return makeScene({
    id: 's-crypt', name: 'Склеп культа', note: '16×17 клеток · бой с культистами',
    map: { src: 'map:crypt', width: 1185, height: 1259 }, grid, lighting: 'dark',
    fog: { mode: 'vision', ops: [], explored: [] },
    walls: cryptWalls(),
    lights: [
      L(330, 440), L(670, 440), L(330, 770), L(670, 770),
      L(268, 545, 'candle', 5, 5), L(268, 668, 'candle', 5, 5),
      L(838, 470), L(838, 740),
      L(1150, 600, 'campfire', 10, 10),
      L(495, 235, 'candle', 5, 10, { color: 'magic' }),
    ],
    terrain: { difficult: ['2,5', '3,5', '2,6', '3,6', '4,9', '4,10'], blocked: ['5,7', '6,7', '7,7', '5,8', '6,8', '7,8'] },
    tokens: [
      heroToken(mira, 2, 7, grid), heroToken(garr, 3, 7, grid), heroToken(lira, 2, 8, grid), heroToken(torin, 3, 8, grid), heroToken(elian, 2, 9, grid),
      monsterToken('cult-fanatic', 'Жрец культа', 6, 6, grid),
      monsterToken('cultist', 'Культист 1', 4, 8, grid),
      monsterToken('cultist', 'Культист 2', 8, 8, grid),
      monsterToken('goblin', 'Гоблин 1', 5, 10, grid),
      monsterToken('goblin', 'Гоблин 2', 8, 10, grid),
      monsterToken('ogre', 'Огр-страж', 6, 11, grid, { hidden: true }),
      monsterToken('faceless-spawn', 'Порождение Безликого', 12, 3, grid, { hidden: true }),
    ],
    pins: [
      { id: uid('p-'), x: 495, y: 300, kind: 'read-aloud', title: 'Алтарь Безликого', text: 'На чёрном камне лежит гладкая маска без лица. Свечи вокруг горят ровно, хотя по склепу гуляет сквозняк. Чем дольше смотришь на маску, тем сильнее кажется, что она смотрит в ответ.', shown: false },
      { id: uid('p-'), x: 470, y: 520, kind: 'secret', title: 'Ключ у жреца', text: 'Ключ от двери к алтарю висит на шее Жреца культа. СЛ 15 на взлом.', shown: false },
    ],
    portals: [
      { id: uid('g-'), x: 780, y: 862, name: 'Лестница вниз', targetSceneId: 's-cave', target: { x: 180, y: 900 }, mode: 'ask', label: 'Пещера гоблинов' },
    ],
    traps: [
      { id: uid('tr-'), cells: ['10,8'], name: 'Яма с кольями', save: 'dex', dc: 13, damage: '2d10', hidden: true, triggered: false, note: 'После срабатывания станет обычной ямой' },
    ],
  });
}

function simpleScene(id, name, map, cells, note, extra = {}) {
  const size = map.width / cells;
  return makeScene({ id, name, note, map, grid: { size, offsetX: 0, offsetY: 0, feet: 5, visible: true }, ...extra });
}

function campaign(o) {
  return {
    id: o.id, name: o.name, description: o.description || '', cover: o.cover || 'map:crypt',
    level: o.level || 1, seats: o.seats || 6, createdAt: o.createdAt || now, ownerId: o.ownerId,
    status: o.status || 'active',
    members: o.members || [],
    invite: { code: o.code || makeInviteCode(), expiresAt: now + 7 * DAY, manual: true },
    characters: o.characters || [],
    scenes: o.scenes || [],
    activeSceneId: o.activeSceneId || null,
    combat: { active: false, round: 1, turn: 0, entries: [], moved: {} },
    paused: null,
    log: o.log || [],
    settings: { diagonal: '5', sharedVision: true, playersSeeHp: 'status', autoMonsterHp: false, ...(o.settings || {}) },
  };
}

export function makeInviteCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = crypto.getRandomValues(new Uint32Array(4));
  return 'RSP-' + [...a].map((x) => abc[x % abc.length]).join('');
}

export function newCampaign({ name, description, cover, level, seats, ownerId }) {
  return campaign({ id: uid('c-'), name, description, cover, level, seats, ownerId, members: [{ userId: ownerId, role: 'master', status: 'active', joinedAt: Date.now() }] });
}

export function seedDB() {
  const crypt = [HEROES.lira(), HEROES.torin(), HEROES.garr(), HEROES.elian(), HEROES.mira()];
  crypt[0].ownerId = 'u-asya'; crypt[1].ownerId = 'u-timur'; crypt[2].ownerId = 'u-roma'; crypt[4].ownerId = 'u-yara';
  const c1 = campaign({
    id: 'c-crypt', code: 'RSP-7Q2K', name: 'Склеп культа', description: 'Под кладбищем Распутья проснулся культ Безликого. Отряд спускается в склеп, пока свечи ещё горят.',
    cover: 'map:crypt', level: 5, seats: 6, ownerId: 'u-sol', createdAt: now - 2 * DAY,
    members: [
      { userId: 'u-sol', role: 'master', status: 'active', joinedAt: now - 2 * DAY },
      { userId: 'u-asya', role: 'player', status: 'active', characterId: 'ch-lira', joinedAt: now - 2 * DAY },
      { userId: 'u-yara', role: 'player', status: 'active', characterId: 'ch-mira', joinedAt: now - 2 * DAY },
      { userId: 'u-timur', role: 'player', status: 'active', characterId: 'ch-torin', joinedAt: now - DAY },
      { userId: 'u-roma', role: 'player', status: 'active', characterId: 'ch-garr', joinedAt: now - DAY, lastSeen: now - 3 * DAY },
      { userId: 'u-nika', role: 'player', status: 'pending', characterId: null, joinedAt: now - 120000 },
    ],
    characters: crypt,
    scenes: [
      cryptScene(crypt),
      simpleScene('s-forest', 'Лесная дорога', { src: 'map:forest', width: 1024, height: 1024 }, 20, '20×20 клеток · засада волков'),
      simpleScene('s-tavern', 'Таверна «Распутье»', { src: 'map:tavern', width: 1024, height: 1024 }, 20, '20×20 клеток · без боя'),
      simpleScene('s-cave', 'Пещера гоблинов', { src: 'map:cave', width: 1024, height: 1024 }, 20, '20×20 клеток · черновик', { status: 'draft', lighting: 'dark', fog: { mode: 'vision' }, lights: [L(790, 560, 'campfire', 10, 10)] }),
    ],
    activeSceneId: 's-crypt',
    log: [{ id: uid('r-'), at: now - 600000, userId: 'u-sol', kind: 'note', text: 'Отряд спустился в склеп.' }],
  });

  const shadows = [HEROES.mira(), HEROES.garr(), HEROES.lira()];
  shadows[0].ownerId = 'u-sol'; shadows[2].ownerId = 'u-asya';
  const tavern = simpleScene('s-tav2', 'Таверна «Распутье»', { src: 'map:tavern', width: 1024, height: 1024 }, 20, '20×20 клеток');
  const tg = tavern.grid;
  tavern.tokens = [heroToken(shadows[0], 9, 10, tg), heroToken(shadows[1], 10, 10, tg), heroToken(shadows[2], 11, 10, tg)];
  const c2 = campaign({
    id: 'c-shadows', code: 'RSP-T3NI', name: 'Тени Распутья', description: 'Городские интриги и пропавший караван.', cover: 'map:tavern', level: 3, seats: 5, ownerId: 'u-yara', createdAt: now - 9 * DAY,
    members: [
      { userId: 'u-yara', role: 'master', status: 'active', joinedAt: now - 9 * DAY },
      { userId: 'u-sol', role: 'player', status: 'active', characterId: shadows[0].id, joinedAt: now - 8 * DAY },
      { userId: 'u-asya', role: 'player', status: 'active', characterId: shadows[2].id, joinedAt: now - 8 * DAY },
    ],
    characters: shadows, scenes: [tavern], activeSceneId: tavern.id,
  });

  const cave = [HEROES.torin(), HEROES.elian(), HEROES.garr()];
  const caveScene = simpleScene('s-cave2', 'Пещера гоблинов', { src: 'map:cave', width: 1024, height: 1024 }, 20, '20×20 клеток', { lighting: 'dark', fog: { mode: 'vision' }, lights: [L(790, 560, 'campfire', 10, 10)] });
  const c3 = campaign({
    id: 'c-cave', code: 'RSP-GBLN', name: 'Ваншот: Пещера гоблинов', description: 'Короткое приключение на один вечер.', cover: 'map:cave', level: 3, seats: 4, ownerId: 'u-sol', createdAt: now - DAY, status: 'draft',
    members: [{ userId: 'u-sol', role: 'master', status: 'active', joinedAt: now - DAY }],
    characters: cave, scenes: [caveScene], activeSceneId: null,
  });

  const users = {};
  for (const u of DEMO_USERS) users[u.id] = { ...u, provider: 'discord-demo', createdAt: now - 10 * DAY };
  return { version: 1, rev: 1, seededAt: now, users, campaigns: { [c1.id]: c1, [c2.id]: c2, [c3.id]: c3 } };
}

export const CHARACTER_TEMPLATES = HEROES;
