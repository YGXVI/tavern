// Тестовый стенд (#204): скрипт подготовки dist/ находит свои места в текущих файлах,
// выключает серверный режим и ставит плашку. Ломается здесь раньше, чем выкладка test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('mark-test-stand: только песочница, плашка и запрет индексации', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stand-'));
  try {
    cpSync('dist/index.html', join(dir, 'index.html'));
    cpSync('dist/js/server/config.js', join(dir, 'js/server/config.js'));
    execFileSync(process.execPath, ['tools/mark-test-stand.mjs', dir, 'abc1234'], { stdio: 'pipe' });
    const config = readFileSync(join(dir, 'js/server/config.js'), 'utf8');
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    assert.match(config, /return false; \/\/ тестовый стенд/);
    assert.doesNotMatch(config, /localStorage\.getItem\(PREVIEW_KEY\) === '1'/);
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(html, /Тестовый стенд · abc1234<\/div>\n<\/body>/);
    assert.equal(readFileSync('dist/index.html', 'utf8').includes('Тестовый стенд'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function markStand(env) {
  const dir = mkdtempSync(join(tmpdir(), 'stand-'));
  cpSync('dist/index.html', join(dir, 'index.html'));
  cpSync('dist/js/server/config.js', join(dir, 'js/server/config.js'));
  const clean = { ...process.env };
  delete clean.TEST_SUPABASE_URL; delete clean.TEST_SUPABASE_KEY;
  try {
    execFileSync(process.execPath, ['tools/mark-test-stand.mjs', dir, 'abc1234'], { stdio: 'pipe', env: { ...clean, ...env } });
    return readFileSync(join(dir, 'js/server/config.js'), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const TEST_URL = 'https://abcdefghijklmnopqrst.supabase.co';
const TEST_KEY = 'sb_publishable_TestStandKey_123';

test('mark-test-stand: с тестовой базой стенд включает сервер и не содержит боевых адреса и ключа', () => {
  const prod = readFileSync('dist/js/server/config.js', 'utf8');
  const prodKey = prod.match(/SUPABASE_KEY = '([^']+)'/)[1];
  const config = markStand({ TEST_SUPABASE_URL: `${TEST_URL}/`, TEST_SUPABASE_KEY: TEST_KEY });
  assert.match(config, /export const SERVER_ENABLED = true;/);
  assert.match(config, /return true; \/\/ тестовый стенд: гость без \?guest=1/);
  assert.match(config, new RegExp(`SUPABASE_URL = '${TEST_URL}';`));
  assert.match(config, new RegExp(`SUPABASE_KEY = '${TEST_KEY}';`));
  assert.equal(config.includes('ilsuespohsuligyiqjsx'), false);
  assert.equal(config.includes(prodKey), false);
});

test('mark-test-stand: отказывает боевой базе, служебному ключу и половине настроек', () => {
  const fails = env => assert.throws(() => markStand(env), /Command failed/);
  fails({ TEST_SUPABASE_URL: 'https://ilsuespohsuligyiqjsx.supabase.co', TEST_SUPABASE_KEY: TEST_KEY });
  fails({ TEST_SUPABASE_URL: TEST_URL, TEST_SUPABASE_KEY: 'sb_secret_abc' });
  fails({ TEST_SUPABASE_URL: TEST_URL, TEST_SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiJ9.x.y' });
  fails({ TEST_SUPABASE_URL: 'https://evil.example.com', TEST_SUPABASE_KEY: TEST_KEY });
  fails({ TEST_SUPABASE_URL: TEST_URL });
});
