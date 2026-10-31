// TASK-117: отрицательные сценарии не меняют рабочие файлы.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hashEnglish, validateTranslations, mechanicalTokens } from '../tools/bestiary-srd-ru.mjs';

function fixture() {
  const texts = ['The creature can breathe air and water.', 'The creature can breathe only underwater.'];
  const catalogue = { monsters: [{ id: 'test:srd', stat_block: { source: 'srd_api_2014', special_abilities: texts.map((description_en) => ({ name_en: 'Breathing', description_en })) } }] };
  const translations = { schema_version: 1, language: 'ru', source: { stat_block_source: 'srd_api_2014' }, monsters: { 'test:srd': { special_abilities: { Breathing: {
    [hashEnglish(texts[0])]: { ru: 'Существо может дышать воздухом и под водой.' },
    [hashEnglish(texts[1])]: { ru: 'Существо может дышать только под водой.' },
  } } } } };
  return { catalogue, translations, texts };
}

test('Русский слой: одинаковые имена с разным EN, порядок и дубликаты', () => {
  const { catalogue, translations } = fixture();
  assert.equal(validateTranslations(catalogue, translations).length, 2);
  catalogue.monsters[0].stat_block.special_abilities.reverse();
  catalogue.monsters[0].stat_block.special_abilities.push(catalogue.monsters[0].stat_block.special_abilities[0]);
  catalogue.monsters.push({ id: 'test:other', stat_block: { source: 'other', actions: [{ name_en: 'Other', description_en: 'Not SRD.' }] } });
  assert.equal(validateTranslations(catalogue, translations).length, 3);
});

test('Русский слой: изменённый оригинал, пропущенный, пустой, устаревший и чужой перевод отклоняются', () => {
  for (const mutate of [
    (c) => { c.monsters[0].stat_block.special_abilities[0].description_en += ' '; },
    (_, t) => { delete t.monsters['test:srd']; },
    (_, t, texts) => { t.monsters['test:srd'].special_abilities.Breathing[hashEnglish(texts[0])].ru = ' '; },
    (_, t) => { t.monsters['test:srd'].special_abilities.Breathing[hashEnglish('Old EN')] = { ru: 'Устаревший текст.' }; },
    (_, t) => { t.monsters['test:non-srd'] = {}; },
    (c) => { c.monsters[0].stat_block.legendary_intro = 'New source text'; },
  ]) {
    const { catalogue, translations, texts } = fixture();
    mutate(catalogue, translations, texts);
    assert.throws(() => validateTranslations(catalogue, translations));
  }
});

test('Механика: кубы, числа, Сл, подписанные бонусы и футы', () => {
  const en = 'Melee Weapon Attack: +4 to hit, reach 5 ft. Hit: 5 (1d6 + 2) damage; DC 14. Range 80/320 ft.';
  const ru = 'Рукопашная атака оружием: +4 к попаданию, досягаемость 5 фт. Попадание: 5 (1к6 + 2) урона; Сл 14. Дистанция 80/320 фт.';
  assert.deepEqual(mechanicalTokens(en), mechanicalTokens(ru));
  assert.notDeepEqual(mechanicalTokens(en), mechanicalTokens(ru.replace('Сл 14', 'Сл 15')));
});
