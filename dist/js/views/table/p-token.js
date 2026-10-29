// Токен-бар снизу, редактор хитов, состояния, настройки токена, контекстные меню.
import { esc, fmtMod, uid, plural, html, raw } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { srcOf } from '../../core/assets.js';
import { tokenStats, patchTokenStats, characterOf, addLog, nextTokenName } from '../../core/campaign.js';
import { CONDITIONS, conditionById, SIZES, sizeById, LIGHTS, woundLabel, AURA_COLORS, AURA_OPACITY, auraHex, auraAlpha } from '../../data/rules.js';
import { popover, menu, closePopover, confirmDialog } from '../../ui/kit.js';
import { currentEntry } from './combat.js';
import { movementLeft } from './input.js';
import { bus, emitLocal } from '../../core/store.js';
import { gridSize, snapCenter } from '../../rules/geometry.js';
import { parseHpInput } from '../../rules/hp.js';

const ib = (act, name, tip, extra = '') => `<button class="icon-btn" data-act="${act}" data-tip="${esc(tip)}" aria-label="${esc(tip)}" ${extra}>${icon(name, 22)}</button>`;
const div = '<span class="divider"></span>';

export function selectedTokens(ctx) {
  return [...ctx.ui.selection].map((id) => ctx.scene?.tokens.find((t) => t.id === id)).filter(Boolean);
}

/** Хиты в токен-баре: число можно просто переписать (12 — стало 12, −5 — урон 5, +3 — лечение 3). */
function hpCell(st, canEdit, id = '') {
  const frac = Math.max(0, Math.min(1, st.hp / Math.max(1, st.hpMax)));
  const num = canEdit
    ? `<input class="hp-input ${st.hp <= 0 ? 'negative' : ''}" data-hp-input="${esc(id)}" value="${st.hp}" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="Хиты сейчас: впишите число, −урон или +лечение" data-tip="Впишите, сколько осталось, или −урон / +лечение">`
    : `<b class="${st.hp <= 0 ? 'negative' : ''}">${st.hp}</b>`;
  return `<div class="hp-cell ${canEdit ? 'editable' : ''}"><span class="hp-num"><small>хп</small> ${num}<b class="hp-max">/${st.hpMax}</b>${st.tempHp ? `<em>+${st.tempHp}</em>` : ''}</span><span class="hp-bar ${frac > 0.5 ? 'ok' : ''}"><i style="width:${frac * 100}%"></i></span></div>${canEdit ? ib('hp', 'first-aid-kit', 'Урон, лечение, временные хиты') : ''}`;
}

/** Записать ввод хитов токену. */
export function commitHpInput(ctx, id, text) {
  const v = parseHpInput(text);
  if (!v) return false;
  if (v.delta) applyHp(ctx, [id], v.delta);
  else if (v.set != null) setHp(ctx, id, v.set);
  return true;
}

/** Поставить точное число хитов (временные хиты не трогаются). */
export function setHp(ctx, id, value) {
  const t = ctx.scene.tokens.find((x) => x.id === id);
  if (!t) return;
  const st = tokenStats(ctx.c, t);
  const hp = Math.max(0, Math.min(st.hpMax || value, Math.floor(value)));
  if (hp === st.hp) return;
  const delta = hp - st.hp;
  let before = null, after = null, note = null;
  const pick = (x) => ({ hp: x.hp, conditions: [...(x.conditions || [])], ...(x.deathSaves ? { deathSaves: { ...x.deathSaves } } : {}) });
  ctx.mutateScene((s, c) => {
    patchTokenStats(c, s, id, (x) => {
      before = pick(x);
      const conds = new Set(x.conditions || []);
      if (delta < 0 && conds.has('concentration')) note = `${x.name || t.name}: проверка концентрации — спасбросок ТЕЛ СЛ ${Math.max(10, Math.floor(-delta / 2))}`;
      if (hp === 0 && t.kind === 'hero') { conds.add('unconscious'); conds.delete('concentration'); }
      if (hp > 0 && x.hp === 0) { conds.delete('unconscious'); if (x.deathSaves) x.deathSaves = { s: 0, f: 0 }; }
      const out = { hp, conditions: [...conds] };
      after = { ...pick(x), ...out };
      return out;
    });
    addLog(c, { kind: 'hp', userId: ctx.userId, text: `${st.name}: хиты ${st.hp} → ${hp}` });
  }, {
    label: 'Хиты',
    undo: (s, c) => { if (before) patchTokenStats(c, s, id, () => structuredClone(before)); },
    redo: (s, c) => { if (after) patchTokenStats(c, s, id, () => structuredClone(after)); },
  });
  if (note) ctx.toast({ title: 'Концентрация', body: note, icon: 'brain-02' });
  bus.send('hp-flash', { cid: ctx.cid, ids: [id], delta });
  emitLocal('hp-flash', { cid: ctx.cid, ids: [id], delta });
}

