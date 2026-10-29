// Стартовый бестиарий. Игровые числа — из System Reference Document 5.1 (CC BY 4.0,
// © Wizards of the Coast), названия и описания переведены своими словами.
// «Порождение Безликого» — домашнее существо демо-кампании.
// Полный каталог — отдельная задача (см. docs/features/library.md).

const atk = (name, bonus, damage, type, reach = 'досягаемость 5 фт') => ({ name, bonus, damage, type, note: reach });

export const BESTIARY = [
  {
    id: 'cultist', name: 'Культист', type: 'Гуманоид', size: 'medium', cr: '1/8', ac: 12, hp: 9, hpDice: '2d8', speed: 30,
    stats: { str: 11, dex: 12, con: 10, int: 10, wis: 11, cha: 10 }, img: 'cultist', init: 1,
    senses: 'пассивное Восприятие 10', traits: ['Тёмная преданность: преимущество на спасброски от очарования и испуга.'],
    actions: [atk('Скимитар', 3, '1d6+1', 'рубящий')],
  },
  {
    id: 'cult-fanatic', name: 'Фанатик культа', type: 'Гуманоид', size: 'medium', cr: '2', ac: 13, hp: 33, hpDice: '6d8+6', speed: 30,
    stats: { str: 11, dex: 14, con: 12, int: 10, wis: 13, cha: 14 }, img: 'cultist', init: 2,
    senses: 'пассивное Восприятие 11', traits: ['Тёмная преданность.', 'Заклинатель 4 уровня (МДР, СЛ 11): «Священное пламя», «Удержание личности», «Духовное оружие».'],
    actions: [atk('Мультиатака: два удара кинжалом', 4, '1d4+2', 'колющий')],
  },
  {
    id: 'acolyte', name: 'Аколит', type: 'Гуманоид', size: 'medium', cr: '1/4', ac: 10, hp: 9, hpDice: '2d8', speed: 30,
    stats: { str: 10, dex: 10, con: 10, int: 10, wis: 14, cha: 11 }, img: 'cultist', init: 0,
    senses: 'пассивное Восприятие 12', traits: ['Заклинатель 1 уровня (МДР, СЛ 12): «Свет», «Лечение ран», «Святилище».'],
    actions: [atk('Дубинка', 2, '1d4', 'дробящий')],
  },
  {
    id: 'goblin', name: 'Гоблин', type: 'Гуманоид', size: 'small', cr: '1/4', ac: 15, hp: 7, hpDice: '2d6', speed: 30,
    stats: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 }, img: 'goblin', init: 2, darkvision: 60,
    senses: 'тёмное зрение 60 фт, пассивное Восприятие 9', traits: ['Шустрый побег: Отход или Засада бонусным действием.'],
    actions: [atk('Скимитар', 4, '1d6+2', 'рубящий'), atk('Короткий лук', 4, '1d6+2', 'колющий', 'дальность 80/320 фт')],
  },
  {
    id: 'hobgoblin', name: 'Хобгоблин', type: 'Гуманоид', size: 'medium', cr: '1/2', ac: 18, hp: 11, hpDice: '2d8+2', speed: 30,
    stats: { str: 13, dex: 12, con: 12, int: 10, wis: 10, cha: 9 }, img: 'goblin', init: 1, darkvision: 60,
    senses: 'тёмное зрение 60 фт, пассивное Восприятие 10', traits: ['Боевое превосходство: раз в ход +2к6 урона, если союзник рядом с целью.'],
    actions: [atk('Длинный меч', 3, '1d8+1', 'рубящий'), atk('Длинный лук', 3, '1d8+1', 'колющий', 'дальность 150/600 фт')],
  },
  {
    id: 'skeleton', name: 'Скелет', type: 'Нежить', size: 'medium', cr: '1/4', ac: 13, hp: 13, hpDice: '2d8+4', speed: 30,
    stats: { str: 10, dex: 14, con: 15, int: 6, wis: 8, cha: 5 }, img: 'spawn', init: 2, darkvision: 60,
    senses: 'тёмное зрение 60 фт, пассивное Восприятие 9', traits: ['Уязвим к дробящему урону, иммунитет к яду.'],
    actions: [atk('Короткий меч', 4, '1d6+2', 'колющий'), atk('Короткий лук', 4, '1d6+2', 'колющий', 'дальность 80/320 фт')],
  },
  {
    id: 'zombie', name: 'Зомби', type: 'Нежить', size: 'medium', cr: '1/4', ac: 8, hp: 22, hpDice: '3d8+9', speed: 20,
    stats: { str: 13, dex: 6, con: 16, int: 3, wis: 6, cha: 5 }, img: 'spawn', init: -2, darkvision: 60,
    senses: 'тёмное зрение 60 фт, пассивное Восприятие 8', traits: ['Стойкость нежити: падая до 0 хитов, может остаться на 1 (спасбросок ТЕЛ).'],
    actions: [atk('Удар', 3, '1d6+1', 'дробящий')],
  },
  {
    id: 'wolf', name: 'Волк', type: 'Зверь', size: 'medium', cr: '1/4', ac: 13, hp: 11, hpDice: '2d8+2', speed: 40,
    stats: { str: 12, dex: 15, con: 12, int: 3, wis: 12, cha: 6 }, img: 'goblin', init: 2,
    senses: 'пассивное Восприятие 13', traits: ['Тактика стаи: преимущество, если союзник рядом с целью.'],
    actions: [atk('Укус', 4, '2d4+2', 'колющий')],
  },
  {
    id: 'bandit', name: 'Бандит', type: 'Гуманоид', size: 'medium', cr: '1/8', ac: 12, hp: 11, hpDice: '2d8+2', speed: 30,
    stats: { str: 11, dex: 12, con: 12, int: 10, wis: 10, cha: 10 }, img: 'cultist', init: 1,
    senses: 'пассивное Восприятие 10', traits: [],
    actions: [atk('Скимитар', 3, '1d6+1', 'рубящий'), atk('Лёгкий арбалет', 3, '1d8+1', 'колющий', 'дальность 80/320 фт')],
  },
  {
    id: 'giant-rat', name: 'Гигантская крыса', type: 'Зверь', size: 'small', cr: '1/8', ac: 12, hp: 7, hpDice: '2d6', speed: 30,
    stats: { str: 7, dex: 15, con: 11, int: 2, wis: 10, cha: 4 }, img: 'goblin', init: 2, darkvision: 60,
    senses: 'тёмное зрение 60 фт, пассивное Восприятие 10', traits: ['Тактика стаи.'],
    actions: [atk('Укус', 4, '1d4+2', 'колющий')],
  },
  {
    id: 'ogre', name: 'Огр', type: 'Великан', size: 'large', cr: '2', ac: 11, hp: 59, hpDice: '7d10+21', speed: 40,
    stats: { str: 19, dex: 8, con: 16, int: 5, wis: 7, cha: 7 }, img: 'ogre', init: -1, darkvision: 60,
    senses: 'тёмное зрение 60 фт, пассивное Восприятие 8', traits: [],
    actions: [atk('Палица', 6, '2d8+4', 'дробящий'), atk('Метательное копьё', 6, '2d6+4', 'колющий', 'дальность 30/120 фт')],
  },
  {
    id: 'gnoll', name: 'Гнолл', type: 'Гуманоид', size: 'medium', cr: '1/2', ac: 15, hp: 22, hpDice: '5d8', speed: 30,
    stats: { str: 14, dex: 12, con: 11, int: 6, wis: 10, cha: 7 }, img: 'goblin', init: 1, darkvision: 60,
    senses: 'тёмное зрение 60 фт, пассивное Восприятие 10', traits: ['Буйство: опустив врага до 0, может бонусным действием сдвинуться и укусить.'],
    actions: [atk('Укус', 4, '1d4+2', 'колющий'), atk('Копьё', 4, '1d6+2', 'колющий')],
  },
  {
    id: 'faceless-spawn', name: 'Порождение Безликого', type: 'Аберрация · домашнее', size: 'huge', cr: '6', ac: 15, hp: 114, hpDice: '12d12+36', speed: 30,
    stats: { str: 20, dex: 10, con: 16, int: 8, wis: 14, cha: 16 }, img: 'spawn', init: 0, darkvision: 120,
    senses: 'тёмное зрение 120 фт, пассивное Восприятие 15', traits: ['Аура тишины: в 10 фт свечи гаснут.', 'Безликость: невосприимчиво к очарованию и испугу.'],
    actions: [atk('Мультиатака: два удара когтями', 8, '2d8+5', 'рубящий', 'досягаемость 10 фт'), atk('Безмолвный крик (перезарядка 5–6)', 0, '4d8', 'психический', 'конус 30 фт, спасбросок МДР СЛ 14')],
  },
];

export const monsterById = (id) => BESTIARY.find((m) => m.id === id);
