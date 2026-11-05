// «Своё существо, которого нет в базе» (#190 E; Figma 2.11: _player 19 «Своё существо», экраны 78–80;
// _master 06, экраны 17·1–17·4). Одна карточка на двоих:
// - мастер: из бестиария при пустом поиске («Создать «запрос»») — существо встаёт скрытым и выбранным;
// - игрок: ПКМ по клетке → «Поставить своё существо…» — союзник, ходит игрок, но пока мастер не решил, токен
//   полупрозрачный, с пометкой «ждёт мастера» и виден только владельцу (поле `pending`). Мастер: «Разрешить»,
//   «Поправить», «Убрать»; игроку — тост с итогом. Снять `pending` может только мастер (на сервере — guard_token).
// Числа необязательны: пустое — мастер заполнит. «Сохранить в «Мои существа»» — личная библиотека для повторов.
import { esc, uid } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { srcOf } from '../../core/assets.js';
import { nextTokenName, userById, tokenStats } from '../../core/campaign.js';
import { saveCreature } from '../../core/library.js';
import { popover, closePopover } from '../../ui/kit.js';
import { sizeById } from '../../data/rules.js';
import { spotNear, viewCenter, hydrateImages, commitCreatures } from './p-side.js';
import { pickTokenImage, storeTokenImage, deleteTokens } from './p-token.js';
import { isServerMode } from '../../core/store.js';
import { libraryImageFrom, attachImageDrop } from '../creature-img.js';

export const CARD_SIZES = [
  ['tiny', 'Крош.', 'Крошечный — четверть клетки, может делить её с другими'],
  ['small', 'Мал.', 'Маленький — одна клетка'],
  ['medium', 'Сред.', 'Средний — одна клетка'],
  ['large', 'Бол.', 'Большой — 2×2 клетки'],
  ['huge', 'Огр.', 'Огромный — 3×3 клетки'],
];
const SIDES = [['hostile', 'Враг', 'Против отряда. Ходите им вы'], ['friendly', 'Союзник', 'На стороне отряда, ходите им вы'], ['neutral', 'Нейтральный', 'Ни за кого, пока вы не решите']];

import { intOrNull, parseHp, tokenFields, diffNumbers } from './own-creature-num.js';
export { intOrNull, parseHp, tokenFields, diffNumbers };

const bad = (v) => Number.isNaN(v);

// ——— Карточка ———
/**
 * Открыть карточку своего существа. at — точка на карте (клетка, по которой кликнули), name — из поиска.
 * Мастер ставит существо сразу (скрытым и выбранным); игрок — «ждёт мастера».
 */