export function tokenBarHTML(ctx) {
  const toks = selectedTokens(ctx);
  if (!toks.length) return '';
  const c = ctx.c;
  if (toks.length > 1) {
    if (!ctx.isMasterView) return '';
    const allHidden = toks.every((t) => t.hidden);
    const names = toks.map((t) => tokenStats(c, t).name.replace(/\s\d+$/, ''));
    const same = names.every((n) => n === names[0]);
    const title = same ? `${toks.length} ${plural(toks.length, names[0].toLowerCase(), names[0].toLowerCase(), names[0].toLowerCase())}` : `${toks.length} ${plural(toks.length, 'токен', 'токена', 'токенов')}`;
    return `<div class="toolbar token-bar">
      <span class="tb-avatars">${toks.slice(0, 3).map((t) => `<span class="mini-tok ${t.kind}" style="background-image:url(${esc(srcOf(t.img))})"></span>`).join('')}</span>
      <span class="tb-titles"><b>${esc(same && toks.length > 1 ? `${toks.length} ${names[0].toLowerCase()}${toks.length > 4 ? 'ов' : 'а'}` : title)}</b><small>${allHidden ? 'скрыты от игроков' : 'выделено'}</small></span>${div}
      ${ib('combat-add', 'sword-03', c.combat.active ? 'Добавить в бой' : 'Начать бой с ними')}${ib('hp', 'first-aid-kit', 'Хиты всем (урон по области)')}${ib('conditions', 'sparkles', 'Состояния')}${ib('visibility', allHidden ? 'view-off' : 'view', allHidden ? 'Скрыты от игроков' : 'Видны игрокам', allHidden ? 'aria-pressed="true"' : '')}${ib('token-menu', 'more-vertical', 'Ещё')}${div}
      ${allHidden ? `<button class="btn btn-sm btn-secondary" data-act="reveal">${icon('view', 16)}Показать игрокам</button>` : ''}${ib('deselect', 'cancel-01', 'Снять выделение')}</div>`;
  }
  const t = toks[0];
  const st = tokenStats(c, t);
  if (t.kind === 'item') {
    return `<div class="toolbar token-bar"><span class="tb-avatar item" style="background-image:url(${esc(srcOf(t.img))})"></span><span class="tb-titles"><b>${esc(t.name)}</b><small>Предмет${t.hidden ? ' · скрыт' : ''}</small></span>${div}
      ${ctx.isMasterView ? `${ib('visibility', t.hidden ? 'view-off' : 'view', t.hidden ? 'Скрыт от игроков' : 'Виден игрокам', t.hidden ? 'aria-pressed="true"' : '')}${ib('token-settings', 'settings-01', 'Имя и размер')}${ib('token-delete', 'delete-02', 'Убрать')}${div}` : ib('ping-token', 'location-01', 'Пинг: показать отряду')}
      ${ib('deselect', 'cancel-01', 'Закрыть')}</div>`;
  }
  const can = ctx.canControl(t);
  const mine = ctx.isMine(t);
  const master = ctx.isMasterView;
  const down = st.hpMax > 0 && st.hp <= 0;
  const avatar = `<button class="tb-avatar ${t.kind} ${mine ? 'mine' : ''}" data-act="focus" data-tip="Показать на карте" style="background-image:url(${esc(srcOf(t.img))})"></button>`;
  if (master || mine) {
    const sub = mine ? `${st.subtitle} · ваш герой` : st.subtitle + (t.hidden ? ' · скрыт' : '');
    const left = movementLeft(ctx, t);
    let middle = hpCell(st, can, t.id);
    if (down && t.kind === 'hero') {
      const ds = st.deathSaves || { s: 0, f: 0 };
      middle += `${div}<span class="death-mini"><small>Спасброски от смерти</small><span>${[0, 1, 2].map((i) => `<i class="pip ok ${ds.s > i ? 'on' : ''}"></i>`).join('')}<b> </b>${[0, 1, 2].map((i) => `<i class="pip bad ${ds.f > i ? 'on' : ''}"></i>`).join('')}</span></span><button class="btn btn-sm btn-primary" data-act="death-save">${icon('dice-faces-06', 16)}Спасбросок</button>`;
    } else {
      middle += `${div}<span class="chip chip-md">КД ${st.ac}</span><span class="chip chip-md">${left !== null ? `${left}/${st.speed} фт` : `${st.speed} фт`}</span>${master && t.kind === 'foe' ? `<span class="chip chip-md">Иниц. ${fmtMod(st.initBonus)}</span>` : ''}`;
    }
    return `<div class="toolbar token-bar">${avatar}<span class="tb-titles"><b>${esc(st.name)}</b><small>${esc(down ? `Без сознания${mine ? ' · ваш ход' : ''}` : sub)}</small></span>${div}${middle}${div}
      ${ib('conditions', 'sparkles', `Состояния${st.conditions.length ? ` · ${st.conditions.length}` : ''}`)}${master ? ib('visibility', t.hidden ? 'view-off' : 'view', t.hidden ? 'Скрыт от игроков' : 'Виден игрокам', t.hidden ? 'aria-pressed="true"' : '') : ''}
      ${t.characterId ? ib('sheet', 'book-open-01', 'Лист героя') : ib('statblock', 'book-open-01', 'Статблок')}
      ${mine ? ib('quick-roll', 'dice-faces-06', 'Кубы') : ''}
      ${master ? ib('token-menu', 'more-vertical', 'Ещё') : ''}${div}${ib('deselect', 'cancel-01', 'Закрыть')}</div>`;
  }
  // Игрок смотрит на чужой токен
  const ally = t.kind === 'hero';
  const exact = c.settings.playersSeeHp === 'exact';
  const status = st.hpMax ? woundLabel(st.hp, st.hpMax) : '';
  const disp = ctx.dispositionOf(t);
  const who = ally ? esc(st.subtitle) : disp === 'friendly' ? 'Союзник' : disp === 'neutral' ? 'Нейтральное существо' : 'Противник';
  return `<div class="toolbar token-bar">${avatar}<span class="tb-titles"><b>${esc(ctx.nameOf(t, st))}</b><small>${who}${t.elevation ? ` · высота ${t.elevation} фт` : ''}</small></span>${div}
    ${ally || exact ? hpCell(st, false) : status ? `<span class="chip chip-md ${st.hp / st.hpMax <= 0.5 ? 'chip-negative' : 'chip-accent'}">${esc(status[0].toUpperCase() + status.slice(1))}</span>` : ''}
    ${st.conditions.length ? `<span class="tb-conds">${st.conditions.map((id) => { const cc = conditionById(id); return cc ? `<span class="status-badge" data-tip="${esc(cc.name)}">${icon(cc.icon, 13)}</span>` : ''; }).join('')}</span>` : ''}${div}
    ${ally && t.characterId ? ib('sheet', 'book-open-01', 'Лист героя (просмотр)') : ''}${ib('target', 'target-02', ctx.ui.targets?.has(t.id) ? 'Снять цель' : 'Отметить целью — увидят все', ctx.ui.targets?.has(t.id) ? 'aria-pressed="true"' : '')}${ib('ping-token', 'location-01', 'Пинг: показать отряду')}${div}${ib('deselect', 'cancel-01', 'Закрыть')}</div>`;
}

