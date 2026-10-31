// Offline projection; never changes the source JSON/SQLite or fetches content.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validatePublicCatalogue } from '../../dist/js/core/catalogues.js';

const sourceUrl = new URL('../magic-items/magic-items-2014.json', import.meta.url);
const input = readFileSync(sourceUrl);
const generator = readFileSync(new URL(import.meta.url));
const source = JSON.parse(input);
const counts = { srd: 0, metadata: 0, variants: 0 };
const entries = source.items.map(item => {
  const entry = structuredClone(item);
  const isSrd = Boolean(item.srd_details?.srd_index && item.sources.srd_api);
  entry.source = { kind: isSrd ? 'srd2014' : 'metadata' };
  if (!isSrd && (entry.description.en?.length || entry.description.ru || entry.variants.length)) throw new Error(`Unexpected non-SRD prose: ${entry.id}`);
  counts[isSrd ? 'srd' : 'metadata']++;
  counts.variants += entry.variants.length;
  return entry;
});
if (entries.length !== 934 || counts.srd !== 221 || counts.metadata !== 713 || counts.variants !== 98) throw new Error('Source coverage changed; review before publishing.');
const result = {
  schemaVersion: 1, catalogueKind: 'magic_item', edition: '5e-2014',
  revision: createHash('sha256').update(input).update(generator).digest('hex'),
  sourceHashes: { source: createHash('sha256').update(input).digest('hex'), generator: createHash('sha256').update(generator).digest('hex') },
  attribution: source.attribution, sources: source.sources,
  coverage: { entries: entries.length, ...counts }, entries,
};
validatePublicCatalogue('magic_item', result);
writeFileSync(new URL('../../dist/js/data/magic-items-2014.json', import.meta.url), JSON.stringify(result) + '\n');
console.log(JSON.stringify(result.coverage));
