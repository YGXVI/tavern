// Своя картинка существа (#190 E): одна и та же картинка проходит путь «карточка за столом → «Мои существа» → снова
// на карту в любой кампании». Где она лежит:
// - песочница — в браузере (idb:), одна ссылка годится везде;
// - сервер, личная библиотека — бакет library (library:<владелец>/<файл>), видит только владелец;
// - сервер, кампания — бакет tokens (sb:@tokens/<кампания>/<кто загрузил>/<файл>), видят участники кампании.
// Поэтому на карту личная картинка попадает копией в кампанию, а в библиотеку — копией из выбранного файла.
import { srcOf, resolveSrc } from '../core/assets.js';
import { isServerMode } from '../core/store.js';

/** Выбрать файл картинки: PNG, JPEG или WebP до 5 МБ. done(file) — только если файл подходит. */
export function pickImageFile(toast, done) {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
  input.addEventListener('change', () => {
    const f = input.files?.[0]; if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type) || f.size > 5 * 1024 * 1024) { toast({ title: 'Нужна картинка PNG, JPEG или WebP до 5 МБ', icon: 'alert-circle' }); return; }
    done(f);
  });
  input.click();
}

export const isLibRef = (ref) => typeof ref === 'string' && ref.startsWith('library:');
/** Своя ли это картинка (а не инициалы, портрет из набора или значок предмета). */
export const isOwnImage = (ref) => typeof ref === 'string' && /^(library:|idb:|sb:|blob:|data:)/.test(ref);

// Файл личной картинки скачиваем один раз за сессию: ссылка с подписью живёт минуту, а картинка нужна дольше.
const blobs = new Map(); // ref → Promise<Blob>
const urls = new Map();  // ref → objectURL
function libBlob(ref) {
  if (!blobs.has(ref)) {
    const p = (async () => {
      const { resolveLibraryImage } = await import('../core/library.js');
      const signed = await resolveLibraryImage(ref);
      const res = await fetch(signed);
      if (!res.ok) throw new Error('Картинка из библиотеки недоступна');
      return res.blob();
    })();
    p.catch(() => blobs.delete(ref)); // неудача — спросим снова в следующий раз
    blobs.set(ref, p);
  }
  return blobs.get(ref);
}

/** Адрес для <img>: личную картинку библиотеки — через подписанную ссылку, остальное — как обычно. */
export async function imageUrl(ref) {
  if (!ref) return '';
  if (!isLibRef(ref)) return srcOf(ref) || resolveSrc(ref);
  if (urls.has(ref)) return urls.get(ref);
  const url = URL.createObjectURL(await libBlob(ref));
  urls.set(ref, url);
  return url;
}

/** Картинка существа в разметке: сразу инициалы, затем своя (hydrate). */
export function creatureImgTag(ref, name, cls = '') {
  const own = ref && !String(ref).startsWith('ini:') ? ref : '';
  const now = own && !isLibRef(own) ? srcOf(own) : '';
  return `<img class="${cls}" alt="" draggable="false" src="${escAttr(now || srcOf(`ini:${name || '?'}`))}"${own && !now ? ` data-img-ref="${escAttr(own)}"` : ''}>`;
}
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Дорисовать картинки, помеченные data-img-ref (и data-ref с личной ссылкой). */
export function hydrateCreatureImages(root) {
  for (const img of root.querySelectorAll('img[data-img-ref]')) {
    const ref = img.dataset.imgRef;
    imageUrl(ref).then((u) => { if (u && img.dataset.imgRef === ref) img.src = u; }).catch(() => {});
  }
}

/**
 * Картинка для кампании: личную (library:) копируем в бакет кампании — иначе её увидит только хозяин библиотеки.
 * store(blob) → ссылка кампании (storeTokenImage стола). Одна копия на кампанию и картинку за сессию.
 */
const copies = new Map(); // `${cid}|${ref}` → Promise<ref>
export function campaignImage(cid, ref, store) {
  if (!isLibRef(ref) || !isServerMode()) return Promise.resolve(ref || '');
  const k = `${cid}|${ref}`;
  if (!copies.has(k)) {
    // Хранилище может отдать файл без типа — берём его из расширения: бакет кампании принимает только PNG/JPEG/WebP.
    const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[String(ref).split('.').pop().toLowerCase()];
    const p = libBlob(ref).then((b) => store(type && b.type !== type ? new Blob([b], { type }) : b));
    p.catch(() => copies.delete(k));
    copies.set(k, p);
  }
  return copies.get(k);
}

/**
 * Картинку из файла — в личную библиотеку. Песочница: та же ссылка, что у токена (браузер один). Сервер: файл
 * загружается в бакет library. Без файла (картинку выбрали раньше) — пусто: в библиотеку уйдут инициалы.
 */
/**
 * Убрать из личного бакета картинки, которые больше ни у кого не стоят (заменили, убрали, загрузили и передумали).
 * Сервер сам проверяет при удалении, что на картинку никто не ссылается, — занятая останется. Только сервер.
 */
export async function dropLibraryImages(refs) {
  const list = [...new Set(refs)].filter(isLibRef);
  if (!list.length || !isServerMode()) return;
  const { removeLibraryImage } = await import('../core/library.js');
  for (const ref of list) { try { await removeLibraryImage(ref); } catch { /* занята или уже удалена */ } }
}

export async function libraryImageFrom(file, sandboxRef = '') {
  if (!isServerMode()) return sandboxRef && !isLibRef(sandboxRef) ? sandboxRef : '';
  if (!file) return '';
  const { uploadLibraryImage } = await import('../core/library.js');
  return uploadLibraryImage(file);
}