export function creatureCard(ctx, { at = null, name = '', anchor = null, img = '', file = null } = {}) {
  if (!ctx.scene) return;
  const master = ctx.isMasterView;
  // file — выбранный файл картинки: с ним копия уходит и в «Мои существа» (личный бакет), а не только на карту.
  const st = { name: name.trim(), img, file, size: master ? 'medium' : 'tiny', side: 'hostile', ac: '', hp: '', speed: '', fly: '', init: '', save: !master, hidden: true, combat: false };
  const face = () => { const ref = st.img || `ini:${st.name || '?'}`; return `<span class="cc-face ${master ? `disp-${st.side}` : 'disp-friendly'}"><img alt="" data-ref="${esc(ref)}" src="${esc(srcOf(ref))}"></span><span class="cc-face-name">${esc(st.name || 'Без имени')}</span>`; };
  const field = (k, label, ph, extra = '') => `<label class="field"><span class="label">${label}</span><span class="input"><input data-n="${k}" value="${esc(st[k])}" placeholder="${ph}" inputmode="${k === 'hp' ? 'text' : 'numeric'}" autocomplete="off" aria-label="${label}"></span>${extra}</label>`;
  const html = () => `<div class="cc-pop">
    <div class="panel-header"><div class="titles"><div class="title">${master ? 'Новое существо' : 'Своё существо'}</div><div class="subtitle">${master ? 'Нет в бестиарии — соберите за минуту, атаки можно потом' : 'Мастер посмотрит, прежде чем его увидят все'}</div></div><button class="icon-btn icon-btn-sm" data-close aria-label="Закрыть">${icon('cancel-01', 18)}</button></div>
    <div class="panel-section cc-body">
      <div class="cc-id"><div class="cc-prev" data-face>${face()}</div><div class="col grow" style="gap:6px">
        <label class="field"><span class="label">Имя</span><span class="input"><input data-name maxlength="40" value="${esc(st.name)}" placeholder="${master ? 'Теневой пёс' : 'Клякса'}" aria-label="Имя существа"></span></label>
        <div class="row" style="gap:6px"><button class="btn btn-sm btn-secondary" data-img>${icon('upload-01', 16)}${st.img ? 'Заменить картинку' : 'Своя картинка'}</button>${st.img ? '<button class="btn btn-sm btn-ghost" data-noimg>Без картинки</button>' : ''}</div>
        <span class="t-xs tertiary">${st.img ? 'Картинка будет и на карте, и в «Моих существах»' : 'PNG, JPEG или WebP до 5 МБ; без картинки — инициалы'}</span>
      </div></div>
      <div class="cc-sect"><div class="label">${master ? 'Кто это' : 'Чьё'}</div>
        ${master ? `<div class="chips-wrap">${SIDES.map(([v, l]) => `<button class="chip chip-md ${st.side === v ? 'chip-accent' : ''}" data-side="${v}">${l}</button>`).join('')}</div><p class="t-sm muted">${SIDES.find((x) => x[0] === st.side)[2]}</p>`
          : '<div class="chips-wrap"><span class="chip chip-md chip-accent">Моё · двигаю я</span></div><p class="t-sm muted">Союзник отряда. Ходите им сами, мастер может забрать управление</p>'}</div>
      <div class="cc-sect"><div class="label">Размер</div>
        <div class="cc-seg" role="radiogroup" aria-label="Размер">${CARD_SIZES.map(([v, l]) => `<button class="${st.size === v ? 'on' : ''}" data-size="${v}" role="radio" aria-checked="${st.size === v}">${l}</button>`).join('')}</div>
        <p class="t-sm muted">${CARD_SIZES.find((x) => x[0] === st.size)[2]}</p></div>
      <div class="cc-sect"><div class="label">Числа</div>
        <div class="cc-grid">${field('ac', 'КД', '13')}${field('hp', 'Хиты', master ? '9 или 2к8' : '4')}${field('speed', 'Скорость, фт', '30')}${field('init', 'Инициатива', '+2')}</div>
        <label class="field cc-fly"><span class="label">Полёт, фт</span><span class="input"><input data-n="fly" value="${esc(st.fly)}" placeholder="—" inputmode="numeric" aria-label="Скорость полёта"></span></label>
        <p class="t-sm muted">${master ? 'Хиты формулой — бросок. Пустое — не задано, можно позже' : 'Не знаете чисел — оставьте пустыми, мастер заполнит'}</p>
        <p class="t-sm muted cc-err" data-err hidden></p></div>
    </div>
    <div class="panel-footer cc-foot">
      <label class="check t-sm"><input type="checkbox" data-opt="save" ${st.save ? 'checked' : ''}>Сохранить в «Мои существа»</label>
      ${master ? `<label class="check t-sm"><input type="checkbox" data-opt="hidden" ${st.hidden ? 'checked' : ''}>Скрыть от игроков</label><label class="check t-sm"><input type="checkbox" data-opt="combat" ${st.combat ? 'checked' : ''}>Сразу в бой</label>` : ''}
      <button class="btn btn-primary btn-block" data-ok>${icon(master ? 'plus-sign' : 'chess-pawn', 16)}${master ? 'Поставить на карту' : 'Отправить мастеру'}</button>
    </div></div>`;
  let detachDrop = () => {};
  const pop = popover(html(), anchor || { x: innerWidth / 2, y: innerHeight / 2 }, { placement: anchor ? 'right' : 'auto', className: 'cc-popover', onClose: () => detachDrop() });
  const n = pop.node;
  const rerender = (focusSel = null) => { n.innerHTML = html(); hydrateImages(n); pop.reposition?.(); if (focusSel) n.querySelector(focusSel)?.focus(); };
  detachDrop = attachImageDrop(n, { toast: ctx.toast, onFile: async (file) => {
    if (st.busy) return;
    st.busy = true; n.querySelector('[data-ok]').disabled = true;
    try {
      const ref = await storeTokenImage(ctx, file);
      if (n.isConnected) { st.img = ref; st.file = file; rerender(); }
    } finally { st.busy = false; if (n.isConnected) n.querySelector('[data-ok]').disabled = false; }
  } });
  hydrateImages(n);
  n.querySelector('[data-name]').focus();
  n.addEventListener('input', (e) => {
    if (e.target.matches('[data-name]')) { st.name = e.target.value; n.querySelector('[data-face]').innerHTML = face(); hydrateImages(n); }
    if (e.target.matches('[data-n]')) { st[e.target.dataset.n] = e.target.value; e.target.closest('.input').classList.remove('error'); }
  });
  n.addEventListener('change', (e) => { const o = e.target.closest('[data-opt]'); if (o) st[o.dataset.opt] = o.checked; });
  n.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && e.target.matches('input:not([type=checkbox])')) place(); if (e.key === 'Escape') closePopover(); });
  n.addEventListener('click', (e) => {
    const sd = e.target.closest('[data-side]'); if (sd) { st.side = sd.dataset.side; rerender(); return; }
    const sz = e.target.closest('[data-size]'); if (sz) { st.size = sz.dataset.size; rerender(); return; }
    if (e.target.closest('[data-img]')) { pickTokenImage(ctx, (ref, file) => { if (ref !== st.img) st.file = file || null; st.img = ref; if (n.isConnected) rerender(); }, { ref: st.img, defaultRef: `ini:${st.name || '?'}` }); return; }
    if (e.target.closest('[data-noimg]')) { st.img = ''; st.file = null; rerender(); return; }
    if (e.target.closest('[data-ok]')) place();
  });

  async function place() {
    if (st.busy) return;
    const err = n.querySelector('[data-err]');
    if (!st.name.trim()) { n.querySelector('[data-name]').closest('.input').classList.add('error'); n.querySelector('[data-name]').focus(); return; }
    const wrong = ['ac', 'speed', 'fly', 'init'].filter((k) => bad(intOrNull(st[k])));
    if (bad(parseHp(st.hp, () => 0.5))) wrong.push('hp');
    if (wrong.length) {
      for (const k of wrong) n.querySelector(`[data-n="${k}"]`)?.closest('.input').classList.add('error');
      err.hidden = false; err.textContent = wrong.includes('hp') ? 'Хиты — число или формула вроде 2к8+2' : 'Здесь нужно целое число';
      return;
    }
    st.busy = true;
    n.querySelectorAll('input, button').forEach((x) => { x.disabled = true; });
    try {
      const t = await placeCreature(ctx, st, at);
      if (!t) return;
      closePopover();
      if (st.save) saveToLibrary(ctx, st);
    } catch (error) {
      err.hidden = false; err.textContent = `Существо не сохранено: ${error.message || error}`;
    } finally {
      st.busy = false;
      n.querySelectorAll('input, button').forEach((x) => { x.disabled = false; });
    }
  }
}

