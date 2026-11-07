// Сценарии плана эффектов (#193, §12): что на существе → ожидаемый итог.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { speedOf, validateRecipe, weigh, abilities, armorClass, rollPlan, rollResult, hits, damagePlan, applyDefenses, tempHpChoice, hasCondition, dropCast, sizeSteps, attackAbility, loadoutErrors, valueOf } from '../dist/js/rules/effects.js';

const { recipes: R } = JSON.parse(readFileSync(new URL('../dist/js/data/effect-recipes.json', import.meta.url), 'utf8'));
const on = (ref, extra = {}) => ({ ref, recipe: R[ref], ...extra });
const BLESS = 'dndsu:spell:9', FAITH = 'dndsu:spell:69', ENLARGE = 'dndsu:spell:355', GAUNTLETS = 'dndsu:item:203', PLUS = 'dndsu:item:160', CLOAK = 'dndsu:item:171';
const GWM = 'example:feat:great-weapon-master', GRAPPLER = 'example:feat:grappler', POTION = 'dndsu:item:2289', MAGE = 'dndsu:spell:60', UNARMORED = 'example:feature:barbarian-unarmored-defense';
const bardic = { label: 'Вдохновение барда', parts: [{ mode: 'auto', effects: [{ op: 'add', value: '1d6', to: ['attack', 'save', 'check'] }] }] };
const poison = { label: 'Дварфская стойкость', parts: [{ mode: 'auto', when: { all: ['save', 'vs:poison'] }, effects: [{ op: 'advantage', to: ['save'] }] }] };
const prone = { label: 'Ничком', parts: [
  { mode: 'auto', side: 'target', when: { all: ['attack', 'within:5'] }, effects: [{ op: 'advantage', to: ['attack'] }] },
  { mode: 'auto', side: 'target', when: { all: ['attack'], none: ['within:5'] }, effects: [{ op: 'disadvantage', to: ['attack'] }] }] };

test('все рецепты проходят проверку', () => {
  for (const [id, r] of Object.entries(R)) assert.deepEqual(validateRecipe(id, r), []);
  assert.equal(validateRecipe('x', { parts: [{ mode: 'auto', effects: [{ op: 'взорвать' }] }] }).length, 1);
});

test('1: два Увеличения — одно; своё кончилось — работает чужое', () => {
  const own = on(ENLARGE, { option: 'enlarge', since: 1 }), wizard = on(ENLARGE, { option: 'enlarge', since: 2 });
  assert.equal(sizeSteps([own, wizard]), 1);
  assert.deepEqual(weigh([own, wizard]).map((x) => x.status).sort(), ['active', 'waiting']);
  assert.equal(weigh([own]).at(0).status, 'active');
});

test('2, 3: два Благословения — один куб; Благословение и Вдохновение — оба', () => {
  assert.equal(rollPlan({ tags: ['attack'] }, [on(BLESS, { by: 'a', since: 1 }), on(BLESS, { by: 'b', since: 2 })]).dice.length, 1);
  assert.deepEqual(rollPlan({ tags: ['attack'] }, [on(BLESS), { ref: 'bard', recipe: bardic }]).dice.map((d) => d.dice), ['1d4', '1d6']);
});

test('4: преимущество и две помехи — обычный бросок', () => {
  const adv = { ref: 'a', recipe: { parts: [{ mode: 'auto', effects: [{ op: 'advantage', to: ['attack'] }] }] } };
  const dis = (ref) => ({ ref, recipe: { parts: [{ mode: 'auto', effects: [{ op: 'disadvantage', to: ['attack'] }] }] } });
  assert.equal(rollPlan({ tags: ['attack'] }, [adv, dis('b'), dis('c')]).mode, 'normal');
  assert.equal(rollPlan({ tags: ['attack'] }, [dis('b'), dis('c')]).mode, 'disadvantage');
});

test('5: одна лучшая формула КД, прибавки сверху; в доспехе формулы не работают', () => {
  const mods = { dex: 3, con: 4 };
  const r = armorClass({ armorBase: 13, mods }, [on(MAGE), on(UNARMORED), on(FAITH), on(CLOAK, { equipped: true, attuned: true })]);
  assert.equal(r.formula.value, 17); assert.equal(r.value, 20);
  assert.equal(armorClass({ armorBase: 16, mods, wearingArmor: true, shield: 2 }, [on(MAGE), on(UNARMORED)]).value, 18);
});

