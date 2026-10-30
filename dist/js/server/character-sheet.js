// TASK-004: отдельный подтверждаемый путь листа. Не подключается к sync.js автоматически.
import { supabase } from './client.js';

const KINDS = new Set(['patch', 'set_current', 'adjust', 'rest', 'growth', 'controller', 'archive', 'restore']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGES = {
  conflict: 'Лист изменился. Перечитайте данные и проверьте свой ввод.',
  forbidden: 'Нет права на эту операцию.', not_found: 'Лист не найден.', archived: 'Лист находится в архиве.',
  validation: 'Проверьте введённые значения.', unavailable: 'Серверный путь листа ещё не установлен.',
  network: 'Ответ сервера не получен. Повторите тот же запрос или проверьте данные.',
  protocol: 'Сервер вернул неожиданный ответ.', server: 'Сервер отклонил операцию.',
};

export class SheetCommandError extends Error {
  constructor(kind, { request = null, cause = null, details = null } = {}) {
    super(MESSAGES[kind] || MESSAGES.server, { cause });
    this.name = 'SheetCommandError'; this.kind = kind; this.request = request; this.details = details;
    this.retryable = kind === 'network' || kind === 'protocol';
  }
}

function versionString(value) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) throw new TypeError('Нужна безопасная версия');
  if (!['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value))) throw new TypeError('Нужна ожидаемая версия');
  const version = BigInt(value);
  if (version > 9223372036854775807n) throw new TypeError('Версия вне диапазона');
  return version.toString();
}

function assertJson(value) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { for (const item of value) assertJson(item); return; }
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    Object.values(value).forEach(assertJson); return;
  }
  throw new TypeError('Команда должна содержать только JSON-значения');
}

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** Сохраните полученную команду до ACK. При сетевой ошибке не создавайте новый operationId. */
export function makeSheetCommand({ campaignId, characterId, version, kind, payload = {}, operationId = crypto.randomUUID() }) {
  if (typeof campaignId !== 'string' || !campaignId || typeof characterId !== 'string' || !characterId) throw new TypeError('Нужны ID кампании и листа');
  if (!KINDS.has(kind) || typeof operationId !== 'string' || !UUID.test(operationId)) throw new TypeError('Нужны вид и UUID операции');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('Нужен объект данных');
  assertJson(payload);
  return freeze({ campaignId, characterId, version: versionString(version), kind, payload: structuredClone(payload), operationId: operationId.toLowerCase() });
}

function serverError(error, request) {
  const kind = ({ '40001': 'conflict', '42501': 'forbidden', P0002: 'not_found', P0001: 'archived',
    '22023': 'validation', '22P02': 'validation', '22003': 'validation', '23503': 'validation', '42883': 'unavailable',
    PGRST202: 'unavailable', PGRST301: 'forbidden', PGRST302: 'forbidden', PGRST303: 'forbidden',
    PGRST000: 'network', PGRST001: 'network', PGRST002: 'network', PGRST003: 'network' })[error?.code]
    || (!error?.code ? 'network' : 'server');
  let details = error?.details ?? null;
  if (typeof details === 'string') { try { details = JSON.parse(details); } catch { /* текст диагностики остаётся текстом */ } }
  return new SheetCommandError(kind, { request, cause: error, details });
}

function checkedSheet(sheet, request) {
  if (!sheet || typeof sheet !== 'object' || typeof sheet.data !== 'object' || sheet.data === null || Array.isArray(sheet.data)
    || sheet.id !== request.characterId || sheet.campaignId !== request.campaignId) throw new SheetCommandError('protocol', { request });
  try { versionString(sheet.version); } catch { throw new SheetCommandError('protocol', { request }); }
  return sheet;
}

export function createCharacterSheetClient(getClient = supabase) {
  async function rpc(name, args, request) {
    let result;
    try { result = await (await getClient()).rpc(name, args); }
    catch (cause) { throw new SheetCommandError('network', { request, cause }); }
    if (result?.error) throw serverError(result.error, request);
    return result?.data;
  }
  async function read(campaignId, characterId) {
    const request = { campaignId, characterId };
    return checkedSheet(await rpc('read_character_sheet', { p_campaign: campaignId, p_character: characterId }, request), request);
  }
  async function execute(input) {
    const request = makeSheetCommand(input);
    const data = await rpc('character_command', {
      p_campaign: request.campaignId, p_character: request.characterId, p_expected_version: request.version,
      p_operation: request.operationId, p_kind: request.kind, p_payload: request.payload,
    }, request);
    if (data?.ok !== true || data.operationId !== request.operationId || typeof data.replayed !== 'boolean') throw new SheetCommandError('protocol', { request });
    checkedSheet(data.sheet, request);
    // Повтор возвращает исторический ACK; не заменяем более новый лист старым снимком.
    const appliedVersion = versionString(data.sheet.version);
    if (!data.replayed) return { ...data, appliedVersion };
    try { return { ...data, appliedVersion, sheet: await read(request.campaignId, request.characterId) }; }
    catch (error) { if (error instanceof SheetCommandError) error.request = request; throw error; }
  }
  async function retry(error) {
    if (!(error instanceof SheetCommandError) || !error.retryable || !error.request?.operationId) throw new TypeError('Нет безопасного запроса для повтора');
    return execute(error.request);
  }
  return { read, execute, retry };
}
