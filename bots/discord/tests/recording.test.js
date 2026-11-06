// Приём дорожек, экспорт и контроллер — с подменой приёмника Discord.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { EndBehaviorType } from '@discordjs/voice';
import { RecordingSession } from '../src/recorder/session.js';
import { TrackRecorder } from '../src/recorder/tracks.js';
import { Manifest, readManifest } from '../src/recorder/manifest.js';
import { buildSegmentIndex, exportSession } from '../src/recorder/export.js';
import { GuildController } from '../src/core/controller.js';
import { loadConfig } from '../src/config.js';
import { FakeReceiver, decodedSeconds, demux, fakeClock, hasFfmpeg, memoryManifest, opusPackets, tempDir } from './helpers.js';

const SILENCE = Buffer.from([0xf8, 0xff, 0xfe]);
const tick = () => new Promise((r) => setImmediate(r));

function setup({ dir = tempDir(), manifest = memoryManifest() } = {}) {
  const clock = fakeClock();
  const session = new RecordingSession({ id: 's', dir, guildId: 'g', channelId: 'c', startedBy: 'm', clock, manifest });
  const receiver = new FakeReceiver();
  const tracks = new TrackRecorder({ session, receiver, silenceMs: 800 }).attach();
  return { dir, clock, session, receiver, tracks, manifest };
}

async function speak(receiver, userId, packets) {
  receiver.speaking.emit('start', userId);
  const s = receiver.streams.get(userId);
  for (const p of packets) s.write(p);
  s.end(); // AfterSilence: Discord закрывает поток после тишины
  await tick();
}

test('пишутся только согласившиеся; фрагмент закрывается после тишины', async () => {
  const { dir, session, receiver, tracks, manifest, clock } = setup();
  receiver.speaking.emit('start', 'stranger');
  assert.equal(receiver.streams.size, 0, 'без согласия подписки нет');

  session.setConsent('u1', true);
  clock.advance(2000);
  receiver.speaking.emit('start', 'u1');
  assert.deepEqual(receiver.options.get('u1'), { end: { behavior: EndBehaviorType.AfterSilence, duration: 800 } });
  receiver.speaking.emit('start', 'u1');
  assert.equal(tracks.openUsers.length, 1, 'повторный start не открывает второй фрагмент');
  const s = receiver.streams.get('u1');
  s.write(SILENCE); s.write(SILENCE);
  clock.advance(40);
  s.end();
  await tracks.closeAll();
  await tick();

  const end = manifest.events.find((e) => e.type === 'segment_end');
  assert.deepEqual({ ...end, t: undefined }, { t: undefined, type: 'segment_end', userId: 'u1', file: 'u1/00001.ogg', seq: 1, startMs: 2000, endMs: 2040, packets: 2, samples: 1920 });
  const packets = await demux(fs.readFileSync(path.join(dir, 'u1/00001.ogg')));
  assert.equal(packets.length, 2);
});

test('одновременная речь двух участников — отдельные файлы и смещения', async () => {
  const { dir, session, receiver, tracks, manifest, clock } = setup();
  session.setConsent('a', true);
  session.setConsent('b', true);
  clock.advance(100);
  receiver.speaking.emit('start', 'a');
  clock.advance(50);
  receiver.speaking.emit('start', 'b');
  receiver.streams.get('a').write(SILENCE);
  receiver.streams.get('b').write(SILENCE);
  receiver.streams.get('a').end();
  receiver.streams.get('b').end();
  await tracks.closeAll(); await tick();
  const starts = manifest.events.filter((e) => e.type === 'segment_start').map((e) => [e.userId, e.startMs, e.file]);
  assert.deepEqual(starts, [['a', 100, 'a/00001.ogg'], ['b', 150, 'b/00001.ogg']]);
  assert.ok(fs.existsSync(path.join(dir, 'a/00001.ogg')) && fs.existsSync(path.join(dir, 'b/00001.ogg')));
});

