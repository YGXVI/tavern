// Бой: инициатива, ходы, расход движения. Правила 5e 2014: к20 + модификатор Ловкости.
import { roll } from '../../../engine.js';
import { tokenStats, addLog } from '../../core/campaign.js';

/** Павший враг (0 хитов) пропускает ход; герой с 0 хитов ходит — бросает спасброски от смерти. */
const fallenFoe = (e) => e.token?.kind === 'foe' && e.stats?.hpMax > 0 && e.stats.hp <= 0;

/**
 * Порядок ходов на текущей сцене. Очередь — слоты (#198): одиночка или пачка — записи с одним `group`, у них одна
 * инициатива и один ход. Слоты — по инициативе, ничья — по бонусу, затем по имени (у пачки — по её члену с первым
 * именем). Члены пачки идут подряд: живые видимые, скрытые, павшие — первый из них «ведёт» ход пачки.
 * Каждая строка: запись + name, bonus, token, stats, slot (ключ слота), slotSize, lead (первый в слоте).
 */
export function initiativeOrder(c, scene) {
  const cb = c.combat;
  if (!cb?.entries?.length || !scene) return [];
  const byId = new Map(scene.tokens.map((t) => [t.id, t]));
  const slots = new Map();
  for (const e of cb.entries) {
    const t = byId.get(e.tokenId);
    if (!t) continue;
    const st = tokenStats(c, t);
    const key = e.group ? `g:${e.group}` : `t:${e.tokenId}`;
    if (!slots.has(key)) slots.set(key, []);
    slots.get(key).push({ ...e, name: st.name, bonus: st.initBonus ?? 0, token: t, stats: st, slot: key });
  }
  const byName = (a, b) => a.name.localeCompare(b.name, 'ru') || (a.tokenId < b.tokenId ? -1 : a.tokenId > b.tokenId ? 1 : 0);
  const rank = (r) => (fallenFoe(r) ? 2 : r.token.hidden ? 1 : 0);
  const list = [...slots.values()].map((ms) => ({ ref: [...ms].sort(byName)[0], ms: ms.sort((a, b) => rank(a) - rank(b) || byName(a, b)) }));
  // Ничья по инициативе (#197 S1): по RAW порядок решают мастер и игроки — ручной tie мастера идёт раньше бонуса.
  list.sort(({ ref: a }, { ref: b }) => (b.init ?? -99) - (a.init ?? -99) || (a.tie ?? 0) - (b.tie ?? 0) || b.bonus - a.bonus || byName(a, b));
  return list.flatMap(({ ms }) => ms.map((r, i) => ({ ...r, slotSize: ms.length, lead: i === 0 })));
}

/** Слоты очереди по порядку: [{ slot, init, ids }]. */
function slotList(order) {
  const out = [];
  for (const r of order) { const last = out.at(-1); if (last?.slot === r.slot) last.ids.push(r.tokenId); else out.push({ slot: r.slot, init: r.init, ids: [r.tokenId] }); }
  return out;
}

/** Можно ли поднять/опустить слот среди равных по инициативе (#197 S1). */
export function tiedMoves(order, slot) {
  const list = slotList(order), i = list.findIndex((x) => x.slot === slot);
  if (i < 0 || list[i].init == null) return { up: false, down: false };
  return { up: list[i - 1]?.init === list[i].init, down: list[i + 1]?.init === list[i].init };
}

/**
 * Поменять слот токена с соседом той же инициативы (dir: -1 — выше, +1 — ниже). Пишет tie всем записям
 * равных слотов, чтобы порядок не зависел от бонуса и имени. Возвращает false, если двигать некуда.
 */
export function moveTied(c, scene, tokenId, dir) {
  const list = slotList(initiativeOrder(c, scene));
  const i = list.findIndex((x) => x.ids.includes(tokenId)), j = i + dir;
  if (i < 0 || !list[j] || list[i].init == null || list[j].init !== list[i].init) return false;
  [list[i], list[j]] = [list[j], list[i]];
  const tied = list.filter((x) => x.init === list[i].init);
  const tieOf = new Map(tied.flatMap((x, n) => x.ids.map((id) => [id, n])));
  for (const e of c.combat.entries) if (tieOf.has(e.tokenId)) e.tie = tieOf.get(e.tokenId);
  return true;
}

