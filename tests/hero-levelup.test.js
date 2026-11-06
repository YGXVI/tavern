// Окно повышения уровня на настоящих правилах (#202): план, выборы окна и тело level_up_character.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indexCreation } from '../dist/js/views/hero/creation.js';
import { newLevelUp, levelUpModel, applyLevelUpChoice, levelUpRequest } from '../dist/js/views/hero/levelup-model.js';
import { toHeroView } from '../dist/js/views/hero/adapter.js';
import { makeLevelUpRequest } from '../dist/js/server/character-sheet.js';
import { LEVEL_UP } from '../dist/js/views/hero/fixture.js';
import { seedDB } from '../dist/js/data/demo.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const ix = indexCreation({ options: read('dist/js/data/character-options-2014.json'), spells: read('dist/js/data/spells-2014.json'),
  equipment: read('dist/js/data/equipment-2014.json'), features: read('dist/js/data/features-2014.json') }, read('dist/js/data/spells-ref-2014.json'));
const fx = read('supabase/tests/character_create_fixtures.json');
const hero = (name) => ({ ...structuredClone(fx.find((f) => f.name === name).data), id: name, ownerId: 'u1' });
const uuid = () => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; };
const view = (h) => ({ ...toHeroView(h, { userId: 'u1' }), id: `c1~${h.id}` });

test('воин 1 → 2: без выборов, +8 хитов, форма как у образца, тело принимает клиент команды', () => {
  const h = hero('fighter1');
  const st = newLevelUp(ix, h, { key: 'c1~fighter1', campaignId: 'c1' });
  const m = levelUpModel(ix, st, h, view(h));
  for (const k of ['from', 'to', 'steps', 'hp', 'news', 'spells', 'live', 'done']) assert.ok(k in m, k);
  assert.deepEqual(m.steps, LEVEL_UP.steps);
  assert.equal(m.status, 'valid');
  assert.equal(m.from, 1); assert.equal(m.to, 2);
  assert.equal(m.hp.after.value, h.hpMax + 8);
  assert.match(m.news.feature.name, /./);
  const req = levelUpRequest(ix, st, h, { newId: uuid() });
  const again = levelUpRequest(ix, st, h, { newId: uuid() });
  assert.deepEqual(again, req, 'повтор — тот же запрос');
  assert.equal(req.payload.patch.level, 2);
  makeLevelUpRequest({ campaignId: 'c1', characterId: '10000000-0000-4000-8000-000000000001', version: '0', operationId: req.operationId, payload: req.payload });
});

test('чародей 3 → 4: улучшение характеристик и заклинания — выборами окна', () => {
  const h = hero('sorcerer3-draconic');
  const st = newLevelUp(ix, h, { key: 'c1~s', campaignId: 'c1' });
  let m = levelUpModel(ix, st, h, view(h));
  assert.notEqual(m.status, 'valid');
  const asi = m.news.extra.find((b) => /Улучшение/.test(b.title));
  assert.ok(asi, 'есть выбор улучшения характеристик');
  applyLevelUpChoice(ix, st, h, { extra: `${asi.choiceId}|asi2:cha` });
  assert.ok(m.spells.lists.length >= 2);
  applyLevelUpChoice(ix, st, h, { auto: true });
  m = levelUpModel(ix, st, h, view(h));
  assert.equal(m.status, 'valid', JSON.stringify(m.missing));
  assert.ok(m.done.changes.some((c) => /Харизма \+2/.test(c)));
  const req = levelUpRequest(ix, st, h, { newId: uuid() });
  assert.equal(req.payload.patch.stats.cha, h.stats.cha + 2);
  assert.ok(req.payload.patch.knownSpells.length > h.knownSpells.length);
});

test('старый герой песочницы: простое повышение — уровень и кость хитов, выборы вручную', () => {
  const lira = structuredClone(seedDB().campaigns['c-crypt'].characters.find((c) => c.id === 'ch-lira'));
  const st = newLevelUp(ix, lira, { key: 'c-crypt~ch-lira', campaignId: 'c-crypt' });
  const m = levelUpModel(ix, st, lira, { ...toHeroView(lira, { userId: lira.ownerId }), id: 'c-crypt~ch-lira' });
  assert.equal(m.simple, true);
  assert.equal(m.to, lira.level + 1);
  assert.match(m.news.feature.text, /вручную/);
  const req = levelUpRequest(ix, st, lira, { newId: uuid() });
  assert.equal(req.payload.patch.level, lira.level + 1);
});