/** Поставить существо по карточке (без окна — для тестов и повторов). Возвращает токен. */
export function placeCreature(ctx, st, at = null, random = undefined) {
  const sc = ctx.scene; if (!sc) return null;
  const master = ctx.isMasterView;
  const n = sizeById(st.size).cells;
  const p = spotNear(ctx, at || viewCenter(ctx), n);
  const name = st.name.trim();
  const t = {
    id: uid('t-'), kind: master ? 'foe' : 'custom', name: sc.tokens.some((x) => x.name === name) ? nextTokenName(sc, name) : name, img: st.img || `ini:${name}`, size: st.size,
    x: p.x, y: p.y, hidden: master ? !!st.hidden : false, conditions: [], disposition: master ? st.side : 'friendly', light: null, aura: null,
    ...tokenFields(st, random),
    ...(master ? {} : { ownerId: ctx.userId, pending: true }),
  };
  const history = { label: master ? 'Новое существо' : 'Своё существо', undo: (s) => { s.tokens = s.tokens.filter((x) => x.id !== t.id); }, redo: (s) => { s.tokens.push(structuredClone(t)); } };
  if (isServerMode()) return commitCreatures(ctx, ctx.sceneId, [t], null, history).then(placed);
  ctx.mutateScene((s) => { s.tokens.push(t); }, history);
  return placed();
  function placed() {
    if (ctx.sceneId !== sc.id) return t;
    ctx.select([t.id]);
    if (master) {
      ctx.toast({
        title: `«${t.name}» на карте`, body: t.hidden ? 'Скрыто от игроков' : 'Игроки его видят', icon: 'monster',
        ...(t.hidden ? { action: { label: 'Показать', onClick: () => ctx.mutateScene((s) => { const x = s.tokens.find((q) => q.id === t.id); if (x) x.hidden = false; }, { label: 'Показать', undo: (s) => { const x = s.tokens.find((q) => q.id === t.id); if (x) x.hidden = true; }, redo: (s) => { const x = s.tokens.find((q) => q.id === t.id); if (x) x.hidden = false; } }) } } : {}),
      });
      if (st.combat) ctx.panels.combatToggle([t.id]);
    } else {
      ctx.toast({ title: `«${t.name}» ждёт мастера`, body: 'Пока мастер не решит, существо видите только вы. Передумали — ПКМ → «Отменить»', icon: 'hourglass' });
    }
    return t;
  }
}

