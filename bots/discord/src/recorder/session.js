// Состояние одной сессии записи: старт/пауза/остановка, согласия, участники, события манифеста.
// Модуль не знает о Discord и сети — его проверяют юнит-тесты.

export const State = Object.freeze({ Recording: 'recording', Paused: 'paused', Stopped: 'stopped' });

export class SessionStateError extends Error {}

export class RecordingSession {
  /**
   * @param {object} o
   * @param {string} o.dir      каталог сессии
   * @param {{startedAtUtc:string, elapsed:()=>number}} o.clock
   * @param {{write:(e:object)=>object}} o.manifest
   */
  constructor({ id, dir, guildId, channelId, startedBy, clock, manifest, autoConsentIds = [] }) {
    this.id = id;
    this.dir = dir;
    this.guildId = guildId;
    this.channelId = channelId;
    this.clock = clock;
    this.manifest = manifest;
    this.state = State.Recording;
    this.consents = new Map(); // userId → true/false
    this.participants = new Map(); // userId → { name, username, bot }
    this.segmentSeq = new Map();
    this.autoConsent = new Set(autoConsentIds);
    this.event('session_start', { sessionId: id, guildId, channelId, startedBy, startedAtUtc: clock.startedAtUtc });
  }

  offset() { return this.clock.elapsed(); }

  event(type, data = {}) {
    return this.manifest.write({ t: this.offset(), type, ...data });
  }

  get active() { return this.state !== State.Stopped; }

  pause(by) {
    if (this.state !== State.Recording) throw new SessionStateError(this.state === State.Paused ? 'Запись уже на паузе.' : 'Запись не идёт.');
    this.state = State.Paused;
    this.event('pause', { by });
  }

  resume(by) {
    if (this.state !== State.Paused) throw new SessionStateError(this.state === State.Recording ? 'Запись уже идёт.' : 'Запись остановлена — начните новую.');
    this.state = State.Recording;
    this.event('resume', { by });
  }

  stop(by, reason = 'command') {
    if (this.state === State.Stopped) throw new SessionStateError('Запись уже остановлена.');
    this.state = State.Stopped;
    this.event('session_stop', { by, reason, durationMs: this.offset() });
  }

  /** Зафиксировать участника; повторная запись — только если изменилось имя. */
  participant({ id, name, username = '', bot = false }) {
    const prev = this.participants.get(id);
    if (prev && prev.name === name && prev.username === username) return false;
    this.participants.set(id, { name, username, bot });
    this.event('participant', { userId: id, name, username, bot });
    return true;
  }

  /** Возвращает true, если согласие изменилось. */
  setConsent(userId, granted, by = userId) {
    if (!this.active) throw new SessionStateError('Запись остановлена.');
    if (this.consents.get(userId) === granted) return false;
    this.consents.set(userId, granted);
    this.event('consent', { userId, granted, by });
    return true;
  }

  hasConsent(userId) {
    return this.consents.get(userId) === true || (this.autoConsent.has(userId) && this.consents.get(userId) !== false);
  }

  canRecord(userId) { return this.state === State.Recording && this.hasConsent(userId); }

  nextSegment(userId) {
    const n = (this.segmentSeq.get(userId) || 0) + 1;
    this.segmentSeq.set(userId, n);
    return n;
  }

  summary() {
    const consented = [...this.consents].filter(([, v]) => v).map(([k]) => k);
    return {
      id: this.id,
      state: this.state,
      elapsedMs: this.offset(),
      participants: this.participants.size,
      consented,
      segments: [...this.segmentSeq.values()].reduce((a, b) => a + b, 0),
    };
  }
}
