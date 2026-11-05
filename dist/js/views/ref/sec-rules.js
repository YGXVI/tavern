// Справочник, правила и состояния (#203): вся книга правил на одной странице — ход в бою, состояния карточками,
// правила по разделам, и живые схемы: преимущество в процентах, укрытие, истощение, спасброски от смерти, падение.
// Пересказ своими словами по SRD 5.1 (CC BY 4.0).
import { html, raw } from '../../core/dom.js';
import { CONDITIONS } from '../../data/rules.js';
import { RULES } from './rules-text.js';
import { norm } from './data.js';
import { rich } from './cards.js';
import { ic, sec, galleryHead, toolBox, slider, TOOLS, crumbs } from './rx.js';

const href = (it) => `#/ref/rules/${encodeURIComponent(it.id)}`;
const GROUPS = ['Основы', 'Бой', 'Действия', 'Магия', 'Отдых', 'Мир'];
const GROUP_ICON = { 'Основы': 'dice-faces-06', 'Бой': 'sword-03', 'Действия': 'running-shoes', 'Магия': 'magic-wand-01', 'Отдых': 'campfire', 'Мир': 'mountain', 'Состояния': 'sad-dizzy' };
const COND_COLOR = { blinded: '#9aa3b5', charmed: '#e88fcf', deafened: '#9aa3b5', frightened: '#c08ef0', grappled: '#e9b052', incapacitated: '#e5584f', invisible: '#6fa8e8', paralyzed: '#e5584f', petrified: '#a8b3c2', poisoned: '#7fc97a', prone: '#e9b052', restrained: '#e9b052', stunned: '#e5584f', unconscious: '#e5584f', exhaustion: '#ef7a52', concentration: '#a597f2' };
const TOOL_OF = { advantage: 'rule-adv', cover: 'rule-cover', exhaustion: 'rule-exh', death: 'rule-death', falling: 'rule-fall', proficiency: 'rule-prof' };
const TOOL_TITLE = { advantage: 'Шансы на успех', cover: 'Укрытие и ваш КД', exhaustion: 'Лестница истощения', death: 'Попробуйте выжить', falling: 'Сколько стоит падение', proficiency: 'Мастерство по уровню' };
const START = { 'rule-adv': { need: 11 }, 'rule-cover': { ac: 14, cover: 1 }, 'rule-exh': { lvl: 1 }, 'rule-death': { ok: 0, fail: 0, log: [], done: '' }, 'rule-fall': { ft: 30 }, 'rule-prof': { lvl: 5 } };

const isCond = (it) => it.group === 'Состояния';
const color = (it) => COND_COLOR[it.id] || '#e9b052';
const iconOf = (it) => CONDITIONS.find((c) => c.id === it.id)?.icon || GROUP_ICON[it.group] || 'book-open-01';
const tool = (it) => (TOOL_OF[it.id] ? toolBox(TOOL_OF[it.id], it, START[TOOL_OF[it.id]], { title: TOOL_TITLE[it.id] }) : '');

