// Подготовка сессии к транскрипции: индекс фрагментов (segments.json) и WAV 16 кГц mono через ffmpeg.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readManifest } from './manifest.js';

const run = promisify(execFile);

/** Собрать фрагменты из событий манифеста, по времени начала. */
export function buildSegmentIndex(events) {
  const names = new Map();
  const segments = new Map();
  let session = null;
  for (const e of events) {
    if (e.type === 'session_start') session = { id: e.sessionId, startedAtUtc: e.startedAtUtc, guildId: e.guildId, channelId: e.channelId };
    if (e.type === 'participant') names.set(e.userId, e.name);
    if (e.type === 'segment_start') segments.set(e.file, { userId: e.userId, file: e.file, startMs: e.startMs, endMs: null, packets: 0, complete: false });
    if (e.type === 'segment_end') {
      const s = segments.get(e.file) || { userId: e.userId, file: e.file, startMs: e.startMs };
      Object.assign(s, { endMs: e.endMs, packets: e.packets, complete: true });
      segments.set(e.file, s);
    }
  }
  const list = [...segments.values()]
    .filter((s) => s.packets > 0 || !s.complete)
    .map((s) => ({ ...s, name: names.get(s.userId) || s.userId }))
    .sort((a, b) => a.startMs - b.startMs || a.userId.localeCompare(b.userId));
  return { session, participants: Object.fromEntries(names), segments: list };
}

/** Индекс + WAV для каждого фрагмента. Возвращает индекс с путями к WAV. */
export async function exportSession(dir, { ffmpeg = 'ffmpeg', exec = run } = {}) {
  const index = buildSegmentIndex(readManifest(path.join(dir, 'manifest.jsonl')));
  for (const s of index.segments) {
    const src = path.join(dir, s.file);
    if (!fs.existsSync(src)) { s.error = 'файл отсутствует'; continue; }
    const wav = path.join('wav', s.file.replace(/\.ogg$/, '.wav'));
    fs.mkdirSync(path.dirname(path.join(dir, wav)), { recursive: true });
    try {
      await exec(ffmpeg, ['-y', '-loglevel', 'error', '-i', src, '-ac', '1', '-ar', '16000', path.join(dir, wav)]);
      s.wav = wav;
    } catch (err) {
      s.error = `ffmpeg: ${String(err.stderr || err.message).trim().slice(0, 300)}`;
    }
  }
  fs.writeFileSync(path.join(dir, 'segments.json'), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}