test('6: сопротивление не умножается', () => {
  assert.equal(applyDefenses(20, 'fire', { resist: ['fire', 'fire'] }), 10);
  assert.equal(applyDefenses(20, 'fire', { immune: ['fire'] }), 0);
  assert.equal(applyDefenses(7, 'fire', { resist: ['fire'] }), 3);
});

test('7, 8: временные хиты на выбор; состояние держится на оставшемся источнике', () => {
  assert.deepEqual(tempHpChoice(5, 8), [5, 8]);
  assert.deepEqual(tempHpChoice(8, 5), [8]);
  assert.equal(hasCondition('frightened', [{ condition: 'frightened', by: 'dragon' }]), true);
  assert.equal(hasCondition('frightened', []), false);
});

test('9: рукавицы при Силе 20 не действуют, и это видно; снятые не считаются', () => {
  const g = on(GAUNTLETS, { equipped: true, attuned: true });
  assert.equal(abilities({ str: 12 }, [g]).scores.str, 19);
  const r = abilities({ str: 20 }, [g]);
  assert.equal(r.scores.str, 20); assert.equal(r.noEffect[0].ref, GAUNTLETS);
  assert.equal(abilities({ str: 12 }, [on(GAUNTLETS, { attuned: true })]).scores.str, 12);
});

test('11, 12: новая концентрация и провал снимают все строки нити', () => {
  const rows = [{ target: 'a', cast: 'c1' }, { target: 'b', cast: 'c1' }, { target: 'c', cast: 'c1' }, { target: 'a', cast: 'c2' }];
  assert.deepEqual(dropCast(rows, 'c1'), [{ target: 'a', cast: 'c2' }]);
});

test('13: зелье максимальной мощи не срабатывает на 5 круге и ждёт', () => {
  const tags = ['damage:spell'];
  assert.equal(damagePlan({ tags, dice: '8d6' }, [on(POTION)], { numbers: { spellLevel: 5 } }).ask.length, 0);
  assert.equal(damagePlan({ tags, dice: '8d6' }, [on(POTION)], { numbers: { spellLevel: 4 } }).ask.length, 1);
  assert.equal(damagePlan({ tags, dice: '8d6' }, [on(POTION)], { numbers: { spellLevel: 4 }, chosen: ['max'] }).maxDice, true);
});

test('14, 15: вторые рукавицы, четвёртая настройка, накладка не на то', () => {
  const g = on(GAUNTLETS, { equipped: true, attuned: true });
  assert.equal(loadoutErrors([g, { ...g }])[0].code, 'slot');
  assert.equal(loadoutErrors([1, 2, 3, 4].map((n) => ({ ref: `i${n}`, attuned: true })))[0].code, 'attunement');
  const flame = { ref: 'tongue', recipe: { fits: { kind: 'weapon', props: ['sword'] } }, base: { kind: 'weapon', props: ['heavy', 'reach'] } };
  assert.equal(loadoutErrors([flame])[0].code, 'fits');
});

test('16: «−5 / +10» спрашивает у алебарды и не спрашивает у кинжала', () => {
  const heavy = ['attack', 'attack:melee', 'attack:weapon', 'weapon:heavy', 'proficient'];
  assert.equal(rollPlan({ tags: heavy }, [on(GWM)]).ask[0].id, 'power');
  assert.equal(rollPlan({ tags: ['attack', 'attack:melee', 'attack:weapon', 'proficient'] }, [on(GWM)]).ask.length, 0);
});

test('17, 18: на крите удваиваются кости, а не числа; промах не даёт ничего', () => {
  const tags = ['damage', 'damage:weapon', 'weapon:enlarged', 'attack:melee', 'attack:weapon', 'weapon:heavy', 'proficient'];
  const list = [on(GWM), on(ENLARGE, { option: 'enlarge' }), on(PLUS, { bonus: 2 })];
  const d = damagePlan({ tags, dice: '1d10', flat: 3, crit: true }, list, { chosen: ['power'] });
  assert.deepEqual(d.dice, ['1d10', '1d10', '1d4', '1d4']);
  assert.equal(d.flat, 15, 'Сила +3, +10, +2 не удваиваются');
  assert.deepEqual(damagePlan({ tags, dice: '1d10', flat: 3, hit: false }, list, { chosen: ['power'] }), { dice: [], flat: 0, maxDice: false });
});

test('19, 20: сторона цели: сбитая с ног цель — преимущество вблизи, помеха издалека', () => {
  const t = [{ ref: 'prone', recipe: prone }];
  assert.equal(rollPlan({ tags: ['attack', 'within:5'] }, [], {}, t).mode, 'advantage');
  assert.equal(rollPlan({ tags: ['attack'] }, [], {}, t).mode, 'disadvantage');
});

