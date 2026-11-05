// Отрисовка книги кампании (#203): текст записи, корешок, разворот главы. Без событий — их вешает book.js.
import { html, raw, esc } from '../../core/dom.js';
import { userById, characterOf } from '../../core/campaign.js';
import { ROMAN, fmtDate, voiceLabel, mentionsIn } from './book-store.js';
import { ic, chapterName, chapterDate, duration, voices } from './parts.js';

let fontsLoaded = false;
/** Шрифты книги грузятся только когда книга открыта. */
export function bookFonts() {
  if (fontsLoaded) return; fontsLoaded = true;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=PT+Serif:ital,wght@0,400;0,700;1,400&family=Caveat:wght@500&display=swap';
  document.head.append(l);
}

/** Имя автора записи для подписи: герой (от лица героя) или ник; мастер — «мастер». */
export function authorName(c, e) {
  const masterId = c.members.find((m) => m.role === 'master')?.userId;
  if (e.userId && e.userId === masterId) return 'мастер';
  const hero = e.heroId ? characterOf(c, e.heroId) : null;
  if (hero) return hero.name;
  const m = c.members.find((x) => x.userId === e.userId);
  const h2 = m?.characterId ? characterOf(c, m.characterId) : null;
  return h2?.name || userById(e.userId)?.name || 'игрок';
}
export const hueOf = (c, userId) => userById(userId)?.hue ?? 30;
export const authorColor = (c, userId) => {
  const masterId = c.members.find((m) => m.role === 'master')?.userId;
  return userId === masterId ? 'hsl(38 70% 42%)' : `hsl(${hueOf(c, userId)} 48% 42%)`;
};

/** Текст записи: абзацы, цитаты-ленточки (строки «> »), упоминания @Имя и @[Два слова] — ссылки на указатель. */
export function renderText(text, cid) {
  const lines = String(text || '').split('\n');
  const out = [];
  let para = [], quote = [];
  const mention = (s) => s.replace(/@\[([^\]\n]{1,60})\]|@([\p{L}][\p{L}\d-]{1,30})/gu, (m, a, b) => `<a class="bk-mention" href="#/camp/${esc(cid)}/book/index/${encodeURIComponent(a || b)}">${a || b}</a>`);
  const flushP = () => { if (para.length) out.push(`<p>${mention(esc(para.join(' ')))}</p>`); para = []; };
  const flushQ = () => {
    if (!quote.length) return;
    const t = quote.join(' ');
    const m = t.match(/^\[([^\]]{1,80})\]\s*(.*)$/);
    out.push(`<blockquote class="bk-quote"><span class="bk-ribbon-ic"></span>${m ? `<small>${esc(m[1])}</small>` : ''}<span>${mention(esc(m ? m[2] : t))}</span></blockquote>`);
    quote = [];
  };
  for (const raw0 of lines) {
    const line = raw0.trimEnd();
    if (/^>\s?/.test(line)) { flushP(); quote.push(line.replace(/^>\s?/, '')); continue; }
    flushQ();
    if (!line.trim()) { flushP(); continue; }
    para.push(line.trim());
  }
  flushP(); flushQ();
  return raw(out.join(''));
}

/** Корешок: тома-главы сверху вниз, последняя — «пишется». */
export function spine(c, book, { current = null, hrefOf, glow = null } = {}) {
  const open = book.chapters.filter((ch) => !ch.boundAt).at(-1);
  const pen = book.pen?.userId ? (characterOfUser(c, book.pen.userId)?.name || userById(book.pen.userId)?.name) : null;
  const nextN = (book.chapters.at(-1)?.n || 0) + 1;
  return html`<nav class="bk-spine" aria-label="Корешок книги"><div class="bk-vol bk-vol-head"><b>${c.name}</b><small>книга кампании</small></div>
    ${book.chapters.map((ch) => html`<a class="bk-vol ${ch.n === current ? 'current' : ''} ${ch.n === glow ? 'glow' : ''} ${ch.boundAt ? '' : 'wet'}" href="${hrefOf(ch.n)}"><span class="bk-num">${ROMAN(ch.n)}</span><b>${ch.title || (ch === open && !ch.endedAt ? 'пишется…' : 'без имени')}</b><small>${chapterDate(ch)}</small><span class="bk-stripes">${[...new Set(ch.entries.map((e) => e.userId))].slice(0, 5).map((u) => html`<i style="background:${authorColor(c, u)}"></i>`)}</span></a>`)}
    ${!open || open.endedAt ? html`<span class="bk-vol bk-vol-next"><span class="bk-num">${ROMAN(nextN)}</span><b>${pen ? `перо — ${pen}` : 'пишется…'}</b><small>${book.next?.at ? fmtDate(book.next.at) : 'дата не назначена'}</small></span>` : ''}
  </nav>`;
}
function characterOfUser(c, userId) { const m = c.members.find((x) => x.userId === userId); return m?.characterId ? characterOf(c, m.characterId) : null; }

