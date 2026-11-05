// Справочник, существа (#203): галерея портретов по опасности и страница существа со всем статблоком на виду
// и калькулятором «насколько опасно для вашего отряда» (пороги DMG 2014 — encounter-math).
import { html, raw, fmtMod, plural } from '../../core/dom.js';
import { srcOf } from '../../core/assets.js';
import { ABIL, abilityMod, xpFor, norm } from './data.js';
import { difficulty } from '../camp/encounter-math.js';
import { rich } from './cards.js';
import { ic, sec, pickRow, switchRow, galleryHead, resultLine, srdText, toolBox, slider, TOOLS, crumbs } from './rx.js';

const SIZE = { tiny: 'Крошечный', small: 'Маленький', medium: 'Средний', large: 'Большой', huge: 'Огромный', gargantuan: 'Громадный' };
const SIZE_ORDER = Object.keys(SIZE);
const BANDS = [['0-0.5', 'Мелочь · 0–½', 0, 0.5], ['1-4', 'Опасность 1–4', 1, 4], ['5-10', 'Опасность 5–10', 5, 10], ['11-16', 'Опасность 11–16', 11, 16], ['17-30', 'Опасность 17+', 17, 30]];
const TYPE_COLOR = { 'Аберрация': '#b48ce8', 'Зверь': '#9bbf6a', 'Небожитель': '#f0d27a', 'Конструкт': '#a8b3c2', 'Дракон': '#e8714f', 'Элементаль': '#5fb8d9', 'Фея': '#e48fd0', 'Исчадие': '#d9534f', 'Великан': '#c79a6b', 'Гуманоид': '#d6b38c', 'Чудовище': '#c9a04a', 'Слизь': '#7fc97a', 'Растение': '#5aa86a', 'Нежить': '#8fa3a8', 'Рой': '#a39a7a' };
const colorOf = (m) => TYPE_COLOR[String(m.type || '').split(' ·')[0]] || '#e9b052';
const href = (it) => `#/ref/creatures/${encodeURIComponent(it.id)}`;
const crText = (cr) => String(cr ?? '—').replace('1/8', '⅛').replace('1/4', '¼').replace('1/2', '½');
const typeOf = (m) => String(m.type || '').split(' ·')[0];

