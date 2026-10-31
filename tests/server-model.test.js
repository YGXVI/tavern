// Серверный режим (TASK-002): строки таблиц ↔ кампания и сравнение «до/после».
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedDB } from '../dist/js/data/demo.js';
import { explode, assemble, diffRows, applyOps, applyChange, emptyRows, tokenPatch, isTokenMove, groupTokenMoves } from '../dist/js/server/model.js';

const clone = (x) => structuredClone(x);
const demo = () => clone(seedDB().campaigns['c-crypt']);
// Нормализация для сравнения: ключи по алфавиту, undefined выброшены.
const norm = (x) => JSON.parse(JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v)));

test('разложить и собрать — та же кампания', () => {
  const c = demo();
  const back = assemble(explode(c));
  // Порядок сцен, токенов и рисунков сохраняется; метки: сначала открытые, потом тайные — сравниваем по id.
  assert.equal(back.scenes.length, c.scenes.length);
  for (let i = 0; i < c.scenes.length; i++) {
    const a = c.scenes[i], b = back.scenes[i];
    assert.deepEqual(b.tokens.map((t) => t.id), a.tokens.map((t) => t.id));
    assert.deepEqual(norm(b.tokens), norm(a.tokens));
    assert.deepEqual(norm(b.walls), norm(a.walls));
    assert.deepEqual(new Set(b.pins.map((p) => p.id)), new Set(a.pins.map((p) => p.id)));
    assert.deepEqual(norm(b.traps), norm(a.traps));
    assert.deepEqual(b.fog.explored, a.fog.explored);
  }
  assert.deepEqual(norm(back.characters.map((x) => x.id).sort()), norm(c.characters.map((x) => x.id).sort()));
  assert.deepEqual(norm(back.settings), norm(c.settings));
  assert.equal(back.name, c.name);
});

test('ловушки и тайные метки — в отдельной строке, не в сцене', () => {
  const c = demo();
  c.scenes[0].pins = [{ id: 'p1', kind: 'secret', title: 'Ключ у жреца', shown: true }, { id: 'p2', kind: 'read-aloud', title: 'Алтарь', shown: true }, { id: 'p3', kind: 'read-aloud', title: 'Позже', shown: false }];
  const rows = explode(c);
  const sid = c.scenes[0].id;
  assert.deepEqual(rows.scenes.get(sid).data.pins.map((p) => p.id), ['p2']);
  assert.deepEqual(rows.secrets.get(sid).data.pins.map((p) => p.id), ['p1', 'p3']);
  assert.equal(rows.scenes.get(sid).data.traps, undefined);
  assert.ok(rows.secrets.get(sid).data.traps.length > 0);
});

test('перемещение токена — одно изменение токена', () => {
  const before = demo(), after = clone(before);
  const t = after.scenes[0].tokens[0]; t.x += 74; t.movedAt = 5;
  const a = explode(before), ops = diffRows(a, explode(after, a), { isMaster: false });
  assert.equal(ops.length, 1);
  assert.equal(ops[0].table, 'tokens'); assert.equal(ops[0].op, 'update'); assert.equal(ops[0].key, t.id);
  assert.equal(ops[0].row.data.x, t.x);
  assert.equal(ops[0].row.ord, a.tokens.get(t.id).ord, 'ord берётся из прежних строк');
});

test('скрытый бросок: подпись и сумма — только в log_secrets', () => {
  const before = demo(), after = clone(before);
  after.log.unshift({ id: 'r-x', at: 10, userId: 'u-sol', kind: 'roll', label: 'Огр: атака', total: 19, detail: '1d20+6', hidden: true, vis: 'gm', nat: 13 });
  const a = explode(before), ops = diffRows(a, explode(after, a), { isMaster: true });
  const pub = ops.find((o) => o.table === 'log_entries'), sec = ops.find((o) => o.table === 'log_secrets');
  assert.ok(pub && sec);
  assert.equal(pub.row.vis, 'gm');
  assert.equal(pub.row.data.total, undefined); assert.equal(pub.row.data.label, undefined); assert.equal(pub.row.data.nat, undefined);
  assert.equal(sec.row.data.total, 19); assert.equal(sec.row.data.label, 'Огр: атака');
  // Игрок без тайной части видит факт броска.
  const rows = applyOps(explode(before), ops); rows.logSecrets.delete('r-x');
  const seen = assemble(rows).log.find((e) => e.id === 'r-x');
  assert.equal(seen.total, undefined); assert.equal(seen.hidden, true); assert.equal(seen.redacted, true); assert.equal(seen.userId, 'u-sol');
});

