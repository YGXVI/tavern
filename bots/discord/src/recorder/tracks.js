// Приём голоса: по началу речи согласившегося участника — отдельный фрагмент <discordId>/<seq>.ogg.
// receiver — VoiceReceiver из @discordjs/voice (или совместимая подмена в тестах):
//   receiver.speaking — EventEmitter с событием 'start' (userId);
//   receiver.subscribe(userId, options) → Readable пакетов Opus.
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { EndBehaviorType } from '@discordjs/voice';
import { OggOpusWriter } from './ogg.js';

export class TrackRecorder {
  constructor({ session, receiver, silenceMs = 1000, log = () => {} }) {
    this.session = session;
    this.receiver = receiver;
    this.silenceMs = silenceMs;
    this.log = log;
    this.open = new Map(); // userId → { stream, done }
    this.onSpeaking = this.onSpeaking.bind(this);
  }

  attach() {
    this.receiver.speaking.on('start', this.onSpeaking);
    return this;
  }

  detach() {
    this.receiver.speaking.off('start', this.onSpeaking);
  }

  /** Заменить приёмник после переподключения (обычно тот же объект). */
  setReceiver(receiver) {
    if (receiver === this.receiver) return;
    this.detach();
    this.receiver = receiver;
    this.attach();
  }

  /** Открыть фрагменты тем, кто говорит прямо сейчас (после resume, согласия, переподключения). */
  pickUpSpeaking() {
    const users = this.receiver.speaking?.users;
    if (users && typeof users.keys === 'function') for (const id of users.keys()) this.onSpeaking(id);
  }

  onSpeaking(userId) {
    if (!this.session.canRecord(userId) || this.open.has(userId)) return;
    try {
      this.#openSegment(userId);
    } catch (err) {
      this.session.event('error', { userId, where: 'segment_open', message: String(err?.message || err) });
      this.log(`Не удалось открыть фрагмент ${userId}: ${err?.message || err}`);
    }
  }

  #openSegment(userId) {
    const seq = this.session.nextSegment(userId);
    const file = `${userId}/${String(seq).padStart(5, '0')}.ogg`;
    const abs = path.join(this.session.dir, file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });

    const stream = this.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: this.silenceMs },
    });
    const ogg = new OggOpusWriter();
    const startMs = this.session.offset();
    this.session.event('segment_start', { userId, file, seq, startMs });

    const entry = { stream, ogg };
    entry.done = pipeline(stream, ogg, fs.createWriteStream(abs))
      .then(() => null, (err) => err)
      .then((err) => {
        // Принудительное закрытие (пауза, разрыв) завершает поток досрочно — это не ошибка записи.
        if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
          this.session.event('error', { userId, file, where: 'segment', message: String(err.message || err) });
        }
        this.session.event('segment_end', {
          userId, file, seq, startMs, endMs: this.session.offset(), packets: ogg.packets, samples: ogg.samples,
        });
        this.open.delete(userId);
      });
    this.open.set(userId, entry);
  }

  /** Закрыть текущий фрагмент участника (отзыв согласия, выход из канала). */
  closeUser(userId) {
    const entry = this.open.get(userId);
    if (!entry) return Promise.resolve();
    endStream(entry.stream);
    return entry.done;
  }

  /** Закрыть все фрагменты (пауза, остановка, разрыв связи). */
  closeAll() {
    return Promise.all([...this.open.keys()].map((id) => this.closeUser(id)));
  }

  get openUsers() { return [...this.open.keys()]; }
}

function endStream(stream) {
  if (stream.readableEnded || stream.destroyed) return;
  // Штатное завершение: последние пакеты успевают попасть в файл.
  stream.push(null);
}
