// «Своя версия» — запись в книгу кампании (#203, макеты 35–37): ленточки сессии, голос (от лица героя или от себя),
// кто прочтёт, голоса главы, упоминания через @ с указателем книги. Черновик сохраняется на этом устройстве.
import { html, raw, on, esc } from '../../core/dom.js';
import { characterOf } from '../../core/campaign.js';
import { ROMAN, chapterOf, writeEntry, sealEntry, bookIndex, fmtDate, inkWet, sessionLive, heroOfUser, newId } from './book-store.js';
import { local, updateLocal } from './local.js';
import { ic, party } from './parts.js';
import { authorName } from './book-view.js';

let seed = null;
/** Начать запись с цитаты/разночтения: экран записи заберёт это при открытии. */
export function seedDraft(ctx, s) { seed = { ...s, cid: ctx.cid }; }

const ribbonLine = (r) => `> [${new Date(r.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}${r.place ? ` · ${r.place}` : ''}] ${r.text}`;

export function mountWrite(ctx, body, editId) {
  const c = ctx.c, me = ctx.user.id, master = ctx.master;
  const book = ctx.book();
  const hero = heroOfUser(c, me);
  const offs = [];
  const L = (type, sel, fn) => offs.push(on(body, type, sel, fn));
  // Какая глава: правим свою запись — её глава; иначе идущая сессия, последняя с мокрыми чернилами или последняя.
  const existing = editId ? book.chapters.flatMap((ch) => ch.entries).find((e) => e.id === editId && e.userId === me) : null;
  const s0 = seed && seed.cid === ctx.cid ? seed : null; seed = null;
  const pickN = () => existing?.n || s0?.n || (sessionLive(book) ? book.session.n : null) || [...book.chapters].reverse().find((ch) => inkWet(ch))?.n || book.chapters.at(-1)?.n || null;
  const n = pickN();
  if (!n) {
    body.innerHTML = String(html`<div class="cp-empty">${ic('book-open-01', 28)}<h3>Писать пока некуда</h3><p>Первая глава откроется, когда мастер начнёт игру. Во время игры закладывайте ленточки — из них вырастет ваша версия.</p><a class="btn btn-secondary" href="${ctx.href('book')}">К книге</a></div>`);
    return { unmount() {} };
  }
  const ch = chapterOf(book, n) || { n, entries: [] };
  const mine = local('mine', c.id, me);
  const taken = new Set(book.chapters.flatMap((x) => x.entries.map((e) => e.id)));
  const draft = existing ? null : Object.values(mine.drafts || {}).find((d) => d.n === n && !d.variantOf && !s0?.variantOf && !taken.has(d.id));
  const st = {
    id: existing?.id || draft?.id || newId('be-'), n, title: existing?.title ?? draft?.title ?? '', text: existing?.text ?? draft?.text ?? '',
    voice: existing?.voice || draft?.voice || (hero ? 'hero' : 'self'), vis: existing?.diary ? 'me' : existing?.onlyMaster ? 'master' : draft?.vis || 'all',
    variantOf: existing?.variantOf || s0?.variantOf || draft?.variantOf || null, rev: existing?.rev || 0,
  };
  if (s0?.quote) st.text = `${st.text ? `${st.text}\n\n` : ''}> ${s0.quote.replace(/\s+/g, ' ').slice(0, 400)}\n\n`;
  const wet = inkWet(chapterOf(book, n));
  const ribbons = () => (local('mine', c.id, me).ribbons || []).filter((r) => r.n === n || (!r.n && ch.startedAt && r.at >= ch.startedAt && (!ch.endedAt || r.at <= ch.endedAt)));
  const variantOf = st.variantOf ? ch.entries.find((e) => e.id === st.variantOf) : null;

  // Черновик пишется с задержкой; после «Вписать» отложенная запись отменяется — иначе черновик воскрес бы с тем же id.
  let saveTimer = null, closed = false;
  const save = () => { clearTimeout(saveTimer); if (closed) return; saveTimer = setTimeout(() => { if (!closed) updateLocal('mine', c.id, me, (m) => { m.drafts[st.id] = { id: st.id, n, title: st.title, text: st.text, voice: st.voice, vis: st.vis, variantOf: st.variantOf, at: Date.now() }; }); }, 600); };
  const finish = () => { closed = true; clearTimeout(saveTimer); };
  const words = () => (st.text.match(/[\p{L}\d]+/gu) || []).length;

  function voicesList() {
    return party(c).filter((p) => p.member).map((p) => {
      const uid = p.user.id;
      const e = ch.entries.find((x) => x.userId === uid && !x.diary);
      const isPen = ch.pen === uid || (book.pen?.n === n && book.pen.userId === uid);
      const status = uid === me ? (existing ? 'ты · вписано' : 'ты · черновик') : e ? `вписано · ${new Date(e.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : isPen ? 'летописец · пишет…' : 'пока пусто';
      return html`<div class="bk-voice">${raw(String(html`<span class="avatar sm hero">${p.ch.portrait ? html`<img src="${p.ch.portrait.startsWith('assets/') ? p.ch.portrait : `assets/portraits/${p.ch.portrait}.webp`}" alt="" onerror="this.remove()">` : ''}</span>`))}<b>${p.ch.name}</b><small class="${isPen ? 'gold' : ''}">${isPen && e ? 'летописец · вписал' : status}</small></div>`;
    });
  }
  function render() {
    const rb = ribbons();
    const visOpts = master
      ? [['all', 'Весь отряд', 'запись встанет в главу рядом с остальными'], ['seal', 'Под печать', 'отряд увидит печать, текст — когда сломаете'], ['me', 'Только я', 'личная заметка, в книге не появится']]
      : [['all', 'Весь отряд', 'запись встанет в главу рядом с остальными'], ['master', 'Только мастер', 'секрет героя — мастер решит, когда раскрыть'], ['me', 'Только я', 'личный дневник, в книге не появится']];
    body.innerHTML = String(html`<div class="bk-write">
      <div class="bk-crumbs"><a class="btn btn-glass btn-sm" href="${ctx.href('book')}">${ic('arrow-left-02', 14)}Книга кампании</a><span>${c.name} / Глава ${ROMAN(n)} / ${existing ? 'правка' : 'твоя версия'}</span></div>
      <aside class="bk-w-left"><small class="cp-caps">Ленточки этой сессии</small>
        ${rb.length ? rb.map((r) => html`<button class="bk-w-ribbon ${st.text.includes(r.text) ? 'used' : ''}" data-ribbon="${r.id}" draggable="true"><i class="bk-ribbon-mini"></i><span><b>${new Date(r.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</b>${st.text.includes(r.text) ? html` <em>в тексте</em>` : ''}<small>${r.text}</small></span></button>`) : html`<p class="t-sm muted">Ленточек нет. Во время игры нажмите на закладку сверху стола — момент запишется сам.</p>`}
        <p class="t-xs tertiary">Перетащите ленточку в текст или нажмите на неё — она ляжет цитатой с временем и местом, а в книге появится метка на полях.</p></aside>
      <div class="bk-w-paper"><div class="row"><small class="bk-caps violet">Глава ${ROMAN(n)} · ${master ? 'хроника мастера' : 'твоя версия'}${variantOf ? ` · разночтение с ${authorName(c, variantOf)}` : ''}</small><span class="spacer"></span>
          ${!master && hero ? html`<span class="bk-voice-seg"><button data-voice="hero" aria-pressed="${st.voice === 'hero'}">От лица ${hero.name}</button><button data-voice="self" aria-pressed="${st.voice === 'self'}">От себя</button></span>` : ''}</div>
        ${variantOf ? html`<p class="bk-variant-of">${ic('arrow-left-right', 14)}${authorName(c, variantOf)} помнит этот момент так: «${String(variantOf.text).replace(/^>.*$/gm, '').trim().slice(0, 140)}…»</p>` : ''}
        <input class="bk-w-title" data-title maxlength="140" value="${st.title}" placeholder="Заголовок — как вы назвали бы этот момент">
        <div class="bk-w-area"><textarea data-wbody placeholder="Пишите как помните. @ — упомянуть героя, место или вещь из указателя.">${st.text}</textarea></div>
        <div class="bk-w-foot">${ic('droplet', 14)}<span>${wet ? `Чернила сохнут${chapterOf(book, n)?.inkUntil ? ` до ${fmtDate(chapterOf(book, n).inkUntil, { time: true })}` : ' до следующей игры'} — до тех пор правь сколько хочешь` : 'Чернила этой главы высохли — новая запись встанет как поздняя пометка'}</span><span class="spacer"></span><b data-words>${words()} слов</b></div>
      </div>
      <aside class="bk-w-right">
        <section class="cp-card"><small class="cp-caps">Кто прочтёт</small>${visOpts.map(([v, l, h]) => html`<label class="bk-vis"><input type="radio" name="vis" value="${v}" ${st.vis === v ? 'checked' : ''}><span><b>${l}</b><small>${h}</small></span></label>`)}</section>
        <section class="cp-card"><small class="cp-caps">Голоса главы ${ROMAN(n)}</small>${voicesList()}</section>
        <button class="btn btn-primary btn-block" data-commit>${existing ? 'Сохранить правку' : 'Вписать в книгу'}</button>
        <button class="btn btn-secondary btn-block" data-draft>Сохранить черновик</button>
      </aside>
      <div class="bk-mention-pop" data-mpop hidden></div>
    </div>`);
    autosize();
  }
  const ta = () => body.querySelector('[data-wbody]');
  const autosize = () => { const t = ta(); if (t) { t.style.height = 'auto'; t.style.height = `${Math.max(320, t.scrollHeight + 8)}px`; } };
  function insertAtCursor(s) {
    const t = ta(); const a = t.selectionStart ?? t.value.length, b = t.selectionEnd ?? a;
    const before = t.value.slice(0, a), after = t.value.slice(b);
    const pre = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    t.value = `${before}${pre}${s}\n\n${after.replace(/^\n+/, '')}`;
    st.text = t.value; save(); render(); const t2 = ta(); t2.focus(); t2.selectionStart = t2.selectionEnd = (before + pre + s).length + 2;
  }

  // ——— Упоминания @ ———
  let mq = null, mItems = [], mCur = 0;
  function candidates(q) {
    const low = q.toLowerCase();
    const idx = bookIndex(book, c);
    const hit = (name) => !low || name.toLowerCase().includes(low);
    const places = [...new Set([...c.scenes.map((s) => s.name), ...idx.filter((x) => x.kind === 'place').map((x) => x.name)])].filter(hit).slice(0, 4).map((name) => ({ kind: 'Места', name, sub: idx.find((x) => x.name === name) ? `главы ${[...new Set(idx.find((x) => x.name === name).refs.map((r) => ROMAN(r.n)))].join(', ')} · есть на карте` : 'есть на карте', icon: 'location-01' }));
    const heroes = c.characters.map((h) => h.name).filter(hit).slice(0, 4).map((name) => ({ kind: 'Герои', name, sub: 'герой отряда', icon: 'user' }));
    const names = idx.filter((x) => x.kind === 'name' && hit(x.name)).slice(0, 4).map((x) => ({ kind: 'Имена и вещи', name: x.name, sub: `глава ${ROMAN(x.refs[0].n)} · ${x.refs.length} упомин.`, icon: 'sparkles' }));
    const rbs = ribbons().filter((r) => hit(r.text) || hit(r.place || '')).slice(0, 3).map((r) => ({ kind: 'Твои ленточки', name: `${new Date(r.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} · ${r.text.slice(0, 40)}`, sub: 'вставится цитатой с моментом', ribbon: r, icon: 'sticky-note-01' }));
    return [...places, ...heroes, ...names, ...rbs];
  }
  function caretXY(t) {
    const m = document.createElement('div'); const cs = getComputedStyle(t);
    for (const p of ['font', 'lineHeight', 'letterSpacing', 'padding', 'border', 'width', 'boxSizing', 'whiteSpace', 'wordWrap']) m.style[p] = cs[p];
    m.style.position = 'absolute'; m.style.visibility = 'hidden'; m.style.whiteSpace = 'pre-wrap'; m.style.wordWrap = 'break-word';
    m.textContent = t.value.slice(0, t.selectionStart);
    const s = document.createElement('span'); s.textContent = '​'; m.append(s);
    document.body.append(m);
    const r = t.getBoundingClientRect(); const top = r.top + s.offsetTop - t.scrollTop, left = r.left + s.offsetLeft;
    m.remove();
    return { left, top };
  }
  function showMentions() {
    const pop = body.querySelector('[data-mpop]'); const t = ta();
    const m = t.value.slice(0, t.selectionStart).match(/@(\[[^\]\n]*|[\p{L}\d-]*)$/u);
    if (!m) { pop.hidden = true; mq = null; return; }
    mq = m[1].replace(/^\[/, '');
    mItems = candidates(mq); mCur = Math.min(mCur, Math.max(0, mItems.length - 1));
    let last = '';
    pop.innerHTML = String(html`<div class="row bk-mp-head"><small class="bk-caps">указатель книги · «${mq || '…'}»</small><span class="spacer"></span><small>↑ ↓ · Enter</small></div>
      ${mItems.map((it, i) => { const head = it.kind !== last ? html`<small class="bk-caps bk-mp-group">${it.kind}</small>` : ''; last = it.kind; return html`${head}<button class="bk-mp-row ${i === mCur ? 'on' : ''}" data-mi="${i}">${ic(it.icon, 16)}<span><b>${it.name}</b><small>${it.sub}</small></span></button>`; })}
      ${mq ? html`<button class="bk-mp-new" data-mi="new">${ic('plus-sign', 14)}Вписать «${mq}» в указатель как новое имя</button>` : ''}`);
    const xy = caretXY(t); const br = body.getBoundingClientRect();
    pop.hidden = false;
    pop.style.left = `${Math.min(xy.left - br.left, br.width - 360)}px`;
    pop.style.top = `${xy.top - br.top + 28}px`;
  }
  function pickMention(i) {
    const t = ta(); const pos = t.selectionStart;
    const before = t.value.slice(0, pos).replace(/@(\[[^\]\n]*|[\p{L}\d-]*)$/u, '');
    const after = t.value.slice(pos);
    if (i === 'new') { const name = mq.trim(); if (!name) return; t.value = `${before}${/\s/.test(name) ? `@[${name}]` : `@${name}`} ${after}`; t.selectionStart = t.selectionEnd = before.length + name.length + (/\s/.test(name) ? 4 : 2); }
    else {
      const it = mItems[i]; if (!it) return;
      if (it.ribbon) { t.value = before + after; st.text = t.value; t.selectionStart = t.selectionEnd = before.length; body.querySelector('[data-mpop]').hidden = true; insertAtCursor(ribbonLine(it.ribbon)); return; }
      const ins = /\s/.test(it.name) ? `@[${it.name}]` : `@${it.name}`;
      t.value = `${before}${ins} ${after}`; t.selectionStart = t.selectionEnd = before.length + ins.length + 1;
    }
    st.text = t.value; save(); body.querySelector('[data-mpop]').hidden = true; mq = null; t.focus();
  }

  // ——— События ———
  L('input', '[data-wbody]', (e, t) => { st.text = t.value; save(); autosize(); const w = body.querySelector('[data-words]'); if (w) w.textContent = `${words()} слов`; showMentions(); });
  L('click', '[data-wbody]', () => showMentions());
  L('keydown', '[data-wbody]', (e) => {
    if (mq === null || body.querySelector('[data-mpop]').hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); mCur = Math.min(mItems.length - 1, mCur + 1); showMentions(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); mCur = Math.max(0, mCur - 1); showMentions(); }
    if (e.key === 'Enter' && mItems.length) { e.preventDefault(); pickMention(mCur); }
    if (e.key === 'Escape') { e.preventDefault(); body.querySelector('[data-mpop]').hidden = true; mq = null; }
  });
  L('mousedown', '[data-mi]', (e, b) => { e.preventDefault(); pickMention(b.dataset.mi === 'new' ? 'new' : Number(b.dataset.mi)); });
  L('input', '[data-title]', (e, t) => { st.title = t.value; save(); });
  L('click', '[data-voice]', (e, b) => { st.voice = b.dataset.voice; save(); body.querySelectorAll('[data-voice]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); });
  L('change', '[name="vis"]', (e, r) => { st.vis = r.value; save(); });
  L('click', '[data-ribbon]', (e, b) => { const r = ribbons().find((x) => x.id === b.dataset.ribbon); if (r && !st.text.includes(r.text)) insertAtCursor(ribbonLine(r)); });
  L('dragstart', '[data-ribbon]', (e, b) => { const r = ribbons().find((x) => x.id === b.dataset.ribbon); if (r) e.dataTransfer.setData('text/plain', `\n${ribbonLine(r)}\n`); });
  L('drop', '[data-wbody]', () => setTimeout(() => { st.text = ta().value; save(); render(); }, 0));
  L('click', '[data-draft]', () => { clearTimeout(saveTimer); updateLocal('mine', c.id, me, (m) => { m.drafts[st.id] = { id: st.id, n, title: st.title, text: st.text, voice: st.voice, vis: st.vis, variantOf: st.variantOf, at: Date.now() }; }); ctx.toast({ title: 'Черновик сохранён', body: 'На этом устройстве — вернётесь, и он будет здесь', icon: 'note-edit' }); });
  L('click', '[data-commit]', () => {
    st.title = body.querySelector('[data-title]').value.trim(); st.text = ta().value.trim();
    if (!st.text) { ta().focus(); ctx.toast({ title: 'Пока пусто', body: 'Напишите хоть пару строк', icon: 'note-edit' }); return; }
    const used = ribbons().find((r) => st.text.includes(r.text));
    const entry = { id: st.id, n, title: st.title, text: st.text, voice: master ? 'self' : st.voice, heroId: !master && st.voice === 'hero' ? hero?.id : undefined, kind: master ? 'chronicle' : 'voice', variantOf: st.variantOf || undefined, ribbon: used ? { at: used.at, place: used.place, text: used.text } : undefined, rev: st.rev, at: existing?.at };
    finish();
    if (master && st.vis === 'seal') { sealEntry(c.id, me, { ...entry, userId: me, rev: (st.rev || 0) + 1, at: entry.at || Date.now() }, `chapter:${n + 1}`, ''); updateLocal('mine', c.id, me, (m) => { delete m.drafts[st.id]; }); ctx.toast({ title: 'Запечатано в главу', body: `Печать сломается в начале главы ${ROMAN(n + 1)} — или раньше, если сломаете сами`, icon: 'square-lock-02' }); ctx.go('book', 'ch', n); return; }
    writeEntry(c.id, me, entry, st.vis);
    const missing = party(c).filter((p) => p.member && p.user.id !== me && !ch.entries.some((e) => e.userId === p.user.id)).map((p) => p.ch.name);
    const ink = chapterOf(book, n)?.inkUntil;
    if (st.vis === 'me') ctx.toast({ title: 'Записано в дневник', body: 'Только вы, на этом устройстве. В книгу кампании не попадёт.', icon: 'note-edit' });
    else ctx.toast({ title: `Твоя версия вписана в главу ${ROMAN(n)}`, body: `${ink && ink > Date.now() ? `Править можно до ${fmtDate(ink, { time: true })} — потом чернила высохнут.` : 'Править можно, пока мастер не высушит чернила.'}${missing.length ? ` Ждём версии: ${missing.join(', ')}.` : ''}${st.vis === 'master' ? ' Видите вы и мастер.' : ''}`, icon: 'notification-01', timeout: 9000 });
    ctx.go('book', st.vis === 'me' ? 'mine' : 'ch', ...(st.vis === 'me' ? [] : [n]));
  });
  const onAway = (e) => { const pop = body.querySelector('[data-mpop]'); if (pop && !pop.hidden && !pop.contains(e.target) && !e.target.closest('[data-wbody]')) pop.hidden = true; };
  addEventListener('mousedown', onAway);
  render();
  if (s0?.quote) save();
  return { update() { /* правка идёт — не перерисовываем поверх ввода */ }, unmount() { if (!closed && saveTimer) { clearTimeout(saveTimer); updateLocal('mine', c.id, me, (m) => { m.drafts[st.id] = { id: st.id, n, title: st.title, text: st.text, voice: st.voice, vis: st.vis, variantOf: st.variantOf, at: Date.now() }; }); } closed = true; for (const off of offs) off(); removeEventListener('mousedown', onAway); } };
}
export { esc, characterOf };