test('игрок не отправляет правку кампании и удаление старых записей журнала', () => {
  const before = demo(), after = clone(before);
  after.doorAttempt = { wallId: 'w1', total: 12 };
  after.log = after.log.slice(0, 1);
  after.name = 'Другое';
  const a = explode(before);
  assert.deepEqual(diffRows(a, explode(after, a), { isMaster: false }), []);
  const m = diffRows(a, explode(after, a), { isMaster: true });
  assert.deepEqual(m.map((o) => o.table), ['campaigns'], 'doorAttempt не сохраняется, журнал не удаляется');
});

test('исследованные клетки — только новые, функцией', () => {
  const before = demo(), after = clone(before);
  const s = after.scenes[0]; s.fog.explored = [...s.fog.explored, '99,99', '98,99'];
  const a = explode(before), ops = diffRows(a, explode(after, a));
  assert.equal(ops.length, 1); assert.equal(ops[0].op, 'rpc'); assert.deepEqual(ops[0].row.p_cells, ['99,99', '98,99']);
});

test('новая сцена с токеном: сцена раньше токена, удаление — токен раньше сцены', () => {
  const before = demo(), after = clone(before);
  after.scenes.push({ ...clone(before.scenes[0]), id: 's-new', tokens: [{ ...clone(before.scenes[0].tokens[0]), id: 't-new' }], drawings: [] });
  const a = explode(before), b = explode(after, a);
  const ins = diffRows(a, b, { isMaster: true }).map((o) => `${o.op}:${o.table}`);
  assert.ok(ins.indexOf('insert:scenes') < ins.indexOf('insert:tokens'));
  const del = diffRows(b, a, { isMaster: true }).map((o) => `${o.op}:${o.table}`);
  assert.ok(del.indexOf('delete:tokens') < del.indexOf('delete:scenes'));
});

test('событие реального времени обновляет кэш', () => {
  const c = demo(), rows = explode(c);
  const t = c.scenes[0].tokens[0];
  applyChange(rows, 'tokens', 'UPDATE', { ...rows.tokens.get(t.id), data: { ...rows.tokens.get(t.id).data, x: 1 } });
  assert.equal(assemble(rows).scenes[0].tokens.find((x) => x.id === t.id).x, 1);
  applyChange(rows, 'tokens', 'DELETE', { id: t.id });
  assert.equal(assemble(rows).scenes[0].tokens.some((x) => x.id === t.id), false);
  assert.equal(assemble(emptyRows()), null);
});

test('собранная кампания не делит объекты с кэшем строк', () => {
  const rows = explode(demo());
  const c = assemble(rows);
  const sid = c.scenes[0].id;
  c.combat.entries.push({ tokenId: 'x', init: 5 });
  c.scenes[0].tokens[0].conditions.push('prone');
  c.scenes[0].walls.push({ id: 'w-new' });
  assert.equal(rows.combat.data.entries.length, 0);
  const t0 = c.scenes[0].tokens[0].id;
  assert.ok(!rows.tokens.get(t0).data.conditions.includes('prone'));
  assert.ok(!rows.scenes.get(sid).data.walls.some((w) => w.id === 'w-new'));
});

test('кэш после applyOps не меняется от дальнейших правок кампании', () => {
  const c = demo();
  const rows = explode(c);
  const after = clone(c);
  after.scenes[0].tokens[0].x += 10;
  const b = explode(after, rows);
  const ops = diffRows(rows, b, { isMaster: true });
  applyOps(rows, ops);
  b.tokens.get(after.scenes[0].tokens[0].id).data.x = 9999; // живая строка операции меняется позже
  assert.equal(rows.tokens.get(after.scenes[0].tokens[0].id).data.x, after.scenes[0].tokens[0].x);
});

