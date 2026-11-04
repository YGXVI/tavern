// Хиты: разбор ручного ввода. Чистые функции, покрыты тестами.

/**
 * «12» — поставить 12; «-5» или «−5» — урон 5; «+3» — лечение 3. Иначе null.
 * Пробелы допускаются: «- 5».
 */
export function parseHpInput(text) {
  const m = String(text ?? '').replace(/\s+/g, '').replace(/[−–]/g, '-').match(/^([+-])?(\d{1,4})$/);
  if (!m) return null;
  const n = Number(m[2]);
  return m[1] ? { delta: m[1] === '-' ? -n : n } : { set: n };
}
