import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createClock, formatOffset, sessionDirName } from '../src/util/time.js';
import { loadConfig, validateConfig, isInside, REPO_ROOT } from '../src/config.js';
import { isMaster } from '../src/core/permissions.js';
import { buildCommands, consentRow, CONSENT_NO, CONSENT_YES, SUBCOMMANDS } from '../src/core/commands.js';
import { Manifest, readManifest } from '../src/recorder/manifest.js';
import { tempDir } from './helpers.js';
import fs from 'node:fs';

test('таймкод форматируется как ЧЧ:ММ:СС.ммм', () => {
  assert.equal(formatOffset(0), '00:00:00.000');
  assert.equal(formatOffset(3_723_456), '01:02:03.456');
  assert.equal(formatOffset(4 * 3_600_000 + 5), '04:00:00.005');
  assert.equal(formatOffset(-10), '00:00:00.000');
});

test('часы сессии монотонны и не зависят от системного времени', () => {
  let mono = 1000;
  const clock = createClock({ now: () => mono, wall: () => Date.UTC(2026, 10, 2, 10, 30) });
  assert.equal(clock.startedAtUtc, '2026-11-02T10:30:00.000Z');
  mono += 1500;
  assert.equal(clock.elapsed(), 1500);
});

test('имя каталога сессии: время UTC и сервер', () => {
  assert.equal(sessionDirName('2026-11-02T10:30:05.123Z', '42'), '20261102-103005-42');
});

test('настройки: списки, каталог записей по умолчанию вне репозитория', () => {
  const cfg = loadConfig({ DISCORD_TOKEN: 't', MASTER_USER_IDS: '1, 2,,3', SEGMENT_SILENCE_MS: '50' });
  assert.deepEqual(cfg.masterUserIds, ['1', '2', '3']);
  assert.equal(cfg.silenceMs, 1000, 'слишком короткая тишина заменяется значением по умолчанию');
  assert.equal(cfg.recordingsDir, path.join(os.homedir(), '.rasputye-bots', 'recordings'));
  assert.doesNotThrow(() => validateConfig(cfg));
});

test('настройки: без токена и с каталогом записей в репозитории — ошибка', () => {
  assert.throws(() => validateConfig(loadConfig({})), /DISCORD_TOKEN/);
  const inside = loadConfig({ DISCORD_TOKEN: 't', RECORDINGS_DIR: path.join(REPO_ROOT, 'bots', 'recordings') });
  assert.throws(() => validateConfig(inside), /внутри репозитория/);
  assert.ok(isInside('/a/b/c', '/a/b'));
  assert.ok(!isInside('/a/bc', '/a/b'));
});

const member = ({ id = 'u1', roles = [], manage = false } = {}) => ({
  id,
  roles: { cache: new Set(roles) },
  permissions: { has: () => manage },
});

test('мастер: по ID, по роли, иначе по праву «Управлять сервером»', () => {
  const base = loadConfig({});
  assert.ok(isMaster(member({ manage: true }), base));
  assert.ok(!isMaster(member(), base));
  const byId = loadConfig({ MASTER_USER_IDS: 'u1' });
  assert.ok(isMaster(member({ id: 'u1' }), byId));
  assert.ok(!isMaster(member({ id: 'u2', manage: true }), byId), 'при заданном списке право сервера не даёт управления');
  const byRole = loadConfig({ MASTER_ROLE_ID: 'r1' });
  assert.ok(isMaster(member({ roles: ['r1'] }), byRole));
  assert.ok(!isMaster(member({ manage: true }), byRole));
  assert.ok(!isMaster(null, base));
});

test('команда /rec содержит все подкоманды; кнопки согласия', () => {
  const [rec] = buildCommands();
  assert.equal(rec.name, 'rec');
  assert.deepEqual(rec.options.map((o) => o.name), Object.keys(SUBCOMMANDS));
  const row = consentRow().toJSON();
  assert.deepEqual(row.components.map((c) => c.custom_id), [CONSENT_YES, CONSENT_NO]);
});

test('манифест: построчный JSONL, оборванная строка пропускается', () => {
  const file = path.join(tempDir(), 'manifest.jsonl');
  const m = new Manifest(file);
  m.write({ t: 0, type: 'session_start' });
  m.write({ t: 5, type: 'pause' });
  fs.appendFileSync(file, '{"t":7,"type":"res');
  assert.deepEqual(readManifest(file).map((e) => e.type), ['session_start', 'pause']);
});
