// Езда верхом и слои токенов (TASK-187, план TASK-097 п. 3.5 и 2.2).
// Всадник хранит id ездового в `riding` и стоит в той же точке x, y; у ездового флаг `mount`. Несколько всадников
// одного ездового рисуются рядом (riderOffset → ctx.viewPosOf), данные при этом не меняются.
// Ручной слой `layer` (0–2) переопределяет выведенный: предмет 0, ездовое 1, остальные 2.
import { footprintAt, footprintGap } from '../../rules/geometry.js';
import { sizeById } from '../../data/rules.js';

/** Слой токена: ручной или выведенный из вида и флага «ездовое». */
export function tokenLayer(t) {
  const L = Number(t?.layer);
  if (t?.layer != null && Number.isInteger(L) && L >= 0 && L <= 2) return L;
  return t?.kind === 'item' ? 0 : t?.mount ? 1 : 2;
}

const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

/**
 * Порядок наложения: Map(id → z 1…N). Сначала слой, внутри слоя выше тот, кого двигали последним, токены без
 * перемещений — по порядку на сцене. Всадник — сразу над своим ездовым (и не ниже его слоя). Одинаков у всех.
 */
export function stackOrder(tokens) {
  const at = new Map(tokens.map((t, i) => [t.id, i]));
  const keyOf = (t, i) => {
    const m = t.riding && t.riding !== t.id ? tokens[at.get(t.riding)] : null;
    if (m && !m.riding) return [Math.max(tokenLayer(t), tokenLayer(m)), Number(m.movedAt) || 0, at.get(m.id), 1, Number(t.movedAt) || 0, i];
    return [tokenLayer(t), Number(t.movedAt) || 0, i, 0, 0, 0];
  };
  const order = tokens.map((t, i) => ({ id: t.id, k: keyOf(t, i) })).sort((a, b) => cmp(a.k, b.k));
  return new Map(order.map((o, k) => [o.id, k + 1]));
}

export const ridersOf = (scene, mountId) => (scene?.tokens || []).filter((t) => t.riding === mountId && t.id !== mountId);

/**
 * Смещение всадника на рисунке (#203, sol0139: «двое садятся верхом — наслаиваются друг на друга»). В данных все
 * всадники стоят в точке ездового (так их везёт сервер, guard_token), а рисуются в ряд по ширине ездового: один —
 * по центру, двое и больше — рядом, порядок — как на сцене (не меняется от поездок). diam(t) — диаметр токена, px.
 */
export function riderOffset(scene, t, diam) {
  if (!t?.riding) return null;
  const riders = ridersOf(scene, t.riding);
  const n = riders.length, i = riders.indexOf(t);
  if (n < 2 || i < 0) return null;
  const m = (scene?.tokens || []).find((x) => x.id === t.riding);
  if (!m) return null;
  const dm = diam(m), dr = Math.max(...riders.map(diam));
  const step = Math.min(dr * 0.92, Math.max(dr * 0.6, (dm - dr) / (n - 1)));
  return { x: (i - (n - 1) / 2) * step, y: -dr * 0.08 };
}

/**
 * Перемещения с учётом езды: тянут ездовое — всадники едут в ту же точку (`carried`); всадника двигают без его
 * ездового — он спешивается (`dismount`). Возвращает новый список, исходный не меняет.
 */
export function expandRideMoves(scene, moves, { keepLocked = false } = {}) {
  const byId = new Map(moves.map((m) => [m.id, m]));
  const out = moves.map((m) => ({ ...m, to: { ...m.to } }));
  for (const m of out) {
    const t = scene.tokens.find((x) => x.id === m.id);
    if (!t?.riding) continue;
    const mm = byId.get(t.riding);
    if (mm) m.to = { ...mm.to }; else m.dismount = true;
  }
  for (const m of moves) {
    for (const r of ridersOf(scene, m.id)) {
      if (byId.has(r.id)) continue;
      // Закреплённого мастером всадника игрок не везёт: тот спешивается на месте, ездовое уходит (review C6).
      if (keepLocked && r.locked) { out.push({ id: r.id, from: { x: r.x, y: r.y }, to: { x: r.x, y: r.y }, carried: true, dismount: true }); byId.set(r.id, m); continue; }
      out.push({ id: r.id, from: { x: r.x, y: r.y }, to: { ...m.to }, carried: true });
      byId.set(r.id, m);
    }
  }
  return out;
}

// ——— Права (интерфейс; сервер проверяет сам, guard_token) ———
const ownsOrMine = (ctx, t) => !!t && (ctx.isMine(t) || ctx.owns(t));
/** Посадить: владелец всадника или мастер. */
export const canSeat = (ctx, rider) => !!rider && rider.kind !== 'item' && (ctx.isMasterView || ownsOrMine(ctx, rider));
/** Спешить: владелец всадника, владелец ездового или мастер. */
export function canDismount(ctx, rider) {
  if (!rider?.riding) return false;
  const mount = ctx.scene?.tokens.find((t) => t.id === rider.riding);
  return ctx.isMasterView || ownsOrMine(ctx, rider) || ownsOrMine(ctx, mount);
}
/** Флаг «ездовое» и ручной слой: мастер; игрок — у своего токена и призыва (не у героя с листом). */
export const canFlag = (ctx, t) => !!t && t.kind !== 'item' && (ctx.isMasterView || ctx.owns(t));