async function saveToLibrary(ctx, st) {
  const f = tokenFields(st, () => 0.5);
  const hp = parseHp(st.hp, () => 0.5);
  // Картинка в библиотеке — своя копия (на сервере ссылка кампании в другой кампании не откроется).
  let img = '';
  if (st.img && !st.img.startsWith('ini:')) {
    try { img = await libraryImageFrom(st.file, st.img); }
    catch (err) { ctx.toast({ title: 'Картинка в «Мои существа» не попала', body: `${err.message || err}. Существо сохраним с инициалами — картинку можно добавить на главной`, icon: 'alert-circle' }); }
  }
  try {
    await saveCreature({
      name: st.name.trim(), img, size: st.size, type: 'своё существо',
      ac: f.ac ?? null, hp: hp && !hp.formula ? hp.hp : null, hpFormula: hp?.formula || '',
      speed: { walk: f.speed ?? null, fly: f.fly ?? null, swim: null, climb: null, burrow: null },
      stats: { str: null, dex: f.initBonus != null ? Math.max(1, Math.min(30, 10 + 2 * f.initBonus)) : null, con: null, int: null, wis: null, cha: null },
    });
  } catch (err) {
    ctx.toast({ title: 'В «Мои существа» не сохранилось', body: err.message || String(err), icon: 'alert-circle' });
  }
}

// ——— «Ждёт мастера» ———
const pendingOf = (ctx) => (ctx.scene?.tokens || []).filter((t) => t.pending);

/** Решение мастера: patch — поправленные числа (или null); approve=false — убрать. */
export function decidePending(ctx, id, { approve = true, patch = null } = {}) {
  const t0 = ctx.scene?.tokens.find((t) => t.id === id); if (!ctx.isMasterView || !t0?.pending) return;
  if (!approve) { deleteTokens(ctx, [id]); return; }
  const before = structuredClone(t0);
  const apply = (s) => {
    const t = s.tokens.find((x) => x.id === id); if (!t) return;
    // Свежее существо с полными хитами получает новый максимум целиком; раненое — не больше нового максимума.
    const full = t.hp == null || t.hp === t.hpMax;
    delete t.pending;
    if (patch) Object.assign(t, patch);
    if (patch?.hpMax != null) t.hp = full ? patch.hpMax : Math.min(t.hp, patch.hpMax);
  };
  ctx.mutateScene(apply, { label: 'Разрешить существо', undo: (s) => { const i = s.tokens.findIndex((x) => x.id === id); if (i >= 0) s.tokens[i] = structuredClone(before); }, redo: apply });
}