/** Начало слота, в котором стоит строка i (−1, если строки нет). */
function slotStart(order, i) {
  if (i < 0 || i >= order.length) return -1;
  while (i > 0 && order[i - 1].slot === order[i].slot) i--;
  return i;
}
/** Номер хода (начало слота) для токена в очереди: −1, если его там нет. */
export const turnIndexOf = (order, tokenId) => slotStart(order, order.findIndex((e) => e.tokenId === tokenId));
/** Все строки слота, где стоит токен (пачка целиком или одиночка). */
export function slotMembers(order, tokenId) {
  const e = order.find((x) => x.tokenId === tokenId);
  return e ? order.filter((x) => x.slot === e.slot) : [];
}
/** Начала слотов по порядку. */
const slotStarts = (order) => order.map((e, i) => (i === 0 || order[i - 1].slot !== e.slot ? i : -1)).filter((i) => i >= 0);
/** Слот целиком из павших врагов — пропускается. */
const slotFallen = (order, start) => order.filter((e) => e.slot === order[start].slot).every(fallenFoe);

export function rollInitiative(c, t) {
  const st = tokenStats(c, t);
  const r = roll(`1d20${st.initBonus >= 0 ? '+' : ''}${st.initBonus || 0}`);
  return { init: r.total, natural: r.rolls[0] };
}

/** groups — {tokenId: id пачки} (#198): у членов пачки одна инициатива (её передают в rolls). */
export function startCombat(c, scene, tokenIds, rolls = {}, groups = {}) {
  const entries = tokenIds.map((id) => {
    const t = scene.tokens.find((x) => x.id === id);
    // null — игрок бросит сам; до броска стоит в конце очереди.
    const e = { tokenId: id, init: id in rolls ? rolls[id] : rollInitiative(c, t).init };
    if (groups[id]) e.group = groups[id];
    return e;
  });
  c.combat = { active: true, sceneId: scene.id, round: 1, turn: 0, entries, moved: {}, startedAt: Date.now() };
  addLog(c, { kind: 'combat', text: `Бой начался: ${entries.length} участников` });
}

export function endCombat(c) {
  c.combat = { active: false, round: 1, turn: 0, entries: [], moved: {} };
  addLog(c, { kind: 'combat', text: 'Бой окончен' });
}

export function advanceTurn(c, scene, dir = 1) {
  const order = initiativeOrder(c, scene);
  if (!order.length) return;
  let turn = slotStart(order, Math.min(Math.max(0, c.combat.turn || 0), order.length - 1));
  // Сервер: очередь могла пересортироваться чужой инициативой — считаем от того, кто реально ходит.
  if (c.combat.current) { const i = turnIndexOf(order, c.combat.current); if (i >= 0) turn = i; }
  const starts = slotStarts(order);
  let si = Math.max(0, starts.indexOf(turn));
  for (let step = 0; step < starts.length; step++) {
    si += dir;
    if (si >= starts.length) { si = 0; c.combat.round += 1; }
    if (si < 0) { si = starts.length - 1; c.combat.round = Math.max(1, c.combat.round - 1); }
    if (!slotFallen(order, starts[si])) break;
  }
  turn = starts[si];
  c.combat.turn = turn;
  const cur = order[turn];
  // В начале хода движение обнуляется у всех членов пачки.
  for (const m of order) if (m.slot === cur?.slot) c.combat.moved[m.tokenId] = 0;
  if ('current' in c.combat) c.combat.current = cur?.tokenId || null;
}

/**
 * Чей ход. Сервер: игрок нажал «Закончить ход» (ended), а клиент мастера ещё не передал ход — за столом
 * уже ходит следующий; иначе очередь прыгала бы туда-обратно, пока ход едет через мастера (TASK-113).
 * raw — ход по записи, без этого предпросмотра (служебные пересчёты очереди).
 */
export function currentEntry(c, scene, { raw = false } = {}) {
  if (!c.combat?.active) return null;
  const order = initiativeOrder(c, scene);
  let cur;
  // В серверной кампании игрок не видит скрытых участников боя, и индекс хода у него разъехался бы
  // с мастерским; поэтому мастер записывает, чей ход, полем current (TASK-002).
  if (c.combat.current) cur = order.find((x) => x.tokenId === c.combat.current) || null;
  else cur = order[slotStart(order, c.combat.turn % Math.max(1, order.length))] || null;
  if (raw || !cur || !turnEnded(c)) return cur;
  return nextInOrder(order, cur.tokenId).entry;
}

