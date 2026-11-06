// Дом кампании, книга и справочник (#203): чистые функции — заметки книги, сложность встречи, поиск.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.self ??= {};
globalThis.window ??= { addEventListener() {}, removeEventListener() {} };
const realInterval = globalThis.setInterval;
globalThis.setInterval = () => 0;
const book = await import('../dist/js/views/camp/book-store.js');
const { difficulty } = await import('../dist/js/views/camp/encounter-math.js');
const ref = await import('../dist/js/views/ref/data.js');
globalThis.setInterval = realInterval;

const empty = () => book.bookOf({});
const note = (o = {}) => ({ id: 'bn-1', at: 1000, rev: 1, blocks: [{ type: 'h', text: 'Склеп' }, { type: 'p', text: 'Голос назвал Торина по имени.' }, { type: 'q', text: 'Ты опоздал' }], ...o });

test('книга: заметка вписывается один раз, новая ревизия автора заменяет блоки, чужая — нет', () => {
  const b = empty();
  book.applyOp(b, { op: 'note', note: note() }, 'u-asya');
  book.applyOp(b, { op: 'note', note: note() }, 'u-asya');
  assert.equal(b.notes.length, 1);
  assert.equal(b.notes[0].userId, 'u-asya');
  assert.deepEqual(b.notes[0].blocks.map((x) => x.type), ['h', 'p', 'q']);
  book.applyOp(b, { op: 'note', note: note({ rev: 2, blocks: [{ type: 'p', text: 'Чужая правка' }] }) }, 'u-yara');
  assert.equal(b.notes[0].blocks[0].text, 'Склеп');
  book.applyOp(b, { op: 'note', note: note({ rev: 2, blocks: [{ type: 'p', text: 'Новый текст' }] }) }, 'u-asya');
  book.applyOp(b, { op: 'note', note: note({ rev: 1, blocks: [{ type: 'p', text: 'Старый текст' }] }) }, 'u-asya');
  assert.equal(b.notes[0].blocks[0].text, 'Новый текст');
  assert.ok(b.notes[0].edited);
});

test('книга: пустые блоки не хранятся, неизвестный вид — текст; пустая заметка не вписывается', () => {
  assert.deepEqual(book.cleanBlocks([{ type: 'h', text: '  ' }, { type: 'x', text: 'а' }, { type: 'q', text: 'б' }]), [{ type: 'p', text: 'а' }, { type: 'q', text: 'б' }]);
  const b = empty();
  book.applyOp(b, { op: 'note', note: note({ blocks: [{ type: 'p', text: ' ' }] }) }, 'u-asya');
  assert.equal(b.notes.length, 0);
});

test('книга: удалить свою может автор, чужую — только мастер; удалённая не возвращается из журнала', () => {
  const b = empty();
  book.applyOp(b, { op: 'note', note: note() }, 'u-asya');
  book.applyOp(b, { op: 'del', id: 'bn-1' }, 'u-yara');
  assert.equal(b.notes.length, 1);
  book.applyOp(b, { op: 'del', id: 'bn-1' }, 'u-gm', true);
  assert.equal(b.notes.length, 0);
  book.applyOp(b, { op: 'note', note: note() }, 'u-asya');
  assert.equal(b.notes.length, 0);
  assert.deepEqual(b.gone, ['bn-1']);
});

test('книга: заметки из журнала — автор берётся из записи журнала, мастер удаляет чужую', () => {
  const c = {
    members: [{ userId: 'u-gm', role: 'master', status: 'active' }, { userId: 'u-asya', role: 'player', status: 'active' }],
    book: { notes: [], played: 2 },
    log: [
      { id: 'r-1', at: 2, userId: 'u-asya', kind: 'book', text: JSON.stringify({ op: 'note', note: { ...note(), userId: 'u-hacker' } }) },
      { id: 'r-2', at: 3, userId: 'u-asya', kind: 'book', text: JSON.stringify({ op: 'note', note: note({ id: 'bn-2' }) }) },
      { id: 'r-3', at: 4, userId: 'u-gm', kind: 'book', text: JSON.stringify({ op: 'del', id: 'bn-2' }) },
      { id: 'r-4', at: 5, userId: 'u-asya', kind: 'roll', label: 'Атака', total: 12 },
      { id: 'r-5', at: 6, userId: 'u-asya', kind: 'book', text: 'не json' },
    ],
  };
  assert.equal(book.bookOps(c).length, 3);
  const b = book.readBook(c);
  assert.deepEqual(b.notes.map((x) => [x.id, x.userId]), [['bn-1', 'u-asya']]);
  assert.equal(b.played, 2);
});

test('книга: сессии считаются отдельно от заметок; у старой книги — по главам', () => {
  assert.equal(book.bookOf({ book: { chapters: [{ n: 1, startedAt: 1 }, { n: 2, startedAt: 2 }, { n: 3 }] } }).played, 2);
  assert.deepEqual(book.bookOf({ book: { chapters: [{ n: 1 }] } }).notes, []);
  assert.deepEqual(book.noteSummary(note()), { title: 'Склеп', text: 'Голос назвал Торина по имени. Ты опоздал' });
});

test('встреча: 4 героя 5 уровня, 4 культиста и 2 фанатика — средняя (1 000 опыта × 2)', () => {
  const d = difficulty([5, 5, 5, 5], [{ cr: '1/8', count: 4 }, { cr: '2', count: 2 }]);
  assert.deepEqual(d.party, [1000, 2000, 3000, 4400]);
  assert.equal(d.raw, 1000);
  assert.equal(d.mult, 2);
  assert.equal(d.adjusted, 2000);
  assert.equal(d.label, 'Средняя');
  assert.equal(difficulty([1, 1], [{ cr: '1', count: 1 }]).mult, 1.5); // маленький отряд — шаг множителя выше
});

test('справочник: опечатка и другая раскладка находят нужную запись', () => {
  const items = ['Огненный шар', 'Огненные ладони', 'Молния', 'Гоблин'].map((name, i) => ({ name, en: ['Fireball', 'Burning hands', 'Lightning bolt', 'Goblin'][i], n: ref.norm(name), ne: ref.norm(['Fireball', 'Burning hands', 'Lightning bolt', 'Goblin'][i]), hay: ref.norm(`${name} ${['Fireball', 'Burning hands', 'Lightning bolt', 'Goblin'][i]}`) }));
  assert.equal(ref.search(items, 'огеный шар').list[0].name, 'Огненный шар');
  assert.equal(ref.search(items, 'fireball').list[0].name, 'Огненный шар');
  assert.equal(ref.search(items, 'малния').list[0].name, 'Молния');
  const sw = ref.search(items, 'uj,kby');
  assert.equal(sw.list[0].name, 'Гоблин');
  assert.equal(sw.alt, 'гоблин');
  assert.equal(ref.xpFor('1/4'), 50);
});
