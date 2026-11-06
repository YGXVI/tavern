// Весы эффектов (#193, план ревизии 4, этап 1): из всего, что есть на существе, решают, что работает сейчас, и собирают бросок.
// Чистые функции без DOM, сети и случайности: кубы приходят снаружи, поэтому каждый сценарий плана проверяется тестом.
// Источник — черта, заклинание, предмет, состояние; его механика — рецепт (dist/js/data/effect-recipes.json).
// Экземпляр — рецепт на этом существе: { ref, recipe, key?, by?, cast?, since?, level?, option?, bonus?, equipped?, attuned?, off? }.

export const OPS = Object.freeze(['add', 'atLeast', 'advantage', 'disadvantage', 'size', 'critRange', 'maxDice', 'acFormula', 'useAbility']);
export const MODES = Object.freeze(['auto', 'ask', 'note']);
export const EVENTS = Object.freeze(['hit', 'miss', 'crit', 'reduced-to-0', 'died', 'turn-start', 'turn-end']);
export const WINDOWS = Object.freeze(['before-roll', 'after-roll', 'after-result']);

const mod = (score) => Math.floor((score - 10) / 2);
const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const keyOf = (x) => x.key || x.recipe?.key || x.ref;

/** Рецепт не проходит проверку — движок его не применяет, а не гадает. Возвращает список ошибок. */
export function validateRecipe(id, recipe) {
  const errors = [], bad = (m) => errors.push(`${id}: ${m}`);
  for (const part of recipe?.parts || []) {
    if (!MODES.includes(part.mode)) bad(`режим ${part.mode}`);
    if (part.window && !WINDOWS.includes(part.window)) bad(`окно ${part.window}`);
    for (const e of list(part.on)) if (!EVENTS.includes(e)) bad(`событие ${e}`);
    for (const e of part.effects || []) if (!OPS.includes(e.op)) bad(`операция ${e.op}`);
  }
  return errors;
}

/** Значение эффекта: число, кубы строкой, параметр экземпляра или { sum: [...] }. Строки-выражения не исполняются. */
export function valueOf(v, params = {}) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.startsWith('$')) return params[v.slice(1)] ?? null;
  if (typeof v === 'string') return v;
  if (Array.isArray(v?.sum)) { const parts = v.sum.map((x) => valueOf(x, params)); return parts.every(Number.isFinite) ? parts.reduce((a, b) => a + b, 0) : null; }
  return null;
}

/** Сила сравнимых экземпляров одного ключа: круг ячейки, бонус предмета. Нечего сравнивать — null. */
const power = (x) => (Number.isFinite(x.bonus) ? x.bonus : Number.isFinite(x.level) ? x.level : null);

/**
 * Один ключ — один победитель: сильнейший, а при равенстве или несравнимости — более свежий. Остальные ждут и вступают,
 * когда победитель закончится. Выключенные мастером не участвуют. Возвращает экземпляры со статусом active | waiting | off.
 */
export function weigh(instances) {
  const groups = new Map();
  for (const x of instances) { if (!groups.has(keyOf(x))) groups.set(keyOf(x), []); groups.get(keyOf(x)).push(x); }
  const out = [];
  for (const group of groups.values()) {
    const live = group.filter((x) => !x.off);
    const best = live.slice().sort((a, b) => {
      const pa = power(a), pb = power(b);
      if (pa !== null && pb !== null && pa !== pb) return pb - pa;
      return (b.since ?? 0) - (a.since ?? 0);
    })[0];
    for (const x of group) out.push({ ...x, status: x.off ? 'off' : x === best ? 'active' : 'waiting' });
  }
  return out;
}

/** Действует ли источник: надет и настроен, если рецепт этого требует. */
function isOn(x) {
  for (const need of x.recipe?.active || []) if (!x[need]) return false;
  return true;
}

/** Живые требования источника: { min: {'ability:str': 13}, none: ['wearing:armor'] }. Возвращает причину отказа или null. */
function unmet(requires, ctx) {
  for (const [k, n] of Object.entries(requires?.min || {})) if ((ctx.values?.[k] ?? 0) < n) return `${k} меньше ${n}`;
  for (const t of requires?.none || []) if ((ctx.state || []).includes(t)) return `мешает ${t}`;
  return null;
}

/** Условие броска: all/any/none по меткам, min/max по числам. rel — true, false или unknown: неизвестное спрашивают. */
function whenMatches(when, tags, ctx) {
  if (!when) return true;
  if (when.all && !when.all.every((t) => tags.includes(t))) return false;
  if (when.any && !when.any.some((t) => tags.includes(t))) return false;
  if (when.none && when.none.some((t) => tags.includes(t))) return false;
  for (const [k, n] of Object.entries(when.min || {})) if (!((ctx.numbers?.[k] ?? -Infinity) >= n)) return false;
  for (const [k, n] of Object.entries(when.max || {})) if (!((ctx.numbers?.[k] ?? Infinity) <= n)) return false;
  for (const r of when.rel || []) { const known = ctx.rel?.[r]; if (known === false) return false; if (known === undefined) return 'unknown'; }
  return true;
}

