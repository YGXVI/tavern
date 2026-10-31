// TASK-129 / TASK-151: data only. No character effects, DOM or persistence.
export const CATALOGUE_KINDS = Object.freeze(['feature', 'magic_item']);
export const FEATURE_KINDS = Object.freeze(['class_feature', 'subclass_feature', 'racial_trait', 'feat', 'option']);
export const CATALOGUE_MAX_BYTES = 65536;
export const cloneCatalogueData = value => structuredClone(value);

export function jsonErrors(value, path = '', errors = [], ancestors = new Set()) {
  const error = message => errors.push({ path: path || '$', message });
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return errors;
  if (typeof value === 'number') { if (!Number.isFinite(value)) error('Нужно конечное число.'); return errors; }
  if (typeof value !== 'object') { error('Нужно значение JSON.'); return errors; }
  if (ancestors.has(value)) { error('Циклическая ссылка.'); return errors; }
  if (ancestors.size > 100) { error('Слишком глубокая вложенность JSON.'); return errors; }
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) { error('Нужен обычный объект JSON.'); return errors; }
  ancestors.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length' && Array.isArray(value)) continue;
    if (Array.isArray(value) && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key))) { error('У массива JSON не бывает дополнительных полей.'); continue; }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) { error('JSON не поддерживает символы, скрытые поля или getters.'); continue; }
    jsonErrors(descriptor.value, path ? `${path}.${key}` : key, errors, ancestors);
  }
  if (Array.isArray(value)) for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) errors.push({ path: `${path}.${i}`, message: 'Пропуск в массиве JSON.' });
  ancestors.delete(value);
  return errors;
}
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const string = x => typeof x === 'string';
const nullableText = x => x === null || string(x);
const nonempty = x => string(x) && x.trim().length > 0;
const hasName = x => object(x) && nullableText(x.ru) && nullableText(x.en) && (nonempty(x.ru) || nonempty(x.en));

/** Validate a public entry or the data payload of a private manual template. */
export function validateCatalogueEntry(kind, value, { manual = false } = {}) {
  const errors = jsonErrors(value);
  const add = (path, message) => errors.push({ path, message });
  if (errors.length) return { valid: false, errors };
  if (!CATALOGUE_KINDS.includes(kind)) add('kind', 'Неизвестный вид каталога.');
  if (!object(value)) return { valid: false, errors: [{ path: '$', message: 'Нужна запись каталога.' }] };
  if (value.edition !== '5e-2014') add('edition', 'Поддерживается D&D 5e 2014.');
  if (!manual && !nonempty(value.id)) add('id', 'Нужен устойчивый ID.');
  if (!hasName(value.name)) add('name', 'Нужно имя на русском или английском.');
  else if ([value.name.ru, value.name.en].some(n => n !== null && n.length > 200)) add('name', 'Имя длиннее 200 символов.');
  if (!object(value.source) || (manual && value.source.kind !== 'manual')) add('source', 'Укажите происхождение; личный шаблон имеет source.kind=manual.');
  if (manual && ['id', 'ownerId', 'revision', 'updatedAt'].some(key => Object.hasOwn(value, key))) add('$', 'Метаданные записи хранятся отдельно от data.');
  if (kind === 'feature') {
    if (!FEATURE_KINDS.includes(value.kind)) add('kind', 'Неизвестная категория способности.');
    if (!object(value.text) || !nullableText(value.text.ru) || !nullableText(value.text.en) || (!nonempty(value.text.ru) && !nonempty(value.text.en))) add('text', 'Нужен текст способности.');
    if (!object(value.scope) || Object.values(value.scope).some(v => !nonempty(v))) add('scope', 'Scope содержит только непустые идентификаторы.');
    if (value.level !== null && (!Number.isInteger(value.level) || value.level < 1 || value.level > 20)) add('level', 'Уровень 1–20 либо null.');
    if (!nullableText(value.prerequisiteText)) add('prerequisiteText', 'Требования задаются текстом либо null.');
    if (![null, 'action', 'bonus_action', 'reaction', 'passive', 'special'].includes(value.actionType)) add('actionType', 'Неизвестный тип действия.');
    if (!manual && value.source?.kind !== 'srd51') add('source.kind', 'Публичные способности берутся только из SRD5.1.');
    if (!manual && (!/^[a-f0-9]{64}$/.test(value.source?.sha256 || '') || !nonempty(value.source?.url) || value.source?.license !== 'CC-BY-4.0'
      || !Array.isArray(value.source?.spans) || value.source.spans.length === 0)) add('source', 'Нужны hash, ссылка, лицензия и исходные spans.');
    if (!manual && Array.isArray(value.source?.spans)) for (const [i, span] of value.source.spans.entries()) {
      if (!object(span) || !Number.isInteger(span.page) || span.page < 1 || span.page > 403 || ![0, 1].includes(span.column)
        || !Number.isFinite(span.top) || !Number.isFinite(span.bottom) || span.top < 0 || span.bottom < span.top) add(`source.spans.${i}`, 'Неверная исходная граница.');
    }
  } else if (kind === 'magic_item') {
    if (!object(value.description) || !nullableText(value.description.ru) || (value.description.en !== null && (!Array.isArray(value.description.en) || value.description.en.some(s => !string(s))))) add('description', 'Описание: ru текст/null, en массив строк/null.');
    if (!object(value.technical)) add('technical', 'Нужны технические поля, неизвестные значения — null.');
    if (!object(value.attunement) || ![true, false, null].includes(value.attunement.required)) add('attunement.required', 'Настройка: true/false/null.');
    if (!Array.isArray(value.variants)) add('variants', 'Нужен массив вариантов.');
    if (!manual && !['srd2014', 'metadata'].includes(value.source?.kind)) add('source.kind', 'Неподдерживаемый публичный источник.');
    if (!manual && value.source?.kind === 'srd2014' && (!nonempty(value.srd_details?.srd_index) || !nonempty(value.sources?.srd_api))) add('source', 'Нужно подтверждённое сопоставление SRD.');
    if (Array.isArray(value.variants)) {
      const variants = new Set();
      value.variants.forEach((v, i) => {
        if (!object(v) || !nonempty(v.id) || !nonempty(v.srd_index) || variants.has(v.srd_index)) add(`variants.${i}`, 'Нужен уникальный существующий ID варианта.');
        variants.add(v?.srd_index);
      });
    }
    if (!manual && value.source?.kind === 'metadata' && (value.description?.en?.length || nonempty(value.description?.ru) || value.variants?.length)) add('description', 'Metadata-only не содержит полного текста или вариантов SRD.');
    if (manual && (!nonempty(value.description?.ru) && !value.description?.en?.some(nonempty))) add('description', 'Нужен текст личного предмета.');
  }
  return { valid: errors.length === 0, errors };
}

