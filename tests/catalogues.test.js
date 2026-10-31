import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createCatalogueLoader, validatePublicCatalogue, queryCatalogue, catalogueSnapshot } from '../dist/js/core/catalogues.js';
import { normalizeManualCatalogueData, validateCatalogueEntry, validatePrivateCatalogueEntry } from '../dist/js/rules/catalogue.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url));
const features = JSON.parse(read('dist/js/data/features-2014.json'));
const items = JSON.parse(read('dist/js/data/magic-items-2014.json'));
const manifest = JSON.parse(read('data/features/manifest.json'));
const sourceItems = JSON.parse(read('data/magic-items/magic-items-2014.json'));
const hash = (...parts) => parts.reduce((h, part) => h.update(part), createHash('sha256')).digest('hex');

test('SRD manifest accounts for 709 candidates and all scoped records, with pinned provenance', () => {
  validatePublicCatalogue('feature', features);
  assert.equal(features.entries.length, 371);
  assert.equal(manifest.candidates.length, 709);
  assert.equal(new Set(manifest.candidates.map(c => c.n)).size, 709);
  assert.deepEqual(features.coverage, manifest.coverage);
  assert.deepEqual(features.coverage.byKind, { racial_trait: 92, option: 95, class_feature: 123, subclass_feature: 60, feat: 1 });
  assert.equal(hash(read('data/rules-2014/sources/srd-5.1-cc.pdf')), manifest.source.sha256);
  assert.equal(features.revision, hash(read('data/features/manifest.json'), read('data/features/generate.py'), read('data/features/extract_columns.py'), read('data/features/scopes.json')));
  const ids = new Set(features.entries.map(e => e.id));
  for (const candidate of manifest.candidates) {
    assert.ok(candidate.reason, candidate.name);
    if (['entry', 'body', 'supplement'].includes(candidate.role)) assert.ok(ids.has(candidate.entryId), candidate.name);
  }
  for (const entry of features.entries) {
    assert.ok(entry.name.ru && entry.name.en);
    assert.equal(entry.source.sha256, manifest.source.sha256);
    assert.match(entry.source.url, /#page=\d+$/);
    assert.equal(entry.text.ru, null);
    assert.equal(entry.actionType, null, 'do not infer execution/action type from prose');
    assert.ok(entry.source.spans.length);
  }
  assert.equal(new Set(features.entries.flatMap(e => e.scope.classId || [])).size, 12);
  assert.equal(new Set(features.entries.flatMap(e => e.scope.raceId || [])).size, 9);
});

test('same-name features, subraces and options have independent stable IDs and parents', () => {
  const defenses = features.entries.filter(e => e.name.en === 'Unarmored Defense');
  assert.equal(defenses.length, 2);
  assert.notEqual(defenses[0].id, defenses[1].id);
  const scores = features.entries.filter(e => e.scope.raceId === 'dwarf' && e.name.en === 'Ability Score Increase');
  assert.equal(scores.length, 2);
  assert.notEqual(scores[0].id, scores[1].id);
  const toys = features.entries.filter(e => e.scope.parentId === 'srd51:feature:gnome:rock-gnome:tinker');
  assert.deepEqual(toys.map(e => e.name.en), ['Clockwork Toy', 'Fire Starter', 'Music Box']);
  const modified = structuredClone(features);
  modified.entries.reverse(); modified.entries.forEach(e => { e.name.ru = 'Другое имя'; });
  validatePublicCatalogue('feature', modified);
  assert.deepEqual(new Set(modified.entries.map(e => e.id)), new Set(features.entries.map(e => e.id)));
  modified.entries[0].scope.parentId = modified.entries[0].id;
  assert.throws(() => validatePublicCatalogue('feature', modified), /родитель/);
  const invalidSource = structuredClone(features.entries[0]); invalidSource.source.sha256 = '';
  assert.ok(validateCatalogueEntry('feature', invalidSource).errors.some(e => e.path === 'source'));
});

test('column continuations, tables and related mechanical sidebars survive extraction', () => {
  const get = id => features.entries.find(e => e.id === id);
  assert.match(get('srd51:feature:dragonborn:draconic-ancestry').text.en, /Black Acid 5 by 30 ft\. line/);
  assert.match(get('srd51:feature:dragonborn:draconic-ancestry').text.en, /White Cold 15 ft\. cone/);
  assert.match(get('srd51:feature:druid:druidic').text.en, /DC 15 Wisdom/);
  assert.match(get('srd51:feature:druid:wild-shape').text.en, /Beast Shapes/);
  assert.match(get('srd51:feature:cleric:spellcasting').text.en, /As a conduit for divine power/);
  assert.match(get('srd51:feature:wizard:spellcasting').text.en, /Copying a Spell into the Book/);
  assert.match(get('srd51:feature:wizard:spellcasting').text.en, /50 gp/);
  assert.match(get('srd51:feature:wizard:spellcasting').text.en, /Replacing the Book/);
  assert.match(get('srd51:feature:wizard:spellcasting').text.en, /The Book’s Appearance/);
  assert.match(get('srd51:feature:warlock:pact-boon').text.en, /Your Pact Boon/);
  assert.equal(get('srd51:feature:warlock:repelling-blast').prerequisiteText, 'eldritch blast cantrip');
  assert.equal(get('srd51:feature:feats:grappler').prerequisiteText, 'Strength 13 or higher');
  assert.equal(get('srd51:feature:barbarian:rage').level, null);
  assert.equal(features.entries.filter(e => e.level !== null).length, 137);
});

test('item projection preserves 934 original IDs/all fields, 221 SRD/713 metadata and 98 variants', () => {
  validatePublicCatalogue('magic_item', items);
  assert.deepEqual(items.coverage, { entries: 934, srd: 221, metadata: 713, variants: 98 });
  assert.equal(items.revision, hash(read('data/magic-items/magic-items-2014.json'), read('data/catalogues/generate_items.mjs')));
  items.entries.forEach((entry, i) => {
    const { source, ...original } = entry;
    assert.deepEqual(original, sourceItems.items[i]);
    if (source.kind === 'metadata') {
      assert.equal(entry.description.en, null);
      assert.equal(entry.description.ru, null);
      assert.deepEqual(entry.variants, []);
    }
  });
  assert.equal(items.entries[0].technical.weight, null);
  assert.equal(items.entries[0].attunement.required, false);
});

test('public loader is lazy, deduplicates, returns immutable entries and retries failures', async () => {
  let calls = 0, fail = true;
  const loader = createCatalogueLoader({ fetcher: async (url, options) => {
    calls++; assert.equal(options.credentials, 'omit');
    if (fail) throw new Error('offline');
    return { ok: true, json: async () => structuredClone(features) };
  } });
  assert.equal(calls, 0);
  await assert.rejects(loader.load('feature'), /offline/);
  fail = false;
  const [a, b] = await Promise.all([loader.load('feature'), loader.load('feature')]);
  assert.equal(calls, 2); assert.equal(a, b);
  assert.throws(() => { a.entries[0].name.ru = 'overwrite'; }, TypeError);
  assert.equal(await loader.load('feature'), a); assert.equal(calls, 2);
  const empty = createCatalogueLoader({ fetcher: async () => ({ ok: true, json: async () => ({ ...features, entries: [], coverage: { entries: 0 } }) }) });
  assert.deepEqual(queryCatalogue(await empty.load('feature')), []);
  const broken = createCatalogueLoader({ fetcher: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(broken.load('feature'), /503/);
});

test('invalidation during a public request cannot replace a newer cached revision', async () => {
  let finish, first = true;
  const loader = createCatalogueLoader({ fetcher: async () => {
    if (first) { first = false; return new Promise(resolve => { finish = resolve; }); }
    return { ok: true, json: async () => ({ ...features, revision: 'a'.repeat(64) }) };
  } });
  const old = loader.load('feature'); loader.invalidate('feature');
  const current = await loader.load('feature');
  finish({ ok: true, json: async () => structuredClone(features) }); await old;
  assert.equal((await loader.load('feature')).revision, current.revision);
});

test('search and combined filters support RU/EN/ё without modifying names or unknown values', () => {
  const darkvision = queryCatalogue(features, { query: 'ТЕМНОЕ ЗРЕНИЕ', raceId: 'elf', kind: 'racial_trait' });
  assert.equal(darkvision.length, 1); assert.equal(darkvision[0].name.ru, 'Тёмное зрение');
  assert.equal(queryCatalogue(features, { query: 'Archery', classId: 'fighter', kind: 'option' }).length, 1);
  assert.equal(queryCatalogue(items, { source: 'metadata', hasDescription: false }).length, 713);
  assert.equal(queryCatalogue(items, { source: 'srd2014', hasDescription: true }).length, 221);
  assert.ok(queryCatalogue(items, { type: 'armor', rarity: 'uncommon', attunement: false }).some(e => e.id === 'dndsu:item:1'));
  assert.equal(queryCatalogue(features).length, 371);
});

test('snapshots are detached, require exact variants and never execute or mutate a sheet', () => {
  const source = items.entries.find(e => e.variants.length);
  assert.throws(() => catalogueSnapshot(items, source.id), /вариант/);
  assert.throws(() => catalogueSnapshot(items, source.id, { variantId: 'invented' }), /вариант/);
  const variant = source.variants[0];
  const a = catalogueSnapshot(items, source.id, { variantId: variant.srd_index });
  assert.equal(a.catalogueRef.id, source.id);
  assert.equal(a.catalogueRef.variantId, variant.srd_index);
  assert.equal(a.catalogueRef.revision, items.revision);
  a.data.selectedVariant.technical.bonuses.push({ fake: true });
  assert.deepEqual(source.variants[0].technical.bonuses, []);
  assert.equal(a.data.equipped, undefined); assert.equal(a.data.attuned, undefined);
  assert.throws(() => catalogueSnapshot(features, 'missing'), /не найдена/);
});

test('typed private validation preserves JSON/null/zero and reports invalid fields/UTF-8 limit', () => {
  const data = normalizeManualCatalogueData('feature', { name: { ru: 'Личное' }, text: { ru: 'Только владелец' }, custom: { charges: 0 } });
  const record = { id: 'own', ownerId: 'user-a', kind: 'feature', data, revision: 0 };
  assert.equal(validatePrivateCatalogueEntry(record).valid, true);
  assert.equal(data.level, null); assert.equal(data.custom.charges, 0);
  const invalid = structuredClone(record); invalid.data.actionType = 'guess';
  assert.ok(validatePrivateCatalogueEntry(invalid).errors.some(e => e.path === 'data.actionType'));
  assert.equal(validatePrivateCatalogueEntry({ ...record, data: { ...data, secret: NaN } }).valid, false);
  assert.equal(validatePrivateCatalogueEntry({ ...record, data: { ...data, secret: undefined } }).valid, false);
  const arr = []; arr.extra = 1;
  assert.equal(validatePrivateCatalogueEntry({ ...record, data: { ...data, arr } }).valid, false);
  assert.throws(() => normalizeManualCatalogueData('magic_item', { technical: 0 }), e => e.errors[0].path === 'technical');
  const size = new TextEncoder().encode(JSON.stringify({ ...data, notes: '' })).length;
  const edge = { ...data, notes: 'a'.repeat(65536 - size) };
  assert.equal(validatePrivateCatalogueEntry({ ...record, data: edge }).valid, true);
  assert.equal(validatePrivateCatalogueEntry({ ...record, data: { ...edge, notes: edge.notes + 'я' } }).valid, false);
  assert.equal(validateCatalogueEntry('feature', data).valid, false, 'manual data cannot enter the public cache');
  const original = { name: { ru: 'Предмет' }, source: { kind: 'manual' }, description: { ru: 'Текст', en: ['Original'] }, technical: { bonuses: [] } };
  const detached = normalizeManualCatalogueData('magic_item', original);
  detached.source.kind = 'changed'; detached.description.en.push('changed'); detached.technical.bonuses.push({ changed: true });
  assert.equal(original.source.kind, 'manual'); assert.deepEqual(original.description.en, ['Original']); assert.deepEqual(original.technical.bonuses, []);
});

test('published handoff examples stay aligned with real envelopes and typed manual data', () => {
  const example = JSON.parse(read('docs/examples/catalogues.json'));
  assert.deepEqual(example.publicFeaturePreview, catalogueSnapshot(features, example.publicFeaturePreview.catalogueRef.id));
  assert.deepEqual(example.normalizedManualData, normalizeManualCatalogueData(example.manualInput.kind, example.manualInput.data));
  assert.equal(validatePrivateCatalogueEntry(example.acknowledgedManualRecord).valid, true);
  assert.equal(example.privatePreview.catalogueRef.revision, '1');
  assert.equal(example.publicMetadataItem.source.kind, 'metadata');
});
