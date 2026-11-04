// Клиент Supabase: загружается только в серверном режиме, с CDN, точной версией.
import { SUPABASE_URL, SUPABASE_KEY, SUPABASE_LIB } from './config.js';

let promise = null;

/** Клиент Supabase (один на вкладку). Вход — PKCE: после Discord код в адресе обменивается на сессию. */
export function supabase() {
  if (!promise) {
    promise = import(SUPABASE_LIB).then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'rasputye-v2-auth' },
      realtime: { params: { eventsPerSecond: 20 } },
    }));
    promise.catch(() => { promise = null; });
  }
  return promise;
}
