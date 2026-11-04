// #190 C «Дать зрение игроку»: выданные глаза существа складываются с обзором героя, ограничены дальностью и стенами,
// в темноте дальность работает как тёмное зрение; глаза закрыты у скрытого, погибшего и потерявшего сознание.
import test from 'node:test';
import assert from 'node:assert/strict';

// sight.js и fog.js берут числа токена из core/campaign.js, а тот — хранилище браузера: на время импорта без него
// (как в own-tokens.test.js), иначе процесс теста не завершится.
globalThis.self ??= {};
globalThis.window ??= { addEventListener() {}, removeEventListener() {} };
const realInterval = globalThis.setInterval;
globalThis.setInterval = () => 0;
const { grantsOf, canGiveSight, activeSight, sightRadius, sightBlocked, giveSight, takeSight, clampFt } = await import('../dist/js/views/table/sight.js');
const { computeVision, isVisible } = await import('../dist/js/views/table/fog.js');
globalThis.setInterval = realInterval;

const grid = { size: 50, feet: 5, offsetX: 0, offsetY: 0 };
const camp = { characters: [], creatures: {} };
const scene = (tokens, extra = {}) => ({ id: 's', grid, map: { width: 2000, height: 1000 }, walls: [], lights: [], tokens, lighting: 'light', fog: { mode: 'vision', ops: [] }, ...extra });
const raven = (o = {}) => ({ id: 'r', kind: 'foe', name: 'Запятая', x: 1000, y: 500, size: 'tiny', hp: 1, hpMax: 1, sight: [{ to: 'ch-lira', ft: 30 }], ...o });
const lira = { id: 'h', kind: 'hero', characterId: 'ch-lira', x: 100, y: 500, size: 'medium' };

test('выдача: мусор отброшен, глаза есть только у существ', () => {
  assert.deepEqual(grantsOf({ sight: [{ to: 'a', ft: 30 }, { to: '', ft: 5 }, { to: 'b', ft: 0 }, null, { to: 'c' }] }), [{ to: 'a', ft: 30 }]);
  assert.deepEqual(grantsOf({ sight: 'x' }), []);
  assert.equal(canGiveSight({ kind: 'foe' }), true);
  assert.equal(canGiveSight({ kind: 'custom' }), true);
  assert.equal(canGiveSight({ kind: 'hero', characterId: 'x' }), false);
  assert.equal(canGiveSight({ kind: 'item' }), false);
  assert.equal(clampFt(33), 35);
  assert.equal(clampFt(0), 5);
  assert.equal(clampFt(99999), 1000);
});

test('действуют только глаза своего героя, не отключённые, у живого и видимого существа', () => {
  const sc = scene([lira, raven(), raven({ id: 'r2', sight: [{ to: 'ch-other', ft: 60 }] })]);
  assert.deepEqual(activeSight(camp, sc, new Set(['ch-lira'])).map((g) => g.t.id), ['r']);
  assert.equal(activeSight(camp, sc, null).length, 2, 'мастер и общий обзор — все');
  assert.equal(activeSight(camp, sc, new Set(['ch-lira']), new Set(['r'])).length, 0, 'игрок отключил у себя');
  for (const [o, why] of [[{ hidden: true }, 'hidden'], [{ hp: 0 }, 'dead'], [{ conditions: ['unconscious'] }, 'down']]) {
    const t = raven(o);
    assert.equal(sightBlocked(camp, t), why);
    assert.equal(activeSight(camp, scene([t]), null).length, 0, why);
  }
  assert.equal(sightBlocked(camp, raven({ hp: 0, hpMax: 0 })), null, 'без хитов на токене — не «погиб»');
  const two = raven({ sight: [{ to: 'ch-lira', ft: 30 }, { to: 'ch-mira', ft: 120 }] });
  assert.equal(activeSight(camp, scene([two]), null)[0].ft, 120, 'на одно существо — наибольшая дальность');
});

