import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { OggOpusWriter, oggCrc, opusPacketSamples } from '../src/recorder/ogg.js';
import { demux, decodedSeconds, hasFfmpeg, opusPackets, tempDir } from './helpers.js';

test('CRC Ogg совпадает с эталоном (CRC-32/MPEG-2 без инверсий)', () => {
  // Эталон для "123456789" при poly 0x04C11DB7, init 0, без отражения и финального XOR.
  assert.equal(oggCrc(Buffer.from('123456789')), 0x89a1897f);
});

test('длительность пакета Opus по TOC', () => {
  assert.equal(opusPacketSamples(Buffer.from([0xf8, 0xff, 0xfe])), 960, 'кадр тишины Discord — CELT 20 мс');
  assert.equal(opusPacketSamples(Buffer.from([0x78])), 960, 'SILK 20 мс');
  assert.equal(opusPacketSamples(Buffer.from([0xf9])), 1920, 'два кадра по 20 мс');
  assert.equal(opusPacketSamples(Buffer.from([0xfb, 0x03])), 2880, 'код 3: три кадра');
  assert.equal(opusPacketSamples(Buffer.alloc(0)), 0);
});

test('Ogg читается независимым парсером: заголовок и пакеты сохраняются', async () => {
  const packets = [Buffer.from([0xf8, 0xff, 0xfe]), Buffer.alloc(300, 0x7c), Buffer.from([0xf8, 1, 2, 3])];
  packets[1][0] = 0xfc; // CELT 20 мс, длинный пакет с лейсингом 255 + 45
  const file = path.join(tempDir(), 'a.ogg');
  const writer = new OggOpusWriter();
  await pipeline(Readable.from(packets, { objectMode: true }), writer, fs.createWriteStream(file));
  const parsed = await demux(fs.readFileSync(file));
  assert.equal(parsed.head.toString('ascii', 0, 8), 'OpusHead');
  assert.equal(parsed.length, 3);
  parsed.forEach((p, i) => assert.ok(p.equals(packets[i])));
  assert.equal(writer.packets, 3);
  assert.equal(writer.samples, 2880);
});

test('настоящий Opus после переупаковки декодируется ffmpeg без потерь длительности', { skip: !hasFfmpeg && 'нет ffmpeg с libopus' }, async () => {
  const packets = await opusPackets(2);
  const file = path.join(tempDir(), 'b.ogg');
  await pipeline(Readable.from(packets, { objectMode: true }), new OggOpusWriter(), fs.createWriteStream(file));
  const seconds = decodedSeconds(file);
  assert.ok(Math.abs(seconds - 2) < 0.05, `длительность ${seconds} с`);
});
