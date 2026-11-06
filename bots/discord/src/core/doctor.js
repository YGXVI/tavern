// Самопроверка перед живым запуском: npm run doctor.
// Чистые функции проверяются тестами; сетевые проверки получают rest-клиент снаружи.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PermissionFlagsBits, Routes } from 'discord.js';
import { REPO_ROOT, isInside } from '../config.js';

export const MIN_NODE = '22.12.0';

/** Права приглашения: просмотр каналов, сообщения, подключение к голосу, свой ник. */
export const INVITE_PERMISSIONS = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages
  | PermissionFlagsBits.Connect | PermissionFlagsBits.ChangeNickname;

export function inviteUrl(clientId) {
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands&permissions=${INVITE_PERMISSIONS}`;
}

/** true, если версия a ≥ b (формат x.y.z, допускается префикс v). */
export function versionAtLeast(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return true;
}

const ok = (title, detail = '') => ({ level: 'ok', title, detail });
const warn = (title, detail = '') => ({ level: 'warn', title, detail });
const fail = (title, detail = '') => ({ level: 'fail', title, detail });

/** Проверки без сети. */
export function localChecks(cfg, { nodeVersion = process.version, ffmpeg = 'ffmpeg' } = {}) {
  const out = [];
  out.push(versionAtLeast(nodeVersion, MIN_NODE)
    ? ok(`Node.js ${nodeVersion}`)
    : fail(`Node.js ${nodeVersion} — нужен ${MIN_NODE} или новее`, 'Установите LTS с https://nodejs.org'));

  const missing = [['token', 'DISCORD_TOKEN'], ['clientId', 'DISCORD_CLIENT_ID'], ['guildId', 'DISCORD_GUILD_ID']]
    .filter(([k]) => !cfg[k]).map(([, env]) => env);
  out.push(missing.length ? fail(`Не заданы: ${missing.join(', ')}`, 'Скопируйте .env.example в .env и заполните') : ok('Настройки .env заполнены'));

  if (!cfg.masterUserIds.length && !cfg.masterRoleId) {
    out.push(warn('Мастер не задан явно', 'Управлять записью сможет любой с правом «Управлять сервером». Укажите MASTER_USER_IDS.'));
  } else out.push(ok('Мастер задан'));

  if (isInside(cfg.recordingsDir, REPO_ROOT)) {
    out.push(fail(`Каталог записей внутри репозитория: ${cfg.recordingsDir}`));
  } else {
    try {
      fs.mkdirSync(cfg.recordingsDir, { recursive: true });
      const probe = path.join(cfg.recordingsDir, '.write-test');
      fs.writeFileSync(probe, 'ok');
      fs.rmSync(probe);
      out.push(ok(`Каталог записей доступен: ${cfg.recordingsDir}`));
    } catch (err) {
      out.push(fail(`Каталог записей недоступен: ${cfg.recordingsDir}`, err.message));
    }
  }

  const ff = spawnSync(ffmpeg, ['-hide_banner', '-version'], { encoding: 'utf8' });
  out.push(ff.status === 0
    ? ok(`ffmpeg: ${ff.stdout.split('\n')[0].replace(/^ffmpeg version /, '').split(' ')[0]}`)
    : warn('ffmpeg не найден', 'Нужен только для npm run export (WAV для транскрипции).'));
  return out;
}

/** Проверки через Discord API: токен, приложение, бот на сервере. */
export async function remoteChecks(cfg, rest) {
  const out = [];
  let bot;
  try {
    bot = await rest.get(Routes.user());
    out.push(ok(`Токен действителен: бот ${bot.username} (${bot.id})`));
  } catch (err) {
    out.push(fail('Токен не принят Discord', `${err.status || ''} ${err.message}. Сбросьте токен на вкладке Bot и обновите .env.`));
    return out;
  }
  try {
    const app = await rest.get(Routes.currentApplication());
    out.push(app.id === cfg.clientId
      ? ok(`Приложение совпадает: ${app.name}`)
      : fail(`DISCORD_CLIENT_ID (${cfg.clientId}) не совпадает с приложением токена (${app.id})`));
  } catch (err) {
    out.push(warn('Не удалось прочитать приложение', err.message));
  }
  try {
    const guild = await rest.get(Routes.guild(cfg.guildId));
    out.push(ok(`Бот на сервере «${guild.name}»`));
  } catch (err) {
    out.push(fail(`Бота нет на сервере ${cfg.guildId} или ID неверен`, `Пригласите: ${inviteUrl(cfg.clientId || bot.id)}`));
  }
  try {
    const cmds = await rest.get(Routes.applicationGuildCommands(cfg.clientId, cfg.guildId));
    out.push(cmds.some((c) => c.name === 'rec') ? ok('Команда /rec зарегистрирована') : warn('Команда /rec не зарегистрирована', 'Выполните npm run register'));
  } catch { /* сервер уже отмечен выше */ }
  return out;
}

export function formatReport(results) {
  const mark = { ok: '✓', warn: '!', fail: '✗' };
  return results.map((r) => `${mark[r.level]} ${r.title}${r.detail ? `\n    ${r.detail}` : ''}`).join('\n');
}