test('21: дварф против яда — с преимуществом, против огня — без', () => {
  const d = [{ ref: 'dwarf', recipe: poison }];
  assert.equal(rollPlan({ tags: ['save', 'vs:poison'] }, d).mode, 'advantage');
  assert.equal(rollPlan({ tags: ['save', 'vs:fire'] }, d).mode, 'normal');
});

test('22: рапира берёт Ловкость при Силе 10 и Ловкости 16', () => {
  assert.equal(attackAbility({ props: ['finesse'] }, { str: 10, dex: 16 }), 'dex');
  assert.equal(attackAbility({ props: ['heavy'] }, { str: 10, dex: 16 }), 'str');
});

test('23: Щит после попадания превращает атаку в промах, если хватает +5', () => {
  const res = rollResult(rollPlan({ tags: ['attack'], base: [{ value: 5, label: 'Бонус' }] }, []), { d20: [12] });
  assert.equal(res.total, 17);
  assert.equal(hits(res, 15), true);
  assert.equal(hits(res, 15, 5), false);
});

test('24: чек показывает оба броска и выбранный', () => {
  const adv = { ref: 'a', recipe: { parts: [{ mode: 'auto', effects: [{ op: 'advantage', to: ['attack'] }] }] } };
  const res = rollResult(rollPlan({ tags: ['attack'], base: [{ value: 5, label: 'Сила' }] }, [adv, on(BLESS)]), { d20: [4, 12], diceRolled: [3] });
  assert.deepEqual(res.d20, [4, 12]); assert.equal(res.kept, 12); assert.equal(res.total, 20);
});

test('натуральные 1 и крит из рецепта', () => {
  const champ = on('example:feature:champion-improved-critical');
  const p = rollPlan({ tags: ['attack', 'attack:weapon'] }, [champ]);
  assert.equal(p.crit, 19);
  assert.equal(rollResult(p, { d20: [19] }).crit, true);
  assert.equal(hits(rollResult(rollPlan({ tags: ['attack'], base: [{ value: 30, label: 'x' }] }, []), { d20: [1] }), 5), false);
});

test('живое требование и неизвестное отношение: Борец при Силе 12 не работает, захват спрашивают', () => {
  const g = [on(GRAPPLER)], tags = ['attack'];
  assert.equal(rollPlan({ tags }, g, { values: { 'ability:str': 12 } }).mode, 'normal');
  assert.equal(rollPlan({ tags }, g, { values: { 'ability:str': 13 }, rel: { 'target:grappled-by-me': true } }).mode, 'advantage');
  assert.equal(rollPlan({ tags }, g, { values: { 'ability:str': 13 } }).ask.length, 1);
  assert.equal(rollPlan({ tags }, g, { values: { 'ability:str': 13 }, rel: { 'target:grappled-by-me': false } }).mode, 'normal');
});

test('значения: параметр и сумма; строки-выражения не исполняются', () => {
  assert.equal(valueOf('$bonus', { bonus: 2 }), 2);
  assert.equal(valueOf({ sum: [2, '$slotLevel'] }, { slotLevel: 2 }), 4);
  assert.equal(valueOf({ sum: [2, '$slotLevel'] }, {}), null);
  assert.equal(valueOf('process.exit(1)'), 'process.exit(1)', 'строка остаётся строкой');
});

