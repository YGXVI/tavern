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
