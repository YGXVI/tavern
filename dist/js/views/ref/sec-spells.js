// Справочник, заклинания (#203): галерея по кругам с подбором и страница заклинания — печать школы, паспорт,
// полный текст SRD на виду и инструмент «сила заклинания»: урон или лечение на выбранной ячейке (или уровне для заговора).
import { html, raw, plural } from '../../core/dom.js';
import { CLASSES } from '../../data/rules.js';
import { norm, SPELL_CLASSES } from './data.js';
import { ic, sec, srdText, toolBox, slider, TOOLS, crumbs, sideFilters, countLine } from './rx.js';
import { powerOf, diceAt, DMG } from './spell-power.js';

export const SCHOOL = {
  evocation: { name: 'Воплощение', color: '#ef7a52', icon: 'fire', about: 'Энергия, которая бьёт и согревает: огонь, холод, молния, свет.' },
  abjuration: { name: 'Ограждение', color: '#6fa8e8', icon: 'shield-01', about: 'Щиты, запреты и изгнание — магия, которая не пускает.' },
  conjuration: { name: 'Вызов', color: '#a597f2', icon: 'sparkles', about: 'Призывает существ и предметы, переносит из места в место.' },
  divination: { name: 'Прорицание', color: '#5fc6d9', icon: 'eye', about: 'Знание: увидеть далёкое, понять скрытое, заглянуть вперёд.' },
  enchantment: { name: 'Очарование', color: '#e88fcf', icon: 'favourite', about: 'Влияет на разум: внушает, усыпляет, подчиняет.' },
  illusion: { name: 'Иллюзия', color: '#c08ef0', icon: 'mask', about: 'Обман чувств: образы, звуки, невидимость.' },
  necromancy: { name: 'Некромантия', color: '#8fc48a', icon: 'skull', about: 'Жизнь и смерть: вытягивает силы, поднимает мёртвых, лечит.' },
  transmutation: { name: 'Преобразование', color: '#e9b052', icon: 'shuffle', about: 'Меняет свойства: форму, скорость, вещество.' },
};
const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
const href = (it) => `#/ref/spells/${encodeURIComponent(it.id)}`;
const sch = (it) => SCHOOL[it.school] || { name: it.schoolName, color: '#e9b052', icon: 'magic-wand-01', about: '' };
// Иконка заклинания (#203): 256 px для страницы и соседей, 64 px для строк галереи; имя файла — номер dnd.su.
export const spellArt = (id, small = false) => new URL(`../../../assets/spells/${small ? 'sm/' : ''}${encodeURIComponent(id)}.webp`, import.meta.url).href;
const lvlName = (l) => (l ? `${l} круг` : 'Заговор');
const classId = (name) => CLASSES.find((c) => c.name === name)?.id;
const shortTime = (t) => String(t).replace(/^1 действие$/, '1 действие').replace(/^1 бонусное действие$/, 'бонусное').replace(/^1 реакция.*/, 'реакция');

// ——— Галерея: фильтры слева, ровный список по кругам ———
const matches = (it, q, text) => {
  const l = q.get('lvl'); if (l && String(it.level) !== l) return false;
  const cls = q.getAll('cls'); if (cls.length && !cls.some((c) => it.classes.includes(c))) return false;
  const schools = q.getAll('sch'); if (schools.length && !schools.includes(it.school)) return false;
  if (q.get('conc') && !it.conc) return false;
  if (q.get('rit') && !it.ritual) return false;
  if (q.get('srd') && !it.srdText) return false;
  if (q.get('dmg') && !it.damage.length) return false;
  if (text && !it.hay.includes(norm(text))) return false;
  return true;
};
const row = (it) => html`<a class="rx-row sp-row" href="${href(it)}" style="--c:${sch(it).color}"><img class="sp-row-art" src="${spellArt(it.id, true)}" alt="" width="32" height="32" loading="lazy" decoding="async">
  <span class="rx-name"><b>${it.name}</b><small>${it.en}</small></span><span class="rx-col">${sch(it).name}</span><span class="rx-col">${shortTime(it.time)}</span><span class="rx-col">${it.range}</span>
  <span class="rx-marks">${it.conc ? html`<abbr title="Концентрация">К</abbr>` : ''}${it.ritual ? html`<abbr title="Ритуал">Р</abbr>` : ''}${it.srdText ? html`<abbr title="Полный текст SRD">T</abbr>` : ''}</span></a>`;
