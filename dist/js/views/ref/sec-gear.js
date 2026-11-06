// Справочник, снаряжение (#203): арсенал на одной странице — таблицы оружия и доспехов, наборы с содержимым,
// снаряжение и инструменты; страница предмета с калькулятором «удар этим оружием» или «КД в этом доспехе».
import { html, fmtMod, plural } from '../../core/dom.js';
import { norm, DMG_RU, sectionNow } from './data.js';
import { CLASS_META } from './class-text.js';
import { PROP, ARMOR_CAT } from './world-text.js';
import { ic, sec, pickRow, galleryHead, resultLine, toolBox, slider, TOOLS, crumbs } from './rx.js';

const href = (it) => `#/ref/equipment/${encodeURIComponent(it.id)}`;
const KIND = [['weapon', 'Оружие', 'sword-01', '#ef7a52'], ['armor', 'Доспехи и щит', 'shield-01', '#6fa8e8'], ['pack', 'Наборы', 'backpack-01', '#e9b052'], ['gear', 'Снаряжение', 'package', '#9fb2c8'], ['tool', 'Инструменты', 'pen-tool-01', '#a597f2'], ['focus', 'Фокусировки', 'magic-wand-01', '#c08ef0'], ['ammunition', 'Боеприпасы', 'bow-arrow', '#d6b38c']];
const kindOf = (it) => (it.kind === 'shield' ? 'armor' : it.kind);
const colorOf = (it) => KIND.find((k) => k[0] === kindOf(it))?.[3] || '#e9b052';
const iconOf = (it) => (it.kind === 'weapon' ? (it.w?.range === 'ranged' ? 'bow-arrow' : 'sword-01') : KIND.find((k) => k[0] === kindOf(it))?.[2] || 'package');
const UNIT = { gp: 'зм', sp: 'см', cp: 'мм', ep: 'эм', pp: 'пм' };
const cost = (it) => (it.cost ? `${it.cost.value} ${UNIT[it.cost.unit] || it.cost.unit}` : '—');
const weight = (it) => (it.weight ? `${it.weight} фнт` : '—');
const dmg = (w) => (w?.damage?.dice ? w.damage.dice.replace(/d/g, 'к') : '—');
const acText = (a) => (a ? `${a.baseAc}${a.addDex ? (a.dexMax ? ' + Лов (макс +2)' : ' + Лов') : ''}` : '+2');
const props = (w) => html`${(w?.properties || []).map((p) => html`<span class="chip gr-prop" title="${PROP[p]?.[1] || ''}">${PROP[p]?.[0] || p}${p === 'versatile' && w.versatileDice ? ` (${w.versatileDice.replace(/d/g, 'к')})` : ''}${(p === 'thrown' || p === 'ammunition') && w.normalRange ? ` ${w.normalRange}/${w.longRange}` : ''}</span>`)}`;

