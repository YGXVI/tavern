// Интерфейс «Дать зрение игроку» (#190 C): пункт меню мастера, окно «кому и как далеко», кольца на карте,
// плашка и строка в виджете «Зрение» у игрока, тосты. Данные и правила — sight.js.
import { esc } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { srcOf } from '../../core/assets.js';
import { tokenStats, characterOf, myCharacter } from '../../core/campaign.js';
import { popover, closePopover } from '../../ui/kit.js';
import { bus } from '../../core/store.js';
import { SIGHT_STEPS, SIGHT_MAX, grantsOf, canGiveSight, sightBlocked, activeSight, sightRadius, clampFt, giveSight, takeSight } from './sight.js';

const q = (s) => `«${s}»`;

/** Герои отряда, которым можно дать глаза: с игроком в кампании или стоящие на этой сцене. */
function partyHeroes(ctx) {
  const c = ctx.c;
  return c.characters.filter((ch) => c.members.some((m) => m.characterId === ch.id && m.status === 'active' && m.role === 'player') || ctx.scene?.tokens.some((t) => t.characterId === ch.id));
}

/** Герой-хозяин существа: призыватель или герой игрока-владельца. */
function ownerHero(ctx, t) {
  const by = t.summonedBy && ctx.scene?.tokens.find((x) => x.id === t.summonedBy);
  if (by?.characterId) return characterOf(ctx.c, by.characterId);
  return t.ownerId ? myCharacter(ctx.c, t.ownerId) : null;
}

// ——— Меню ПКМ мастера ———
export function sightMenuItems(ctx, t, anchor) {
  if (!canGiveSight(t)) return [];
  const items = [{ icon: 'view', label: 'Дать зрение игроку…', onClick: () => sightPopover(ctx, t.id, anchor) }];
  for (const g of grantsOf(t)) items.push({ icon: 'view-off', label: `Забрать зрение · ${characterOf(ctx.c, g.to)?.name || 'герой'}`, onClick: () => takeSight(ctx, t.id, g.to) });
  return items;
}

