// Голосовое соединение с переподключением.
// События: 'lost' — связь пропала, 'restored' — восстановлена, 'failed' — восстановить не удалось.
import { EventEmitter } from 'node:events';
import { joinVoiceChannel, entersState, VoiceConnectionStatus } from '@discordjs/voice';

const READY_TIMEOUT_MS = 20_000;
const MOVE_GRACE_MS = 5_000;
const REJOIN_ATTEMPTS = 5;
const REJOIN_DELAY_MS = 3_000;

export class VoiceLink extends EventEmitter {
  constructor({ guild, channelId, log = () => {}, join = joinVoiceChannel }) {
    super();
    this.guild = guild;
    this.channelId = channelId;
    this.log = log;
    this.join = join;
    this.connection = null;
    this.closing = false;
    this.recovering = false;
  }

  get receiver() { return this.connection?.receiver; }

  async connect() {
    this.connection = this.join({
      channelId: this.channelId,
      guildId: this.guild.id,
      adapterCreator: this.guild.voiceAdapterCreator,
      selfDeaf: false, // иначе Discord не присылает звук
      selfMute: true, // PoC записи ничего не говорит
    });
    this.connection.on('stateChange', (oldS, newS) => this.#onState(oldS, newS));
    this.connection.on('error', (err) => this.log(`Голосовое соединение: ${err.message}`));
    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, READY_TIMEOUT_MS);
    } catch (err) {
      this.disconnect();
      throw new Error('Не удалось подключиться к голосовому каналу за 20 с.', { cause: err });
    }
  }

  async #onState(oldState, newState) {
    if (this.closing || this.recovering) return;
    if (newState.status !== VoiceConnectionStatus.Disconnected || oldState.status === VoiceConnectionStatus.Disconnected) return;
    this.recovering = true;
    this.emit('lost');
    const conn = this.connection;
    try {
      // Обычный перенос между голосовыми серверами Discord: соединение само начнёт заново.
      await Promise.race([
        entersState(conn, VoiceConnectionStatus.Signalling, MOVE_GRACE_MS),
        entersState(conn, VoiceConnectionStatus.Connecting, MOVE_GRACE_MS),
      ]);
      await entersState(conn, VoiceConnectionStatus.Ready, READY_TIMEOUT_MS);
      this.recovering = false;
      this.emit('restored', { attempt: 0 });
      return;
    } catch { /* переходим к повторным попыткам */ }
    for (let attempt = 1; attempt <= REJOIN_ATTEMPTS && !this.closing; attempt++) {
      try {
        conn.rejoin();
        await entersState(conn, VoiceConnectionStatus.Ready, READY_TIMEOUT_MS);
        this.recovering = false;
        this.emit('restored', { attempt });
        return;
      } catch {
        this.log(`Переподключение: попытка ${attempt} из ${REJOIN_ATTEMPTS} не удалась`);
        await new Promise((r) => setTimeout(r, REJOIN_DELAY_MS));
      }
    }
    this.recovering = false;
    if (!this.closing) {
      this.emit('failed');
      this.disconnect();
    }
  }

  disconnect() {
    this.closing = true;
    try { this.connection?.destroy(); } catch { /* уже уничтожено */ }
  }
}
