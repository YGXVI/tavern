// Классы в справочнике (#203): галерея с подбором «какой класс мой», страница класса с ползунком уровня,
// дорогой 1→20 с развилкой подкласса, классической таблицей и стартом (владения, снаряжение, мультикласс).
// Состояние страницы (уровень, вид, путь) живёт в атрибутах [data-cls] — одинаково в справочнике и в модалке на столе.
import { html, raw, plural } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { ABIL, SKILL_RU, GEAR_NAMES, SPELL_CLASSES, sectionNow, norm } from './data.js';
import { CLASS_META, ROLE, MAGIC, DIFF, WANTS, SUB_INTRO, SUM, UPG, OPT, COLUMNS, ARMOR, WEAPON, TOOL, GEAR, FOCUS, prereqRu, reflow } from './class-text.js';
import { rich } from './cards.js';

const ic = (n, s = 16) => raw(icon(n, s));
const art = (id) => new URL(`../../../assets/hero/class-${id}.webp`, import.meta.url).href;
const ab = (id) => ABIL.find((a) => a.id === id) || { short: id, name: id };
const meta = (id) => CLASS_META[id] || { color: '#e9b052', tagline: '', play: '', roles: [], diff: 2, main: [], magic: 'none', phb: 1, want: [] };
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
const dice = (v) => String(v).replace(/d/g, 'к');
const fork = (s = 16) => raw(`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22v-8"/><path d="M12 14 6 6"/><path d="m12 14 6-8"/><path d="M4 8V4h4"/><path d="M20 8V4h-4"/></svg>`);
const diamond = (s = 12) => raw(`<svg width="${s}" height="${s}" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 0 12 6 6 12 0 6Z" fill="currentColor"/></svg>`);
const ASI = (f) => /:ability-score-improvement$/.test(f.key);
const spellClass = (it) => (SPELL_CLASSES.includes(it.name) ? it.name : null);
const fmtCol = (c, v) => {
  const d = COLUMNS[c] || {};
  if (v == null || v === '') return '—';
  if (v === 'unlimited') return '∞';
  if (d.dice) return dice(v);
  if (d.feet) return `+${String(v).replace(/^\+/, '')} фт`;
  if (d.circle) return `${v}-й`;
  return String(v);
};
const maxCircle = (slots) => (slots ? slots.reduce((m, n, i) => (n > 0 ? i + 1 : m), 0) : 0);

// ——— Модель дороги: что приходит на каждом уровне ———
const modelCache = new WeakMap();
export function modelOf(it) {
  if (modelCache.has(it)) return modelCache.get(it);
  const lv = Array.from({ length: 20 }, (_, i) => ({ level: i + 1, items: [], ups: [], chips: [], asi: false, fork: null }));
  const subIds = new Set(it.subs.map((s) => s.intro?.id).filter(Boolean));
  for (const f of it.feats) {
    if (ASI(f)) { for (const l of f.levels) lv[l - 1].asi = true; continue; }
    if (f.options.some((o) => subIds.has(o.id))) { lv[f.levels[0] - 1].fork = f; continue; }
    lv[f.levels[0] - 1].items.push(f);
    for (const l of f.levels.slice(1)) lv[l - 1].ups.push({ f, note: UPG[f.key]?.[l] || 'усиливается' });
  }
  const subLv = Array.from({ length: 20 }, () => ({ items: [], ups: [] }));
  for (const s of it.subs) for (const f of s.feats) {
    subLv[f.levels[0] - 1].items.push({ ...f, subName: s.name });
    for (const l of f.levels.slice(1)) subLv[l - 1].ups.push({ f, note: UPG[f.key]?.[l] || 'усиливается' });
  }
  // Что растёт в цифрах: колонки класса, бонус мастерства, новый круг заклинаний.
  it.rows.forEach((row, i) => {
    const prev = it.rows[i - 1];
    if (prev && row.prof !== prev.prof) lv[i].chips.push(`Мастерство +${row.prof}`);
    for (const c of it.columns) {
      if (!COLUMNS[c]?.road) continue;
      const v = row.values[c], p = prev?.values[c];
      if (v != null && v !== p && !(c === 'pactSlotLevel' && !prev)) lv[i].chips.push(`${COLUMNS[c].label}: ${fmtCol(c, v)}`);
    }
    const mc = maxCircle(row.slots), pc = maxCircle(prev?.slots);
    if (mc > pc) lv[i].chips.push(`Заклинания ${mc}-го круга`);
  });
  const extra = it.feats.find((f) => /:extra-attack$/.test(f.key));
  const subLevels = [...new Set(it.subs.flatMap((s) => s.feats.map((f) => f.levels[0])))].sort((a, b) => a - b);
  const m = { lv, subLv, extra, subLevels };
  modelCache.set(it, m);
  return m;
}
const newAt = (it, l, sub) => { const m = modelOf(it); return [...m.lv[l - 1].items, ...(sub ? m.subLv[l - 1].items : [])]; };
const upsAt = (it, l, sub) => { const m = modelOf(it); return [...m.lv[l - 1].ups, ...(sub ? m.subLv[l - 1].ups : [])]; };
const marksAt = (it, l, sub) => {
  const m = modelOf(it), x = m.lv[l - 1];
  return { feat: newAt(it, l, sub).length > 0, asi: x.asi, fork: !!x.fork, top: l === 20 };
};