export function grid(items, q, text = '') {
  const on = items.filter((it) => matches(it, q, text));
  return html`${countLine(on.length, items.length, 'заклинаний')}
    ${on.length ? html`<div class="rx-head sp-row"><span></span><span>Название</span><span>Школа</span><span>Время</span><span>Дистанция</span><span></span></div>` : html`<p class="ref-empty">Таких нет — снимите один из фильтров.</p>`}
    ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => { const list = on.filter((it) => it.level === l); return list.length ? html`<section class="rx-group"><h3>${l ? `${l} круг` : 'Заговоры'}<small>${list.length}</small></h3>${list.map(row)}</section>` : ''; })}`;
}
export function gallery(items, q, text, top) {
  const count = (fn) => items.filter(fn).length;
  return html`<main class="page cls-gallery rx-clean">${top}
    <header class="rx-title"><h1>Заклинания</h1><p>Полный текст SRD — у ${count((it) => it.srdText)} из ${items.length}. Внутри — урон на любой ячейке.</p></header>
    <div class="rx-split">
      ${sideFilters([
        { key: 'lvl', label: 'Круг', grid: true, options: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => [String(l), l ? ROMAN[l] : '0']) },
        { key: 'cls', label: 'Класс', multi: true, options: SPELL_CLASSES.map((c) => [c, c, null, count((it) => it.classes.includes(c))]) },
        { key: 'sch', label: 'Школа', multi: true, options: Object.entries(SCHOOL).map(([k, x]) => [k, x.name, x.color, count((it) => it.school === k)]) },
        { key: 'conc', label: 'Свойства', options: [['1', 'Концентрация', null, count((it) => it.conc), 'conc'], ['1', 'Ритуал', null, count((it) => it.ritual), 'rit'], ['1', 'Наносит урон', null, count((it) => it.damage.length), 'dmg'], ['1', 'Есть полный текст', null, count((it) => it.srdText), 'srd']] },
      ], q)}
      <div class="rx-main" data-rx-grid>${grid(items, q, text)}</div>
    </div>
    <p class="ref-foot">Параметры — по открытому индексу dnd.su; полный текст — SRD 5.1 (CC BY 4.0) на английском. К — концентрация, Р — ритуал, Т — есть текст.</p>
  </main>`;
}

// ——— Разбор силы заклинания из текста SRD ———
export { powerOf, diceAt, DMG };