/** Defaults do not coerce invalid values or infer game rules. Unknown fields survive. */
export function normalizeManualCatalogueData(kind, value) {
  const errors = jsonErrors(value);
  if (!object(value) || errors.length) { const e = new TypeError('Нужен объект JSON.'); e.errors = errors; throw e; }
  for (const key of ['name', 'source', ...(kind === 'feature' ? ['text', 'scope'] : ['technical', 'attunement', 'description'])]) {
    if (Object.hasOwn(value, key) && !object(value[key])) { const e = new TypeError('Нужно объектное поле.'); e.errors = [{ path: key, message: 'Нужен объект.' }]; throw e; }
  }
  value = cloneCatalogueData(value);
  const result = { ...cloneCatalogueData(value), edition: value.edition === undefined ? '5e-2014' : value.edition, source: value.source === undefined ? { kind: 'manual' } : value.source, name: { ru: null, en: null, ...value.name } };
  if (kind === 'feature') {
    return { kind: 'feat', scope: {}, level: null, prerequisiteText: null, actionType: null, ...result, text: { ru: null, en: null, ...value.text } };
  }
  if (kind === 'magic_item') {
    return {
      type: null, rarity: null, variants: [], ...result,
      attunement: { required: null, requirement_en: null, ...value.attunement },
      description: { ru: null, en: [], ...value.description },
      technical: { price: null, weight: null, capacity: null, range: null, duration: null, armor_class: null, weapon_damage: null, healing: null, charges: { maximum: null, recharge: null, description_en: null }, bonuses: [], ability_score_set: null, spellcasting: null, conditions_en: null, ...value.technical },
    };
  }
  throw new TypeError('Неизвестный вид каталога.');
}

export function validatePrivateCatalogueEntry(value) {
  const errors = jsonErrors(value);
  if (errors.length) return { valid: false, errors };
  if (!object(value)) return { valid: false, errors: [{ path: '$', message: 'Нужна личная запись.' }] };
  for (const key of ['id', 'ownerId']) if (!nonempty(value[key]) || !/^[A-Za-z0-9_:-]{1,128}$/.test(value[key])) errors.push({ path: key, message: 'Нужен корректный идентификатор.' });
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) errors.push({ path: 'revision', message: 'Нужна ожидаемая ревизия; 0 для новой записи.' });
  const checked = validateCatalogueEntry(value.kind, value.data, { manual: true });
  errors.push(...checked.errors.map(e => ({ ...e, path: `data.${e.path}` })));
  if (new TextEncoder().encode(JSON.stringify(value.data)).length > CATALOGUE_MAX_BYTES) errors.push({ path: 'data', message: 'Запись больше 64 КиБ UTF-8.' });
  return { valid: errors.length === 0, errors };
}

export function assertPrivateCatalogueEntry(value) {
  const check = validatePrivateCatalogueEntry(value);
  if (!check.valid) { const e = new TypeError('Проверьте поля личной записи.'); e.errors = check.errors; throw e; }
  return cloneCatalogueData(value);
}
