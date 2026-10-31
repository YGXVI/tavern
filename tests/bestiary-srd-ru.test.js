// TASK-117: отрицательные сценарии не меняют рабочие файлы.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import SRD from '../dist/js/data/bestiary-srd.js';
import { hashEnglish, validateTranslations, mechanicalTokens } from '../tools/bestiary-srd-ru.mjs';

const root = new URL('../', import.meta.url);
const catalogue = JSON.parse(readFileSync(new URL('data/bestiary/bestiary-2014.json', root), 'utf8'));
const translations = JSON.parse(readFileSync(new URL('data/bestiary/srd-ru.json', root), 'utf8'));
const glossary = JSON.parse(readFileSync(new URL('data/bestiary/srd-ru-glossary.json', root), 'utf8'));
const entries = validateTranslations(catalogue, translations);
const translated = (e) => translations.monsters[e.id][e.section][e.name][hashEnglish(e.en)].ru;

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

test('Весь корпус: 334 существа, все 1503 описания, включая HAND, актуальные хеши', () => {
  assert.equal(new Set(entries.map((e) => e.id)).size, 334);
  assert.equal(entries.length, 1503);
  assert.deepEqual(Object.fromEntries(['special_abilities', 'actions', 'legendary_actions', 'reactions'].map((section) => [section, entries.filter((e) => e.section === section).length])), {
    special_abilities: 551, actions: 841, legendary_actions: 99, reactions: 12,
  });
  for (const e of entries) {
    const ru = translated(e);
    assert.match(ru, /[а-яё]/i, `${e.id}/${e.name}`);
    assert.deepEqual(mechanicalTokens(ru), mechanicalTokens(e.en), `${e.id}/${e.section}/${e.name}: механика`);
  }
});

test('Весь корпус: латиница и конкурирующие термины из словаря', () => {
  for (const e of entries) {
    let ru = translated(e);
    for (const word of glossary.allowed_latin) ru = ru.replaceAll(word, '');
    assert.doesNotMatch(ru, /[a-z]/i, `${e.id}/${e.name}: непереведённая латиница`);
    for (const term of glossary.terms) for (const banned of term.forbidden) {
      assert.ok(!ru.toLocaleLowerCase('ru').includes(banned.toLocaleLowerCase('ru')), `${e.id}/${e.name}: запрещённый вариант ${banned}`);
    }
    for (const [condition, stem] of Object.entries({ blinded: /ослеп|слепот/i, charmed: /очарова/i, deafened: /оглох|глухот/i, frightened: /испуг/i, grappled: /схвач|захват|схват/i, incapacitated: /недееспособ/i, invisible: /невидим/i, paralyzed: /парализ|паралич/i, petrified: /окамен|камене|камень/i, poisoned: /отравл/i, prone: /сбит|сбив|ничком/i, restrained: /опутан|опутат/i, stunned: /ошелом/i, unconscious: /сознани/i })) {
      if (new RegExp(`\\b${condition}\\b`, 'i').test(e.en)) assert.match(ru, stem, `${e.id}/${e.name}: ${condition}`);
    }
  }
});

test('Все явные количества словами при атаках и ограничениях имеют русское соответствие', () => {
  const forms = { one: /\b1\b|од(?:ин|на|но|ну|ни|ним|ной|ного)|единствен|перв/i, two: /\b2\b|дв(?:а|е|ух|ум|умя)|оба|обе/i, three: /\b3\b|три|трёх|трех/i, four: /\b4\b|четыр/i, five: /\b5\b|пят/i, six: /\b6\b|шест/i, seven: /\b7\b|семь|семи/i, twelve: /\b12\b|двенадцат/i, 'twenty-four': /\b24\b|двадцать четыре/i };
  const nouns = 'attacks?|heads?|tentacles?|claws?|chains?|targets?|creatures?|humanoids?|beasts?|trees?|spikes?|zombies|specters|longswords?|tail';
  for (const e of entries) for (const [en, ru] of Object.entries(forms)) {
    if (new RegExp(`\\b${en} (?:[a-z]+[ -]){0,3}(?:${nouns})\\b(?!['’])`, 'i').test(e.en)) assert.match(translated(e), ru, `${e.id}/${e.name}: количество ${en}`);
  }
});

