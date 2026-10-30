// Наборы кубов (TASK-100): иконки рейки из макета Figma (Dice → die, size=rail) и материалы объёмных кубов.
// Иконки — SVG из макета как есть; цвета кости (#F3E8D2 / #D9C49C / #9A7F55) заменяются цветами набора.

const RAIL = {
  // к4 — кристалл (TASK-136): силуэт D, левая длинная грань — светлая, правая и левые скосы острий — средние.
  4: '<path d="M16 1L24.5 8V24L16 31L7.5 24V8L16 1Z" fill="D" stroke="D" stroke-width="0.25" stroke-linejoin="round"/><path d="M16 1L7.5 8L16 11.5V1Z" fill="B" stroke="B" stroke-width="0.25" stroke-linejoin="round"/><path d="M16 11.5L24.5 8V24L16 27.5V11.5Z" fill="B" stroke="B" stroke-width="0.25" stroke-linejoin="round"/><path d="M7.5 24L16 27.5V31L7.5 24Z" fill="B" stroke="B" stroke-width="0.25" stroke-linejoin="round"/><path d="M7.5 8L16 11.5V27.5L7.5 24V8Z" fill="L" stroke="L" stroke-width="0.25" stroke-linejoin="round"/>',
  6: '<rect x="2" y="2" width="28" height="28" rx="6" fill="D"/><rect x="3" y="2.5" width="26" height="25" rx="5.5" fill="B"/><rect x="6" y="5" width="20" height="19" rx="3.5" fill="L"/>',
  8: '<path d="M16 1L31 16L16 31L1 16L16 1Z" fill="D" stroke="D" stroke-width="0.25" stroke-linejoin="round"/><path d="M16 1V5L5 22L1 16L16 1Z" fill="B" stroke="B" stroke-width="0.25" stroke-linejoin="round"/><path d="M5 22H27L16 31L5 22Z" fill="B" stroke="B" stroke-width="0.25" stroke-linejoin="round"/><path d="M16 5L27 22H5L16 5Z" fill="L" stroke="L" stroke-width="0.25" stroke-linejoin="round"/>',
  10: '<path d="M16 1L30.5 13V18.5L16 31L1.5 18.5V13L16 1Z" fill="D" stroke="D" stroke-width="0.25" stroke-linejoin="round"/><path d="M16 1V4L8 16L1.5 18.5V13L16 1Z" fill="B" stroke="B" stroke-width="0.25" stroke-linejoin="round"/><path d="M8 16L16 22.5L24 16L30.5 18.5L16 31L1.5 18.5L8 16Z" fill="B" stroke="B" stroke-width="0.25" stroke-linejoin="round"/><path d="M16 4L24 16L16 22.5L8 16L16 4Z" fill="L" stroke="L" stroke-width="0.25" stroke-linejoin="round"/>',
  12: '<path d="M16.0041 1L24.8141 3.86L30.2641 11.36V20.64L24.8141 28.14L16.0041 31L7.18415 28.14L1.73415 20.64V11.36L7.18415 3.86L16.0041 1Z" fill="D" stroke="D" stroke-width="0.25" stroke-linejoin="round"/><path d="M7.91415 13.37L1.73415 11.36L7.18415 3.86L16.0041 1V7.5L7.91415 13.37Z" fill="B" stroke="B" stroke-width="0.25" stroke-linejoin="round"/><path d="M11.0041 22.8747L7.18415 28.1347L1.73415 20.6347V11.3647L7.91415 13.3747L11.0041 22.8747Z" fill="B" stroke="B" stroke-width="0.25" stroke-linejoin="round"/><path d="M16 7.5V1L24.82 3.86L30.27 11.36L24.08 13.37L16 7.5Z" fill="B" stroke="B" stroke-width="0.25" stroke-linejoin="round"/><path d="M15.996 7.5L24.086 13.37L20.996 22.88H11.006L7.91602 13.37L15.996 7.5Z" fill="L" stroke="L" stroke-width="0.25" stroke-linejoin="round"/>',
  20: '<path d="M15.9996 1L28.9896 8.5V23.5L15.9996 31L3.00961 23.5V8.5L15.9996 1Z" fill="D" stroke="D" stroke-width="0.25" stroke-linejoin="round"/><path d="M8.20961 20.5L3.00961 8.5L15.9996 7L8.20961 20.5Z" fill="B" stroke="B" stroke-width="0.25" stroke-linejoin="round"/><path d="M23.7958 20.5L15.9958 31L8.20578 20.5H23.7958Z" fill="B" stroke="B" stroke-width="0.25" stroke-linejoin="round"/><path d="M8.20961 20.5L3.00961 23.5V8.5L8.20961 20.5Z" fill="B" stroke="B" stroke-width="0.25" stroke-linejoin="round"/><path d="M15.9996 7L3.00961 8.5L15.9996 1V7Z" fill="B" stroke="B" stroke-width="0.25" stroke-linejoin="round"/><path d="M15.9958 7L23.7958 20.5H8.20578L15.9958 7Z" fill="L" stroke="L" stroke-width="0.25" stroke-linejoin="round"/>',
  100: '<g opacity="0.75"><path d="M12.48 0.779999L23.79 10.14V14.43L12.48 24.18L1.17001 14.43V10.14L12.48 0.779999Z" fill="D" stroke="D" stroke-width="0.195" stroke-linejoin="round"/><path d="M12.48 0.779999V3.12L6.24001 12.48L1.17001 14.43V10.14L12.48 0.779999Z" fill="B" stroke="B" stroke-width="0.195" stroke-linejoin="round"/><path d="M6.24001 12.48L12.48 17.55L18.72 12.48L23.79 14.43L12.48 24.18L1.17001 14.43L6.24001 12.48Z" fill="B" stroke="B" stroke-width="0.195" stroke-linejoin="round"/><path d="M12.48 3.12L18.72 12.48L12.48 17.55L6.23999 12.48L12.48 3.12Z" fill="L" stroke="L" stroke-width="0.195" stroke-linejoin="round"/></g><path d="M19.52 7.82L30.83 17.18V21.47L19.52 31.22L8.21002 21.47V17.18L19.52 7.82Z" fill="D" stroke="D" stroke-width="0.195" stroke-linejoin="round"/><path d="M19.52 7.82V10.16L13.28 19.52L8.21002 21.47V17.18L19.52 7.82Z" fill="B" stroke="B" stroke-width="0.195" stroke-linejoin="round"/><path d="M13.28 19.52L19.52 24.59L25.76 19.52L30.83 21.47L19.52 31.22L8.21002 21.47L13.28 19.52Z" fill="B" stroke="B" stroke-width="0.195" stroke-linejoin="round"/><path d="M19.52 10.16L25.76 19.52L19.52 24.59L13.28 19.52L19.52 10.16Z" fill="L" stroke="L" stroke-width="0.195" stroke-linejoin="round"/>',
};

