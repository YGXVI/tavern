// Дом кампании, книга и справочник (#203): чистые функции — правки книги, указатель, сложность встречи, поиск.
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

const empty = () => ({ chapters: [], threads: [], handouts: [], next: null, session: null, pen: null });
const entry = (o = {}) => ({ id: 'be-1', n: 1, userId: 'u-asya', title: 'Он произнёс имя', text: 'Голос назвал @Торин по имени у @[Алтарь Безликого].', at: 1000, rev: 1, ...o });

test('книга: правка записи применяется один раз, новая ревизия заменяет текст, пометки остаются', () => {
  const b = empty();
  book.applyOp(b, { op: 'entry', entry: entry() });
  book.applyOp(b, { op: 'entry', entry: entry() });
  assert.equal(b.chapters.length, 1);
  assert.equal(b.chapters[0].entries.length, 1);
  book.applyOp(b, { op: 'margin', n: 1, entryId: 'be-1', margin: { id: 'bm-1', userId: 'u-yara', text: 'а ключ?', quote: 'Голос' } });
  book.applyOp(b, { op: 'margin', n: 1, entryId: 'be-1', margin: { id: 'bm-1', userId: 'u-yara', text: 'а ключ?', quote: 'Голос' } });
  book.applyOp(b, { op: 'agree', n: 1, entryId: 'be-1', userId: 'u-yara' });
  book.applyOp(b, { op: 'entry', entry: entry({ text: 'Новый текст', rev: 2 }) });
  book.applyOp(b, { op: 'entry', entry: entry({ text: 'Старый текст', rev: 1 }) });
  const e = b.chapters[0].entries[0];
  assert.equal(e.text, 'Новый текст');
  assert.equal(e.margins.length, 1);
  assert.deepEqual(e.agree, ['u-yara']);
});

test('книга: записи из журнала — открытые и «только мастеру»; автор берётся из записи журнала', () => {
  const c = { log: [
    { id: 'r-1', at: 2, userId: 'u-asya', kind: 'book', text: JSON.stringify({ op: 'entry', entry: { ...entry(), userId: 'u-hacker' } }) },
    { id: 'r-2', at: 3, userId: 'u-yara', kind: 'book', vis: 'gm', hidden: true, text: JSON.stringify({ op: 'entry', entry: entry({ id: 'be-2' }) }) },
    { id: 'r-3', at: 4, userId: 'u-yara', kind: 'book', vis: 'gm', hidden: true, redacted: true },
    { id: 'r-4', at: 5, userId: 'u-asya', kind: 'roll', label: 'Атака', total: 12 },
  ] };
  const ops = book.bookOps(c);
  assert.equal(ops.length, 2);
  assert.equal(ops[0].op.entry.userId, 'u-asya');
  assert.equal(ops[1].hidden, true);
});

test('книга: указатель собирается из упоминаний; печать без текста в указатель не попадает', () => {
  const b = empty();
  book.applyOp(b, { op: 'entry', entry: entry() });
  b.chapters[0].entries.push({ id: 'be-s', n: 1, kind: 'sealed', text: '@Тайна', sealed: { breakOn: 'manual' } });
  const c = { characters: [{ name: 'Торин' }], scenes: [{ name: 'Алтарь Безликого' }] };
  const idx = book.bookIndex(b, c);
  assert.deepEqual(idx.map((x) => [x.name, x.kind]), [['Алтарь Безликого', 'place'], ['Торин', 'hero']]);
  assert.deepEqual(book.mentionsIn('у @[Нижний зал] и @Гарр.'), ['Нижний зал', 'Гарр']);
});

test('книга: римские номера глав и чернила', () => {
  assert.equal(book.ROMAN(4), 'IV');
  assert.equal(book.ROMAN(19), 'XIX');
  assert.equal(book.inkWet({ inkUntil: 10 }, 5), true);
  assert.equal(book.inkWet({ inkUntil: 10 }, 11), false);
  assert.equal(book.inkWet({ inkUntil: null }, 11), true);
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