// ——— Хиты ———
export function hpEditor(ctx, ids, anchor, mode = null) {
  const toks = ids.map((id) => ctx.scene.tokens.find((t) => t.id === id)).filter(Boolean);
  if (!toks.length) return;
  const one = toks.length === 1 ? toks[0] : null;
  const st = one ? tokenStats(ctx.c, one) : null;
  const pop = popover(`<div class="hp-editor">
    <div class="panel-header">${one ? `<span class="avatar sm ${one.kind}"><img src="${esc(srcOf(one.img))}" alt=""></span>` : ''}<div class="titles"><div class="title">${esc(one ? st.name : `${toks.length} ${plural(toks.length, 'цель', 'цели', 'целей')}`)}</div><div class="subtitle">${one ? `${st.hp} из ${st.hpMax} хитов${st.tempHp ? ` · +${st.tempHp} временных` : ''}` : 'Урон по области: одно число для всех'}</div></div><button class="icon-btn icon-btn-sm" data-close>${icon('cancel-01', 18)}</button></div>
    ${one ? `<div class="panel-section"><label class="label" for="hpset">Осталось хитов</label>
      <div class="row"><div class="input grow"><input id="hpset" type="number" min="0" max="${st.hpMax}" inputmode="numeric" value="${st.hp}" data-set><span class="suffix">из ${st.hpMax}</span></div><button class="btn btn-primary" data-set-ok>${icon('tick-02', 16)}Записать</button></div>
      <span class="t-xs tertiary">Впишите число — без подсчётов. Или ниже: урон и лечение с учётом временных хитов.</span></div><hr class="panel-divider">` : ''}
    <div class="panel-section">
      <label class="label" for="hpv">${one ? 'Урон или лечение' : 'Сколько хитов'}</label>
      <div class="input"><input id="hpv" type="number" min="0" inputmode="numeric" data-v></div>
      <div class="row">${['1', '5', '10'].map((n) => `<button class="chip chip-md" data-q="${n}">${n}</button>`).join('')}${one ? `<button class="chip chip-md" data-q="half">½</button><button class="chip chip-md" data-q="all">всё</button>` : ''}</div>
      <div class="row hp-actions"><button class="btn btn-danger grow" data-dmg>${icon('minus-sign', 16)}Урон</button><button class="btn btn-success grow" data-heal>${icon('plus-sign', 16)}Лечение</button></div>
    </div>
    ${one ? `<hr class="panel-divider"><div class="panel-section"><div class="setting-row">${icon('shield-01', 18)}<span class="titles"><span class="label-main">Временные хиты</span></span><div class="input" style="width:72px;height:32px"><input type="number" min="0" data-temp value="${st.tempHp || ''}" placeholder="0"></div></div>
      ${ctx.isMasterView ? `<div class="setting-row">${icon('favourite', 18)}<span class="titles"><span class="label-main">Максимум хитов</span></span><div class="input" style="width:72px;height:32px"><input type="number" min="1" data-max value="${st.hpMax}"></div></div>` : ''}</div>` : ''}
  </div>`, anchor, { placement: 'top', className: 'hp-pop' });
  const box = pop.node;
  const v = box.querySelector('[data-v]');
  const setInput = box.querySelector('[data-set]');
  setTimeout(() => { const f = mode || !setInput ? v : setInput; f.focus(); f.select?.(); }, 20);
  const applySet = () => { const n = Math.floor(Number(setInput.value)); if (!Number.isFinite(n) || setInput.value === '') { setInput.closest('.input').classList.add('error'); return; } setHp(ctx, one.id, n); closePopover(); };
  setInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') applySet(); });
  box.addEventListener('click', (e) => {
    const q = e.target.closest('[data-q]');
    if (q) { v.value = q.dataset.q === 'half' ? Math.floor(st.hp / 2) : q.dataset.q === 'all' ? st.hp : q.dataset.q; v.focus(); }
    if (e.target.closest('[data-set-ok]')) applySet();
    if (e.target.closest('[data-dmg]')) apply(-1);
    if (e.target.closest('[data-heal]')) apply(1);
  });
  v.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(e.shiftKey ? 1 : -1); });
  box.querySelector('[data-temp]')?.addEventListener('change', (e) => setField('tempHp', Math.max(0, Number(e.target.value) || 0)));
  box.querySelector('[data-max]')?.addEventListener('change', (e) => setField('hpMax', Math.max(1, Number(e.target.value) || 1)));
  if (mode) setTimeout(() => box.querySelector(mode === 'heal' ? '[data-heal]' : '[data-dmg]')?.classList.add('pulse'), 30);
  function setField(f, val) {
    ctx.mutateScene((s, c) => patchTokenStats(c, s, one.id, (x) => ({ [f]: val, ...(f === 'hpMax' ? { hp: Math.min(x.hp, val) } : {}) })));
  }
  function apply(sign) {
    const amount = Math.max(0, Math.floor(Number(v.value) || 0));
    if (!amount) { v.closest('.input').classList.add('error'); return; }
    applyHp(ctx, toks.map((t) => t.id), sign * amount);
    closePopover();
  }
}

