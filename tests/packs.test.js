// #198: пачки в инициативе — нарезка (k = max(min(3, n), ⌈n/10⌉), поровну, по близости), очередь слотами,
// передача хода пачке целиком, пропуск павших пачек, ведущий — первый живой видимый.
import test from 'node:test';
import assert from 'node:assert/strict';

// combat.js берёт числа токенов из core/campaign.js, а тот — хранилище браузера: на время импорта без него.
globalThis.self ??= {};
globalThis.window ??= { addEventListener() {}, removeEventListener() {} };
const realInterval = globalThis.setInterval;
globalThis.setInterval = () => 0;
const { packSizes, packByProximity, planPacks, packKind, packMarks, baseName, summonKind, groupKind, isSummonKind } = await import('../dist/js/views/table/packs.js');
const { initiativeOrder, advanceTurn, currentEntry, turnTokenId, turnTokenIds, turnIndexOf, slotMembers } = await import('../dist/js/views/table/combat.js');
globalThis.setInterval = realInterval;

test('размеры пачек: делим на 3, но не больше 10 в пачке', () => {
  const t = { 1: [1], 2: [1, 1], 3: [1, 1, 1], 4: [2, 1, 1], 10: [4, 3, 3], 20: [7, 7, 6], 30: [10, 10, 10], 31: [8, 8, 8, 7], 40: [10, 10, 10, 10], 45: [9, 9, 9, 9, 9] };
  for (const [n, want] of Object.entries(t)) assert.deepEqual(packSizes(Number(n)), want, `n=${n}`);
  for (let n = 1; n <= 60; n++) {
    const s = packSizes(n);
    assert.equal(s.reduce((a, b) => a + b, 0), n);
    assert.ok(Math.max(...s) <= 10 && Math.max(...s) - Math.min(...s) <= 1, `n=${n}`);
  }
});

test('по близости: две кучки — две пачки, без перемешивания', () => {
  const a = Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, x: i * 10, y: 0 }));
  const b = Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, x: 1000 + i * 10, y: 500 }));
  const packs = packByProximity([...b, ...a], [5, 5]);
  assert.equal(packs.length, 2);
  for (const p of packs) assert.equal(new Set(p.map((id) => id[0])).size, 1, `пачка из одной кучки: ${p}`);
  assert.deepEqual(packByProximity([...b, ...a], [5, 5]), packs, 'детерминированно');
});

test('скрытые отдельно от видимых; «одной группой» и «каждый отдельно»', () => {
  const z = (i, hidden = false) => ({ id: `z${i}`, x: i * 50, y: 0, hidden });
  const toks = [...Array.from({ length: 6 }, (_, i) => z(i)), ...Array.from({ length: 4 }, (_, i) => z(10 + i, true))];
  const auto = planPacks(toks, 'auto');
  for (const p of auto) assert.equal(new Set(p.map((id) => toks.find((t) => t.id === id).hidden)).size, 1, 'засада не связана с видимыми');
  assert.deepEqual(planPacks(toks, 'one').map((p) => p.length), [6, 4]);
  assert.equal(planPacks(toks, 'each').length, 10);
  assert.equal(packKind({ kind: 'foe', monsterId: 'zombie' }), 'zombie');
  assert.equal(packKind({ kind: 'foe', monsterId: 'wolf', summonedBy: 'h1', ownerId: 'u' }), null, 'призывы игрока — не по виду');
  assert.equal(packKind({ kind: 'hero', characterId: 'c' }), null);
  assert.equal(baseName('Зомби 12'), 'Зомби');
});

// Сцена: герой Лира (иниц. 15), пачка зомби g1 (иниц. 12, z1 скрыт), пачка g2 (иниц. 8), гоблин 10.
const mk = () => {
  const zombie = (id, o = {}) => ({ id, kind: 'foe', name: `Зомби ${id}`, monsterId: 'zombie', hp: 22, hpMax: 22, initBonus: -2, x: 0, y: 0, ...o });
  const scene = { id: 's', tokens: [
    { id: 'h', kind: 'hero', name: 'Лира', x: 0, y: 0, initBonus: 3 },
    zombie('z1', { hidden: true }), zombie('z2'), zombie('z3'),
    zombie('z4'), zombie('z5'),
    { id: 'g', kind: 'foe', name: 'Гоблин', hp: 7, hpMax: 7, initBonus: 2, x: 0, y: 0 },
  ] };
  const c = { characters: [], creatures: {}, combat: { active: true, sceneId: 's', round: 1, turn: 0, moved: {}, entries: [
    { tokenId: 'h', init: 15 }, { tokenId: 'z1', init: 12, group: 'g1' }, { tokenId: 'z2', init: 12, group: 'g1' }, { tokenId: 'z3', init: 12, group: 'g1' },
    { tokenId: 'g', init: 10 }, { tokenId: 'z4', init: 8, group: 'g2' }, { tokenId: 'z5', init: 8, group: 'g2' },
  ] } };
  return { c, scene };
};

