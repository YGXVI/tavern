// Edge Function validate-build (P4b, #202). Пересчитывает сборку героя тем же движком, что и конструктор
// (rules/build-check.js), и, если сборка честная, вызывает команду листа от имени игрока с секретным заголовком.
// Прав администратора нет: запросы идут с токеном самого игрока, RLS и проверки команд работают как обычно.
// deps — { check: {checkCreate, checkLevelUp}, catalogues, env: {url, anonKey, key}, fetch }: так обработчик проверяется без сети.
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const RPC = { create: 'create_character_sheet', level_up: 'level_up_character' };
const ARGS = { create: ['p_campaign', 'p_character', 'p_operation', 'p_payload', 'p_claim'], level_up: ['p_campaign', 'p_character', 'p_expected_version', 'p_operation', 'p_payload'] };

export async function handle(req, { check, catalogues, env, fetch: f }) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { message: 'Нужен POST' });
  const auth = req.headers.get('Authorization');
  if (!auth) return json(401, { message: 'Нужен вход' });
  let body;
  try { body = await req.json(); } catch { return json(400, { message: 'Нужен JSON' }); }
  const { kind, args } = body || {};
  if (!RPC[kind] || !args || typeof args !== 'object') return json(400, { message: 'Нужны kind и args' });
  const clean = Object.fromEntries(ARGS[kind].filter((k) => k in args).map((k) => [k, args[k]]));
  const headers = { apikey: env.anonKey, Authorization: auth, 'Content-Type': 'application/json' };

  // Политика кампании — из самой кампании, с правами игрока: посторонний её не прочитает.
  const camp = await f(`${env.url}/rest/v1/campaigns?id=eq.${encodeURIComponent(String(clean.p_campaign))}&select=data`, { headers });
  const rows = camp.ok ? await camp.json() : [];
  if (!rows.length) return json(403, { message: 'Кампания недоступна' });
  const policy = rows[0].data?.creationPolicy || null;

  const r = kind === 'create' ? check.checkCreate(clean.p_payload, catalogues, { policy }) : check.checkLevelUp(clean.p_payload, catalogues, { policy });
  if (!r.ok) return json(422, { ok: false, errors: r.errors });

  const res = await f(`${env.url}/rest/v1/rpc/${RPC[kind]}`, { method: 'POST', headers: { ...headers, 'x-build-check': env.key }, body: JSON.stringify(clean) });
  return new Response(await res.text(), { status: res.status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