// ——— Галерея ———
export const PICK = {
  want: (it, v) => meta(it.id).want.includes(v),
  mag: (it, v) => (v === 'none' ? meta(it.id).magic === 'none' : v === 'some' ? meta(it.id).magic === 'half' : ['full', 'pact'].includes(meta(it.id).magic)),
  easy: (it) => meta(it.id).diff === 1,
};
const matches = (it, q, text) => {
  for (const k of ['want', 'mag']) { const v = q.get(k); if (v && !PICK[k](it, v)) return false; }
  if (q.get('easy') && !PICK.easy(it)) return false;
  if (text && !it.hay.includes(norm(text))) return false;
  return true;
};
function meter(n, of, label) { return html`<span class="cls-meter" aria-label="${label}">${Array.from({ length: of }, (_, i) => html`<i class="${i < n ? 'on' : ''}"></i>`)}</span>`; }
const HD = { 6: 1, 8: 2, 10: 3, 12: 4 };
const MAG = { none: 0, half: 2, pact: 3, full: 4 };

function galleryCard(it, on) {
  const m = meta(it.id);
  return html`<a class="cls-card ${on ? '' : 'dim'}" href="#/ref/classes/${it.id}" style="--c:${m.color}" data-cls-card="${it.id}">
    <span class="cls-card-art"><img src="${art(it.id)}" alt="" loading="lazy"><span class="cls-card-play">${m.play}</span></span>
    <span class="cls-card-body">
      <span class="cls-card-name"><b>${it.name}</b><small>${it.en}</small></span>
      <span class="cls-card-tag">${m.tagline}</span>
      <span class="cls-card-meters">
        <span><small>Хиты</small>${meter(HD[it.hd] || 2, 4, `Кость хитов к${it.hd}`)}<em>к${it.hd}</em></span>
        <span><small>Магия</small>${meter(MAG[m.magic], 4, MAGIC[m.magic])}<em>${{ none: 'нет', half: 'половина', pact: 'договор', full: 'полная' }[m.magic]}</em></span>
        <span><small>Сложность</small>${meter(m.diff, 3, DIFF[m.diff])}<em>${DIFF[m.diff].toLowerCase()}</em></span>
      </span>
      <span class="cls-card-foot">${m.main.map((a) => html`<span class="cls-abil">${ab(a).short}</span>`)}<span class="cls-roles">${m.roles.slice(0, 2).map((r) => ROLE[r]).join(' · ')}</span></span>
    </span>
  </a>`;
}
export function galleryGrid(items, q, text = '') {
  const on = items.filter((it) => matches(it, q, text));
  const filtered = q.get('want') || q.get('mag') || q.get('easy') || text;
  return html`${filtered ? html`<p class="cls-result">${on.length ? html`Подходят <b>${on.length}</b> из ${items.length}: ${on.map((it, i) => html`${i ? ', ' : ''}<a href="#/ref/classes/${it.id}">${it.name}</a>`)}` : 'Таких нет — снимите одно из условий.'}</p>` : ''}
    <div class="cls-grid">${items.map((it) => galleryCard(it, on.includes(it)))}</div>`;
}
function compareTable(items, q, text) {
  const prof = (it) => [...it.prof.armor.map((a) => ARMOR[a] || a), ...it.prof.weapon.map((w) => WEAPON[w] || w)].join(', ');
  return html`<div class="cls-compare-wrap"><table class="cls-compare">
    <thead><tr><th>Класс</th><th>Кость хитов</th><th>Главное</th><th>Спасброски</th><th>Магия</th><th>Доспехи и оружие</th><th>Сложность</th></tr></thead>
    <tbody>${items.map((it) => { const m = meta(it.id); return html`<tr class="${matches(it, q, text) ? '' : 'dim'}" style="--c:${m.color}">
      <td><a href="#/ref/classes/${it.id}" class="cls-compare-name"><img src="${art(it.id)}" alt="" loading="lazy"><span><b>${it.name}</b><small>${m.tagline}</small></span></a></td>
      <td class="num">к${it.hd}</td><td>${m.main.map((a) => ab(a).name).join(' и ')}</td><td>${it.saves.map((s) => ab(s).short).join(' · ')}</td>
      <td>${MAGIC[m.magic]}${it.spell ? html`<small>${ab(it.spell).name}</small>` : ''}</td><td class="t-sm">${prof(it) || '—'}</td><td>${meter(m.diff, 3, DIFF[m.diff])}</td></tr>`; })}</tbody></table></div>`;
}
export function galleryPage(items, q, text, top) {
  const want = q.get('want'), mag = q.get('mag'), easy = q.get('easy'), view = q.get('view');
  return html`<main class="page cls-gallery">${top}
    <header class="cls-gal-head">
      <div><h1>Классы</h1><p>Класс — это то, чем герой занят, когда начинается бой. На карточке — как он играется, внутри — вся дорога с 1-го по 20-й уровень.</p></div>
      <div class="h-seg cls-gal-view"><button data-qtoggle="view" data-v="" aria-selected="${view !== 'table'}">${ic('grid-02', 16)}Карточки</button><button data-qtoggle="view" data-v="table" aria-selected="${view === 'table'}">${ic('menu-01', 16)}Сравнить</button></div>
    </header>
    <section class="cls-pick" aria-label="Подбор класса">
      <div class="cls-pick-q"><small>${ic('sword-03', 14)}В бою хочется</small><div class="ref-chips">${WANTS.map(([v, l]) => html`<button class="chip chip-md" data-qtoggle="want" data-v="${v}" aria-pressed="${want === v}">${l}</button>`)}</div></div>
      <div class="cls-pick-q"><small>${ic('magic-wand-01', 14)}Магии</small><div class="ref-chips">${[['none', 'Не нужно'], ['some', 'Немного'], ['lots', 'Побольше']].map(([v, l]) => html`<button class="chip chip-md" data-qtoggle="mag" data-v="${v}" aria-pressed="${mag === v}">${l}</button>`)}</div></div>
      <label class="cls-pick-q cls-pick-easy"><small>${ic('star', 14)}Первая игра</small><span class="row"><input type="checkbox" class="switch" data-qswitch="easy" ${easy ? 'checked' : ''}><span class="t-sm">только простые</span></span></label>
      ${want || mag || easy ? html`<button class="link-btn" data-qclear="want,mag,easy">Сбросить</button>` : ''}
    </section>
    <div data-cls-grid>${view === 'table' ? compareTable(items, q, text) : galleryGrid(items, q, text)}</div>
    <p class="ref-foot">Описания — наш пересказ по SRD 5.1 (CC BY 4.0). В открытых правилах у каждого класса один подкласс; остальные — в Книге игрока.</p>
  </main>`;
}
export function refreshGallery(root, items, q, text) {
  const box = root.querySelector('[data-cls-grid]'); if (!box) return;
  box.innerHTML = String(q.get('view') === 'table' ? compareTable(items, q, text) : galleryGrid(items, q, text));
}