/** Окно мастера: посмотреть, поправить числа, разрешить или убрать. */
export function reviewPending(ctx, id, anchor = null) {
  const t = ctx.scene?.tokens.find((x) => x.id === id); if (!ctx.isMasterView || !t?.pending) return;
  const owner = userById(t.ownerId);
  const st = { ac: t.ac ?? '', hp: t.hpMax ?? '', speed: t.speed ?? '', init: t.initBonus ?? '' };
  const pos = anchor || (() => { const s = ctx.camera.toScreen(t.x, t.y); return { x: s.x + 24, y: s.y }; })();
  const pop = popover(`<div class="cc-pop cc-review">
    <div class="panel-header"><div class="titles"><div class="title">${esc(t.name)} · ждёт вас</div><div class="subtitle">Своё существо игрока ${esc(owner?.name || '—')} · ${esc(CARD_SIZES.find((x) => x[0] === t.size)?.[2] || '')}</div></div><button class="icon-btn icon-btn-sm" data-close aria-label="Закрыть">${icon('cancel-01', 18)}</button></div>
    <div class="panel-section"><div class="cc-id"><div class="cc-prev"><span class="cc-face disp-friendly"><img alt="" data-ref="${esc(t.img || `ini:${t.name}`)}" src="${esc(srcOf(t.img || `ini:${t.name}`))}"></span></div>
      <div class="cc-grid grow">${[['ac', 'КД'], ['hp', 'Хиты'], ['speed', 'Скорость, фт'], ['init', 'Инициатива']].map(([k, l]) => `<label class="field"><span class="label">${l}</span><span class="input"><input data-n="${k}" value="${esc(st[k])}" placeholder="—" inputmode="numeric" aria-label="${l}"></span></label>`).join('')}</div></div>
      <p class="t-sm muted">Поправьте числа, если нужно, — игрок увидит, что изменилось.</p><p class="t-sm muted cc-err" data-err hidden></p></div>
    <div class="panel-footer"><button class="btn btn-sm btn-ghost" data-no>${icon('delete-02', 14)}Убрать</button><span class="spacer"></span><button class="btn btn-sm btn-primary" data-yes>${icon('tick-02', 14)}Разрешить</button></div></div>`, pos, { placement: 'right', className: 'cc-popover' });
  const n = pop.node;
  hydrateImages(n);
  n.addEventListener('keydown', (e) => e.stopPropagation());
  n.addEventListener('input', (e) => { if (e.target.matches('[data-n]')) { st[e.target.dataset.n] = e.target.value; e.target.closest('.input').classList.remove('error'); } });
  n.addEventListener('click', (e) => {
    if (e.target.closest('[data-no]')) { closePopover(); decidePending(ctx, id, { approve: false }); return; }
    if (!e.target.closest('[data-yes]')) return;
    const f = tokenFields({ ...st, hp: String(st.hp) }, () => 0.5);
    const wrong = ['ac', 'speed', 'init'].filter((k) => bad(intOrNull(st[k])));
    if (bad(parseHp(String(st.hp), () => 0.5))) wrong.push('hp');
    if (wrong.length) { for (const k of wrong) n.querySelector(`[data-n="${k}"]`)?.closest('.input').classList.add('error'); const er = n.querySelector('[data-err]'); er.hidden = false; er.textContent = 'Здесь нужно целое число'; return; }
    const cur = ctx.scene.tokens.find((x) => x.id === id);
    const patch = {};
    for (const k of ['ac', 'hpMax', 'speed', 'initBonus']) if ((f[k] ?? null) !== (cur?.[k] ?? null) && f[k] != null) patch[k] = f[k];
    closePopover();
    decidePending(ctx, id, { approve: true, patch: Object.keys(patch).length ? patch : null });
  });
}

/** Пункты меню ПКМ: мастеру — решение, владельцу — «Отменить». */
export function pendingItems(ctx, t) {
  if (!t?.pending) return [];
  if (ctx.isMasterView) return [
    { icon: 'tick-02', label: 'Разрешить', onClick: () => decidePending(ctx, t.id) },
    { icon: 'settings-01', label: 'Поправить…', onClick: () => reviewPending(ctx, t.id) },
    { icon: 'delete-02', label: 'Убрать', danger: true, onClick: () => decidePending(ctx, t.id, { approve: false }) },
    'divider',
  ];
  if (ctx.owns(t) || ctx.isMine(t)) return [{ icon: 'cancel-01', label: 'Отменить — мастер ещё не ответил', onClick: () => { ctx.ui.pendingCancel ||= new Set(); ctx.ui.pendingCancel.add(t.id); deleteTokens(ctx, [t.id]); } }, 'divider'];
  return [];
}