const matches = (it, q, text) => {
  const k = q.getAll('kind'); if (k.length && !k.includes(kindOf(it))) return false;
  const c = q.get('wcat'); if (c && (it.kind !== 'weapon' || it.w?.category !== c)) return false;
  const pr = q.getAll('prop'); if (pr.length && !pr.every((p) => (it.w?.properties || []).includes(p))) return false;
  if (text && !it.hay.includes(norm(text))) return false;
  return true;
};
function weaponTable(list) {
  const groups = [['simple', 'melee', 'Простое рукопашное'], ['simple', 'ranged', 'Простое дальнобойное'], ['martial', 'melee', 'Воинское рукопашное'], ['martial', 'ranged', 'Воинское дальнобойное']];
  return html`${groups.map(([cat, range, title]) => { const g = list.filter((it) => it.w?.category === cat && it.w?.range === range); return g.length ? html`<h4 class="gr-sub">${title}<small>${g.length}</small></h4><div class="cls-compare-wrap"><table class="cls-compare gr-table"><thead><tr><th>Оружие</th><th>Урон</th><th>Тип</th><th>Свойства</th><th>Цена</th><th>Вес</th></tr></thead>
    <tbody>${g.map((it) => html`<tr><td><a class="gr-name" href="${href(it)}">${ic(iconOf(it), 16)}<b>${it.name}</b></a></td><td class="num">${it.w.damage?.dice ? html`<button class="ref-dice" data-roll="${it.w.damage.dice}">${dmg(it.w)}</button>` : '—'}</td><td>${DMG_RU[it.w.damage?.type] || '—'}</td><td><span class="ref-chips">${props(it.w)}</span></td><td>${cost(it)}</td><td>${weight(it)}</td></tr>`)}</tbody></table></div>` : ''; })}`;
}
function armorCards(list) {
  const order = ['light', 'medium', 'heavy'];
  const sorted = list.slice().sort((a, b) => (a.kind === 'shield') - (b.kind === 'shield') || order.indexOf(a.a?.category) - order.indexOf(b.a?.category) || (a.a?.baseAc || 0) - (b.a?.baseAc || 0));
  return html`<div class="gr-armor">${sorted.map((it) => { const cat = it.kind === 'shield' ? 'shield' : it.a?.category; return html`<a class="gr-ac" href="${href(it)}" style="--c:${{ light: '#6ad3a1', medium: '#6fa8e8', heavy: '#a597f2', shield: '#e9b052' }[cat]}">
    <span class="gr-ac-num">${it.kind === 'shield' ? '+2' : it.a.baseAc}</span><b>${it.name}</b><small>${ARMOR_CAT[cat]?.[0] || ''} · ${acText(it.a)}</small>
    <span class="gr-ac-tags">${it.a?.strength ? html`<i title="Нужна Сила">Сил ${it.a.strength}</i>` : ''}${it.a?.stealthDisadvantage ? html`<i title="Помеха на Скрытность">${ic('view-off', 11)}</i>` : ''}<em>${cost(it)} · ${weight(it)}</em></span></a>`; })}</div>`;
}
function packCards(list, all) {
  const byRef = new Map(all.map((x) => [x.ref, x]));
  return html`<div class="gr-packs">${list.map((it) => html`<article class="gr-pack"><a href="${href(it)}"><b>${it.name}</b></a><small>${cost(it)}</small><ul>${it.contents.map((c) => { const x = byRef.get(c.ref); return html`<li>${c.quantity > 1 ? html`<em>${c.quantity}×</em>` : ''}${x ? html`<a href="${href(x)}">${x.name}</a>` : c.ref.split(':').pop()}</li>`; })}</ul></article>`)}</div>`;
}
function smallGrid(list) {
  return html`<div class="gr-small">${list.map((it) => html`<a class="gr-item" href="${href(it)}" style="--c:${colorOf(it)}"><span class="sp-ic">${ic(iconOf(it), 15)}</span><span><b>${it.name}</b>${it.en ? html`<small>${it.en}</small>` : ''}</span><em>${cost(it)}</em></a>`)}</div>`;
}
export function grid(items, q, text = '') {
  const on = items.filter((it) => matches(it, q, text));
  const keys = ['kind', 'wcat', 'prop'];
  const block = (k) => on.filter((it) => kindOf(it) === k);
  const [w, a, p] = [block('weapon'), block('armor'), block('pack')];
  return html`${resultLine(on, items.length, q, keys, text, href)}
    ${w.length ? sec('weapon', 'Оружие', 'Нажмите урон — бросок; наведите на свойство — подсказка', weaponTable(w)) : ''}
    ${a.length ? sec('armor', 'Доспехи и щит', 'Большая цифра — КД', armorCards(a)) : ''}
    ${p.length ? sec('pack', 'Наборы', 'Что лежит внутри', packCards(p, items)) : ''}
    ${KIND.slice(3).map(([k, t]) => { const l = block(k); return l.length ? sec(k, t, `${l.length}`, smallGrid(l)) : ''; })}`;
}
export function gallery(items, q, text, top) {
  return html`<main class="page cls-gallery">${top}
    ${galleryHead('Снаряжение', 'Арсенал на одной странице: таблицы оружия и доспехов, наборы с содержимым, инструменты и мелочи. В карточке оружия — калькулятор удара, у доспеха — ваш КД.', q, { compare: false })}
    <section class="cls-pick" aria-label="Подбор снаряжения">
      ${pickRow('kind', 'Вид', 'package', KIND.map(([v, l, , c]) => [v, l, c]), q, { multi: true })}
      ${pickRow('wcat', 'Оружие', 'sword-01', [['simple', 'Простое'], ['martial', 'Воинское']], q)}
      ${pickRow('prop', 'Свойства', 'flash', Object.entries(PROP).filter(([k]) => k !== 'special').map(([k, [l]]) => [k, l]), q, { multi: true })}
    </section>
    <div data-rx-grid>${grid(items, q, text)}</div>
    <p class="ref-foot">Снаряжение SRD 5.1 (CC BY 4.0); русские названия и пояснения — проекта.</p>
  </main>`;
}

