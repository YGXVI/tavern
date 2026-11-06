// #203: у каждого заклинания справочника есть иконка — 256 px для страницы и 64 px для строки галереи.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('../dist/', import.meta.url);
const ids = JSON.parse(readFileSync(new URL('js/data/spells-2014.json', root), 'utf8')).entries.map((e) => e.id.split(':').pop());

// Размер из заголовка WebP (VP8 / VP8L / VP8X) — без сторонних библиотек.
function webpSize(buf) {
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buf.toString('ascii', 8, 12), 'WEBP');
  const kind = buf.toString('ascii', 12, 16);
  if (kind === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1]; }
  if (kind === 'VP8X') return [buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1];
  throw new Error(`неизвестный WebP: ${kind}`);
}

test('иконка есть у всех 524 заклинаний, лишних файлов нет', () => {
  assert.equal(ids.length, 524);
  for (const [dir, size] of [['assets/spells/', 256], ['assets/spells/sm/', 64]]) {
    const missing = ids.filter((id) => !existsSync(new URL(`${dir}${id}.webp`, root)));
    assert.deepEqual(missing, [], `${dir}: нет иконок`);
    const extra = readdirSync(new URL(dir, root)).filter((f) => f.endsWith('.webp') && !ids.includes(f.slice(0, -5)));
    assert.deepEqual(extra, [], `${dir}: лишние файлы`);
    for (const id of [ids[0], ids[ids.length - 1], '204']) {
      assert.deepEqual(webpSize(readFileSync(new URL(`${dir}${id}.webp`, root))), [size, size], `${dir}${id}.webp`);
    }
  }
});

test('галерея и страница берут иконку по номеру dnd.su', () => {
  const src = readFileSync(new URL('js/views/ref/sec-spells.js', root), 'utf8');
  assert.match(src, /assets\/spells\/\$\{small \? 'sm\/' : ''\}/);
  assert.match(src, /class="sp-row-art" src="\$\{spellArt\(it\.id, true\)\}"/);
  assert.match(src, /class="sp-seal-art" src="\$\{spellArt\(it\.id\)\}"/);
});