test('Характеристика остаётся связанной с тем же значением Сл', () => {
  const abilities = { Strength: 'Силы', Dexterity: 'Ловкости', Constitution: 'Телосложения', Intelligence: 'Интеллекта', Wisdom: 'Мудрости', Charisma: 'Харизмы' };
  let count = 0;
  for (const e of entries) for (const m of e.en.matchAll(/DC (\d+) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)(?: or (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma))?(?: \([^)]*\))?(?: saving throw| check)?/g)) {
    const pattern = new RegExp(`${abilities[m[2]]}${m[3] ? ` или ${abilities[m[3]]}` : ''}(?: \\([^)]*\\))? Сл ${m[1]}(?!\\d)`);
    assert.match(translated(e), pattern, `${e.id}/${e.name}: характеристика и Сл`);
    count++;
  }
  assert.equal(count, 295);
});

test('Runtime: только добавление ru, все EN и механические поля побайтно прежние в JSON', () => {
  const dropRu = (value) => Array.isArray(value) ? value.map(dropRu) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'ru').map(([key, v]) => [key, dropRu(v)])) : value;
  assert.equal(SRD.length, 322);
  // SHA JSON модуля до TASK-117, main bf3b426b8a05bab35bac655488fb6439c70fa419.
  assert.equal(hashEnglish(JSON.stringify(dropRu(SRD))), '929ea66757f2fcae286b35a62a461aad6bea95f239bf02ba371065223a708fc3');
  let count = 0;
  for (const monster of SRD) {
    const original = catalogue.monsters.find((m) => m.stat_block?.source === 'srd_api_2014' && `srd:${m.identity?.srd_index || m.identity?.slug}` === monster.id);
    for (const [runtime, section] of [['traits', 'special_abilities'], ['actions', 'actions'], ['legendary', 'legendary_actions'], ['reactions', 'reactions']]) {
      for (const [i, item] of (monster[runtime] || []).entries()) {
        const source = original.stat_block[section][i];
        assert.equal(item.desc, source.description_en);
        assert.equal(item.ru, translations.monsters[original.id][section][source.name_en][hashEnglish(source.description_en)].ru);
        count++;
      }
    }
  }
  assert.equal(count, 1471);
});

test('Генерация детерминирована; устаревший перевод и изменённый EN не повреждают выход', () => {
  const dir = mkdtempSync(join(tmpdir(), 'srd-ru-'));
  try {
    const generator = fileURLToPath(new URL('tools/bestiary-srd.mjs', root));
    const output = join(dir, 'out.js');
    const input = fileURLToPath(new URL('data/bestiary/bestiary-2014.json', root));
    execFileSync(process.execPath, [generator, input, output], { stdio: 'pipe' });
    assert.equal(readFileSync(output, 'utf8'), readFileSync(new URL('dist/js/data/bestiary-srd.js', root), 'utf8'));
    execFileSync(process.execPath, [generator, input, output], { stdio: 'pipe' });
    assert.equal(readFileSync(output, 'utf8'), readFileSync(new URL('dist/js/data/bestiary-srd.js', root), 'utf8'));
    const sentinel = 'проверка сохранности существующего выхода';
    writeFileSync(output, sentinel);
    const stale = structuredClone(translations);
    const e = entries[0];
    delete stale.monsters[e.id][e.section][e.name][hashEnglish(e.en)];
    const ruPath = join(dir, 'stale.json');
    writeFileSync(ruPath, JSON.stringify(stale));
    assert.throws(() => execFileSync(process.execPath, [generator, input, output, ruPath], { stdio: 'pipe' }));
    assert.equal(readFileSync(output, 'utf8'), sentinel);
    const changed = structuredClone(catalogue);
    changed.monsters.find((m) => m.id === e.id).stat_block[e.section][0].description_en += ' Changed.';
    const changedPath = join(dir, 'changed.json');
    writeFileSync(changedPath, JSON.stringify(changed));
    assert.throws(() => execFileSync(process.execPath, [generator, changedPath, output], { stdio: 'pipe' }));
    assert.equal(readFileSync(output, 'utf8'), sentinel);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
