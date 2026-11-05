// Пачки в инициативе (#198, ревизия 2): несколько одинаковых существ ходят на одной строке инициативы.
// Пачка — только поле `group` у записей боя (`combat.entries[].group`), без списка пачек и имён: данные боя читает
// каждый участник, а игроку сервер даёт писать только `entries` / `moved` / `ended`.

/** Не больше 10 в пачке, пачек не меньше трёх (пока существ хватает): k = max(min(3, n), ⌈n/10⌉), поровну. */
export function packSizes(n) {
  if (n <= 0) return [];
  const k = Math.max(Math.min(3, n), Math.ceil(n / 10));
  const base = Math.floor(n / k), rem = n % k;
  return Array.from({ length: k }, (_, i) => base + (i < rem ? 1 : 0));
}

/**
 * Разложить токены по пачкам заданных размеров по близости на карте, детерминированно: зерно — самый дальний
 * от центра ещё не разобранный, к нему — ближайшие до размера пачки; повторить. Возвращает массивы id.
 */
export function packByProximity(tokens, sizes) {
  const left = [...tokens].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const cx = left.reduce((s, t) => s + t.x, 0) / Math.max(1, left.length);
  const cy = left.reduce((s, t) => s + t.y, 0) / Math.max(1, left.length);
  const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const out = [];
  for (const size of sizes) {
    if (!left.length) break;
    let si = 0;
    for (let i = 1; i < left.length; i++) if (d2(left[i], { x: cx, y: cy }) > d2(left[si], { x: cx, y: cy })) si = i;
    const seed = left[si];
    const pick = left.map((t, i) => ({ t, i, d: d2(t, seed) })).sort((a, b) => a.d - b.d || a.i - b.i).slice(0, size);
    const ids = new Set(pick.map((p) => p.t.id));
    out.push(pick.map((p) => p.t.id));
    for (let i = left.length - 1; i >= 0; i--) if (ids.has(left[i].id)) left.splice(i, 1);
  }
  return out;
}

/** Вид для пачек: существа мастера одного статблока (`monsterId`); свои токены и призывы игроков — нет. */
export const packKind = (t) => (t && t.kind === 'foe' && !t.ownerId && !t.summonedBy && t.monsterId ? t.monsterId : null);

/**
 * Группа призывов игрока (#198 §2, §4): одинаковые призывы одного владельца и одного призывателя — «Призыв
 * животных» велит бросать за них одну инициативу. Фамильяр или скакун — один, группы не будет.
 */
export const summonKind = (t) => (t && t.kind !== 'hero' && t.kind !== 'item' && (t.summonedBy || t.ownerId) && t.monsterId ? `s:${t.ownerId || ''}:${t.summonedBy || ''}:${t.monsterId}` : null);
/** Вид для группировки в бою: пачка мастера или группа призывов. */
export const groupKind = (t) => packKind(t) || summonKind(t);
export const isSummonKind = (k) => typeof k === 'string' && k.startsWith('s:');

/**
 * Пачки для одного вида: mode 'auto' — по правилу packSizes, 'one' — одной группой, 'each' — каждый отдельно.
 * Скрытые и видимые — всегда в разных пачках (засада не связывается с видимыми). Возвращает массивы id;
 * массив из одного id — одиночка.
 */
export function planPacks(tokens, mode = 'auto') {
  if (mode === 'each') return tokens.map((t) => [t.id]);
  const out = [];
  for (const part of [tokens.filter((t) => !t.hidden), tokens.filter((t) => t.hidden)]) {
    if (!part.length) continue;
    if (mode === 'one') out.push(part.map((t) => t.id));
    else out.push(...packByProximity(part, packSizes(part.length)));
  }
  return out;
}

/** Имя вида без номера: «Зомби 12» → «Зомби». */
export const baseName = (name) => String(name || '').replace(/\s+\d+$/, '') || 'Существа';

/** Цвета меток пачек на карте — по порядку пачек в очереди. */
export const PACK_COLORS = ['#e8a33d', '#5aa9e6', '#9b7be8', '#4fbf8f', '#e66b8a', '#c9c24f'];

/**
 * Номера и цвета пачек по очереди: Map(tokenId → {n, color, group}). order — строки initiativeOrder, которые видит
 * зритель: пачкой считается слот, где ему видно хотя бы двоих; номер — порядковый среди таких пачек.
 */
export function packMarks(order) {
  const marks = new Map();
  const size = new Map();
  for (const e of order) size.set(e.slot, (size.get(e.slot) || 0) + 1);
  let n = 0, last = null;
  for (const e of order) {
    if (!e.group || size.get(e.slot) < 2) continue;
    if (e.slot !== last) { n++; last = e.slot; }
    marks.set(e.tokenId, { n, color: PACK_COLORS[(n - 1) % PACK_COLORS.length], group: e.group });
  }
  return marks;
}
