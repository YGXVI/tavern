// TASK-125: direct personal queries, never a campaign realtime subscription.
import { normalizeCreature, validateCreature } from '../rules/creature.js';

const FIELDS = 'id,owner_id,data,updated_at';
export const LIBRARY_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function queryError(error) {
  if (!error) return;
  if (error.code === '23514' && /creature_library_quota_used_check/.test(error.message || '')) throw new Error('В библиотеке уже 500 существ.');
  if (error.code === '23514' && /creature.*64k/.test(error.message || '')) throw new Error('Статблок больше 64 КБ в представлении базы. Уменьшите текст.');
  throw error;
}

export async function validateLibraryImage(file) {
  if (!file || !TYPES[file.type] || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > LIBRARY_IMAGE_MAX_BYTES) {
    throw new TypeError('Нужна картинка PNG, JPEG или WebP до 5 МБ.');
  }
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const match = (offset, signature) => signature.every((v, i) => b[offset + i] === v);
  const valid = file.type === 'image/png' ? match(0, [137, 80, 78, 71, 13, 10, 26, 10])
    : file.type === 'image/jpeg' ? match(0, [255, 216, 255])
      : match(0, [82, 73, 70, 70]) && match(8, [87, 69, 66, 80]);
  if (!valid) throw new TypeError('Содержимое файла не соответствует типу картинки.');
  return TYPES[file.type];
}

function checked(value) {
  const v = validateCreature(value);
  if (!v.valid) { const e = new TypeError('Проверьте поля статблока.'); e.errors = v.errors; throw e; }
  return normalizeCreature(value);
}
function fromRow(row, ownerId) {
  if (!row || row.owner_id !== ownerId) throw new Error('Личная запись недоступна.');
  return checked({ ...row.data, id: row.id, ownerId: row.owner_id, updatedAt: Date.parse(row.updated_at) });
}
function imagePath(ref, ownerId) {
  const prefix = `library:${ownerId}/`;
  if (typeof ref !== 'string' || !ref.startsWith(prefix) || !/^[\w-]+\.(png|jpg|jpeg|webp)$/.test(ref.slice(prefix.length))) {
    throw new Error('Изображение не из вашей библиотеки.');
  }
  return ref.slice('library:'.length);
}

/** Injectable Supabase client; caller creates a new facade for each current user. */
export function createServerLibrary(client, ownerId) {
  async function auth() {
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    if (!ownerId || data?.user?.id !== ownerId) throw new Error('Пользователь изменился. Войдите снова.');
  }
  return {
    async list() {
      await auth();
      const { data, error } = await client.from('creatures').select(FIELDS).eq('owner_id', ownerId).order('updated_at', { ascending: false }).limit(500);
      if (error) throw error;
      return (data || []).map(row => fromRow(row, ownerId));
    },
    async save(value) {
      const c = checked(value);
      if (c.ownerId !== ownerId) throw new Error('Нельзя сохранить чужую запись.');
      await auth();
      const { id, ownerId: uid, updatedAt, ...data } = c;
      const result = await client.from('creatures').upsert({ id, owner_id: uid, data }, { onConflict: 'id' }).select(FIELDS).single();
      queryError(result.error);
      return fromRow(result.data, ownerId);
    },
    async remove(id) {
      await auth();
      const { data, error } = await client.from('creatures').delete().eq('id', id).eq('owner_id', ownerId).select('id');
      if (error) throw error;
      if (data?.length !== 1) throw new Error('Запись не найдена или недоступна.');
      return true;
    },
    async uploadImage(file) {
      const ext = await validateLibraryImage(file);
      await auth();
      const path = `${ownerId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await client.storage.from('library').upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      return `library:${path}`;
    },
    async resolveImage(ref) {
      const path = imagePath(ref, ownerId);
      await auth();
      const { data, error } = await client.storage.from('library').createSignedUrl(path, 60);
      if (error) throw error;
      if (!data?.signedUrl) throw new Error('Не удалось получить изображение.');
      return data.signedUrl;
    },
    async removeImage(ref) {
      const path = imagePath(ref, ownerId);
      await auth();
      const { error } = await client.storage.from('library').remove([path]);
      if (error) throw error;
      return true;
    },
  };
}