/** Применить урон (<0) или лечение (>0) с временными хитами, без сознания и концентрацией. */
export function applyHp(ctx, ids, delta) {
  const notes = [];
  const before = {}, after = {};
  const pick = (x) => ({ hp: x.hp, tempHp: x.tempHp || 0, conditions: [...(x.conditions || [])], ...(x.deathSaves ? { deathSaves: { ...x.deathSaves } } : {}) });
  ctx.mutateScene((s, c) => {
    for (const id of ids) {
      const t = s.tokens.find((x) => x.id === id);
      if (!t) continue;
      patchTokenStats(c, s, id, (x) => {
        before[id] = pick(x);
        let hp = x.hp, temp = x.tempHp || 0;
        const conds = new Set(x.conditions || []);
        if (delta < 0) {
          let dmg = -delta;
          const absorbed = Math.min(temp, dmg); temp -= absorbed; dmg -= absorbed;
          hp = Math.max(0, hp - dmg);
          if (conds.has('concentration')) notes.push(`${x.name || t.name}: проверка концентрации — спасбросок ТЕЛ СЛ ${Math.max(10, Math.floor(-delta / 2))}`);
          if (hp === 0 && t.kind === 'hero') { conds.add('unconscious'); conds.delete('concentration'); }
        } else {
          if (hp === 0 && delta > 0) { conds.delete('unconscious'); if (x.deathSaves) x.deathSaves = { s: 0, f: 0 }; }
          hp = Math.min(x.hpMax, hp + delta);
        }
        const out = { hp, tempHp: temp, conditions: [...conds] };
        after[id] = { ...pick(x), ...out };
        return out;
      });
    }
    const names = ids.map((id) => s.tokens.find((x) => x.id === id)).filter(Boolean).map((t) => tokenStats(c, t).name).join(', ');
    addLog(c, { kind: 'hp', userId: ctx.userId, text: `${names}: ${delta < 0 ? `урон ${-delta}` : `лечение ${delta}`}` });
  }, {
    label: 'Хиты',
    undo: (s, c) => { for (const id of ids) if (before[id]) patchTokenStats(c, s, id, () => structuredClone(before[id])); },
    redo: (s, c) => { for (const id of ids) if (after[id]) patchTokenStats(c, s, id, () => structuredClone(after[id])); },
  });
  for (const n of notes) ctx.toast({ title: 'Концентрация', body: n, icon: 'brain-02' });
  bus.send('hp-flash', { cid: ctx.cid, ids, delta });
  emitLocal('hp-flash', { cid: ctx.cid, ids, delta });
}

// ——— Состояния ———
export function conditionPicker(ctx, ids, anchor) {
  const toks = ids.map((id) => ctx.scene.tokens.find((t) => t.id === id)).filter(Boolean);
  if (!toks.length) return;
  const render = () => {
    const sts = toks.map((t) => tokenStats(ctx.c, ctx.scene.tokens.find((x) => x.id === t.id) || t));
    const active = (id) => sts.every((s) => s.conditions.includes(id));
    const count = new Set(sts.flatMap((s) => s.conditions)).size;
    return `<div class="cond-picker"><div class="panel-header"><div class="titles"><div class="title">Состояния</div><div class="subtitle">${esc(toks.length === 1 ? sts[0].name : `${toks.length} цели`)} · ${count} ${plural(count, 'активно', 'активны', 'активно')}</div></div><button class="icon-btn icon-btn-sm" data-close>${icon('cancel-01', 18)}</button></div>
      <div class="cond-grid">${CONDITIONS.map((c) => `<button class="cond ${active(c.id) ? 'on' : ''}" data-c="${c.id}" data-tip="${esc(c.text)}">${icon(c.icon, 16)}<span>${esc(c.name)}</span></button>`).join('')}</div></div>`;
  };
  const pop = popover(render(), anchor, { placement: 'top', className: 'cond-pop' });
  pop.node.addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    const id = b.dataset.c;
    const on = !b.classList.contains('on');
    ctx.mutateScene((s, c) => { for (const t of toks) patchTokenStats(c, s, t.id, (x) => { const set = new Set(x.conditions || []); on ? set.add(id) : set.delete(id); return { conditions: [...set] }; }); });
    pop.node.innerHTML = render();
  });
}

export function ruleCard(ctx, condId, anchor) {
  const c = conditionById(condId);
  if (!c) return;
  popover(`<div class="rule-card"><div class="row" style="gap:10px"><span class="status-badge negative">${icon(c.icon, 13)}</span><b class="t-lg">${esc(c.name)}</b></div><p class="t-para muted">${esc(c.text)}</p><p class="t-xs tertiary">Книга игрока · Приложение A (пересказ)</p></div>`, anchor, { placement: 'right' });
}

// ——— Настройки токена ———
function auraEditor(a) {
  const hex = auraHex(a), op = Math.round(auraAlpha(a) * 100);
  const custom = !AURA_COLORS.some((c) => c.hex === hex);
  return `<div class="aura-edit">
    <div class="row"><div class="input grow"><input data-aura-name-edit value="${esc(a.name)}" maxlength="40" aria-label="Название ауры"></div><div class="input" style="width:84px"><input type="number" data-aura-r-edit value="${a.radius}" min="5" step="5" aria-label="Радиус ауры"><span class="suffix">фт</span></div><button class="icon-btn icon-btn-sm" data-aura-off data-tip="Убрать ауру" aria-label="Убрать ауру">${icon('delete-02', 16)}</button></div>
    <div class="aura-colors" role="radiogroup" aria-label="Цвет ауры">${AURA_COLORS.map((c) => `<button class="swatch ${!custom && c.hex === hex ? 'on' : ''}" data-aura-color="${c.id}" style="--sw:${c.hex}" role="radio" aria-checked="${!custom && c.hex === hex}" aria-label="${esc(c.name)}" data-tip="${esc(c.name)}"></button>`).join('')}<label class="swatch custom ${custom ? 'on' : ''}" style="--sw:${hex}" data-tip="Свой цвет">${icon('paint-brush-01', 12)}<input type="color" data-aura-custom value="${hex}" aria-label="Свой цвет ауры"></label></div>
    <label class="aura-op"><span class="t-sm muted">Заметность</span><input class="slider" type="range" min="5" max="100" step="5" value="${op}" data-aura-op style="--fill:${((op - 5) / 95) * 100}%" aria-label="Заметность ауры"><b class="t-sm" data-aura-op-out>${op}%</b></label>
  </div>`;
}

