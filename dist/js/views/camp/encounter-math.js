// Сложность встречи по Руководству мастера D&D 5e (2014): пороги опыта на героя и множитель за число существ.
// Чистые функции — без хранилища и DOM (проверяются в tests/campaign-home.test.js).
import { xpFor } from '../ref/data.js';

/** Пороги [лёгкая, средняя, сложная, смертельная] на одного героя по уровню 1–20. */
export const THRESHOLDS = [null,
  [25, 50, 75, 100], [50, 100, 150, 200], [75, 150, 225, 400], [125, 250, 375, 500], [250, 500, 750, 1100],
  [300, 600, 900, 1400], [350, 750, 1100, 1700], [450, 900, 1400, 2100], [550, 1100, 1600, 2400], [600, 1200, 1900, 2800],
  [800, 1600, 2400, 3600], [1000, 2000, 3000, 4500], [1100, 2200, 3400, 5100], [1250, 2500, 3800, 5700], [1400, 2800, 4300, 6400],
  [1600, 3200, 4800, 7200], [2000, 3900, 5900, 8800], [2100, 4200, 6300, 9500], [2400, 4900, 7300, 10900], [2800, 5700, 8500, 12700],
];
const STEPS = [1, 1.5, 2, 2.5, 3, 4];
export const LABELS = ['Лёгкая', 'Средняя', 'Сложная', 'Смертельная'];
const stepFor = (n) => (n <= 1 ? 0 : n === 2 ? 1 : n <= 6 ? 2 : n <= 10 ? 3 : n <= 14 ? 4 : 5);

/**
 * levels — уровни героев отряда; monsters — [{cr, count}].
 * Возвращает пороги отряда, сырой и поправленный опыт, множитель и сложность (индекс в LABELS или −1 — «пустяк»).
 */
export function difficulty(levels, monsters) {
  const lv = levels.map((l) => Math.min(20, Math.max(1, Number(l) || 1)));
  const party = [0, 1, 2, 3].map((k) => lv.reduce((s, l) => s + THRESHOLDS[l][k], 0));
  const count = monsters.reduce((s, m) => s + (Number(m.count) || 0), 0);
  const raw = monsters.reduce((s, m) => s + xpFor(m.cr) * (Number(m.count) || 0), 0);
  let step = stepFor(count);
  if (lv.length && lv.length < 3) step = Math.min(STEPS.length - 1, step + 1);
  else if (lv.length >= 6) step = Math.max(0, step - 1);
  const mult = count ? STEPS[step] : 1;
  const adjusted = Math.round(raw * mult);
  let level = -1;
  for (let k = 0; k < 4; k++) if (adjusted >= party[k] && party[k] > 0) level = k;
  return { party, raw, mult, adjusted, count, level, label: level < 0 ? (count ? 'Пустяк' : '—') : LABELS[level] };
}
