// #190 E: своя картинка существа — какие ссылки «свои», разметка с подгрузкой, песочница без копий.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.self ??= {};
globalThis.window ??= { addEventListener() {}, removeEventListener() {} };
const realInterval = globalThis.setInterval;
globalThis.setInterval = () => 0;
const { isLibRef, isOwnImage, creatureImgTag, campaignImage, libraryImageFrom } = await import('../dist/js/views/creature-img.js');
globalThis.setInterval = realInterval;

test('свои картинки: личная библиотека, браузер, кампания; инициалы и значки — нет', () => {
  assert.equal(isLibRef('library:u1/a.png'), true);
  assert.equal(isLibRef('idb:x'), false);
  for (const r of ['library:u1/a.png', 'idb:abc', 'sb:@tokens/c/u/a.webp']) assert.equal(isOwnImage(r), true, r);
  for (const r of ['ini:Клякса', 'item:potion', 'goblin', '', null]) assert.equal(isOwnImage(r), false, String(r));
});

test('разметка: личную картинку — подгрузкой поверх инициалов, без утечки кавычек', () => {
  const tag = creatureImgTag('library:u1/a.png', 'Клякса');
  assert.match(tag, /data-img-ref="library:u1\/a\.png"/);
  assert.match(tag, /src="/);
  const bad = creatureImgTag('library:u1/"><script>.png', 'x');
  assert.doesNotMatch(bad, /"><script>/);
  assert.doesNotMatch(creatureImgTag('ini:Клякса', 'Клякса'), /data-img-ref/);
  assert.doesNotMatch(creatureImgTag('', 'Клякса'), /data-img-ref/);
});

test('песочница: копия в кампанию не нужна, в библиотеку идёт та же ссылка', async () => {
  assert.equal(await campaignImage('c1', 'idb:abc', async () => 'NEW'), 'idb:abc');
  assert.equal(await campaignImage('c1', 'library:u1/a.png', async () => 'NEW'), 'library:u1/a.png', 'без сервера библиотека не копируется');
  assert.equal(await libraryImageFrom(null, 'idb:abc'), 'idb:abc');
  assert.equal(await libraryImageFrom(null, ''), '');
});