/** Превью в поиске Ctrl K. */
export function classPreview(it) {
  const m = meta(it.id);
  return html`<div class="cls-pv" style="--c:${m.color}"><img src="${art(it.id)}" alt=""><h3>${it.name}</h3><p class="tertiary">${it.en} · к${it.hd} · ${m.main.map((a) => ab(a).short).join(' ')}</p><p class="t-sm">${m.tagline}</p><p class="t-sm muted">${m.play}</p></div>`;
}

// ——— Страница класса ———
const stateOf = (el) => ({ lvl: Math.min(20, Math.max(1, Number(el.dataset.lvl) || 1)), view: el.dataset.view || 'road', sub: el.dataset.sub !== '0' });

function scrub(it, st) {
  return html`<div class="cls-scrub" role="slider" tabindex="0" aria-label="Уровень героя" aria-valuemin="1" aria-valuemax="20" aria-valuenow="${st.lvl}" data-scrub>
    ${Array.from({ length: 20 }, (_, i) => { const l = i + 1, k = marksAt(it, l, st.sub); return html`<span class="cls-tick ${l <= st.lvl ? 'on' : ''} ${l === st.lvl ? 'here' : ''}" data-l="${l}"><i></i>${[1, 5, 10, 15, 20].includes(l) ? html`<small>${l}</small>` : ''}${k.top ? html`<b class="mk top">${ic('star', 10)}</b>` : k.fork ? html`<b class="mk fork">${fork(10)}</b>` : k.asi ? html`<b class="mk asi">${diamond(7)}</b>` : k.feat ? html`<b class="mk feat"></b>` : ''}</span>`; })}
  </div>`;
}
const legend = () => html`<div class="cls-scrub-legend"><span><b class="mk feat"></b>умение</span><span><b class="mk asi">${diamond(7)}</b>характеристики</span><span><b class="mk fork">${fork(10)}</b>выбор пути</span><span><b class="mk top">${ic('star', 10)}</b>вершина</span></div>`;