// ——— Окно «Дать зрение игроку» (экран 39·2) ———
export function sightPopover(ctx, id, anchor) {
  const t = ctx.scene?.tokens.find((x) => x.id === id);
  if (!t || !canGiveSight(t)) return;
  const st = tokenStats(ctx.c, t);
  const name = ctx.nameOf(t, st);
  const heroes = partyHeroes(ctx);
  if (!heroes.length) { ctx.toast({ title: 'В отряде нет героев', body: 'Глаза существа можно дать герою игрока', icon: 'view' }); return; }
  const owner = ownerHero(ctx, t);
  const grants = grantsOf(t);
  const pick0 = grants.find((g) => heroes.some((h) => h.id === g.to))?.to || (owner && heroes.some((h) => h.id === owner.id) ? owner.id : heroes[0].id);
  const st0 = { to: pick0, ft: grants.find((g) => g.to === pick0)?.ft || (st.darkvision > 0 ? clampFt(st.darkvision) : 30) };
  const kind = st.monster?.name && st.monster.name !== name ? st.monster.name : '';
  const sub = [name, kind, owner ? `хозяин — ${owner.name}` : ''].filter(Boolean).join(' · ');
  const hint = st.darkvision > 0
    ? `В листе у ${q(name)} тёмное зрение ${st.darkvision} фт. Круг на карте меняется вместе с выбором.`
    : `В листе у ${q(name)} нет тёмного зрения — в темноте дальность решаете вы. Круг на карте меняется вместе с выбором.`;

  const heroBtn = (h) => `<button class="sight-hero" data-to="${esc(h.id)}" role="radio">${srcOf(h.portrait) ? `<span class="avatar sm hero"><img src="${esc(srcOf(h.portrait))}" alt=""></span>` : `<span class="avatar sm hero"></span>`}<span>${esc(h.name)}</span>${owner?.id === h.id ? '<span class="tag">хозяин</span>' : ''}</button>`;
  const seg = (v, label) => `<button data-ft="${v}" role="radio">${label}</button>`;
  const pop = popover(`<div class="sight-pop">
    <div class="panel-header"><div class="titles"><div class="title">Дать зрение игроку</div><div class="subtitle">${esc(sub)}</div></div><button class="icon-btn icon-btn-sm" data-close aria-label="Закрыть">${icon('cancel-01', 18)}</button></div>
    <div class="panel-section"><div class="label">Кому</div><div class="sight-who" role="radiogroup" aria-label="Кому">${heroes.map(heroBtn).join('')}</div></div>
    <div class="panel-section"><div class="label">Как далеко видит, фт</div>
      <div class="sight-seg" role="radiogroup" aria-label="Дальность">${SIGHT_STEPS.map((v) => seg(v, v)).join('')}${seg('own', 'Своё')}</div>
      <label class="sight-own" hidden><span class="input"><input type="number" min="5" max="${SIGHT_MAX}" step="5" inputmode="numeric" data-own aria-label="Своя дальность, фт"></span><span class="muted">фт</span></label>
      <p class="t-sm muted">${esc(hint)}</p>
      ${t.hidden ? `<p class="t-sm muted">${icon('view-off', 14)} Существо скрыто от игроков — глаза откроются, когда вы его покажете.</p>` : ''}</div>
    <hr class="panel-divider">
    <div class="sight-note">${icon('view', 18)}<span data-note></span></div>
    <div class="panel-footer"><span class="spacer"></span><button class="btn btn-sm btn-ghost" data-take hidden>Забрать</button><button class="btn btn-sm btn-ghost" data-close>Отмена</button><button class="btn btn-sm btn-primary" data-give>${icon('view', 14)}<span data-give-label>Дать зрение</span></button></div>
  </div>`, anchor, { placement: 'right', className: 'sight-popover', onClose: () => { if (ctx.ui.sightPreview?.id === id) { ctx.ui.sightPreview = null; ctx.invalidate('areas'); } } });

  const n = pop.node;
  const own = n.querySelector('[data-own]');
  const sync = () => {
    const custom = !SIGHT_STEPS.includes(st0.ft);
    for (const b of n.querySelectorAll('[data-to]')) { const on = b.dataset.to === st0.to; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }
    for (const b of n.querySelectorAll('[data-ft]')) { const on = b.dataset.ft === 'own' ? custom : Number(b.dataset.ft) === st0.ft; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }
    n.querySelector('.sight-own').hidden = !custom && !n.querySelector('.sight-own').dataset.open;
    if (document.activeElement !== own) own.value = st0.ft;
    const hero = characterOf(ctx.c, st0.to);
    n.querySelector('[data-note]').textContent = `Зрение сложится: ${hero?.name || 'герой'} видит и своими глазами, и глазами ${q(name)}`;
    const had = grants.some((g) => g.to === st0.to);
    n.querySelector('[data-take]').hidden = !had;
    n.querySelector('[data-give-label]').textContent = had ? 'Обновить' : 'Дать зрение';
    ctx.ui.sightPreview = { id, ft: st0.ft };
    ctx.invalidate('areas');
  };
  n.addEventListener('click', (e) => {
    const who = e.target.closest('[data-to]');
    if (who) { st0.to = who.dataset.to; const g = grants.find((x) => x.to === st0.to); if (g) st0.ft = g.ft; sync(); return; }
    const f = e.target.closest('[data-ft]');
    if (f) {
      const box = n.querySelector('.sight-own');
      if (f.dataset.ft === 'own') { box.dataset.open = '1'; box.hidden = false; own.focus(); own.select(); } else { delete box.dataset.open; st0.ft = Number(f.dataset.ft); }
      sync(); return;
    }
    if (e.target.closest('[data-take]')) { const hero = characterOf(ctx.c, st0.to); closePopover(); if (takeSight(ctx, id, st0.to)) ctx.toast({ title: `Зрение забрано · ${hero?.name || 'герой'}`, icon: 'view-off' }); return; }
    if (e.target.closest('[data-give]')) give();
  });
  own.addEventListener('input', () => { const v = Number(own.value); if (Number.isFinite(v) && v > 0) { st0.ft = clampFt(v); sync(); } });
  own.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') give(); if (e.key === 'Escape') closePopover(); });
  const give = () => {
    const to = st0.to, ft = st0.ft, hero = characterOf(ctx.c, to);
    closePopover();
    if (!giveSight(ctx, id, to, ft)) return;
    ctx.toast({
      title: `${hero?.name || 'Герой'} видит и глазами ${q(name)}`,
      body: t.hidden ? 'Глаза откроются, когда вы покажете существо игрокам' : `${ft} фт вокруг — вместе со своим зрением`,
      icon: 'view',
      action: { label: 'Забрать', onClick: () => takeSight(ctx, id, to) },
    });
  };
  sync();
}

