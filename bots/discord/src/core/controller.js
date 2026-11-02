// Управление ботом на одном Discord-сервере: голосовое соединение и текущая сессия записи.
import fs from 'node:fs';
import path from 'node:path';
import { VoiceLink } from './voice.js';
import { RecordingSession, SessionStateError, State } from '../recorder/session.js';
import { Manifest } from '../recorder/manifest.js';
import { TrackRecorder } from '../recorder/tracks.js';
import { createClock, formatOffset, sessionDirName } from '../util/time.js';

export const REC_NICK = '🔴 Запись';

export class GuildController {
  constructor({ guild, cfg, log = console.log, makeLink = (o) => new VoiceLink(o) }) {
    this.guild = guild;
    this.cfg = cfg;
    this.log = log;
    this.makeLink = makeLink;
    this.link = null;
    this.session = null;
    this.tracks = null;
    this.prevNick = undefined;
  }

  get channelId() { return this.link?.channelId || null; }
  get recording() { return Boolean(this.session?.active); }

  async join(voiceChannel) {
    if (this.link && this.link.channelId === voiceChannel.id) return 'Бот уже в этом канале.';
    if (this.recording) throw new SessionStateError('Идёт запись в другом канале — сначала остановите её.');
    this.link?.disconnect();
    const link = this.makeLink({ guild: this.guild, channelId: voiceChannel.id, log: this.log });
    link.on('lost', () => this.#onLost());
    link.on('restored', (info) => this.#onRestored(info));
    link.on('failed', () => this.#onFailed());
    await link.connect();
    this.link = link;
    return `Бот подключён к «${voiceChannel.name}».`;
  }

  async leave(by) {
    if (this.recording) await this.stop(by, 'leave');
    this.link?.disconnect();
    this.link = null;
    return 'Бот отключён.';
  }

  /** members — участники голосового канала (GuildMember). */
  async start({ by, members = [] }) {
    if (!this.link) throw new SessionStateError('Сначала подключите бота: /rec join.');
    if (this.recording) throw new SessionStateError('Запись уже идёт.');
    const clock = createClock();
    const dir = path.join(this.cfg.recordingsDir, sessionDirName(clock.startedAtUtc, this.guild.id));
    fs.mkdirSync(dir, { recursive: true });
    this.session = new RecordingSession({
      id: path.basename(dir), dir, guildId: this.guild.id, channelId: this.link.channelId, startedBy: by,
      clock, manifest: new Manifest(path.join(dir, 'manifest.jsonl')), autoConsentIds: this.cfg.testSpeakerBotIds,
    });
    for (const m of members) this.noteMember(m);
    this.tracks = new TrackRecorder({ session: this.session, receiver: this.link.receiver, silenceMs: this.cfg.silenceMs, log: this.log }).attach();
    await this.#setNick(true);
    this.log(`Запись начата: ${dir}`);
    return this.session;
  }

  async pause(by) {
    this.#requireSession().pause(by);
    await this.tracks.closeAll();
    await this.#setNick(false);
  }

  async resume(by) {
    this.#requireSession().resume(by);
    this.tracks.pickUpSpeaking();
    await this.#setNick(true);
  }

  async stop(by, reason = 'command') {
    const s = this.#requireSession();
    s.stop(by, reason);
    this.tracks.detach();
    await this.tracks.closeAll();
    fs.writeFileSync(path.join(s.dir, 'summary.json'), `${JSON.stringify(s.summary(), null, 2)}\n`);
    await this.#setNick(false);
    this.log(`Запись остановлена: ${s.dir}`);
    return s;
  }

  async setConsent(member, granted) {
    const s = this.#requireSession();
    this.noteMember(member);
    const changed = s.setConsent(member.id, granted);
    if (!granted) await this.tracks.closeUser(member.id);
    else this.tracks.pickUpSpeaking();
    return changed;
  }

  noteMember(member) {
    if (!this.session?.active || !member?.user) return;
    this.session.participant({
      id: member.id,
      name: member.displayName || member.user.globalName || member.user.username,
      username: member.user.username,
      bot: Boolean(member.user.bot),
    });
  }

  /** Вход/выход из канала записи. Возвращает 'needs-consent', если вошёл человек без согласия. */
  async onVoiceMove(member, joinedChannelId, leftChannelId) {
    if (!this.session?.active || !this.channelId) return null;
    if (joinedChannelId === this.channelId) {
      this.noteMember(member);
      this.session.event('voice_join', { userId: member.id });
      if (!member.user?.bot && !this.session.hasConsent(member.id)) return 'needs-consent';
    } else if (leftChannelId === this.channelId) {
      this.session.event('voice_leave', { userId: member.id });
      await this.tracks.closeUser(member.id);
    }
    return null;
  }

  status() {
    if (!this.link) return 'Бот не подключён к голосовому каналу.';
    if (!this.session) return 'Бот в канале, запись не идёт.';
    const s = this.session.summary();
    const label = { [State.Recording]: '🔴 идёт', [State.Paused]: '⏸ пауза', [State.Stopped]: '⏹ остановлена' }[s.state];
    return [
      `Запись: ${label}, ${formatOffset(s.elapsedMs)}`,
      `Согласились: ${s.consented.length ? s.consented.map((id) => `<@${id}>`).join(', ') : 'пока никто'}`,
      `Фрагментов: ${s.segments}; сейчас пишется: ${this.tracks?.openUsers.length || 0}`,
    ].join('\n');
  }

  async shutdown() {
    if (this.recording) await this.stop('system', 'shutdown').catch(() => {});
    this.link?.disconnect();
  }

  #requireSession() {
    if (!this.session?.active) throw new SessionStateError('Запись не идёт.');
    return this.session;
  }

  async #onLost() {
    if (!this.session?.active) return;
    this.session.event('connection_lost');
    await this.tracks.closeAll();
  }

  #onRestored({ attempt }) {
    if (!this.session?.active) return;
    this.session.event('connection_restored', { attempt });
    this.tracks.setReceiver(this.link.receiver);
    this.tracks.pickUpSpeaking();
  }

  async #onFailed() {
    if (this.session?.active) await this.stop('system', 'connection_failed').catch(() => {});
    this.link = null;
  }

  async #setNick(recording) {
    const me = this.guild.members?.me;
    if (!me) return;
    try {
      if (recording) {
        if (this.prevNick === undefined) this.prevNick = me.nickname;
        await me.setNickname(REC_NICK);
      } else if (this.prevNick !== undefined) {
        await me.setNickname(this.prevNick);
        this.prevNick = undefined;
      }
    } catch { /* нет права Change Nickname — состояние видно по сообщениям */ }
  }
}
