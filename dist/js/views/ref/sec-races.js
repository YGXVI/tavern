// Справочник, расы и предыстории (#203): галереи с артом, страница расы с чертами по-русски, подрасой-развилкой,
// таблицей драконьего наследия и инструментом «примерить к классу»; предыстории с бросками характера.
import { html, fmtMod, plural } from '../../core/dom.js';
import { ABIL, SKILL_RU, GEAR_NAMES, sectionNow, norm } from './data.js';
import { CLASS_META, reflow } from './class-text.js';
import { RACE_META, RACE_SUM, DRAGON, DRAGON_DMG, DRAGON_COLOR, BG_META, BG_SUM, ACOLYTE, CUSTOM_BG } from './world-text.js';
import { ic, sec, galleryHead, srdText, toolBox, TOOLS, crumbs } from './rx.js';

const raceArt = (id) => new URL(`../../../assets/hero/race-${id}.webp`, import.meta.url).href;
const classArt = (id) => new URL(`../../../assets/hero/class-${id}.webp`, import.meta.url).href;
const rhref = (it) => `#/ref/races/${encodeURIComponent(it.id)}`;
const rmeta = (id) => RACE_META[id] || { color: '#e9b052', tagline: '', play: '', age: '', align: '' };
const ab = (id) => ABIL.find((a) => a.id === id) || { short: id, name: id };
const sumOf = (f) => RACE_SUM[f.key] || RACE_SUM[f.key.split(':').pop()] || '';
const fork = (s = 16) => html`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 22v-8"/><path d="M12 14 6 6"/><path d="m12 14 6-8"/></svg>`;

