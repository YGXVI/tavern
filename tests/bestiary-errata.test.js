// #196 A: поправки к снимку SRD API и инварианты бестиария (опыт по ПО, пассивное Восприятие).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyErrata } from '../data/bestiary/errata.mjs';
import srd from '../dist/js/data/bestiary-srd.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const raw = read('data/bestiary/bestiary-2014.json'), errata = read('data/bestiary/errata.json');
const cat = applyErrata(raw, errata);
const XP = { 0: 10, 0.125: 25, 0.25: 50, 0.5: 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900, 9: 5000, 10: 5900,
  11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000, 16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000, 21: 33000, 22: 41000, 23: 50000, 24: 62000, 30: 155000 };
const srdBlocks = cat.monsters.filter((m) => m.identity?.srd_index && m.stat_block);
const unverified = new Set(errata.unverified.map((u) => u.srd_index));

test('errata: исходный снимок не меняется, поправки применены', () => {
  const block = (c, i) => c.monsters.find((m) => m.identity?.srd_index === i).stat_block;
  assert.equal(block(raw, 'cult-fanatic').hit_points.average, 22);
  assert.deepEqual(block(cat, 'cult-fanatic').hit_points, { ...block(raw, 'cult-fanatic').hit_points, average: 33, formula: '6d8+6' });
  assert.equal(block(cat, 'blink-dog').senses.passive_perception, 13);
  assert.equal(block(cat, 'brass-dragon-wyrmling').xp, 200);
});

test('errata: снимок изменился — поправка не применяется молча', () => {
  const changed = structuredClone(raw);
  changed.monsters.find((m) => m.identity?.srd_index === 'spider').stat_block.senses.passive_perception = 11;
  assert.throws(() => applyErrata(changed, errata), /spider.*снимок изменился/);
  assert.throws(() => applyErrata(raw, { entries: [{ srd_index: 'nope', path: ['xp'], from: 1, to: 2 }] }), /нет записи/);
});

test('инвариант: опыт соответствует ПО у всех существ SRD', () => {
  const bad = srdBlocks.filter((m) => XP[m.stat_block.challenge_rating] !== undefined && m.stat_block.xp !== XP[m.stat_block.challenge_rating]
    && !(m.stat_block.challenge_rating === 0 && m.stat_block.xp === 0)).map((m) => m.identity.srd_index);
  assert.deepEqual(bad, []);
});

test('инвариант: пассивное Восприятие = 10 + Восприятие (или мод. Мудрости); исключения — только в списке «сверить»', () => {
  const bad = srdBlocks.filter((m) => {
    const s = m.stat_block, pp = s.senses?.passive_perception;
    if (pp == null) return false;
    const per = (s.proficiencies || []).find((p) => p.proficiency.index === 'skill-perception');
    return pp !== 10 + (per ? per.value : s.abilities.wisdom.modifier);
  }).map((m) => m.identity.srd_index);
  assert.deepEqual(bad.filter((i) => !unverified.has(i)), []);
  assert.deepEqual(bad.sort(), [...unverified].sort(), 'исправленную запись из «сверить» уберите из списка');
});

test('стол видит поправки: сгенерированный бестиарий', () => {
  const byId = new Map(srd.map((m) => [m.id, m]));
  assert.match(byId.get('srd:blink-dog').senses, /пассивное Восприятие 13/);
  assert.match(byId.get('srd:spider').senses, /пассивное Восприятие 10/);
});

test('инвариант (#116): средние хиты = формула, бонус хитов = кубы × мод. Телосложения у всех существ SRD', () => {
  const bad = [];
  for (const m of srdBlocks) {
    const s = m.stat_block, f = String(s.hit_points?.formula || '').replace(/\s/g, '');
    const x = /^(\d+)d(\d+)([+-]\d+)?$/.exec(f);
    if (!x) { bad.push(`${m.identity.srd_index}: формула ${f}`); continue; }
    const n = +x[1], d = +x[2], b = x[3] ? +x[3] : 0;
    if (Math.floor(n * (d + 1) / 2) + b !== s.hit_points.average) bad.push(`${m.identity.srd_index}: среднее`);
    if (b !== n * s.abilities.constitution.modifier) bad.push(`${m.identity.srd_index}: бонус Телосложения`);
  }
  assert.deepEqual(bad, []);
});
