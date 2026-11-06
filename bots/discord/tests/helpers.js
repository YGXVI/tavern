// Заглушки для тестов без сети: часы, манифест в памяти, приёмник Discord, пакеты Opus из ffmpeg.
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import prism from 'prism-media';

export function fakeClock(start = 0) {
  let t = start;
  return { startedAtUtc: '2026-11-02T10:30:00.000Z', elapsed: () => t, advance: (ms) => { t += ms; } };
}

export function memoryManifest() {
  const events = [];
  return { events, write: (e) => { events.push(e); return e; } };
}

export class FakeReceiver {
  constructor() {
    this.speaking = Object.assign(new EventEmitter(), { users: new Map() });
    this.streams = new Map();
    this.options = new Map();
  }

  subscribe(userId, options) {
    const s = new PassThrough({ objectMode: true });
    this.streams.set(userId, s);
    this.options.set(userId, options);
    return s;
  }
}

export function tempDir(prefix = 'rasputye-bot-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export const hasFfmpeg = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout?.includes('libopus') ?? false;

/** Настоящие пакеты Opus 48 кГц stereo, 20 мс: синус seconds секунд. */
export async function opusPackets(seconds = 1) {
  const dir = tempDir('rasputye-opus-');
  const file = path.join(dir, 'src.ogg');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-ac', '2', '-ar', '48000', '-c:a', 'libopus', '-frame_duration', '20', file]);
  return demux(fs.readFileSync(file));
}

/** Разобрать .ogg независимым парсером prism-media. */
export function demux(buffer) {
  return new Promise((resolve, reject) => {
    const packets = [];
    const d = new prism.opus.OggDemuxer();
    let head = null;
    d.on('head', (h) => { head = h; });
    d.on('data', (p) => packets.push(p));
    d.on('end', () => resolve(Object.assign(packets, { head })));
    d.on('error', reject);
    d.end(buffer);
  });
}

/** Длительность файла по ffmpeg (секунды), декодируя его полностью. */
export function decodedSeconds(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', '16000', '-'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(String(r.stderr));
  return r.stdout.length / 2 / 16000;
}