/** Части источников, которые относятся к этому броску: { auto, ask, notes, waiting }. Части со скоупом других окон не трогаем. */
function collect(instances, tags, ctx) {
  const auto = [], ask = [], notes = [], skipped = [];
  for (const x of weigh(instances)) {
    if (x.status !== 'active') { skipped.push({ ref: x.ref, reason: x.status === 'waiting' ? 'ждёт' : 'выключено' }); continue; }
    if (!isOn(x)) { skipped.push({ ref: x.ref, reason: 'не надето или не настроено' }); continue; }
    const why = unmet(x.recipe?.requires, ctx);
    if (why) { skipped.push({ ref: x.ref, reason: why }); continue; }
    for (const part of x.recipe?.parts || []) {
      if (part.option && part.option !== x.option) continue;
      const fit = whenMatches(part.when, tags, ctx);
      if (fit === false) continue;
      const row = { x, part };
      if (part.mode === 'note') notes.push(row);
      else if (part.mode === 'ask' || fit === 'unknown') { if (ctx.chosen?.includes(part.id)) auto.push(row); else ask.push(row); } else auto.push(row);
    }
  }
  return { auto, ask, notes, skipped };
}
const touches = (e, tags) => !e.to || e.to.some((t) => tags.includes(t));
const label = (x) => x.label || x.recipe?.label || x.ref;
const paramsOf = (x, ctx) => ({ bonus: x.bonus, slotLevel: ctx.numbers?.spellLevel, ...x.params });

/**
 * Что получилось с характеристиками: atLeast — «не меньше», сильнее большее; ниже текущего значения он не действует,
 * и это видно в noEffect. Прибавки к stat считаются поверх.
 */
export function abilities(base, instances, ctx = {}) {
  const out = { ...base }, noEffect = [];
  for (const { x, part } of collect(instances, [], { ...ctx, values: {} }).auto) {
    for (const e of part.effects || []) {
      if (e.op !== 'atLeast' || !e.stat?.startsWith('ability:')) continue;
      const k = e.stat.slice(8), v = valueOf(e.value, paramsOf(x, ctx));
      if (out[k] >= v) noEffect.push({ ref: x.ref, stat: k }); else out[k] = v;
    }
  }
  return { scores: out, noEffect };
}

/** КД: одна лучшая допустимая формула, прибавки сверху. base — формула без эффектов: { value, armor }. */
export function armorClass({ armorBase, mods, wearingArmor = false, shield = 0 }, instances, ctx = {}) {
  const state = [...(ctx.state || []), ...(wearingArmor ? ['wearing:armor'] : [])];
  const c = collect(instances, [], { ...ctx, state });
  const ways = [{ value: armorBase, label: wearingArmor ? 'Доспех' : 'Без доспехов' }];
  const plus = [];
  for (const { x, part } of c.auto) for (const e of part.effects || []) {
    if (e.op === 'acFormula') ways.push({ value: e.base + e.plus.reduce((n, k) => n + (mods[k] ?? 0), 0), label: label(x) });
    if (e.op === 'add' && e.stat === 'ac') plus.push({ value: valueOf(e.value, paramsOf(x, ctx)), label: label(x) });
  }
  const best = ways.reduce((a, b) => (b.value > a.value ? b : a));
  return { value: best.value + shield + plus.reduce((n, p) => n + p.value, 0), formula: best, plus, skipped: c.skipped };
}

/**
 * Собрать бросок к20: преимущество и помеха — выключатели, разные прибавки складываются. tags — метки броска.
 * target — экземпляры на цели со стороной side: 'target' (сбитая с ног цель даёт атакующему преимущество).
 */
export function rollPlan({ tags, base = [] }, instances, ctx = {}, target = []) {
  const mine = collect(instances, tags, ctx), theirs = collect(target, tags, ctx);
  const rows = [...mine.auto, ...theirs.auto.filter(({ part }) => part.side === 'target')];
  const lines = base.map((b) => ({ ...b })), dice = [];
  let adv = false, dis = false, crit = 20;
  for (const { x, part } of rows) for (const e of part.effects || []) {
    if (!touches(e, tags)) continue;
    if (e.op === 'advantage') adv = true;
    else if (e.op === 'disadvantage') dis = true;
    else if (e.op === 'critRange') crit = Math.min(crit, e.value);
    else if (e.op === 'add' && !e.stat) {
      const v = valueOf(e.value, paramsOf(x, ctx));
      if (typeof v === 'number') lines.push({ value: v, label: label(x) }); else if (v) dice.push({ dice: v, label: label(x) });
    }
  }
  return { mode: adv && dis ? 'normal' : adv ? 'advantage' : dis ? 'disadvantage' : 'normal', lines, dice, crit, ask: mine.ask.map(({ x, part }) => ({ ref: x.ref, id: part.id, label: part.label })), notes: mine.notes.map(({ part }) => part.label), skipped: mine.skipped };
}

