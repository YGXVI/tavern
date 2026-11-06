// Быстрый герой (три ответа → конструктор) и перенос из Long Story Short (#202).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indexCreation, quickCreation, quickResultModel, creationCharacter } from '../dist/js/views/hero/creation.js';
import { parseLss, docText } from '../dist/js/views/hero/lss.js';
import { toHeroView } from '../dist/js/views/hero/adapter.js';
import { makeCreateRequest } from '../dist/js/server/character-sheet.js';
import { CREATION, LSS_IMPORT } from '../dist/js/views/hero/fixture.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const ix = indexCreation({ options: read('dist/js/data/character-options-2014.json'), spells: read('dist/js/data/spells-2014.json'),
  equipment: read('dist/js/data/equipment-2014.json'), features: read('dist/js/data/features-2014.json') }, read('dist/js/data/spells-ref-2014.json'));

test('быстрый герой: все 20 сочетаний ответов собираются до конца и принимаются командой создания', () => {
  const roles = CREATION.quick.questions[0].options.map((o) => o.id), talks = CREATION.quick.questions[1].options.map((o) => o.id);
  for (const role of roles) for (const talk of talks) {
    const st = quickCreation(ix, { campaign: { id: 'c1' }, role, talk, name: 'Гром' });
    const r = quickResultModel(ix, st);
    assert.equal(r.status, 'valid', `${role}/${talk}: ${r.missing.join(' ')}`);
    for (const k of Object.keys(CREATION.quick.result)) assert.ok(k in r, `${role}/${talk}: result.${k}`);
    const hero = creationCharacter(ix, st);
    makeCreateRequest({ campaignId: 'c1', characterId: hero.characterId, operationId: hero.operationId, data: hero.data });
  }
  assert.match(quickResultModel(ix, quickCreation(ix, { role: 'front', talk: 'fist' })).summary, /Варвар/);
  assert.match(quickResultModel(ix, quickCreation(ix, { role: 'magic', talk: 'book' })).summary, /Волшебник/);
});

// Файл в формате, который пишет конвертер Foundry → LSS (поля и вложенность — как в нём).
const doc = (...lines) => ({ value: { id: 'x', data: { type: 'doc', content: lines.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) } } });
const lssFile = () => JSON.stringify({ tags: [], jsonType: 'character', version: '2', spells: { mode: 'text', prepared: [], book: [] }, data: JSON.stringify({
  jsonType: 'character', name: { value: 'Лира' },
  info: { charClass: { value: 'Волшебник 5' }, level: { value: 5 }, race: { value: 'Человек' }, background: { value: 'Мудрец' }, alignment: { value: 'Нейтрально-добрая' }, experience: { value: 6500 } },
  stats: { str: { score: 8 }, dex: { score: 14 }, con: { score: 12 }, int: { score: 18 }, wis: { score: 12 }, cha: { score: 10 } },
  saves: { int: { isProf: true }, wis: { isProf: true } },
  skills: { arcana: { name: 'arcana', isProf: 1 }, history: { name: 'history', isProf: 2 }, 'sleight of hand': { name: 'sleight of hand', isProf: 0 }, 'animal handling': { name: 'animal handling', isProf: true } },
  proficiency: 3,
  vitality: { 'hp-max': { value: 27 }, 'hp-current': { value: 20 }, 'hp-temp': { value: 0 }, ac: { value: 12 }, speed: { value: 30 }, 'hit-die': { value: 'd6' }, 'hp-dice-current': { value: 3 } },
  spells: { 'slots-1': { value: 4, filled: 4 }, 'slots-2': { value: 3, filled: 3 }, 'slots-3': { value: 2, filled: 2 } },
  coins: { gp: { value: 15 }, sp: { value: 8 } },
  weaponsList: [{ name: { value: 'Кинжал' }, mod: { value: '+5' }, dmg: { value: '1к4+2' } }],
  text: { 'spells-level-0': doc('Огненный снаряд', 'Свет'), 'spells-level-3': doc('Огненный шар'), equipment: doc('Книга заклинаний', 'Кинжал'), features: doc('Магическое восстановление'), personality: doc('Сначала читаю.'), prof: doc('Языки: общий, эльфийский') },
}) });

test('LSS: файл конвертера → лист героя и экран импорта той же формы, что образец', () => {
  const { hero, view, error } = parseLss(lssFile(), { fileName: 'lira.json', size: 4096 });
  assert.equal(error, undefined);
  for (const k of Object.keys(LSS_IMPORT)) assert.ok(k in view, `view.${k}`);
  assert.equal(hero.name, 'Лира'); assert.equal(hero.classId, 'wizard'); assert.equal(hero.level, 5); assert.equal(hero.raceId, 'human');
  assert.deepEqual(hero.stats, { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 });
  assert.deepEqual(hero.saves, ['int', 'wis']);
  assert.deepEqual(hero.proficiencies.skills, { arcana: 1, history: 2, animal: 1 });
  assert.deepEqual([hero.hpMax, hero.hp, hero.ac], [27, 20, 12]);
  assert.deepEqual(hero.hitDicePools[0], { id: 'lss-hd', name: 'd6', die: 6, total: 5, spent: 2 });
  assert.deepEqual(hero.slotPools.map((p) => [p.circle, p.max, p.spent]), [[1, 4, 0], [2, 3, 0], [3, 2, 0]]);
  assert.equal(hero.attacks[0].damage, '1d4+2'); assert.equal(hero.attacks[0].bonus, 5);
  assert.match(hero.spells, /^Заговоры: Огненный снаряд, Свет\n3: Огненный шар$/);
  assert.equal(hero.coins.gp, 15);
  assert.match(hero.notes, /Черты: Сначала читаю/);
  assert.ok(view.issues.some((i) => /Портрета/.test(i.title)));
  assert.ok(view.issues.every((i) => ['warn', 'error'].includes(i.kind)));
  // Перенесённый герой открывается новым листом.
  const v = toHeroView({ ...hero, id: 'ch-x', ownerId: 'u1' }, { userId: 'u1' });
  assert.equal(v.vitals.hp.max, 27);
  assert.ok(v.spellcasting.spells.some((x) => x.name === 'Огненный шар' && x.level === 3));
});

test('LSS: не тот файл — понятная ошибка; мультикласс и чужой бонус мастерства — пометки', () => {
  assert.match(parseLss('не json').error, /JSON/);
  assert.match(parseLss('{"foo":1}').error, /нет листа/);
  const multi = JSON.parse(lssFile()); const d = JSON.parse(multi.data);
  d.info.charClass.value = 'Figh (3) / Wiza (2)'; d.proficiency = 2;
  multi.data = JSON.stringify(d);
  const { view, hero } = parseLss(JSON.stringify(multi));
  assert.equal(hero.classId, 'fighter');
  assert.ok(view.issues.some((i) => i.title === 'Мультикласс'));
  assert.ok(view.issues.some((i) => /Бонус мастерства/.test(i.title)));
  assert.deepEqual(docText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'А' }, { type: 'text', text: 'Б' }] }] }), ['АБ']);
});
