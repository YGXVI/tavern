// Таблицы классов сверены с SRD 5.1 (data/rules-2014/sources/srd-5.1-cc.pdf) 06.11.2026: значения здесь набраны отдельно
// от каталога, чтобы случайная правка данных не прошла незамеченной (#202, аудит T3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const options = JSON.parse(readFileSync(new URL('../dist/js/data/character-options-2014.json', import.meta.url), 'utf8'));
const cls = (id) => options.entries.find((e) => e.id === `srd51:class:${id}`);
const FULL = [[2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1]];
const HALF = [[], [2], [3], [3], [4, 2], [4, 2], [4, 3], [4, 3], [4, 3, 2], [4, 3, 2], [4, 3, 3], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2], [4, 3, 3, 3, 2]];
const cantrips = (a, b, c) => [...Array(3).fill(a), ...Array(6).fill(b), ...Array(11).fill(c)];
const CANTRIPS = { bard: cantrips(2, 3, 4), cleric: cantrips(3, 4, 5), druid: cantrips(2, 3, 4), sorcerer: cantrips(4, 5, 6), warlock: cantrips(2, 3, 4), wizard: cantrips(3, 4, 5) };
const KNOWN = {
  bard: [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22], sorcerer: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15],
  warlock: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15], ranger: [0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11],
};
const BASE = {
  barbarian: [12, 'str con', 3], bard: [8, 'dex cha', 3], cleric: [8, 'wis cha', 1], druid: [8, 'int wis', 2], fighter: [10, 'str con', 3], monk: [8, 'str dex', 3],
  paladin: [10, 'wis cha', 3], ranger: [10, 'str dex', 3], rogue: [8, 'dex int', 3], sorcerer: [6, 'con cha', 1], warlock: [8, 'wis cha', 1], wizard: [6, 'int wis', 2],
};
const ASI = { fighter: [4, 6, 8, 12, 14, 16, 19], rogue: [4, 8, 10, 12, 16, 19] };

test('кость хитов, спасброски, подкласс, улучшения характеристик, мастерство', () => {
  for (const [id, [die, saves, sub]] of Object.entries(BASE)) {
    const c = cls(id);
    assert.equal(c.class.hitDie, die, id);
    assert.deepEqual([...c.class.savingThrows].sort(), saves.split(' ').sort(), id);
    assert.equal(c.class.subclassLevel, sub, id);
    assert.deepEqual(c.class.asiLevels, ASI[id] || [4, 8, 12, 16, 19], id);
    c.progression.forEach((row, i) => assert.equal(row.proficiencyBonus, 2 + Math.floor(i / 4), `${id} ${i + 1}`));
  }
});

test('ячейки, заговоры, известные заклинания, договор колдуна', () => {
  for (const id of Object.keys(BASE)) {
    const c = cls(id), sc = c.class.spellcasting;
    c.progression.forEach((row, i) => {
      const at = `${id} ${i + 1}`, slots = (row.spellSlots || []).filter(Boolean);
      if (sc?.slots === 'full') assert.deepEqual(slots, FULL[i], at);
      if (sc?.slots === 'half') assert.deepEqual(slots, HALF[i], at);
      if (CANTRIPS[id]) assert.equal(row.values.cantripsKnown, CANTRIPS[id][i], at);
      if (KNOWN[id]) assert.equal(row.values.spellsKnown || 0, KNOWN[id][i], at);
    });
  }
  const pact = cls('warlock').progression.map((r) => [r.values.pactSlots, r.values.pactSlotLevel]);
  assert.deepEqual(pact, [[1, 1], [2, 1], [2, 2], [2, 2], [2, 3], [2, 3], [2, 4], [2, 4], [2, 5], [2, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [4, 5], [4, 5], [4, 5], [4, 5]]);
});
