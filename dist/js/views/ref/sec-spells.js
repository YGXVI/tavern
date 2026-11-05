// Справочник, заклинания (#203): галерея по кругам с подбором и страница заклинания — печать школы, паспорт,
// полный текст SRD на виду и инструмент «сила заклинания»: урон или лечение на выбранной ячейке (или уровне для заговора).
import { html, raw, plural } from '../../core/dom.js';
import { CLASSES } from '../../data/rules.js';
import { norm, SPELL_CLASSES } from './data.js';
import { ic, sec, pickRow, switchRow, galleryHead, resultLine, srdText, toolBox, slider, TOOLS, crumbs } from './rx.js';

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
const lvlName = (l) => (l ? `${l} круг` : 'Заговор');
const classId = (name) => CLASSES.find((c) => c.name === name)?.id;
const shortTime = (t) => String(t).replace(/^1 действие$/, '1 действие').replace(/^1 бонусное действие$/, 'бонусное').replace(/^1 реакция.*/, 'реакция');

// ——— Галерея ———
const matches = (it, q, text) => {
  const l = q.get('lvl'); if (l && String(it.level) !== l) return false;
  const cls = q.getAll('cls'); if (cls.length && !cls.some((c) => it.classes.includes(c))) return false;
  const schools = q.getAll('sch'); if (schools.length && !schools.includes(it.school)) return false;
  if (q.get('conc') && !it.conc) return false;
  if (q.get('rit') && !it.ritual) return false;
  if (q.get('srd') && !it.srdText) return false;
  const dmg = q.get('dmg'); if (dmg === 'any' && !it.damage.length) return false;
  if (text && !it.hay.includes(norm(text))) return false;
  return true;
};
function row(it) {
  const s = sch(it);
  return html`<a class="sp-card" href="${href(it)}" style="--c:${s.color}">
    <span class="sp-ic">${ic(s.icon, 16)}</span>
    <span class="sp-t"><b>${it.name}</b><small>${it.en}</small></span>
    <span class="sp-tags">${it.conc ? html`<i title="Концентрация">К</i>` : ''}${it.ritual ? html`<i title="Ритуал">Р</i>` : ''}${it.srdText ? html`<i class="srd" title="Полный текст SRD">${ic('book-open-01', 11)}</i>` : ''}</span>
    <span class="sp-time">${shortTime(it.time)}</span></a>`;
}
export function grid(items, q, text = '') {
  const on = items.filter((it) => matches(it, q, text));
  const keys = ['lvl', 'cls', 'sch', 'conc', 'rit', 'srd', 'dmg'];
  if (q.get('view') === 'table') {
    return html`${resultLine(on, items.length, q, keys, text, href)}<div class="cls-compare-wrap"><table class="cls-compare sp-table"><thead><tr><th>Заклинание</th><th>Круг</th><th>Школа</th><th>Время</th><th>Дистанция</th><th>Длительность</th><th>Компоненты</th><th>Классы</th></tr></thead>
      <tbody>${on.slice().sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'ru')).map((it) => html`<tr style="--c:${sch(it).color}"><td><a class="cls-compare-name" href="${href(it)}"><span><b>${it.name}</b><small>${it.en}</small></span></a></td>
        <td class="num">${it.level || '—'}</td><td>${sch(it).name}</td><td class="t-sm">${shortTime(it.time)}</td><td class="t-sm">${it.range}</td><td class="t-sm">${it.conc ? 'К · ' : ''}${it.duration}</td><td class="t-sm">${it.comp.replace(/\s*\(.*$/, '')}</td><td class="t-sm">${it.classes.join(', ')}</td></tr>`)}</tbody></table></div>`;
  }
  return html`${resultLine(on, items.length, q, keys, text, href)}
    ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => {
      const list = on.filter((it) => it.level === l);
      if (!list.length) return '';
      return html`<section class="sp-level"><h3><span class="sp-roman">${ROMAN[l]}</span>${l ? `${l} круг` : 'Заговоры'}<small>${list.length}</small></h3><div class="sp-grid">${list.map(row)}</div></section>`;
    })}`;
}
export function gallery(items, q, text, top) {
  const withText = items.filter((it) => it.srdText).length;
  return html`<main class="page cls-gallery">${top}
    ${galleryHead('Заклинания', `${items.length} заклинаний D&D 5e 2014, у ${withText} — полный текст SRD. На странице заклинания — печать школы, все параметры и урон на любой ячейке.`, q)}
    <section class="cls-pick" aria-label="Подбор заклинаний">
      ${pickRow('lvl', 'Круг', 'layers-01', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => [String(l), l ? ROMAN[l] : 'Заговоры']), q)}
      ${pickRow('cls', 'Класс', 'user-group', SPELL_CLASSES.map((c) => [c, c]), q, { multi: true })}
      ${pickRow('sch', 'Школа', 'magic-wand-01', Object.entries(SCHOOL).map(([k, s]) => [k, s.name, s.color]), q, { multi: true })}
      ${switchRow('conc', 'Концентрация', 'brain-02', 'только с концентрацией', q)}
      ${switchRow('rit', 'Ритуал', 'hourglass', 'можно ритуалом', q)}
      ${switchRow('srd', 'Текст', 'book-open-01', 'с полным текстом SRD', q)}
      ${pickRow('dmg', 'Урон', 'flash', [['any', 'наносит урон']], q)}
    </section>
    <div data-rx-grid>${grid(items, q, text)}</div>
    <p class="ref-foot">Параметры — по открытому индексу dnd.su; полный текст — SRD 5.1 (CC BY 4.0) на английском. Остальные тексты не публикуются: на странице есть ссылка на источник.</p>
  </main>`;
}

// ——— Разбор силы заклинания из текста SRD ———
const ORD = (n) => Number(String(n).replace(/\D/g, ''));
export function powerOf(it) {
  const t = it.srdText; if (!t) return null;
  const body = t.text.join(' ');
  const m = body.match(/(\d+)d(\d+)(?:\s*\+\s*(\d+))?\s+(?:(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)\s+)?damage/i)
    || body.match(/regains? (?:a number of )?hit points equal to (\d+)d(\d+)(?:\s*\+\s*(?:your spellcasting ability modifier|(\d+)))?/i);
  if (!m) return null;
  const heal = /hit points/i.test(m[0]);
  const base = { n: Number(m[1]), d: Number(m[2]), plus: Number(m[3]) || 0, type: heal ? null : (m[4] || '').toLowerCase(), heal, mod: heal && /spellcasting ability modifier/i.test(m[0]) };
  if (!it.level) {
    const c = body.match(/increases by (\d+)d(\d+) when you reach 5th level/i) || body.match(/damage increases by (\d+)d(\d+) when you reach 5th level/i);
    return c ? { ...base, cantrip: true } : { ...base, cantrip: true, flat: true };
  }
  const h = (t.higher || '').match(/increases by (\d+)d(\d+) for (?:each|every) (?:(two) )?slot levels? above (\d+)/i);
  return { ...base, step: h ? { n: Number(h[1]), every: h[3] ? 2 : 1, from: ORD(h[4]) } : null };
}
const DMG = { acid: 'кислота', bludgeoning: 'дробящий', cold: 'холод', fire: 'огонь', force: 'силовое поле', lightning: 'электричество', necrotic: 'некротическая энергия', piercing: 'колющий', poison: 'яд', psychic: 'психическая энергия', radiant: 'излучение', slashing: 'рубящий', thunder: 'звук' };
function diceAt(p, it, v) {
  let n = p.n;
  if (p.cantrip && !p.flat) n = p.n * (1 + (v >= 5) + (v >= 11) + (v >= 17));
  else if (p.step && v > p.step.from) n = p.n + p.step.n * Math.floor((v - p.step.from) / p.step.every);
  return { n, d: p.d, plus: p.plus, avg: n * (p.d + 1) / 2 + p.plus };
}

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
      <span>${p.heal ? 'лечение' : DMG[p.type] || 'урон'} · в среднем <b>${Math.round(x.avg * 10) / 10}</b></span><small>Нажмите — бросок</small></div>
      <div class="sp-bars">${all.map(([l, y]) => html`<span class="${l === st.v || (st.cantrip && l <= st.v && (all.find(([k]) => k > l)?.[0] || 99) > st.v) ? 'on' : ''}" data-rx-set="v:${l}"><i style="height:${Math.max(8, (y.avg / max) * 100)}%"></i><em>${st.cantrip ? l : ROMAN[l]}</em><small>${y.n}к${y.d}</small></span>`)}</div>
      <p class="t-xs tertiary">${st.cantrip ? 'Заговор растёт с уровнем героя: 5, 11 и 17.' : p.step ? `+${p.step.n}к${p.d} за ${p.step.every > 1 ? 'каждые два круга' : 'каждый круг'} выше ${p.step.from}-го.` : 'На больших ячейках урон не растёт — смотрите текст «на больших уровнях».'}</p>`;
  },
};

// ——— Страница ———
function seal(it) {
  const s = sch(it);
  return html`<div class="sp-seal" aria-hidden="true"><i class="r1"></i><i class="r2"></i><i class="r3"></i><span class="sp-seal-ic">${ic(s.icon, 44)}</span><b>${it.level ? ROMAN[it.level] : '∞'}</b></div>`;
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
        ${sec('who', 'Кто знает', 'Основные списки классов', html`<div class="sp-classes">${it.classes.length ? it.classes.map((c) => (classId(c) && !o.modal ? html`<a class="sp-class" href="#/ref/classes/${classId(c)}"><img src="${new URL(`../../../assets/hero/class-${classId(c)}.webp`, import.meta.url).href}" alt="" loading="lazy"><b>${c}</b></a>` : html`<span class="sp-class"><b>${c}</b></span>`)) : html`<p class="t-sm tertiary">Нет в основных списках — только у подклассов или в отдельных книгах.</p>`}</div>`)}
      </div>
      <aside class="cls-side">
        ${p ? toolBox('spells', it, { v: it.level || 1, cantrip: !it.level }, { title: p.heal ? 'Сколько лечит' : 'Сколько бьёт', hint: it.level ? 'Двигайте ячейку — урон пересчитается' : 'Двигайте уровень героя — заговор растёт' })
          : html`<div class="cls-now"><p class="cls-now-hint">Коротко</p><div class="cls-tiles"><div class="cls-tile"><small>Круг</small><b>${it.level || '0'}</b><span>${it.level ? 'тратит ячейку' : 'без ячейки'}</span></div><div class="cls-tile"><small>Школа</small><b class="sp-tile-sch">${s.name}</b></div></div>
            ${it.conc ? html`<p class="t-sm muted">${ic('brain-02', 14)} Концентрация: второе такое заклинание сбрасывает первое, урон — спасбросок Телосложения.</p>` : ''}${it.ritual ? html`<p class="t-sm muted">${ic('hourglass', 14)} Ритуал: +10 минут — и без ячейки.</p>` : ''}</div>`}
        ${near.length ? html`<div class="cls-now rx-near"><p class="cls-now-hint">Та же школа и круг</p>${near.map((x) => html`<a class="rx-near-row sp-near" href="${href(x)}"><span class="sp-ic">${ic(sch(x).icon, 14)}</span><span><b>${x.name}</b><small>${x.en}</small></span></a>`)}</div>` : ''}
      </aside>
    </div>
  </div>`;
}
