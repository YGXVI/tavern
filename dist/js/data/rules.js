// Справочные константы D&D 5e (2014), которые нужны интерфейсу стола.
// Формулировки — короткие пересказы своими словами, не цитаты из книг.

export const ABILITIES = [
  { id: 'str', short: 'СИЛ', name: 'Сила' },
  { id: 'dex', short: 'ЛОВ', name: 'Ловкость' },
  { id: 'con', short: 'ТЕЛ', name: 'Телосложение' },
  { id: 'int', short: 'ИНТ', name: 'Интеллект' },
  { id: 'wis', short: 'МДР', name: 'Мудрость' },
  { id: 'cha', short: 'ХАР', name: 'Харизма' },
];

export const SKILLS = [
  { id: 'acrobatics', name: 'Акробатика', ab: 'dex' },
  { id: 'animal', name: 'Уход за животными', ab: 'wis' },
  { id: 'arcana', name: 'Магия', ab: 'int' },
  { id: 'athletics', name: 'Атлетика', ab: 'str' },
  { id: 'deception', name: 'Обман', ab: 'cha' },
  { id: 'history', name: 'История', ab: 'int' },
  { id: 'insight', name: 'Проницательность', ab: 'wis' },
  { id: 'intimidation', name: 'Запугивание', ab: 'cha' },
  { id: 'investigation', name: 'Анализ', ab: 'int' },
  { id: 'medicine', name: 'Медицина', ab: 'wis' },
  { id: 'nature', name: 'Природа', ab: 'int' },
  { id: 'perception', name: 'Восприятие', ab: 'wis' },
  { id: 'performance', name: 'Выступление', ab: 'cha' },
  { id: 'persuasion', name: 'Убеждение', ab: 'cha' },
  { id: 'religion', name: 'Религия', ab: 'int' },
  { id: 'sleight', name: 'Ловкость рук', ab: 'dex' },
  { id: 'stealth', name: 'Скрытность', ab: 'dex' },
  { id: 'survival', name: 'Выживание', ab: 'wis' },
];

export const mod = (score) => Math.floor((Number(score || 10) - 10) / 2);
export const profBonus = (level) => 2 + Math.floor((Math.max(1, level) - 1) / 4);

export const CONDITIONS = [
  { id: 'blinded', name: 'Ослеплён', icon: 'view-off-slash', text: 'Не видит. Проваливает проверки, где нужно зрение. Броски атаки по нему — с преимуществом, его атаки — с помехой.' },
  { id: 'charmed', name: 'Очарован', icon: 'favourite', text: 'Не может атаковать очаровавшего и вредить ему магией. Тот получает преимущество на социальные проверки против него.' },
  { id: 'deafened', name: 'Оглох', icon: 'volume-off', text: 'Не слышит. Проваливает проверки, где нужен слух.' },
  { id: 'frightened', name: 'Испуган', icon: 'sad-01', text: 'Помеха на проверки и атаки, пока источник страха в поле зрения. Не может по своей воле приблизиться к источнику.' },
  { id: 'grappled', name: 'Схвачен', icon: 'hand-grip', text: 'Скорость 0. Состояние заканчивается, если схвативший недееспособен или их разнесло.' },
  { id: 'incapacitated', name: 'Недееспособен', icon: 'stop-circle', text: 'Не может совершать действия и реакции.' },
  { id: 'invisible', name: 'Невидим', icon: 'mask', text: 'Его нельзя увидеть без магии. Атаки по нему — с помехой, его атаки — с преимуществом.' },
  { id: 'paralyzed', name: 'Парализован', icon: 'flash', text: 'Недееспособен, не двигается и не говорит. Проваливает спасброски СИЛ и ЛОВ. Попадание в упор — критическое.' },
  { id: 'petrified', name: 'Окаменел', icon: 'mountain', text: 'Превращён в камень. Недееспособен, сопротивление всем видам урона, иммунитет к ядам и болезням.' },
  { id: 'poisoned', name: 'Отравлен', icon: 'test-tube', text: 'Помеха на броски атаки и проверки характеристик. Длится, пока яд не выветрится или его не снимут.' },
  { id: 'prone', name: 'Сбит с ног', icon: 'falling-star', text: 'Может только ползти. Атаки в упор по нему — с преимуществом, издалека — с помехой. Встать стоит половину скорости.' },
  { id: 'restrained', name: 'Опутан', icon: 'link-04', text: 'Скорость 0. Атаки по нему — с преимуществом, его атаки — с помехой. Помеха на спасброски ЛОВ.' },
  { id: 'stunned', name: 'Ошеломлён', icon: 'sad-dizzy', text: 'Недееспособен, не двигается, говорит запинаясь. Проваливает спасброски СИЛ и ЛОВ.' },
  { id: 'unconscious', name: 'Без сознания', icon: 'sleeping', text: 'Недееспособен, роняет всё, падает ничком. Атаки по нему — с преимуществом, в упор — критические.' },
  { id: 'exhaustion', name: 'Истощение', icon: 'battery-low', text: 'Шесть степеней: от помехи на проверки до смерти. Снимается долгим отдыхом по одной степени.' },
  { id: 'concentration', name: 'Концентрация', icon: 'brain-02', text: 'Поддерживает заклинание. Получив урон — спасбросок ТЕЛ, СЛ 10 или половина урона.' },
];
export const conditionById = (id) => CONDITIONS.find((c) => c.id === id);

