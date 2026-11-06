import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { INVITE_PERMISSIONS, formatReport, inviteUrl, localChecks, remoteChecks, versionAtLeast } from '../src/core/doctor.js';
import { loadConfig, REPO_ROOT } from '../src/config.js';
import { tempDir } from './helpers.js';

test('сравнение версий Node', () => {
  assert.ok(versionAtLeast('v22.12.0', '22.12.0'));
  assert.ok(versionAtLeast('v24.1.0', '22.12.0'));
  assert.ok(!versionAtLeast('v22.11.9', '22.12.0'));
  assert.ok(!versionAtLeast('v20.19.0', '22.12.0'));
});

test('ссылка-приглашение: нужные права и scope', () => {
  assert.equal(INVITE_PERMISSIONS, 68160512n);
  assert.equal(inviteUrl('123'), 'https://discord.com/oauth2/authorize?client_id=123&scope=bot%20applications.commands&permissions=68160512');
});

test('локальные проверки: старый Node, пустой .env, каталог в репозитории', () => {
  const cfg = loadConfig({ RECORDINGS_DIR: path.join(REPO_ROOT, 'rec') });
  const r = localChecks(cfg, { nodeVersion: 'v20.0.0', ffmpeg: 'нет-такой-программы' });
  const fails = r.filter((x) => x.level === 'fail').map((x) => x.title);
  assert.equal(fails.length, 3);
  assert.match(fails.join('\n'), /Node\.js v20/);
  assert.match(fails.join('\n'), /DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID/);
  assert.match(fails.join('\n'), /внутри репозитория/);
  assert.ok(r.some((x) => x.level === 'warn' && /ffmpeg/.test(x.title)));
});

test('локальные проверки проходят при полных настройках', () => {
  const cfg = loadConfig({ DISCORD_TOKEN: 't', DISCORD_CLIENT_ID: 'a', DISCORD_GUILD_ID: 'g', MASTER_USER_IDS: 'm', RECORDINGS_DIR: tempDir() });
  const r = localChecks(cfg, { nodeVersion: 'v22.12.0', ffmpeg: 'нет-такой-программы' });
  assert.equal(r.filter((x) => x.level === 'fail').length, 0);
});

function fakeRest(map) {
  return { get: async (route) => { const v = map[route]; if (v instanceof Error) throw v; if (v === undefined) throw Object.assign(new Error('Missing Access'), { status: 403 }); return v; } };
}

test('удалённые проверки: бот не на сервере — ссылка-приглашение', async () => {
  const cfg = loadConfig({ DISCORD_TOKEN: 't', DISCORD_CLIENT_ID: '42', DISCORD_GUILD_ID: 'g' });
  const r = await remoteChecks(cfg, fakeRest({ '/users/@me': { id: '42', username: 'rasputye' }, '/applications/@me': { id: '42', name: 'Распутье тест' } }));
  assert.deepEqual(r.map((x) => x.level), ['ok', 'ok', 'fail']);
  assert.match(r[2].detail, /client_id=42/);
  assert.match(formatReport(r), /✗ Бота нет на сервере/);
});

test('удалённые проверки: неверный токен останавливает дальнейшие запросы', async () => {
  const cfg = loadConfig({ DISCORD_TOKEN: 't', DISCORD_CLIENT_ID: '42', DISCORD_GUILD_ID: 'g' });
  const r = await remoteChecks(cfg, fakeRest({ '/users/@me': Object.assign(new Error('401: Unauthorized'), { status: 401 }) }));
  assert.equal(r.length, 1);
  assert.equal(r[0].level, 'fail');
});

test('удалённые проверки: всё готово', async () => {
  const cfg = loadConfig({ DISCORD_TOKEN: 't', DISCORD_CLIENT_ID: '42', DISCORD_GUILD_ID: 'g' });
  const r = await remoteChecks(cfg, fakeRest({
    '/users/@me': { id: '42', username: 'rasputye' },
    '/applications/@me': { id: '42', name: 'Распутье тест' },
    '/guilds/g': { name: 'Тест' },
    '/applications/42/guilds/g/commands': [{ name: 'rec' }],
  }));
  assert.deepEqual(r.map((x) => x.level), ['ok', 'ok', 'ok', 'ok']);
});
