// «Мои герои» вне кампаний (#203): герой живёт у пользователя, правится на месте, удаляется и возвращается,
// чужой пользователь его не видит.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
let changes = 0;
globalThis.window = { dispatchEvent: () => { changes += 1; } };
globalThis.CustomEvent ??= class { constructor(type) { this.type = type; } };

const lib = await import('../dist/js/views/hero/library.js');
beforeEach(() => { mem.clear(); changes = 0; });

test('герой сохраняется у своего пользователя и не виден другому', () => {
  const h = lib.saveLibraryHero('u1', { id: 'h1', name: 'Варвара', level: 1, ownerId: 'чужой' });
  assert.equal(h.ownerId, 'u1');
  assert.deepEqual(lib.libraryHeroes('u1').map((x) => x.name), ['Варвара']);
  assert.deepEqual(lib.libraryHeroes('u2'), []);
  assert.equal(lib.libraryHero('u2', 'h1'), null);
  assert.equal(changes, 1, 'лист и список узнают об изменении');
});

test('правка на месте возвращает подсказку и не плодит копий; повторное сохранение заменяет', () => {
  lib.saveLibraryHero('u1', { id: 'h1', name: 'Варвара', hp: { current: 9, max: 12 } });
  const note = lib.updateLibraryHero('u1', 'h1', (x) => { x.hp.current = 4; return '−5 хитов'; });
  assert.equal(note, '−5 хитов');
  assert.equal(lib.libraryHero('u1', 'h1').hp.current, 4);
  lib.saveLibraryHero('u1', { id: 'h1', name: 'Варвара Смелая' });
  assert.deepEqual(lib.libraryHeroes('u1').map((x) => x.name), ['Варвара Смелая']);
  assert.equal(lib.updateLibraryHero('u1', 'нет', () => 'x'), null);
});

test('удалённый герой уходит из списка и возвращается целиком', () => {
  lib.saveLibraryHero('u1', { id: 'h1', name: 'Варвара', notes: 'долг гному' });
  lib.archiveLibraryHero('u1', 'h1');
  assert.deepEqual(lib.libraryHeroes('u1'), []);
  assert.ok(lib.archivedLibraryHeroes('u1')[0].archivedAt);
  const back = lib.restoreLibraryHero('u1', 'h1');
  assert.equal(back.notes, 'долг гному');
  assert.equal(lib.libraryHero('u1', 'h1').archivedAt, undefined);
  assert.deepEqual(lib.archivedLibraryHeroes('u1'), []);
});

test('ключ листа lib~ отличает своего героя от героя кампании; копия из списка не правит хранилище', () => {
  assert.ok(lib.isLibKey('lib~h1'));
  assert.ok(!lib.isLibKey('c-crypt~h1'));
  lib.saveLibraryHero('u1', { id: 'h1', name: 'Варвара' });
  lib.libraryHeroes('u1')[0].name = 'подмена';
  assert.equal(lib.libraryHero('u1', 'h1').name, 'Варвара');
});

test('без пользователя и при сломанном хранилище — пусто, без падения', () => {
  assert.deepEqual(lib.libraryHeroes(null), []);
  assert.equal(lib.saveLibraryHero('', { id: 'h1' }), null);
  mem.set('rasputye-heroes-v1', '{не json');
  assert.deepEqual(lib.libraryHeroes('u1'), []);
});

test('сведение с базой (DEC-019 D1): новее — кто правил позже, отсутствующее уходит в базу', async () => {
  const { saveLibraryHero, mergeLibrary, libraryHeroes, archivedLibraryHeroes, setLibrarySink, updateLibraryHero } = await import('../dist/js/views/hero/library.js');
  const u = 'merge-user';
  const local = saveLibraryHero(u, { id: 'only-here', name: 'Здесь' });
  saveLibraryHero(u, { id: 'both', name: 'Старое' });
  const up = mergeLibrary(u, [
    { id: 'both', data: { name: 'Новое', updatedAt: Date.now() + 1000 }, archived_at: null },
    { id: 'there', data: { name: 'С другого устройства', updatedAt: 5 }, archived_at: null },
    { id: 'gone', data: { name: 'Удалён', updatedAt: 5 }, archived_at: '2026-11-06T00:00:00Z' },
  ]);
  assert.deepEqual(up.map((x) => x.hero.id), ['only-here']);
  assert.equal(up[0].hero.updatedAt, local.updatedAt);
  const names = libraryHeroes(u).map((h) => h.name).sort();
  assert.deepEqual(names, ['Здесь', 'Новое', 'С другого устройства'].sort());
  assert.deepEqual(archivedLibraryHeroes(u).map((h) => h.name), ['Удалён']);
  const pushed = []; setLibrarySink((h, a) => pushed.push([h.name, a]));
  updateLibraryHero(u, 'both', (h) => { h.name = 'Правка'; });
  setLibrarySink(null);
  assert.deepEqual(pushed, [['Правка', false]]);
});