/**
 * Наборы кубов. light/base/dark — грани иконки и основа камня объёмного куба, ink — цифры,
 * engrave — цифры вдавлены (светлый блик снизу) у светлых материалов; spec/metal/lum — блеск, отражение, яркость;
 * art — лист нарисованных граней (вместо камня и шрифта), пока не загрузился — рисуется камнем в цветах набора.
 */
export const SKINS = [
  { id: 'bone', name: 'Кость', light: '#f3e8d2', base: '#d9c49c', dark: '#9a7f55', ink: '#2b1e15', engrave: true, spec: 0.35, metal: 0.05, lum: 0.78 },
  { id: 'obsidian', name: 'Обсидиан', light: '#5d606e', base: '#2e3038', dark: '#16171c', ink: '#f2ead8', spec: 0.6, metal: 0.18, lum: 1 },
  { id: 'gold', name: 'Золото', light: '#ffe7a3', base: '#e0a63f', dark: '#8e5a16', ink: '#3a2408', engrave: true, spec: 0.9, metal: 0.55, lum: 0.82 },
  { id: 'ruby', name: 'Рубин', light: '#ff8f86', base: '#b8263a', dark: '#5c0f1f', ink: '#fff0d6', spec: 0.75, metal: 0.22, lum: 0.95 },
  { id: 'jade', name: 'Нефрит', light: '#a9e9c8', base: '#2f8a68', dark: '#134634', ink: '#f2fff8', spec: 0.55, metal: 0.12, lum: 0.92 },
  { id: 'sapphire', name: 'Сапфир', light: '#a6c6ff', base: '#2f5fc4', dark: '#142a66', ink: '#f2f6ff', spec: 0.75, metal: 0.22, lum: 0.95 },
  // Пилот (TASK-127): грани нарисованы — лист картинок из макета sol0139, порядок ячеек — ART_LAYOUT в dice3d.js.
  { id: 'cobalt', name: 'Кобальт', light: '#ffffff', base: '#dfe5f1', dark: '#1e3c96', ink: '#1e3c96', spec: 0.85, metal: 0.03, lum: 0.9,
    art: new URL('./dice-cobalt.webp', import.meta.url).href },
];
export const skinById = (id) => SKINS.find((s) => s.id === id) || SKINS[0];

/** Иконка куба рейки (32×32 из макета) в цветах набора. */
export function railDie(sides, skinId = 'bone') {
  const s = skinById(skinId);
  const body = (RAIL[sides] || RAIL[20]).replace(/"L"/g, `"${s.light}"`).replace(/"B"/g, `"${s.base}"`).replace(/"D"/g, `"${s.dark}"`);
  return `<svg class="rail-svg" width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">${body}</svg>`;
}

/**
 * Набор пользователя запоминается на этом устройстве (TASK-104): localStorage `rasputye-v2-prefs:<userId>` →
 * `{diceSkin}` — общий объект личных настроек интерфейса, чужие поля в нём сохраняются. На сервер не уходит;
 * остальным за столом набор приходит вместе с открытым броском. Хранилище недоступно — набор живёт до перезагрузки.
 */
const PREFS = (userId) => `rasputye-v2-prefs:${userId}`;
const chosen = new Map();
function readPrefs(userId) {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS(userId)) || 'null');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}
export function mySkin(userId) {
  if (!chosen.has(userId)) {
    const s = skinById(readPrefs(userId).diceSkin); // неизвестное → «Кость»
    chosen.set(userId, s.id);
    if (s.art) new Image().src = s.art;
  }
  return chosen.get(userId);
}
export function setMySkin(userId, id) {
  const s = skinById(id);
  chosen.set(userId, s.id);
  if (s.art) new Image().src = s.art; // лист граней заранее — к первому броску он уже в кэше
  try { localStorage.setItem(PREFS(userId), JSON.stringify({ ...readPrefs(userId), diceSkin: s.id })); } catch { /* приватный режим — до перезагрузки */ }
}