/** Запись в развороте. me — кто читает; master — вид мастера (печати, входящие). */
export function entryBlock(c, ch, e, { me, master, variants }) {
  const color = authorColor(c, e.userId);
  const time = e.ribbon?.at || null;
  const gutter = html`<div class="bk-gutter">${time ? html`<b>${new Date(time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</b>` : ''}${e.ribbon?.place ? html`<small>${e.ribbon.place}</small>` : ''}${master && (e.footnotes || []).length ? html`<span class="chip chip-accent bk-fn-chip">† сноска</span>` : ''}</div>`;
  if (e.kind === 'sealed' && !e.sealed?.brokenAt) {
    const sec = e.secret;
    if (master && sec) {
      return html`<section class="bk-entry bk-sealed-open" data-entry="${e.id}" data-n="${ch.n}">${gutter}<div class="bk-body"><span class="bk-wax">${ic('square-lock-02', 18)}</span>
        <div class="bk-by" style="--c:#9b2c20"><i></i>под печатью · видишь ты${sec.userId && sec.userId !== me ? ` и ${authorName(c, sec)}` : ''}</div>
        <div class="bk-by" style="--c:${authorColor(c, sec.userId)}"><i></i>${authorName(c, sec)} · только мастеру</div>
        ${sec.title ? html`<h3>${sec.title}</h3>` : ''}<div class="bk-text" style="--c:${authorColor(c, sec.userId)}">${renderText(sec.text, c.id)}</div>
        <p class="bk-seal-when">${ic('clock-01', 14)}Печать сломается: ${sealWhen(c, e.sealed)}<button class="link-btn" data-break="${e.id}">Сломать сейчас</button></p></div></section>`;
    }
    return html`<section class="bk-entry bk-sealed" data-entry="${e.id}" data-n="${ch.n}">${gutter}<div class="bk-body"><div class="bk-seal-card"><span class="bk-wax">${ic('square-lock-02', 18)}</span><span><b>Запечатано мастером</b><small>Здесь чья-то запись. Печать сломается, когда придёт время.</small></span></div></div></section>`;
  }
  const label = e.kind === 'master' || e.kind === 'chronicle' ? 'мастер · хроника' : `${authorName(c, e)} · ${voiceLabel(c, e, ch)}`;
  const flags = e.onlyMaster ? (master ? 'только мастеру · ещё не в главе' : 'только мастеру — видите вы и мастер') : e.diary ? 'только вы — дневник на этом устройстве' : e.sealed?.brokenAt ? `печать сломана · ${fmtDate(e.sealed.brokenAt, { time: true })} · видят все` : '';
  const variant = variants?.get(e.id);
  return html`<section class="bk-entry ${e.onlyMaster || e.diary ? 'bk-private' : ''} ${e.sealed?.brokenAt ? 'bk-broken' : ''}" data-entry="${e.id}" data-n="${ch.n}">${gutter}<div class="bk-body">
    ${flags ? html`<div class="bk-flag">${e.sealed?.brokenAt ? ic('square-lock-02', 12) : ic('view-off', 12)}${flags}</div>` : ''}
    <div class="bk-by" style="--c:${color}"><i></i>${label}</div>
    ${e.title ? html`<h3>${e.title}</h3>` : ''}
    <div class="bk-text" data-text style="--c:${color}">${renderText(e.text, c.id)}</div>
    ${(e.footnotes || []).length ? html`<div class="bk-footnotes">${e.footnotes.map((f) => html`<p>† ${f.text} <span>— мастер</span></p>`)}</div>` : ''}
    ${(e.myNotes || []).length ? html`<div class="bk-footnotes mine">${e.myNotes.map((f) => html`<p>✎ ${f.text} <span>— для себя</span></p>`)}</div>` : ''}
    ${(e.agree || []).length ? html`<p class="bk-agree">помнят так же: ${e.agree.map((u) => authorName(c, { userId: u })).join(', ')}</p>` : ''}
    ${master && e.onlyMaster ? html`<div class="row bk-inbox-actions"><button class="btn btn-sm bk-btn-dark" data-seal="${e.id}">${ic('square-lock-02', 14)}Запечатать в главу</button><button class="btn btn-sm bk-btn-line" data-open-now="${e.id}">Открыть отряду сразу</button></div>` : ''}
  </div>
  <aside class="bk-margin">${variant ? html`<a class="bk-variant-chip" href="#/camp/${c.id}/book/ch/${ch.n}/v/${e.id}">≠ разночтение</a><span class="bk-hand">${variant} помнит иначе</span>` : ''}
    ${(e.margins || []).map((m) => html`<span class="bk-hand" title="${m.quote ? `к строке: «${m.quote}»` : ''}">${m.text} <small>— ${authorName(c, { userId: m.userId })}</small></span>`)}</aside>
  </section>`;
}
export function sealWhen(c, s) {
  const on = s?.breakOn || '';
  if (on.startsWith('scene:')) return `когда отряд войдёт в «${c.scenes.find((x) => x.id === on.slice(6))?.name || 'сцену'}»`;
  if (on.startsWith('chapter:')) return `в начале главы ${ROMAN(Number(on.slice(8)))}`;
  return 'когда сломаете сами';
}

/** Пары разночтений: id записи → имя автора другой версии того же момента. */
export function variantMap(c, ch) {
  const m = new Map();
  for (const e of ch.entries) {
    if (!e.variantOf) continue;
    const other = ch.entries.find((x) => x.id === e.variantOf); if (!other) continue;
    m.set(e.id, authorName(c, other)); m.set(other.id, authorName(c, e));
  }
  return m;
}

/** Шапка главы на левой странице. */
export function chapterHead(c, ch) {
  const ep = ch.epigraph;
  const meta = [`глава ${ROMAN(ch.n)}`, chapterDate(ch), duration(ch), `${voices(ch)} ${voices(ch) === 1 ? 'голос' : voices(ch) < 5 ? 'голоса' : 'голосов'}`].filter(Boolean).join(' · ');
  return html`<header class="bk-chapter-head"><p class="bk-meta">${meta}</p><h1>${ch.title || chapterName(ch)}${ch.boundAt ? '' : html` <small>${ch.endedAt ? 'ждёт переплёта' : 'пишется'}</small>`}</h1>
    ${ep ? html`<blockquote class="bk-epigraph" style="--c:${authorColor(c, ep.userId)}">«${ep.text}»<small>— ${authorName(c, { userId: ep.userId })}</small></blockquote>` : ''}<p class="bk-orn">✦ ✦ ✦</p></header>`;
}
export { mentionsIn };
