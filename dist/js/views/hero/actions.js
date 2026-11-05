// Действия листа настоящего героя (#202): меняют Character на месте и возвращают подсказку для экрана.
// Правила — те же, что у листа за столом: урон и спасброски от смерти (rules/attack.js), отдых по пулам листа.
// Вызывается внутри updateCampaign: дальше изменения уходят на сервер командами листа (server/character-sheet-ops.js).
import { heroDamage, heroHpConditions, deathSaveStep, isDead } from '../../rules/attack.js';
import { CONDITIONS, mod } from '../../data/rules.js';

const n = (x, d = 0) => (Number.isFinite(x) ? x : d);
const d = (sides, random) => 1 + Math.floor(random() * sides);
const condName = (id) => CONDITIONS.find((c) => c.id === id)?.name || id;

/** Бросок по формуле «2к6+3» / «1d20-1» / «+5» (к20 + бонус). Возвращает {total, detail} или null. */
export function rollFormula(formula, random = Math.random) {
  const f = String(formula ?? '').replace(/\s+/g, '').replace(/[−–]/g, '-').replace(/[кd]/gi, 'd');
  const expr = /^[+-]?\d+$/.test(f) ? `1d20${f.startsWith('-') || f.startsWith('+') ? f : `+${f}`}` : f;
  if (!/^(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$/.test(expr)) return null;
  let total = 0; const parts = [];
  for (const [, sign, term] of expr.matchAll(/([+-]?)(\d*d\d+|\d+)/g)) {
    const k = sign === '-' ? -1 : 1;
    if (term.includes('d')) {
      const [cnt, sides] = term.split('d').map(Number);
      const rolls = Array.from({ length: cnt || 1 }, () => d(sides, random));
      total += k * rolls.reduce((a, b) => a + b, 0); parts.push(`${sign}${cnt || 1}к${sides} [${rolls.join(', ')}]`);
    } else { total += k * Number(term); parts.push(`${sign}${term}`); }
  }
  return { total, detail: parts.join(' ').replace(/^\+/, '') };
}

function setHp(ch, hp) {
  const before = n(ch.hp);
  ch.hp = hp;
  ch.conditions = heroHpConditions(ch.conditions, before, hp);
  if (before === 0 && hp > 0) ch.deathSaves = { s: 0, f: 0 };
}

function spendLegacySlot(ch, circle) {
  const slot = ch.slots?.[circle];
  if (!slot) return { title: 'Не нашёл ячейки' };
  if (n(slot.used) >= n(slot.max)) return { title: 'Не осталось', body: `Ячейки ${circle} ур.: 0 из ${n(slot.max)}` };
  slot.used = n(slot.used) + 1;
  return { title: `Ячейки ${circle} ур.: осталось ${n(slot.max) - slot.used} из ${n(slot.max)}`, icon: 'tick-02' };
}

/** Применить действие к персонажу. Возвращает {title, body?, icon?} для подсказки или null. */
export function applyHeroAction(ch, name, p = {}, { random = Math.random } = {}) {
  switch (name) {
    case 'setHp': {
      if (Number.isFinite(p.temp)) ch.tempHp = Math.max(0, Math.round(p.temp));
      const delta = Math.round(n(p.delta));
      if (delta < 0) {
        const r = heroDamage({ hp: n(ch.hp), hpMax: n(ch.hpMax), tempHp: n(ch.tempHp), deathSaves: ch.deathSaves }, -delta);
        const before = n(ch.hp);
        ch.hp = r.hp; ch.tempHp = r.tempHp; ch.deathSaves = r.deathSaves;
        ch.conditions = heroHpConditions(ch.conditions, before, r.hp);
        return r.dead ? { title: `${ch.name} погибает`, icon: 'skull' } : r.dropped ? { title: `${ch.name} без сознания`, icon: 'heart-remove' } : null;
      }
      if (delta > 0) setHp(ch, Math.min(n(ch.hpMax, Infinity), n(ch.hp) + delta));
      return null;
    }
    case 'roll': {
      const r = rollFormula(p.formula, random);
      return r ? { title: `${p.what || 'Бросок'}: ${r.total}`, body: r.detail, icon: 'dice-faces-06' } : { title: 'Не понял формулу', body: String(p.formula ?? '') };
    }
    case 'useResource': {
      // Старый лист: ячейки — slots{круг: {max, used}} (readCharacter даёт им ID legacy-slot-N), кости — строкой без счётчика.
      const legacy = /^legacy-slot-(\d)$/.exec(p.id || '');
      if (legacy) return spendLegacySlot(ch, Number(legacy[1]));
      if (p.id === 'legacy-hit-dice') return { title: 'Кости хитов старого листа', body: 'Потраченные кости отмечаются за столом, в листе героя.' };
      let pool = [...(ch.slotPools || []), ...(ch.resources || []), ...(ch.hitDicePools || [])].find((x) => x.id === p.id);
      // Заряд умения класса, посчитанный листом (gear.js), записывается в resources при первой трате (#203).
      if (!pool && /^cls-/.test(p.id || '') && Number.isFinite(p.total) && p.total > 0) {
        pool = { id: p.id, name: String(p.name || 'Умение'), max: p.total, spent: 0, recovery: p.recovery === 'short' ? 'short' : 'long' };
        ch.resources = [...(ch.resources || []), pool];
      }
      if (!pool) return { title: 'Не нашёл ресурс' };
      const max = n(pool.max ?? pool.total);
      if (n(pool.spent) >= max) return { title: 'Не осталось', body: `${pool.name || 'Ресурс'}: 0 из ${max}` };
      pool.spent = n(pool.spent) + 1;
      return { title: `${pool.name || 'Ресурс'}: осталось ${max - pool.spent} из ${max}`, icon: 'tick-02' };
    }
    case 'toggleCondition': {
      if (!p.id) return { title: 'Состояния', body: 'Выбор состояния появится в листе позже — отметьте его за столом.' };
      const set = new Set(ch.conditions || []);
      if (set.has(p.id)) set.delete(p.id); else set.add(p.id);
      ch.conditions = [...set];
      return { title: `${condName(p.id)}: ${set.has(p.id) ? 'отмечено' : 'снято'}` };
    }
    case 'dropConcentration': {
      delete ch.concentration;
      ch.conditions = (ch.conditions || []).filter((c) => c !== 'concentration');
      return { title: 'Концентрация снята' };
    }
    case 'deathSave': {
      if (n(ch.hp) > 0) return { title: 'Спасбросок от смерти — только при 0 хитов' };
      const nat = d(20, random);
      const { ds, out } = deathSaveStep(ch.deathSaves, nat);
      if (out === 'no') return { title: isDead(ch.deathSaves) ? `${ch.name} мёртв` : `${ch.name} стабилен` };
      ch.deathSaves = ds;
      if (out === 'up') setHp(ch, 1);
      const title = { up: `${nat}! ${ch.name} приходит в себя с 1 хитом`, stable: `${nat}: ${ch.name} стабилен`, dead: `${nat}: ${ch.name} погибает`, roll: `${nat}: ${nat >= 10 ? 'успех' : 'провал'}` }[out];
      return { title: `Спасбросок от смерти — ${title}`, body: `Успехов ${ds.s || 0}, провалов ${ds.f || 0}`, icon: 'dice-faces-06' };
    }
    case 'rest': {
      if (p.kind === 'long') {
        ch.hp = n(ch.hpMax, n(ch.hp)); ch.tempHp = 0; ch.deathSaves = { s: 0, f: 0 };
        ch.conditions = (ch.conditions || []).filter((c) => c !== 'unconscious');
        for (const s of ch.slotPools || []) s.spent = 0;
        for (const r of ch.resources || []) if (['long', 'short'].includes(r.recovery)) r.spent = 0;
        if (ch.slots && typeof ch.slots === 'object') for (const s of Object.values(ch.slots)) if (s) s.used = 0;
        // Кости хитов: возвращается половина общего числа (не меньше одной), сначала большие.
        const pools = [...(ch.hitDicePools || [])].sort((a, b) => n(b.die) - n(a.die));
        let back = Math.max(1, Math.floor(pools.reduce((s, x) => s + n(x.total), 0) / 2));
        for (const x of pools) { const k = Math.min(back, n(x.spent)); x.spent = n(x.spent) - k; back -= k; }
        return { title: 'Продолжительный отдых', body: 'Хиты, ячейки и умения восстановлены, половина костей хитов вернулась.', icon: 'moon-02' };
      }
      let healed = 0; let left = Math.max(0, Math.round(n(p.hitDice)));
      const con = mod(ch.stats?.con);
      for (const x of [...(ch.hitDicePools || [])].sort((a, b) => n(b.die) - n(a.die))) {
        while (left > 0 && n(x.spent) < n(x.total)) { x.spent = n(x.spent) + 1; healed += Math.max(0, d(x.die, random) + con); left--; }
      }
      if (healed) setHp(ch, Math.min(n(ch.hpMax, Infinity), n(ch.hp) + healed));
      for (const r of ch.resources || []) if (r.recovery === 'short') r.spent = 0;
      for (const s of ch.slotPools || []) if (s.kind === 'pact') s.spent = 0;
      return { title: 'Короткий отдых', body: healed ? `Восстановлено ${healed} хитов.` : 'Умения короткого отдыха восстановлены.', icon: 'coffee-02' };
    }
    case 'equip': {
      // Надеть или снять предмет (#203). Пока игрок ничего не надевал, лист показывает стартовый комплект надетым —
      // при первой правке он записывается как есть (p.auto), а потом меняется выбранный предмет.
      if (!Array.isArray(ch.inventoryItems)) return { title: 'В старом листе надетое не хранится', body: 'КД и атаки у этого героя записаны вручную — правьте их в листе за столом.' };
      const auto = new Set(p.auto || []);
      if (!ch.inventoryItems.some((x) => x.equipped)) for (const x of ch.inventoryItems) if (auto.has(x.id)) x.equipped = true;
      const it = ch.inventoryItems.find((x) => x.id === p.itemId);
      if (!it) return { title: 'Предмет не найден' };
      it.equipped = !it.equipped;
      return { title: `${p.name || it.name}: ${it.equipped ? 'надето' : 'в рюкзаке'}`, icon: 'tick-02' };
    }
    case 'addItem': {
      // Предмет из снаряжения SRD или свой (#203): в структурированную сумку, у старого листа — строкой в конец.
      const name = String(p.name || '').trim();
      if (!name) return null;
      const qty = Math.max(1, Math.round(n(p.quantity, 1)));
      if (Array.isArray(ch.inventoryItems) || !ch.inventory || typeof ch.inventory !== 'string') {
        const list = Array.isArray(ch.inventoryItems) ? ch.inventoryItems : [];
        const same = p.ref && list.find((x) => x.ref === p.ref && !x.equipped);
        if (same) same.quantity = n(same.quantity, 1) + qty;
        else list.push({ id: p.id || crypto.randomUUID(), name, quantity: qty, weight: Number.isFinite(p.weight) ? p.weight : null, equipped: false, attuned: false, description: String(p.description || ''), ...(p.ref ? { ref: p.ref } : {}) });
        ch.inventoryItems = list;
      } else ch.inventory = `${ch.inventory.replace(/[\s,.]+$/, '')}, ${qty > 1 ? `${qty} × ` : ''}${name}`;
      return { title: `${name}${qty > 1 ? ` ×${qty}` : ''} — в сумке`, icon: 'tick-02' };
    }
    case 'removeItem': {
      if (!Array.isArray(ch.inventoryItems)) return { title: 'В старом листе сумка — строкой', body: 'Уберите предмет в листе за столом.' };
      const it = ch.inventoryItems.find((x) => x.id === p.itemId);
      if (!it) return null;
      if (n(it.quantity, 1) > 1) it.quantity = n(it.quantity, 1) - 1; else ch.inventoryItems = ch.inventoryItems.filter((x) => x !== it);
      return { title: `${p.name || it.name}: убрано`, icon: 'tick-02' };
    }
    case 'coins': {
      const c = { pp: 0, ep: 0, gp: 0, sp: 0, cp: 0, ...(ch.coins || {}) };
      for (const k of Object.keys(c)) if (Number.isFinite(p[k])) c[k] = Math.max(0, Math.round(p[k]));
      ch.coins = c;
      return { title: 'Монеты обновлены', icon: 'tick-02' };
    }
    case 'prepare': {
      const s = (ch.knownSpells || []).find((x) => x.id === p.spellId);
      if (!s) return null;
      s.prepared = !!p.prepared;
      return null;
    }
    case 'cast': {
      const lg = /^legacy-(\d)-/.exec(p.spellId || '');
      const s = lg ? { name: 'Заклинание', circle: Number(lg[1]) } : (ch.knownSpells || []).find((x) => x.id === p.spellId);
      if (!s) return { title: 'Заклинание не найдено' };
      const level = n(s.circle);
      if (!level) return { title: `${s.name}: заговор, ячейка не нужна`, icon: 'sparkles' };
      const want = n(p.slot, level);
      if (!Array.isArray(ch.slotPools) && ch.slots) {
        const circle = Object.keys(ch.slots).map(Number).filter((c) => c >= want && n(ch.slots[c]?.used) < n(ch.slots[c]?.max)).sort((a, b) => a - b)[0];
        if (!circle) return { title: `Нет ячеек ${want} уровня и выше`, body: 'Отдохните или выберите заговор.' };
        return { ...spendLegacySlot(ch, circle), title: `${s.name} — ячейка ${circle} ур.` };
      }
      const pool = (ch.slotPools || []).filter((x) => n(x.circle) >= want && n(x.spent) < n(x.max)).sort((a, b) => n(a.circle) - n(b.circle))[0];
      if (!pool) return { title: `Нет ячеек ${want} уровня и выше`, body: 'Отдохните или выберите заговор.' };
      pool.spent = n(pool.spent) + 1;
      return { title: `${s.name} — ячейка ${pool.circle} ур.`, body: `Осталось ${n(pool.max) - pool.spent} из ${n(pool.max)}.`, icon: 'sparkles' };
    }
    case 'editField': {
      if (p.field === 'name' && typeof p.value === 'string' && p.value.trim()) { ch.name = p.value.trim(); return null; }
      if (/^note-\d+$/.test(p.field || '')) { ch.notes = String(p.value ?? ''); return { title: 'Заметка сохранена' }; }
      if (p.field === 'menu') return { title: 'Меню листа', body: 'Портрет, архив и передача героя — за столом, в листе героя.' };
      return { title: 'Пока не сохраняется', body: 'Черты, идеалы и внешность появятся на сервере следующим шагом.' };
    }
    default: return null;
  }
}