function condCard(it) {
  return html`<article class="rl-cond" style="--c:${color(it)}"><a href="${href(it)}" class="rl-cond-a"><span class="rl-cond-ic">${ic(iconOf(it), 22)}</span><b>${it.name}</b><small>${it.en}</small></a><p>${rich(it.text)}</p>${tool(it)}</article>`;
}
function ruleCard(it) {
  const t = tool(it);
  return html`<article class="rl-card ${t ? 'has-tool' : ''}" style="--c:#e9b052"><div class="rl-card-t"><a href="${href(it)}"><b>${it.name}</b></a><small>${it.en}</small><p>${rich(it.text)}</p></div>${t}</article>`;
}
function turnBoard(items) {
  const r = (id) => items.find((x) => x.id === id);
  const link = (id, label) => (r(id) ? html`<a class="chip chip-md" href="${href(r(id))}">${label || r(id).name}</a>` : html`<span class="chip chip-md">${label}</span>`);
  const col = (cls, title, iconName, text, chips) => html`<div class="rl-turn-col ${cls}"><span class="rl-turn-ic">${ic(iconName, 20)}</span><b>${title}</b><p>${text}</p><div class="ref-chips">${chips}</div></div>`;
  return html`<div class="rl-turn">
    ${col('move', 'Движение', 'running-shoes', 'До своей скорости, можно делить: шаг — атака — ещё шаг.', [link('dash', 'Рывок — вдвое дальше'), link('falling'), html`<span class="chip chip-md">Встать — половина скорости</span>`])}
    ${col('act', 'Действие', 'sword-03', 'Одно за ход — главное, что вы делаете.', [link('attack'), link('dash'), link('disengage'), link('dodge'), link('help'), link('hide'), link('ready'), link('search'), html`<span class="chip chip-md">Заклинание</span>`, html`<span class="chip chip-md">Предмет</span>`])}
    ${col('bonus', 'Бонусное', 'flash', 'Только если умение или заклинание его даёт.', [html`<span class="chip chip-md">Хитрое действие плута</span>`, html`<span class="chip chip-md">Второе дыхание</span>`, html`<span class="chip chip-md">Заклинания «1 бонусное»</span>`])}
    ${col('react', 'Реакция', 'reload', 'Одна за раунд, даже в чужой ход.', [link('opportunity'), link('ready', 'Подготовленное'), html`<span class="chip chip-md">«Щит», «Контрзаклинание»</span>`])}
    ${col('free', 'Мимоходом', 'hand-grip', 'Сказать пару слов, открыть дверь, достать меч — без траты действия.', [])}
  </div>`;
}
export function grid(items, q, text = '') {
  const t = norm(text);
  const hit = (it) => !t || it.hay.includes(t);
  const conds = items.filter((it) => isCond(it) && hit(it));
  return html`${!t ? sec('turn', 'Ход в бою', 'Что можно за один ход — нажмите, чтобы открыть правило', turnBoard(items)) : ''}
    ${conds.length ? sec('cond', 'Состояния', `${conds.length} — что они делают с героем`, html`<div class="rl-conds">${conds.map(condCard)}</div>`) : ''}
    ${GROUPS.map((g) => { const list = items.filter((it) => it.group === g && hit(it)); return list.length ? sec(`g-${GROUPS.indexOf(g)}`, g, '', html`<div class="rl-grid">${list.map(ruleCard)}</div>`) : ''; })}
    ${t && !items.some(hit) ? html`<p class="ref-empty">Ничего не нашлось — попробуйте короче.</p>` : ''}`;
}
export function gallery(items, q, text, top) {
  return html`<main class="page cls-gallery rl-book">${top}
    ${galleryHead('Правила и состояния', 'Вся книга правил на одной странице: ход в бою, состояния, проверки, магия, отдых. Схемы живые — двигайте ползунки и бросайте кубы.', q, { compare: false })}
    <nav class="rl-nav">${[['turn', 'Ход в бою', 'sword-03'], ['cond', 'Состояния', 'sad-dizzy'], ...GROUPS.map((g, i) => [`g-${i}`, g, GROUP_ICON[g]])].map(([id, l, i]) => html`<button class="chip chip-md" data-rx-goto="rx-${id}">${ic(i, 14)}${l}</button>`)}</nav>
    <div data-rx-grid>${grid(items, q, text)}</div>
    <p class="ref-foot">Пересказ правил D&amp;D 5e 2014 своими словами по SRD 5.1 (CC BY 4.0).</p>
  </main>`;
}
export function page(it, items, q, o = {}) {
  const near = items.filter((x) => x !== it && x.group === it.group).slice(0, 8);
  const c = isCond(it) ? color(it) : '#e9b052';
  return html`<div class="cls-page" style="--c:${c}">
    ${o.modal ? '' : crumbs('rules', 'Все правила', it, items, href)}
    <div class="cls-main">
      <div class="cls-left">
        <header class="cls-hero rl-hero">
          <div class="cls-hero-text"><small class="cls-over">${it.group}</small><h1>${it.name} <span>${it.en}</span></h1>
            <p class="rl-big">${rich(it.text)}</p>
            ${o.modal ? '' : html`<div class="cls-hero-actions"><button class="icon-btn icon-btn-sm" data-fav="${o.key}" aria-pressed="${!!o.fav}" aria-label="Избранное">${ic(o.fav ? 'star' : 'favourite', 18)}</button><button class="icon-btn icon-btn-sm" data-share="${o.key}" aria-label="Скопировать ссылку">${ic('link-01', 18)}</button></div>`}</div>
          <div class="rl-hero-ic">${ic(iconOf(it), 72)}</div>
        </header>
        ${near.length ? sec('near', `Ещё в разделе «${it.group}»`, '', html`<div class="${isCond(it) ? 'rl-conds' : 'rl-grid'}">${near.map((x) => (isCond(x) ? condCard(x) : ruleCard(x)))}</div>`) : ''}
      </div>
      <aside class="cls-side">${tool(it) || html`<div class="cls-now"><p class="cls-now-hint">Где встречается</p><p class="t-sm muted">Термин подсвечивается в текстах справочника — наведите на него в карточке существа или класса, чтобы увидеть правило.</p></div>`}</aside>
    </div>
  </div>`;
}