test('приглашение без даты создания не шлёт created_at: null', () => {
  const c = demo();
  delete c.invite.createdAt;
  const rows = explode(c);
  assert.ok(!('created_at' in rows.invite));
  const m = { ...c.members[0] }; delete m.joinedAt; c.members[0] = m;
  assert.ok(!('joined_at' in explode(c).members.get(m.userId)));
});

test('TASK-123: владелец своего токена — колонка owner_id, туда и обратно', () => {
  const c = demo(), s = c.scenes[0];
  s.tokens.push({ id: 't-owl', kind: 'custom', ownerId: 'u-ася', name: 'Сова', x: 10, y: 10, hidden: false });
  const rows = explode(c);
  const row = rows.tokens.get('t-owl');
  assert.equal(row.owner_id, 'u-ася');
  assert.equal('ownerId' in row.data, false, 'владелец не дублируется в data');
  const back = assemble(rows).scenes[0].tokens.find((t) => t.id === 't-owl');
  assert.equal(back.ownerId, 'u-ася');
});

test('TASK-123: токен без владельца отправляется без owner_id, снятый владелец — null', () => {
  const before = demo();
  const plain = before.scenes[0].tokens[0];
  assert.equal('owner_id' in explode(before).tokens.get(plain.id), false);
  before.scenes[0].tokens.push({ id: 't-owl', kind: 'custom', ownerId: 'u-ася', name: 'Сова', x: 10, y: 10, hidden: false });
  const a = explode(before);
  const after = clone(before);
  delete after.scenes[0].tokens.find((t) => t.id === 't-owl').ownerId;
  const ops = diffRows(a, explode(after, a), { isMaster: true });
  assert.equal(ops.length, 1);
  assert.equal(ops[0].row.owner_id, null);
  assert.ok('owner_id' in ops[0].row);
});

test('TASK-123 (review #126): строки SELECT после миграции с owner_id: null — без лишних UPDATE', () => {
  // После миграции сервер отдаёт owner_id: null у каждого токена (колонка — последняя, как в SELECT *).
  const rows = explode(demo());
  for (const [id, t] of rows.tokens) rows.tokens.set(id, { ...t, owner_id: t.owner_id ?? null });
  assert.equal(diffRows(rows, explode(assemble(rows), rows), { isMaster: true }).length, 0, 'без изменений — ни одной операции');
  // Изменился один токен — одна операция, и колонка owner_id в ней осталась null.
  const c = assemble(rows);
  c.scenes[0].tokens[0].x += 5;
  const ops = diffRows(rows, explode(c, rows), { isMaster: true });
  assert.equal(ops.length, 1);
  assert.equal(ops[0].row.owner_id, null);
  // Свой токен со строки сервера — туда и обратно без операций.
  const own = rows.tokens.get(c.scenes[0].tokens[1].id);
  rows.tokens.set(own.id, { ...own, owner_id: 'u-ася' });
  assert.equal(diffRows(rows, explode(assemble(rows), rows), { isMaster: true }).length, 0);
});

// ——— TASK-173 (TASK-097 п. 2.5): токены частичной правкой ———
const tok = (id, data, extra = {}) => ({ id, campaign_id: 'c', scene_id: 's1', character_id: null, hidden: false, ord: 1, data, ...extra });
const upd = (prev, row) => ({ table: 'tokens', op: 'update', key: row.id, row, prev });

