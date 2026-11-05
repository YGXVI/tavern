// Карточки справочника (#203): заклинание, существо, класс, раса, предыстория, снаряжение, предмет, правило.
// Тексты из каталогов вставляются через html`` — экранируются; ссылки на правила и кубы добавляются после экранирования.
import { html, raw, esc, fmtMod } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { srcOf } from '../../core/assets.js';
import { RULES } from './rules-text.js';
import { CONDITIONS } from '../../data/rules.js';
import { ABIL, abilityMod, xpFor, DMG_RU, WEAPON_PROPS, EQ_KINDS, SKILL_RU } from './data.js';
import { classPage, classPreview } from './classes.js';

const ic = (n, s = 16) => raw(icon(n, s));
const chip = (t, cls = '') => html`<span class="chip ${cls}">${t}</span>`;

// ——— Термины и кубы в тексте ———
const TERMS = [
  ...CONDITIONS.map((c) => [c.id, c.name.toLowerCase().slice(0, Math.max(5, c.name.length - 2))]),
  ['save', 'спасброс'], ['advantage', 'преимуществ'], ['advantage', 'помех'], ['cover', 'укрыти'], ['concentration-rule', 'концентрац'],
  ['opportunity', 'атак по возможности'], ['opportunity', 'атаку по возможности'], ['disengage', 'отойти'], ['hide', 'спрятаться'], ['dash', 'рывок'], ['dodge', 'уклонени'],
];
const termRe = new RegExp(`(${TERMS.map(([, w]) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})([а-яё]*)`, 'gi');
const diceRe = /(\d+)\s*[кd]\s*(\d+)(?:\s*([+−-])\s*(\d+))?/g;
export function termOf(word) { const w = word.toLowerCase(); return TERMS.find(([, s]) => w.startsWith(s))?.[0] || null; }
export function ruleById(id) { return RULES.find((r) => r.id === id) || (() => { const c = CONDITIONS.find((x) => x.id === id); return c && { id: c.id, name: c.name, text: c.text }; })(); }
/** Экранированный текст с подсвеченными терминами правил и кнопками-кубами. */
export function rich(text) {
  let s = esc(text);
  s = s.replace(diceRe, (m, n, d, sign, k) => `<button class="ref-dice" data-roll="${n}d${d}${sign ? (sign === '+' ? '+' : '-') + k : ''}">${m}</button>`);
  s = s.replace(termRe, (m) => { const id = termOf(m); return id ? `<a class="ref-term" href="#/ref/rules/${id}" data-term="${id}">${m}</a>` : m; });
  return raw(s);
}
const paras = (t) => String(t || '').split(/\n+/).filter(Boolean).map((p) => html`<p>${rich(p)}</p>`);

// ——— Общие куски ———
const stat = (label, value, sub = '') => html`<div class="ref-stat"><small>${label}</small><b>${value || '—'}</b>${sub ? html`<span>${sub}</span>` : ''}</div>`;
function head({ chips = [], title, en, lang, actions = true, fav, key, portrait = null, sub = '' }) {
  const name = lang === 'en' && en ? en : title;
  const other = lang === 'en' ? title : en;
  return html`<div class="ref-card-head">
    ${portrait ? html`<span class="ref-portrait"><img src="${srcOf(portrait)}" alt="" loading="lazy"></span>` : ''}
    <div class="ref-card-titles">
      ${chips.length ? html`<div class="ref-chips">${chips}</div>` : ''}
      <h2>${name}${other ? html` <small>${other}</small>` : ''}</h2>
      ${sub ? html`<p class="ref-card-sub">${sub}</p>` : ''}
    </div>
    ${actions ? html`<div class="ref-card-tools">
      <button class="icon-btn icon-btn-sm" data-fav="${key}" aria-pressed="${!!fav}" data-tip="${fav ? 'Убрать из избранного' : 'В избранное'}" aria-label="Избранное">${ic(fav ? 'star' : 'favourite', 18)}</button>
      <button class="icon-btn icon-btn-sm" data-share="${key}" data-tip="Скопировать ссылку" aria-label="Скопировать ссылку">${ic('link-01', 18)}</button>
      ${en ? html`<div class="h-seg ref-lang"><button data-lang="ru" aria-selected="${lang !== 'en'}">RU</button><button data-lang="en" aria-selected="${lang === 'en'}">EN</button></div>` : ''}
    </div>` : ''}
  </div>`;
}

