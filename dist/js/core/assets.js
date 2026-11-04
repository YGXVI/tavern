// Картинки: встроенные (карты и портреты из макетов) и загруженные пользователем.
// Песочница: файлы в IndexedDB этого браузера (idb:). Серверная кампания (TASK-002): файлы в хранилище
// кампании (sb:<кампания>/<файл>), адрес — подписанная ссылка, которую выдаёт серверный слой.
import { icon } from '../icons.js';
import { initials, hueOf, esc } from './dom.js';

const BUILTIN_MAPS = { crypt: 'assets/maps/crypt.webp', forest: 'assets/maps/forest.webp', tavern: 'assets/maps/tavern.webp', cave: 'assets/maps/cave.webp' };
export const BUILTIN_MAP_LIST = [
  { id: 'map:crypt', name: 'Склеп', width: 1185, height: 1259 },
  { id: 'map:forest', name: 'Лесная дорога', width: 1024, height: 1024 },
  { id: 'map:tavern', name: 'Таверна', width: 1024, height: 1024 },
  { id: 'map:cave', name: 'Пещера', width: 1024, height: 1024 },
];
const PORTRAITS = new Set(['lira', 'torin', 'elian', 'mira', 'garr', 'goblin', 'cultist', 'ogre', 'spawn']);

const urlCache = new Map();
let dbPromise = null;
let remote = null; // {get(ref), resolve(ref), upload(campaignId, blob)} — серверный режим

/** Подключить хранилище сервера (вызывает main.js в серверном режиме). */
export function useRemoteAssets(r) { remote = r; }

function idb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('rasputye-v2-assets', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('images');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Синхронный адрес для встроенных картинок; для idb: — пустая строка, пока не загрузится. */
export function srcOf(ref) {
  if (!ref) return '';
  if (ref.startsWith('map:')) return BUILTIN_MAPS[ref.slice(4)] || '';
  if (ref.startsWith('idb:')) return urlCache.get(ref) || '';
  if (ref.startsWith('sb:')) return remote?.get(ref) || '';
  if (PORTRAITS.has(ref)) return `assets/portraits/${ref}.webp`;
  if (ref.startsWith('item:')) return itemSrc(ref.slice(5));
  if (ref.startsWith('ini:')) return initialsSrc(ref.slice(4));
  if (ref.startsWith('data:') || ref.startsWith('blob:') || ref.startsWith('assets/')) return ref;
  return '';
}

/** Предмет на карте: иконка на тёмной монете. Хранится как ссылка item:<иконка>, а не как картинка. */
const itemCache = new Map();
function itemSrc(name) {
  if (itemCache.has(name)) return itemCache.get(name);
  const inner = icon(name, 52).replace('<svg ', '<svg x="24" y="24" xmlns="http://www.w3.org/2000/svg" ');
  if (!inner) return '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="49" fill="#2a2419"/><circle cx="50" cy="50" r="44" fill="none" stroke="#e9b052" stroke-opacity=".45" stroke-width="2"/><g color="#f1dcb0">${inner}</g></svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  itemCache.set(name, url);
  return url;
}

/** Портрет-заглушка для своего героя: инициалы на цветном круге (ссылка ini:<имя>). */
function initialsSrc(name) {
  const k = `ini:${name}`;
  if (itemCache.has(k)) return itemCache.get(k);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="hsl(${hueOf(name)} 38% 32%)"/><text x="50" y="63" text-anchor="middle" font-family="Unbounded, Inter, sans-serif" font-weight="600" font-size="36" fill="#fff">${esc(initials(name))}</text></svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  itemCache.set(k, url);
  return url;
}

/** Асинхронно получить адрес (загружает idb:-картинки в кэш). */
export async function resolveSrc(ref) {
  if (ref?.startsWith('sb:')) return remote ? remote.resolve(ref) : '';
  if (!ref?.startsWith('idb:')) return srcOf(ref);
  if (urlCache.has(ref)) return urlCache.get(ref);
  try {
    const db = await idb();
    const blob = await new Promise((res, rej) => {
      const r = db.transaction('images').objectStore('images').get(ref.slice(4));
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
    urlCache.set(ref, url);
    return url;
  } catch { return ''; }
}

/**
 * Сохранить загруженный файл карты. Возвращает {ref, width, height}.
 * С campaignId в серверном режиме файл уходит в хранилище кампании (загружать может только мастер).
 */
export async function storeImage(file, { campaignId = null } = {}) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Нужна картинка: JPG, PNG или WebP.');
  if (file.size > 25 * 1024 * 1024) throw new Error('Файл больше 25 МБ — уменьшите карту.');
  const bitmap = await createImageBitmap(file);
  const maxSide = 6000;
  let { width, height } = bitmap;
  let blob = file;
  if (Math.max(width, height) > maxSide) {
    const k = maxSide / Math.max(width, height);
    width = Math.round(width * k); height = Math.round(height * k);
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
  }
  bitmap.close?.();
  if (remote && campaignId) return { ref: await remote.upload(campaignId, blob), width, height };
  const id = crypto.randomUUID();
  const db = await idb();
  await new Promise((res, rej) => {
    const tx = db.transaction('images', 'readwrite');
    tx.objectStore('images').put(blob, id);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
  const ref = `idb:${id}`;
  urlCache.set(ref, URL.createObjectURL(blob));
  return { ref, width, height };
}