// ——— Страница предмета ———
export function page(it, items, q, o = {}) {
  const c = colorOf(it);
  const byRef = new Map(items.map((x) => [x.ref, x]));
  const inPacks = items.filter((x) => x.kind === 'pack' && x.contents.some((cc) => cc.ref === it.ref));
  const classes = (sectionNow('classes') || []).filter((k) => JSON.stringify(k.equipment || {}).includes(`"${it.ref}"`));
  const w = it.w, a = it.a;
  const st = w?.damage?.dice ? { ab: w.properties?.includes('finesse') || w.range === 'ranged' ? 16 : 16, prof: 2, two: 0 } : { dex: 14 };
  return html`<div class="cls-page gr-page" style="--c:${c}">
    ${o.modal ? '' : crumbs('equipment', 'Всё снаряжение', it, items, href)}
    <div class="cls-main">
      <div class="cls-left">
        <header class="cls-hero rl-hero">
          <div class="cls-hero-text"><small class="cls-over">${it.kindName}${w ? ` · ${w.category === 'martial' ? 'воинское' : 'простое'}, ${w.range === 'ranged' ? 'дальнобойное' : 'рукопашное'}` : a ? ` · ${ARMOR_CAT[a.category]?.[0].toLowerCase() || ''}` : ''}</small>
            <h1>${it.name} ${it.en ? html`<span>${it.en}</span>` : ''}</h1>
            ${o.modal ? '' : html`<div class="cls-hero-actions"><button class="icon-btn icon-btn-sm" data-fav="${o.key}" aria-pressed="${!!o.fav}" aria-label="Избранное">${ic(o.fav ? 'star' : 'favourite', 18)}</button><button class="icon-btn icon-btn-sm" data-share="${o.key}" aria-label="Скопировать ссылку">${ic('link-01', 18)}</button></div>`}</div>
          <div class="rl-hero-ic">${ic(iconOf(it), 72)}</div>
          <dl class="cls-passport">
            ${w?.damage?.dice ? html`<div><dt>Урон</dt><dd><button class="ref-dice gr-big" data-roll="${w.damage.dice}">${dmg(w)}</button><small>${DMG_RU[w.damage.type] || ''}${w.versatileDice ? ` · двумя руками ${w.versatileDice.replace(/d/g, 'к')}` : ''}</small></dd></div>` : ''}
            ${a || it.kind === 'shield' ? html`<div><dt>Класс доспеха</dt><dd><span class="cls-die">${it.kind === 'shield' ? '+2' : a.baseAc}</span>${a?.addDex ? html`<small>${acText(a)}</small>` : ''}</dd></div>` : ''}
            ${w?.normalRange ? html`<div><dt>Дистанция</dt><dd>${w.normalRange} / ${w.longRange} фт<small>дальше нормальной — с помехой</small></dd></div>` : ''}
            ${a?.strength ? html`<div><dt>Нужна Сила</dt><dd>${a.strength}<small>иначе скорость −10 фт</small></dd></div>` : ''}
            <div><dt>Цена</dt><dd>${cost(it)}</dd></div><div><dt>Вес</dt><dd>${weight(it)}</dd></div>
          </dl>
        </header>
        ${w?.properties?.length ? sec('props', 'Свойства', 'Что они значат за столом', html`<div class="rl-grid">${w.properties.map((p) => html`<article class="rl-card"><div class="rl-card-t"><b>${PROP[p]?.[0] || p}</b><p>${PROP[p]?.[1] || ''}</p></div></article>`)}</div>`) : ''}
        ${a ? sec('armor', 'Как носить', '', html`<div class="rl-grid"><article class="rl-card"><div class="rl-card-t"><b>${ARMOR_CAT[a.category]?.[0]} доспех</b><p>${ARMOR_CAT[a.category]?.[1]}. Надеть и снять — ${a.category === 'light' ? '1 минута' : a.category === 'medium' ? '5 минут и 1 минута' : '10 минут и 5 минут'}.</p></div></article>${a.stealthDisadvantage ? html`<article class="rl-card"><div class="rl-card-t"><b>Шумный</b><p>Помеха на проверки Скрытности.</p></div></article>` : ''}${a.strength ? html`<article class="rl-card"><div class="rl-card-t"><b>Тяжело носить</b><p>При Силе ниже ${a.strength} скорость падает на 10 футов.</p></div></article>` : ''}</div>`) : ''}
        ${it.contents.length ? sec('contents', 'Внутри', '', html`<div class="gr-small">${it.contents.map((cc) => { const x = byRef.get(cc.ref); return x ? html`<a class="gr-item" href="${href(x)}" style="--c:${colorOf(x)}"><span class="sp-ic">${ic(iconOf(x), 15)}</span><span><b>${cc.quantity > 1 ? `${cc.quantity} × ` : ''}${x.name}</b></span><em>${cost(x)}</em></a>` : ''; })}</div>`) : ''}
        ${!o.modal && (inPacks.length || classes.length) ? sec('where', 'Где встречается', 'Наборы и стартовое снаряжение классов', html`<div class="sp-classes">${inPacks.map((x) => html`<a class="sp-class" href="${href(x)}"><b>${ic('backpack-01', 14)} ${x.name}</b></a>`)}${classes.map((k) => html`<a class="sp-class" href="#/ref/classes/${k.id}"><img src="${new URL(`../../../assets/hero/class-${k.id}.webp`, import.meta.url).href}" alt="" loading="lazy"><b>${k.name}</b></a>`)}</div>`) : ''}
      </div>
      ${o.modal ? '' : html`<aside class="cls-side">${w?.damage?.dice ? toolBox('gear-weapon', it, st, { title: 'Удар этим оружием' }) : a ? toolBox('gear-armor', it, st, { title: 'Ваш КД в этом доспехе' }) : html`<div class="cls-now"><p class="cls-now-hint">В кошельке</p><p class="t-sm muted">1 зм = 10 см = 100 мм. Золотая монета весит 1/50 фунта.</p></div>`}</aside>`}
    </div>
  </div>`;
}

