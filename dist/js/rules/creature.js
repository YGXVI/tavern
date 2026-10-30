// TASK-122: pure personal-library model. No registry, storage, DOM or combat effects.
export const CREATURE_MAX_BYTES = 64 * 1024;
const ABS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const FULL_ABS = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
const SPEEDS = ['walk', 'fly', 'swim', 'climb', 'burrow'];
const LISTS = ['traits', 'actions', 'bonusActions', 'reactions'];
const SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const copy = x => structuredClone(x);
const defaults = (value, fields) => value == null ? Object.fromEntries(fields.map(k => [k, null]))
  : object(value) ? { ...Object.fromEntries(fields.map(k => [k, null])), ...value } : value;

/** Detached draft. Does not invent identity, owner, timestamps or unknown stats. */
export function normalizeCreature(input = {}) {
  if (!object(input)) throw new TypeError('Существо должно быть объектом.');
  const c = copy(input);
  for (const key of ['id', 'ownerId', 'name', 'img', 'type', 'alignment', 'acNote', 'hpFormula', 'senses', 'languages']) c[key] ??= '';
  c.source ??= 'manual';
  for (const key of ['size', 'ac', 'hp', 'cr', 'updatedAt']) c[key] ??= null;
  c.speed = defaults(c.speed, SPEEDS);
  c.stats = defaults(c.stats, ABS);
  for (const key of [...LISTS, 'saves', 'skills']) c[key] ??= [];
  c.legendary ??= { count: null, actions: [] };
  if (object(c.legendary)) { c.legendary.count ??= null; c.legendary.actions ??= []; }
  return c;
}

/** Validate the normalized persisted shape; errors are stable {path,code,message}. */
export function validateCreature(input) {
  const errors = [];
  const error = (path, code, message) => errors.push({ path, code, message });
  const seen = new Set();
  function json(value, path, depth = 0) {
    if (depth > 64) { error(path, 'depth', 'Слишком глубокая структура JSON.'); return; }
    if (value === null || ['string', 'boolean'].includes(typeof value)) return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object' || !value) { error(path, 'json', 'Нужно значение JSON.'); return; }
    if (seen.has(value)) { error(path, 'json', 'Циклическая ссылка недопустима.'); return; }
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      error(path, 'json', 'Нужен обычный объект JSON.'); return;
    }
    seen.add(value);
    for (const [key, item] of Object.entries(value)) json(item, path ? `${path}.${key}` : key, depth + 1);
    // Sparse arrays serialize holes as null; reject instead of silently changing data.
    if (Array.isArray(value) && Object.keys(value).length !== value.length) error(path, 'json', 'В массиве есть пустые элементы.');
    seen.delete(value);
  }
  json(input, '');
  if (!object(input)) error('', 'object', 'Существо должно быть объектом.');
  if (errors.length) return { valid: false, errors, bytes: null };
  const c = normalizeCreature(input);
  const text = (v, path, required = false) => {
    if (typeof v !== 'string' || (required && !v.trim())) error(path, 'text', required ? 'Заполните поле.' : 'Нужна строка.');
  };
  const number = (v, path, min = -Infinity) => {
    if (v !== null && (!Number.isSafeInteger(v) || v < min)) error(path, 'number', 'Нужно целое число или null для неизвестного значения.');
  };
  const list = (v, path, check) => {
    if (!Array.isArray(v)) error(path, 'array', 'Нужен список.');
    else v.forEach((item, i) => check(item, `${path}.${i}`));
  };
  for (const key of ['id', 'ownerId', 'name']) text(c[key], key, true);
  for (const key of ['id', 'ownerId']) if (typeof c[key] === 'string' && (!/^[\w:-]+$/.test(c[key]) || c[key].length > 128)) error(key, 'id', 'Недопустимый идентификатор.');
  if (typeof c.name === 'string' && c.name.length > 200) error('name', 'length', 'Не больше 200 символов.');
  if (!['manual', 'image'].includes(c.source)) error('source', 'source', 'Источник: manual или image.');
  for (const key of ['img', 'type', 'alignment', 'acNote', 'hpFormula', 'senses', 'languages']) text(c[key], key);
  if (c.statblockImage != null) text(c.statblockImage, 'statblockImage');
  if (c.source === 'image' && !(typeof c.statblockImage === 'string' && c.statblockImage.trim())) error('statblockImage', 'required', 'Добавьте изображение статблока.');
  if (c.size !== null && !SIZES.includes(c.size)) error('size', 'size', 'Неизвестная категория размера.');
  for (const key of ['ac', 'hp', 'updatedAt']) number(c[key], key, 0);
  if (c.cr !== null && !(typeof c.cr === 'string' && /^(?:\d+|1\/[248])$/.test(c.cr))) error('cr', 'cr', 'Укажите ПО целым числом, 1/2, 1/4, 1/8 или null.');
  for (const [key, fields] of [['stats', ABS], ['speed', SPEEDS]]) {
    if (!object(c[key])) error(key, 'object', 'Нужен объект.');
    else for (const field of fields) number(c[key][field], `${key}.${field}`, 0);
  }
  list(c.saves, 'saves', (s, path) => {
    if (!object(s)) return error(path, 'object', 'Нужен спасбросок.');
    if (!ABS.includes(s.ability)) error(`${path}.ability`, 'ability', 'Неизвестная характеристика.');
    number(s.bonus, `${path}.bonus`);
  });
  list(c.skills, 'skills', (s, path) => {
    if (!object(s)) return error(path, 'object', 'Нужен навык.');
    text(s.name, `${path}.name`, true); number(s.bonus, `${path}.bonus`);
  });
  function ability(a, path) {
    if (!object(a)) return error(path, 'object', 'Нужна возможность с именем и текстом.');
    text(a.name, `${path}.name`, true); text(a.text, `${path}.text`);
    if (a.attack != null) {
      if (!object(a.attack)) error(`${path}.attack`, 'object', 'Нужны параметры атаки.');
      else {
        number(a.attack.bonus ?? null, `${path}.attack.bonus`);
        if (a.attack.reach != null) number(a.attack.reach, `${path}.attack.reach`, 0);
        if (a.attack.range != null) {
          if (!object(a.attack.range)) error(`${path}.attack.range`, 'object', 'Нужны normal и long в футах.');
          else for (const key of ['normal', 'long']) number(a.attack.range[key] ?? null, `${path}.attack.range.${key}`, 0);
        }
      }
    }
    if (a.damage != null) list(a.damage, `${path}.damage`, (d, p) => {
      if (!object(d)) return error(p, 'object', 'Нужен компонент урона.');
      for (const key of ['dice', 'type']) if (d[key] !== null) text(d[key], `${p}.${key}`);
    });
    if (a.save != null) {
      if (!object(a.save)) error(`${path}.save`, 'object', 'Нужен спасбросок.');
      else {
        if (!ABS.includes(a.save.ability)) error(`${path}.save.ability`, 'ability', 'Неизвестная характеристика.');
        number(a.save.dc, `${path}.save.dc`, 0);
        if (!['target', 'self'].includes(a.save.who)) error(`${path}.save.who`, 'who', 'Укажите, кто бросает: target или self.');
      }
    }
  }
  for (const key of LISTS) list(c[key], key, ability);
  if (!object(c.legendary)) error('legendary', 'object', 'Нужны count и actions.');
  else { number(c.legendary.count, 'legendary.count', 0); list(c.legendary.actions, 'legendary.actions', ability); }
  const bytes = new TextEncoder().encode(JSON.stringify(c)).length;
  if (bytes > CREATURE_MAX_BYTES) error('', 'max_bytes', 'Статблок больше 64 КБ UTF-8.');
  return { valid: errors.length === 0, errors, bytes };
}

