// TASK-125: personal library API. Not part of campaign state or realtime.
import { normalizeCreature, validateCreature, fromSrd } from '../rules/creature.js';
import { validateLibraryImage } from '../server/library.js';

const KEY = 'rasputye-v2-db';
const clone = value => structuredClone(value);
function checked(value) {
  const result = validateCreature(value);
  if (!result.valid) { const e = new TypeError('Проверьте поля статблока.'); e.errors = result.errors; throw e; }
  return normalizeCreature(value);
}

/** Adapters make auth changes, storage failures and server responses independently testable. */
export function createLibrary({ getContext, storage, onSandboxWrite = () => {},
  uploadSandbox, resolveSandbox, makeId = () => crypto.randomUUID(), now = () => Date.now() }) {
  async function scoped(work) {
    const ctx = await getContext();
    if (!ctx?.userId) throw new Error('Войдите, чтобы открыть личную библиотеку.');
    const result = await work(ctx);
    const after = await getContext();
    if (ctx.userId !== after?.userId || !!ctx.server !== !!after?.server) throw new Error('Пользователь или режим изменился. Откройте библиотеку заново.');
    return clone(result);
  }
  function read() {
    const value = JSON.parse(storage.getItem(KEY) || 'null');
    if (!value || value.version !== 1 || !value.users || !value.campaigns) throw new Error('Песочница не открыта или её данные повреждены.');
    if (value.creatures != null && (typeof value.creatures !== 'object' || Array.isArray(value.creatures))) throw new Error('Повреждена личная библиотека.');
    return value;
  }
  function write(db) {
    db.rev = (db.rev || 0) + 1; db.updatedAt = now();
    storage.setItem(KEY, JSON.stringify(db)); // Throw on quota/private-mode failures; never optimistic success.
    onSandboxWrite(clone(db));
  }
  const entryKey = (ownerId, id) => JSON.stringify([ownerId, id]);
  const ownEntry = (entries, ownerId, id) => {
    const scoped = entries[entryKey(ownerId, id)];
    if (scoped?.ownerId === ownerId && scoped.id === id) return scoped;
    const legacy = Object.hasOwn(entries, id) ? entries[id] : null;
    return legacy?.ownerId === ownerId && legacy.id === id ? legacy : null;
  };
  function personal(entries, ownerId) {
    // Old flat keys stay readable. A scoped copy wins if both representations exist.
    const result = new Map();
    for (const c of Object.values(entries)) if (c?.ownerId === ownerId) result.set(c.id, ownEntry(entries, ownerId, c.id) || c);
    return [...result.values()];
  }
  const api = {
    list: () => scoped(async ctx => {
      const list = ctx.server ? await ctx.server.list() : personal(read().creatures || {}, ctx.userId);
      if (list.some(c => c.ownerId !== ctx.userId)) throw new Error('Получены данные другого пользователя.');
      return list.map(checked).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    }),
    save: value => scoped(async ctx => {
      const input = normalizeCreature(value);
      if (input.ownerId !== '' && input.ownerId !== ctx.userId) throw new Error('Нельзя сохранить чужую запись.');
      const c = checked({ ...input, id: input.id === '' ? makeId() : input.id, ownerId: ctx.userId, updatedAt: now() });
      if (ctx.server) return ctx.server.save(c);
      const db = read(); db.creatures ||= {};
      const old = ownEntry(db.creatures, ctx.userId, c.id);
      if (!old && personal(db.creatures, ctx.userId).length >= 500) throw new Error('В библиотеке уже 500 существ.');
      // Upgrade only this owner's legacy entry; a foreign flat key is never removed.
      if (Object.hasOwn(db.creatures, c.id) && db.creatures[c.id]?.ownerId === ctx.userId) delete db.creatures[c.id];
      db.creatures[entryKey(ctx.userId, c.id)] = c; write(db); return c;
    }),
    remove: id => scoped(async ctx => {
      if (ctx.server) return ctx.server.remove(id);
      const db = read();
      if (!ownEntry(db.creatures || {}, ctx.userId, id)) throw new Error('Запись не найдена или недоступна.');
      delete db.creatures[entryKey(ctx.userId, id)];
      if (Object.hasOwn(db.creatures, id) && db.creatures[id]?.ownerId === ctx.userId) delete db.creatures[id];
      write(db); return true;
    }),
    copyFromSrd: monster => api.save(fromSrd(monster)),
    uploadImage: file => scoped(async ctx => {
      await validateLibraryImage(file);
      if (ctx.server) return ctx.server.uploadImage(file);
      if (!uploadSandbox) throw new Error('Хранилище изображений недоступно.');
      return uploadSandbox(file);
    }),
    resolveImage: ref => scoped(async ctx => {
      if (ctx.server) return ctx.server.resolveImage(ref);
      if (!resolveSandbox) throw new Error('Хранилище изображений недоступно.');
      return resolveSandbox(ref);
    }),
    imageUsage: () => scoped(async ctx => {
      if (!ctx.server) throw new Error('Серверная квота недоступна в песочнице.');
      return ctx.server.imageUsage();
    }),
    unusedImages: () => scoped(async ctx => {
      if (!ctx.server) throw new Error('Очистка серверных файлов недоступна в песочнице.');
      return ctx.server.unusedImages();
    }),
    cleanupUnusedImages: () => scoped(async ctx => {
      if (!ctx.server) throw new Error('Очистка серверных файлов недоступна в песочнице.');
      return ctx.server.cleanupUnusedImages();
    }),
  };
  return api;
}

let runtime;
async function library() {
  if (!runtime) {
    const [store, auth, assets] = await Promise.all([import('./store.js'), import('./auth.js'), import('./assets.js')]);
    runtime = createLibrary({
      storage: globalThis.localStorage,
      getContext: async () => {
        const userId = auth.currentUserId();
        if (!userId || !store.isServerMode()) return { userId };
        const [{ supabase }, { createServerLibrary }] = await Promise.all([import('../server/client.js'), import('../server/library.js')]);
        return { userId, server: createServerLibrary(await supabase(), userId) };
      },
      onSandboxWrite: db => { if (!store.isServerMode()) store.setDB(db, { library: true }); },
      uploadSandbox: async file => (await assets.storeImage(file)).ref,
      resolveSandbox: ref => assets.resolveSrc(ref),
    });
  }
  return runtime;
}

export const listCreatures = async () => (await library()).list();
export const saveCreature = async value => (await library()).save(value);
export const deleteCreature = async id => (await library()).remove(id);
export const copySrdCreature = async monster => (await library()).copyFromSrd(monster);
export const uploadLibraryImage = async file => (await library()).uploadImage(file);
export const resolveLibraryImage = async ref => (await library()).resolveImage(ref);
export const getLibraryImageUsage = async () => (await library()).imageUsage();
export const listUnusedLibraryImages = async () => (await library()).unusedImages();
export const cleanupUnusedLibraryImages = async () => (await library()).cleanupUnusedImages();
