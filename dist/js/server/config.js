// Серверный режим (TASK-002, DEC-014): Supabase — вход через Discord, данные кампаний, реальное время, карты.
// Публичный (publishable) ключ можно хранить в браузере: доступ к данным ограничивают правила RLS в базе.
// Служебный ключ сюда НЕ кладётся никогда.

/** Включает серверный режим для всех. Откат — false: сайт работает только песочницей, данные на сервере не трогаются. */
export const SERVER_ENABLED = false;

export const SUPABASE_URL = 'https://ilsuespohsuligyiqjsx.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_DFLExjmVBTpbWHkk6UTMrw_n56O6eQw';
/** supabase-js с точной версией (вышла 15.10.2026), ES-модулем с jsDelivr — сборщик не нужен (DEC-002). */
export const SUPABASE_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';

const PREVIEW_KEY = 'rasputye-server-preview';
const MODE_KEY = 'rasputye-v2-mode';

/**
 * Пока флаг выключен, сервер можно включить для своего браузера ссылкой `?server=1` (выключить — `?server=0`):
 * так проверяют вход на живом сайте до переключения для всех.
 */
export function serverAllowed() {
  try {
    const q = new URLSearchParams(location.search).get('server');
    if (q === '1') localStorage.setItem(PREVIEW_KEY, '1');
    if (q === '0') { localStorage.removeItem(PREVIEW_KEY); sessionStorage.removeItem(MODE_KEY); }
    return SERVER_ENABLED || localStorage.getItem(PREVIEW_KEY) === '1';
  } catch { return SERVER_ENABLED; }
}

/** Режим вкладки: 'server' — настоящий вход и данные на сервере; 'sandbox' — локальная песочница. */
export function getMode() {
  if (!serverAllowed()) return 'sandbox';
  try { return sessionStorage.getItem(MODE_KEY) || 'server'; } catch { return 'server'; }
}
export function setMode(mode) { try { sessionStorage.setItem(MODE_KEY, mode); } catch { /* приватный режим */ } }

/** Ссылка-приглашение. Пока сервер включён не для всех, ссылка из серверной кампании включает его и у друга. */
export function joinUrl(code, serverMode) {
  const q = serverMode && !SERVER_ENABLED ? '?server=1' : '';
  return `${location.origin}${location.pathname}${q}#/join/${code}`;
}