// ——— Расы ———
const incAll = (it) => { const m = {}; for (const x of [...it.inc, ...(it.subs[0]?.inc || [])]) m[x.ability] = (m[x.ability] || 0) + x.value; return m; };
function abilBars(it) {
  const m = incAll(it);
  const half = it.id === 'half-elf';
  return html`<div class="rc-bars">${ABIL.map((a) => html`<span class="${m[a.id] ? 'on' : ''}"><i style="height:${(m[a.id] || 0) * 40 + 8}%"></i><b>${m[a.id] ? `+${m[a.id]}` : half && a.id !== 'cha' ? '+1?' : '—'}</b><small>${a.short}</small></span>`)}</div>`;
}
function raceCard(it) {
  const m = rmeta(it.id);
  return html`<a class="cls-card" href="${rhref(it)}" style="--c:${m.color}">
    <span class="cls-card-art"><img src="${raceArt(it.id)}" alt="" loading="lazy"></span>
    <span class="cls-card-body"><span class="cls-card-name"><b>${it.name}</b><small>${it.en}</small></span><span class="cls-card-tag">${m.tagline}</span><span class="cls-card-play">${m.play}</span>
      <span class="cls-card-foot">${Object.entries(incAll(it)).map(([k, v]) => html`<span class="cls-abil">${ab(k).short} +${v}</span>`)}${it.id === 'half-elf' ? html`<span class="cls-abil">+1 +1</span>` : ''}<span class="cls-roles">${it.speed} фт${it.darkvision ? html` · ${ic('eye', 12)} ${it.darkvision}` : ''}</span></span></span></a>`;
}
export const races = {
  grid(items, q, text = '') {
    const on = items.filter((it) => !text || it.hay.includes(norm(text)));
    if (q.get('view') === 'table') return html`<div class="cls-compare-wrap"><table class="cls-compare"><thead><tr><th>Раса</th><th>Характеристики</th><th>Размер</th><th>Скорость</th><th>Тёмное зрение</th><th>Языки</th></tr></thead>
      <tbody>${on.map((it) => html`<tr style="--c:${rmeta(it.id).color}"><td><a class="cls-compare-name" href="${rhref(it)}"><img src="${raceArt(it.id)}" alt="" loading="lazy"><span><b>${it.name}</b><small>${rmeta(it.id).tagline}</small></span></a></td><td>${it.incText.join(', ')}${it.id === 'half-elf' ? ', +1 к двум на выбор' : ''}</td><td>${it.size}</td><td class="num">${it.speed}</td><td>${it.darkvision ? `${it.darkvision} фт` : '—'}</td><td class="t-sm">${it.langs.join(', ')}</td></tr>`)}</tbody></table></div>`;
    return html`<div class="cls-grid">${on.map(raceCard)}</div>`;
  },
  gallery(items, q, text, top) {
    return html`<main class="page cls-gallery">${top}${galleryHead('Расы', 'Кем герой родился: рост, сила, зрение, врождённые чудеса. Внутри — все черты по-русски и примерка к классам.', q)}
      <div data-rx-grid>${races.grid(items, q, text)}</div><p class="ref-foot">Расы SRD 5.1 (CC BY 4.0): девять рас и по одной подрасе; черты — наш пересказ, английский текст — под каждой.</p></main>`;
  },
  page(it, items, q, o = {}) {
    const m = rmeta(it.id);
    const trait = (f) => html`<article class="cls-feat"><header><b>${f.name}</b><span class="cls-feat-lv">${f.en}</span></header>${sumOf(f) ? html`<p>${sumOf(f)}</p>` : ''}${srdText(reflow(f.text), `SRD · ${f.en}`)}
      ${f.key.endsWith('draconic-ancestry') && f.options.length ? dragonTable(f.options) : ''}</article>`;
    return html`<div class="cls-page" style="--c:${m.color}">
      ${o.modal ? '' : html`<nav class="cls-switch">${items.map((x) => html`<a href="${rhref(x)}" class="${x === it ? 'on' : ''}" style="--c:${rmeta(x.id).color}" aria-label="${x.name}"><img src="${raceArt(x.id)}" alt="" loading="lazy"><span>${x.name}</span></a>`)}</nav>`}
      <div class="cls-main"><div class="cls-left">
        <header class="cls-hero"><span class="cls-hero-bg" style="background-image:url('${raceArt(it.id)}')"></span>
          <div class="cls-hero-text"><small class="cls-over">Раса · SRD 5.1</small><h1>${it.name} <span>${it.en}</span></h1><p class="cls-tagline">${m.tagline}</p><p class="cls-play">${m.play}</p>
            ${o.modal ? '' : html`<div class="cls-hero-actions"><button class="icon-btn icon-btn-sm" data-fav="${o.key}" aria-pressed="${!!o.fav}" aria-label="Избранное">${ic(o.fav ? 'star' : 'favourite', 18)}</button><button class="icon-btn icon-btn-sm" data-share="${o.key}" aria-label="Скопировать ссылку">${ic('link-01', 18)}</button></div>`}</div>
          <div class="cls-hero-art"><img src="${raceArt(it.id)}" alt=""></div>
          <dl class="cls-passport"><div><dt>Размер</dt><dd>${it.size}</dd></div><div><dt>Скорость</dt><dd>${it.speed} фт</dd></div><div><dt>Тёмное зрение</dt><dd>${it.darkvision ? `${it.darkvision} фт` : 'нет'}</dd></div><div><dt>Языки</dt><dd>${it.langs.join(', ')}</dd></div></dl>
        </header>
        ${sec('abil', 'Характеристики', it.id === 'half-elf' ? 'Харизма +2 и ещё +1 к двум на выбор' : 'Прибавка к значениям при создании героя', abilBars(it))}
        ${sec('traits', 'Черты', 'Суть по-русски и полный текст SRD', html`<div class="cr-list">${it.traits.map(trait)}</div>`)}
        ${it.subs.length ? sec('sub', 'Подраса', 'В открытых правилах — одна; в Книге игрока есть и другие', html`${it.subs.map((s) => html`<div class="cls-fork"><span class="cls-fork-ic">${fork(22)}</span><div><small>Распутье · подраса</small><b>${s.name}</b><p>${s.inc.map((x) => `${ab(x.ability).name} +${x.value}`).join(', ')}</p><div class="cr-list">${s.traits.map(trait)}</div></div></div>`)}`) : ''}
        ${o.modal ? '' : sec('life', 'Жизнь', '', html`<div class="cls-start"><div class="cls-box"><div class="cls-kv"><small>Возраст</small><span>${m.age}</span></div></div><div class="cls-box"><div class="cls-kv"><small>Мировоззрение</small><span>${m.align}</span></div></div></div>`)}
      </div>
      ${o.modal ? '' : html`<aside class="cls-side">${toolBox('race-fit', it, { cls: bestClass(it) }, { title: 'Примерить к классу', hint: 'Стандартный набор 15·14·13·12·10·8 + бонусы расы' })}</aside>`}</div>
    </div>`;
  },
};
function dragonTable(opts) {
  return html`<div class="rc-dragons">${opts.map((o) => { const m = o.text.match(/(Black|Blue|Brass|Bronze|Copper|Gold|Green|Red|Silver|White)\s+(Acid|Lightning|Fire|Poison|Cold)\s+(.+?)\s*\((Dex|Con)\. save\)/); if (!m) return ''; return html`<span style="--k:${DRAGON_COLOR[m[1]]}"><i></i><b>${DRAGON[m[1]]}</b><small>${DRAGON_DMG[m[2]]} · ${m[3].replace(/(\d+) by (\d+) ft\. line/, 'линия $1×$2 фт').replace(/(\d+) ft\. cone/, 'конус $1 фт')} · ${m[4] === 'Dex' ? 'Лов' : 'Тел'}</small></span>`; })}</div>`;
}
const CLASS_IDS = ['barbarian', 'bard', 'cleric', 'druid', 'fighter', 'monk', 'paladin', 'ranger', 'rogue', 'sorcerer', 'warlock', 'wizard'];
const CLASS_RU = { barbarian: 'Варвар', bard: 'Бард', cleric: 'Жрец', druid: 'Друид', fighter: 'Воин', monk: 'Монах', paladin: 'Паладин', ranger: 'Следопыт', rogue: 'Плут', sorcerer: 'Чародей', warlock: 'Колдун', wizard: 'Волшебник' };
function arrayFor(it, cls) {
  const main = CLASS_META[cls]?.main || [];
  const order = [...main, 'con', ...['dex', 'wis', 'str', 'int', 'cha']].filter((x, i, a) => a.indexOf(x) === i);
  const base = {}; [15, 14, 13, 12, 10, 8].forEach((v, i) => { base[order[i]] = v; });
  const inc = incAll(it);
  if (it.id === 'half-elf') order.filter((x) => x !== 'cha').slice(0, 2).forEach((x) => { inc[x] = (inc[x] || 0) + 1; });
  return ABIL.map((a) => ({ a, base: base[a.id], inc: inc[a.id] || 0, total: base[a.id] + (inc[a.id] || 0) }));
}
function fitScore(it, cls) { const inc = incAll(it); return (CLASS_META[cls]?.main || []).reduce((s, x) => s + (inc[x] || 0), 0); }
function bestClass(it) { return CLASS_IDS.slice().sort((a, b) => fitScore(it, b) - fitScore(it, a))[0]; }
TOOLS['race-fit'] = {
  controls: (it, st) => html`<div class="rc-classes">${CLASS_IDS.map((c) => html`<button class="rc-cls ${fitScore(it, c) >= 2 ? 'fit' : ''}" data-rx-set="cls:${c}" aria-pressed="${st.cls === c}" title="${CLASS_RU[c]}"><img src="${classArt(c)}" alt=""><span>${CLASS_RU[c]}</span></button>`)}</div>`,
  out(it, st) {
    const rows = arrayFor(it, st.cls);
    const main = CLASS_META[st.cls]?.main || [];
    return html`<p class="t-sm"><b>${it.name} · ${CLASS_RU[st.cls]}</b> — ${fitScore(it, st.cls) >= 2 ? 'сильная пара: раса усиливает главное' : fitScore(it, st.cls) ? 'неплохо: раса помогает' : 'раса не трогает главное — играть можно, просто без бонуса'}</p>
      <div class="rc-array">${rows.map((r) => html`<span class="${main.includes(r.a.id) ? 'main' : ''}"><small>${r.a.short}</small><b>${r.total}</b><em>${fmtMod(Math.floor((r.total - 10) / 2))}</em>${r.inc ? html`<i>+${r.inc}</i>` : ''}</span>`)}</div>
      <a class="link-btn" href="#/ref/classes/${st.cls}">${ic('arrow-right-02', 14)}Класс «${CLASS_RU[st.cls]}» — вся дорога</a>`;
  },
};