test('состояния SRD: броски, цель, автопровал, скорость', async () => {
  const { conditionInstances, CONDITION_RECIPES } = await import('../dist/js/rules/condition-recipes.js');
  assert.equal(Object.keys(CONDITION_RECIPES).length, 15);
  for (const [id, r] of Object.entries(CONDITION_RECIPES)) assert.deepEqual(validateRecipe(id, r), []);
  const has = (...conditions) => conditionInstances({ conditions });
  const attack = { tags: ['attack'] }, close = { tags: ['attack', 'within:5'] };
  // Свои броски
  assert.equal(rollPlan(attack, has('blinded')).mode, 'disadvantage');
  assert.equal(rollPlan(attack, has('invisible')).mode, 'advantage');
  assert.equal(rollPlan(attack, has('poisoned')).mode, 'disadvantage');
  assert.equal(rollPlan({ tags: ['check', 'check:str'] }, has('poisoned')).mode, 'disadvantage');
  assert.equal(rollPlan({ tags: ['save', 'save:str'] }, has('poisoned')).mode, 'normal');
  assert.equal(rollPlan(attack, has('blinded', 'invisible')).mode, 'normal', 'преимущество и помеха гасятся');
  assert.equal(rollPlan({ tags: ['save', 'save:dex'] }, has('restrained')).mode, 'disadvantage');
  assert.equal(rollPlan({ tags: ['save', 'save:str'] }, has('restrained')).mode, 'normal');
  // Автопровал
  for (const id of ['paralyzed', 'stunned', 'unconscious', 'petrified']) {
    assert.equal(rollPlan({ tags: ['save', 'save:str'] }, has(id)).autoFail, true, id);
    assert.equal(rollPlan({ tags: ['save', 'save:dex'] }, has(id)).autoFail, true, id);
    assert.equal(rollPlan({ tags: ['save', 'save:wis'] }, has(id)).autoFail, false, id);
  }
  // По цели
  for (const id of ['blinded', 'paralyzed', 'petrified', 'restrained', 'stunned', 'unconscious']) assert.equal(rollPlan(attack, [], {}, has(id)).mode, 'advantage', id);
  assert.equal(rollPlan(attack, [], {}, has('invisible')).mode, 'disadvantage');
  assert.equal(rollPlan(close, [], {}, has('prone')).mode, 'advantage');
  assert.equal(rollPlan(attack, [], {}, has('prone')).mode, 'disadvantage');
  assert.equal(rollPlan(close, [], {}, has('paralyzed')).autoCrit, true);
  assert.equal(rollPlan(attack, [], {}, has('paralyzed')).autoCrit, false, 'издалека не крит');
  assert.equal(rollPlan(close, [], {}, has('stunned')).autoCrit, false, 'у ошеломлённого автокрита нет');
  assert.equal(rollPlan(attack, has('prone'), {}).mode, 'disadvantage', 'своя часть цели не применяется к себе');
  // Испуг зависит от источника
  assert.equal(rollPlan(attack, has('frightened'), { rel: { 'fear:in-sight': false } }).mode, 'normal');
  assert.equal(rollPlan(attack, has('frightened'), { rel: { 'fear:in-sight': true } }).mode, 'disadvantage');
  assert.equal(rollPlan(attack, has('frightened')).ask.length, 1, 'неизвестное спрашиваем');
  // Скорость
  for (const id of ['grappled', 'restrained', 'paralyzed', 'stunned', 'unconscious', 'petrified']) assert.equal(speedOf(30, has(id)), 0, id);
  assert.equal(speedOf(30, has('poisoned')), 30);
  // Истощение: эта степень и все меньшие
  const ex = (n) => conditionInstances({ exhaustion: n });
  assert.equal(rollPlan({ tags: ['check'] }, ex(1)).mode, 'disadvantage');
  assert.equal(rollPlan(attack, ex(2)).mode, 'normal');
  assert.equal(speedOf(30, ex(1)), 30); assert.equal(speedOf(30, ex(2)), 15);
  assert.equal(rollPlan(attack, ex(3)).mode, 'disadvantage'); assert.equal(rollPlan({ tags: ['save'] }, ex(3)).mode, 'disadvantage');
  assert.equal(speedOf(30, ex(5)), 0);
  assert.equal(conditionInstances({ conditions: ['exhaustion'] })[0].level, 1, 'отметка без степени — первая');
  assert.equal(conditionInstances({ conditions: [{ id: 'prone' }] }).length, 1, 'запись объектом');
});

test('бросок стола: автопровал и помеха от состояний', async () => {
  globalThis.self ??= {}; globalThis.window ??= { addEventListener() {}, removeEventListener() {} };
  const { conditionRoll, rollTags } = await import('../dist/js/views/table/effects-roll.js');
  assert.deepEqual(rollTags({ kind: 'save', what: 'Спасбросок: Ловкость' }), ['save', 'save:dex']);
  assert.deepEqual(rollTags({ kind: 'check', ability: 'str' }), ['check', 'check:str']);
  assert.equal(conditionRoll({ conditions: ['poisoned'] }, { kind: 'attack' }).adv, 'dis');
  assert.equal(conditionRoll({ conditions: ['stunned'] }, { kind: 'save', what: 'Спасбросок: Сила' }).autoFail, true);
  assert.equal(conditionRoll({ conditions: ['frightened'] }, { kind: 'attack' }).adv, 'dis');
  assert.equal(conditionRoll({}, { kind: 'attack' }).adv, null);
  assert.deepEqual(conditionRoll({ conditions: ['poisoned'] }, { kind: 'attack' }).why, ['Отравлен']);
});

