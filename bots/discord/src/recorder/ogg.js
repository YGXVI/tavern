// Упаковка пакетов Opus из Discord в Ogg (RFC 7845) без перекодирования.
// Discord шлёт кадры Opus 48 кГц stereo; гранулы считаются по TOC каждого пакета (RFC 6716).
import { Transform } from 'node:stream';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) : (r << 1);
    t[i] = r >>> 0;
  }
  return t;
})();

export function oggCrc(buf) {
  let crc = 0;
  for (const b of buf) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b) & 0xff]) >>> 0;
  return crc >>> 0;
}

/** Длительность пакета Opus в отсчётах 48 кГц по байту TOC. */
export function opusPacketSamples(packet) {
  if (!packet || packet.length < 1) return 0;
  const toc = packet[0];
  const config = toc >> 3;
  let frame;
  if (config < 12) frame = [480, 960, 1920, 2880][config % 4];
  else if (config < 16) frame = [480, 960][config % 2];
  else frame = [120, 240, 480, 960][config % 4];
  const code = toc & 3;
  let frames = 1;
  if (code === 1 || code === 2) frames = 2;
  else if (code === 3) frames = packet.length > 1 ? (packet[1] & 0x3f) : 0;
  return frame * frames;
}

export function opusHead({ channels = 2, sampleRate = 48000, preSkip = 0 } = {}) {
  const b = Buffer.alloc(19);
  b.write('OpusHead', 0, 'ascii');
  b.writeUInt8(1, 8);
  b.writeUInt8(channels, 9);
  b.writeUInt16LE(preSkip, 10);
  b.writeUInt32LE(sampleRate, 12);
  b.writeInt16LE(0, 16);
  b.writeUInt8(0, 18);
  return b;
}

export function opusTags(vendor = 'rasputye-discord-bot') {
  const v = Buffer.from(vendor, 'utf8');
  const b = Buffer.alloc(8 + 4 + v.length + 4);
  b.write('OpusTags', 0, 'ascii');
  b.writeUInt32LE(v.length, 8);
  v.copy(b, 12);
  b.writeUInt32LE(0, 12 + v.length);
  return b;
}

/** Одна страница Ogg. flags: 0x02 — начало потока, 0x04 — конец. */
export function oggPage({ packets, granule, serial, sequence, flags = 0 }) {
  const lacing = [];
  for (const p of packets) {
    let n = p.length;
    while (n >= 255) { lacing.push(255); n -= 255; }
    lacing.push(n);
  }
  if (lacing.length > 255) throw new Error('Слишком много сегментов на странице Ogg');
  const header = Buffer.alloc(27 + lacing.length);
  header.write('OggS', 0, 'ascii');
  header.writeUInt8(0, 4);
  header.writeUInt8(flags, 5);
  header.writeBigInt64LE(BigInt(granule), 6);
  header.writeUInt32LE(serial >>> 0, 14);
  header.writeUInt32LE(sequence >>> 0, 18);
  header.writeUInt32LE(0, 22);
  header.writeUInt8(lacing.length, 26);
  Buffer.from(lacing).copy(header, 27);
  const page = Buffer.concat([header, ...packets]);
  page.writeUInt32LE(oggCrc(page), 22);
  return page;
}

/**
 * Transform: на входе — пакеты Opus (Buffer), на выходе — байты файла .ogg.
 * Счётчик `packets` и `samples` доступны после завершения.
 */
export class OggOpusWriter extends Transform {
  constructor({ channels = 2, packetsPerPage = 10, serial } = {}) {
    super({ writableObjectMode: true });
    this.serial = serial ?? (Math.random() * 0xffffffff) >>> 0;
    this.sequence = 0;
    this.granule = 0;
    this.pending = [];
    this.packets = 0;
    this.samples = 0;
    this.packetsPerPage = packetsPerPage;
    this.push(this.#page([opusHead({ channels })], 0, 0x02));
    this.push(this.#page([opusTags()], 0, 0));
  }

  #page(packets, granule, flags) {
    return oggPage({ packets, granule, serial: this.serial, sequence: this.sequence++, flags });
  }

  _transform(packet, _enc, done) {
    if (!Buffer.isBuffer(packet) || packet.length === 0) return done();
    this.pending.push(packet);
    this.packets++;
    this.samples += opusPacketSamples(packet);
    if (this.pending.length >= this.packetsPerPage) this.#flush(false);
    done();
  }

  _flush(done) {
    this.#flush(true);
    done();
  }

  #flush(last) {
    if (!this.pending.length && !last) return;
    this.granule = this.samples;
    this.push(this.#page(this.pending, this.granule, last ? 0x04 : 0));
    this.pending = [];
  }
}