/** Номер раунда за столом: если законченный ход замыкает круг, а мастер ещё не передал ход, — уже следующий. */
export function combatRound(c, scene) {
  const cb = c.combat;
  if (!cb?.active || !turnEnded(c)) return cb?.round || 1;
  return cb.round + (nextInOrder(initiativeOrder(c, scene), cb.current).wrapped ? 1 : 0);
}

const turnEnded = (c) => !!c.combat.ended && c.combat.ended === c.combat.current;

/** Следующий слот после id (павшие пропускаются, как в advanceTurn); wrapped — начался новый раунд. */
function nextInOrder(order, id) {
  const i = turnIndexOf(order, id);
  if (i < 0 || !order.length) return { entry: null, wrapped: false };
  const starts = slotStarts(order);
  let si = starts.indexOf(i), wrapped = false;
  for (let step = 0; step < starts.length; step++) {
    si += 1;
    if (si >= starts.length) { si = 0; wrapped = true; }
    if (!slotFallen(order, starts[si])) break;
  }
  return { entry: order[starts[si]] || null, wrapped };
}

/**
 * Чей ход по очереди мастера (без учёта current) — мастер пишет это в current перед отправкой. У пачки —
 * её ведущий: первый живой видимый член, иначе первый живой (#198) — так игроки видят ход пачки и при скрытом первом.
 */
export function turnTokenId(c, scene) {
  const order = initiativeOrder(c, scene);
  return order[slotStart(order, c.combat.turn % Math.max(1, order.length))]?.tokenId || null;
}

/**
 * Изменить участников боя (fn), сохранив, чей ход: у пачки — за пачкой, даже если её ведущего отделили (#198).
 * Если того, кто ходил, убрали — ход переходит к следующему живому слоту, как при «Следующий ход»: с новым
 * раундом, если круг замкнулся, и свежим движением. Пустая очередь заканчивает бой.
 */
export function keepTurnWith(c, sc, fn) {
  if (!c.combat?.active) { fn(c, sc); return; }
  const order0 = initiativeOrder(c, sc);
  const before = currentEntry(c, sc, { raw: true })?.tokenId;
  const group = c.combat.entries.find((e) => e.tokenId === before)?.group;
  const i0 = turnIndexOf(order0, before);
  // Кто ходит следом, по кругу: на случай, если текущего уберут. wrap — уже следующий раунд.
  const after = i0 < 0 ? [] : order0.map((e, k) => ({ id: e.tokenId, k })).filter((x) => x.k > i0 && order0[x.k].slot !== order0[i0].slot)
    .concat(order0.map((e, k) => ({ id: e.tokenId, k, wrap: true })).filter((x) => x.k < i0));
  fn(c, sc);
  if (!c.combat.entries.length) { endCombat(c); return; }
  const order = initiativeOrder(c, sc);
  if (!order.length) return;
  const stay = (group && order.find((e) => e.group === group)?.tokenId) || before;
  let i = turnIndexOf(order, stay);
  if (i < 0 && after.length) {
    const live = after.map((x) => ({ ...x, i: turnIndexOf(order, x.id) })).filter((x) => x.i >= 0);
    const next = live.find((x) => !slotFallen(order, x.i)) || live[0];
    if (next) {
      i = next.i;
      if (next.wrap) c.combat.round = (c.combat.round || 1) + 1;
      c.combat.moved = c.combat.moved || {};
      for (const m of order) if (m.slot === order[i].slot) c.combat.moved[m.tokenId] = 0;
    }
  }
  c.combat.turn = i >= 0 ? i : Math.max(0, Math.min(c.combat.turn || 0, order.length - 1));
}

/** Токены, чей сейчас ход: одиночка или вся пачка. */
export function turnTokenIds(c, scene) {
  const cur = currentEntry(c, scene);
  return new Set(cur ? slotMembers(initiativeOrder(c, scene), cur.tokenId).map((e) => e.tokenId) : []);
}