// ——— Кольца на карте (39·3 у мастера, край обзора 39·4 у игрока) ———
/** Кольца для слоя аур: [{t, r, label, cls}]. */
export function sightRings(ctx) {
  const sc = ctx.scene; if (!sc) return [];
  const out = [];
  const pv = ctx.isMasterView ? ctx.ui.sightPreview : null;
  if (ctx.isMasterView) {
    for (const t of sc.tokens) {
      if (!t.sight || !canGiveSight(t) || pv?.id === t.id) continue;
      for (const g of grantsOf(t)) {
        const who = characterOf(ctx.c, g.to)?.name || 'герой';
        const shut = sightBlocked(ctx.c, t);
        out.push({ t, r: sightRadius(sc, t, g.ft), label: `глаза · ${who} · ${g.ft} фт${shut ? ' · закрыты' : ''}`, cls: shut ? 'off' : '' });
      }
    }
    if (pv) { const t = sc.tokens.find((x) => x.id === pv.id); if (t) out.push({ t, r: sightRadius(sc, t, pv.ft), label: `${pv.ft} фт`, cls: 'preview' }); }
    return out;
  }
  for (const g of activeSight(ctx.c, sc, ctx.sightTo(), ctx.isMaster ? null : ctx.ui.sightOff)) {
    if (!ctx.tokenShown(g.t)) continue;
    out.push({ t: g.t, r: sightRadius(sc, g.t, g.ft), label: '', cls: 'edge' });
  }
  return out;
}

// ——— Игрок: свои глаза, плашка, виджет, тосты ———
/** Глаза, выданные моему герою на этой сцене: [{t, ft, blocked, off}]. */
export function mySight(ctx) {
  const me = ctx.myCharacterId, sc = ctx.scene;
  if (!me || !sc || ctx.isMaster) return [];
  const out = [];
  for (const t of sc.tokens) {
    if (!t.sight || !canGiveSight(t)) continue;
    const g = grantsOf(t).find((x) => x.to === me);
    if (g) out.push({ t, ft: g.ft, blocked: sightBlocked(ctx.c, t), off: !!ctx.ui.sightOff?.has(t.id) });
  }
  return out;
}

/** Плашка сверху (39·4): «Плюс глаза …» с «Отключить». Пусто — плашки нет. */
export function sightBanner(ctx, banner) {
  const on = mySight(ctx).filter((s) => !s.blocked && !s.off);
  if (!on.length) return '';
  const names = on.map((s) => ctx.nameOf(s.t)).join(', ');
  const sub = on.length === 1 ? `${on[0].ft} фт вокруг ${q(ctx.nameOf(on[0].t))} — вместе с вашим зрением` : 'Вместе с вашим зрением';
  return banner('view', `Плюс глаза: ${names}`, sub, `<button class="btn btn-sm btn-primary" data-act="sight-off">${icon('cancel-01', 14)}Отключить</button>`, 'sight');
}

/** Строки в виджете «Зрение» у игрока: «Своё + глаза …» и включатель. */
export function sightWidgetRows(ctx) {
  return mySight(ctx).map((s) => {
    const name = ctx.nameOf(s.t);
    const state = s.blocked ? 'сейчас закрыты' : s.off ? 'отключены у вас' : 'вместе с вашим зрением';
    return `<div class="setting-row">${icon('view', 20)}<span class="titles"><span class="label-main">Своё + глаза ${esc(q(name))}</span><span class="hint">${s.ft} фт вокруг · ${state}</span></span>${s.blocked ? '' : `<button class="btn btn-sm ${s.off ? 'btn-secondary' : 'btn-ghost'}" data-act="sight-toggle" data-id="${esc(s.t.id)}">${s.off ? 'Включить' : 'Отключить'}</button>`}</div>`;
  }).join('');
}