test('tokenPatch: только изменённые поля data и колонки', () => {
  const a = tok('t1', { x: 0, y: 0, hp: 10, hpMax: 10 });
  assert.deepEqual(tokenPatch(a, tok('t1', { x: 20, y: 0, hp: 10, hpMax: 10 })), { cols: {}, set: { x: 20 }, unset: [] });
  assert.deepEqual(tokenPatch(a, tok('t1', { x: 0, y: 0, hp: 7 })), { cols: {}, set: { hp: 7 }, unset: ['hpMax'] });
  assert.deepEqual(tokenPatch(a, tok('t1', { x: 0, y: 0, hp: 10, hpMax: 10 }, { hidden: true })).cols, { hidden: true });
  // Колонка owner_id приходит только после миграции: её нет в обеих строках — не изменение.
  assert.deepEqual(tokenPatch(a, tok('t1', { x: 0, y: 0, hp: 10, hpMax: 10 })).cols, {});
  assert.deepEqual(tokenPatch(tok('t1', {}, { owner_id: null }), tok('t1', {}, { owner_id: 'u1' })).cols, { owner_id: 'u1' });
  // Вложенные значения сравниваются целиком.
  assert.deepEqual(tokenPatch(tok('t1', { conds: ['prone'] }), tok('t1', { conds: ['prone', 'blinded'] })).set, { conds: ['prone', 'blinded'] });
});

test('isTokenMove: только место и поворот', () => {
  const a = tok('t1', { x: 0, y: 0, hp: 10 });
  assert.equal(isTokenMove(upd(a, tok('t1', { x: 5, y: 7, hp: 10, movedAt: 1 }))), true);
  assert.equal(isTokenMove(upd(a, tok('t1', { x: 5, y: 0, hp: 9 }))), false);
  assert.equal(isTokenMove(upd(a, tok('t1', { x: 5, y: 0, hp: 10 }, { hidden: true }))), false);
  assert.equal(isTokenMove(upd(a, tok('t1', { x: 0, y: 0 }))), false); // убрали поле
  assert.equal(isTokenMove({ table: 'tokens', op: 'insert', key: 't1', row: a }), false);
});

test('groupTokenMoves: несколько перемещений сцены — один move_tokens, порядок остальных сохранён', () => {
  const a1 = tok('t1', { x: 0, y: 0 }), a2 = tok('t2', { x: 0, y: 0 }), a3 = tok('t3', { x: 0, y: 0 }, { scene_id: 's2' });
  const log = { table: 'log_entries', op: 'insert', key: 'l1', row: { id: 'l1' } };
  const ops = [upd(a1, tok('t1', { x: 70, y: 0, movedAt: 9 })), upd(a2, tok('t2', { x: 70, y: 70, movedAt: 9 })), upd(a3, tok('t3', { x: 1, y: 1 }, { scene_id: 's2' })), log];
  const out = groupTokenMoves(ops);
  assert.equal(out.length, 3);
  assert.equal(out[0].op, 'move');
  assert.equal(out[0].scene, 's1');
  assert.deepEqual(out[0].moves, [{ id: 't1', x: 70, movedAt: 9 }, { id: 't2', x: 70, y: 70, movedAt: 9 }]);
  assert.deepEqual(out[0].parts.map((o) => o.key), ['t1', 't2']);
  // Один токен на сцене — обычная частичная правка.
  assert.equal(out[1].op, 'update'); assert.equal(out[1].key, 't3');
  assert.equal(out[2], log);
  // Правка хитов не попадает в группу.
  const mixed = groupTokenMoves([upd(a1, tok('t1', { x: 70, y: 0 })), upd(a2, tok('t2', { x: 0, y: 0, hp: 3 }))]);
  assert.deepEqual(mixed.map((o) => o.op), ['update', 'update']);
});

test('groupTokenMoves: не больше 50 токенов в одном вызове', () => {
  const ops = Array.from({ length: 120 }, (_, i) => upd(tok(`t${i}`, { x: 0, y: 0 }), tok(`t${i}`, { x: 70, y: 0 })));
  const out = groupTokenMoves(ops);
  assert.deepEqual(out.map((o) => o.moves.length), [50, 50, 20]);
});

test('правка токена в мастерском diffRows даёт prev — частичная правка возможна', () => {
  const c = demo();
  const a = explode(c);
  const c2 = clone(c); c2.scenes[0].tokens[0].x += 70;
  const ops = diffRows(a, explode(c2, a), { isMaster: true }).filter((o) => o.table === 'tokens');
  assert.equal(ops.length, 1); assert.ok(ops[0].prev);
  assert.deepEqual(tokenPatch(ops[0].prev, ops[0].row), { cols: {}, set: { x: c.scenes[0].tokens[0].x + 70 }, unset: [] });
});
