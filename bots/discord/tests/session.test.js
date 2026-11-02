import test from 'node:test';
import assert from 'node:assert/strict';
import { RecordingSession, SessionStateError, State } from '../src/recorder/session.js';
import { fakeClock, memoryManifest } from './helpers.js';

function session(extra = {}) {
  const clock = fakeClock();
  const manifest = memoryManifest();
  const s = new RecordingSession({ id: 's1', dir: '/tmp/s1', guildId: 'g', channelId: 'c', startedBy: 'm', clock, manifest, ...extra });
  return { s, clock, manifest };
}

test('старт пишет session_start с UTC и каналом', () => {
  const { manifest } = session();
  assert.deepEqual(manifest.events[0], {
    t: 0, type: 'session_start', sessionId: 's1', guildId: 'g', channelId: 'c', startedBy: 'm', startedAtUtc: '2026-11-02T10:30:00.000Z',
  });
});

test('без согласия голос не записывается; отказ отменяет согласие', () => {
  const { s } = session();
  assert.equal(s.canRecord('u1'), false);
  assert.equal(s.setConsent('u1', true), true);
  assert.equal(s.setConsent('u1', true), false, 'повтор не создаёт событие');
  assert.equal(s.canRecord('u1'), true);
  s.setConsent('u1', false);
  assert.equal(s.canRecord('u1'), false);
});

test('пауза, возобновление, остановка и таймкоды событий', () => {
  const { s, clock, manifest } = session();
  s.setConsent('u1', true);
  clock.advance(1000);
  s.pause('m');
  assert.equal(s.state, State.Paused);
  assert.equal(s.canRecord('u1'), false, 'на паузе не пишем');
  assert.throws(() => s.pause('m'), SessionStateError);
  clock.advance(500);
  s.resume('m');
  assert.equal(s.canRecord('u1'), true);
  clock.advance(250);
  s.stop('m');
  assert.equal(s.active, false);
  assert.throws(() => s.resume('m'), /остановлена/);
  assert.throws(() => s.setConsent('u2', true), SessionStateError);
  const timeline = manifest.events.map((e) => [e.type, e.t]);
  assert.deepEqual(timeline.slice(-3), [['pause', 1000], ['resume', 1500], ['session_stop', 1750]]);
  assert.equal(manifest.events.at(-1).durationMs, 1750);
});

test('участник фиксируется один раз, повторно — только при смене имени', () => {
  const { s, manifest } = session();
  assert.equal(s.participant({ id: 'u1', name: 'Аня', username: 'anya' }), true);
  assert.equal(s.participant({ id: 'u1', name: 'Аня', username: 'anya' }), false);
  assert.equal(s.participant({ id: 'u1', name: 'Лира', username: 'anya' }), true);
  assert.equal(manifest.events.filter((e) => e.type === 'participant').length, 2);
});

test('номера фрагментов растут отдельно для каждого участника', () => {
  const { s } = session();
  assert.equal(s.nextSegment('u1'), 1);
  assert.equal(s.nextSegment('u1'), 2);
  assert.equal(s.nextSegment('u2'), 1);
  assert.equal(s.summary().segments, 3);
});

test('тестовые боты-дикторы согласны автоматически, но их можно исключить', () => {
  const { s } = session({ autoConsentIds: ['bot1'] });
  assert.equal(s.canRecord('bot1'), true);
  s.setConsent('bot1', false);
  assert.equal(s.canRecord('bot1'), false);
});
