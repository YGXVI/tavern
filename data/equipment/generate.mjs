// TASK-186 P1b: public equipment projection parsed from the stored SRD 5.1 text (no network).
// Run: node data/equipment/generate.mjs  (byte-identical on repeat).
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateEquipmentEntry } from '../../dist/js/rules/equipment.js';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const OUTPUT = 'dist/js/data/equipment-2014.json';
const CP = { cp: 1, sp: 10, gp: 100 };
// PDF extraction artifacts: U+2010 hyphen and doubled hyphens.
const clean = text => text.replace(/[‐‑]/g, '-').replace(/-{2,}/g, '-').replace(/\s+/g, ' ').trim();
export const slug = name => clean(name).replace(/\s*\([^)]*\)/g, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const cost = (value, unit) => { const v = Number(value.replace(/,/g, '')); return { value: v, unit, cp: v * CP[unit] }; };
function weight(text) {
  if (text === '—') return null;
  const m = text.match(/^(\d+)?(½)?(?:(\d+)\/(\d+))? ?lb\.( \(full\))?$/);
  if (!m) throw new Error(`Unparsed weight ${text}`);
  const lb = (m[1] ? Number(m[1]) : 0) + (m[2] ? 0.5 : 0) + (m[3] ? Number(m[3]) / Number(m[4]) : 0);
  return m[5] ? { lb, note: 'full' } : { lb };
}
const detail = name => { const m = clean(name).match(/\(([^)]*)\)\s*$/); return m ? m[1] : null; };
const bundleSize = d => { const m = d?.match(/^(?:bag of )?([\d,]+)$/); return m ? Number(m[1].replace(/,/g, '')) : null; };

