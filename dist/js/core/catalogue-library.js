import { assertPrivateCatalogueEntry, normalizeManualCatalogueData, cloneCatalogueData, CATALOGUE_KINDS, jsonErrors } from '../rules/catalogue.js';

const KEY = 'rasputye-v2-db';
const keyFor = (ownerId, id) => JSON.stringify([ownerId, id]);
function conflict() { const e = new Error('Запись изменена или удалена. Обновите данные перед сохранением.'); e.code = 'CATALOGUE_CONFLICT'; return e; }

/** Injected context/storage keeps private data out of the public loader cache. */
export function createCatalogueLibrary({ getContext, storage, onSandboxWrite = () => {}, makeId = () => `cat-${crypto.randomUUID()}`, now = () => Date.now() }) {
  async function scoped(action) {
    const before = await getContext();
    if (!before.userId) throw new Error('Войдите, чтобы открыть личные каталоги.');
    const result = await action(before);
    const after = await getContext();
    if (before.userId !== after.userId || Boolean(before.server) !== Boolean(after.server)) throw new Error('Пользователь или режим изменился.');
    return cloneCatalogueData(result);
  }
  function read() {
    const db = JSON.parse(storage.getItem(KEY));
    if (!db || db.version !== 1 || !db.users || !db.campaigns) throw new Error('Песочница не открыта или её данные повреждены.');
    if (db.catalogueEntries !== undefined && (!db.catalogueEntries || typeof db.catalogueEntries !== 'object' || Array.isArray(db.catalogueEntries))) throw new Error('Повреждены личные каталоги.');
    return db;
  }
  function write(db) {
    db.rev = (db.rev || 0) + 1; db.updatedAt = now();
    storage.setItem(KEY, JSON.stringify(db));
    onSandboxWrite(cloneCatalogueData(db));
  }
  return {
    list: (options = {}) => scoped(async ctx => {
      if (options.kind !== undefined && !CATALOGUE_KINDS.includes(options.kind)) throw new TypeError('Неизвестный вид каталога.');
      const values = ctx.server ? await ctx.server.list(options) : Object.values(read().catalogueEntries || {}).filter(v => v.ownerId === ctx.userId && (!options.kind || v.kind === options.kind));
      return values.map(v => {
        if (v.ownerId !== ctx.userId || (options.kind && v.kind !== options.kind)) throw new Error('Получены чужие личные данные.');
        return assertPrivateCatalogueEntry(v);
      });
    }),
    save: value => scoped(async ctx => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Нужен объект записи.');
      const errors = jsonErrors(value);
      if (errors.length) { const error = new TypeError('Нужна запись JSON.'); error.errors = errors; throw error; }
      if (value.ownerId !== undefined && value.ownerId !== '' && value.ownerId !== ctx.userId) throw new Error('Нельзя сохранить чужую запись.');
      const entry = assertPrivateCatalogueEntry({
        ...value, id: value.id === '' || value.id === undefined ? makeId() : value.id,
        ownerId: ctx.userId, revision: Object.hasOwn(value, 'revision') ? value.revision : 0,
        data: normalizeManualCatalogueData(value.kind, value.data), updatedAt: now(),
      });
      if (ctx.server) return ctx.server.save(entry);
      const db = read(); db.catalogueEntries ||= {};
      const key = keyFor(ctx.userId, entry.id), previous = db.catalogueEntries[key];
      if ((previous && (previous.revision !== entry.revision || previous.kind !== entry.kind)) || (!previous && entry.revision !== 0)) throw conflict();
      if (!previous && Object.values(db.catalogueEntries).filter(v => v.ownerId === ctx.userId).length >= 500) throw new Error('В личных каталогах уже 500 шаблонов.');
      entry.revision++; db.catalogueEntries[key] = entry; write(db); return entry;
    }),
    remove: (id, revision) => scoped(async ctx => {
      if (typeof id !== 'string' || !Number.isSafeInteger(revision) || revision < 1) throw new TypeError('Нужны ID и ожидаемая ревизия записи.');
      if (ctx.server) return ctx.server.remove(id, revision);
      const db = read(), key = keyFor(ctx.userId, id), previous = db.catalogueEntries?.[key];
      if (!previous || previous.revision !== revision) throw conflict();
      delete db.catalogueEntries[key]; write(db); return true;
    }),
  };
}

/** Explicit preview only; C/D decide visibility/confirmation and write the sheet. */
export function privateCatalogueSnapshot(value) {
  const entry = assertPrivateCatalogueEntry(value);
  if (entry.revision < 1) throw new Error('Сначала сохраните личный шаблон.');
  return { data: cloneCatalogueData(entry.data), catalogueRef: { kind: entry.kind, id: `user:${entry.ownerId}:${entry.id}`, revision: String(entry.revision) } };
}

let runtime;
async function library() {
  if (!runtime) {
    const [store, auth] = await Promise.all([import('./store.js'), import('./auth.js')]);
    runtime = createCatalogueLibrary({
      storage: globalThis.localStorage,
      getContext: async () => {
        const userId = auth.currentUserId();
        if (!userId || !store.isServerMode()) return { userId };
        const [{ supabase }, { createServerCatalogueLibrary }] = await Promise.all([import('../server/client.js'), import('../server/catalogue-library.js')]);
        return { userId, server: createServerCatalogueLibrary(await supabase(), userId) };
      },
      onSandboxWrite: db => { if (!store.isServerMode()) store.setDB(db, { catalogue: true }); },
    });
  }
  return runtime;
}
export const listCatalogueTemplates = async options => (await library()).list(options);
export const saveCatalogueTemplate = async value => (await library()).save(value);
export const deleteCatalogueTemplate = async (id, revision) => (await library()).remove(id, revision);