function panel(it, st, o = {}) {
  const m = meta(it.id), md = modelOf(it), row = it.rows[st.lvl - 1] || {}, l = st.lvl;
  const hpAvg = it.hd + (l - 1) * (it.hd / 2 + 1);
  const attacks = md.extra ? 1 + md.extra.levels.filter((x) => x <= l).length : 1;
  const sc = spellClass(it);
  const slots = row.slots || [];
  const tiles = [
    ['Хиты в среднем', html`${hpAvg}<small> + ${l}×ТЕЛ</small>`, `к${it.hd} за уровень`],
    ['Мастерство', `+${row.prof || 2}`, 'к владениям'],
    md.extra ? ['Атак за действие', String(attacks), attacks > 1 ? 'Дополнительная атака' : 'с 5 уровня — две'] : null,
    ...it.columns.filter((c) => c !== 'pactSlotLevel').map((c) => {
      const v = row.values?.[c];
      if (v == null) return null;
      const d = COLUMNS[c] || {};
      const val = d.dice ? html`<button class="ref-dice cls-roll" data-roll="${String(v).replace('к', 'd')}">${dice(v)}</button>` : fmtCol(c, v);
      const sub = c === 'pactSlots' ? `${row.values.pactSlotLevel}-го круга` : c === 'rageDamage' ? 'к урону Силой' : '';
      return [d.label || c, val, sub];
    }),
  ].filter(Boolean);
  const isNew = newAt(it, l, st.sub), ups = upsAt(it, l, st.sub), x = md.lv[l - 1];
  let next = null;
  for (let k = l + 1; k <= 20 && !next; k++) { const n = newAt(it, k, st.sub); if (n.length || md.lv[k - 1].fork) next = { l: k, names: [md.lv[k - 1].fork?.name, ...n.map((f) => f.name)].filter(Boolean) }; }
  const spellsLink = (lvl, label) => (sc && !o.modal ? html`<a href="#/ref/spells?cls=${encodeURIComponent(sc)}&lvl=${lvl}">${label}</a>` : html`<span>${label}</span>`);
  return html`<div class="cls-now-head"><span class="cls-now-lv">${l}</span><span><small>уровень</small><b>${it.name} ${l} уровня</b></span></div>
    <div class="cls-tiles">${tiles.map(([k, v, s]) => html`<div class="cls-tile"><small>${k}</small><b>${v}</b>${s ? html`<span>${s}</span>` : ''}</div>`)}</div>
    ${slots.some((n) => n > 0) || row.values?.pactSlots ? html`<div class="cls-slots"><small>Ячейки заклинаний</small>
      ${row.values?.pactSlots ? html`<div class="cls-slot-row">${spellsLink(row.values.pactSlotLevel, html`<em>${ROMAN[row.values.pactSlotLevel]}</em>`)}<span class="cls-pips">${Array.from({ length: row.values.pactSlots }, () => html`<i></i>`)}</span><span class="t-xs tertiary">договор · после короткого отдыха</span></div>`
        : slots.map((n, i) => (n > 0 ? html`<div class="cls-slot-row">${spellsLink(i + 1, html`<em>${ROMAN[i + 1]}</em>`)}<span class="cls-pips">${Array.from({ length: n }, () => html`<i></i>`)}</span></div>` : ''))}
      ${row.values?.cantripsKnown ? html`<div class="cls-slot-row">${spellsLink(0, html`<em class="c0">0</em>`)}<span class="t-xs tertiary">заговоров: ${row.values.cantripsKnown} — без ячеек</span></div>` : ''}
    </div>` : it.casting && it.casting.startLevel > l ? html`<p class="cls-note">${ic('magic-wand-01', 14)}Заклинания — со ${it.casting.startLevel} уровня</p>` : ''}
    <div class="cls-new"><small>${l === 1 ? 'С первого уровня' : `Новое на ${l} уровне`}</small>
      ${isNew.length || ups.length || x.asi || x.fork || x.chips.length ? html`<ul>
        ${x.fork ? html`<li class="fork">${fork(14)}<a href="#cls-lv-${l}" data-goto="${l}">${x.fork.name}</a></li>` : ''}
        ${isNew.map((f) => html`<li class="${f.sub ? 'sub' : ''}"><a href="#cls-lv-${l}" data-goto="${l}">${f.name}</a></li>`)}
        ${ups.map((u) => html`<li class="up">${ic('arrow-up-01', 12)}${u.f.name}<span> — ${u.note}</span></li>`)}
        ${x.asi ? html`<li class="asi">${diamond(9)}Рост характеристик или черта</li>` : ''}
        ${x.chips.map((c) => html`<li class="num">${ic('arrow-up-01', 12)}${c}</li>`)}
      </ul>` : html`<p class="t-sm tertiary">Новых умений нет — опыт копится к следующему.</p>`}
    </div>
    ${next ? html`<p class="cls-next">${ic('arrow-right-02', 14)}<span>Дальше, на ${next.l}: <a href="#cls-lv-${next.l}" data-goto="${next.l}">${next.names.join(', ')}</a></span></p>` : html`<p class="cls-next">${ic('star', 14)}<span>Вершина дороги пройдена.</span></p>`}
    ${sc && !o.modal ? html`<a class="btn btn-secondary btn-sm cls-spells-btn" href="#/ref/spells?cls=${encodeURIComponent(sc)}">${ic('magic-wand-01')}Заклинания класса</a>` : ''}`;
}