test('радиус — от края существа, как у аур: клетка среднего + 30 фт; большое — шире', () => {
  const sc = scene([]);
  assert.equal(sightRadius(sc, { size: 'medium' }, 30), 325);
  assert.equal(sightRadius(sc, { size: 'tiny' }, 30), 325, 'крошечное занимает клетку, как и в аурах');
  assert.equal(sightRadius(sc, { size: 'large' }, 30), 350);
});

test('обзор складывается: своё + круг глаз; стена и дальность ограничивают; в темноте дальность видна', () => {
  const sc = scene([lira, raven()], { walls: [{ a: { x: 600, y: 0 }, b: { x: 600, y: 1000 }, kind: 'wall' }] });
  const eyes = activeSight(camp, sc, new Set(['ch-lira'])).map((g) => ({ t: g.t, r: sightRadius(sc, g.t, g.ft) }));
  const own = computeVision(camp, sc, [lira]);
  const both = computeVision(camp, sc, [lira], {}, eyes);
  const near = { x: 1200, y: 500 }, far = { x: 1600, y: 500 }, mine = { x: 300, y: 500 };
  assert.equal(isVisible(own, near, sc), false, 'за стеной своими глазами не видно');
  assert.equal(isVisible(both, near, sc), true, 'глазами ворона — видно');
  assert.equal(isVisible(both, far, sc), false, 'дальше 30 фт — не видно');
  assert.equal(isVisible(both, mine, sc), true, 'своё зрение осталось');
  const wall2 = scene([lira, raven()], { walls: [{ a: { x: 1100, y: 0 }, b: { x: 1100, y: 1000 }, kind: 'wall' }] });
  const eyes2 = activeSight(camp, wall2, null).map((g) => ({ t: g.t, r: sightRadius(wall2, g.t, g.ft) }));
  assert.equal(isVisible(computeVision(camp, wall2, [], {}, eyes2), { x: 1200, y: 500 }, wall2), false, 'стена перекрывает и глаза ворона');
  const dark = scene([lira, raven()], { lighting: 'dark' });
  const eyes3 = activeSight(camp, dark, null).map((g) => ({ t: g.t, r: sightRadius(dark, g.t, g.ft) }));
  const vd = computeVision(camp, dark, [lira], {}, eyes3);
  assert.equal(isVisible(vd, { x: 1150, y: 500 }, dark), true, 'в темноте видно в пределах дальности');
  assert.equal(isVisible(vd, { x: 1500, y: 500 }, dark), false);
});

test('дать и забрать — с отменой, меняется только поле sight', () => {
  const sc = scene([raven({ sight: undefined })]);
  const hist = [];
  const ctx = { scene: sc, mutateScene: (fn, u) => { fn(sc); hist.push(u); } };
  assert.equal(giveSight(ctx, 'r', 'ch-lira', 32), true);
  assert.deepEqual(sc.tokens[0].sight, [{ to: 'ch-lira', ft: 30 }]);
  giveSight(ctx, 'r', 'ch-lira', 60);
  giveSight(ctx, 'r', 'ch-mira', 15);
  assert.deepEqual(sc.tokens[0].sight, [{ to: 'ch-lira', ft: 60 }, { to: 'ch-mira', ft: 15 }], 'повторная выдача тому же герою меняет дальность');
  sc.tokens[0].x = 1234; // токен подвинули после выдачи
  takeSight(ctx, 'r', 'ch-lira');
  assert.deepEqual(sc.tokens[0].sight, [{ to: 'ch-mira', ft: 15 }]);
  takeSight(ctx, 'r');
  assert.equal('sight' in sc.tokens[0], false, 'пустой список не хранится');
  hist.at(-1).undo(sc);
  assert.deepEqual(sc.tokens[0].sight, [{ to: 'ch-mira', ft: 15 }]);
  assert.equal(sc.tokens[0].x, 1234, 'отмена не трогает место');
  assert.equal(giveSight(ctx, 'нет', 'ch-lira', 30), false);
});
