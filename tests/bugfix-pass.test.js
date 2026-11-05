// Проход по найденным ошибкам (#203/#204, 04.11.2026): ход после удаления того, кто ходит; атаки «+0»; крит по
// беспомощной цели; «дальность» в русском статблоке; серверная раскладка — «Скрыть всё», время приглашения.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.self ??= {};
globalThis.window ??= { addEventListener() {}, removeEventListener() {} };
const realInterval = globalThis.setInterval;
globalThis.setInterval = () => 0;
const { keepTurnWith, initiativeOrder, currentEntry } = await import('../dist/js/views/table/combat.js');
const { isAttackAction, autoCrit, attackReach } = await import('../dist/js/views/table/mob-attack.js');
globalThis.setInterval = realInterval;
const { explode, assemble, diffRows, applyOps } = await import('../dist/js/server/model.js');
const { seedDB } = await import('../dist/js/data/demo.js');

const mk = () => {
  const foe = (id, init, o = {}) => ({ id, kind: 'foe', name: id, hp: 7, hpMax: 7, initBonus: 0, x: 0, y: 0, ...o });
  const scene = { id: 's', tokens: [{ id: 'h', kind: 'hero', name: 'Лира', x: 0, y: 0, initBonus: 3 }, foe('a'), foe('b'), foe('c')] };
  const c = { characters: [], creatures: {}, log: [], combat: { active: true, sceneId: 's', round: 2, turn: 0, moved: { a: 30 }, entries: [
    { tokenId: 'h', init: 18 }, { tokenId: 'a', init: 14 }, { tokenId: 'b', init: 10 }, { tokenId: 'c', init: 5 },
  ] } };
  return { c, scene };
};

test('убрали того, кто ходит: ход у следующего, свежее движение', () => {
  const { c, scene } = mk();
  c.combat.turn = 1; // ходит a
  keepTurnWith(c, scene, (cc, sc) => { sc.tokens = sc.tokens.filter((t) => t.id !== 'a'); cc.combat.entries = cc.combat.entries.filter((e) => e.tokenId !== 'a'); });
  assert.equal(currentEntry(c, scene).tokenId, 'b');
  assert.equal(c.combat.round, 2);
  assert.equal(c.combat.moved.b, 0);
});

test('убрали последнего в круге, когда он ходил: новый раунд с начала очереди', () => {
  const { c, scene } = mk();
  c.combat.turn = 3; // ходит c
  keepTurnWith(c, scene, (cc) => { cc.combat.entries = cc.combat.entries.filter((e) => e.tokenId !== 'c'); });
  assert.equal(currentEntry(c, scene).tokenId, 'h');
  assert.equal(c.combat.round, 3);
});

test('убрали другого — ход остаётся за тем же, номер хода сдвигается', () => {
  const { c, scene } = mk();
  c.combat.turn = 2; // ходит b
  keepTurnWith(c, scene, (cc) => { cc.combat.entries = cc.combat.entries.filter((e) => e.tokenId !== 'a'); });
  assert.equal(currentEntry(c, scene).tokenId, 'b');
  assert.equal(c.combat.turn, 1);
  assert.equal(c.combat.round, 2);
});

test('поздний бросок инициативы не меняет, чей ход', () => {
  const { c, scene } = mk();
  c.combat.turn = 2; // ходит b (init 10)
  c.combat.entries.push({ tokenId: 'h2', init: null });
  scene.tokens.push({ id: 'h2', kind: 'hero', name: 'Бран', x: 0, y: 0, initBonus: 1 });
  keepTurnWith(c, scene, (cc) => { cc.combat.entries.find((e) => e.tokenId === 'h2').init = 20; });
  assert.equal(currentEntry(c, scene).tokenId, 'b');
  assert.equal(initiativeOrder(c, scene)[c.combat.turn].tokenId, 'b');
});

