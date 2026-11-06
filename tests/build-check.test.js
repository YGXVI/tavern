// P4b (#202): сервер пересчитывает сборку сам и не верит присланному листу.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkCreate, checkLevelUp } from '../dist/js/rules/build-check.js';
import { levelUpPlan, levelUpPayload } from '../dist/js/rules/level-up.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const cats = { options: read('dist/js/data/character-options-2014.json'), spells: read('dist/js/data/spells-2014.json'), equipment: read('dist/js/data/equipment-2014.json'), features: read('dist/js/data/features-2014.json') };
const fx = read('supabase/tests/character_create_fixtures.json');
const hero = (n) => structuredClone(fx.find((f) => f.name === n).data);
const policy = { optionalRules: { feats: false, multiclass: true, flexibleRacialAsi: false } };

test('честные сборки всех фикстур проходят', () => {
  for (const f of fx) { const r = checkCreate(f.data, cats, { policy }); assert.deepEqual(r, { ok: true, errors: [] }, f.name); }
});

test('подделки в листе отклоняются', () => {
  const cases = {
    stats: (h) => { h.stats.str = 30; }, hpMax: (h) => { h.hpMax += 50; }, level: (h) => { h.level += 1; },
    knownSpells: (h) => { h.knownSpells.push({ id: 'x', name: 'Желание', circle: 9, ref: 'dndsu:spell:999' }); },
    skills: (h) => { h.proficiencies.skills.stealth = 2; }, slotPools: (h) => { h.slotPools[0].max = 9; },
  };
  for (const [field, tamper] of Object.entries(cases)) {
    const h = hero('sorcerer3-draconic'); tamper(h);
    const r = checkCreate(h, cats);
    assert.equal(r.ok, false, field);
    assert.ok(r.errors.some((e) => e.field === field), `${field}: ${JSON.stringify(r.errors)}`);
  }
});

test('подделка внутри creation: недопустимый выбор и характеристики вне набора', () => {
  const a = hero('sorcerer3-draconic');
  a.creation.selections['srd51:class:sorcerer:skills'] = ['stealth', 'perception'];
  assert.equal(checkCreate(a, cats).ok, false);
  const b = hero('fighter1');
  b.creation.abilityInput.scores.str = 18;
  assert.equal(checkCreate(b, cats).ok, false);
  const c = hero('fighter1'); delete c.creation;
  assert.equal(checkCreate(c, cats).ok, false);
});

test('имя, заметки и личность на проверку не влияют', () => {
  const h = hero('fighter1');
  Object.assign(h, { name: 'Другое', notes: 'x', personality: { traits: 'y' }, portrait: 'assets/hero/class-fighter.webp' });
  assert.equal(checkCreate(h, cats).ok, true);
});

test('повышение: честное проходит, подделка в patch — нет', () => {
  const h = hero('fighter1');
  let n = 0;
  const p = levelUpPayload(h, levelUpPlan(h, 'srd51:class:fighter', cats), cats, { makeId: () => `id-${++n}` });
  assert.deepEqual(checkLevelUp(p, cats), { ok: true, errors: [] });
  const bad = structuredClone(p); bad.patch.stats = { ...h.stats, str: 30 };
  assert.equal(checkLevelUp(bad, cats).ok, false);
  const cheat = structuredClone(p); cheat.patch.level = 5;
  assert.equal(checkLevelUp(cheat, cats).ok, false);
});