// Топ-30 (#193, этап 5). Новый рецепт — черновик, пока его не проверил человек; топ-30 проверен YGXVI 07.11.2026.
const TOP30 = ['dndsu:spell:9', 'dndsu:spell:254', 'dndsu:spell:105', 'dndsu:spell:332', 'dndsu:spell:70', 'dndsu:spell:69', 'dndsu:spell:100', 'dndsu:spell:83', 'dndsu:spell:355', 'dndsu:spell:207', 'dndsu:spell:164', 'dndsu:spell:312', 'dndsu:spell:60', 'dndsu:spell:10', 'dndsu:spell:42', 'dndsu:spell:236', 'dndsu:spell:316', 'dndsu:spell:74', 'dndsu:spell:129', 'dndsu:spell:295', 'dndsu:spell:99', 'dndsu:spell:165', 'dndsu:spell:356', 'dndsu:spell:38',
  'srd51:feature:barbarian:rage', 'srd51:feature:bard:bardic-inspiration', 'srd51:feature:rogue:sneak-attack', 'srd51:feature:barbarian:reckless-attack', 'srd51:feature:paladin:divine-smite', 'srd51:action:dodge'];
const checked = (ref, more = {}) => ({ ref, recipe: R[ref], ...more });
const draft = (ref) => ({ ref, recipe: { ...R[ref], status: 'draft' } });
const spellRef = (n) => `dndsu:spell:${n}`;

test('топ-30: все на месте, схема верна, все проверены человеком', () => {
  assert.equal(new Set(TOP30).size, 30);
  for (const ref of TOP30) { assert.ok(R[ref], ref); assert.deepEqual(validateRecipe(ref, R[ref]), []); }
  assert.equal(TOP30.filter((ref) => R[ref].status).length, 0, 'проверил YGXVI 07.11.2026');
  const cat = JSON.parse(readFileSync(new URL('../dist/js/data/spells-2014.json', import.meta.url), 'utf8'));
  for (const e of cat.entries.filter((x) => TOP30.includes(x.id) && x.id !== spellRef(355))) assert.equal(!!R[e.id].concentration, e.concentration, e.id);
});

test('топ-30: каждое число рецепта есть в тексте SRD', () => {
  const srd = JSON.parse(readFileSync(new URL('../dist/js/data/spells-srd-2014.json', import.meta.url), 'utf8')).spells;
  const list = Array.isArray(srd) ? srd : Object.values(srd);
  const cat = JSON.parse(readFileSync(new URL('../dist/js/data/spells-2014.json', import.meta.url), 'utf8')).entries;
  const feats = JSON.parse(readFileSync(new URL('../dist/js/data/features-2014.json', import.meta.url), 'utf8')).entries;
  const textOf = (ref) => {
    const en = cat.find((e) => e.id === ref)?.name.en;
    const s = en && list.find((x) => x.name.toLowerCase() === en.toLowerCase());
    return s ? [...s.text, s.higher || ''].join(' ') : feats.find((f) => f.id === ref)?.text.en || null;
  };
  for (const ref of TOP30.filter((r) => R[r].src === 'srd51' && r !== 'srd51:action:dodge')) {
    const text = textOf(ref); assert.ok(text, ref);
    for (const part of R[ref].parts) for (const e of part.effects || []) {
      if (e.value == null || typeof e.value === 'object') continue; // таблицы проверены ниже по таблицам классов
      const n = String(e.value).replace(/^-/, '');
      const needle = /d\d+/.test(n) ? n.replace(/^\d+/, '') : n;
      assert.ok(text.includes(needle), `${ref}: ${e.value} нет в тексте`);
    }
  }
});

test('черновик только напоминает: числа и состояния не меняются', () => {
  const attack = { tags: ['attack'] };
  const plan = rollPlan(attack, [draft(spellRef(254))]);
  assert.deepEqual([plan.dice, plan.lines, plan.mode], [[], [], 'normal']);
  assert.equal(speedOf(30, [draft(spellRef(316))]), 30);
  assert.equal(armorClass({ armorBase: 12, mods: {} }, [draft(spellRef(70))]).value, 12);
});

