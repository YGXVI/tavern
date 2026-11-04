// Тестовый стенд (DEC-018, #204): готовит копию dist/ к выкладке ветки test на dropdice-test.vercel.app.
// 1) База. Если заданы TEST_SUPABASE_URL и TEST_SUPABASE_KEY (переменные репозитория, ключ — только
//    publishable), стенд подключается к ОТДЕЛЬНОМУ тестовому проекту Supabase и серверный режим включён
//    для всех. Без них стенд работает только песочницей. Боевую базу стенд не использует никогда.
// 2) Ставит плашку «Тестовый стенд · <sha>» и запрет индексации, чтобы стенд не путали с сайтом.
// Меняет файлы на месте — запускать только в CI на свежем checkout, не в рабочей копии.
// Запуск: [TEST_SUPABASE_URL=… TEST_SUPABASE_KEY=…] node tools/mark-test-stand.mjs [папка dist] [метка версии]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PROD_URL = 'https://ilsuespohsuligyiqjsx.supabase.co';
const dir = process.argv[2] || 'dist';
const label = String(process.argv[3] || 'test').replace(/[^\w. -]/g, '').slice(0, 40) || 'test';

function patch(file, pairs) {
  const path = join(dir, file);
  let text = readFileSync(path, 'utf8');
  for (const [from, to] of pairs) {
    const count = text.split(from).length - 1;
    if (count !== 1) throw new Error(`${file}: ожидалось одно место «${from}», найдено ${count}`);
    text = text.replace(from, () => to);
  }
  writeFileSync(path, text);
}

/** Проверяет адрес и ключ тестовой базы; возвращает null, если тестовая база не задана. */
function testDatabase(env = process.env) {
  const url = String(env.TEST_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(env.TEST_SUPABASE_KEY || '').trim();
  if (!url && !key) return null;
  if (!url || !key) throw new Error('Нужны оба значения: TEST_SUPABASE_URL и TEST_SUPABASE_KEY.');
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url)) throw new Error(`TEST_SUPABASE_URL не похож на адрес проекта Supabase: ${url}`);
  if (url === PROD_URL) throw new Error('TEST_SUPABASE_URL указывает на боевую базу — стенд её не использует.');
  if (!/^sb_publishable_[\w-]+$/.test(key)) throw new Error('TEST_SUPABASE_KEY должен быть publishable-ключом (sb_publishable_…); служебные ключи в браузер не кладутся.');
  return { url, key };
}

const db = testDatabase();
const config = readFileSync(join(dir, 'js/server/config.js'), 'utf8');
const prodKey = config.match(/export const SUPABASE_KEY = '([^']+)';/)?.[1];
if (db) {
  patch('js/server/config.js', [
    ['export const SERVER_ENABLED = false;', 'export const SERVER_ENABLED = true; // тестовый стенд: своя база Supabase'],
    [`export const SUPABASE_URL = '${PROD_URL}';`, `export const SUPABASE_URL = '${db.url}';`],
    [`export const SUPABASE_KEY = '${prodKey}';`, `export const SUPABASE_KEY = '${db.key}';`],
  ]);
} else {
  patch('js/server/config.js', [[
    "return SERVER_ENABLED || localStorage.getItem(PREVIEW_KEY) === '1';",
    'return false; // тестовый стенд без своей базы: только песочница, живая база не трогается',
  ]]);
}

const banner = `<div aria-hidden="true" style="position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:none;padding:2px 10px;border-radius:999px;background:rgba(190,52,36,.9);color:#fff;font:600 11px/18px system-ui,sans-serif;letter-spacing:.02em">Тестовый стенд · ${label}</div>`;
patch('index.html', [
  ['<head>', '<head>\n  <meta name="robots" content="noindex, nofollow">'],
  ['</body>', `${banner}\n</body>`],
]);

console.log(db
  ? `Тестовый стенд: база ${db.url}, серверный режим включён, плашка «${label}» поставлена.`
  : `Тестовый стенд: тестовой базы нет — только песочница, плашка «${label}» поставлена.`);
