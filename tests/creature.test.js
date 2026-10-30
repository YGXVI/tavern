import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import SRD from '../dist/js/data/bestiary-srd.js';
import { BESTIARY } from '../dist/js/data/bestiary.js';
import { CREATURE_MAX_BYTES, normalizeCreature, validateCreature, fromSrd, toMonster } from '../dist/js/rules/creature.js';

const raw = JSON.parse(readFileSync(new URL('../data/bestiary/bestiary-2014.json', import.meta.url))).monsters;
const srd = raw.filter(m => m.stat_block?.source === 'srd_api_2014');
const identity = { id: 'private-1', ownerId: 'user-1', updatedAt: 1 };
const draft = extra => normalizeCreature({ ...identity, name: 'Мой страж', ...extra });
const paths = value => validateCreature(value).errors.map(e => e.path);
const ab = extra => ({ name: 'Испытание', text: 'Условный эффект, применяет мастер.', ...extra });

test('normalization is detached and idempotent; unknown is not zero or an invented score', () => {
  const input = { ...identity, name: 'Страж', actions: [ab({ damage: [{ dice: '2d6+3', type: null }] })], custom: { a: [1] } };
  const before = structuredClone(input), c = normalizeCreature(input);
  assert.deepEqual(normalizeCreature(c), c);
  assert.equal(c.ac, null); assert.equal(c.hp, null); assert.equal(c.stats.dex, null); assert.equal(c.speed.walk, null);
  c.actions[0].damage[0].dice = '1d4'; c.custom.a.push(2);
  assert.deepEqual(input, before);
  assert.equal(validateCreature(draft()).valid, true);
});

test('image-only and zero-valued manual templates retain their actual values', () => {
  const image = draft({ source: 'image', statblockImage: 'library/user-1/stat.webp' });
  assert.equal(validateCreature(image).valid, true);
  assert.ok(paths({ ...image, statblockImage: '' }).includes('statblockImage'));
  const manual = draft({ hp: 0, ac: 0, stats: { dex: 0 }, speed: { walk: 0 } });
  const m = toMonster(manual);
  assert.equal(m.hp, 0); assert.equal(m.ac, 0); assert.equal(m.speed, 0); assert.equal(m.init, -5);
  assert.equal(toMonster(image).init, null);
  const snapshot = { ...manual, ownerId: null };
  assert.equal(validateCreature(snapshot).valid, false, 'private persistence still requires an owner');
  assert.equal(toMonster(snapshot).id, 'lib:cr-1'.replace('cr-1', manual.id));
  assert.equal(toMonster(snapshot).ownerId, undefined);
});

test('validation returns paths for invalid core fields without coercing them', () => {
  for (const [field, value] of [['id', ''], ['ownerId', 'bad/path'], ['name', '   '], ['source', 'srd'], ['ac', '12'], ['hp', -1], ['size', 'enormous'], ['stats', []], ['speed', false], ['cr', '1/3'], ['actions', {}], ['legendary', []]]) {
    const c = draft({ [field]: value });
    assert.ok(paths(c).includes(field), `${field}: ${JSON.stringify(validateCreature(c))}`);
  }
  assert.ok(paths(draft({ stats: { wis: '12' } })).includes('stats.wis'));
  assert.ok(paths(draft({ speed: { fly: -1 } })).includes('speed.fly'));
  assert.ok(paths(draft({ legendary: { count: -1, actions: [] } })).includes('legendary.count'));
});

test('non-JSON input cannot be silently serialized to valid data', () => {
  const cyclic = draft(); cyclic.extra = cyclic;
  for (const x of [null, [], 1, cyclic, draft({ extra: NaN }), draft({ extra: Infinity }), draft({ extra: 1n }), { ...draft(), fn() {} }, { ...draft(), missing: undefined }, draft({ extra: new Date() }), draft({ extra: Array(2) })]) {
    assert.equal(validateCreature(x).valid, false);
  }
  const deep = draft(); let p = deep;
  for (let i = 0; i < 100; i++) { p.next = {}; p = p.next; }
  assert.ok(validateCreature(deep).errors.some(e => e.code === 'depth'));
});

test('64 KiB limit is inclusive and counts UTF-8 bytes, not JS characters', () => {
  const c = draft({ notes: '' });
  const bytes = validateCreature(c).bytes;
  c.notes = 'a'.repeat(CREATURE_MAX_BYTES - bytes);
  assert.equal(validateCreature(c).bytes, CREATURE_MAX_BYTES);
  assert.equal(validateCreature(c).valid, true);
  c.notes += 'я';
  assert.equal(validateCreature(c).bytes, CREATURE_MAX_BYTES + 2);
  assert.equal(validateCreature(c).valid, false);
  assert.ok(validateCreature(c).errors.some(e => e.code === 'max_bytes'));
});

test('save actor must be chosen explicitly; self and target survive projection', () => {
  for (const who of ['target', 'self']) {
    const save = { ability: 'con', dc: 15, who };
    const c = draft({ actions: [ab({ save })] });
    assert.equal(validateCreature(c).valid, true);
    const m = toMonster(c);
    assert.deepEqual(m.actions[0].save, save);
    assert.match(m.actions[0].note, new RegExp(who));
    m.actions[0].save.dc = 999; assert.equal(c.actions[0].save.dc, 15);
  }
  assert.ok(paths(draft({ actions: [ab({ save: { ability: 'con', dc: 15 } })] })).includes('actions.0.save.who'));
});

