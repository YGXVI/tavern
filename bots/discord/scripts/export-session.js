// Подготовка записи к транскрипции: npm run export -- <каталог сессии>
// Создаёт segments.json и wav/<discordId>/<seq>.wav (16 кГц mono). Нужен ffmpeg в PATH (или FFMPEG=путь).
import path from 'node:path';
import { exportSession } from '../src/recorder/export.js';
import { formatOffset } from '../src/util/time.js';

const dir = process.argv[2];
if (!dir) {
  console.error('Укажите каталог сессии: npm run export -- <каталог>');
  process.exit(1);
}
const index = await exportSession(path.resolve(dir), { ffmpeg: process.env.FFMPEG || 'ffmpeg' });
const failed = index.segments.filter((s) => s.error);
for (const s of index.segments) {
  console.log(`${formatOffset(s.startMs)}  ${s.name}  ${s.wav || s.error}`);
}
console.log(`Фрагментов: ${index.segments.length}, ошибок: ${failed.length}. Индекс: ${path.join(dir, 'segments.json')}`);
process.exitCode = failed.length ? 2 : 0;