/**
 * Следить за «ждёт мастера»: мастеру — тост о новом существе с «Посмотреть»; владельцу — итог решения.
 * После входа на стол существующие заявки также доступны мастеру.
 */
export function trackPending(ctx) {
  const sc = ctx.scene; if (!sc) return;
  const prev = ctx.ui.pendingSeen;
  if (ctx.isMaster) {
    const now = new Set(pendingOf(ctx).map((t) => t.id));
    ctx.ui.pendingSeen = { sceneId: ctx.sceneId, ids: now };
    if (prev && prev.sceneId !== ctx.sceneId) return;
    for (const id of now) {
      if (prev?.ids?.has(id)) continue;
      const t = sc.tokens.find((x) => x.id === id);
      ctx.toast({ title: `${userById(t.ownerId)?.name || 'Игрок'} ставит своё существо`, body: `«${t.name}» ждёт вашего решения`, icon: 'hourglass', action: { label: 'Посмотреть', onClick: () => reviewPending(ctx, id) } });
    }
    return;
  }
  const mine = new Map(sc.tokens.filter((t) => (t.ownerId === ctx.userId || ctx.isMine(t)) && (t.pending || prev?.mine?.has(t.id))).map((t) => [t.id, { name: t.name, pending: !!t.pending, nums: { ac: t.ac, hpMax: t.hpMax, speed: t.speed, initBonus: t.initBonus } }]));
  ctx.ui.pendingSeen = { sceneId: ctx.sceneId, mine: new Map([...mine].filter(([, v]) => v.pending)) };
  if (!prev?.mine || prev.sceneId !== ctx.sceneId) return;
  for (const [id, was] of prev.mine) {
    const nowT = mine.get(id);
    if (!nowT) {
      if (ctx.ui.pendingCancel?.has(id)) { ctx.ui.pendingCancel.delete(id); continue; }
      ctx.toast({ title: `Мастер убрал «${was.name}»`, body: 'Если сохраняли — карточка осталась в «Моих существах»', icon: 'delete-02' });
      continue;
    }
    if (!nowT.pending) {
      const changed = diffNumbers(was.nums, nowT.nums);
      ctx.toast({ title: `«${nowT.name}» на карте`, body: changed ? `Мастер разрешил и поправил: ${changed}` : 'Мастер разрешил — теперь его видят все', icon: 'tick-02' });
    }
  }
}

/** Видит ли зритель токен «ждёт мастера»: мастер и владелец — да, остальные — нет. */
export const pendingHidden = (ctx, t) => !!t.pending && !ctx.isMasterView && !ctx.owns(t) && !ctx.isMine(t);

export { tokenStats };

/** Постоянная очередь, включая заявки на других сценах и после перезагрузки. */
export function pendingQueue(ctx, anchor) {
  if (!ctx.isMasterView) return;
  const entries = ctx.c.scenes.flatMap((s) => s.tokens.filter((t) => t.pending).map((t) => ({ s, t })));
  const p = popover(`<div class="pick-pop"><div class="panel-header"><div class="title">Запросы токенов</div><button class="icon-btn" data-close>${icon('cancel-01', 18)}</button></div><div class="w-list scroll">${entries.length ? entries.map(({s,t},i) => `<button class="list-row" data-request="${i}"><span class="grow col-tight"><b>${esc(t.name)}</b><small>${esc(s.name)} · ${esc(userById(t.ownerId)?.name || 'Игрок')}</small></span>${icon('arrow-right-01',16)}</button>`).join('') : '<p class="panel-section muted">Запросов нет</p>'}</div></div>`, anchor, { placement: 'left' });
  p.node.addEventListener('click', (e) => {
    const b = e.target.closest('[data-request]'); if (!b) return;
    const {s,t} = entries[Number(b.dataset.request)];
    closePopover(); ctx.switchScene(s.id); reviewPending(ctx,t.id,anchor);
  });
}
