// Предпросмотр отдыха: входные данные не меняются, броски передаются готовыми (TASK-004).
import { abilityModifier, knownInteger } from './sheet-rules.js';

const nonnegative = (n) => knownInteger(n) !== null && n >= 0;
const dice = [4, 6, 8, 10, 12, 20];
const validPool = (p, total = 'max') => p && nonnegative(p[total]) && nonnegative(p.spent) && p.spent <= p[total];

export function previewRest(sheet, { kind, eligible = false, hitDieRolls = [], recoverDice = null } = {}) {
  const changes = [], manual = [], errors = [];
  const add = (target, from, to, rule) => { if (from !== to) changes.push({ target, from, to, rule }); };
  const skip = (target, reason) => manual.push({ target, reason });
  const finish = () => ({ kind, changes: errors.length ? [] : changes, manual, errors });
  if (!['short', 'long'].includes(kind)) errors.push('Выберите короткий или продолжительный отдых');
  if (eligible !== true) errors.push('Подтвердите условия отдыха');
  if (!sheet || typeof sheet !== 'object') errors.push('Нет данных листа');
  if (!Array.isArray(hitDieRolls)) errors.push('Нужен список результатов костей');
  if (kind === 'long' && hitDieRolls?.length) errors.push('Расход костей хитов относится к короткому отдыху');
  if (kind === 'short' && recoverDice !== null) errors.push('Возврат костей хитов относится к продолжительному отдыху');
  if (errors.length) return finish();

  const hp = sheet.hp || {};
  const hpKnown = nonnegative(hp.current) && nonnegative(hp.max) && hp.current <= hp.max;
  const pools = sheet.hitDice ?? [];
  if (!Array.isArray(pools)) { errors.push('Нужен список пулов костей хитов'); return finish(); }
  const ids = pools.map((p) => p?.id);
  if (ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) {
    errors.push('У пулов костей нужны уникальные ID'); return finish();
  }
  const hitDiceKnown = pools.every((p) => validPool(p, 'total') && dice.includes(p.die));
  if (recoverDice !== null) {
    if (typeof recoverDice !== 'object' || Array.isArray(recoverDice)) errors.push('Нужны количества возвращаемых костей по ID');
    else for (const [id, amount] of Object.entries(recoverDice)) {
      const pool = pools.find((p) => p.id === id);
      if (!pool || !validPool(pool, 'total') || !dice.includes(pool.die) || !nonnegative(amount) || amount > pool.spent) {
        errors.push('Нельзя вернуть неизвестные или непотраченные кости');
      }
    }
    if (errors.length) return finish();
  }

  if (kind === 'short' && hitDieRolls.length) {
    const con = abilityModifier(sheet.abilities?.con);
    if (!hpKnown || con === null) errors.push('Для расхода костей нужны известные HP и Телосложение');
    const spent = new Map(pools.map((p) => [p.id, p.spent]));
    let healed = 0;
    for (const result of hitDieRolls) {
      const pool = pools.find((p) => p.id === result?.poolId);
      if (!pool || !validPool(pool, 'total') || !dice.includes(pool.die)
        || knownInteger(result.roll) === null || result.roll < 1 || result.roll > pool.die) {
        errors.push('Укажите доступную кость и допустимый результат'); continue;
      }
      if (spent.get(pool.id) >= pool.total) { errors.push('Кости этого пула уже потрачены'); continue; }
      spent.set(pool.id, spent.get(pool.id) + 1);
      if (con !== null) healed += Math.max(0, result.roll + con);
    }
    for (const pool of pools) add({ section: 'hitDice', id: pool.id, field: 'spent' }, pool.spent, spent.get(pool.id), 'short-hit-dice');
    if (hpKnown) add({ section: 'hp', field: 'current' }, hp.current, Math.min(hp.max, hp.current + healed), 'short-hit-dice');
  }

  if (kind === 'long') {
    if (hpKnown) add({ section: 'hp', field: 'current' }, hp.current, hp.max, 'long-hp');
    else skip({ section: 'hp' }, 'Уточните текущие и максимальные HP');
    if (hitDiceKnown && pools.length) {
      const total = knownInteger(pools.reduce((sum, p) => sum + p.total, 0));
      if (total === null) errors.push('Общее число костей слишком велико');
      else {
        const budget = Math.max(1, Math.floor(total / 2));
        const candidates = pools.filter((p) => p.spent > 0);
        let chosen = recoverDice;
        if (chosen === null && candidates.length <= 1) {
          chosen = candidates.length ? { [candidates[0].id]: Math.min(budget, candidates[0].spent) } : {};
        }
        if (chosen === null) skip({ section: 'hitDice' }, `Выберите возвращаемые кости: не больше ${budget}`);
        else if (typeof chosen !== 'object' || Array.isArray(chosen)) errors.push('Нужны количества возвращаемых костей по ID');
        else {
          let count = 0;
          for (const [id, amount] of Object.entries(chosen)) {
            const pool = pools.find((p) => p.id === id);
            if (!pool || !nonnegative(amount) || amount > pool.spent) { errors.push('Нельзя вернуть неизвестные или непотраченные кости'); continue; }
            count += amount;
            add({ section: 'hitDice', id, field: 'spent' }, pool.spent, pool.spent - amount, 'long-hit-dice');
          }
          if (!Number.isSafeInteger(count) || count > budget) errors.push('Превышен лимит возвращаемых костей');
        }
      }
    } else if (pools.length || recoverDice !== null) skip({ section: 'hitDice' }, 'Уточните общее число и расход костей');

    if (nonnegative(hp.temp) && hp.temp > 0) {
      if (hp.tempExpiresOnLongRest === true) add({ section: 'hp', field: 'temp' }, hp.temp, 0, 'long-temp-hp');
      else skip({ section: 'hp', field: 'temp' }, 'Уточните длительность временных HP');
    }
  }

  for (const section of ['resources', 'slotPools']) {
    const values = sheet[section] ?? [];
    if (!Array.isArray(values)) { errors.push(`Нужен список ${section}`); continue; }
    const seen = new Set();
    for (const pool of values) {
      if (typeof pool?.id !== 'string' || !pool.id || seen.has(pool.id)) { errors.push(`Нужны уникальные ID в ${section}`); continue; }
      seen.add(pool.id);
      const target = { section, id: pool.id, field: 'spent' };
      if (!['short', 'long', 'both'].includes(pool.recovery)) { skip(target, 'Восстановление вручную: правило не задано'); continue; }
      if (!validPool(pool)) { skip(target, 'Уточните максимум и расход ресурса'); continue; }
      if (pool.recovery === kind || pool.recovery === 'both') add(target, pool.spent, 0, `${kind}-resource`);
    }
  }
  return finish();
}
