// Сценарии плана эффектов (#193, §12): что на существе → ожидаемый итог.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRecipe, weigh, abilities, armorClass, rollPlan, rollResult, hits, damagePlan, applyDefenses, tempHpChoice, hasCondition, dropCast, sizeSteps, attackAbility, loadoutErrors, valueOf } from '../dist/js/rules/effects.js';

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