const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const feet = value => value?.distance?.unit === 'ft' ? value.distance.value : null;
const rating = v => v == null ? null : ({ 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' }[v] ?? String(v));
const provenance = id => ({ source: 'srd_api_2014', id,
  attribution: 'Includes material from SRD 5.1 by Wizards of the Coast LLC, licensed under CC BY 4.0.',
  license: 'https://creativecommons.org/licenses/by/4.0/legalcode',
  url: 'https://dnd.wizards.com/resources/systems-reference-document' });

function catalogueAbility(a) {
  const out = { ...omit(copy(a), ['name_en', 'description_en', 'attack', 'damage']), name: a.name_en, text: a.description_en || '' };
  if (a.attack && Object.values(a.attack).some(v => v !== null)) {
    out.attack = { ...copy(a.attack), reach: a.attack.reach?.unit === 'ft' ? a.attack.reach.value : null };
  }
  out.damage = (a.damage || []).map(d => ({ ...omit(copy(d), ['formula']), dice: d.formula ?? null }));
  // saving_throw has no verified actor: preserve it verbatim; do not manufacture save.who.
  return out;
}

function runtimeAbility(a) {
  if (typeof a === 'string') return { name: a, text: a };
  const out = { ...omit(copy(a), ['desc', 'bonus', 'damage', 'type']), name: a.name, text: a.desc || a.note || '' };
  if (a.bonus != null) out.attack = { bonus: a.bonus };
  out.damage = a.damage ? [{ dice: a.damage, type: a.type || null }] : [];
  return out;
}

/** Copy trusted SRD into a draft. Persistence supplies a NEW id and the authenticated owner. */
export function fromSrd(monster, identity = {}) {
  if (!object(monster)) throw new TypeError('Нужна запись SRD.');
  const s = monster.stat_block;
  if (s?.source === 'srd_api_2014') {
    const mapped = ['source', 'name_en', 'size', 'type', 'alignment', 'hit_points', 'speed', 'abilities', 'proficiencies', 'saving_throws', 'skills', 'senses', 'languages_en', 'challenge_rating', 'special_abilities', 'actions', 'bonus_actions', 'reactions', 'legendary_actions'];
    return normalizeCreature({
      ...omit(copy(s), mapped), id: '', ownerId: '', source: 'manual', provenance: provenance(monster.id),
      name: monster.name?.ru || s.name_en, en: s.name_en, size: s.size, type: monster.catalogue?.type?.[0]?.name_ru || s.type, alignment: s.alignment || '',
      ac: s.armor_class?.[0]?.value ?? null, hp: s.hit_points?.average ?? null, hpFormula: s.hit_points?.formula || s.hit_points?.hit_dice || '',
      speed: Object.fromEntries(SPEEDS.map(k => [k, feet(s.speed?.[k])])), speedDetails: copy(s.speed || {}),
      stats: Object.fromEntries(ABS.map((k, i) => [k, s.abilities?.[FULL_ABS[i]]?.score ?? null])),
      saves: (s.saving_throws || []).map(p => ({ ability: p.proficiency.index.replace('saving-throw-', ''), bonus: p.value })),
      skills: (s.skills || []).map(p => ({ name: p.proficiency.index.replace('skill-', ''), bonus: p.value })),
      senses: Object.entries(s.senses || {}).map(([k, v]) => `${k}: ${v?.text ?? v}`).join(', '), senseDetails: copy(s.senses || {}),
      languages: s.languages_en || '', cr: rating(s.challenge_rating),
      traits: (s.special_abilities || []).map(catalogueAbility), actions: (s.actions || []).map(catalogueAbility),
      bonusActions: (s.bonus_actions || []).map(catalogueAbility), reactions: (s.reactions || []).map(catalogueAbility),
      legendary: { count: null, actions: (s.legendary_actions || []).map(catalogueAbility) },
      ...identity,
    });
  }
  if (monster.srd !== true || s) throw new TypeError('Можно копировать только явно отмеченные статблоки SRD.');
  return normalizeCreature({
    ...omit(copy(monster), ['id', 'srd', 'hpDice', 'init', 'speed', 'traits', 'actions', 'reactions', 'legendary', 'saves']),
    id: '', ownerId: '', source: 'manual', provenance: provenance(monster.id), hpFormula: monster.hpDice || '',
    speed: { walk: monster.speed ?? null }, cr: rating(monster.cr),
    saves: Object.entries(monster.saves || {}).map(([ability, bonus]) => ({ ability, bonus })),
    traits: (monster.traits || []).map(runtimeAbility), actions: (monster.actions || []).map(runtimeAbility),
    reactions: (monster.reactions || []).map(runtimeAbility),
    legendary: { count: null, actions: (monster.legendary || []).map(runtimeAbility) }, ...identity,
  });
}

function monsterAbility(a) {
  const parts = a.damage || [];
  const simple = parts.length === 1 && parts[0].dice && !parts[0].source?.choose && !a.options && !a.multiattack;
  const note = [a.note, ...parts.map(d => d.dice ? `${d.dice}${d.type ? ` ${d.type}` : ''}` : 'Урон: см. описание'),
    a.save ? `СЛ ${a.save.dc} ${a.save.ability} (${a.save.who})` : ''].filter(Boolean).join(' · ');
  return { ...copy(a), desc: a.text, bonus: a.attack?.bonus ?? 0, damage: simple ? parts[0].dice : '',
    damageComponents: copy(parts), type: simple ? (parts[0].type || '') : '', note };
}

/** Display projection only; does not register lib: IDs or grant access to a library. */
export function toMonster(creature) {
  const validation = validateCreature(creature);
  if (!validation.valid) {
    const error = new TypeError('Некорректное существо.'); error.errors = validation.errors; throw error;
  }
  const c = normalizeCreature(creature);
  const out = { ...c, id: `lib:${c.id}`, srd: false, hpDice: c.hpFormula, speed: c.speed.walk,
    init: c.stats.dex === null ? null : Math.floor((c.stats.dex - 10) / 2),
    img: c.img || `ini:${c.name}`, darkvision: c.darkvision ?? feet(c.senseDetails?.darkvision),
    saves: Object.fromEntries(c.saves.map(s => [s.ability, s.bonus])),
    traits: c.traits.map(monsterAbility), actions: c.actions.map(monsterAbility), bonusActions: c.bonusActions.map(monsterAbility),
    reactions: c.reactions.map(monsterAbility), legendary: c.legendary.actions.map(monsterAbility),
    speedDetails: copy(c.speedDetails || c.speed), legendaryCount: c.legendary.count,
  };
  delete out.ownerId; // Display data is not proof of ownership; source identity stays in the private library.
  return out;
}