export function tokenSettings(ctx, id, anchor) {
  const t0 = ctx.scene.tokens.find((t) => t.id === id);
  if (!t0) return;
  const render = () => {
    const t = ctx.scene.tokens.find((x) => x.id === id) || t0;
    const st = tokenStats(ctx.c, t);
    const lightId = t.light?.preset || (t.light ? 'custom' : 'none');
    return `<div class="token-settings"><div class="panel-header"><div class="titles"><div class="title">Настройки токена</div><div class="subtitle">${esc(st.name)}</div></div><button class="icon-btn icon-btn-sm" data-close>${icon('cancel-01', 18)}</button></div>
      <div class="panel-section">
        ${t.characterId ? '' : `<div class="field"><label>Имя на карте</label><div class="input"><input data-name value="${esc(t.name)}" maxlength="40"></div></div>`}
        ${t.kind === 'foe' || (t.kind !== 'hero' && t.kind !== 'item') ? `<div class="field"><label>Отношение</label><div class="chips-wrap">${[['hostile', 'Враг'], ['neutral', 'Нейтрал'], ['friendly', 'Союзник'], ['secret', 'Скрытый враг']].map(([v, l]) => `<button class="chip chip-md ${(t.disposition || 'hostile') === v ? 'chip-accent' : ''}" data-disp="${v}">${l}</button>`).join('')}</div><span class="t-xs tertiary">«Скрытый враг» игроки видят союзником — для предателей.</span></div>
        <div class="field"><label>Имя для игроков</label><div class="chips-wrap"><button class="chip chip-md ${!t.nameHidden ? 'chip-accent' : ''}" data-namehide="0">Показывать</button><button class="chip chip-md ${t.nameHidden ? 'chip-accent' : ''}" data-namehide="1">Скрыть — «Неизвестное существо»</button></div></div>` : ''}
        <div class="field"><label for="tk-elev">Высота над полом</label><div class="row"><div class="input" style="width:110px"><input id="tk-elev" type="number" step="5" data-elev value="${t.elevation || 0}"><span class="suffix">фт</span></div>${[0, 10, 30].map((v) => `<button class="chip chip-md ${(t.elevation || 0) === v ? 'chip-accent' : ''}" data-elev-q="${v}">${v ? `${v} фт` : 'на полу'}</button>`).join('')}</div></div>
        <div class="field"><label>Размер</label><div class="chips-wrap">${SIZES.map((s) => `<button class="chip chip-md ${t.size === s.id ? 'chip-accent' : ''}" data-size="${s.id}">${s.name}${s.cells > 1 ? ` · ${s.cells}×${s.cells}` : ''}</button>`).join('')}</div></div>
        <div class="field"><label>Несёт свет</label><div class="chips-wrap"><button class="chip chip-md ${lightId === 'none' ? 'chip-accent' : ''}" data-light="none">Нет</button>${LIGHTS.filter((l) => l.id !== 'campfire').map((l) => `<button class="chip chip-md ${lightId === l.id ? 'chip-accent' : ''}" data-light="${l.id}">${esc(l.name)}</button>`).join('')}</div>
          ${t.light ? `<label class="aura-op"><span class="t-sm muted">Яркий свет</span><input class="slider" type="range" min="0" max="60" step="5" value="${t.light.bright}" data-tl="bright" style="--fill:${(t.light.bright / 60) * 100}%" aria-label="Яркий свет"><b class="t-sm" data-tl-out="bright">${t.light.bright} фт</b></label>
          <label class="aura-op"><span class="t-sm muted">Тусклый ещё</span><input class="slider" type="range" min="0" max="60" step="5" value="${t.light.dim}" data-tl="dim" style="--fill:${(t.light.dim / 60) * 100}%" aria-label="Тусклый свет"><b class="t-sm" data-tl-out="dim">${t.light.dim} фт</b></label>` : ''}</div>
        <div class="field"><label>Тёмное зрение</label><div class="chips-wrap">${[0, 30, 60, 120].map((d) => `<button class="chip chip-md ${(st.darkvision || 0) === d ? 'chip-accent' : ''}" data-dv="${d}">${d ? `${d} фт` : 'нет'}</button>`).join('')}</div><div class="t-xs tertiary">${st.darkvision ? `${st.darkvision} фт · видит в темноте без цвета` : 'В темноте видит только освещённое'}</div></div>
        <div class="field"><label>Аура</label>${t.aura ? auraEditor(t.aura) : `<div class="row"><div class="input grow"><input data-aura-name placeholder="Например, Духовные стражи"></div><div class="input" style="width:84px"><input type="number" data-aura-r value="10" min="5" step="5"><span class="suffix">фт</span></div></div><button class="btn btn-sm btn-secondary" data-aura-add>${icon('plus-sign', 14)}Добавить ауру</button>`}</div>
      </div></div>`;
  };
  const pop = popover(render(), anchor, { placement: 'top', className: 'settings-pop' });
  const box = pop.node;
  const upd = (fn) => {
    ctx.mutateScene((s, c) => {
      const t = s.tokens.find((x) => x.id === id); if (!t) return;
      fn(t, c);
    });
    // Перерисовка — после текущего события: смена разметки во время blur/change ломает DOM.
    if (!box.__redraw) box.__redraw = requestAnimationFrame(() => { box.__redraw = 0; if (box.isConnected) box.innerHTML = render(); });
  };
  box.addEventListener('click', (e) => {
    const sz = e.target.closest('[data-size]');
    if (sz) upd((t, c, s) => { const n1 = sizeById(sz.dataset.size).cells; const p = snapCenter(ctx.scene.grid, t.x, t.y, n1); t.x = p.x; t.y = p.y; t.size = sz.dataset.size; });
    const li = e.target.closest('[data-light]');
    if (li) upd((t, c) => { const p = LIGHTS.find((l) => l.id === li.dataset.light); const val = p ? { preset: p.id, bright: p.bright, dim: p.dim, color: p.color, flicker: p.flicker } : null; t.light = val; if (t.characterId) { const ch = c.characters.find((x) => x.id === t.characterId); if (ch) ch.light = val; } });
    const dv = e.target.closest('[data-dv]');
    if (dv) upd((t, c) => { const v = Number(dv.dataset.dv); if (t.characterId) { const ch = c.characters.find((x) => x.id === t.characterId); if (ch) ch.darkvision = v; } else t.darkvision = v; });
    if (e.target.closest('[data-aura-off]')) upd((t, c) => setAura(t, c, null));
    if (e.target.closest('[data-aura-add]')) {
      const name = box.querySelector('[data-aura-name]').value.trim() || 'Аура';
      const radius = Math.max(5, Number(box.querySelector('[data-aura-r]').value) || 10);
      upd((t, c) => setAura(t, c, { name, radius, color: 'magic', opacity: AURA_OPACITY, text: '' }));
    }
    const dp = e.target.closest('[data-disp]'); if (dp) upd((t) => { t.disposition = dp.dataset.disp; });
    const nh = e.target.closest('[data-namehide]'); if (nh) upd((t) => { t.nameHidden = nh.dataset.namehide === '1'; });
    const eq = e.target.closest('[data-elev-q]'); if (eq) upd((t) => { t.elevation = Number(eq.dataset.elevQ) || 0; });
    const sw = e.target.closest('[data-aura-color]');
    if (sw) upd((t, c) => setAura(t, c, { ...t.aura, color: sw.dataset.auraColor }));
  });
  // Живой предпросмотр цвета и заметности — в памяти, запись по отпусканию.
  box.addEventListener('input', (e) => {
    const t = ctx.scene.tokens.find((x) => x.id === id);
    if (e.target.matches('[data-tl]') && t?.light) {
      const k = e.target.dataset.tl, v = Number(e.target.value);
      t.light = { ...t.light, [k]: v };
      e.target.style.setProperty('--fill', `${(v / 60) * 100}%`);
      box.querySelector(`[data-tl-out="${k}"]`).textContent = `${v} фт`;
      ctx.invalidateVision(); ctx.invalidate('fog', 'tokens');
      return;
    }
    if (!t?.aura) return;
    if (e.target.matches('[data-aura-op]')) {
      const v = Number(e.target.value);
      t.aura = { ...t.aura, opacity: v };
      e.target.style.setProperty('--fill', `${((v - 5) / 95) * 100}%`);
      box.querySelector('[data-aura-op-out]').textContent = `${v}%`;
      ctx.invalidate('areas');
    }
    if (e.target.matches('[data-aura-custom]')) { t.aura = { ...t.aura, color: e.target.value }; ctx.invalidate('areas'); }
  });
  box.addEventListener('change', (e) => {
    if (e.target.matches('[data-tl]')) { const k = e.target.dataset.tl, v = Number(e.target.value); upd((t, c) => { if (!t.light) return; t.light = { ...t.light, [k]: v, preset: t.light.preset }; if (t.characterId) { const ch = c.characters.find((x) => x.id === t.characterId); if (ch) ch.light = { ...t.light }; } }); }
    if (e.target.matches('[data-aura-op]')) { const v = Number(e.target.value); upd((t, c) => setAura(t, c, { ...t.aura, opacity: v })); }
    if (e.target.matches('[data-aura-custom]')) { const v = e.target.value; upd((t, c) => setAura(t, c, { ...t.aura, color: v })); }
    if (e.target.matches('[data-aura-name-edit]')) { const v = e.target.value.trim(); if (v) upd((t, c) => setAura(t, c, { ...t.aura, name: v })); }
    if (e.target.matches('[data-elev]')) { const v = Math.round((Number(e.target.value) || 0) / 5) * 5; upd((t) => { t.elevation = v; }); }
    if (e.target.matches('[data-aura-r-edit]')) { const v = Math.max(5, Number(e.target.value) || 5); upd((t, c) => setAura(t, c, { ...t.aura, radius: v })); }
  });
  box.addEventListener('change', (e) => { if (e.target.matches('[data-name]')) upd((t) => { t.name = e.target.value.trim() || t.name; }); });
}