/** Ездовые рядом со всадником: видимые, на этой сцене, не сами верхом, вплотную (соседние клетки или общие). */
export function mountsNear(ctx, rider) {
  const sc = ctx.scene; if (!sc || !rider) return [];
  if (ridersOf(sc, rider.id).length) return []; // верхом цепочкой нельзя
  const fp = (t) => { const n = sizeById(t.size).cells; return { ...footprintAt(sc.grid, t.x, t.y, n), n }; };
  const a = fp(rider);
  return sc.tokens.filter((m) => m.mount && m.id !== rider.id && m.kind !== 'item' && !m.riding && m.id !== rider.riding
    && (ctx.isMasterView || (!m.hidden && ctx.tokenShown(m)))
    && footprintGap(a, fp(m)) <= 1);
}

// ——— Действия (с отменой) ———
/**
 * Правка токенов с отменой только тех полей, что поменяла fn: отмена не возвращает чужие правки (хиты мастера,
 * перемещение) поверх снимка всего токена. Общая для езды и своих токенов (p-token.js).
 */
export function editFields(ctx, ids, label, fn) {
  const sc = ctx.scene; if (!sc) return;
  const plan = [];
  for (const id of ids) {
    const cur = sc.tokens.find((t) => t.id === id); if (!cur) continue;
    const probe = structuredClone(cur);
    fn(probe, sc);
    const keys = [...new Set([...Object.keys(cur), ...Object.keys(probe)])].filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(probe[k]));
    if (keys.length) plan.push({ id, before: Object.fromEntries(keys.map((k) => [k, structuredClone(cur[k])])), after: Object.fromEntries(keys.map((k) => [k, structuredClone(probe[k])])) });
  }
  if (!plan.length) return;
  const put = (s, which) => {
    for (const p of plan) {
      const t = s.tokens.find((x) => x.id === p.id); if (!t) continue;
      for (const [k, v] of Object.entries(p[which])) { if (v === undefined) delete t[k]; else t[k] = structuredClone(v); }
    }
  };
  ctx.mutateScene((s) => put(s, 'after'), { label, undo: (s) => put(s, 'before'), redo: (s) => put(s, 'after') });
}
const edit = editFields;

/** Сесть верхом: всадник встаёт в точку ездового и рисуется поверх него. */
export function seat(ctx, riderId, mountId) {
  const m = ctx.scene?.tokens.find((t) => t.id === mountId);
  if (!m?.mount) { ctx.toast({ title: 'Это не ездовое', icon: 'alert-circle' }); return; }
  const at = Date.now();
  edit(ctx, [riderId], 'Сесть верхом', (t) => { t.riding = mountId; t.x = m.x; t.y = m.y; t.movedAt = at; });
}

/** Спешиться: связь снимается, всадник остаётся на месте. */
export function dismount(ctx, riderIds) {
  edit(ctx, riderIds, 'Спешиться', (t) => { delete t.riding; });
}

/** Флаг «ездовое»: снять его — значит спешить всадников. */
export function toggleMount(ctx, id) {
  const t = ctx.scene?.tokens.find((x) => x.id === id); if (!t) return;
  const riders = t.mount ? ridersOf(ctx.scene, id).map((r) => r.id) : [];
  edit(ctx, [id, ...riders], t.mount ? 'Не ездовое' : 'Ездовое', (x) => { if (x.id === id) { if (x.mount) delete x.mount; else x.mount = true; } else delete x.riding; });
}

/** Ручной слой: 0–2 или null — снова по виду. */
export function setLayer(ctx, id, v) {
  edit(ctx, [id], 'Слой', (t) => { if (v == null) delete t.layer; else t.layer = v; });
}

export const LAYERS = [[null, 'По виду'], [0, 'Нижний — как предметы'], [1, 'Средний — как ездовые'], [2, 'Верхний — как все']];

/** Пункты меню ПКМ: езда, «Ездовое», «Слой…». menu — функция открытия подменю (ui/kit.js). */
export function ridingItems(ctx, t, anchor, menu) {
  if (!t || t.kind === 'item') return [];
  const name = (x) => ctx.nameOf?.(x) || x.name;
  const out = [];
  if (t.riding) {
    const m = ctx.scene.tokens.find((x) => x.id === t.riding);
    if (canDismount(ctx, t)) out.push({ icon: 'logout-01', label: m ? `Спешиться с «${name(m)}»` : 'Спешиться', onClick: () => dismount(ctx, [t.id]) });
  } else if (canSeat(ctx, t)) {
    const ms = mountsNear(ctx, t);
    if (ms.length === 1) out.push({ icon: 'login-01', label: `Сесть верхом на «${name(ms[0])}»`, onClick: () => seat(ctx, t.id, ms[0].id) });
    else if (ms.length > 1) out.push({ icon: 'login-01', label: 'Сесть верхом на…', onClick: () => menu(ms.map((m) => ({ icon: 'login-01', label: name(m), onClick: () => seat(ctx, t.id, m.id) })), anchor, { placement: 'right' }) });
  }
  const riders = ridersOf(ctx.scene, t.id);
  if (riders.length && (ctx.isMasterView || ownsOrMine(ctx, t))) out.push({ icon: 'user-remove-01', label: riders.length > 1 ? `Ссадить всех (${riders.length})` : `Ссадить «${name(riders[0])}»`, onClick: () => dismount(ctx, riders.map((r) => r.id)) });
  if (canFlag(ctx, t)) {
    out.push({ icon: t.mount ? 'tick-02' : 'circle', label: 'Ездовое', onClick: () => toggleMount(ctx, t.id) });
    out.push({ icon: 'layers-01', label: 'Слой…', onClick: () => menu(LAYERS.map(([v, l]) => ({ icon: (t.layer ?? null) === v ? 'tick-02' : 'circle', label: l, onClick: () => setLayer(ctx, t.id, v) })), anchor, { placement: 'right' }) });
  }
  return out;
}
