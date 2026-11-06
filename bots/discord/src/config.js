// Настройки бота из окружения (.env рядом с package.json или переменные процесса).
// Токен и записи никогда не попадают в Git: .env и каталог записей вне репозитория.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Корень репозитория tavern (bots/discord/src → ../../..). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const ENV_NAMES = {
  token: 'DISCORD_TOKEN',
  clientId: 'DISCORD_CLIENT_ID',
  guildId: 'DISCORD_GUILD_ID',
};

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

export function loadConfig(env = process.env) {
  const silenceMs = Number(env.SEGMENT_SILENCE_MS || 1000);
  return {
    token: env.DISCORD_TOKEN || '',
    clientId: env.DISCORD_CLIENT_ID || '',
    guildId: env.DISCORD_GUILD_ID || '',
    masterUserIds: list(env.MASTER_USER_IDS),
    masterRoleId: env.MASTER_ROLE_ID || '',
    // Только для проверок на тестовом сервере: боты-«дикторы», которые не могут нажать кнопку согласия.
    testSpeakerBotIds: list(env.TEST_SPEAKER_BOT_IDS),
    recordingsDir: path.resolve(env.RECORDINGS_DIR || path.join(os.homedir(), '.rasputye-bots', 'recordings')),
    silenceMs: Number.isFinite(silenceMs) && silenceMs >= 200 ? silenceMs : 1000,
  };
}

/** Проверка обязательных настроек и безопасного каталога записей. */
export function validateConfig(cfg, keys = ['token']) {
  const missing = keys.filter((k) => !cfg[k]).map((k) => ENV_NAMES[k] || k);
  if (missing.length) throw new Error(`Не заданы настройки: ${missing.join(', ')} (см. .env.example)`);
  if (isInside(cfg.recordingsDir, REPO_ROOT)) {
    throw new Error(`RECORDINGS_DIR не может быть внутри репозитория (${REPO_ROOT}): записи не должны попасть в Git.`);
  }
  return cfg;
}

export function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Подхватить .env из каталога бота, если он есть (Node ≥ 21.7). */
export function loadDotEnv(file = path.join(REPO_ROOT, 'bots', 'discord', '.env')) {
  try { process.loadEnvFile(file); return true; } catch { return false; }
}