TOOLS['gear-weapon'] = {
  fmt: { ab: (v) => `${v} (${fmtMod(Math.floor((v - 10) / 2))})`, prof: (v) => `+${v}` },
  controls(it, st) {
    const w = it.w; const which = w.range === 'ranged' ? 'Ловкость' : w.properties?.includes('finesse') ? 'Сила или Ловкость' : 'Сила';
    return html`${slider('ab', which, 8, 20, st.ab, TOOLS['gear-weapon'].fmt.ab)}${slider('prof', 'Бонус мастерства', 2, 6, st.prof, (v) => `+${v}`)}
      ${w.versatileDice ? html`<div class="ref-chips"><button class="chip chip-md" data-rx-set="two:0" aria-pressed="${!st.two}">Одной рукой</button><button class="chip chip-md" data-rx-set="two:1" aria-pressed="${!!st.two}">Двумя</button></div>` : ''}`;
  },
  out(it, st) {
    const w = it.w, m = Math.floor((st.ab - 10) / 2);
    const dice = (st.two && w.versatileDice ? w.versatileDice : w.damage.dice);
    const [n, d] = dice.split('d').map(Number);
    const avg = n * (d + 1) / 2 + m;
    return html`<div class="gr-strike"><div><small>Попадание</small><button class="sp-big ref-dice" data-roll="1d20${m + st.prof >= 0 ? '+' : ''}${m + st.prof}">${fmtMod(m + st.prof)}</button></div>
      <div><small>Урон</small><button class="sp-big ref-dice" data-roll="${dice}${m >= 0 ? '+' : ''}${m}">${dice.replace('d', 'к')}${m ? ` ${m > 0 ? '+' : '−'} ${Math.abs(m)}` : ''}</button></div></div>
      <p class="t-sm muted">В среднем <b>${Math.max(1, Math.round(avg * 10) / 10)}</b> ${DMG_RU[w.damage.type] || ''} урона за попадание; крит — кости дважды: до <b>${n * 2 * d + m}</b>.</p>
      <div class="rl-prob norm"><span>Против КД 15</span><i><em style="width:${Math.max(5, Math.min(95, (21 - (15 - m - st.prof)) * 5))}%"></em></i><b>${Math.max(5, Math.min(95, (21 - (15 - m - st.prof)) * 5))}%</b></div>`;
  },
};
TOOLS['gear-armor'] = {
  fmt: { dex: (v) => `${v} (${fmtMod(Math.floor((v - 10) / 2))})` },
  controls: (it, st) => slider('dex', 'Ваша Ловкость', 8, 20, st.dex, TOOLS['gear-armor'].fmt.dex),
  out(it, st) {
    const a = it.a, m = Math.floor((st.dex - 10) / 2);
    const ac = it.kind === 'shield' ? null : a.baseAc + (a.addDex ? (a.dexMax ? Math.min(a.dexMax, m) : m) : 0);
    const all = (sectionNow('equipment') || []).filter((x) => x.kind === 'armor').map((x) => ({ x, ac: x.a.baseAc + (x.a.addDex ? (x.a.dexMax ? Math.min(x.a.dexMax, m) : m) : 0) })).sort((p, q2) => q2.ac - p.ac).slice(0, 5);
    return html`${ac != null ? html`<div class="cr-verdict" style="--v:var(--c)"><b>КД ${ac}</b><span>${a.addDex ? (a.dexMax && m > a.dexMax ? `Ловкость выше +${a.dexMax} не идёт в зачёт` : 'вся Ловкость в зачёт') : 'Ловкость не важна'} · со щитом ${ac + 2}</span></div>` : html`<div class="cr-verdict" style="--v:var(--c)"><b>+2 к КД</b><span>поверх доспеха или защиты без доспеха</span></div>`}
      <div class="gr-best"><small>Лучшее при такой Ловкости</small>${all.map((r) => html`<a href="${href(r.x)}" class="${r.x === it ? 'on' : ''}"><b>${r.ac}</b><span>${r.x.name}</span></a>`)}</div>`;
  },
};

export { iconOf as equipmentIcon };
