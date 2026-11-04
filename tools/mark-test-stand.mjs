// Тестовый стенд (DEC-018, #204): готовит копию dist/ к выкладке ветки test на rasputye-test.vercel.app.
// 1) Выключает серверный режим: стенд работает только песочницей и не трогает живую базу,
//    пока для test нет своей базы Supabase.
// 2) Ставит плашку «Тестовый стенд · <sha>» и запрет индексации, чтобы стенд не путали с сайтом.
// Меняет файлы на месте — запускать только в CI на свежем checkout, не в рабочей копии.
// Запуск: node tools/mark-test-stand.mjs [папка dist] [метка версии]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] || 'dist';
const label = String(process.argv[3] || 'test').replace(/[^\w. -]/g, '').slice(0, 40) || 'test';

function patch(file, pairs) {
  const path = join(dir, file);
  let text = readFileSync(path, 'utf8');
  for (const [from, to] of pairs) {
    const count = text.split(from).length - 1;
    if (count !== 1) throw new Error(`${file}: ожидалось одно место «${from}», найдено ${count}`);
    text = text.replace(from, to);
  }
  writeFileSync(path, text);
}

patch('js/server/config.js', [[
  "return SERVER_ENABLED || localStorage.getItem(PREVIEW_KEY) === '1';",
  'return false; // тестовый стенд: только песочница, живая база не трогается',
]]);

const banner = `<div aria-hidden="true" style="position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:none;padding:2px 10px;border-radius:999px;background:rgba(190,52,36,.9);color:#fff;font:600 11px/18px system-ui,sans-serif;letter-spacing:.02em">Тестовый стенд · ${label}</div>`;
patch('index.html', [
  ['<head>', '<head>\n  <meta name="robots" content="noindex, nofollow">'],
  ['</body>', `${banner}\n</body>`],
]);

console.log(`Тестовый стенд: серверный режим выключен, плашка «${label}» поставлена.`);
