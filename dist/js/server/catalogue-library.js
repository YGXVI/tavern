// TASK-129 B: personal records, separate from campaign Realtime and Creature.
import { assertPrivateCatalogueEntry, CATALOGUE_KINDS } from '../rules/catalogue.js';

const FIELDS = 'id,owner_id,kind,data,revision,updated_at';
function queryError(error) {
  if (!error) return;
  if (error.code === '40001') { const conflict = new Error('Запись изменена или удалена. Обновите данные перед сохранением.'); conflict.code = 'CATALOGUE_CONFLICT'; throw conflict; }
  if (/catalogue_entry_quota_used_check/.test(error.message || '')) throw new Error('В личных каталогах уже 500 шаблонов.');
  if (/catalogue_entry_data_64k/.test(error.message || '')) throw new Error('Личная запись больше 64 КиБ в представлении базы.');
  // Backend details may include a rejected private row. Do not propagate prose
  // into caller diagnostics/logs; detailed field errors come from local validation.
  const failure = new Error('Не удалось выполнить запрос личной библиотеки.');
  failure.code = 'CATALOGUE_SERVER_ERROR'; throw failure;
}
function fromRow(row, ownerId) {
  if (!row || row.owner_id !== ownerId) throw new Error('Личная запись недоступна.');
  if (!Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error('Некорректная ревизия личной записи.');
  return assertPrivateCatalogueEntry({ id: row.id, ownerId: row.owner_id, kind: row.kind, data: row.data, revision: row.revision, updatedAt: Date.parse(row.updated_at) });
}

export function createServerCatalogueLibrary(client, ownerId) {
  async function auth() {
    const { data, error } = await client.auth.getUser();
    queryError(error);
    if (!ownerId || data?.user?.id !== ownerId) throw new Error('Пользователь изменился. Войдите снова.');
  }
  return {
    async list({ kind } = {}) {
      if (kind !== undefined && !CATALOGUE_KINDS.includes(kind)) throw new TypeError('Неизвестный вид каталога.');
      await auth();
      let request = client.from('user_catalogue_entries').select(FIELDS).eq('owner_id', ownerId);
      if (kind) request = request.eq('kind', kind);
      const { data, error } = await request.order('updated_at', { ascending: false }).limit(500);
      queryError(error);
      return (data || []).map(row => {
        const value = fromRow(row, ownerId);
        if (kind && value.kind !== kind) throw new Error('Получен другой вид каталога.');
        return value;
      });
    },
    async save(value) {
      const entry = assertPrivateCatalogueEntry(value);
      if (entry.ownerId !== ownerId) throw new Error('Нельзя сохранить чужую запись.');
      await auth();
      const { data, error } = await client.rpc('save_catalogue_entry', { p_id: entry.id, p_kind: entry.kind, p_data: entry.data, p_revision: entry.revision, p_owner: ownerId });
      queryError(error);
      if (!Array.isArray(data) || data.length !== 1) throw new Error('Сохранение записи не подтверждено.');
      const saved = fromRow(data[0], ownerId);
      if (saved.id !== entry.id || saved.kind !== entry.kind || saved.revision !== entry.revision + 1) throw new Error('Некорректное подтверждение сохранения.');
      return saved;
    },
    async remove(id, revision) {
      if (typeof id !== 'string' || !/^[A-Za-z0-9_:-]{1,128}$/.test(id) || !Number.isSafeInteger(revision) || revision < 1) throw new TypeError('Нужны ID и ожидаемая ревизия записи.');
      await auth();
      const { data, error } = await client.rpc('delete_catalogue_entry', { p_id: id, p_revision: revision, p_owner: ownerId });
      queryError(error);
      if (data !== id) throw new Error('Удаление записи не подтверждено.');
      return true;
    },
  };
}