test('очередь слотами: пачка подряд, ведущий — первый живой видимый', () => {
  const { c, scene } = mk();
  const o = initiativeOrder(c, scene);
  assert.deepEqual(o.map((e) => e.tokenId), ['h', 'z2', 'z3', 'z1', 'g', 'z4', 'z5']);
  assert.deepEqual(o.filter((e) => e.lead).map((e) => e.tokenId), ['h', 'z2', 'g', 'z4']);
  assert.equal(turnIndexOf(o, 'z1'), 1, 'номер хода — начало слота');
  assert.deepEqual(slotMembers(o, 'z3').map((e) => e.tokenId).sort(), ['z1', 'z2', 'z3']);
  const marks = packMarks(o);
  assert.equal(marks.get('z1').n, 1);
  assert.equal(marks.get('z5').n, 2);
  assert.equal(marks.has('g'), false);
});

test('ход: пачка целиком, движение обнуляется у всех, павшая пачка пропускается, круг замыкается', () => {
  const { c, scene } = mk();
  c.combat.current = null; // сервер: мастер пишет current
  c.combat.moved = { z1: 30, z2: 15, z3: 5 };
  advanceTurn(c, scene, 1);
  assert.equal(c.combat.current, 'z2', 'ход пачки: ведущий — видимый, хотя первый по имени скрыт');
  assert.deepEqual([...turnTokenIds(c, scene)].sort(), ['z1', 'z2', 'z3']);
  assert.deepEqual(c.combat.moved, { z1: 0, z2: 0, z3: 0 });
  advanceTurn(c, scene, 1);
  assert.equal(c.combat.current, 'g', 'после пачки — следующий слот, а не следующий зомби');
  for (const id of ['z4', 'z5']) scene.tokens.find((t) => t.id === id).hp = 0;
  advanceTurn(c, scene, 1);
  assert.equal(c.combat.current, 'h', 'вся пачка пала — пропускается');
  assert.equal(c.combat.round, 2);
  advanceTurn(c, scene, -1);
  assert.equal(c.combat.current, 'g', 'назад тоже по слотам');
});

test('пал ведущий посреди хода: ход остаётся у пачки, ведёт следующий живой', () => {
  const { c, scene } = mk();
  c.combat.turn = 1; // ход g1 (песочница: по номеру хода)
  assert.equal(turnTokenId(c, scene), 'z2');
  scene.tokens.find((t) => t.id === 'z2').hp = 0;
  assert.equal(turnTokenId(c, scene), 'z3');
  assert.equal(currentEntry(c, scene).slot, 'g:g1');
});

test('старый бой без group — как раньше', () => {
  const { c, scene } = mk();
  for (const e of c.combat.entries) delete e.group;
  const o = initiativeOrder(c, scene);
  assert.equal(o.every((e) => e.slotSize === 1), true);
  advanceTurn(c, scene, 1);
  assert.equal(o[c.combat.turn].tokenId, 'z1');
  advanceTurn(c, scene, 1);
  assert.equal(initiativeOrder(c, scene)[c.combat.turn].tokenId, 'z2');
});

// ——— Атака толпой (#198 §5, честный режим) ———
const realInterval2 = globalThis.setInterval;
globalThis.setInterval = () => 0;
const { attackReach, inReach, critDice, rollDamage, outcome, adjust, applyHits, rollAttacks } = await import('../dist/js/views/table/mob-attack.js');
globalThis.setInterval = realInterval2;

test('атака толпой: дальность из статблока, досягаемость по клеткам, помеха на дальней дистанции', () => {
  assert.deepEqual(attackReach({ desc: 'Melee Weapon Attack: +4 to hit, reach 5 ft., one target.' }), { melee: 5 });
  assert.deepEqual(attackReach({ desc: 'Ranged Weapon Attack: +4 to hit, range 80/320 ft., one target.' }), { range: { normal: 80, long: 320 } });
  assert.deepEqual(attackReach({ note: 'досягаемость 10 фт' }), { melee: 10 });
  assert.equal(attackReach({ name: 'Скимитар', bonus: 4 }), null, 'не указано — не гадаем');
  const scene = { grid: { size: 50, feet: 5, offsetX: 0, offsetY: 0 } };
  const at = (c, r) => ({ x: c * 50 + 25, y: r * 50 + 25, size: 'medium' });
  assert.deepEqual(inReach(scene, at(0, 0), at(1, 0), { melee: 5 }).ok, true, 'соседняя клетка — 5 фт');
  assert.deepEqual(inReach(scene, at(0, 0), at(2, 0), { melee: 5 }).ok, false);
  assert.equal(inReach(scene, at(0, 0), at(2, 0), { melee: 10 }).ok, true, 'досягаемость 10 фт');
  const far = inReach(scene, at(0, 0), at(20, 0), { range: { normal: 80, long: 320 } });
  assert.equal(far.ok && far.disadv, true, '100 фт из 80/320 — с помехой');
  assert.equal(inReach(scene, at(0, 0), at(70, 0), { range: { normal: 80, long: 320 } }).ok, false);
});