const optSum = (o) => { const k = o.id.replace(/^srd51:feature:/, ''); return OPT[k] || OPT[k.split(':').pop()] || ''; };
function featCard(f, it) {
  const s = SUM[f.key];
  const opts = f.options || [];
  const word = /fighting-style/.test(f.key) ? ['стиль', 'стиля', 'стилей'] : /metamagic/.test(f.key) ? ['метамагия', 'метамагии', 'метамагий'] : /eldritch-invocations/.test(f.key) ? ['воззвание', 'воззвания', 'воззваний'] : ['вариант', 'варианта', 'вариантов'];
  const srd = reflow(f.text);
  return html`<article class="cls-feat ${f.sub ? 'is-sub' : ''}">
    <header><b>${f.name}</b>${f.subName ? html`<span class="cls-feat-sub">${fork(12)}${f.subName}</span>` : ''}${f.levels.length > 1 ? html`<span class="cls-feat-lv">растёт на ${f.levels.slice(1).join(', ')}</span>` : ''}</header>
    ${s ? html`<p>${rich(s)}</p>` : ''}
    ${opts.length ? html`<details class="cls-opts"><summary>На выбор — ${opts.length} ${plural(opts.length, ...word)}</summary><ul>${opts.map((o) => html`<li><details><summary><b>${o.name}</b>${o.pre ? html`<span class="cls-pre">${prereqRu(o.pre)}</span>` : ''}</summary>${optSum(o) ? html`<p class="cls-opt-ru">${rich(optSum(o))}</p>` : ''}<div class="cls-opt-en" lang="en">${reflow(o.text).map((p) => (p.h ? html`<h5>${p.h}</h5>` : html`<p>${p.p}</p>`))}</div></details></li>`)}</ul></details>` : ''}
    ${srd.length ? html`<details class="cls-srd"><summary>${ic('book-open-01', 14)}Текст SRD · ${f.en}</summary><div lang="en">${srd.map((p) => (p.h ? html`<h5>${p.h}</h5>` : html`<p>${p.p}</p>`))}</div></details>` : ''}
  </article>`;
}

function road(it, st) {
  const md = modelOf(it);
  const sub = it.subs[0];
  return html`<ol class="cls-road">${md.lv.map((x, i) => {
    const l = i + 1, items = newAt(it, l, st.sub), ups = upsAt(it, l, st.sub);
    const quiet = !items.length && !ups.length && !x.asi && !x.fork;
    return html`<li class="cls-step ${l <= st.lvl ? 'walked' : ''} ${l === st.lvl ? 'here' : ''} ${quiet ? 'quiet' : ''} ${l === 20 ? 'top' : ''}" id="cls-lv-${l}" data-lv="${l}">
      <button class="cls-node" data-set-lv="${l}" aria-label="Уровень ${l}">${l}</button>
      <div class="cls-step-body">
        ${x.chips.length ? html`<div class="cls-chips">${x.chips.map((c) => html`<span>${c}</span>`)}</div>` : ''}
        ${x.fork ? html`<div class="cls-fork">
          <span class="cls-fork-ic">${fork(22)}</span>
          <div><small>Распутье · выбор пути</small><b>${x.fork.name}</b><p>${SUM[x.fork.key] || ''} Путь даёт умения на ${md.subLevels.join(', ')} уровнях.</p>
            <div class="cls-branches">
              ${sub ? html`<button class="cls-branch" data-cls-sub aria-pressed="${st.sub}"><b>${sub.name}</b><small>${SUB_INTRO[sub.id] || ''}</small><span>${st.sub ? html`${ic('view', 14)}умения пути на дороге` : html`${ic('view-off', 14)}показать умения пути`}</span></button>` : ''}
              <div class="cls-branch ghost"><b>Ещё ${meta(it.id).phb - 1} ${plural(meta(it.id).phb - 1, 'путь', 'пути', 'путей')}</b><small>в Книге игрока — не входят в открытые правила SRD</small></div>
            </div></div></div>` : ''}
        ${items.map((f) => featCard(f, it))}
        ${ups.map((u) => html`<div class="cls-up">${ic('arrow-up-01', 14)}<b>${u.f.name}</b><span>${u.note}</span></div>`)}
        ${x.asi ? html`<div class="cls-asi">${diamond(10)}<b>Рост характеристик</b><span>${SUM.asi}</span></div>` : ''}
        ${quiet && !x.chips.length ? html`<p class="cls-quiet">Ровный участок — опыт копится</p>` : ''}
      </div></li>`;
  })}</ol>`;
}

function table(it, st) {
  const md = modelOf(it);
  const cols = it.columns;
  const circles = Math.max(0, ...it.rows.map((r) => maxCircle(r.slots)));
  return html`<div class="cls-table-wrap"><table class="cls-table">
    <thead><tr><th>Ур.</th><th>БМ</th><th class="wide">Умения</th>${cols.map((c) => html`<th>${COLUMNS[c]?.label || c}</th>`)}${Array.from({ length: circles }, (_, i) => html`<th class="slot">${ROMAN[i + 1]}</th>`)}</tr></thead>
    <tbody>${it.rows.map((r, i) => {
      const l = i + 1, x = md.lv[i];
      const names = [x.fork?.name, ...newAt(it, l, st.sub).map((f) => f.name), x.asi ? 'Рост характеристик' : null].filter(Boolean);
      return html`<tr class="${l === st.lvl ? 'here' : ''} ${l <= st.lvl ? 'walked' : ''}" data-set-lv="${l}" data-lv="${l}"><td class="num"><b>${l}</b></td><td class="num">+${r.prof}</td><td class="wide">${names.join(', ') || html`<span class="tertiary">—</span>`}</td>
        ${cols.map((c) => html`<td class="num">${fmtCol(c, r.values[c])}</td>`)}
        ${Array.from({ length: circles }, (_, k) => { const n = r.slots?.[k] || 0; return html`<td class="slot ${n ? 'has' : ''}" style="--n:${n}">${n || '·'}</td>`; })}</tr>`;
    })}</tbody></table></div>
    <p class="ref-note">Нажмите на строку — ползунок встанет на этот уровень.</p>`;
}