/** Подпись героя в виджете мастера: «Своё + глаза …» — или ''. */
export function heroSightNote(ctx, characterId) {
  const names = [];
  for (const t of ctx.scene?.tokens || []) if (t.sight && canGiveSight(t) && grantsOf(t).some((g) => g.to === characterId)) names.push(ctx.nameOf(t));
  return names.length ? `Своё + глаза ${names.map(q).join(', ')}` : '';
}

/** Игрок отключает или включает глаза у себя; мастеру — тост с «Забрать». */
export function setSightOff(ctx, ids, off) {
  ctx.ui.sightOff ||= new Set();
  for (const id of ids) {
    if (off) {
      if (ctx.ui.sightOff.has(id)) continue;
      ctx.ui.sightOff.add(id);
      bus.send('sight-off', { cid: ctx.cid, sceneId: ctx.sceneId, tokenId: id, to: ctx.myCharacterId, userId: ctx.userId });
    } else ctx.ui.sightOff.delete(id);
  }
  ctx.invalidateVision();
  ctx.invalidate('fog', 'tokens', 'areas', 'chrome');
  ctx.panels?.refreshWidget?.();
}

/** Мастер: игрок отключил у себя глаза существа. */
export function onSightOff(ctx, p) {
  if (!ctx.isMaster || p.cid !== ctx.cid) return;
  const t = ctx.c.scenes.find((s) => s.id === p.sceneId)?.tokens.find((x) => x.id === p.tokenId);
  if (!t) return;
  const hero = characterOf(ctx.c, p.to);
  ctx.toast({
    title: `Глаза ${q(ctx.nameOf(t))} отключены`,
    body: `${hero?.name || 'Игрок'} отключает их у себя — можно забрать`,
    icon: 'view-off',
    action: { label: 'Забрать', onClick: () => { if (p.sceneId === ctx.sceneId) takeSight(ctx, t.id, p.to); } },
  });
}

/**
 * Тосты игроку при смене глаз (39·4): дали, забрали, существо погибло или исчезло с карты.
 * Первый проход на сцене только запоминает состояние. Возвращает true, если свои глаза изменились
 * (тогда стол перерисовывает плашку и виджет).
 */
export function trackSight(ctx) {
  if (ctx.isMaster || !ctx.scene) { const had = !!ctx.ui.sightSeen; ctx.ui.sightSeen = null; return had; }
  const now = new Map(mySight(ctx).map((s) => [s.t.id, { name: ctx.nameOf(s.t), ft: s.ft, blocked: s.blocked }]));
  for (const id of [...(ctx.ui.sightOff || [])]) if (!now.has(id)) ctx.ui.sightOff.delete(id);
  const sig = [...now].map(([id, n]) => `${id}:${n.name}:${n.ft}:${n.blocked || ''}:${ctx.ui.sightOff?.has(id) ? 1 : 0}`).join('|');
  const prev = ctx.ui.sightSeen;
  ctx.ui.sightSeen = { sceneId: ctx.sceneId, map: now, sig };
  if (!prev || prev.sceneId !== ctx.sceneId) return !!prev || !!sig;
  if (prev.sig === sig) return false;
  const say = (title, body) => ctx.toast({ title, body, icon: 'view-off' });
  for (const [id, p] of prev.map) {
    const n = now.get(id);
    if (!n) {
      if (p.blocked) continue;
      if (ctx.scene.tokens.some((x) => x.id === id && !x.hidden)) say(`Мастер забрал глаза ${q(p.name)}`, 'Снова видите только своими глазами');
      else say(`${q(p.name)} больше не на карте`, 'Глаза закрылись');
      continue;
    }
    if (!p.blocked && n.blocked) say(n.blocked === 'dead' ? `${q(n.name)} погибает` : n.blocked === 'down' ? `${q(n.name)} без сознания` : `${q(n.name)} больше не видно`, 'Глаза закрылись');
    else if (p.blocked && !n.blocked) ctx.toast({ title: `Глаза ${q(n.name)} снова открыты`, body: `${n.ft} фт вокруг — вместе с вашим зрением`, icon: 'view' });
  }
  for (const [id, n] of now) if (!prev.map.has(id) && !n.blocked) ctx.toast({ title: `Мастер дал вам глаза ${q(n.name)}`, body: `${n.ft} фт вокруг — вместе с вашим зрением`, icon: 'view' });
  return true;
}