test('атака толпой: крит удваивает только кубы, 20 — крит, 1 — промах', () => {
  assert.equal(critDice('1d6+2'), '2d6+2');
  assert.equal(critDice('2к8 + 1d6 + 3'), '4d8 + 2d6 + 3');
  const seq = (vals) => { let i = 0; return () => (vals[i++ % vals.length] - 1) / 6 + 0.0001; };
  assert.deepEqual(rollDamage('1d6+2', seq([4])).total, 6);
  assert.equal(rollDamage('2d6+5', seq([1, 1])).total, 7);
  assert.equal(rollDamage('урон'), null);
  assert.equal(outcome(20, 5, 30), 'crit');
  assert.equal(outcome(1, 40, 10), 'miss');
  assert.equal(outcome(12, 16, 15), 'hit');
  assert.equal(outcome(12, 14, 15), 'miss');
  const r = rollAttacks({ attackers: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', disadv: true }], bonus: 4, damage: '1d6+2', attacks: 2, adv: null });
  assert.equal(r.length, 4, 'по 2 атаки на каждого');
  assert.equal(r.filter((x) => x.mode === 'dis').length, 2, 'дальний — с помехой');
  assert.ok(r.every((x) => x.crit.total >= x.normal.total - 6 && x.total === x.nat + 4));
});

test('атака толпой: сопротивление — на каждое попадание, концентрация — за каждое, герой на 0 — провалы', () => {
  assert.equal(adjust(5, 'resist'), 2);
  assert.equal(adjust(5, 'vuln'), 10);
  assert.equal(adjust(5, 'immune'), 0);
  const four = [5, 5, 5, 5].map((damage) => ({ damage }));
  const r = applyHits({ hp: 30, hpMax: 30, tempHp: 0, conditions: ['concentration'] }, four, 'resist', false);
  assert.equal(r.dealt, 8, '2 + 2 + 2 + 2, а не ⌊20 / 2⌋ = 10');
  assert.equal(r.state.hp, 22);
  assert.equal(r.notes.length, 4, 'проверка концентрации за каждое попадание');
  const temp = applyHits({ hp: 10, hpMax: 10, tempHp: 6, conditions: [] }, [{ damage: 4 }, { damage: 4 }], null, false);
  assert.deepEqual([temp.state.tempHp, temp.state.hp], [0, 8], 'временные хиты — первыми');
  const down = applyHits({ hp: 0, hpMax: 20, tempHp: 0, conditions: ['unconscious'], deathSaves: { s: 1, f: 0 } }, [{ damage: 3 }, { damage: 9, crit: true }, { damage: 2 }], null, true);
  assert.deepEqual(down.state.deathSaves, { s: 1, f: 3 }, '3 попадания, одно крит — 4 провала, то есть смерть');
  assert.ok(down.notes.some((n) => /погибает/.test(n)));
  const drop = applyHits({ hp: 4, hpMax: 20, tempHp: 0, conditions: ['concentration'] }, [{ damage: 6 }, { damage: 3 }], null, true);
  assert.equal(drop.state.hp, 0);
  assert.ok(drop.state.conditions.includes('unconscious') && !drop.state.conditions.includes('concentration'));
  assert.deepEqual(drop.state.deathSaves, { s: 0, f: 1 }, 'второе попадание уже по лежащему — провал');
});

test('группа призывов игрока: один владелец, один призыватель, один вид', () => {
  const wolf = (o = {}) => ({ kind: 'foe', monsterId: 'wolf', ownerId: 'u1', summonedBy: 'h1', ...o });
  assert.equal(summonKind(wolf()), summonKind(wolf({ id: 'x' })));
  assert.notEqual(summonKind(wolf()), summonKind(wolf({ summonedBy: 'h2' })), 'другой призыватель — другая группа');
  assert.notEqual(summonKind(wolf()), summonKind(wolf({ monsterId: 'bear' })));
  assert.equal(summonKind({ kind: 'foe', monsterId: 'wolf' }), null, 'существо мастера — не призыв');
  assert.equal(isSummonKind(groupKind(wolf())), true);
  assert.equal(groupKind({ kind: 'foe', monsterId: 'zombie' }), 'zombie');
});