export function buildEquipment() {
  const srdBytes = read('data/rules-2014/srd-5.1.json'), sourceBytes = read('data/equipment/srd51.json'), generatorBytes = readFileSync(fileURLToPath(import.meta.url));
  const srd = JSON.parse(srdBytes), src = JSON.parse(sourceBytes), corpus = srd.source;
  const vocab = JSON.parse(read('data/character-options/srd51.json')).vocabularies;
  const lines = n => srd.pages[n - 1].layout_text.split('\n');
  const source = pages => ({ kind: 'srd51', documentId: corpus.id, sha256: corpus.sha256, pages, url: `${corpus.url}#page=${pages[0]}`, license: corpus.license });
  const entries = new Map();
  const put = e => { if (entries.has(e.id)) throw new Error(`Duplicate equipment ${e.id}`); const r = validateEquipmentEntry(e); if (!r.valid) throw new Error(`${e.id}: ${JSON.stringify(r.errors)}`); entries.set(e.id, e); };
  const base = (name, page, extra = {}) => {
    const d = detail(name), size = bundleSize(d);
    return { id: `srd51:equipment:${extra.prefix ? `${extra.prefix}-` : ''}${slug(name)}`, kind: 'gear', name: { ru: null, en: clean(name).replace(/\s*\([^)]*\)\s*$/, '') }, ...(d ? { detail: d } : {}), ...(size ? { bundleSize: size } : {}), cost: null, weight: null, source: source([page]) };
  };

  // Armor: pages 63 (Padded) and 64; category comes from the preceding header line.
  let category = null;
  for (const [page, line] of [63, 64].flatMap(n => lines(n).map(l => [n, l]))) {
    const header = line.match(/^(Light|Medium|Heavy) Armor\s*$|^Shield\s*$/);
    if (header) { category = header[1]?.toLowerCase() || 'shield'; continue; }
    const m = line.match(/^ {2}(\S.*?)\s+([\d,]+) gp\s+(\+?\d+)( \+ Dex modifier)?( \(max 2\))?\s+(Str \d+|—)\s+(Disadvantage|—)\s+(\d+ lb\.)/);
    if (!m || !category) continue;
    put({ ...base(m[1], page), kind: category === 'shield' ? 'shield' : 'armor', cost: cost(m[2], 'gp'), weight: weight(m[8]),
      armor: { category, baseAc: Number(m[3]), addDex: Boolean(m[4]), dexMax: m[5] ? 2 : null, strength: m[6] === '—' ? null : Number(m[6].slice(4)), stealthDisadvantage: m[7] === 'Disadvantage' } });
  }
  // Weapons: the table header is on page 65, rows on page 66, one row per line.
  let group = null;
  for (const line of [65, 66].flatMap(lines)) {
    const header = line.match(/^(Simple|Martial) (Melee|Ranged) Weapons\s*$/);
    if (header) { group = { category: header[1].toLowerCase(), range: header[2].toLowerCase() }; continue; }
    const m = line.match(/^ {2}(\S.*?)\s+([\d,]+) (gp|sp|cp)\s+(\d+d\d+ \w+|\d+ \w+|—)\s+([\d/½]+ lb\.|—)\s+(.+)$/);
    if (!m || !group) continue;
    const props = m[6].trim() === '—' ? [] : clean(m[6]).split(/,\s*(?![^()]*\))/).map(s => s.trim().toLowerCase());
    const range = props.map(p => p.match(/\(range (\d+)\/(\d+)\)/)).find(Boolean), versatile = props.map(p => p.match(/^versatile \((\d+d\d+)\)/)).find(Boolean);
    const [dice, type] = m[4] === '—' ? [] : m[4].split(' ');
    put({ ...base(m[1], 66), kind: 'weapon', cost: cost(m[2], m[3]), weight: weight(m[5]),
      weapon: { ...group, damage: dice ? { dice, type } : null, properties: props.map(p => p.replace(/ \(.*\)$/, '')), normalRange: range ? Number(range[1]) : null, longRange: range ? Number(range[2]) : null, versatileDice: versatile ? versatile[1] : null } });
  }
  // Adventuring gear: page 69, two table columns split at character 50; groups only in the left column.
  const GROUPS = { Ammunition: ['ammunition', null], 'Arcane focus': ['focus', 'arcane-focus'], 'Druidic focus': ['focus', 'druidic-focus'], 'Holy symbol': ['focus', 'holy-symbol'] };
  const ROW = /^(\s*)(\S.*?)\s+([\d,]+) (gp|sp|cp)\s+(\d[\d½/,]*\s?lb\.(?: \(full\))?|—)\s*$/;
  let gearGroup = null;
  for (const line of lines(69)) for (const [part, column] of [[line.slice(0, 50), 0], [line.slice(50), 1]]) {
    if (!part.trim()) continue;
    if (column === 0 && GROUPS[part.trim()] && !/^\s/.test(part)) { gearGroup = GROUPS[part.trim()]; continue; }
    const m = part.match(ROW);
    if (!m) continue;
    const inGroup = column === 0 && m[1].length >= 2 && gearGroup;
    if (column === 0 && !inGroup) gearGroup = null;
    const [kind, prefix] = inGroup ? gearGroup : ['gear', null];
    put({ ...base(m[2], 69, { prefix }), kind, ...(prefix ? { group: prefix } : {}), cost: cost(m[3], m[4]), weight: weight(m[5]) });
  }
  // Tools: page 70, known names only (the table column shares lines with prose).
  const TOOL_GROUPS = [['artisan', vocab.tools.artisan], ['musical-instrument', vocab.tools.musical_instrument],
    ['gaming-set', { 'dice-set': 'Dice set', 'playing-card-set': 'Playing card set' }],
    ['kit', { 'disguise-kit': 'Disguise kit', 'forgery-kit': 'Forgery kit', 'herbalism-kit': 'Herbalism kit', 'navigators-tools': 'Navigator’s tools', 'poisoners-kit': 'Poisoner’s kit', 'thieves-tools': 'Thieves’ tools' }]];
  const text70 = lines(70).join('\n');
  for (const [toolGroup, names] of TOOL_GROUPS) for (const [id, name] of Object.entries(names)) {
    const m = text70.match(new RegExp(`${name.replace(/[’']/g, '[’\']')}\\s+([\\d,]+) (gp|sp|cp)\\s+([\\d½/]+ lb\\.|—)`));
    if (!m) throw new Error(`Tool row not found: ${name}`);
    const e = { ...base(name, 70), kind: 'tool', group: toolGroup, cost: cost(m[1], m[2]), weight: weight(m[3]) };
    if (e.id !== `srd51:equipment:${id}`) throw new Error(`Tool slug ${e.id} != ${id}`);
    put(e);
  }
  for (const [id, item] of Object.entries(src.unpricedItems)) put({ ...base(item.name, item.page), id: `srd51:equipment:${id}`, review: { required: true, reasons: ['No price/weight row in the SRD table; named in pack or background text only.'] } });
  for (const [id, pack] of Object.entries(src.packs)) {
    const contents = pack.contents.map(([ref, quantity]) => ({ ref: `srd51:equipment:${ref}`, quantity }));
    for (const c of contents) if (!entries.has(c.ref)) throw new Error(`${id}: unknown content ${c.ref}`);
    put({ ...base(pack.name, 70), id: `srd51:equipment:${id}`, kind: 'pack', cost: cost(String(pack.cost), 'gp'), weight: null, contents });
  }
  const list = [...entries.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const e of list) e.review ??= { required: false, reasons: [] };
  const byKind = {};
  for (const e of list) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  return {
    schemaVersion: 1, catalogueKind: 'equipment', edition: '5e-2014', revision: sha(Buffer.concat([srdBytes, sourceBytes, generatorBytes])),
    sourceHashes: { srd: sha(srdBytes), source: sha(sourceBytes), generator: sha(generatorBytes), pdf: corpus.sha256 },
    attribution: corpus.attribution, sources: [corpus.url],
    coverage: { entries: list.length, byKind, russianNames: 0, unpriced: list.filter(e => e.review.required).length },
    limitations: ['SRD 5.1 equipment tables only (armor, weapons, adventuring gear, tools, equipment packs); mounts, vehicles, trade goods, services and magic items are out of scope.',
      'Russian names are not provided yet (name.ru=null); show the English name.', 'Costs keep the source unit; cp is the exact copper value. No rounding.'],
    entries: list,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = buildEquipment();
  writeFileSync(new URL(OUTPUT, root), JSON.stringify(result) + '\n');
  console.log(JSON.stringify({ revision: result.revision, ...result.coverage }));
}