/** Аура героя живёт и в листе, чтобы переходить с ним между сценами. */
function setAura(t, c, a) {
  t.aura = a;
  if (t.characterId) { const ch = c.characters.find((x) => x.id === t.characterId); if (ch) ch.aura = a ? { ...a } : null; }
}

export async function deleteTokens(ctx, ids) {
  const toks = ids.map((id) => ctx.scene.tokens.find((t) => t.id === id)).filter(Boolean);
  if (!toks.length) return;
  if (toks.some((t) => t.kind === 'hero')) {
    const ok = await confirmDialog({ title: 'Убрать героя со сцены?', body: 'Лист героя останется, исчезнет только фишка на этой карте.', ok: 'Убрать' });
    if (!ok) return;
  }
  const copies = structuredClone(toks);
  ctx.mutateScene((s, c) => { s.tokens = s.tokens.filter((t) => !ids.includes(t.id)); c.combat.entries = c.combat.entries.filter((e) => !ids.includes(e.tokenId)); },
    { label: 'Удаление', undo: (s) => { s.tokens.push(...structuredClone(copies)); }, redo: (s) => { s.tokens = s.tokens.filter((t) => !ids.includes(t.id)); } });
  ctx.select([]);
}

export function toggleHidden(ctx, ids, force = null) {
  const toks = ids.map((id) => ctx.scene.tokens.find((t) => t.id === id)).filter(Boolean);
  const hide = force ?? !toks.every((t) => t.hidden);
  const before = Object.fromEntries(toks.map((t) => [t.id, !!t.hidden]));
  ctx.mutateScene((s) => { for (const t of s.tokens) if (ids.includes(t.id)) t.hidden = hide; },
    { label: hide ? 'Скрыть' : 'Показать', undo: (s) => { for (const t of s.tokens) if (t.id in before) t.hidden = before[t.id]; }, redo: (s) => { for (const t of s.tokens) if (ids.includes(t.id)) t.hidden = hide; } });
  ctx.toast({ title: hide ? 'Скрыто от игроков' : 'Игроки видят', body: `${toks.length} ${plural(toks.length, 'токен', 'токена', 'токенов')}`, icon: hide ? 'view-off' : 'view' });
}

