// Лист героя как основа сайта (#203): КД и атаки из снаряжения, заряды умений класса, заговоры без дублей,
// действия сумки и улучшение характеристик +1/+1 при повышении.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.self ??= {};
const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const { toHeroView, spellIndex } = await import('../dist/js/views/hero/adapter.js');
const { gearIndex } = await import('../dist/js/views/hero/gear.js');
const { applyHeroAction } = await import('../dist/js/views/hero/actions.js');
const { indexCreation } = await import('../dist/js/views/hero/creation.js');
const { newLevelUp, levelUpModel, applyLevelUpChoice, levelUpRequest } = await import('../dist/js/views/hero/levelup-model.js');
const { seedDB } = await import('../dist/js/data/demo.js');

const gear = gearIndex(read('dist/js/data/equipment-2014.json'));
const spells = spellIndex({ spells: read('dist/js/data/spells-2014.json'), ref: read('dist/js/data/spells-ref-2014.json'), srd: read('dist/js/data/spells-srd-2014.json') });
const fx = read('supabase/tests/character_create_fixtures.json');
const hero = (name) => ({ ...structuredClone(fx.find((f) => f.name === name).data), id: name, ownerId: 'u1' });
const view = (h) => toHeroView(h, { userId: 'u1', gear, spells });

test('воин из конструктора: кольчуга и щит дают КД 18, топор — атака, Второе дыхание — бонусным действием', () => {
  const v = view(hero('fighter1'));
  assert.equal(v.vitals.ac.value, 18);
  assert.match(v.explain.ac, /Кольчуга 16 \+ щит \+2/);
  const axe = v.actions.action.find((a) => a.name === 'Боевой топор');
  assert.ok(axe, 'атака топором');
  assert.match(axe.dmg, /^1к8[+−]\d$/);
  assert.ok(v.explain[axe.explain], 'откуда бонус атаки');
  assert.ok(v.actions.bonus.some((a) => a.name === 'Второе дыхание' && a.res));
  assert.ok(v.resources.some((r) => r.name === 'Второе дыхание' && r.total === 1));
  assert.ok(v.inventory.equipped.some((x) => x.name === 'Кольчуга'), 'стартовый доспех надет');
  assert.ok(!v.actions.special.some((a) => a.empty), 'воину не пишем «Заклинаний пока нет»');
  assert.ok(!v.features.some((f) => /Возраст|Мировоззрение|Размер/.test(f.name)), 'паспортные строки расы скрыты');
});

test('Мира из песочницы: «Священное пламя» — одна строка со СЛ, «Духовное оружие» — бонусным, ячейки по кругам', () => {
  const mira = structuredClone(seedDB().campaigns['c-shadows'].characters.find((c) => c.id === 'ch-mira'));
  const v = view(mira);
  const flame = [...v.actions.action, ...v.actions.bonus].filter((a) => a.name === 'Священное пламя');
  assert.equal(flame.length, 1);
  assert.equal(flame[0].dc, 'СЛ 14');
  assert.ok(v.actions.bonus.some((a) => a.name === 'Духовное оружие'));
  assert.ok(v.resources.some((r) => r.kind === 'slot' && r.circle === 3 && r.total === 2));
  assert.ok(v.inventory.equipped.some((x) => x.name === 'Щит'), 'щит со старого листа — «надето»');
});

test('сумка: надеть, добавить, убрать, монеты; заряд класса записывается при первой трате', () => {
  const h = hero('fighter1');
  const v = view(h);
  const auto = v.inventory.equipped.filter((x) => x.auto).map((x) => x.id);
  const shield = v.inventory.equipped.find((x) => x.name === 'Щит');
  applyHeroAction(h, 'equip', { itemId: shield.id, auto });
  assert.equal(view(h).vitals.ac.value, 16, 'без щита');
  applyHeroAction(h, 'addItem', { name: 'Кинжал', ref: 'srd51:equipment:dagger', weight: 1, quantity: 2 });
  assert.equal(h.inventoryItems.find((x) => x.ref === 'srd51:equipment:dagger').quantity, 2);
  applyHeroAction(h, 'removeItem', { itemId: h.inventoryItems.find((x) => x.ref === 'srd51:equipment:dagger').id });
  assert.equal(h.inventoryItems.find((x) => x.ref === 'srd51:equipment:dagger').quantity, 1);
  applyHeroAction(h, 'coins', { gp: 42 });
  assert.equal(h.coins.gp, 42);
  applyHeroAction(h, 'useResource', { id: 'cls-second-wind', name: 'Второе дыхание', total: 1, recovery: 'short' });
  assert.equal(h.resources.find((r) => r.id === 'cls-second-wind').spent, 1);
  assert.equal(view(h).resources.find((r) => r.name === 'Второе дыхание').left, 0);
});

