import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { normalizeManualCatalogueData } from '../../dist/js/rules/catalogue.js';
import { catalogueSnapshot } from '../../dist/js/core/catalogues.js';
import { privateCatalogueSnapshot } from '../../dist/js/core/catalogue-library.js';

const features = JSON.parse(readFileSync(new URL('../../dist/js/data/features-2014.json', import.meta.url)));
const items = JSON.parse(readFileSync(new URL('../../dist/js/data/magic-items-2014.json', import.meta.url)));
const input = { kind: 'feature', data: { name: { ru: 'Личная находчивость' }, text: { ru: 'Собственное описание мастера. Эффект применяется вручную.' } } };
const data = normalizeManualCatalogueData(input.kind, input.data);
const saved = { id: 'cat-example', ownerId: '00000000-0000-0000-0000-00000000000a', kind: input.kind, data, revision: 1, updatedAt: 0 };
const examples = {
  schemaVersion: 1,
  publicFeaturePreview: catalogueSnapshot(features, 'srd51:feature:elf:high-elf:cantrip'),
  publicOptionPreview: catalogueSnapshot(features, 'srd51:feature:dragonborn:draconic-ancestry:black'),
  publicMetadataItem: items.entries.find(e => e.source.kind === 'metadata'),
  manualInput: input, normalizedManualData: data, acknowledgedManualRecord: saved,
  privatePreview: privateCatalogueSnapshot(saved),
};
mkdirSync(new URL('../../docs/examples/', import.meta.url), { recursive: true });
writeFileSync(new URL('../../docs/examples/catalogues.json', import.meta.url), JSON.stringify(examples, null, 2) + '\n');