test('пауза закрывает фрагмент, во время паузы новые не открываются', async () => {
  const { session, receiver, tracks, manifest } = setup();
  session.setConsent('u1', true);
  receiver.speaking.emit('start', 'u1');
  receiver.streams.get('u1').write(SILENCE);
  session.pause('m');
  await tracks.closeAll();
  receiver.speaking.emit('start', 'u1');
  assert.equal(tracks.openUsers.length, 0);
  assert.equal(manifest.events.filter((e) => e.type === 'segment_end').length, 1);
  assert.equal(manifest.events.some((e) => e.type === 'error'), false, 'досрочное закрытие — не ошибка');
});

test('после resume подхватываются те, кто говорит прямо сейчас', async () => {
  const { session, receiver, tracks } = setup();
  session.setConsent('u1', true);
  session.pause('m');
  receiver.speaking.users.set('u1', Date.now());
  receiver.speaking.users.set('stranger', Date.now());
  session.resume('m');
  tracks.pickUpSpeaking();
  assert.deepEqual(tracks.openUsers, ['u1']);
  await tracks.closeAll();
});

test('ошибка одного фрагмента не мешает другим', async () => {
  const { session, receiver, tracks, manifest } = setup();
  session.setConsent('a', true);
  session.setConsent('b', true);
  receiver.speaking.emit('start', 'a');
  receiver.speaking.emit('start', 'b');
  receiver.streams.get('a').destroy(new Error('пакет повреждён'));
  receiver.streams.get('b').write(SILENCE);
  receiver.streams.get('b').end();
  await tracks.closeAll(); await tick();
  const errors = manifest.events.filter((e) => e.type === 'error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].userId, 'a');
  assert.equal(manifest.events.find((e) => e.type === 'segment_end' && e.userId === 'b').packets, 1);
});

test('индекс сегментов: имена, порядок, пустые фрагменты исключены', () => {
  const events = [
    { type: 'session_start', sessionId: 's', startedAtUtc: 'x', guildId: 'g', channelId: 'c' },
    { type: 'participant', userId: 'a', name: 'Мастер' },
    { type: 'participant', userId: 'b', name: 'Лира' },
    { type: 'segment_start', userId: 'b', file: 'b/00001.ogg', startMs: 500 },
    { type: 'segment_start', userId: 'a', file: 'a/00001.ogg', startMs: 100 },
    { type: 'segment_end', userId: 'a', file: 'a/00001.ogg', startMs: 100, endMs: 900, packets: 40 },
    { type: 'segment_start', userId: 'a', file: 'a/00002.ogg', startMs: 1000 },
    { type: 'segment_end', userId: 'a', file: 'a/00002.ogg', startMs: 1000, endMs: 1000, packets: 0 },
  ];
  const index = buildSegmentIndex(events);
  assert.deepEqual(index.segments.map((s) => [s.file, s.name, s.complete]), [['a/00001.ogg', 'Мастер', true], ['b/00001.ogg', 'Лира', false]]);
  assert.equal(index.session.id, 's');
});

test('сквозной прогон: настоящий Opus → дорожки → манифест → WAV 16 кГц', { skip: !hasFfmpeg && 'нет ffmpeg с libopus' }, async () => {
  const dir = tempDir();
  const { session, receiver, tracks, clock } = setup({ dir, manifest: new Manifest(path.join(dir, 'manifest.jsonl')) });
  const packets = await opusPackets(1);
  session.participant({ id: 'a', name: 'Мастер' });
  session.participant({ id: 'b', name: 'Лира' });
  session.setConsent('a', true);
  session.setConsent('b', true);
  await speak(receiver, 'a', packets);
  clock.advance(1500);
  await speak(receiver, 'b', packets);
  await tracks.closeAll(); await tick();
  session.stop('m');

  const index = await exportSession(dir);
  assert.equal(index.segments.length, 2);
  for (const s of index.segments) {
    assert.ok(!s.error, s.error);
    const seconds = decodedSeconds(path.join(dir, s.wav));
    assert.ok(Math.abs(seconds - 1) < 0.05, `${s.file}: ${seconds} с`);
  }
  assert.deepEqual(index.segments.map((s) => [s.name, s.startMs]), [['Мастер', 0], ['Лира', 1500]]);
  assert.ok(fs.existsSync(path.join(dir, 'segments.json')));
  assert.equal(readManifest(path.join(dir, 'manifest.jsonl')).at(-1).type, 'session_stop');
});

// ——— Контроллер с подменой голосового соединения ———

class FakeLink extends EventEmitter {
  constructor({ channelId }) { super(); this.channelId = channelId; this.receiver = new FakeReceiver(); this.closed = false; }
  async connect() {}
  disconnect() { this.closed = true; }
}

function controller() {
  const dir = tempDir();
  const cfg = { ...loadConfig({}), recordingsDir: dir };
  const nicks = [];
  const me = { nickname: null, setNickname: async (n) => { nicks.push(n); me.nickname = n; } };
  const guild = { id: 'g1', members: { me } };
  let link;
  const ctl = new GuildController({ guild, cfg, log: () => {}, makeLink: (o) => (link = new FakeLink(o)) });
  return { ctl, nicks, dir, link: () => link };
}
const human = (id, name) => ({ id, displayName: name, user: { username: name.toLowerCase(), bot: false } });

test('контроллер: join → start → согласие → pause/resume → stop, ник «🔴 Запись»', async () => {
  const { ctl, nicks, link } = controller();
  await assert.rejects(ctl.start({ by: 'm' }), /\/rec join/);
  await ctl.join({ id: 'vc', name: 'Таверна' });
  const session = await ctl.start({ by: 'm', members: [human('m', 'Мастер'), human('p', 'Игрок')] });
  assert.equal(session.participants.size, 2);
  await assert.rejects(ctl.start({ by: 'm' }), /уже идёт/);

  await ctl.setConsent(human('p', 'Игрок'), true);
  link().receiver.speaking.emit('start', 'p');
  link().receiver.speaking.emit('start', 'm');
  assert.deepEqual(ctl.tracks.openUsers, ['p'], 'мастер без согласия тоже не пишется');

  await ctl.pause('m');
  assert.equal(ctl.tracks.openUsers.length, 0);
  await ctl.resume('m');
  const stopped = await ctl.stop('m');
  assert.ok(fs.existsSync(path.join(stopped.dir, 'summary.json')));
  assert.deepEqual(nicks, ['🔴 Запись', null, '🔴 Запись', null]);
});

test('контроллер: разрыв связи закрывает фрагменты и отмечается в манифесте', async () => {
  const { ctl, link } = controller();
  await ctl.join({ id: 'vc', name: 'Таверна' });
  const s = await ctl.start({ by: 'm', members: [human('p', 'Игрок')] });
  await ctl.setConsent(human('p', 'Игрок'), true);
  link().receiver.speaking.emit('start', 'p');
  link().emit('lost');
  await ctl.tracks.closeAll(); // дождаться записи файлов, начатой обработчиком разрыва
  assert.equal(ctl.tracks.openUsers.length, 0);
  link().receiver.speaking.users.set('p', Date.now());
  link().emit('restored', { attempt: 1 });
  assert.deepEqual(ctl.tracks.openUsers, ['p'], 'после восстановления запись продолжается');
  await ctl.stop('m');
  const types = readManifest(path.join(s.dir, 'manifest.jsonl')).map((e) => e.type);
  assert.ok(types.includes('connection_lost') && types.includes('connection_restored'));
});

test('контроллер: вошедший без согласия получает запрос, отзыв согласия закрывает дорожку', async () => {
  const { ctl, link } = controller();
  await ctl.join({ id: 'vc', name: 'Таверна' });
  await ctl.start({ by: 'm' });
  assert.equal(await ctl.onVoiceMove(human('n', 'Новичок'), 'vc', null), 'needs-consent');
  await ctl.setConsent(human('n', 'Новичок'), true);
  link().receiver.speaking.emit('start', 'n');
  assert.deepEqual(ctl.tracks.openUsers, ['n']);
  await ctl.setConsent(human('n', 'Новичок'), false);
  assert.equal(ctl.tracks.openUsers.length, 0);
  assert.equal(await ctl.onVoiceMove(human('n', 'Новичок'), null, 'vc'), null);
  await ctl.leave('m');
  assert.equal(link().closed, true);
  assert.equal(ctl.recording, false);
});