/** Размеры существ: сколько клеток занимает токен. */
export const SIZES = [
  { id: 'tiny', name: 'Крошечный', cells: 1, scale: 0.6 },
  { id: 'small', name: 'Маленький', cells: 1, scale: 0.85 },
  { id: 'medium', name: 'Средний', cells: 1, scale: 1 },
  { id: 'large', name: 'Большой', cells: 2, scale: 1 },
  { id: 'huge', name: 'Огромный', cells: 3, scale: 1 },
  { id: 'gargantuan', name: 'Громадный', cells: 4, scale: 1 },
];
export const sizeById = (id) => SIZES.find((s) => s.id === id) || SIZES[2];

/** Источники света (радиусы в футах, PHB). */
export const LIGHTS = [
  { id: 'torch', name: 'Факел', icon: 'fire', bright: 20, dim: 20, color: 'warm', flicker: true },
  { id: 'lantern', name: 'Фонарь', icon: 'bulb', bright: 30, dim: 30, color: 'warm', flicker: false },
  { id: 'light', name: 'Заговор «Свет»', icon: 'sun-03', bright: 20, dim: 20, color: 'cold', flicker: false },
  { id: 'campfire', name: 'Костёр', icon: 'campfire', bright: 10, dim: 10, color: 'warm', flicker: true },
  { id: 'candle', name: 'Свеча', icon: 'bulb', bright: 5, dim: 5, color: 'warm', flicker: true },
];
export const LIGHT_COLORS = {
  warm: { name: 'Тёплый', rgb: [233, 176, 82] },
  cold: { name: 'Холодный', rgb: [150, 190, 240] },
  magic: { name: 'Магия', rgb: [167, 139, 250] },
};

export const CLASSES = [
  { id: 'barbarian', name: 'Варвар', hd: 12, saves: ['str', 'con'] },
  { id: 'bard', name: 'Бард', hd: 8, saves: ['dex', 'cha'], spell: 'cha' },
  { id: 'cleric', name: 'Жрец', hd: 8, saves: ['wis', 'cha'], spell: 'wis' },
  { id: 'druid', name: 'Друид', hd: 8, saves: ['int', 'wis'], spell: 'wis' },
  { id: 'fighter', name: 'Воин', hd: 10, saves: ['str', 'con'] },
  { id: 'monk', name: 'Монах', hd: 8, saves: ['str', 'dex'] },
  { id: 'paladin', name: 'Паладин', hd: 10, saves: ['wis', 'cha'], spell: 'cha' },
  { id: 'ranger', name: 'Следопыт', hd: 10, saves: ['str', 'dex'], spell: 'wis' },
  { id: 'rogue', name: 'Плут', hd: 8, saves: ['dex', 'int'] },
  { id: 'sorcerer', name: 'Чародей', hd: 6, saves: ['con', 'cha'], spell: 'cha' },
  { id: 'warlock', name: 'Колдун', hd: 8, saves: ['wis', 'cha'], spell: 'cha' },
  { id: 'wizard', name: 'Волшебник', hd: 6, saves: ['int', 'wis'], spell: 'int' },
];
export const classById = (id) => CLASSES.find((c) => c.id === id);

export const RACES = [
  { id: 'human', name: 'Человек', speed: 30, darkvision: 0 },
  { id: 'elf', name: 'Эльф', speed: 30, darkvision: 60 },
  { id: 'dwarf', name: 'Дварф', speed: 25, darkvision: 60 },
  { id: 'halfling', name: 'Полурослик', speed: 25, darkvision: 0 },
  { id: 'gnome', name: 'Гном', speed: 25, darkvision: 60 },
  { id: 'halforc', name: 'Полуорк', speed: 30, darkvision: 60 },
  { id: 'halfelf', name: 'Полуэльф', speed: 30, darkvision: 60 },
  { id: 'tiefling', name: 'Тифлинг', speed: 30, darkvision: 60 },
  { id: 'dragonborn', name: 'Драконорождённый', speed: 30, darkvision: 0 },
];
export const raceById = (id) => RACES.find((r) => r.id === id);

/** Шаблоны областей заклинаний; размер по умолчанию в футах. */
export const TEMPLATES = [
  { id: 'cone', name: 'Конус', icon: 'cone-01', size: 15 },
  { id: 'line', name: 'Линия', icon: 'straight-edge', size: 30 },
  { id: 'cube', name: 'Куб', icon: 'square', size: 15 },
  { id: 'sphere', name: 'Сфера', icon: 'circle', size: 20 },
];

export const DICE = [4, 6, 8, 10, 12, 20, 100];

/** Насколько ранен — то, что игрок видит про чужие хиты. */
export function woundLabel(hp, max) {
  if (max <= 0) return '';
  if (hp <= 0) return 'при смерти';
  const r = hp / max;
  if (r >= 1) return 'цел';
  if (r > 0.5) return 'ранен';
  if (r > 0.25) return 'тяжело ранен';
  return 'еле держится';
}