function start(it) {
  const m = meta(it.id);
  const skillCh = it.choices.find((c) => c.kind === 'skill');
  const toolCh = it.choices.find((c) => c.kind === 'tool');
  const sk = (id) => SKILL_RU[id] || SKILL_RU[{ animal: 'animal_handling', sleight: 'sleight_of_hand' }[id]] || id;
  const gear = (x) => {
    const q = x.quantity > 1 ? `${x.quantity} × ` : '';
    if (x.ref) { const id = x.ref.split(':').pop(); const g = GEAR_NAMES.get(x.ref); const name = GEAR[id] || g?.name || id; return g && ['weapon', 'armor', 'shield'].includes(g.kind) ? html`${q}<a href="#/ref/equipment/${id}">${name}</a>` : `${q}${name}`; }
    const f = x.filter || {};
    if (f.kind === 'focus') return `${q}${FOCUS[f.group] || 'фокусировка'}`;
    if (f.kind === 'tool') return `${q}${f.exclude ? 'другой ' : ''}${FOCUS[f.group] || 'инструмент'}`;
    if (f.kind === 'weapon') return `${x.quantity > 1 ? `${x.quantity} × ` : ''}любое ${f.category === 'martial' ? 'воинское' : 'простое'}${f.range === 'melee' ? ' рукопашное' : ''} оружие`;
    return q + (f.kind || '?');
  };
  const eq = it.equipment || {};
  const mc = it.multiclass || {};
  const pre = (p) => (!p ? '' : p.abilityMinimum ? `${ab(p.abilityMinimum.ability).name} ${p.abilityMinimum.min}+` : p.any ? p.any.map(pre).join(' или ') : p.all ? p.all.map(pre).join(' и ') : '');
  const mcGrants = (mc.grants || []).map((g) => (g.category === 'armor' ? ARMOR[g.value] : g.category === 'weapon' ? WEAPON[g.value] : g.category === 'tool' ? TOOL[g.value] : g.value)).filter(Boolean);
  const mcCh = (mc.choices || []).map((c) => `${c.count} ${plural(c.count, 'навык', 'навыка', 'навыков')} из списка класса`);
  const row = (label, val) => html`<div class="cls-kv"><small>${label}</small><span>${val || html`<span class="tertiary">нет</span>`}</span></div>`;
  return html`<div class="cls-start">
    <section class="cls-box"><h3>${ic('shield-01', 18)}Владения с 1 уровня</h3>
      ${row('Доспехи', it.prof.armor.map((a) => ARMOR[a] || a).join(', ') + (it.armorNote === 'nonmetal' ? ' — только не металлические' : ''))}
      ${row('Оружие', it.prof.weapon.map((w) => WEAPON[w] || w).join(', '))}
      ${row('Инструменты', [...it.prof.tool.map((t) => TOOL[t] || t), toolCh ? (toolCh.options.length > 12 ? 'один инструмент ремесленника или музыкальный' : `${toolCh.count} на выбор: ${toolCh.options.map((t) => TOOL[t] || t).join(', ')}`) : ''].filter(Boolean).join('; '))}
      ${row('Спасброски', it.saves.map((s) => ab(s).name).join(' и '))}
      ${skillCh ? html`<div class="cls-kv"><small>Навыки — ${skillCh.count} на выбор</small><span class="ref-chips">${skillCh.options.map((s) => html`<span class="chip">${sk(s)}</span>`)}</span></div>` : ''}
      ${row('Хиты', `на 1 уровне ${it.hd} + Телосложение; дальше к${it.hd} (или ${it.hd / 2 + 1}) + Телосложение за уровень`)}
    </section>
    <section class="cls-box"><h3>${ic('backpack-01', 18)}Снаряжение на старт</h3>
      <ol class="cls-gear">${(eq.choices || []).map((c) => html`<li>${c.alternatives.map((a, i) => html`${i ? html`<span class="cls-or">или</span>` : ''}<span class="cls-alt">${a.items.map((x, k) => html`${k ? ', ' : ''}${gear(x)}`)}</span>`)}</li>`)}
        ${(eq.grants || []).map((g) => html`<li><span class="cls-alt">${gear(g)}</span></li>`)}</ol>
      <p class="ref-note">Вместо набора можно взять золото и купить снаряжение самим — по решению мастера.</p>
    </section>
    <section class="cls-box"><h3>${ic('shuffle', 18)}Мультикласс</h3>
      ${row('Чтобы взять этот класс вторым', pre(mc.prerequisites))}
      ${row('Что даёт', [...mcGrants, ...mcCh].join(', '))}
      <p class="ref-note">Условие работает в обе стороны: чтобы из этого класса взять другой, нужны и эти значения.</p>
    </section>
    <section class="cls-box cls-roles-box"><h3>${ic('user-group', 18)}В отряде</h3>
      <div class="ref-chips">${m.roles.map((r) => html`<span class="chip chip-md">${ROLE[r]}</span>`)}</div>
      ${row('Главные характеристики', m.main.map((a) => ab(a).name).join(' и '))}
      ${row('Магия', it.casting ? `${MAGIC[m.magic]}, ${ab(it.casting.ability).name}${it.casting.startLevel > 1 ? `, со ${it.casting.startLevel} уровня` : ''}${it.casting.ritual ? ', ритуалы' : ''}` : 'нет')}
      ${row('Для новичка', DIFF[m.diff])}
    </section>
  </div>`;
}