test('атака «+0» (крыса, кошка) — атака; дыхание и мультиатака с бонусом 0 — нет', () => {
  assert.equal(isAttackAction({ name: 'Укус', bonus: 0, damage: '1', desc: 'Melee Weapon Attack: +0 to hit, reach 5 ft., one target.' }), true);
  assert.equal(isAttackAction({ name: 'Огненное дыхание', bonus: 0, damage: '6d6', desc: 'The hound exhales fire in a 15-foot cone.' }), false);
  assert.equal(isAttackAction({ name: 'Мультиатака', bonus: 0, damage: '', desc: 'makes three attacks' }), false);
  assert.equal(isAttackAction({ name: 'Скимитар', bonus: 4, damage: '1d6+2' }), true);
  assert.equal(isAttackAction({ name: 'Свой удар', attack: { bonus: 0 }, damage: '1d4' }), true);
});

test('беспомощная цель: попадание с 5 фт — крит, издалека — нет', () => {
  assert.equal(autoCrit(['unconscious'], 5), true);
  assert.equal(autoCrit(['paralyzed', 'prone'], 0), true);
  assert.equal(autoCrit(['paralyzed'], 10), false);
  assert.equal(autoCrit(['prone'], 5), false);
  assert.equal(autoCrit([], 5), false);
});

test('дальность из русского описания: «дальность 80/320 фт» и «дистанция 20/60 фт»', () => {
  assert.deepEqual(attackReach({ ru: '', note: 'дальность 80/320 фт' }), { range: { normal: 80, long: 320 } });
  assert.deepEqual(attackReach({ desc: '', note: 'досягаемость 5 фт. или дистанция 20/60 фт' }), { melee: 5, range: { normal: 20, long: 60 } });
});

test('сервер: «Скрыть всё» у мастера перезаписывает исследованные клетки, игрок только добавляет', () => {
  const db = seedDB();
  const c = Object.values(db.campaigns)[0];
  const sc = c.scenes[0];
  sc.fog = { ...(sc.fog || {}), explored: ['1:1', '1:2', '2:2'] };
  const a = explode(c);
  const c2 = structuredClone(c);
  c2.scenes[0].fog.explored = [];
  const ops = diffRows(a, explode(c2, a), { isMaster: true });
  const ex = ops.filter((o) => o.table === 'scene_explored');
  assert.equal(ex.length, 1);
  assert.equal(ex[0].op, 'replace');
  assert.deepEqual(ex[0].row.cells, []);
  const rows = applyOps(structuredClone(a), ops);
  assert.deepEqual(rows.explored.get(sc.id).cells, []);
  const asPlayer = diffRows(a, explode(c2, a), { isMaster: false }).filter((o) => o.table === 'scene_explored');
  assert.equal(asPlayer.length, 0);
  const c3 = structuredClone(c); c3.scenes[0].fog.explored = ['1:1', '1:2', '2:2', '3:3'];
  const add = diffRows(a, explode(c3, a), { isMaster: true }).filter((o) => o.table === 'scene_explored');
  assert.deepEqual(add.map((o) => [o.op, o.row.p_cells]), [['rpc', ['3:3']]]);
});

test('сервер: новый срок приглашения обновляет created_at, неизменённый — нет лишней правки', () => {
  const db = seedDB();
  const c = Object.values(db.campaigns)[0];
  const a = explode(c);
  const back = assemble(a);
  assert.equal(diffRows(a, explode(back, a), { isMaster: true }).filter((o) => o.table === 'campaign_invites').length, 0, 'туда-обратно — без правки');
  const c2 = structuredClone(back);
  c2.invite.createdAt = (c2.invite.createdAt || 0) + 86400000 * 3;
  const op = diffRows(a, explode(c2, a), { isMaster: true }).find((o) => o.table === 'campaign_invites');
  assert.ok(op, 'правка приглашения уходит');
  assert.equal(Date.parse(op.row.created_at), c2.invite.createdAt);
});
