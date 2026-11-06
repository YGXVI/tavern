// TASK-179 (TASK-097 п. 4.3): статблок токена своего существа — из копии в кампании.
import test from 'node:test';
import assert from 'node:assert/strict';

// core/campaign.js тянет хранилище браузера (присутствие вкладок по таймерам): на время импорта — без
// BroadcastChannel, окна и таймеров, иначе процесс теста не завершится.
globalThis.self ??= {};
globalThis.window ??= { addEventListener() {}, removeEventListener() {} };
const realInterval = globalThis.setInterval;
globalThis.setInterval = () => 0;
const { monsterOf } = await import('../dist/js/core/campaign.js');
globalThis.setInterval = realInterval;

const copy = { id: 'cc-1', ownerId: null, sourceId: 'tpl-1', name: 'Каменный страж', source: 'manual', size: 'large', type: 'конструкт', ac: 17, hp: 60, hpFormula: '8к10+16',
  speed: { walk: 30, fly: null, swim: null, climb: null, burrow: null }, stats: { str: 18, dex: 8, con: 15, int: 3, wis: 10, cha: 1 }, saves: [{ ability: 'con', bonus: 5 }], skills: [],
  traits: [], actions: [{ name: 'Кулак', text: '', attack: { bonus: 6, reach: 5 }, damage: [{ dice: '2к8+4', type: 'дробящий' }] }], bonusActions: [], reactions: [], legendary: { count: null, actions: [] } };

test('monsterOf: «lib:» — статблок из копии в кампании', () => {
  const c = { creatures: { 'cc-1': copy } };
  const m = monsterOf(c, 'lib:cc-1');
  assert.equal(m.id, 'lib:cc-1'); assert.equal(m.ac, 17); assert.equal(m.speed, 30); assert.equal(m.init, -1);
  assert.equal(m.actions[0].bonus, 6); assert.equal(m.actions[0].damage, '2к8+4'); assert.equal(m.saves.con, 5);
  assert.equal(monsterOf(c, 'lib:cc-1'), m, 'тот же объект из кэша');
});

test('monsterOf: нет копии — null (игрок не видит копию мастера); остальное — из бестиария', () => {
  assert.equal(monsterOf({ creatures: { 'cc-1': copy } }, 'lib:нет'), null);
  assert.equal(monsterOf({}, 'lib:cc-1'), null);
  assert.equal(monsterOf({}, 'faceless-spawn')?.id, 'faceless-spawn');
  assert.equal(monsterOf({}, null), null);
});