test('multiple components and alternatives do not become an incomplete roll', () => {
  const components = [{ dice: '2d10+8', type: 'piercing' }, { dice: '2d6', type: 'fire' }];
  const choice = [{ dice: null, type: null, source: { choose: 1, options: ['1d8', '1d10'] } }];
  const c = draft({ actions: [ab({ damage: components }), ab({ damage: choice }), ab({ damage: [{ dice: '0', type: null }] }), ab({ damage: [{ dice: '1d6+2', type: 'cold' }] })] });
  const m = toMonster(c);
  assert.equal(m.actions[0].damage, ''); assert.deepEqual(m.actions[0].damageComponents, components);
  assert.equal(m.actions[1].damage, ''); assert.deepEqual(m.actions[1].damageComponents, choice);
  assert.equal(m.actions[2].damage, '0'); assert.equal(m.actions[3].damage, '1d6+2');
});

test('all 334 complete SRD records validate and preserve every feature text and raw save', () => {
  assert.equal(srd.length, 334);
  for (const original of srd) {
    const before = structuredClone(original);
    const c = fromSrd(original, identity), v = validateCreature(c);
    assert.equal(v.valid, true, `${original.id}: ${JSON.stringify(v.errors)}`);
    assert.equal(c.hp, original.stat_block.hit_points.average);
    assert.equal(c.ac, original.stat_block.armor_class[0].value);
    assert.equal(c.provenance.id, original.id);
    assert.match(c.provenance.attribution, /SRD 5.1/);
    const pairs = [['special_abilities', c.traits], ['actions', c.actions], ['bonus_actions', c.bonusActions], ['reactions', c.reactions], ['legendary_actions', c.legendary.actions]];
    for (const [key, features] of pairs) {
      assert.equal(features.length, (original.stat_block[key] || []).length);
      for (const [i, feature] of features.entries()) {
        const src = original.stat_block[key][i];
        assert.equal(feature.text, src.description_en || '');
        assert.deepEqual(feature.saving_throw, src.saving_throw);
        assert.equal(feature.save, undefined, 'actor not present in the source must not be guessed');
        assert.deepEqual(feature.damage.map(d => d.dice), (src.damage || []).map(d => d.formula ?? null));
      }
    }
    const m = toMonster(c);
    assert.equal(m.id, 'lib:private-1'); assert.equal(m.srd, false); assert.equal(m.ownerId, undefined);
    assert.deepEqual(original, before);
  }
});

test('red dragon retains both bite components, multiattack, raw DC and nonwalking speeds', () => {
  const c = fromSrd(srd.find(m => m.identity.srd_index === 'adult-red-dragon'), identity);
  assert.equal(c.speed.fly, 80); assert.equal(c.speed.climb, 40);
  const bite = c.actions.find(a => a.name === 'Bite');
  assert.deepEqual(bite.damage.map(d => d.dice), ['2d10+8', '2d6']);
  const m = toMonster(c);
  assert.equal(m.actions.find(a => a.name === 'Bite').damage, '');
  assert.equal(m.actions.find(a => a.name === 'Multiattack').subactions.length, 3);
  assert.equal(m.actions.find(a => a.name === 'Frightful Presence').saving_throw.dc_value, 19);
  assert.equal(m.darkvision, 120);
});

test('322 runtime SRD projections remain detached with all existing descriptions and notes', () => {
  assert.equal(SRD.length, 322);
  const before = structuredClone(SRD);
  for (const original of SRD) {
    const c = fromSrd(original, identity);
    assert.equal(validateCreature(c).valid, true, original.id);
    const m = toMonster(c);
    assert.equal(m.actions.length, original.actions.length);
    original.actions.forEach((a, i) => {
      assert.equal(m.actions[i].desc, a.desc || a.note || '');
      if (a.note) assert.ok(m.actions[i].note.includes(a.note));
    });
    assert.equal(m.hp, original.hp); assert.equal(m.hpDice, original.hpDice);
    assert.deepEqual(m.saves, original.saves || {});
  }
  assert.deepEqual(SRD, before);
});

test('non-SRD and missing source markers are refused; no registry side effects', () => {
  for (const input of [raw.find(m => !m.stat_block), { ...SRD[0], srd: false }, { ...SRD[0], srd: undefined }, BESTIARY.find(m => m.id === 'faceless-spawn')]) {
    assert.throws(() => fromSrd(input), /SRD/);
  }
  assert.throws(() => toMonster({ name: 'Без владельца и ID' }), /существо/);
  const c = fromSrd(SRD[0]);
  assert.equal(c.id, ''); assert.equal(c.ownerId, '');
  assert.ok(paths(c).includes('id'));
  const n = BESTIARY.length;
  assert.equal(toMonster(draft({ srd: true })).srd, false);
  assert.equal(BESTIARY.length, n);
});