// ——— Разделы ———
function spell(it, o) {
  const lvl = it.level ? `${it.level} уровень` : 'Заговор';
  const [comp, material] = (() => { const m = it.comp.match(/^([^(]+)\((.+)\)\s*$/); return m ? [m[1].trim(), m[2]] : [it.comp, ''] })();
  return html`${head({ ...o, title: it.name, en: it.en, chips: [chip(lvl, 'chip-accent'), chip(it.schoolName, 'chip-magic'), it.conc ? chip('Концентрация', 'chip-line') : '', it.ritual ? chip('Ритуал', 'chip-line') : ''] })}
    <div class="ref-stats">${stat('Время', it.time)}${stat('Дистанция', it.range)}${stat('Компоненты', comp)}${stat('Длительность', it.duration)}</div>
    ${material ? html`<p class="ref-note">М — ${material}</p>` : ''}
    <div class="ref-text">
      ${it.damage.length ? html`<p>Тип урона: ${it.damage.join(', ')}.</p>` : ''}
      <div class="ref-box"><b>Текст заклинания</b><span>В справочнике пока только параметры — полный текст откройте в источнике. ${it.srd ? 'Заклинание есть в SRD 5.1.' : 'Это заклинание не из SRD — мастер решает, разрешено ли оно.'}</span>
        ${it.link ? html`<a href="${it.link}" target="_blank" rel="noopener noreferrer">Открыть карточку на dnd.su ${ic('arrow-right-02', 14)}</a>` : ''}</div>
    </div>
    <div class="ref-row"><span class="ref-label">Классы:</span>${it.classes.length ? it.classes.map((c) => chip(c)) : html`<span class="muted t-sm">нет в основных списках</span>`}</div>`;
}

function creature(it, o) {
  const m = it.m;
  const lang = o.lang;
  const txt = (x) => (lang === 'en' ? x.desc || x.ru || '' : x.ru || x.desc || '');
  const line = (x) => (typeof x === 'string' ? html`<p>${rich(x)}</p>` : html`<p><b>${lang === 'en' && x.en ? x.en : x.name}.</b> ${rich(txt(x) || [x.bonus != null ? `${fmtMod(x.bonus)} к попаданию` : '', x.note, x.damage ? `${x.damage} ${x.type || ''}` : ''].filter(Boolean).join(', '))}</p>`);
  const xp = xpFor(m.cr);
  return html`${head({ ...o, title: m.name, en: m.en, portrait: m.img, sub: [SIZE[m.size] || '', m.type].filter(Boolean).join(' ').trim(), chips: [chip(`Опасность ${m.cr ?? '—'} · ${xp.toLocaleString('ru')} опыта`, 'chip-accent')] })}
    <div class="ref-stats three">${stat('Класс доспеха', m.ac)}${stat('Хиты', m.hp, m.hpDice ? raw(`<button class="ref-dice" data-roll="${esc(m.hpDice.replace(/\s/g, ''))}">${esc(m.hpDice.replace(/d/g, 'к'))}</button>`) : '')}${stat('Скорость', `${m.speed} фт`)}</div>
    <div class="ref-abils">${ABIL.map((a) => { const v = m.stats?.[a.id] ?? 10; return html`<button class="ref-abil" data-roll="1d20${abilityMod(v) >= 0 ? '+' : '-'}${Math.abs(abilityMod(v))}" data-tip="Проверка ${a.name}"><small>${a.short}</small><b>${fmtMod(abilityMod(v))}</b><span>${v}</span></button>`; })}</div>
    <div class="ref-cols">
      <div class="ref-col">
        ${m.saves ? html`<div class="ref-kv"><small>Спасброски</small><span>${typeof m.saves === 'string' ? m.saves : Object.entries(m.saves).map(([k, v]) => `${ABIL.find((a) => a.id === k)?.short || k} ${fmtMod(v)}`).join(', ')}</span></div>` : ''}
        <div class="ref-kv"><small>Чувства</small><span>${m.senses || '—'}</span></div>
        <div class="ref-kv"><small>Источник</small><span>${m.srd ? 'SRD 5.1 · CC BY 4.0' : 'Стартовый бестиарий «Распутья»'}</span></div>
      </div>
      <div class="ref-col wide ref-text">
        ${(m.traits || []).length ? html`<h4>Особенности</h4>${m.traits.map(line)}` : ''}
        ${(m.actions || []).length ? html`<h4>Действия</h4>${m.actions.map(line)}` : ''}
        ${(m.reactions || []).length ? html`<h4>Реакции</h4>${m.reactions.map(line)}` : ''}
        ${(m.legendary || []).length ? html`<h4>Легендарные действия</h4>${m.legendary.map(line)}` : ''}
      </div>
    </div>`;
}
const SIZE = { tiny: 'Крошечный', small: 'Маленький', medium: 'Средний', large: 'Большой', huge: 'Огромный', gargantuan: 'Громадный' };

// Класс в модалке на столе — та же страница, что в справочнике, без ссылок наружу.
function klass(it) { return classPage(it, {}, { modal: true }); }

function race(it, o) {
  return html`${head({ ...o, title: it.name, en: it.en, chips: [chip(it.size || 'Средний', 'chip-accent')] })}
    <div class="ref-stats">${stat('Скорость', `${it.speed} фт`)}${stat('Тёмное зрение', it.darkvision ? `${it.darkvision} фт` : 'нет')}${stat('Характеристики', it.inc.join(', '))}${stat('Языки', it.langs.join(', '))}</div>
    <div class="ref-text"><h4>Черты</h4>${it.traits.map((f) => html`<details class="ref-feature"><summary>${f.name.ru || f.name.en}</summary>${paras(f.text.ru || f.text.en)}</details>`)}
    ${it.subs.map((s) => html`<h4>${s.name}</h4>${s.traits.map((f) => html`<details class="ref-feature"><summary>${f.name.ru || f.name.en}</summary>${paras(f.text.ru || f.text.en)}</details>`)}`)}</div>`;
}

function background(it, o) {
  return html`${head({ ...o, title: it.name, en: it.en, chips: [chip(it.kind === 'feat' ? 'Черта' : 'Предыстория', 'chip-accent')] })}
    ${it.skills.length ? html`<div class="ref-stats one">${stat('Навыки', it.skills.join(', '))}</div>` : ''}
    <div class="ref-text">${it.features.map((f) => html`<h4>${f.name.ru || f.name.en}</h4>${paras(f.text.ru || f.text.en)}`)}</div>
    <p class="ref-note">В SRD 5.1 открыта одна предыстория и одна черта — остальные из Книги игрока мастер добавит сам.</p>`;
}

function gear(it, o) {
  const cost = it.cost ? `${it.cost.value} ${{ gp: 'зм', sp: 'см', cp: 'мм', ep: 'эм', pp: 'пм' }[it.cost.unit] || it.cost.unit}` : '—';
  const w = it.w, a = it.a;
  return html`${head({ ...o, title: it.name, en: it.en, chips: [chip(it.kindName, 'chip-accent')] })}
    <div class="ref-stats">${stat('Цена', cost)}${stat('Вес', it.weight != null ? `${it.weight} фнт` : '—')}
      ${w ? html`${stat('Урон', raw(`<button class="ref-dice" data-roll="${esc(w.damage?.dice || '1d4')}">${esc((w.damage?.dice || '—').replace('d', 'к'))}</button> ${esc(DMG_RU[w.damage?.type] || '')}`))}${stat('Вид', `${w.category === 'martial' ? 'Воинское' : 'Простое'} ${w.range === 'ranged' ? 'дальнобойное' : 'рукопашное'}`)}` : ''}
      ${a ? html`${stat('Класс доспеха', `${a.baseAc}${a.addDex ? (a.dexMax ? ' + ЛОВ (макс. 2)' : ' + ЛОВ') : ''}`)}${stat('Скрытность', a.stealthDisadvantage ? 'помеха' : 'без помехи')}` : ''}</div>
    ${w?.properties?.length ? html`<div class="ref-row"><span class="ref-label">Свойства:</span>${w.properties.map((p) => chip(WEAPON_PROPS[p] || p))}${w.normalRange ? chip(`дистанция ${w.normalRange}/${w.longRange} фт`) : ''}${w.versatileDice ? chip(`двумя руками ${w.versatileDice.replace('d', 'к')}`) : ''}</div>` : ''}
    ${a?.strength ? html`<p class="ref-note">Нужна Сила ${a.strength}, иначе скорость −10 фт.</p>` : ''}
    ${it.contents.length ? html`<div class="ref-text"><h4>Внутри</h4><p>${it.contents.map((c) => `${c.quantity || c.qty || 1} × ${String(c.ref).split(':').pop().replace(/-/g, ' ')}`).join(', ')}</p></div>` : ''}`;
}

function magicItem(it, o) {
  return html`${head({ ...o, title: it.name, en: it.en, chips: [chip(it.rarity || 'Редкость ?', 'chip-accent'), chip(it.type), it.attune ? chip('Настройка', 'chip-line') : ''] })}
    ${it.attune && it.attuneText ? html`<p class="ref-note">Настройка: ${it.attuneText}</p>` : ''}
    <div class="ref-text">${it.text ? html`${o.lang !== 'en' ? html`<p class="ref-note">Описание есть только на английском (SRD 5.1).</p>` : ''}${it.text.map((p, i) => (i ? html`<p>${p}</p>` : html`<p class="tertiary">${p}</p>`))}`
      : html`<div class="ref-box"><b>Описания нет</b><span>Предмета нет в SRD 5.1 — открыт только его паспорт: тип, редкость, настройка.</span>${it.link ? html`<a href="${it.link}" target="_blank" rel="noopener noreferrer">Открыть на dnd.su ${ic('arrow-right-02', 14)}</a>` : ''}</div>`}</div>`;
}

function rule(it, o) {
  const same = (RULES.filter((r) => r.group === it.group && r.id !== it.id).slice(0, 4));
  return html`${head({ ...o, title: it.name, en: it.en, chips: [chip(it.group, 'chip-accent')] })}
    <div class="ref-text big">${paras(it.text)}</div>
    ${same.length ? html`<div class="ref-row"><span class="ref-label">Рядом:</span>${same.map((r) => html`<a class="chip" href="#/ref/rules/${r.id}">${r.name}</a>`)}</div>` : ''}
    <p class="ref-note">Пересказ правил D&amp;D 5e 2014 своими словами по SRD 5.1.</p>`;
}

const RENDER = { spells: spell, creatures: creature, classes: klass, races: race, backgrounds: background, equipment: gear, items: magicItem, rules: rule };
export function card(it, o) { return (RENDER[it.section] || rule)(it, o); }

/** Короткое превью для поиска Ctrl K. */
export function preview(it) {
  if (it.section === 'spells') return html`<div class="ref-chips">${chip(it.level ? `${it.level} уровень` : 'Заговор', 'chip-accent')}${chip(it.schoolName, 'chip-magic')}</div><h3>${it.name}</h3><p class="tertiary">${it.en}</p><div class="ref-stats two">${stat('Время', it.time)}${stat('Дистанция', it.range)}</div><p class="t-sm muted">${it.comp}${it.duration ? ` · ${it.duration}` : ''}</p>`;
  if (it.section === 'creatures') return html`<div class="ref-chips">${chip(`Опасность ${it.m.cr}`, 'chip-accent')}</div><h3>${it.name}</h3><p class="tertiary">${it.en} · ${it.m.type}</p><div class="ref-stats two">${stat('КД', it.m.ac)}${stat('Хиты', it.m.hp, it.m.hpDice)}</div>`;
  if (it.section === 'rules') return html`<div class="ref-chips">${chip(it.group, 'chip-accent')}</div><h3>${it.name}</h3><p class="t-sm muted">${it.text}</p>`;
  if (it.section === 'classes') return classPreview(it);
  return html`<h3>${it.name}</h3>${it.en ? html`<p class="tertiary">${it.en}</p>` : ''}<p class="t-sm muted">${it.sub}</p>`;
}
export { SKILL_RU, EQ_KINDS };