function content(it, st, o) {
  if (st.view === 'table') return table(it, st);
  if (st.view === 'start') return start(it);
  return road(it, st);
}

function hero(it, o) {
  const m = meta(it.id);
  return html`<header class="cls-hero">
    <span class="cls-hero-bg" style="background-image:url('${art(it.id)}')"></span>
    <div class="cls-hero-text">
      <small class="cls-over">Класс · SRD 5.1</small>
      <h1>${it.name} <span>${it.en}</span></h1>
      <p class="cls-tagline">${m.tagline}</p>
      <p class="cls-play">${m.play}</p>
      <div class="ref-chips">${m.roles.map((r) => html`<span class="chip">${ROLE[r]}</span>`)}<span class="chip chip-line">${DIFF[m.diff]}</span></div>
      ${o.modal ? '' : html`<div class="cls-hero-actions">
        <button class="btn btn-primary btn-sm" data-cls-build="${it.id}">${ic('user-add-01')}Собрать героя этим классом</button>
        <button class="icon-btn icon-btn-sm" data-fav="${o.key}" aria-pressed="${!!o.fav}" aria-label="Избранное" data-tip="${o.fav ? 'Убрать из избранного' : 'В избранное'}">${ic(o.fav ? 'star' : 'favourite', 18)}</button>
        <button class="icon-btn icon-btn-sm" data-share="${o.key}" aria-label="Скопировать ссылку" data-tip="Скопировать ссылку">${ic('link-01', 18)}</button>
      </div>`}
    </div>
    <div class="cls-hero-art"><img src="${art(it.id)}" alt=""></div>
    <dl class="cls-passport">
      <div><dt>Кость хитов</dt><dd><span class="cls-die">к${it.hd}</span></dd></div>
      <div><dt>Главное</dt><dd>${m.main.map((a) => ab(a).name).join(' и ')}</dd></div>
      <div><dt>Спасброски</dt><dd>${it.saves.map((s) => ab(s).name).join(' и ')}</dd></div>
      <div><dt>Магия</dt><dd>${MAGIC[m.magic]}${it.casting ? html`<small>${ab(it.casting.ability).name}${it.casting.startLevel > 1 ? ` · с ${it.casting.startLevel} ур.` : ''}</small>` : ''}</dd></div>
    </dl>
  </header>`;
}

const VIEWS = [['road', 'Дорога 1 → 20', 'path'], ['table', 'Таблица', 'grid'], ['start', 'Старт и владения', 'backpack-01']];
/** Страница класса. o.modal — в модалке на столе: без переключателя классов, кнопок и ссылок наружу. */
export function classPage(it, st0 = {}, o = {}) {
  const st = { lvl: 1, view: 'road', sub: true, ...st0 };
  const m = meta(it.id);
  const all = sectionNow('classes') || [];
  return html`<div class="cls-page ${o.modal ? 'is-modal' : ''}" style="--c:${m.color}" data-cls="${it.id}" data-lvl="${st.lvl}" data-view="${st.view}" data-sub="${st.sub ? 1 : 0}">
    ${o.modal ? '' : html`<nav class="cls-switch" aria-label="Другие классы">${all.map((c) => html`<a href="#/ref/classes/${c.id}" class="${c.id === it.id ? 'on' : ''}" style="--c:${meta(c.id).color}" data-tip="${c.name}" aria-label="${c.name}" ${c.id === it.id ? raw('aria-current="page"') : ''}><img src="${art(c.id)}" alt="" loading="lazy"><span>${c.name}</span></a>`)}</nav>`}
    <div class="cls-main">
      <div class="cls-left">
        ${hero(it, o)}
        <div class="cls-views h-seg" role="tablist">${VIEWS.map(([v, l, i]) => html`<button role="tab" data-cls-view="${v}" aria-selected="${st.view === v}">${ic(i, 16)}${l}</button>`)}</div>
        <section class="cls-content" data-cls-content>${content(it, st, o)}</section>
      </div>
      <aside class="cls-side"><div class="cls-now"><p class="cls-now-hint">Двигайте — покажем героя на любом уровне</p>${scrub(it, st)}${legend()}<div data-cls-panel>${panel(it, st, o)}</div></div></aside>
    </div>
  </div>`;
}