// ——— Предыстории ———
const bhref = (it) => `#/ref/backgrounds/${encodeURIComponent(it.id)}`;
const bmeta = (id) => BG_META[id] || { color: '#e9b052', icon: 'scroll', tagline: '', play: '' };
const TABLES = [['trait', 'Черта характера', 8], ['ideal', 'Идеал', 6], ['bond', 'Привязанность', 6], ['flaw', 'Слабость', 6]];
export const backgrounds = {
  grid(items) {
    return html`<div class="bg-grid">${items.map((it) => { const m = bmeta(it.id); return html`<a class="bg-card" href="${bhref(it)}" style="--c:${m.color}"><span class="rl-cond-ic">${ic(m.icon, 26)}</span><small>${it.kind === 'feat' ? 'Черта' : 'Предыстория'}</small><b>${it.name}</b><span class="cls-card-tag">${m.tagline}</span><p>${m.play}</p>${it.skills.length ? html`<span class="ref-chips">${it.skills.map((s) => html`<span class="chip">${s}</span>`)}</span>` : ''}</a>`; })}
      <article class="bg-card bg-own" style="--c:#6ad3a1"><span class="rl-cond-ic">${ic('pen-tool-01', 26)}</span><small>Своя предыстория</small><b>Соберите сами</b><span class="cls-card-tag">По правилам SRD — за пять шагов</span><ol>${CUSTOM_BG.map((t) => html`<li>${t}</li>`)}</ol></article></div>`;
  },
  gallery(items, q, text, top) {
    return html`<main class="page cls-gallery">${top}${galleryHead('Предыстории и черты', 'Кем герой был до приключений. В открытых правилах — одна предыстория и одна черта, зато правила, как собрать свою, — целиком.', q, { compare: false })}
      <div data-rx-grid>${backgrounds.grid(items)}</div><p class="ref-foot">SRD 5.1 (CC BY 4.0): предыстория «Прислужник» и черта «Борец»; таблицы характера — перевод проекта.</p></main>`;
  },
  page(it, items, q, o = {}) {
    const m = bmeta(it.id);
    const f = it.features[0];
    const langs = it.choices.find((c) => c.kind === 'language');
    const gear = (it.equipment?.grants || []).map((g) => (g.ref ? `${g.quantity > 1 ? `${g.quantity} × ` : ''}${GEAR_NAMES.get(g.ref)?.name || g.ref.split(':').pop()}` : g.filter?.group === 'holy-symbol' ? 'священный символ' : g.kind === 'currency' ? `кошель с ${g.value} зм` : '')).concat((it.equipment?.choices || []).map((c) => c.alternatives.map((a) => a.items.map((x) => GEAR_NAMES.get(x.ref)?.name || '').join(', ')).join(' или ').toLowerCase()));
    return html`<div class="cls-page" style="--c:${m.color}">
      ${o.modal ? '' : crumbs('backgrounds', 'Все предыстории', it, items, bhref)}
      <div class="cls-main"><div class="cls-left">
        <header class="cls-hero rl-hero"><div class="cls-hero-text"><small class="cls-over">${it.kind === 'feat' ? 'Черта' : 'Предыстория'} · SRD 5.1</small><h1>${it.name} <span>${it.en}</span></h1><p class="cls-tagline">${m.tagline}</p><p class="cls-play">${m.play}</p></div>
          <div class="rl-hero-ic">${ic(m.icon, 72)}</div>
          ${it.kind !== 'feat' ? html`<dl class="cls-passport"><div><dt>Навыки</dt><dd>${it.skills.join(', ')}</dd></div><div><dt>Языки</dt><dd>${langs ? `${langs.count} на выбор` : '—'}</dd></div><div><dt>Снаряжение</dt><dd class="t-sm">${gear.filter(Boolean).join(', ') || 'набор предыстории'}</dd></div><div><dt>Умение</dt><dd>${f?.name.ru || f?.name.en || '—'}</dd></div></dl>` : ''}
        </header>
        ${f ? sec('feature', it.kind === 'feat' ? 'Что даёт' : 'Умение предыстории', '', html`<article class="cls-feat"><header><b>${f.name.ru || f.name.en}</b><span class="cls-feat-lv">${f.name.en}</span></header>${BG_SUM[f.id.split(':').pop()] ? html`<p>${BG_SUM[f.id.split(':').pop()]}</p>` : it.kind === 'feat' ? html`<p>${m.play}</p>` : ''}${srdText(reflow(f.text.en || ''), `SRD · ${f.name.en}`)}</article>`) : ''}
        ${!o.modal && it.id === 'acolyte' ? sec('who', 'Характер', 'Бросьте кости или выберите сами', html`<div class="bg-tables">${TABLES.map(([k, t, n]) => html`<div class="bg-table"><h4>${t}<small>к${n}</small></h4><ol>${ACOLYTE[k].map((line, i) => html`<li><em>${i + 1}</em><span>${line}</span></li>`)}</ol></div>`)}</div>`) : ''}
      </div>
      ${o.modal ? '' : html`<aside class="cls-side">${it.id === 'acolyte' ? toolBox('bg-roll', it, { trait: 0, ideal: 0, bond: 0, flaw: 0 }, { title: 'Бросить характер', hint: 'Четыре броска — готовый человек' }) : html`<div class="cls-now"><p class="cls-now-hint">Черты</p><p class="t-sm muted">Черта берётся вместо роста характеристик на 4, 8, 12, 16 и 19 уровне — если мастер разрешает черты.</p></div>`}</aside>`}</div>
    </div>`;
  },
};
TOOLS['bg-roll'] = {
  controls: () => html`<div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" data-rx-set="all:1">${ic('dice-faces-06')}Бросить всё</button>${TABLES.map(([k, t, n]) => html`<button class="btn btn-ghost btn-sm" data-rx-roll="${k}" data-max="${n}">к${n} ${t.toLowerCase()}</button>`)}</div>`,
  reduce(st, key, v) {
    if (key === 'all') return Object.fromEntries(TABLES.map(([k, , n]) => [k, 1 + Math.floor(Math.random() * n)]));
    return { ...st, [key]: v };
  },
  out: (it, st) => (TABLES.some(([k]) => st[k]) ? html`<div class="bg-result">${TABLES.map(([k, t]) => (st[k] ? html`<div><small>${t} · ${st[k]}</small><p>${ACOLYTE[k][st[k] - 1]}</p></div>` : ''))}</div>` : html`<p class="t-sm tertiary">Нажмите «Бросить всё» — получится живой человек со своими принципами и тараканами.</p>`),
};