test('повышение: +1 к двум характеристикам вместо +2 к одной', () => {
  const ix = indexCreation({ options: read('dist/js/data/character-options-2014.json'), spells: read('dist/js/data/spells-2014.json'),
    equipment: read('dist/js/data/equipment-2014.json'), features: read('dist/js/data/features-2014.json') }, read('dist/js/data/spells-ref-2014.json'));
  const h = hero('sorcerer3-draconic');
  const st = newLevelUp(ix, h, { key: 'c1~s', campaignId: 'c1' });
  const hv = { ...toHeroView(h, { userId: 'u1' }), id: 'c1~s' };
  const asi = levelUpModel(ix, st, h, hv).news.extra.find((b) => /Улучшение/.test(b.title));
  assert.ok(asi.list.some((x) => x.value === 'asi1:cha') && asi.list.some((x) => x.value.startsWith('feat:')), '+1 и черта в списке');
  applyLevelUpChoice(ix, st, h, { extra: `${asi.choiceId}|asi1:cha` });
  applyLevelUpChoice(ix, st, h, { extra: `${asi.choiceId}|asi1:con` });
  applyLevelUpChoice(ix, st, h, { auto: true });
  const m = levelUpModel(ix, st, h, hv);
  assert.equal(m.status, 'valid', JSON.stringify(m.missing));
  const req = levelUpRequest(ix, st, h, { newId: () => '00000000-0000-4000-8000-000000000001' });
  assert.equal(req.payload.patch.stats.cha, h.stats.cha + 1);
  assert.equal(req.payload.patch.stats.con, h.stats.con + 1);
});