export function duplicateTokens(ctx, ids) {
  const g = gridSize(ctx.scene.grid);
  const copies = [];
  ctx.mutateScene((s) => {
    for (const id of ids) {
      const t = s.tokens.find((x) => x.id === id);
      if (!t || t.characterId) continue;
      const base = t.name.replace(/\s\d+$/, '');
      const n = { ...structuredClone(t), id: uid('t-'), name: nextTokenName(s, base), x: t.x + g, y: t.y };
      s.tokens.push(n); copies.push(n.id);
    }
  }, { label: 'Копия', undo: (s) => { s.tokens = s.tokens.filter((t) => !copies.includes(t.id)); }, redo: () => {} });
  if (copies.length) ctx.select(copies);
}

/** Ctrl+C: запомнить выделенные существа и предметы (героев не копируем). */
export function copyTokens(ctx, ids) {
  const toks = ids.map((id) => ctx.scene.tokens.find((t) => t.id === id)).filter((t) => t && !t.characterId);
  if (!toks.length) { ctx.toast({ title: 'Героев не копируем', body: 'Скопировать можно существ и предметы', icon: 'copy-01' }); return; }
  const cx = toks.reduce((a, t) => a + t.x, 0) / toks.length, cy = toks.reduce((a, t) => a + t.y, 0) / toks.length;
  ctx.ui.clipboard = { items: structuredClone(toks), cx, cy };
  ctx.toast({ title: `Скопировано: ${toks.length}`, body: 'Ctrl+V — вставить под курсором', icon: 'copy-01' });
}

/** Ctrl+V: вставить скопированное вокруг точки (по умолчанию — под курсором). */
export function pasteTokens(ctx, at) {
  const cb = ctx.ui.clipboard; if (!cb?.items.length || !ctx.scene) return;
  const m = ctx.scene.map, made = [];
  ctx.mutateScene((s) => {
    for (const t0 of cb.items) {
      const base = t0.name.replace(/\s\d+$/, '');
      const t = { ...structuredClone(t0), id: uid('t-'), name: nextTokenName(s, base), x: Math.max(0, Math.min(m.width, at.x + (t0.x - cb.cx))), y: Math.max(0, Math.min(m.height, at.y + (t0.y - cb.cy))) };
      s.tokens.push(t); made.push(t);
    }
  }, { label: 'Вставка', undo: (s) => { const ids = new Set(made.map((t) => t.id)); s.tokens = s.tokens.filter((t) => !ids.has(t.id)); }, redo: (s) => { s.tokens.push(...structuredClone(made)); } });
  ctx.select(made.map((t) => t.id));
}

/** Отметить токен целью (у всех над ним появится прицел цвета игрока). */
export function toggleTarget(ctx, id) {
  const set = ctx.ui.targets || (ctx.ui.targets = new Set());
  set.has(id) ? set.delete(id) : set.add(id);
  bus.send('target', { cid: ctx.cid, sceneId: ctx.sceneId, userId: ctx.userId, ids: [...set] });
  ctx.invalidate('tokens');
}
export function clearTargets(ctx) {
  ctx.ui.targets = new Set();
  bus.send('target', { cid: ctx.cid, sceneId: ctx.sceneId, userId: ctx.userId, ids: [] });
  ctx.invalidate('tokens');
}

/** Подсказка ауры: что делает и кто сейчас внутри. */
export function auraPopover(ctx, id, anchor) {
  const t = ctx.scene.tokens.find((x) => x.id === id); if (!t?.aura) return;
  const a = t.aura, st = tokenStats(ctx.c, t);
  const s = gridSize(ctx.scene.grid), n = sizeById(t.size).cells;
  const rad = (a.radius / (ctx.scene.grid.feet || 5)) * s + (n * s) / 2;
  const inside = ctx.scene.tokens.filter((o) => o.id !== t.id && o.kind !== 'item' && ctx.tokenShown(o) && Math.hypot(o.x - t.x, o.y - t.y) <= rad).map((o) => ctx.nameOf(o));
  const can = ctx.isMasterView || ctx.isMine(t);
  popover(`<div class="aura-pop"><div class="panel-header"><div class="titles"><div class="title">${esc(a.name)}</div><div class="subtitle">${esc(ctx.nameOf(t, st))} · ${a.radius} фт${a.concentration ? ' · концентрация' : ''}</div></div><button class="icon-btn icon-btn-sm" data-close>${icon('cancel-01', 18)}</button></div>
    <div class="panel-section">${a.text ? `<p class="t-para">${esc(a.text)}</p>` : '<p class="t-sm muted">Описание ауры не задано.</p>'}
    <p class="t-sm"><span class="muted">Сейчас в ауре:</span> ${inside.length ? esc(inside.join(', ')) : 'никого'}</p>
    ${can ? `<button class="btn btn-sm btn-secondary" data-aura-edit>${icon('settings-01', 14)}Настроить</button>` : ''}</div></div>`, anchor, { placement: 'top', className: 'aura-popover' })
    .node.addEventListener('click', (e) => { if (e.target.closest('[data-aura-edit]')) { closePopover(); tokenSettings(ctx, id, anchor); } });
}

