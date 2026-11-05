// TASK-183 (план TASK-097, п. 2.1, 3.1–3.3): права на свой токен и призыв игрока в песочнице и интерфейсе.
import test from 'node:test';
import assert from 'node:assert/strict';

// core/campaign.js тянет хранилище браузера (таймеры присутствия вкладок): на время импорта — без них,
// иначе процесс теста не завершится.
globalThis.self ??= {};
globalThis.window ??= { addEventListener() {}, removeEventListener() {} };
const realInterval = globalThis.setInterval;
globalThis.setInterval = () => 0;
const { ownsToken, canControlToken, canFight, tokenStats } = await import('../dist/js/core/campaign.js');
globalThis.setInterval = realInterval;

const camp = (open = false) => ({
  ownerId: 'gm',
  settings: { openMovement: open },
  members: [
    { userId: 'gm', role: 'master', status: 'active' },
    { userId: 'asya', role: 'player', status: 'active', characterId: 'ch-lira' },
    { userId: 'timur', role: 'player', status: 'active', characterId: 'ch-torin' },
    { userId: 'gone', role: 'player', status: 'left' },
  ],
});
const owl = { id: 't-owl', kind: 'custom', ownerId: 'asya', name: 'Сова', size: 'tiny' };
const horse = { id: 't-horse', kind: 'foe', monsterId: 'warhorse', ownerId: 'timur', summonedBy: 't-torin', hp: 19, hpMax: 19, ac: 11 };

test('свой токен: владелец управляет и правит, другой игрок — нет', () => {
  const c = camp();
  assert.equal(ownsToken(c, 'asya', owl), true);
  assert.equal(canControlToken(c, 'asya', owl), true);
  assert.equal(ownsToken(c, 'timur', owl), false);
  assert.equal(canControlToken(c, 'timur', owl), false, 'при закрытом перемещении чужую сову не двигают');
  assert.equal(canControlToken(camp(true), 'timur', owl), true, 'при открытом — только двигать');
  assert.equal(ownsToken(camp(true), 'timur', owl), false, 'править статы открытое перемещение не даёт');
});

test('вышедший игрок своим токеном больше не управляет (И4); мастер — любым', () => {
  const c = camp();
  const left = { ...owl, ownerId: 'gone' };
  assert.equal(ownsToken(c, 'gone', left), false);
  assert.equal(canControlToken(c, 'gone', left), false);
  assert.equal(canControlToken(c, 'gm', left), true);
  assert.equal(ownsToken(c, 'gm', left), false, 'мастер управляет как мастер, а не как владелец');
});

test('в бой: предмет — нет, свой токен без хитов — нет, со статами и призыв — да', () => {
  assert.equal(canFight({ kind: 'item' }), false);
  assert.equal(canFight(owl), false);
  assert.equal(canFight({ ...owl, hp: 1, hpMax: 1, ac: 11 }), true);
  assert.equal(canFight(horse), true);
  assert.equal(canFight({ kind: 'hero', characterId: 'x' }), true);
  assert.equal(canFight(null), false);
});

test('подпись статблока без типа и КО — «Существо», без «КО null»', () => {
  const c = { creatures: { 'cc-1': { id: 'cc-1', name: 'Дух-волк', source: 'manual', ac: 13, hp: 11, stats: {}, speed: { walk: 30 } } } };
  const st = tokenStats(c, { kind: 'foe', monsterId: 'lib:cc-1', name: 'Дух-волк 1', hp: 11, hpMax: 11 });
  assert.ok(!/null|undefined/.test(st.subtitle), st.subtitle);
});
