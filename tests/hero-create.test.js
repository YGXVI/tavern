// Создание героя (#203, аудит 06.11): мастер на всех расах × классах SRD и быстрый герой на всех парах ответов.
// Без английских названий в шагах и листе, у каждого умения есть текст, КД итога — как в листе, ответы дают разных героев.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.self ??= {};
const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const C = await import('../dist/js/views/hero/creation.js');
const { toHeroView, spellIndex } = await import('../dist/js/views/hero/adapter.js');
const { gearIndex } = await import('../dist/js/views/hero/gear.js');
const cats = { options: read('dist/js/data/character-options-2014.json'), spells: read('dist/js/data/spells-2014.json'), equipment: read('dist/js/data/equipment-2014.json'), features: read('dist/js/data/features-2014.json') };
const ix = C.indexCreation(cats, read('dist/js/data/spells-ref-2014.json'));
const gear = gearIndex(cats.equipment);
const spells = spellIndex({ spells: cats.spells, ref: read('dist/js/data/spells-ref-2014.json'), srd: read('dist/js/data/spells-srd-2014.json') });
const campaign = { id: 'c1', name: 'Тест', members: [], characters: [] };
const full = (b) => !b || /выбрано (\d+) из \1/.test(b.note);
const ENG = /\b[A-Z][a-z]{2,}/;
const tail = (id) => id.split(':').pop();

/** «Как обычно» на каждом шаге — как нажимает игрок, который не вникает. */
function build(race, cls) {
  const st = C.newCreation(ix, { campaign, userId: 'u1' });
  const ch = (x) => C.applyCreationChoice(ix, st, x), m = () => C.creationModel(ix, st);
  ch({ step: 'race', id: race }); ch({ step: 'class', id: cls }); ch({ step: 'background', id: m().backgrounds[0]?.id }); ch({ step: 'abilities', id: 'auto' });
  for (let i = 0; i < 12; i += 1) {
    const box = [...m().extra.race, ...m().extra.class].find((b) => !full(b)); if (!box) break;
    for (const it of box.list) { if (full([...m().extra.race, ...m().extra.class].find((x) => x.choiceId === box.choiceId))) break; ch({ step: 'class', id: 'extra', value: `${box.choiceId}|${it.value}` }); }
  }
  for (const s of m().backgroundSkills?.list?.filter((x) => !x.from) || []) if (!full(m().backgroundSkills)) ch({ step: 'background', id: 'skill', value: s.name });
  for (const l of m().backgroundLangs?.list?.filter((x) => !x.from) || []) { if (full(m().backgroundLangs)) break; ch({ step: 'background', id: 'lang', value: l.name }); }
  for (const g of m().equipment?.groups || []) ch({ step: 'equipment', id: 'eq', value: `${g.title}|${g.options[0].name}` });
  ch({ step: 'spells', id: 'auto' }); ch({ step: 'look', id: 'name', value: 'Тест' });
  return st;
}

test('мастер: 9 рас × 12 классов — русские названия, тексты умений, КД итога = КД листа, без пустой магии у паладина 1 ур.', () => {
  const races = [...ix.defs.values()].filter((x) => x.kind === 'race').map((r) => tail(r.id));
  const classes = [...ix.defs.values()].filter((x) => x.kind === 'class').map((r) => tail(r.id));
  assert.equal(races.length * classes.length, 108);
  const problems = [];
  for (const race of races) for (const cls of classes) {
    const st = build(race, cls), where = `${race}/${cls}`;
    const model = C.creationModel(ix, st);
    for (const g of model.equipment.groups) for (const o of g.options) if (ENG.test(o.name)) problems.push(`${where} шаг: ${o.name}`);
    for (const b of [...model.extra.race, ...model.extra.class]) for (const o of b.list) if (ENG.test(o.name)) problems.push(`${where} выбор: ${o.name}`);
    if (model.steps.some((s) => s.ok === false)) problems.push(`${where}: шаг с пропуском после «как обычно»`);
    const hero = C.creationCharacter(ix, st, { userId: 'u1' });
    const v = toHeroView({ ...hero.data, id: 'x', ownerId: 'u1' }, { userId: 'u1', gear, spells });
    for (const f of v.features) if (!f.text) problems.push(`${where} без текста: ${f.name}`);
    for (const t of [v.proficiencies.languages, v.proficiencies.tools]) if (ENG.test(t)) problems.push(`${where} лист: ${t}`);
    const done = C.creationDoneModel(ix, st).facts.find((f) => f.label === 'Класс доспеха').value;
    if (done !== String(v.vitals.ac.value)) problems.push(`${where} КД итога ${done}, в листе ${v.vitals.ac.value}`);
    // Магия на 1 уровне — только расовая (заговор высшего эльфа, «Чудотворство» тифлинга), без пустого «Заклинаний пока нет».
    if (['paladin', 'ranger'].includes(cls) && (v.actions.special.some((a) => a.empty) || (v.spellcasting && !v.spellcasting.spells.length))) problems.push(`${where}: пустая магия на 1 уровне`);
  }
  assert.deepEqual(problems, []);
});

test('мастер: пропущенный выбор — «!» у шага, у навыка «уже есть» — откуда он', () => {
  const st = C.newCreation(ix, { campaign, userId: 'u1' });
  C.applyCreationChoice(ix, st, { step: 'race', id: 'half-elf' }); C.applyCreationChoice(ix, st, { step: 'class', id: 'bard' });
  const m = C.creationModel(ix, st);
  assert.equal(m.steps.find((s) => s.id === 'race').ok, false, 'прибавки и навыки полуэльфа не выбраны');
  C.applyCreationChoice(ix, st, { step: 'background', id: m.backgrounds[0].id });
  const fixed = C.creationModel(ix, st).backgroundSkills.list.filter((x) => x.from && x.from !== 'уже есть');
  assert.ok(fixed.length && fixed.every((x) => /^предыстория «Прислужник»$/.test(x.from)), JSON.stringify(fixed));
  assert.ok(!/Сборку проверил/.test(C.creationModel(ix, st).done.note));
});

test('быстрый герой: 20 пар ответов — 20 разных героев, КД с доспехом, навыки по второму ответу', () => {
  const seen = new Map();
  for (const role of ['front', 'range', 'magic', 'heal', 'shadow']) for (const talk of ['fist', 'word', 'trick', 'book']) {
    const st = C.quickCreation(ix, { campaign, userId: 'u1', answers: { role, talk, name: 'Тест' } });
    const d = C.creationDoneModel(ix, st);
    assert.equal(d.status, 'valid', `${role}/${talk}: ${d.missing.join('; ')}`);
    const hero = C.creationCharacter(ix, st, { userId: 'u1' }).data;
    const v = toHeroView({ ...hero, id: 'x', ownerId: 'u1' }, { userId: 'u1', gear });
    assert.equal(d.facts.find((f) => f.label === 'Класс доспеха').value, String(v.vitals.ac.value), `${role}/${talk}: КД итога`);
    seen.set(`${hero.classId}|${hero.raceId}|${Object.keys(hero.proficiencies.skills).sort()}`, `${role}/${talk}`);
    if (role === 'shadow' && talk === 'trick') assert.ok(['deception', 'sleight', 'stealth'].every((k) => hero.proficiencies.skills[k]), 'хитростью: обман, ловкость рук, скрытность');
    if (role === 'front' && talk === 'word') assert.equal(v.vitals.ac.value, 18, 'паладин в кольчуге со щитом');
  }
  assert.equal(seen.size, 20);
});