TOOLS.spells = {
  fmt: { v: (v, st) => (st.cantrip ? `${v} уровень героя` : `ячейка ${ROMAN[v]} круга`) },
  controls(it, st) {
    return st.cantrip ? slider('v', 'Уровень героя', 1, 20, st.v, (v) => `${v} уровень`) : slider('v', 'Ячейка', it.level, 9, st.v, (v) => `${ROMAN[v]} круг`);
  },
  out(it, st) {
    const p = powerOf(it); if (!p) return '';
    const x = diceAt(p, it, st.v);
    const f = `${x.n}d${x.d}${x.plus ? `+${x.plus}` : ''}`;
    const all = st.cantrip ? [1, 5, 11, 17].map((l) => [l, diceAt(p, it, l)]) : Array.from({ length: 10 - it.level }, (_, i) => [it.level + i, diceAt(p, it, it.level + i)]);
    const max = Math.max(...all.map(([, y]) => y.avg));
    return html`<div class="sp-power"><button class="sp-big ref-dice" data-roll="${f}">${x.n}к${x.d}${x.plus ? ` + ${x.plus}` : ''}${p.mod ? ' + мод.' : ''}</button>
      <span>${x.k ? `${x.k} × ${p.n}к${p.d}${p.plus ? ` + ${p.plus}` : ''} · ` : ''}${p.heal ? 'лечение' : DMG[p.type] || 'урон'} · в среднем <b>${Math.round(x.avg * 10) / 10}</b>${x.k ? ' если всё попадёт' : ''}</span><small>Нажмите — бросок</small></div>
      <div class="sp-bars">${all.map(([l, y]) => html`<span class="${l === st.v || (st.cantrip && l <= st.v && (all.find(([k]) => k > l)?.[0] || 99) > st.v) ? 'on' : ''}" data-rx-set="v:${l}"><i style="height:${Math.max(8, (y.avg / max) * 100)}%"></i><em>${st.cantrip ? l : ROMAN[l]}</em><small>${y.n}к${y.d}</small></span>`)}</div>
      <p class="t-xs tertiary">${st.cantrip ? (p.flat ? 'Этот заговор с уровнем не растёт.' : 'Заговор растёт с уровнем героя: 5, 11 и 17.') : p.darts ? `Ещё один ${p.darts.word} за каждый круг выше ${p.darts.from}-го.` : p.step ? `+${p.step.n}к${p.d} за ${p.step.every > 1 ? 'каждые два круга' : 'каждый круг'} выше ${p.step.from}-го.` : 'На больших ячейках урон не растёт — смотрите текст «на больших уровнях».'}</p>`;
  },
};