test('проверенные рецепты топ-30: броски', () => {
  const attack = { tags: ['attack'] };
  const bane = rollPlan(attack, [checked(spellRef(254))]);
  assert.deepEqual(bane.dice.map((d) => [d.dice, d.sign]), [['1d4', -1]]);
  assert.equal(rollResult(bane, { d20: [10], diceRolled: [3] }).total, 7, 'Порча вычитает');
  assert.equal(rollPlan({ tags: ['check', 'check:dex'] }, [checked(spellRef(254))]).dice.length, 0, 'к проверкам не относится');
  assert.equal(rollPlan({ tags: ['check', 'check:dex'] }, [checked(spellRef(105))]).ask.length, 1, 'Указание спрашивает');
  assert.equal(rollPlan(attack, [checked(spellRef(105))]).ask.length, 0);
  assert.equal(rollPlan({ tags: ['save', 'save:wis'] }, [checked(spellRef(332))]).ask.length, 1);
  assert.equal(rollPlan({ tags: ['save', 'save:dex'] }, [checked(spellRef(100))]).mode, 'advantage');
  assert.equal(rollPlan({ tags: ['save', 'save:dex'] }, [checked(spellRef(83))]).lines[0].value, -2);
  // Со стороны цели: известное отношение работает, неизвестное спрашивают
  const fire = [checked(spellRef(207))];
  assert.equal(rollPlan(attack, [], { rel: { 'attacker:sees-target': true } }, fire).mode, 'advantage');
  assert.equal(rollPlan(attack, [], { rel: { 'attacker:sees-target': false } }, fire).mode, 'normal');
  assert.equal(rollPlan(attack, [], {}, fire).ask.length, 1);
  assert.equal(rollPlan(attack, fire, { rel: { 'attacker:sees-target': true } }).mode, 'normal', 'на себя не действует');
  assert.equal(rollPlan(attack, [], { rel: { 'attacker:relies-on-sight': true } }, [checked(spellRef(295))]).mode, 'disadvantage');
  assert.equal(rollPlan(attack, [], { rel: { 'attacker:protected-type': true } }, [checked(spellRef(99))]).mode, 'disadvantage');
  assert.equal(rollPlan(attack, [], { rel: { 'target:sees-attacker': true } }, [checked('srd51:action:dodge')]).mode, 'disadvantage');
  // Ярость: в тяжёлом доспехе не работает
  const rage = checked('srd51:feature:barbarian:rage', { level: 9 });
  assert.equal(rollPlan({ tags: ['check', 'check:str'] }, [rage]).mode, 'advantage');
  assert.equal(rollPlan({ tags: ['check', 'check:str'] }, [rage], { state: ['wearing:heavy-armor'] }).mode, 'normal');
  const hit = ['damage', 'damage:weapon', 'attack:melee', 'ability:str'];
  assert.equal(damagePlan({ tags: hit, dice: '1d8', flat: 3 }, [rage]).flat, 6, 'уровень 9: +3');
  assert.equal(damagePlan({ tags: hit, dice: '1d8', flat: 3 }, [{ ...rage, level: 8 }]).flat, 5);
  assert.equal(damagePlan({ tags: hit, dice: '1d8', flat: 3 }, [{ ...rage, level: 16 }]).flat, 7);
  assert.equal(damagePlan({ tags: ['damage', 'damage:weapon', 'attack:melee', 'ability:dex'], dice: '1d8', flat: 3 }, [rage]).flat, 3, 'только через Силу');
});