// ——— Контекстное меню ———
export function contextMenu(ctx, target, w, screen) {
  const anchor = { x: screen.x, y: screen.y };
  if (target.kind === 'token') {
    const t = ctx.scene.tokens.find((x) => x.id === target.id);
    if (!t) return;
    if (!ctx.ui.selection.has(t.id)) ctx.select([t.id]);
    const ids = [...ctx.ui.selection];
    if (ctx.isMasterView) {
      const items = [
        { icon: 'first-aid-kit', label: 'Хиты…', onClick: () => hpEditor(ctx, ids, anchor) },
        { icon: 'sparkles', label: 'Состояния…', onClick: () => conditionPicker(ctx, ids, anchor) },
        { icon: t.hidden ? 'view' : 'view-off', label: t.hidden ? 'Показать игрокам' : 'Скрыть от игроков', hint: 'H', onClick: () => toggleHidden(ctx, ids) },
        { icon: 'sword-03', label: ctx.c.combat.active ? (ctx.c.combat.entries.some((e) => e.tokenId === t.id) ? 'Убрать из боя' : 'Добавить в бой') : 'Начать бой с выделенными', onClick: () => ctx.panels.combatToggle(ids) },
        'divider',
        { icon: 'settings-01', label: 'Настройки токена…', onClick: () => tokenSettings(ctx, t.id, anchor) },
        t.characterId ? { icon: 'view', label: 'Смотреть глазами', onClick: () => ctx.setViewAs(t.characterId) } : null,
        { icon: 'book-open-01', label: t.characterId ? 'Лист героя' : 'Статблок', onClick: () => ctx.panels.openSheetFor(t) },
        !t.characterId ? { icon: 'copy-01', label: 'Дублировать', onClick: () => duplicateTokens(ctx, ids) } : null,
        !t.characterId ? { icon: 'copy-link', label: 'Копировать', hint: 'Ctrl C', onClick: () => copyTokens(ctx, ids) } : null,
        { icon: 'target-02', label: ctx.ui.targets?.has(t.id) ? 'Снять цель' : 'Отметить целью', onClick: () => toggleTarget(ctx, t.id) },
        'divider',
        { icon: 'delete-02', label: 'Удалить', hint: 'Del', danger: true, onClick: () => deleteTokens(ctx, ids) },
      ].filter(Boolean);
      menu(items, anchor, { placement: 'right' });
    } else {
      const items = [
        ctx.isMine(t) ? { icon: 'book-open-01', label: 'Лист героя', onClick: () => ctx.panels.openSheetFor(t) } : null,
        ctx.isMine(t) ? { icon: 'sparkles', label: 'Состояния…', onClick: () => conditionPicker(ctx, [t.id], anchor) } : null,
        !ctx.isMine(t) ? { icon: 'target-02', label: ctx.ui.targets?.has(t.id) ? 'Снять цель' : 'Отметить целью', onClick: () => toggleTarget(ctx, t.id) } : null,
        ctx.ui.targets?.size ? { icon: 'cancel-01', label: 'Снять все мои цели', onClick: () => clearTargets(ctx) } : null,
        { icon: 'location-01', label: 'Пинг', onClick: () => ctx.ping(t.x, t.y) },
        { icon: 'ruler', label: 'Измерить отсюда', onClick: () => { ctx.setTool('measure', 'ruler'); ctx.ui.ruler = { pts: [{ x: t.x, y: t.y }, { x: t.x, y: t.y }], label: '' }; } },
      ].filter(Boolean);
      menu(items, anchor, { placement: 'right' });
    }
    return;
  }
  if (target.kind === 'wall' && ctx.isMasterView) { ctx.panels.wallPopover(target.id, anchor); return; }
  if (target.kind === 'light' && ctx.isMasterView) { ctx.panels.lightPopover(target.id, anchor); return; }
  if (ctx.ui.wallChain) { ctx.ui.wallChain = null; ctx.ui.wallGhost = null; ctx.invalidate('overlay'); return; }
  const items = [
    { icon: 'location-01', label: 'Пинг', hint: 'Alt клик', onClick: () => ctx.ping(w.x, w.y) },
    ctx.isMaster ? { icon: 'view', label: 'Смотрите сюда', hint: '⇧ Alt клик', onClick: () => ctx.ping(w.x, w.y, { look: true }) } : null,
    ctx.isMasterView ? { icon: 'scroll', label: 'Поставить метку', onClick: () => ctx.panels.addPin(w, 'read-aloud', anchor) } : null,
    ctx.isMasterView && ctx.ui.clipboard?.items.length ? { icon: 'copy-link', label: `Вставить (${ctx.ui.clipboard.items.length})`, hint: 'Ctrl V', onClick: () => pasteTokens(ctx, w) } : null,
    ctx.ui.targets?.size ? { icon: 'cancel-01', label: 'Снять все мои цели', onClick: () => clearTargets(ctx) } : null,
    { icon: 'ruler', label: 'Измерить отсюда', onClick: () => { ctx.setTool('measure', 'ruler'); const p = ctx.snapCenter(w); ctx.ui.ruler = { pts: [p, p], label: '' }; ctx.invalidate('overlay'); } },
    ctx.isMasterView ? { icon: 'monster', label: 'Поставить существо', onClick: () => { ctx.ui.placeAt = w; ctx.panels.openBestiary(); } } : null,
    ctx.isMasterView ? { icon: 'fire', label: 'Свет здесь', onClick: () => { ctx.setTool('lights'); ctx.panels.addLight(w, 'torch', anchor); } } : null,
  ].filter(Boolean);
  menu(items, anchor, { placement: 'right' });
}

export { currentEntry, characterOf, html, raw };