// ——— Страница ———
function seal(it) {
  const s = sch(it);
  return html`<div class="sp-seal" aria-hidden="true"><i class="r1"></i><i class="r2"></i><i class="r3"></i><img class="sp-seal-art" src="${spellArt(it.id)}" alt="" width="256" height="256" decoding="async"><span class="sp-seal-sch" title="${s.name}">${ic(s.icon, 16)}</span><b>${it.level ? ROMAN[it.level] : '∞'}</b></div>`;
}
export function page(it, items, q, o = {}) {
  const s = sch(it);
  const [comp, material] = (() => { const m = it.comp.match(/^([^(]+)\((.+)\)\s*$/); return m ? [m[1].trim(), m[2]] : [it.comp, ''] })();
  const p = powerOf(it);
  const near = items.filter((x) => x !== it && x.school === it.school && x.level === it.level).slice(0, 6);
  const t = it.srdText;
  return html`<div class="cls-page" style="--c:${s.color}">
    ${o.modal ? '' : crumbs('spells', 'Все заклинания', it, items, href)}
    <div class="cls-main">
      <div class="cls-left">
        <header class="cls-hero sp-hero">
          <span class="cls-hero-bg sp-hero-bg"></span>
          <div class="cls-hero-text">
            <small class="cls-over">${lvlName(it.level)} · ${s.name}${it.srdText ? ' · SRD 5.1' : ''}</small>
            <h1>${it.name} <span>${it.en}</span></h1>
            <p class="cls-tagline">${s.about}</p>
            <div class="ref-chips">${it.conc ? html`<span class="chip chip-md">${ic('brain-02', 14)}Концентрация</span>` : ''}${it.ritual ? html`<span class="chip chip-md">${ic('hourglass', 14)}Ритуал</span>` : ''}${it.damage.map((d) => html`<span class="chip chip-md">${ic('flash', 14)}${d}</span>`)}</div>
            ${o.modal ? '' : html`<div class="cls-hero-actions">${o.actions || ''}
              <button class="icon-btn icon-btn-sm" data-fav="${o.key}" aria-pressed="${!!o.fav}" aria-label="Избранное">${ic(o.fav ? 'star' : 'favourite', 18)}</button>
              <button class="icon-btn icon-btn-sm" data-share="${o.key}" aria-label="Скопировать ссылку">${ic('link-01', 18)}</button></div>`}
          </div>
          ${seal(it)}
          <dl class="cls-passport">
            <div><dt>Время</dt><dd>${it.time.replace(/^1 реакция, /, 'Реакция: ')}</dd></div>
            <div><dt>Дистанция</dt><dd>${it.range || '—'}</dd></div>
            <div><dt>Компоненты</dt><dd><span class="sp-comps">${comp.split(/,\s*/).map((c) => html`<i title="${{ 'В': 'вербальный — произнести', 'С': 'соматический — жест', 'М': 'материальный — предмет' }[c] || c}">${c}</i>`)}</span>${material ? html`<small>${material}</small>` : ''}</dd></div>
            <div><dt>Длительность</dt><dd>${it.duration || '—'}${it.conc ? html`<small>держите концентрацию</small>` : ''}</dd></div>
          </dl>
        </header>
        ${sec('text', 'Текст заклинания', t ? 'SRD 5.1 на английском — целиком' : '', t ? html`${srdText(t.text, `SRD · ${t.name}`)}${t.higher ? html`<div class="sp-higher"><b>${ic('layers-01', 16)}На больших уровнях</b><p lang="en">${t.higher}</p></div>` : ''}`
          : html`<div class="cls-box sp-nosrd"><h3>${ic('book-open-01', 18)}Текста в открытых правилах нет</h3><p class="t-sm muted">Заклинание не входит в SRD 5.1 — его описание защищено авторским правом. Все параметры выше — точные; полный текст откройте в источнике.</p>${it.link ? html`<a class="btn btn-secondary btn-sm" href="${it.link}" target="_blank" rel="noopener noreferrer">${ic('arrow-right-02')}Карточка на dnd.su</a>` : ''}</div>`)}
        ${o.modal ? '' : sec('who', 'Кто знает', 'Основные списки классов', html`<div class="sp-classes">${it.classes.length ? it.classes.map((c) => (classId(c) && !o.modal ? html`<a class="sp-class" href="#/ref/classes/${classId(c)}"><img src="${new URL(`../../../assets/hero/class-${classId(c)}.webp`, import.meta.url).href}" alt="" loading="lazy"><b>${c}</b></a>` : html`<span class="sp-class"><b>${c}</b></span>`)) : html`<p class="t-sm tertiary">Нет в основных списках — только у подклассов или в отдельных книгах.</p>`}</div>`)}
      </div>
      ${o.modal ? '' : html`<aside class="cls-side">
        ${p ? toolBox('spells', it, { v: it.level || 1, cantrip: !it.level }, { title: p.heal ? 'Сколько лечит' : 'Сколько бьёт', hint: it.level ? 'Двигайте ячейку — урон пересчитается' : 'Двигайте уровень героя — заговор растёт' })
          : html`<div class="cls-now"><p class="cls-now-hint">Коротко</p><div class="cls-tiles"><div class="cls-tile"><small>Круг</small><b>${it.level || '0'}</b><span>${it.level ? 'тратит ячейку' : 'без ячейки'}</span></div><div class="cls-tile"><small>Школа</small><b class="sp-tile-sch">${s.name}</b></div></div>
            ${it.conc ? html`<p class="t-sm muted">${ic('brain-02', 14)} Концентрация: второе такое заклинание сбрасывает первое, урон — спасбросок Телосложения.</p>` : ''}${it.ritual ? html`<p class="t-sm muted">${ic('hourglass', 14)} Ритуал: +10 минут — и без ячейки.</p>` : ''}</div>`}
        ${near.length ? html`<div class="cls-now rx-near"><p class="cls-now-hint">Та же школа и круг</p>${near.map((x) => html`<a class="rx-near-row sp-near" href="${href(x)}" style="--c:${sch(x).color}"><span class="sp-ic"><img src="${spellArt(x.id)}" alt="" width="40" height="40" loading="lazy" decoding="async"></span><span><b>${x.name}</b><small>${x.en}</small></span></a>`)}</div>` : ''}
      </aside>`}
    </div>
  </div>`;
}