// ——— Галерея ———
const matches = (it, q, text) => {
  const b = q.get('cr'); if (b) { const [, , lo, hi] = BANDS.find((x) => x[0] === b) || []; if (lo != null && (it.cr < lo || it.cr > hi)) return false; }
  const types = q.getAll('type'); if (types.length && !types.includes(typeOf(it.m))) return false;
  const sizes = q.getAll('size'); if (sizes.length && !sizes.includes(it.m.size)) return false;
  if (q.get('leg') && !(it.m.legendary || []).length) return false;
  if (text && !it.hay.includes(norm(text))) return false;
  return true;
};
function token(it, on) {
  const m = it.m;
  return html`<a class="cr-token ${on ? '' : 'dim'}" href="${href(it)}" style="--c:${colorOf(m)}">
    <span class="cr-ava"><img src="${srcOf(m.img) || m.img}" alt="" loading="lazy" onerror="this.remove()"><em>${crText(m.cr)}</em></span>
    <b>${it.name}</b><small>${SIZE[m.size] || ''} · ${typeOf(m).toLowerCase()}</small>
    <span class="cr-mini"><span>${ic('shield-01', 12)}${m.ac}</span><span>${ic('heart-check', 12)}${m.hp}</span>${(m.legendary || []).length ? html`<span class="leg">${ic('crown', 12)}</span>` : ''}</span></a>`;
}
export function grid(items, q, text = '') {
  const on = new Set(items.filter((it) => matches(it, q, text)));
  if (q.get('view') === 'table') {
    return html`${resultLine([...on], items.length, q, ['cr', 'type', 'size', 'leg'], text, href)}<div class="cls-compare-wrap"><table class="cls-compare cr-table"><thead><tr><th>Существо</th><th>Опасность</th><th>Опыт</th><th>КД</th><th>Хиты</th><th>Скорость</th><th>Размер</th><th>Тип</th></tr></thead>
      <tbody>${items.filter((it) => on.has(it)).map((it) => html`<tr style="--c:${colorOf(it.m)}"><td><a class="cls-compare-name" href="${href(it)}"><img class="round" src="${srcOf(it.m.img) || it.m.img}" alt="" loading="lazy"><span><b>${it.name}</b><small>${it.en}</small></span></a></td>
        <td class="num">${crText(it.m.cr)}</td><td>${xpFor(it.m.cr).toLocaleString('ru')}</td><td class="num">${it.m.ac}</td><td class="num">${it.m.hp}</td><td>${it.m.speed} фт</td><td>${SIZE[it.m.size] || ''}</td><td>${typeOf(it.m)}</td></tr>`)}</tbody></table></div>`;
  }
  return html`${resultLine([...on], items.length, q, ['cr', 'type', 'size', 'leg'], text, href)}
    ${BANDS.map(([id, label, lo, hi]) => {
      const band = items.filter((it) => it.cr >= lo && it.cr <= hi);
      const shown = band.filter((it) => on.has(it));
      if (!shown.length) return '';
      return html`<section class="cr-band"><h3>${label}<small>${shown.length} ${plural(shown.length, 'существо', 'существа', 'существ')}</small></h3><div class="cr-grid">${shown.map((it) => token(it, true))}</div></section>`;
    })}`;
}
export function gallery(items, q, text, top) {
  const types = [...new Set(items.map((it) => typeOf(it.m)))].sort((a, b) => items.filter((x) => typeOf(x.m) === b).length - items.filter((x) => typeOf(x.m) === a).length);
  return html`<main class="page cls-gallery">${top}
    ${galleryHead('Существа', `${items.length} существ со статблоками SRD 5.1 и портретами. На странице существа — весь статблок по-русски и калькулятор: насколько оно опасно для вашего отряда.`, q)}
    <section class="cls-pick" aria-label="Подбор существ">
      ${pickRow('cr', 'Опасность', 'skull', BANDS.map(([v, l]) => [v, l.replace('Опасность ', '')]), q)}
      ${pickRow('size', 'Размер', 'resize-01', SIZE_ORDER.map((s) => [s, SIZE[s]]), q, { multi: true })}
      ${switchRow('leg', 'Босс', 'crown', 'с легендарными действиями', q)}
      ${pickRow('type', 'Тип', 'monster', types.map((t) => [t, t, TYPE_COLOR[t]]), q, { multi: true })}
    </section>
    <div data-rx-grid>${grid(items, q, text)}</div>
    <p class="ref-foot">Статблоки — SRD 5.1 (CC BY 4.0), русские тексты — перевод проекта; несколько существ — стартовый бестиарий «Распутья».</p>
  </main>`;
}