test('перенос из Long Story Short: имя, класс, характеристики, экспертиза, атаки, сумка текстом', async () => {
  const { parseLss, lssText } = await import('../dist/js/views/hero/lss.js');
  const inner = { name: { value: 'Брин' }, info: { charClass: { value: 'Плут' }, level: { value: 3 }, race: { value: 'Полурослик' } },
    stats: { str: { score: 8 }, dex: { score: 17 }, con: { score: 12 }, int: { score: 13 }, wis: { score: 10 }, cha: { score: 14 } },
    saves: { dex: { isProf: true } }, skills: { stealth: { isProf: 2 }, 'sleight of hand': { isProf: 1 } },
    vitality: { 'hp-max': { value: 20 }, ac: { value: 14 }, speed: { value: 25 }, 'hit-die': { value: 'd8' } },
    weaponsList: [{ name: { value: 'Короткий меч' }, mod: { value: '+5' }, dmg: { value: '1к6+3' } }],
    text: { equipment: { value: { data: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Кожаный доспех, лук' }] }] } } } } };
  const r = parseLss(JSON.stringify({ jsonType: 'character', data: JSON.stringify(inner) }));
  assert.equal(r.hero.name, 'Брин'); assert.equal(r.hero.classId, 'rogue'); assert.equal(r.hero.stats.dex, 17);
  assert.deepEqual(r.hero.saves, ['dex']); assert.equal(r.hero.proficiencies.skills.stealth, 2); assert.ok(r.hero.skills.includes('sleight'));
  assert.deepEqual([r.hero.attacks[0].name, r.hero.attacks[0].bonus, r.hero.attacks[0].damage], ['Короткий меч', 5, '1d6+3']);
  assert.deepEqual(r.hero.inventoryItems.map((x) => x.name), ['Кожаный доспех', 'Лук'], 'снаряжение через запятые — отдельными вещами');
  assert.equal(lssText('строка'), 'строка');
  assert.throws(() => parseLss('{"foo": 1}'), /Long Story Short/);
  const v = view({ ...r.hero, id: 'brin', ownerId: 'u1' });
  assert.equal(v.vitals.ac.value, 14);
  assert.equal(v.skills.find((s) => s.name === 'Скрытность').prof, 'expert');
});

test('заклинания любому герою: воин получает «Предметы и дары», характеристику и каст без ячеек; старый лист не теряет своих', () => {
  const h = hero('fighter1');
  const note = applyHeroAction(h, 'addSpell', { name: 'Щит', circle: 1, ref: spells.byName.get('щит')?.id });
  assert.match(note.title, /Щит — в листе/);
  assert.equal(h.spellSources[0].id, 'src-extra');
  assert.ok(['int', 'wis', 'cha'].includes(h.spellSources[0].ability));
  applyHeroAction(h, 'spellAbility', { ability: 'cha' });
  assert.equal(h.spellSources[0].ability, 'cha');
  applyHeroAction(h, 'addSpell', { name: 'Шёпот маски', circle: 2, description: 'Шёпот в 30 футах.' });
  assert.match(applyHeroAction(h, 'addSpell', { name: 'щит', circle: 1 }).title, /уже в листе/);
  const v = view(h);
  assert.equal(v.spellcasting.abilityId, 'cha');
  assert.ok(v.spellcasting.extra);
  assert.deepEqual(v.spellcasting.spells.map((s) => s.name).sort(), ['Шёпот маски', 'Щит']);
  const shield = h.knownSpells.find((s) => s.name === 'Щит');
  assert.match(applyHeroAction(h, 'cast', { spellId: shield.id }).title, /сотворено/, 'ячеек у воина нет — без траты');
  applyHeroAction(h, 'removeSpell', { spellId: shield.id });
  assert.deepEqual(h.knownSpells.map((s) => s.name), ['Шёпот маски']);

  const mira = structuredClone(seedDB().campaigns['c-shadows'].characters.find((c) => c.id === 'ch-mira'));
  const before = view(mira).spellcasting.spells.length;
  const legacy = view(mira).spellcasting.spells.map((s) => ({ name: s.name, circle: s.level }));
  applyHeroAction(mira, 'addSpell', { name: 'Огненный шар', circle: 3, legacy });
  const after = view(mira).spellcasting;
  assert.equal(after.spells.length, before + 1, 'заклинания старого листа переехали в список');
  assert.equal(after.abilityId, 'wis', 'жрица колдует Мудростью');
});

test('старая сумка строкой: «23 зм» — монеты, а не предмет; черты характера сохраняются', () => {
  const lira = structuredClone(seedDB().campaigns['c-crypt'].characters.find((c) => c.id === 'ch-lira'));
  const v = view(lira);
  if (/\d+\s*зм/.test(String(lira.inventory || ''))) {
    assert.ok(v.inventory.coins.gp > 0);
    assert.ok(![...v.inventory.equipped, ...v.inventory.pack].some((x) => /\d+\s*зм/.test(x.name)));
  }
  assert.match(applyHeroAction(lira, 'editField', { field: 'traits', value: 'Говорит шёпотом' }).title, /Сохранено/);
  assert.equal(view(lira).personality.traits, 'Говорит шёпотом');
});

test('трата ячейки и заряда возвращается («Вернуть» в подсказке), но не ниже нуля', () => {
  const ch = hero('cleric5-hill-dwarf');
  const pool = ch.slotPools.find((p) => p.circle === 1);
  const note = applyHeroAction(ch, 'useResource', { id: pool.id });
  assert.equal(note.undo.id, pool.id);
  assert.equal(pool.spent, 1);
  applyHeroAction(ch, 'refund', { id: pool.id });
  assert.equal(pool.spent, 0);
  assert.equal(applyHeroAction(ch, 'refund', { id: pool.id }), null, 'ниже нуля не уходит');
  const cast = applyHeroAction(ch, 'cast', { spellId: ch.knownSpells.find((s) => s.circle === 1).id });
  assert.ok(cast.undo?.id, 'сотворение тоже можно вернуть');
  const legacy = { slots: { 1: { max: 2, used: 0 } } };
  const n = applyHeroAction(legacy, 'useResource', { id: 'legacy-slot-1' });
  applyHeroAction(legacy, 'refund', { id: n.undo.id });
  assert.equal(legacy.slots[1].used, 0);
});
