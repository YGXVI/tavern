import { CATALOGUE_KINDS, validateCatalogueEntry, cloneCatalogueData } from '../rules/catalogue.js';

export const normalizeCatalogueSearch = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function validatePublicCatalogue(kind, value) {
  if (!value || value.schemaVersion !== 1 || value.catalogueKind !== kind || value.edition !== '5e-2014'
    || !/^[a-f0-9]{64}$/.test(value.revision) || !Array.isArray(value.entries) || value.coverage?.entries !== value.entries.length) throw new Error('Неподдерживаемый формат каталога.');
  const ids = new Set();
  for (const entry of value.entries) {
    const result = validateCatalogueEntry(kind, entry);
    if (!result.valid || ids.has(entry.id)) { const error = new Error(`Некорректная запись каталога: ${entry.id || '?'}`); error.errors = result.errors; throw error; }
    ids.add(entry.id);
  }
  if (kind === 'feature') {
    const records = new Map(value.entries.map(e => [e.id, e]));
    for (const e of value.entries) {
      if ((e.scope.classId && !value.scopes?.classes?.[e.scope.classId]) || (e.scope.raceId && !value.scopes?.races?.[e.scope.raceId])
        || (e.scope.subclassId && !value.scopes?.subclasses?.[`${e.scope.classId}:${e.scope.subclassId}`])
        || (e.scope.subraceId && !value.scopes?.subraces?.[`${e.scope.raceId}:${e.scope.subraceId}`])) throw new Error('Неизвестная группа способности.');
      const chain = new Set([e.id]); let parent = e;
      while (parent.scope.parentId) {
        const id = parent.scope.parentId;
        if (!ids.has(id) || chain.has(id)) throw new Error(`Неверный родитель: ${id}`);
        parent = records.get(id); chain.add(id);
        for (const field of ['classId', 'raceId']) if (parent.scope[field] && e.scope[field] !== parent.scope[field]) throw new Error('Вариант относится к другой группе.');
      }
    }
  }
  return value;
}

/** Public cache only. Never accepts a private-library loader or user data. */
export function createCatalogueLoader({ fetcher = globalThis.fetch, urls = {
  feature: new URL('../data/features-2014.json', import.meta.url),
  magic_item: new URL('../data/magic-items-2014.json', import.meta.url),
} } = {}) {
  const cache = new Map(), pending = new Map(), generations = new Map();
  const checkKind = kind => { if (!CATALOGUE_KINDS.includes(kind)) throw new TypeError('Неизвестный вид каталога.'); };
  return {
    async load(kind) {
      checkKind(kind);
      if (cache.has(kind)) return cache.get(kind);
      if (pending.has(kind)) return pending.get(kind);
      const generation = generations.get(kind) || 0;
      const request = (async () => {
        const response = await fetcher(urls[kind], { credentials: 'omit' });
        if (!response.ok) throw new Error(`Не удалось загрузить каталог (${response.status}). Повторите попытку.`);
        const value = freeze(validatePublicCatalogue(kind, await response.json()));
        if ((generations.get(kind) || 0) === generation) cache.set(kind, value);
        return value;
      })();
      pending.set(kind, request);
      try { return await request; } finally { if (pending.get(kind) === request) pending.delete(kind); }
    },
    invalidate(kind) {
      checkKind(kind); cache.delete(kind); pending.delete(kind); generations.set(kind, (generations.get(kind) || 0) + 1);
    },
  };
}

export function queryCatalogue(catalogue, filters = {}) {
  const query = normalizeCatalogueSearch(filters.query);
  return catalogue.entries.filter(entry => {
    if (query && !normalizeCatalogueSearch([entry.name.ru, entry.name.en, entry.text?.ru, entry.text?.en, entry.description?.ru, ...(entry.description?.en || [])].filter(Boolean).join(' ')).includes(query)) return false;
    for (const key of ['classId', 'subclassId', 'raceId', 'subraceId']) if (filters[key] && entry.scope?.[key] !== filters[key]) return false;
    if (filters.kind && entry.kind !== filters.kind) return false;
    if (Object.hasOwn(filters, 'level') && entry.level !== filters.level) return false;
    if (filters.type && entry.type?.code !== filters.type) return false;
    if (filters.rarity && entry.rarity?.code !== filters.rarity) return false;
    if (Object.hasOwn(filters, 'attunement') && entry.attunement?.required !== filters.attunement) return false;
    if (Object.hasOwn(filters, 'hasDescription') && Boolean(entry.text?.ru || entry.text?.en || entry.description?.ru || entry.description?.en?.length) !== filters.hasDescription) return false;
    if (filters.source && entry.source.kind !== filters.source && !entry.sources?.publications?.some(p => p.id === filters.source)) return false;
    return true;
  }).sort((a, b) => (a.name.ru || a.name.en).localeCompare(b.name.ru || b.name.en, 'ru') || a.id.localeCompare(b.id));
}

/** Preview data for C/D. Does not create a Character, instance ID, or mutation. */
export function catalogueSnapshot(catalogue, id, { variantId } = {}) {
  const entry = catalogue.entries.find(e => e.id === id);
  if (!entry) throw new Error('Запись каталога не найдена.');
  const data = cloneCatalogueData(entry), ref = { kind: catalogue.catalogueKind, id, revision: catalogue.revision };
  if (entry.variants?.length) {
    const variant = entry.variants.find(v => v.srd_index === variantId);
    if (!variant) throw new Error('Выберите существующий вариант предмета.');
    ref.variantId = variant.srd_index;
    data.selectedVariant = cloneCatalogueData(variant);
  } else if (variantId !== undefined) throw new Error('У записи нет такого варианта.');
  return { data, catalogueRef: ref };
}

const publicLoader = createCatalogueLoader();
export const loadCatalogue = kind => publicLoader.load(kind);
export const reloadCatalogue = kind => { publicLoader.invalidate(kind); return publicLoader.load(kind); };