/** Итог броска как чек: d20 — выпавшие кости (две при преимуществе), diceRolled — результаты бонусных кубов по порядку. */
export function rollResult(plan, { d20, diceRolled = [] }) {
  const kept = plan.mode === 'advantage' ? Math.max(...d20) : plan.mode === 'disadvantage' ? Math.min(...d20) : d20[0];
  const extra = plan.dice.map((d, i) => ({ ...d, rolled: diceRolled[i] ?? 0 }));
  const total = kept + plan.lines.reduce((n, l) => n + l.value, 0) + extra.reduce((n, d) => n + d.rolled, 0);
  return { d20, kept, total, lines: plan.lines, dice: extra, crit: kept >= plan.crit, miss: kept === 1 };
}

/** Попадание: натуральная 1 — промах, крит — попадание, иначе сумма против КД. shield — реакция после броска. */
export const hits = (res, ac, reaction = 0) => (res.miss ? false : res.crit ? true : res.total >= ac + reaction);

/**
 * Урон удара. На крите удваиваются кости, но не числа; промах не даёт ничего, даже +10 от рискованной атаки.
 * Возвращает { dice: [...], flat, maxDice }.
 */
export function damagePlan({ tags, dice, flat = 0, hit = true, crit = false }, instances, ctx = {}) {
  if (!hit) return { dice: [], flat: 0, maxDice: false };
  const c = collect(instances, tags, ctx);
  const out = [dice].filter(Boolean);
  let sum = flat, max = false;
  for (const { x, part } of c.auto) for (const e of part.effects || []) {
    if (!touches(e, tags)) continue;
    if (e.op === 'maxDice') max = true;
    if (e.op !== 'add' || e.stat) continue;
    const v = valueOf(e.value, paramsOf(x, ctx));
    if (typeof v === 'number') sum += v; else if (v) out.push(v);
  }
  return { dice: crit ? out.flatMap((d) => [d, d]) : out, flat: sum, maxDice: max, ask: c.ask.map(({ x, part }) => ({ ref: x.ref, id: part.id, label: part.label })) };
}

/** Сопротивления не умножаются: иммунитет — 0, уязвимость и сопротивление применяются по разу. */
export function applyDefenses(amount, type, { resist = [], vulnerable = [], immune = [] } = {}) {
  if (immune.includes(type)) return 0;
  let n = amount;
  if (resist.includes(type)) n = Math.floor(n / 2);
  if (vulnerable.includes(type)) n *= 2;
  return n;
}

/** Временные хиты не складываются: игрок выбирает, оставить старые или взять новые. */
export const tempHpChoice = (current, incoming) => (incoming > current ? [current, incoming] : [current]);

/** Состояние держится, пока жив хоть один источник. */
export const hasCondition = (id, sources) => sources.some((s) => s.condition === id && !s.off);

/** Новая концентрация снимает прежнюю: все строки той же нити, на всех целях. */
export const dropCast = (rows, cast) => rows.filter((r) => r.cast !== cast);

/** Размер: шаги складываются один раз на ключ, поэтому два Увеличения — одна ступень. */
export function sizeSteps(instances, ctx = {}) {
  return collect(instances, [], ctx).auto.reduce((n, { part }) => n + (part.effects || []).filter((e) => e.op === 'size').reduce((a, e) => a + e.steps, 0), 0);
}

/** Характеристика атаки: фехтовальное оружие — лучшая из Силы и Ловкости, дальнобойное — Ловкость. */
export function attackAbility(weapon, scores) {
  if ((weapon.props || []).includes('finesse')) return mod(scores.dex) > mod(scores.str) ? 'dex' : 'str';
  return weapon.range === 'ranged' ? 'dex' : 'str';
}

/** Надеваемое: одна вещь на слот, не больше трёх настроенных, накладка садится только на подходящую основу. */
export function loadoutErrors(items) {
  const errors = [], slots = new Map();
  for (const it of items) if (it.equipped && it.recipe?.slot) { if (slots.has(it.recipe.slot)) errors.push({ code: 'slot', slot: it.recipe.slot }); slots.set(it.recipe.slot, it); }
  if (items.filter((it) => it.attuned).length > 3) errors.push({ code: 'attunement' });
  for (const it of items) {
    const fits = it.recipe?.fits;
    if (!fits || !it.base) continue;
    if (fits.kind && it.base.kind !== fits.kind) errors.push({ code: 'fits', ref: it.ref });
    if (fits.props && !fits.props.every((p) => (it.base.props || []).includes(p))) errors.push({ code: 'fits', ref: it.ref });
    if (fits.notProps && fits.notProps.some((p) => (it.base.props || []).includes(p))) errors.push({ code: 'fits', ref: it.ref });
  }
  return errors;
}
