// TASK-186 P1: expand the reviewed SRD 5.1 source into the public character_option catalogue.
// Run: node data/character-options/generate.mjs  (no network; byte-identical on repeat).
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateCharacterOption, resolveCharacterOptionRefs } from '../../dist/js/rules/character-options.js';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const SOURCE = 'data/character-options/srd51.json', OUTPUT = 'dist/js/data/character-options-2014.json';

export function buildCharacterOptions() {
  const sourceBytes = read(SOURCE), generatorBytes = readFileSync(fileURLToPath(import.meta.url));
  const featureBytes = read('dist/js/data/features-2014.json'), spellBytes = read('data/spells/spells-2014.json');
  const src = JSON.parse(sourceBytes), features = JSON.parse(featureBytes), spells = JSON.parse(spellBytes).spells;
  const corpus = JSON.parse(read('data/rules-2014/srd-5.1.json')).source;
  const featureIds = new Set(features.entries.map(e => e.id));
  const spellBySrd = new Map();
  for (const s of spells) {
    const index = s.sources?.srd_api?.replace(/\/$/, '').split('/').pop();
    if (index) { if (spellBySrd.has(index)) throw new Error(`Duplicate SRD spell index ${index}`); spellBySrd.set(index, s.id); }
  }
  const spellRef = index => { const id = spellBySrd.get(index); if (!id) throw new Error(`Unmapped SRD spell ${index}`); return id; };
  const equipmentBytes = read('dist/js/data/equipment-2014.json'), equipment = JSON.parse(equipmentBytes);
  const equipmentIds = new Set(equipment.entries.map(e => e.id));
  // "2 handaxe", "any:weapon:martial:melee", "warhammer !weapon:warhammer" → {ref|filter, quantity}, requiresProficiency.
  function item(token) {
    const [body, need] = token.split(' !'), m = body.match(/^(?:(\d+) )?(.+)$/), quantity = Number(m[1] || 1);
    let out;
    if (m[2].startsWith('any:')) {
      const [spec, except] = m[2].slice(4).split('~'), [kind, a, b] = spec.split(':');
      const exclude = except ? { exclude: [`srd51:equipment:${except}`] } : {};
      out = { filter: kind === 'weapon' ? { kind, category: a, ...(b ? { range: b } : {}), ...exclude } : { kind, group: a, ...exclude }, quantity };
    } else {
      const ref = `srd51:equipment:${m[2]}`;
      if (!equipmentIds.has(ref)) throw new Error(`Unknown equipment ${m[2]}`);
      out = { ref, quantity };
    }
    return need ? [out, { category: need.split(':')[0], value: need.split(':')[1] }] : [out, null];
  }
  function equipmentOf(owner, spec) {
    const grants = [], choices = [];
    spec.fixed.forEach((token, i) => { const [it] = item(token); grants.push({ id: `${owner}:item:${i + 1}`, kind: 'item', ...it }); });
    if (spec.currency) for (const [unit, value] of Object.entries(spec.currency)) grants.push({ id: `${owner}:currency:${unit}`, kind: 'currency', unit, value });
    spec.choices.forEach((alts, i) => choices.push({ id: `${owner}:equipment:${i + 1}`, kind: 'equipment', count: 1, distinct: true,
      alternatives: alts.map((tokens, j) => {
        const parsed = tokens.map(item), need = parsed.find(([, n]) => n)?.[1];
        return { id: String.fromCharCode(97 + j), items: parsed.map(([it]) => it), ...(need ? { requiresProficiency: need } : {}) };
      }) }));
    return { grants, choices };
  }
  const feature = ref => `srd51:feature:${ref}`;
  const source = (pages) => ({ kind: 'srd51', documentId: corpus.id, sha256: corpus.sha256, pages, url: `${corpus.url}#page=${pages[0]}`, license: corpus.license });
  const range = (a, b = a) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const review = (reasons = []) => ({ required: reasons.length > 0, reasons });
  const allSkills = src.skills;
  const vocab = src.vocabularies;
  const toolsOf = category => category === 'artisan_or_musical_instrument'
    ? [...Object.keys(vocab.tools.artisan), ...Object.keys(vocab.tools.musical_instrument)]
    : Object.keys(vocab.tools[category]);
  const allLanguages = [...Object.keys(vocab.languages.standard), ...Object.keys(vocab.languages.exotic)];
  const optionsOf = parent => features.entries.filter(e => e.kind === 'option' && e.scope.parentId === feature(parent)).map(e => e.id).sort();
  const classId = c => `srd51:class:${c}`;

  function choice(owner, spec, extra = {}) {
    const c = { id: `${owner}:${spec.slug}`, kind: spec.kind, count: spec.count };
    if (spec.parent) c.options = optionsOf(spec.parent);
    else if (spec.options) c.options = [...spec.options];
    else if (spec.kind === 'skill') c.options = spec.any ? [...allSkills] : [...spec.from];
    else if (spec.kind === 'tool') c.options = toolsOf(spec.category);
    else if (spec.kind === 'language') c.options = allLanguages;
    else if (spec.kind === 'favored_enemy') c.options = Object.keys(vocab.favoredEnemies.types);
    else if (spec.kind === 'terrain') c.options = Object.keys(vocab.terrains.types);
    else if (spec.kind === 'ability_increase') c.options = ['str', 'dex', 'con', 'int', 'wis', 'cha'].filter(a => !(spec.exclude || []).includes(a));
    else if (spec.kind === 'expertise') c.from = spec.from;
    else if (spec.spellFilter) c.spellFilter = spec.spellFilter;
    if (spec.kind === 'spell' && !c.spellFilter) c.spellFilter = spec.spellFilter;
    if (spec.value !== undefined) c.value = spec.value;
    if (spec.ability) c.ability = spec.ability;
    if (spec.optional) c.optional = true;
    if (spec.featureRef) c.featureRef = feature(spec.featureRef);
    c.distinct = true;
    return Object.assign(c, extra);
  }
  const prof = (owner, category, values) => values.map(value => ({ id: `${owner}:proficiency:${category}:${value}`, kind: 'proficiency', category, value }));
  const extraGrant = (owner, g, i) => ({ id: `${owner}:${g.kind}:${g.ability || g.value || g.category || i}`, ...g });

  const entries = [];
  for (const [cid, c] of Object.entries(src.classes)) {
    const id = classId(cid), scope = features.scopes.classes[cid];
    const slots = c.spellcasting?.slots === 'full' || c.spellcasting?.slots === 'half' ? src.slotTables[c.spellcasting.slots] : null;
    const levelsWithSubclassFeature = new Set(c.subclass.featureLevels);
    const featureRefs = new Set();
    let previousInvocations = 0;
    const progression = range(1, 20).map(level => {
      const owner = `${id}:L${level}`, grants = [], choices = [], values = {};
      c.columns.forEach((col, i) => { values[col.id] = c.values[level - 1][i]; });
      for (const ref of c.features[level] || []) { grants.push({ id: `${owner}:feature:${ref}`, kind: 'feature', ref: feature(`${cid}:${ref}`) }); featureRefs.add(feature(`${cid}:${ref}`)); }
      (c.grantsAt?.[level] || []).forEach((g, i) => grants.push(extraGrant(owner, g, i)));
      if (c.asi.includes(level)) {
        const ref = feature(`${cid}:ability-score-improvement`); featureRefs.add(ref);
        grants.push({ id: `${owner}:feature:ability-score-improvement`, kind: 'feature', ref });
        choices.push({ id: `${owner}:asi`, kind: 'asi_or_feat', count: 1, options: ['asi:+2', 'asi:+1+1', 'feat'], featureRef: ref, distinct: true, featPrerequisites: { sourceEnabled: 'rule:feats' }, maximumScore: 20 });
      }
      if (level === c.subclass.level) choices.push({ id: `${owner}:subclass`, kind: 'subclass', count: 1, options: Object.keys(src.subclasses).filter(k => k.startsWith(`${cid}:`)).map(k => `srd51:subclass:${k}`), featureRef: feature(c.subclass.featureRef), distinct: true });
      (c.choicesAt?.[level] || []).forEach(spec => choices.push(choice(owner, spec)));
      if (c.invocationsFromColumn) {
        const known = values[c.invocationsFromColumn] ?? 0;
        if (known > previousInvocations) choices.push({ id: `${owner}:eldritch-invocations`, kind: 'feature_option', count: known - previousInvocations, options: optionsOf('warlock:eldritch-invocations'), featureRef: feature('warlock:eldritch-invocations'), distinct: true, replacementPolicy: 'one_per_level' });
        previousInvocations = known;
      }
      const row = { level, proficiencyBonus: Math.ceil(level / 4) + 1, values, spellSlots: slots ? [...slots[level - 1], ...Array(9 - slots[level - 1].length).fill(0)] : null, subclassFeature: levelsWithSubclassFeature.has(level) && level !== c.subclass.level, grants, choices };
      return row;
    });
    const grants = [
      ...prof(id, 'saving_throw', c.savingThrows), ...prof(id, 'armor', c.armor), ...prof(id, 'weapon', c.weapons), ...prof(id, 'tool', c.tools),
    ];
    const choices = [choice(id, { slug: 'skills', kind: 'skill', ...c.skills }), ...(c.toolChoices || []).map(spec => choice(id, spec))];
    const startingEquipment = equipmentOf(`${id}:starting`, c.equipment);
    const mc = c.multiclass, mcOwner = `${id}:multiclass`;
    const multiclass = {
      prerequisites: mc.prerequisites,
      grants: [...prof(mcOwner, 'armor', mc.armor || []), ...prof(mcOwner, 'weapon', mc.weapons || []), ...prof(mcOwner, 'tool', mc.tools || [])],
      choices: [
        ...(mc.skillCount ? [choice(mcOwner, { slug: 'skill', kind: 'skill', count: mc.skillCount, ...(mc.skillsAny ? { any: true } : { from: c.skills.from }) })] : []),
        ...(mc.toolCount ? [choice(mcOwner, { slug: 'tool', kind: 'tool', count: mc.toolCount, category: mc.toolCategory })] : []),
      ],
    };
    entries.push({
      id, kind: 'class', name: { ru: scope.ru, en: scope.en }, aliases: [cid], source: source(range(...c.pages)), review: review(),
      featureRefs: [...featureRefs].sort(), grants, choices,
      // Only for the first class (level 1); a multiclass level never brings starting equipment.
      startingEquipment,
      class: { hitDie: c.hitDie, savingThrows: c.savingThrows, armorNote: c.armorNote ?? null, spellcasting: c.spellcasting ? { ...c.spellcasting, listRef: null } : null,
        subclassLevel: c.subclass.level, subclassFeatureLevels: c.subclass.featureLevels, asiLevels: c.asi, columns: c.columns, multiclass },
      progression,
    });
  }

  // Spell list crosswalk: only proven dndsu class IDs (from spells-2014.json name_ru == scope.ru).
  const listIds = new Map();
  for (const s of spells) for (const k of s.classes.base) listIds.set(k.name_ru, k.id);
  for (const e of entries) if (e.class.spellcasting) {
    e.class.spellcasting.listRef = listIds.get(e.name.ru) ?? null;
    if (!e.class.spellcasting.listRef) throw new Error(`No spell list for ${e.id}`);
    e.aliases.push(e.class.spellcasting.listRef);
  }

  for (const [key, sc] of Object.entries(src.subclasses)) {
    const [cid] = key.split(':'), id = `srd51:subclass:${key}`, cls = src.classes[cid], scope = features.scopes.subclasses[key];
    const featureRefs = new Set();
    const progression = range(1, 20).map(level => {
      const owner = `${id}:L${level}`, grants = [], choices = [];
      if (level === cls.subclass.level) { const ref = feature(`${cid}:${sc.option}`); grants.push({ id: `${owner}:feature:option`, kind: 'feature', ref }); featureRefs.add(ref); }
      for (const ref of sc.features[level] || []) { const full = feature(`${key}:${ref}`); grants.push({ id: `${owner}:feature:${ref}`, kind: 'feature', ref: full }); featureRefs.add(full); }
      (sc.grantsAt?.[level] || []).forEach((g, i) => grants.push(extraGrant(owner, g, i)));
      (sc.choicesAt?.[level] || []).forEach(spec => choices.push(choice(owner, spec)));
      return { level, grants, choices };
    });
    if (sc.spellList) for (const [lvl, list] of Object.entries(sc.spellList.spells)) for (const index of list) {
      const n = Number(lvl), row = sc.spellList.levelKind === 'class' ? progression[n - 1] : progression[cls.subclass.level - 1];
      row.grants.push(sc.spellList.levelKind === 'class'
        ? { id: `${id}:L${n}:spell:${index}`, kind: 'spell', ref: spellRef(index), alwaysPrepared: sc.spellList.alwaysPrepared, countsAgainstPrepared: false, sourceFeature: feature(sc.spellList.featureRef) }
        : { id: `${id}:spell-list:${index}`, kind: 'spell_list_addition', ref: spellRef(index), spellLevel: n, sourceFeature: feature(sc.spellList.featureRef) });
    }
    if (sc.terrainSpells) for (const [land, table] of Object.entries(sc.terrainSpells.lands)) for (const [lvl, list] of Object.entries(table)) for (const index of list) {
      const n = Number(lvl);
      progression[n - 1].grants.push({ id: `${id}:L${n}:${land}:spell:${index}`, kind: 'spell', ref: spellRef(index), alwaysPrepared: true, countsAgainstPrepared: false, sourceFeature: feature(sc.terrainSpells.featureRef), prerequisites: { hasFeature: feature(`${key}:${land}`) } });
    }
    entries.push({
      id, kind: 'subclass', name: { ru: scope.name.ru, en: scope.name.en }, aliases: [key], classId: classId(cid), selectionLevel: cls.subclass.level,
      optionRef: feature(`${cid}:${sc.option}`), source: source(range(sc.page, sc.pageEnd ?? sc.page)), review: review(),
      featureRefs: [...featureRefs].sort(), grants: [], choices: [], progression,
    });
  }

  const traitRefs = (raceId, subraceId) => features.entries.filter(e => e.kind === 'racial_trait' && e.scope.raceId === raceId && (e.scope.subraceId ?? null) === (subraceId ?? null)).map(e => e.id).sort();
  for (const [rid, r] of Object.entries(src.races)) {
    const id = `srd51:race:${rid}`, owner = id, scope = features.scopes.races[rid];
    const grants = [
      { id: `${owner}:size`, kind: 'size', value: r.size }, { id: `${owner}:speed`, kind: 'speed', mode: 'walk', value: r.speed },
      ...(r.darkvision ? [{ id: `${owner}:darkvision`, kind: 'sense', sense: 'darkvision', range: r.darkvision }] : []),
      ...Object.entries(r.asi).map(([ability, value]) => ({ id: `${owner}:ability_increase:${ability}`, kind: 'ability_increase', ability, value })),
      ...r.languages.map(value => ({ id: `${owner}:language:${value}`, kind: 'language', value })),
      ...prof(owner, 'weapon', r.weapons || []), ...prof(owner, 'skill', r.skills || []), ...prof(owner, 'tool', r.tools || []),
      ...(r.resistances || []).map(damageType => ({ id: `${owner}:resistance:${damageType}`, kind: 'resistance', damageType })),
      ...traitRefs(rid).map(ref => ({ id: `${owner}:feature:${ref.split(':').pop()}`, kind: 'feature', ref })),
    ];
    if (r.racialSpells) for (const s of r.racialSpells.spells) grants.push({ id: `${owner}:spell:${s.spell}`, kind: 'spell', ref: spellRef(s.spell), ability: r.racialSpells.ability, uses: s.uses, ...(s.castLevel ? { castLevel: s.castLevel } : {}), countsAgainstKnown: false, sourceFeature: feature(r.racialSpells.featureRef), prerequisites: { characterLevel: { min: s.characterLevel } } });
    const subraces = Object.keys(src.subraces).filter(k => k.startsWith(`${rid}:`)).map(k => `srd51:subrace:${k}`);
    const choices = [...(subraces.length ? [{ id: `${owner}:subrace`, kind: 'subrace', count: 1, options: subraces, distinct: true }] : []), ...(r.choices || []).map(spec => choice(owner, spec))];
    const def = { id, kind: 'race', name: { ru: scope.ru, en: scope.en }, aliases: [...r.aliases], source: source(range(r.page, r.pageEnd ?? r.page)), review: review(),
      featureRefs: traitRefs(rid), grants, choices };
    if (r.ancestry) def.optionData = Object.fromEntries(Object.entries(r.ancestry).map(([color, [damageType, shape, width, length, save]]) => [feature(`dragonborn:draconic-ancestry:${color}`), { damageType, breath: { shape, ...(shape === 'line' ? { widthFt: width, lengthFt: length } : { sizeFt: length }), save } }]));
    entries.push(def);
  }
  for (const [key, sr] of Object.entries(src.subraces)) {
    const [rid, sid] = key.split(':'), id = `srd51:subrace:${key}`, owner = id, scope = features.scopes.subraces[key];
    const grants = [
      ...Object.entries(sr.asi).map(([ability, value]) => ({ id: `${owner}:ability_increase:${ability}`, kind: 'ability_increase', ability, value })),
      ...prof(owner, 'weapon', sr.weapons || []), ...prof(owner, 'tool', sr.tools || []),
      ...(sr.grants || []).map((g, i) => extraGrant(owner, g, i)),
      ...traitRefs(rid, sid).map(ref => ({ id: `${owner}:feature:${ref.split(':').pop()}`, kind: 'feature', ref })),
    ];
    entries.push({ id, kind: 'subrace', raceId: `srd51:race:${rid}`, name: { ru: scope.name.ru, en: scope.name.en }, aliases: [key], source: source([sr.page]), review: review(),
      featureRefs: traitRefs(rid, sid), grants, choices: (sr.choices || []).map(spec => choice(owner, spec)) });
  }
  for (const [bid, b] of Object.entries(src.backgrounds)) {
    const id = `srd51:background:${bid}`;
    const scope = features.scopes.backgrounds[bid], ref = feature(b.featureRef);
    entries.push({ id, kind: 'background', name: { ru: scope.ru, en: scope.en }, aliases: [bid], source: source(range(b.page, b.pageEnd)),
      review: review(), featureRefs: [ref], grants: [...prof(id, 'skill', b.skills), { id: `${id}:feature`, kind: 'feature', ref }], choices: b.choices.map(spec => choice(id, spec)),
      startingEquipment: equipmentOf(`${id}:starting`, b.equipment) });
  }
  for (const [fid, f] of Object.entries(src.feats)) {
    const id = `srd51:feat:${fid}`, ref = feature(f.featureRef), entry = features.entries.find(e => e.id === ref);
    entries.push({ id, kind: 'feat', name: { ...entry.name }, aliases: [fid], source: source([f.page]), review: review(), featureRefs: [ref],
      grants: [{ id: `${id}:feature`, kind: 'feature', ref }], choices: [],
      prerequisites: f.prerequisites, availability: { sourceEnabled: 'rule:feats' }, repeatable: f.repeatable });
  }

  const options = { entries };
  for (const e of entries) { const r = validateCharacterOption(e); if (!r.valid) throw new Error(`${e.id}: ${JSON.stringify(r.errors.slice(0, 5))}`); }
  const missing = resolveCharacterOptionRefs(options, { featureIds, spellIds: new Set(spells.map(s => s.id)), equipmentIds });
  if (missing.length) throw new Error(`Unresolved refs: ${JSON.stringify(missing.slice(0, 10))}`);
  const count = (pred) => entries.filter(pred).length;
  const all = entries.flatMap(e => [...e.grants, ...e.choices, ...(e.startingEquipment ? [...e.startingEquipment.grants, ...e.startingEquipment.choices] : []), ...(e.progression || []).flatMap(r => [...r.grants, ...r.choices])]);
  return {
    schemaVersion: 1, catalogueKind: 'character_option', edition: '5e-2014',
    revision: sha(Buffer.concat([sourceBytes, generatorBytes, featureBytes, spellBytes, equipmentBytes])),
    sourceHashes: { source: sha(sourceBytes), generator: sha(generatorBytes), features: features.revision, spells: sha(spellBytes), equipment: equipment.revision, pdf: corpus.sha256 },
    attribution: corpus.attribution, sources: [corpus.url, src.abilityMethods.source.url],
    coverage: { entries: entries.length, classes: count(e => e.kind === 'class'), progressionRows: count(e => e.kind === 'class') * 20, subclasses: count(e => e.kind === 'subclass'),
      races: count(e => e.kind === 'race'), subraces: count(e => e.kind === 'subrace'), backgrounds: count(e => e.kind === 'background'), feats: count(e => e.kind === 'feat'),
      grants: all.filter(x => !Object.hasOwn(x, 'count')).length, choices: all.filter(x => Object.hasOwn(x, 'count')).length, reviewRequired: count(e => e.review.required) },
    scope: 'SRD 5.1 package only: 12 classes, 12 subclasses, 9 races, 4 subraces, Acolyte, Grappler. Not the full PHB; non-SRD options are not available here.',
    limitations: [
      'Starting equipment covers the class and background packages only; the optional starting-wealth rule (gold instead of packages) is not encoded.',
      'Values are build inputs; HP/AC/attack formulas belong to TASK-004 sheet rules and are not repeated here.',
    ],
    vocabularies: src.vocabularies, abilityMethods: src.abilityMethods,
    entries,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = buildCharacterOptions();
  writeFileSync(new URL(OUTPUT, root), JSON.stringify(result) + '\n');
  console.log(JSON.stringify({ revision: result.revision, ...result.coverage }));
}