// ——— Страница существа ———
const speedLine = (m) => { const s = String(m.senses || '').match(/скорость:\s*([^,]+(?:,\s*(?:лазая|летая|плавая|копая)[^,]+)*)/); return [`${m.speed} фт`, ...(s ? s[1].split(',').map((x) => x.trim()) : [])].join(', '); };
const sensesLine = (m) => String(m.senses || '').replace(/скорость:\s*[^,]+(?:,\s*(?:лазая|летая|плавая|копая)[^,]+)*,?\s*/, '');
const roll = (f, label) => html`<button class="ref-dice" data-roll="${f}">${label || f.replace(/d/g, 'к')}</button>`;
function block(x) {
  if (typeof x === 'string') { const [n, ...rest] = x.split(':'); return html`<article class="cls-feat"><header><b>${rest.length ? n : ''}</b></header><p>${rich(rest.length ? rest.join(':').trim() : x)}</p></article>`; }
  const hit = x.bonus ? html`<span class="cr-hit">${roll(`1d20${x.bonus >= 0 ? '+' : ''}${x.bonus}`, `${fmtMod(x.bonus)} к попаданию`)}</span>` : '';
  const dmg = x.damage ? html`<span class="cr-dmg">${roll(x.damage.replace(/\s/g, ''), x.damage.replace(/d/g, 'к'))} ${x.type || ''}</span>` : '';
  return html`<article class="cls-feat"><header><b>${x.name}</b>${x.en ? html`<span class="cls-feat-lv">${x.en}</span>` : ''}</header>
    ${hit || dmg || x.note ? html`<div class="cr-attack">${hit}${dmg}${x.note ? html`<span class="t-sm tertiary">${x.note}</span>` : ''}</div>` : ''}
    ${x.ru ? html`<p>${rich(x.ru)}</p>` : ''}${x.desc ? srdText([x.desc], 'SRD') : ''}</article>`;
}
export function page(it, items, q, o = {}) {
  const m = it.m, xp = xpFor(m.cr), c = colorOf(m);
  const lists = [['traits', 'Особенности', 'Работают всегда'], ['actions', 'Действия', 'Атаки: нажмите на бонус — бросок к20, на урон — бросок урона'], ['reactions', 'Реакции', ''], ['legendary', 'Легендарные действия', 'Три легендарных действия за раунд — в конце хода другого существа']];
  const lv = Math.min(20, Math.max(1, Math.round(it.cr) || 1));
  const near = items.filter((x) => x !== it && typeOf(x.m) === typeOf(m) && Math.abs(x.cr - it.cr) <= 2).slice(0, 6);
  const saves = m.saves ? Object.entries(m.saves).map(([k, v]) => `${ABIL.find((a) => a.id === k)?.short || k} ${fmtMod(v)}`).join(', ') : '';
  return html`<div class="cls-page" style="--c:${c}">
    ${o.modal ? '' : crumbs('creatures', 'Все существа', it, items, href)}
    <div class="cls-main">
      <div class="cls-left">
        <header class="cls-hero cr-hero">
          <span class="cls-hero-bg" style="background-image:url('${srcOf(m.img) || m.img}')"></span>
          <div class="cls-hero-text">
            <small class="cls-over">${m.srd ? 'Существо · SRD 5.1' : 'Существо · стартовый бестиарий'}</small>
            <h1>${it.name} ${it.en ? html`<span>${it.en}</span>` : ''}</h1>
            <p class="cls-tagline">${SIZE[m.size] || ''} ${typeOf(m).toLowerCase()}</p>
            <div class="ref-chips"><span class="chip chip-md cr-chip">${ic('skull', 14)}Опасность ${crText(m.cr)}</span><span class="chip chip-md">${xp.toLocaleString('ru')} опыта</span>${(m.legendary || []).length ? html`<span class="chip chip-md">${ic('crown', 14)}Легендарное</span>` : ''}</div>
            ${o.modal ? '' : html`<div class="cls-hero-actions">${o.actions || ''}
              <button class="icon-btn icon-btn-sm" data-fav="${o.key}" aria-pressed="${!!o.fav}" aria-label="Избранное">${ic(o.fav ? 'star' : 'favourite', 18)}</button>
              <button class="icon-btn icon-btn-sm" data-share="${o.key}" aria-label="Скопировать ссылку">${ic('link-01', 18)}</button></div>`}
          </div>
          <div class="cls-hero-art cr-art"><img src="${srcOf(m.img) || m.img}" alt=""></div>
          <dl class="cls-passport">
            <div><dt>Класс доспеха</dt><dd><span class="cls-die">${m.ac}</span></dd></div>
            <div><dt>Хиты</dt><dd>${m.hp} ${m.hpDice ? html`<small>${roll(m.hpDice.replace(/\s/g, ''), m.hpDice.replace(/d/g, 'к'))} — бросить</small>` : ''}</dd></div>
            <div><dt>Скорость</dt><dd>${speedLine(m)}</dd></div>
            <div><dt>Инициатива</dt><dd>${roll(`1d20${m.init >= 0 ? '+' : ''}${m.init || 0}`, fmtMod(m.init || 0))}</dd></div>
          </dl>
        </header>
        ${sec('abil', 'Характеристики', 'Нажмите — бросок проверки', html`<div class="ref-abils cr-abils">${ABIL.map((a) => { const v = m.stats?.[a.id] ?? 10, md = abilityMod(v); return html`<button class="ref-abil" data-roll="1d20${md >= 0 ? '+' : '-'}${Math.abs(md)}"><small>${a.short}</small><b>${fmtMod(md)}</b><span>${v}</span></button>`; })}</div>
          <div class="cls-start cr-facts">
            <div class="cls-box"><div class="cls-kv"><small>Чувства</small><span>${sensesLine(m) || '—'}</span></div>${m.darkvision ? html`<div class="cls-kv"><small>Тёмное зрение</small><span>${m.darkvision} фт</span></div>` : ''}</div>
            <div class="cls-box"><div class="cls-kv"><small>Спасброски</small><span>${saves || 'по характеристикам'}</span></div><div class="cls-kv"><small>Источник</small><span>${m.srd ? 'SRD 5.1 · CC BY 4.0' : 'Стартовый бестиарий «Распутья»'}</span></div></div>
          </div>`)}
        ${lists.map(([k, t, hint]) => ((m[k] || []).length ? sec(k, t, hint, html`<div class="cr-list">${m[k].map(block)}</div>`) : ''))}
      </div>
      <aside class="cls-side">
        ${toolBox('creatures', it, { party: 4, level: lv, count: 1 }, { title: 'Насколько опасно для вашего отряда' })}
        ${near.length ? html`<div class="cls-now rx-near"><p class="cls-now-hint">Рядом по силе</p>${near.map((x) => html`<a class="rx-near-row" href="${href(x)}"><img src="${srcOf(x.m.img) || x.m.img}" alt="" loading="lazy"><span><b>${x.name}</b><small>Опасность ${crText(x.m.cr)}</small></span></a>`)}</div>` : ''}
      </aside>
    </div>
  </div>`;
}

