// TASK-186 P1/P2 (plan r1 task 2.5): compact public spell projection for the character builder.
// Run: node data/spells/projection.mjs  (no network; byte-identical on repeat). Spell IDs are unchanged.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const OUTPUT = 'dist/js/data/spells-2014.json';
// SRD 5.1 drops proper names from 11 spells, so their SRD API index has no catalogue link.
// Each alias is an explicit reviewed pair (same level, school and ritual flag, checked below), never a fuzzy match.
export const SRD_ALIASES = Object.freeze({
  'arcanists-magic-aura': 'dndsu:spell:188', // Nystul's magic aura — SRD renames the owner to "Arcanist"
  'floating-disk': 'dndsu:spell:346', 'hideous-laughter': 'dndsu:spell:79', 'instant-summons': 'dndsu:spell:68',
  'irresistible-dance': 'dndsu:spell:187', 'magnificent-mansion': 'dndsu:spell:16', 'private-sanctum': 'dndsu:spell:128',
  'resilient-sphere': 'dndsu:spell:216', 'secret-chest': 'dndsu:spell:142', 'telepathic-bond': 'dndsu:spell:160', 'tiny-hut': 'dndsu:spell:143',
});

export function buildSpellProjection() {
  const catalogueBytes = read('data/spells/spells-2014.json'), srdBytes = read('modules/spell-damage/srd-2014.json'), generatorBytes = readFileSync(fileURLToPath(import.meta.url));
  const catalogue = JSON.parse(catalogueBytes), srd = JSON.parse(srdBytes).spells;
  const byId = new Map(catalogue.spells.map(s => [s.id, s]));
  const srdIndex = new Map();
  for (const s of catalogue.spells) {
    const index = s.sources?.srd_api?.replace(/\/$/, '').split('/').pop();
    if (index) srdIndex.set(s.id, { index, via: 'srd_api' });
  }
  for (const [index, id] of Object.entries(SRD_ALIASES)) {
    const s = byId.get(id), ref = srd.find(x => x.index === index);
    if (!s || !ref || srdIndex.has(id)) throw new Error(`Bad SRD alias ${index}`);
    if (s.level !== ref.level || s.school.code !== ref.school.index || s.ritual !== ref.ritual) throw new Error(`Alias ${index} differs from ${id}`);
    srdIndex.set(id, { index, via: 'alias' });
  }
  const indexes = new Set([...srdIndex.values()].map(x => x.index));
  const missing = srd.filter(x => !indexes.has(x.index)).map(x => x.index);
  if (missing.length) throw new Error(`SRD spells without a catalogue record: ${missing.join(', ')}`);
  const entries = catalogue.spells.map(s => ({
    id: s.id, name: { ru: s.name.ru, en: s.name.en }, level: s.level, school: s.school.code, ritual: s.ritual,
    concentration: s.duration?.concentration ?? null,
    classes: { base: s.classes.base.map(c => c.id), tceOptional: s.classes.tce_optional.map(c => c.id) },
    srd: srdIndex.get(s.id) ?? null,
    publications: s.sources.publications.map(p => p.id),
  })).sort((a, b) => Number(a.id.split(':')[2]) - Number(b.id.split(':')[2]));
  return {
    schemaVersion: 1, catalogueKind: 'spell', edition: '5e-2014', revision: sha(Buffer.concat([catalogueBytes, srdBytes, generatorBytes])),
    sourceHashes: { catalogue: sha(catalogueBytes), srd: sha(srdBytes), generator: sha(generatorBytes) },
    attribution: catalogue.attribution, sources: ['data/spells/spells-2014.json', 'modules/spell-damage/srd-2014.json'],
    coverage: { entries: entries.length, srd: entries.filter(e => e.srd).length, srdViaAlias: entries.filter(e => e.srd?.via === 'alias').length },
    limitations: ['Metadata only: no spell text. `srd` marks the 319 SRD 5.1 spells (308 by API link, 11 by reviewed alias); others need a source enabled by the campaign.',
      'Class lists keep base and Tasha’s optional lists apart; the builder uses base lists unless a campaign enables the option.'],
    entries,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = buildSpellProjection();
  writeFileSync(new URL(OUTPUT, root), JSON.stringify(result) + '\n');
  console.log(JSON.stringify({ revision: result.revision, ...result.coverage }));
}