// ——— Живые схемы ———
const pct = (x) => `${Math.round(x * 100)}%`;
TOOLS['rule-adv'] = {
  fmt: { need: (v) => `${v}+` },
  controls: (it, st) => slider('need', 'Нужно выбросить на к20', 2, 20, st.need, (v) => `${v}+`),
  out(it, st) {
    const p = (21 - st.need) / 20, adv = 1 - (1 - p) ** 2, dis = p ** 2;
    const bar = (label, v, cls) => html`<div class="rl-prob ${cls}"><span>${label}</span><i><em style="width:${pct(v)}"></em></i><b>${pct(v)}</b></div>`;
    return html`${bar('С преимуществом', adv, 'adv')}${bar('Обычный бросок', p, 'norm')}${bar('С помехой', dis, 'dis')}
      <p class="t-xs tertiary">Преимущество стоит примерно +${Math.round((adv - p) * 20 * 10) / 10} к броску на этой сложности. <button class="link-btn" data-roll="2d20">Бросить 2к20</button></p>`;
  },
};
TOOLS['rule-cover'] = {
  fmt: { ac: (v) => `КД ${v}` },
  controls: (it, st) => html`${slider('ac', 'Ваш КД без укрытия', 8, 22, st.ac, (v) => `КД ${v}`)}<div class="ref-chips rl-cover-pick">${[['0', 'Нет'], ['1', 'Половина'], ['2', 'Три четверти'], ['3', 'Полное']].map(([v, l]) => html`<button class="chip chip-md" data-rx-set="cover:${v}" aria-pressed="${String(st.cover) === v}">${l}</button>`)}</div>`,
  out(it, st) {
    const add = [0, 2, 5, null][st.cover];
    return html`<div class="rl-wall c${st.cover}"><span class="rl-hero-dot">${ic('user', 16)}</span><i></i><span class="rl-foe">${ic('crosshair', 16)}</span></div>
      <div class="cr-verdict" style="--v:${['#9aa3b5', '#6fa8e8', '#a597f2', '#6ad3a1'][st.cover]}"><b>${add == null ? 'Не попасть' : `КД ${st.ac + add}`}</b><span>${['без укрытия', 'половинное: +2 к КД и спасброскам Ловкости', 'три четверти: +5 к КД и спасброскам Ловкости', 'полное: напрямую не достать ни атакой, ни заклинанием'][st.cover]}</span></div>`;
  },
};
const EXH = ['Помеха на проверки характеристик', 'Скорость вдвое меньше', 'Помеха на атаки и спасброски', 'Максимум хитов вдвое меньше', 'Скорость 0', 'Смерть'];
TOOLS['rule-exh'] = {
  fmt: { lvl: (v) => (v ? `${v} степень` : 'бодр') },
  controls: (it, st) => slider('lvl', 'Степень истощения', 0, 6, st.lvl, (v) => (v ? `${v} степень` : 'бодр')),
  out: (it, st) => html`<ol class="rl-ladder">${EXH.map((t, i) => html`<li class="${i < st.lvl ? 'on' : ''} ${i === 5 ? 'death' : ''}" data-rx-set="lvl:${i + 1}"><em>${i + 1}</em><span>${t}</span></li>`)}</ol>
    <p class="t-xs tertiary">Эффекты складываются. Продолжительный отдых с едой и питьём снимает одну степень.</p>`,
};
TOOLS['rule-death'] = {
  controls: () => html`<div class="row rl-death-btns"><button class="btn btn-primary btn-sm" data-rx-roll="roll">${ic('dice-faces-06')}Бросить к20</button><button class="btn btn-ghost btn-sm" data-rx-set="reset:1">Сначала</button></div>`,
  reduce(st, key, v) {
    if (key === 'reset') return { ok: 0, fail: 0, log: [], done: '' };
    const s = st.done ? { ok: 0, fail: 0, log: [], done: '' } : { ...st, log: [...st.log] };
    s.log.push(v);
    if (v === 20) s.done = 'up';
    else if (v === 1) s.fail += 2;
    else if (v >= 10) s.ok += 1;
    else s.fail += 1;
    if (!s.done && s.ok >= 3) s.done = 'stable';
    if (!s.done && s.fail >= 3) s.done = 'dead';
    return s;
  },
  out(it, st) {
    const pip = (n, of, cls) => Array.from({ length: of }, (_, i) => html`<i class="${i < n ? cls : ''}"></i>`);
    const verdict = { up: ['Встаёт с 1 хитом!', '#6ad3a1'], stable: ['Стабилен', '#6fa8e8'], dead: ['Смерть', '#e5584f'] }[st.done];
    return html`<div class="rl-death"><div><small>Успехи</small><span class="ok">${pip(st.ok, 3, 'on')}</span></div><div><small>Провалы</small><span class="fail">${pip(Math.min(3, st.fail), 3, 'on')}</span></div></div>
      ${st.log.length ? html`<p class="rl-log">${st.log.map((v) => html`<b class="${v === 20 ? 'crit' : v === 1 ? 'fumble' : v >= 10 ? 'ok' : 'bad'}">${v}</b>`)}</p>` : html`<p class="t-sm tertiary">Герой на 0 хитов. Каждый ход — к20: 10+ успех, 1 — два провала, 20 — встаёт.</p>`}
      ${verdict ? html`<div class="cr-verdict" style="--v:${verdict[1]}"><b>${verdict[0]}</b><span>${st.log.length} ${st.log.length === 1 ? 'бросок' : st.log.length < 5 ? 'броска' : 'бросков'}</span></div>` : ''}`;
  },
};
TOOLS['rule-fall'] = {
  fmt: { ft: (v) => `${v} фт` },
  controls: (it, st) => slider('ft', 'Высота', 10, 250, st.ft, (v) => `${v} фт`),
  out(it, st) {
    const n = Math.min(20, Math.floor(st.ft / 10));
    return html`<div class="sp-power"><button class="sp-big ref-dice" data-roll="${n}d6">${n}к6</button><span>дробящий · в среднем <b>${n * 3.5}</b>${n === 20 ? ' · больше не бывает' : ''}</span></div>
      <div class="rl-fall"><i style="height:${Math.min(100, (st.ft / 250) * 100)}%"></i><span>${Math.round(st.ft * 0.3)} м</span></div>`;
  },
};
TOOLS['rule-prof'] = {
  fmt: { lvl: (v) => `${v} уровень` },
  controls: (it, st) => slider('lvl', 'Уровень героя', 1, 20, st.lvl, (v) => `${v} уровень`),
  out: (it, st) => html`<div class="sp-power"><span class="sp-big">+${2 + Math.floor((st.lvl - 1) / 4)}</span><span>к атакам, навыкам и спасброскам с владением</span></div>
    <div class="rl-prof">${Array.from({ length: 20 }, (_, i) => html`<i class="${i + 1 <= st.lvl ? 'on' : ''}" style="height:${(2 + Math.floor(i / 4)) * 14}%" data-rx-set="lvl:${i + 1}"></i>`)}</div>`,
};