test('проверенные рецепты топ-30: таблицы, урон, КД, скорость', () => {
  const table = (ref, part, params) => valueOf(R[ref].parts[part].effects[0].value, params);
  for (let level = 1; level <= 20; level++) assert.equal(table('srd51:feature:rogue:sneak-attack', 0, { level }), `${Math.ceil(level / 2)}d6`, `плут ${level}`);
  assert.deepEqual([1, 4, 5, 9, 10, 14, 15, 20].map((level) => table('srd51:feature:bard:bardic-inspiration', 0, { level })), ['1d6', '1d6', '1d8', '1d8', '1d10', '1d10', '1d12', '1d12']);
  assert.deepEqual([1, 2, 3, 4, 5].map((slotLevel) => table('srd51:feature:paladin:divine-smite', 0, { slotLevel })), ['2d8', '3d8', '4d8', '5d8', '5d8'], 'не больше 5к8');
  const weapon = ['damage', 'damage:weapon'];
  assert.deepEqual(damagePlan({ tags: weapon, dice: '1d8' }, [checked(spellRef(10))]).dice, ['1d8', '1d4'], 'Божественное благоволение');
  assert.deepEqual(damagePlan({ tags: weapon, dice: '1d8', crit: true }, [checked(spellRef(164))], { rel: { 'target:marked-by-me': true } }).dice, ['1d8', '1d8', '1d6', '1d6'], 'Метка на крите удваивается');
  assert.equal(damagePlan({ tags: weapon, dice: '1d8' }, [checked(spellRef(164))]).ask.length, 1, 'та ли цель — спрашиваем');
  assert.equal(damagePlan({ tags: [...weapon, 'weapon:finesse'], dice: '1d6' }, [checked('srd51:feature:rogue:sneak-attack', { level: 5 })]).ask.length, 1);
  assert.equal(damagePlan({ tags: weapon, dice: '1d6' }, [checked('srd51:feature:rogue:sneak-attack', { level: 5 })]).ask.length, 0, 'тяжёлым оружием нельзя');
  const ac = (...list) => armorClass({ armorBase: 12, mods: {} }, list).value;
  assert.equal(ac(checked(spellRef(70))), 17, 'Щит');
  assert.equal(ac(checked(spellRef(100))), 14, 'Ускорение');
  assert.equal(ac(checked(spellRef(83))), 10, 'Замедление');
  assert.equal(ac(checked(spellRef(74))), 16, 'Дубовая кора');
  assert.equal(armorClass({ armorBase: 18, mods: {} }, [checked(spellRef(74))]).value, 18, 'Кора не снижает');
  assert.equal(ac(checked(spellRef(74)), { ref: spellRef(69), recipe: R[spellRef(69)] }), 18, 'Щит веры поверх Коры');
  assert.equal(speedOf(30, [checked(spellRef(316))]), 40, 'Скороход');
  assert.equal(speedOf(30, [checked(spellRef(83))]), 15, 'Замедление');
  assert.equal(speedOf(30, [checked(spellRef(316)), checked(spellRef(83))]), 20);
});

test('наложения: концентрация, нить, длительность, состояния от заклинаний', async () => {
  const { setRecipes, castRows, endCast, expired, effectInstances, roundsOf } = await import('../dist/js/rules/effect-rows.js');
  const { conditionRoll } = await import('../dist/js/views/table/effects-roll.js');
  setRecipes(R);
  let { rows } = castRows([], { ref: spellRef(9), targets: ['a', 'b', 'c'], by: 'u1', cast: 'k1', round: 2 });
  assert.equal(rows.length, 3); assert.equal(rows[0].until, 12, 'минута — 10 раундов');
  ({ rows } = castRows(rows, { ref: spellRef(316), targets: ['a'], by: 'u1', cast: 'k2' }));
  assert.equal(rows.length, 4, 'Скороход без концентрации ничего не снимает');
  const next = castRows(rows, { ref: spellRef(254), targets: ['z'], by: 'u1', cast: 'k3' });
  assert.deepEqual(next.rows.map((r) => r.cast), ['k2', 'k3'], 'новая концентрация снимает всю прежнюю нить');
  assert.equal(next.dropped.length, 3);
  assert.equal(castRows(rows, { ref: spellRef(254), targets: ['z'], by: 'u2', cast: 'k4' }).rows.length, 5, 'чужая концентрация не мешает');
  assert.equal(endCast(rows, 'k1').length, 1);
  assert.deepEqual(expired(rows, 11).length, 0); assert.equal(expired(rows, 12).length, 3);
  assert.equal(roundsOf({ hours: 1 }), 600);
  const c = { effects: [{ target: 'a', ref: spellRef(356) }, { target: 'a', ref: spellRef(9) }, { target: 'b', ref: spellRef(254) }, { target: 'a', ref: 'неизвестно' }] };
  const onA = effectInstances(c, 'a');
  assert.equal(conditionRoll({}, { kind: 'save', what: 'Спасбросок: Сила' }, onA).autoFail, true, 'Удержание даёт паралич');
  assert.deepEqual(conditionRoll({}, { kind: 'attack' }, effectInstances({ effects: [{ target: 'a', ref: spellRef(9) }] }, 'a')).dice, { 4: 1 }, 'Благословение бросает к4');
  assert.deepEqual(conditionRoll({}, { kind: 'attack' }, effectInstances(c, 'b')).minus, [{ sides: 4, label: 'Порча' }]);
  setRecipes(Object.fromEntries(Object.entries(R).map(([k, v]) => [k, { ...v, status: 'draft' }])));
  assert.equal(conditionRoll({}, { kind: 'save', what: 'Спасбросок: Сила' }, effectInstances(c, 'a')).autoFail, false, 'черновик не парализует');
  assert.deepEqual(conditionRoll({}, { kind: 'attack' }, effectInstances(c, 'b')).minus, []);
  setRecipes({});
});

