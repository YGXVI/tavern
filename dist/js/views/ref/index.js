// Справочник D&D 5e 2014 (#203, макеты 81–87): главная, разделы с фильтрами, карточка, поиск Ctrl K, телефон.
// Открыт без входа. Адрес: #/ref, #/ref/<раздел>, #/ref/<раздел>/<id>?фильтры — ссылкой можно поделиться.
import { html, raw, esc, on, plural } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { toast, menu, copyText } from '../../ui/kit.js';
import { roll } from '../../../engine.js';
import { currentUser } from '../../core/auth.js';
import { campaignsFor, roleIn } from '../../core/campaign.js';
import { appHeader, bindHeader, logoButton, pasteInvite } from '../screens.js';
import { SECTIONS, sectionById, loadSection, sectionNow, search, SPELL_CLASSES, SCHOOLS, COUNTS, crNum, norm } from './data.js';
import { card, ruleById, termOf } from './cards.js';
import { openPalette, bindPaletteKeys } from './palette.js';
import { encounters, newEncounter, addToEncounter } from '../camp/encounters.js';
import { galleryPage, refreshGallery, classPage, wireClass } from './classes.js';

const ic = (n, s = 16) => raw(icon(n, s));
const STORE = 'rasputye-ref-v1';
const prefs = () => { try { return { fav: [], recent: [], saved: [], ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch { return { fav: [], recent: [], saved: [] }; } };
const setPrefs = (fn) => { const p = prefs(); fn(p); try { localStorage.setItem(STORE, JSON.stringify(p)); } catch { /* приватное окно */ } return p; };
/** Сохранённое из справочника «в книгу героя» — показывается в «Моих героях». */
export const savedFromReference = () => { const p = prefs(); return p.saved.map((k) => p.names?.[k]).filter(Boolean); };

function parse(hash) {
  const [path, qs = ''] = String(hash || '').replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean); // ref, section, id
  return { section: parts[1] || null, id: parts[2] ? decodeURIComponent(parts[2]) : null, q: new URLSearchParams(qs) };
}
const hrefOf = (section, id, q) => `#/ref/${section}${id ? `/${encodeURIComponent(id)}` : ''}${q && String(q) ? `?${q}` : ''}`;

/** Фильтры разделов: [ключ, подпись, варианты(items) → [[значение, подпись]], отбор(item, значение)]. */
const FILTERS = {
  spells: [
    ['lvl', 'Уровень', () => [['0', 'Заговоры'], ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [String(n), String(n)])], (it, v) => String(it.level) === v, 'chips'],
    ['cls', 'Класс', () => SPELL_CLASSES.map((c) => [c, c]), (it, v) => it.classes.includes(v), 'checks'],
    ['sch', 'Школа', () => Object.entries(SCHOOLS), (it, v) => it.school === v, 'chips'],
    ['conc', 'Концентрация', null, (it) => it.conc, 'switch'],
    ['rit', 'Ритуал', null, (it) => it.ritual, 'switch'],
  ],
  creatures: [
    ['cr', 'Опасность', () => [['0-1', '0–1'], ['2-4', '2–4'], ['5-10', '5–10'], ['11-30', '11+']], (it, v) => { const [a, b] = v.split('-').map(Number); return it.cr >= a && it.cr <= b; }, 'chips'],
    ['type', 'Тип', (items) => [...new Set(items.map((x) => x.m.type).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')).map((t) => [t, t]), (it, v) => it.m.type === v, 'chips'],
    ['size', 'Размер', () => [['tiny', 'Крошечный'], ['small', 'Маленький'], ['medium', 'Средний'], ['large', 'Большой'], ['huge', 'Огромный'], ['gargantuan', 'Громадный']], (it, v) => it.m.size === v, 'chips'],
  ],
  items: [
    ['rar', 'Редкость', (items) => [...new Set(items.map((x) => x.rarity).filter(Boolean))].map((r) => [r, r]), (it, v) => it.rarity === v, 'chips'],
    ['type', 'Тип', (items) => [...new Set(items.map((x) => x.type).filter(Boolean))].map((r) => [r, r]), (it, v) => it.type === v, 'chips'],
    ['att', 'Нужна настройка', null, (it) => it.attune, 'switch'],
    ['txt', 'С описанием (SRD)', null, (it) => !!it.text, 'switch'],
  ],
  equipment: [['kind', 'Вид', (items) => [...new Set(items.map((x) => x.kind))].map((k) => [k, items.find((x) => x.kind === k).kindName]), (it, v) => it.kind === v, 'chips']],
  rules: [['grp', 'Раздел', (items) => [...new Set(items.map((x) => x.group))].map((g) => [g, g]), (it, v) => it.group === v, 'chips']],
};
const SORTS = { spells: [['abc', 'По алфавиту'], ['lvl', 'По уровню']], creatures: [['cr', 'По опасности'], ['abc', 'По алфавиту']], items: [['abc', 'По алфавиту'], ['rar', 'По редкости']] };
const RAR = ['Обычный', 'Необычный', 'Редкий', 'Очень редкий', 'Легендарный', 'Артефакт', 'Редкость варьируется', 'Не имеет редкости'];

function applyFilters(section, items, q) {
  const defs = FILTERS[section] || [];
  let out = items;
  for (const [key, , , test, kind] of defs) {
    const vals = q.getAll(key);
    if (!vals.length) continue;
    out = kind === 'switch' ? out.filter((it) => test(it)) : out.filter((it) => vals.some((v) => test(it, v)));
  }
  const s = q.get('sort');
  if (s === 'lvl') out = [...out].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'ru'));
  if (s === 'abc') out = [...out].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  if (s === 'rar') out = [...out].sort((a, b) => RAR.indexOf(a.rarity) - RAR.indexOf(b.rarity) || a.name.localeCompare(b.name, 'ru'));
  if (section === 'creatures' && (!s || s === 'cr')) out = [...out].sort((a, b) => a.cr - b.cr || a.name.localeCompare(b.name, 'ru'));
  return out;
}

export function mountRef(root, hash) {
  let st = parse(hash);
  let lastHash = hash;
  let text = '';          // строка поиска раздела
  let lang = 'ru';
  let filtersOpen = false; // телефон: шторка фильтров
  const offs = [];
  const L = (type, sel, fn) => offs.push(on(root, type, sel, fn));
  const user = () => currentUser();
  const phone = () => matchMedia('(max-width: 720px)').matches;

  const header = () => {
    const u = user();
    if (u) return appHeader(u, 'ref');
    return html`<header class="app-header">
      <a class="brand" href="#/ref">${logoButton()}<span>Распутье</span></a><span class="spacer"></span>
      <button class="btn btn-secondary btn-sm" data-paste>${ic('link-01')}Вставить приглашение</button>
      <a class="btn btn-discord btn-sm" href="#/login">${ic('discord')}Войти через Discord</a>
    </header>`;
  };

  // ——— Главная ———
  function home() {
    const p = prefs();
    const recent = p.recent.slice(0, 6).map((k) => { const [s, id] = k.split('/'); return { s, id, it: sectionNow(s)?.find((x) => x.id === id) }; }).filter((x) => x.it);
    const popular = [['spells', '205', 'Огненный шар'], ['creatures', 'goblin', 'Гоблин'], ['rules', 'grappled', 'Схватка'], ['rules', 'hide', 'Скрытность'], ['rules', 'short-rest', 'Короткий отдых'], ['rules', 'restrained', 'Опутан']];
    return html`<main class="page ref-home">
      <h1 class="ref-h1">Справочник</h1>
      <p class="ref-lead">Заклинания, существа, классы и правила D&amp;D 5e 2014. Пишите как удобно: «огненный шар», «fireball» и даже «огеный шар» приведут к одной карточке.</p>
      <button class="ref-bigsearch" data-palette>${ic('search-01', 20)}<span>Заклинание, существо, правило…</span><kbd>Ctrl K</kbd></button>
      <div class="ref-popular"><span>Часто ищут:</span>${popular.map(([s, id, n]) => html`<a class="chip" href="${hrefOf(s, id)}">${n}</a>`)}</div>
      <div class="ref-sections">${SECTIONS.map((s) => html`<a class="ref-section" href="#/ref/${s.id}"><span class="ref-sec-ic">${ic(s.icon, 18)}</span><span class="ref-sec-n">${sectionNow(s.id)?.length || COUNTS[s.id]}${s.id === 'rules' ? '' : ''}</span><b>${s.name}</b><small>${s.hint}</small>${phone() ? ic('arrow-right-02') : ''}</a>`)}</div>
      <div class="ref-bottom">
        <div class="ref-cta"><div><h3>${user() ? 'Начитались — пора за стол' : 'Пора за стол?'}</h3><p>${user() ? 'Пошаговый мастер соберёт героя минут за пятнадцать и подскажет на каждом шаге.' : 'Пошаговый мастер соберёт героя минут за пятнадцать и подскажет на каждом шаге. Вход — через Discord, одним нажатием.'}</p></div>
          <a class="btn btn-primary" href="${user() ? '#/hero/new' : '#/login'}">${ic('arrow-right-02')}Собрать героя</a></div>
        <div class="ref-recent"><small>Недавно смотрели</small>
          <div class="ref-chips">${recent.length ? recent.map((r) => html`<a class="chip" href="${hrefOf(r.s, r.id)}">${r.it.name}</a>`) : html`<span class="t-sm tertiary">пока ничего</span>`}</div>
          <p class="t-sm muted">${ic('star', 14)}В избранном ${p.fav.length}${user() ? '' : ' — сохранится в этом браузере'}${p.saved.length ? ` · в книгу героя ${p.saved.length}` : ''}</p></div>
      </div>
      <p class="ref-foot">Полные тексты — из SRD 5.1 (CC BY 4.0); для остального — названия и параметры.</p>
    </main>`;
  }

  // ——— Раздел ———
  function filtersHTML(section, items) {
    const defs = FILTERS[section]; if (!defs) return '';
    return html`<aside class="ref-filters ${filtersOpen ? 'open' : ''}">${defs.map(([key, label, opts, , kind]) => {
      const vals = st.q.getAll(key);
      if (kind === 'switch') return html`<label class="ref-switch"><span>${label}</span><input type="checkbox" class="switch" data-flt="${key}" ${vals.length ? 'checked' : ''}></label>`;
      const list = opts(items);
      if (kind === 'checks') return html`<div class="ref-fgroup"><small>${label}</small>${list.map(([v, l]) => html`<label class="ref-check"><input type="checkbox" data-flt="${key}" value="${v}" ${vals.includes(v) ? 'checked' : ''}><span>${l}</span></label>`)}</div>`;
      return html`<div class="ref-fgroup"><small>${label}</small><div class="ref-chips">${list.map(([v, l]) => html`<button class="chip chip-md" data-fchip="${key}" data-v="${v}" aria-pressed="${vals.includes(v)}">${l}</button>`)}</div></div>`;
    })}<p class="ref-note">${ic('link-01', 14)}Фильтры живут в адресе — ссылкой можно поделиться.</p></aside>`;
  }
  function activeChips(section, items) {
    const defs = FILTERS[section] || [];
    const chips = [];
    for (const [key, label, opts, , kind] of defs) for (const v of st.q.getAll(key)) {
      const l = kind === 'switch' ? label : (opts(items).find((o) => o[0] === v)?.[1] || v);
      chips.push(html`<button class="chip chip-accent" data-unflt="${key}" data-v="${v}">${l} ×</button>`);
    }
    return chips.length ? html`<div class="ref-active">${chips}<button class="link-btn" data-reset>Сбросить</button></div>` : '';
  }
  function listRows(section, items) {
    const r = search(applyFilters(section, items, st.q), text, Infinity);
    const shown = r.list;
    const row = (it) => {
      const tags = section === 'spells' ? html`${it.conc ? html`<span class="ref-tag">Концентрация</span>` : ''}${it.ritual ? html`<span class="ref-tag">Ритуал</span>` : ''}<span class="ref-r">${it.schoolName}</span>`
        : section === 'creatures' ? html`<span class="ref-r">Опасн. ${it.m.cr}</span>` : html`<span class="ref-r">${it.sub}</span>`;
      const av = section === 'creatures' ? html`<span class="ref-av"><img src="${it.m.img}" alt="" loading="lazy" onerror="this.remove()"></span>` : '';
      return html`<a class="ref-row-item ${it.id === st.id ? 'current' : ''}" href="${hrefOf(section, it.id, st.q)}">${av}<span class="ref-ri-t"><b>${it.name}</b><small>${it.en || (section === 'creatures' ? it.m.type : '')}</small></span>${tags}${phone() ? ic('arrow-right-02') : ''}</a>`;
    };
    return { count: shown.length, html: html`${r.alt ? html`<p class="ref-hint">${ic('sparkles', 14)}Ищем «${r.alt}» — похоже на другую раскладку</p>` : r.typo ? html`<p class="ref-hint">${ic('sparkles', 14)}Похоже на опечатку — ближайшее к «${text}»</p>` : ''}
      ${shown.length ? shown.slice(0, 400).map(row) : html`<p class="ref-empty">Ничего не нашлось. Попробуйте короче, по-английски или сбросьте фильтры.</p>`}
      ${shown.length > 400 ? html`<p class="ref-empty">Показаны первые 400 из ${shown.length} — уточните поиск или фильтры.</p>` : ''}` };
  }
  function footActions(it) {
    const u = user();
    const key = `${it.section}/${it.id}`;
    if (it.section === 'spells') {
      const saved = prefs().saved.includes(key);
      return html`<button class="btn btn-primary btn-sm" data-save="${key}">${ic(saved ? 'tick-02' : 'book-open-01')}${saved ? 'В книге героя' : 'В книгу героя'}</button><span class="t-xs tertiary">${u ? 'Книга героя — в «Моих героях»' : 'Книга героя — после входа; вернём сюда же'}</span>`;
    }
    if (it.section === 'creatures') {
      const masterOf = u ? campaignsFor(u.id).filter((c) => roleIn(c, u.id) === 'master') : [];
      return html`<button class="btn btn-primary btn-sm" data-place="${it.monsterId}" ${masterOf.length ? '' : raw('disabled')}>${ic('maps')}Поставить на карту</button><button class="btn btn-secondary btn-sm" data-enc="${it.monsterId}" ${masterOf.length ? '' : raw('disabled')}>${ic('plus-sign')}Во встречу</button>
        <span class="t-xs tertiary">${u ? (masterOf.length ? 'Встанет на текущую сцену скрытым' : 'Для мастера кампании') : 'Для мастера, после входа: встанет на текущую сцену скрытым'}</span>`;
    }
    return '';
  }
  function similar(it, items) {
    if (it.section !== 'creatures') return '';
    const near = items.filter((x) => x !== it && x.m.type === it.m.type && Math.abs(x.cr - it.cr) <= 1).slice(0, 3);
    return near.length ? html`<span class="ref-similar">Похоже: ${near.map((x, i) => html`${i ? ' · ' : ''}<a href="${hrefOf('creatures', x.id, st.q)}">${x.name}</a>`)}</span>` : '';
  }
  function cardHTML(section, items) {
    const it = st.id ? items.find((x) => x.id === st.id) : null;
    if (!it) return html`<div class="ref-card ref-card-empty">${ic(sectionById(section).icon, 28)}<p>Выберите запись слева — карточка откроется здесь.</p></div>`;
    const key = `${section}/${it.id}`;
    return html`<article class="ref-card" data-card>${phone() ? html`<div class="ref-sheet-grip" data-close-sheet aria-label="Закрыть"></div>` : ''}
      <div class="ref-card-body">${card(it, { lang, key, fav: prefs().fav.includes(key) })}</div>
      <footer class="ref-card-foot">${footActions(it)}<span class="spacer"></span>${similar(it, items)}<span class="t-xs tertiary">${it.section === 'creatures' && !it.m.srd ? '' : 'SRD 5.1 · CC BY 4.0'}</span></footer></article>`;
  }
  function topBar(s, items) {
    return html`<div class="ref-top">
        <nav class="h-seg dark ref-tabs" aria-label="Разделы справочника">${SECTIONS.map((x) => html`<a href="#/ref/${x.id}" aria-selected="${x.id === s.id}">${x.name}${x.id === s.id ? html` <span class="ref-count">${items.length}</span>` : ''}</a>`)}</nav>
        <label class="input ref-search">${ic('search-01', 18)}<input data-text value="${text}" placeholder="Искать в разделе «${s.name.toLowerCase()}»…" aria-label="Поиск в разделе" autocomplete="off"><kbd>/</kbd></label>
      </div>`;
  }
  // ——— Классы: галерея и страница класса ———
  function classState(q) { return { lvl: Math.min(20, Math.max(1, Number(q.get('lvl')) || 1)) }; }
  function classesPage(items) {
    const s = sectionById('classes');
    const top = phone() ? html`<div class="ref-phone-bar"><a class="icon-btn icon-btn-sm" href="${st.id ? '#/ref/classes' : '#/ref'}" aria-label="Назад">${ic('arrow-left-02', 18)}</a><h2>${s.name}</h2><button class="icon-btn icon-btn-sm" data-palette aria-label="Поиск">${ic('search-01', 18)}</button></div>` : topBar(s, items);
    const it = st.id && items.find((x) => x.id === st.id);
    if (!it) return galleryPage(items, st.q, text, top);
    const key = `classes/${it.id}`;
    return html`<main class="page cls-wrap">${top}${classPage(it, classState(st.q), { key, fav: prefs().fav.includes(key) })}
      <p class="ref-foot">Описания умений — наш пересказ по SRD 5.1 (CC BY 4.0); полный английский текст — под каждым умением.</p></main>`;
  }
  function sectionPage(items) {
    const s = sectionById(st.section);
    const lst = listRows(st.section, items);
    const sorts = SORTS[st.section];
    const sort = st.q.get('sort') || sorts?.[0][0];
    const nFilters = (FILTERS[st.section] || []).reduce((n, [k]) => n + st.q.getAll(k).length, 0);
    return html`<main class="page ref-page ${FILTERS[st.section] ? 'has-filters' : ''} ${st.id ? 'has-card' : ''}">
      ${topBar(s, items)}
      ${phone() ? html`<div class="ref-phone-bar"><a class="icon-btn icon-btn-sm" href="#/ref" aria-label="Назад">${ic('arrow-left-02', 18)}</a><h2>${s.name}</h2><button class="icon-btn icon-btn-sm" data-palette aria-label="Поиск">${ic('search-01', 18)}</button></div>
        <div class="ref-phone-chips">${FILTERS[st.section] ? html`<button class="chip chip-md" data-ftoggle>${ic('settings-01', 14)}Фильтр${nFilters ? ` · ${nFilters}` : ''}</button>` : ''}${activeChips(st.section, items)}</div>` : ''}
      ${filtersHTML(st.section, items)}
      <section class="ref-list">
        <div class="ref-list-head"><b>Найдено ${lst.count}</b>${phone() ? '' : activeChips(st.section, items)}<span class="spacer"></span>${sorts ? html`<button class="link-btn" data-sort="${sorts.find((x) => x[0] !== sort)?.[0] || sorts[0][0]}">${sorts.find((x) => x[0] === sort)?.[1]}</button>` : ''}</div>
        <div class="ref-rows" data-rows>${lst.html}</div>
      </section>
      ${phone() && st.id ? html`<div class="ref-sheet-bg" data-close-sheet></div>` : ''}
      ${cardHTML(st.section, items)}
    </main>`;
  }

  // ——— Сборка ———
  let token = 0;
  function render() {
    const my = ++token;
    const s = st.section && sectionById(st.section);
    if (!s) { paint(home()); for (const x of SECTIONS) if (!sectionNow(x.id) && x.id !== 'items') loadSection(x.id).then(() => { if (my === token && !st.section) paint(home()); }, () => {}); return; }
    const items = sectionNow(s.id);
    if (items) { paint(s.id === 'classes' ? classesPage(items) : sectionPage(items)); track(); return; }
    paint(html`<main class="page ref-page"><div class="ref-loading">${ic('hourglass', 24)}<p>Открываю раздел «${s.name}»…</p></div></main>`);
    loadSection(s.id).then(() => { if (my === token) render(); }, (err) => { if (my === token) paint(html`<main class="page ref-page"><div class="ref-loading">${ic('alert-circle', 24)}<p>Раздел не загрузился: ${err.message}</p><button class="btn btn-secondary" data-retry>Ещё раз</button></div></main>`); });
  }
  function paint(body) {
    root.innerHTML = String(html`<div class="screen ref-screen">${header()}${body}</div>`);
    const u = user(); if (u) bindHeader(root, u);
    root.querySelector('.ref-row-item.current')?.scrollIntoView({ block: 'nearest' });
  }
  function track() {
    if (!st.id || !st.section) return;
    const key = `${st.section}/${st.id}`;
    setPrefs((p) => { p.recent = [key, ...p.recent.filter((k) => k !== key)].slice(0, 12); });
  }
  const refreshList = () => {
    const items = sectionNow(st.section); if (!items) return;
    const box = root.querySelector('[data-rows]'); if (!box) return;
    const lst = listRows(st.section, items);
    box.innerHTML = String(lst.html);
    const head = root.querySelector('.ref-list-head b'); if (head) head.textContent = `Найдено ${lst.count}`;
  };
  const setQ = (fn) => { const q = new URLSearchParams(st.q); fn(q); location.hash = hrefOf(st.section, st.id, q); };

  // ——— События ———
  L('click', '[data-palette]', () => openPalette());
  L('click', '[data-retry]', () => render());
  L('click', '[data-paste]', () => pasteInvite());
  L('input', '[data-text]', (e) => { text = e.target.value; if (st.section === 'classes') { const items = sectionNow('classes'); if (items && !st.id) refreshGallery(root, items, st.q, text); return; } refreshList(); });
  L('keydown', '[data-text]', (e) => {
    if (e.key !== 'Enter') return;
    if (st.section === 'classes') { const hit = search(sectionNow('classes') || [], text, 1).list[0]; if (hit) location.hash = hrefOf('classes', hit.id); return; }
    const first = root.querySelector('[data-rows] .ref-row-item'); if (first) location.hash = first.getAttribute('href');
  });
  // Подбор класса: значения живут в адресе, как фильтры других разделов.
  L('click', '[data-qtoggle]', (e, b) => setQ((q) => { const k = b.dataset.qtoggle, v = b.dataset.v; if (!v || q.get(k) === v) q.delete(k); else q.set(k, v); }));
  L('change', '[data-qswitch]', (e, b) => setQ((q) => { if (b.checked) q.set(b.dataset.qswitch, '1'); else q.delete(b.dataset.qswitch); }));
  L('click', '[data-qclear]', (e, b) => setQ((q) => { for (const k of b.dataset.qclear.split(',')) q.delete(k); }));
  offs.push(wireClass(root, { onState: (cs, it) => {
    const q = new URLSearchParams(st.q);
    if (cs.lvl > 1) q.set('lvl', cs.lvl); else q.delete('lvl');
    q.delete('view'); q.delete('nosub');
    const h = hrefOf('classes', it.id, q);
    if (h !== location.hash) { history.replaceState(null, '', h); lastHash = location.hash; st = parse(location.hash); }
  } }));
  L('click', '[data-fchip]', (e, b) => setQ((q) => { const k = b.dataset.fchip, v = b.dataset.v; const all = q.getAll(k); q.delete(k); (all.includes(v) ? all.filter((x) => x !== v) : [...all, v]).forEach((x) => q.append(k, x)); }));
  L('change', '[data-flt]', (e, b) => setQ((q) => { const k = b.dataset.flt; if (b.type === 'checkbox' && b.value && b.value !== 'on') { const all = q.getAll(k); q.delete(k); (b.checked ? [...all, b.value] : all.filter((x) => x !== b.value)).forEach((x) => q.append(k, x)); } else if (b.checked) q.set(k, '1'); else q.delete(k); }));
  L('click', '[data-unflt]', (e, b) => setQ((q) => { const k = b.dataset.unflt; const all = q.getAll(k).filter((x) => x !== b.dataset.v); q.delete(k); all.forEach((x) => q.append(k, x)); }));
  L('click', '[data-reset]', () => setQ((q) => { for (const k of [...q.keys()]) if (k !== 'sort') q.delete(k); }));
  L('click', '[data-sort]', (e, b) => setQ((q) => q.set('sort', b.dataset.sort)));
  L('click', '[data-ftoggle]', () => { filtersOpen = !filtersOpen; root.querySelector('.ref-filters')?.classList.toggle('open', filtersOpen); });
  L('click', '[data-close-sheet]', () => { location.hash = hrefOf(st.section, null, st.q); });
  L('click', '[data-lang]', (e, b) => { lang = b.dataset.lang; render(); });
  L('click', '[data-fav]', (e, b) => { const k = b.dataset.fav; const p = setPrefs((pp) => { pp.fav = pp.fav.includes(k) ? pp.fav.filter((x) => x !== k) : [k, ...pp.fav]; }); toast({ title: p.fav.includes(k) ? 'В избранном' : 'Убрано из избранного', icon: 'star' }); render(); });
  L('click', '[data-share]', async () => { const ok = await copyText(location.href); toast({ title: ok ? 'Ссылка скопирована' : 'Не удалось скопировать', icon: 'link-01' }); });
  L('click', '[data-save]', (e, b) => {
    const k = b.dataset.save;
    if (!user()) { try { sessionStorage.setItem('rasputye-v2-return', location.hash); } catch { /* */ } }
    const it = sectionNow(st.section)?.find((x) => `${x.section}/${x.id}` === k);
    const p = setPrefs((pp) => { pp.saved = pp.saved.includes(k) ? pp.saved.filter((x) => x !== k) : [k, ...pp.saved]; pp.names = { ...(pp.names || {}), ...(it ? { [k]: it.name } : {}) }; });
    toast({ title: p.saved.includes(k) ? 'Отложено в книгу героя' : 'Убрано из книги героя', body: p.saved.includes(k) ? (user() ? 'Появится в «Моих героях» — возьмёте при сборке или повышении уровня.' : 'Сохранили в этом браузере — после входа найдёте в «Моих героях».') : '', icon: 'book-open-01' });
    render();
  });
  L('click', '[data-roll]', (e, b) => {
    e.preventDefault();
    const f = b.dataset.roll;
    try { const r = roll(f); toast({ title: `${b.textContent.trim() || f}: ${r.total}`, body: r.rolls.length > 1 ? `Кубы: ${r.rolls.join(' + ')}` : f.replace(/d/g, 'к'), icon: 'dice-faces-06' }); }
    catch (err) { toast({ title: 'Не бросить', body: err.message, icon: 'alert-circle' }); }
  });
  L('mouseover', '[data-term]', (e, a) => {
    if (a.__tip) return;
    const r = ruleById(a.dataset.term); if (!r) return;
    a.__tip = true;
    const tip = document.createElement('div');
    tip.className = 'ref-tip panel';
    tip.innerHTML = String(html`<b>${r.name}</b><p>${r.text}</p><a href="#/ref/rules/${r.id}">Открыть правило ${ic('arrow-right-02', 14)}</a>`);
    document.body.append(tip);
    const rc = a.getBoundingClientRect();
    tip.style.left = `${Math.min(innerWidth - 300, Math.max(8, rc.left))}px`;
    tip.style.top = `${rc.bottom + 6}px`;
    const off = () => { setTimeout(() => { if (!tip.matches(':hover') && !a.matches(':hover')) { tip.remove(); a.__tip = false; a.removeEventListener('mouseleave', off); } else setTimeout(off, 200); }, 150); };
    a.addEventListener('mouseleave', off);
  });
  L('click', '[data-feat]', async (e, b) => {
    const feat = (await fetch(new URL('../../data/features-2014.json', import.meta.url)).then((r) => r.json()).catch(() => null))?.entries.find((f) => f.id === b.dataset.feat);
    if (!feat) return;
    toast({ title: feat.name.ru || feat.name.en, body: String(feat.text.ru || feat.text.en || '').slice(0, 600), icon: 'book-open-01', timeout: 15000 });
  });
  L('click', '[data-place]', (e, b) => pickCampaign(b, (c) => { location.hash = `#/c/${c.id}/do/place/${encodeURIComponent(b.dataset.place)}`; }));
  L('click', '[data-enc]', (e, b) => pickCampaign(b, (c, anchor) => {
    const u = user();
    const list = encounters(c.id, u.id);
    menu([...list.map((en) => ({ icon: 'monster', label: en.name, hint: `${en.monsters.reduce((s, m) => s + m.count, 0)} сущ.`, onClick: () => { addToEncounter(c.id, u.id, en.id, b.dataset.enc); toast({ title: `Добавлено во встречу «${en.name}»`, icon: 'monster', action: { label: 'Открыть', onClick: () => { location.hash = `#/camp/${c.id}/encounters/${en.id}`; } } }); } })),
      'divider', { icon: 'plus-sign', label: 'Новая встреча', onClick: () => { const en = newEncounter(c.id, u.id, { monsters: [{ id: b.dataset.enc, count: 1 }] }); toast({ title: 'Новая встреча', body: c.name, icon: 'monster', action: { label: 'Открыть', onClick: () => { location.hash = `#/camp/${c.id}/encounters/${en.id}`; } } }); } }], anchor, { placement: 'top' });
  }));
  function pickCampaign(anchor, then) {
    const u = user(); if (!u) { location.hash = '#/login'; return; }
    const list = campaignsFor(u.id).filter((c) => roleIn(c, u.id) === 'master');
    if (list.length === 1) { then(list[0], anchor); return; }
    menu(list.map((c) => ({ icon: 'maps', label: c.name, onClick: () => then(c, anchor) })), anchor, { placement: 'top' });
  }
  const offKeys = bindPaletteKeys({ slash: () => { const i = root.querySelector('[data-text]'); if (i) i.focus(); else openPalette(); } });
  const onEsc = (e) => { if (e.key === 'Escape' && st.id && phone() && !document.querySelector('.ref-pal-root')) location.hash = hrefOf(st.section, null, st.q); };
  addEventListener('keydown', onEsc);
  // Шторка карточки на телефоне: смахнуть вниз — назад к списку.
  let touchY = null;
  L('touchstart', '[data-card]', (e) => { const body = e.target.closest('.ref-card-body'); touchY = body && body.scrollTop > 0 ? null : e.touches[0].clientY; });
  L('touchend', '[data-card]', (e) => { if (touchY != null && e.changedTouches[0].clientY - touchY > 90) location.hash = hrefOf(st.section, null, st.q); touchY = null; });

  render();
  return {
    update(h) {
      h = h || location.hash;
      if (h === lastHash) return;
      lastHash = h;
      const prev = st;
      st = parse(h);
      if (prev.section !== st.section) { text = ''; filtersOpen = false; }
      render();
    },
    unmount() { for (const off of offs) off(); offKeys(); removeEventListener('keydown', onEsc); document.querySelectorAll('.ref-tip').forEach((n) => n.remove()); },
  };
}
export { norm, termOf, crNum, plural, esc };