// ——— Калькулятор опасности ———
const DIFF_COLOR = ['#6ad3a1', '#e9b052', '#f08a50', '#e5584f'];
TOOLS.creatures = {
  fmt: { party: (v) => `${v} ${plural(v, 'герой', 'героя', 'героев')}`, level: (v) => `${v} уровень`, count: (v) => `× ${v}` },
  controls: (it, st) => html`${slider('party', 'Отряд', 1, 8, st.party, TOOLS.creatures.fmt.party)}${slider('level', 'Уровень героев', 1, 20, st.level, TOOLS.creatures.fmt.level)}${slider('count', 'Таких существ', 1, 10, st.count, TOOLS.creatures.fmt.count)}`,
  out(it, st) {
    const lv = Array.from({ length: st.party }, () => st.level);
    const d = difficulty(lv, [{ cr: it.m.cr, count: st.count }]);
    const col = d.level < 0 ? '#7a8094' : DIFF_COLOR[d.level];
    const max = Math.max(d.party[3] * 1.25, d.adjusted * 1.05, 1);
    const pct = (v) => `${Math.min(100, (v / max) * 100).toFixed(1)}%`;
    const row = Array.from({ length: 8 }, (_, i) => { const x = difficulty(lv, [{ cr: it.m.cr, count: i + 1 }]); return { n: i + 1, l: x.level, label: x.label }; });
    return html`<div class="cr-verdict" style="--v:${col}"><b>${d.label}</b><span>${st.count > 1 ? `${st.count} × ` : ''}${it.name.toLowerCase()} против ${st.party} ${plural(st.party, 'героя', 'героев', 'героев')} ${st.level} уровня</span></div>
      <div class="cr-scale">${[0, 1, 2, 3].map((k) => html`<i style="left:${pct(d.party[k])};--k:${DIFF_COLOR[k]}" title="${['Лёгкая', 'Средняя', 'Сложная', 'Смертельная'][k]}: ${d.party[k]}"></i>`)}<span class="cr-mark" style="left:${pct(d.adjusted)}"></span></div>
      <div class="cr-scale-legend"><span>опыт с поправкой: <b>${d.adjusted.toLocaleString('ru')}</b></span><span>смертельно от ${d.party[3].toLocaleString('ru')}</span></div>
      <div class="cr-counts"><small>Сколько таких выпустить</small><div>${row.map((r) => html`<span style="--k:${r.l < 0 ? '#5d6378' : DIFF_COLOR[r.l]}" class="${r.n === st.count ? 'on' : ''}" data-rx-set="count:${r.n}" title="${r.label}">${r.n}</span>`)}</div><p class="t-xs tertiary">Цвет — сложность встречи: зелёный лёгкая … красный смертельная. Нажмите число.</p></div>
      <p class="t-xs tertiary">Пороги и множитель за число существ — Руководство мастера 2014. ${d.mult > 1 ? `Множитель ×${d.mult}.` : ''}</p>`;
  },
};