/** Ожививает страницу класса внутри host: ползунок, клики по уровням, вкладки, развилка. onState — синхронизация адреса. */
export function wireClass(host, { onState = () => {}, modal = false } = {}) {
  const itOf = (el) => (sectionNow('classes') || []).find((c) => c.id === el.dataset.cls);
  const apply = (el, patch, { scroll = false } = {}) => {
    const it = itOf(el); if (!it) return;
    const before = stateOf(el);
    const st = { ...before, ...patch };
    el.dataset.lvl = st.lvl; el.dataset.view = st.view; el.dataset.sub = st.sub ? 1 : 0;
    const full = st.view !== before.view || st.sub !== before.sub;
    if (full) {
      el.querySelector('[data-cls-content]').innerHTML = String(content(it, st, { modal }));
      el.querySelectorAll('[data-cls-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.clsView === st.view)));
      const sc = el.querySelector('[data-scrub]'); if (sc) sc.outerHTML = String(scrub(it, st));
    }
    el.querySelectorAll('.cls-tick').forEach((t) => { const l = Number(t.dataset.l); t.classList.toggle('on', l <= st.lvl); t.classList.toggle('here', l === st.lvl); });
    el.querySelector('[data-scrub]')?.setAttribute('aria-valuenow', st.lvl);
    el.querySelectorAll('[data-lv]').forEach((s) => { const l = Number(s.dataset.lv); s.classList.toggle('walked', l <= st.lvl); s.classList.toggle('here', l === st.lvl); });
    el.querySelector('[data-cls-panel]').innerHTML = String(panel(it, st, { modal }));
    if (scroll) el.querySelector(`#cls-lv-${st.lvl}`)?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    onState(st, it);
  };
  const rootOf = (t) => t.closest('[data-cls]');
  let drag = null;
  const levelAt = (sc, x) => { const r = sc.getBoundingClientRect(); return Math.min(20, Math.max(1, Math.ceil(((x - r.left) / r.width) * 20))); };
  const onDown = (e) => {
    const sc = e.target.closest('[data-scrub]'); if (!sc) return;
    drag = sc; sc.setPointerCapture?.(e.pointerId);
    const el = rootOf(sc), l = levelAt(sc, e.clientX);
    if (l !== stateOf(el).lvl) apply(el, { lvl: l });
  };
  const onMove = (e) => { if (!drag) return; const el = rootOf(drag); const l = levelAt(drag, e.clientX); if (l !== stateOf(el).lvl) apply(el, { lvl: l }); };
  const onUp = () => { drag = null; };
  const onKey = (e) => {
    const sc = e.target.closest('[data-scrub]'); if (!sc) return;
    const el = rootOf(sc), l = stateOf(el).lvl;
    const to = { ArrowRight: l + 1, ArrowUp: l + 1, ArrowLeft: l - 1, ArrowDown: l - 1, Home: 1, End: 20, PageUp: l + 4, PageDown: l - 4 }[e.key];
    if (to == null) return;
    e.preventDefault(); apply(el, { lvl: Math.min(20, Math.max(1, to)) });
  };
  const onClick = (e) => {
    const lv = e.target.closest('[data-set-lv]');
    if (lv && !e.target.closest('a, details, summary, button.ref-dice')) { apply(rootOf(lv), { lvl: Number(lv.dataset.setLv) }); return; }
    const go = e.target.closest('[data-goto]');
    if (go) { e.preventDefault(); const el = rootOf(go); apply(el, { lvl: Number(go.dataset.goto), view: 'road' }, { scroll: true }); return; }
    const v = e.target.closest('[data-cls-view]'); if (v) { apply(rootOf(v), { view: v.dataset.clsView }); return; }
    const s = e.target.closest('[data-cls-sub]'); if (s) { const el = rootOf(s); apply(el, { sub: !stateOf(el).sub }); return; }
    const b = e.target.closest('[data-cls-build]');
    if (b) {
      import('../hero/index.js').then(({ draft, saveDraft }) => { draft.class = b.dataset.clsBuild; saveDraft(); location.hash = '#/hero/new/class'; }).catch(() => { location.hash = '#/hero/new'; });
    }
  };
  host.addEventListener('pointerdown', onDown);
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerup', onUp);
  host.addEventListener('pointercancel', onUp);
  host.addEventListener('keydown', onKey);
  host.addEventListener('click', onClick);
  return () => { host.removeEventListener('pointerdown', onDown); host.removeEventListener('pointermove', onMove); host.removeEventListener('pointerup', onUp); host.removeEventListener('pointercancel', onUp); host.removeEventListener('keydown', onKey); host.removeEventListener('click', onClick); };
}