test('заметки заменены расчётом', async () => {
  const { setRecipes, effectInstances } = await import('../dist/js/rules/effect-rows.js');
  const { conditionRoll, effectDamage, sheetWithEffects } = await import('../dist/js/views/table/effects-roll.js');
  const { hpMaxOf } = await import('../dist/js/rules/effects.js');
  setRecipes(R);
  const on = (ref, more = {}) => effectInstances({ effects: [{ target: 'a', ref, ...more }] }, 'a');
  assert.equal(speedOf(30, [checked(spellRef(100))]), 60, 'Ускорение');
  assert.equal(speedOf(30, [checked(spellRef(100)), checked(spellRef(83))]), 30, 'Ускорение и Замедление');
  assert.deepEqual([2, 3, 9].map((slotLevel) => hpMaxOf(20, on(spellRef(236), { slotLevel }))), [25, 30, 60], 'Подмога по кругу');
  // Сглаз: цель с помехой на выбранной характеристике, заклинатель с +1к6
  assert.equal(conditionRoll({}, { kind: 'check', ability: 'dex' }, on(spellRef(312), { option: 'dex' })).adv, 'dis');
  assert.equal(conditionRoll({}, { kind: 'check', ability: 'str' }, on(spellRef(312), { option: 'dex' })).adv, null);
  assert.equal(rollPlan({ tags: ['check', 'check:wis'] }, [checked(spellRef(164))]).ask.length, 1, 'Метка: поиск цели');
  // Безрассудство открывается только после выбора
  const reckless = 'srd51:feature:barbarian:reckless-attack';
  assert.equal(rollPlan({ tags: ['attack'] }, [], {}, [checked(reckless, { option: 'used' })]).mode, 'advantage');
  assert.equal(rollPlan({ tags: ['attack'] }, [], {}, [checked(reckless)]).mode, 'normal');
  // Уклонение пропадает у недееспособного и при скорости 0
  const dex = { kind: 'save', what: 'Спасбросок: Ловкость' }, dodge = on('srd51:action:dodge');
  assert.equal(conditionRoll({}, dex, dodge).adv, 'adv');
  assert.equal(conditionRoll({ conditions: ['stunned'] }, dex, dodge).autoFail, true);
  assert.equal(conditionRoll({ conditions: ['grappled'] }, dex, dodge).adv, null, 'скорость 0');
  // Отмена состояний
  assert.equal(conditionRoll({ conditions: ['frightened'] }, { kind: 'attack' }, on(spellRef(42))).adv, null, 'Героизм отменяет испуг');
  assert.equal(conditionRoll({ conditions: ['invisible'] }, { kind: 'attack' }, on(spellRef(207))).adv, null, 'Огонь фей отменяет невидимость');
  assert.equal(conditionRoll({ conditions: ['invisible'] }, { kind: 'attack' }).adv, 'adv');
  // Урон на листе
  const melee = ['damage:weapon', 'attack:weapon', 'attack:melee', 'ability:str'];
  assert.deepEqual(effectDamage({}, melee, on(spellRef(10))).dice, { 4: 1 }, 'Божественное благоволение');
  assert.equal(effectDamage({}, melee, on('srd51:feature:barbarian:rage', { level: 9 })).mod, 3, 'Ярость');
  assert.deepEqual(effectDamage({}, ['damage:weapon'], on(spellRef(355), { option: 'enlarge' })).dice, { 4: 1 }, 'Увеличение');
  const small = effectDamage({}, ['damage:weapon'], on(spellRef(355), { option: 'reduce' }));
  assert.deepEqual([small.minus, small.min], [[{ sides: 4, label: 'Эффект' }], 1], 'Уменьшение: не меньше 1');
  assert.deepEqual(effectDamage({}, [], on(spellRef(10))).dice, {}, 'не оружием — не считается');
  // Числа листа
  const v = { vitals: { ac: { value: 14 }, speed: '30 фт', hp: { now: 10, max: 20 } } };
  const shown = sheetWithEffects(v, {}, (ac) => ac + 2, on(spellRef(100)));
  assert.deepEqual([shown.vitals.ac.value, shown.vitals.speed], [16, '60 фт']);
  assert.equal(sheetWithEffects(v, {}, (ac) => ac, []), v, 'без эффектов лист не меняется');
  setRecipes({});
});
