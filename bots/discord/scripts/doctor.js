// Самопроверка перед живым запуском: npm run doctor
import { REST } from 'discord.js';
import { generateDependencyReport } from '@discordjs/voice';
import { loadConfig, loadDotEnv } from '../src/config.js';
import { formatReport, localChecks, remoteChecks } from '../src/core/doctor.js';

const hadEnv = loadDotEnv();
const cfg = loadConfig();
const results = localChecks(cfg);
if (!hadEnv) results.unshift({ level: 'warn', title: 'Файл .env не найден рядом с package.json', detail: 'Настройки берутся из переменных окружения.' });
if (cfg.token) results.push(...await remoteChecks(cfg, new REST().setToken(cfg.token)));

console.log(formatReport(results));
console.log('\nГолосовые зависимости (Opus-кодек для записи не нужен — пакеты пишутся без перекодирования):');
console.log(generateDependencyReport());
const failed = results.filter((r) => r.level === 'fail').length;
console.log(failed ? `Ошибок: ${failed}. Исправьте отмеченное ✗ и повторите.` : 'Готово к npm start.');
process.exitCode = failed ? 1 : 0;
