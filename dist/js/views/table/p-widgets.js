// Виджеты слева сверху: зрение и свет, отряд, инициатива, кубы.
import { esc, fmtMod, plural } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { srcOf } from '../../core/assets.js';
import { onlineUsers } from '../../core/store.js';
import { characterOf, ownerOfCharacter, tokenStats, myCharacter } from '../../core/campaign.js';
import { LIGHTS, conditionById, woundLabel } from '../../data/rules.js';
import { heroAc } from '../../rules/hero-derived.js';
import { diceWidget } from './dice.js';
import { visionFields } from './p-token.js';
import { currentEntry, combatRound, tiedMoves } from './combat.js';
import { sightWidgetRows, heroSightNote } from './sight-ui.js';
import { groupKind, isSummonKind, planPacks, baseName } from './packs.js';

const close = `<button class="icon-btn icon-btn-sm" data-act="w-close" aria-label="Закрыть">${icon('cancel-01', 18)}</button>`;
const head = (title, sub) => `<div class="panel-header"><div class="titles"><div class="title">${esc(title)}</div>${sub ? `<div class="subtitle">${esc(sub)}</div>` : ''}</div>${close}</div>`;
const avatarImg = (ref, cls = '', status = null) => `<span class="avatar sm ${cls}">${srcOf(ref) ? `<img src="${esc(srcOf(ref))}" alt="">` : ''}${status === null ? '' : `<span class="status ${status ? 'online' : ''}"></span>`}</span>`;

export function widgetHTML(ctx) {
  const w = ctx.ui.widget;
  if (!w || !ctx.c) return '';
  if (w === 'dice') return diceWidget(ctx);
  if (!ctx.scene && w !== 'party') return '';
  if (w === 'vision') return ctx.isMaster ? visionMaster(ctx) : visionPlayer(ctx);
  if (w === 'party') return party(ctx);
  if (w === 'initiative') return initiative(ctx);
  return '';
}

function fogSelect(mode) {
  return `<label class="tb-select"><select data-select="fogMode" aria-label="Туман войны"><option value="vision" ${mode === 'vision' ? 'selected' : ''}>Обзор героев</option><option value="manual" ${mode === 'manual' ? 'selected' : ''}>Вручную</option><option value="off" ${mode === 'off' ? 'selected' : ''}>Без тумана</option></select></label>`;
}

function lightName(l) {
  if (!l) return '';
  const p = LIGHTS.find((x) => x.id === l.preset);
  return `${p?.name || 'Свет'} ${l.bright}+${l.dim} фт`;
}

function visionMaster(ctx) {
  const sc = ctx.scene, c = ctx.c;
  const heroes = sc.tokens.filter((t) => t.kind === 'hero' && t.characterId);
  const dark = sc.lighting === 'dark';
  return `<div class="widget panel vision-widget">${head('Зрение и свет', sc.name)}
    <div class="panel-section">
      <div class="setting-row">${icon('moon-02', 20)}<span class="titles"><span class="label-main">Темнота</span><span class="hint">${dark ? 'Видно только освещённое и в тёмном зрении' : 'Сцена освещена целиком'}</span></span><input type="checkbox" class="switch" data-act="toggle-dark" ${dark ? 'checked' : ''} aria-label="Темнота"></div>
      <div class="setting-row">${icon('cloud', 20)}<span class="titles"><span class="label-main">Туман войны</span><span class="hint">${sc.fog.mode === 'vision' ? 'Открывается взглядом героев' : sc.fog.mode === 'manual' ? 'Открываете кистью вы' : 'Игроки видят всю карту'}</span></span>${fogSelect(sc.fog.mode)}</div>
      <div class="setting-row">${icon('user-group', 20)}<span class="titles"><span class="label-main">Общий обзор</span><span class="hint">Каждый видит то, что видит отряд</span></span><input type="checkbox" class="switch" data-act="toggle-shared" ${c.settings.sharedVision ? 'checked' : ''} aria-label="Общий обзор"></div>
    </div>
    <hr class="panel-divider">
    <div class="panel-section"><div class="label">Смотреть глазами героя</div>
      <div class="w-list">${heroes.map((t) => {
        const st = tokenStats(c, t);
        const on = ctx.ui.viewAs === t.characterId;
        // TASK-046: рядом с «смотреть глазами» — настройка света и тёмного зрения героя.
        const open = ctx.ui.visionEdit === t.id;
        const eyes = heroSightNote(ctx, t.characterId); // #190 C: «Своё + глаза …»
        return `<div class="vision-hero ${open ? 'open' : ''}"><div class="vh-row"><button class="list-row grow ${on ? 'current' : ''}" data-act="viewas" data-id="${esc(t.characterId)}">${avatarImg(t.img, 'hero')}<span class="grow col-tight"><span class="primary">${esc(st.name)}</span><span class="secondary">${st.darkvision ? `тёмное зрение ${st.darkvision} фт` : 'без тёмного зрения'}${t.light ? ` · ${esc(lightName(t.light))}` : ''}</span>${eyes ? `<span class="secondary sight-note-line">${icon('view', 12)}${esc(eyes)}</span>` : ''}</span>${on ? '<span class="chip chip-accent">сейчас</span>' : icon('view', 18)}</button><button class="icon-btn icon-btn-sm ${open ? 'active' : ''}" data-act="vision-edit" data-id="${esc(t.id)}" data-tip="Свет и тёмное зрение" aria-label="Свет и тёмное зрение ${esc(st.name)}" aria-expanded="${open}">${icon('settings-01', 18)}</button></div>${open ? visionFields(ctx, t) : ''}</div>`;
      }).join('') || '<p class="t-sm muted">На сцене нет героев</p>'}</div>
      <button class="btn btn-secondary btn-block" data-act="preview-players">${icon('view-off', 16)}Как видят игроки</button>
    </div>
    ${sc.fog.mode !== 'off' ? `<div class="panel-footer"><button class="btn btn-sm btn-secondary grow" data-act="fog-reveal-all">${icon('view', 14)}Открыть всю карту</button><button class="btn btn-sm btn-ghost grow" data-act="fog-hide-all">${icon('refresh', 14)}Сбросить туман</button></div>` : ''}</div>`;
}

function visionPlayer(ctx) {
  const sc = ctx.scene, c = ctx.c;
  const ch = myCharacter(c, ctx.userId);
  const tok = sc.tokens.find((t) => ctx.isMine(t));
  const st = tok ? tokenStats(c, tok) : null;
  const light = tok?.light || ch?.light;
  const dark = sc.lighting === 'dark';
  return `<div class="widget panel vision-widget">${head('Зрение', ch?.name || '')}
    <div class="panel-section">
      ${tok ? visionFields(ctx, tok) : `<div class="setting-row">${icon('eye', 20)}<span class="titles"><span class="label-main">Тёмное зрение</span><span class="hint">${ch?.darkvision ? `${ch.darkvision} фт` : 'Нет'} · героя нет на этой сцене</span></span></div>`}
      ${sightWidgetRows(ctx)}
      <div class="setting-row">${icon(dark ? 'moon-02' : 'sun-01', 20)}<span class="titles"><span class="label-main">${dark ? 'Здесь темно' : 'Здесь светло'}</span><span class="hint">${c.settings.sharedVision ? 'Вы видите то же, что и весь отряд' : 'Вы видите только глазами своего героя'}</span></span></div>
    </div>
    ${dark ? `<hr class="panel-divider"><div class="panel-section"><div class="label">Что видит ${esc(ch?.name || 'герой')}</div><p class="t-sm muted"><span class="legend lit"></span>Свет — всё как есть</p>${st?.darkvision ? `<p class="t-sm muted"><span class="legend dv"></span>Тёмное зрение — видно как при свете, до ${st.darkvision} фт</p>` : ''}<p class="t-sm muted"><span class="legend fog-dark"></span>Темнота — не видно</p></div>` : ''}
    ${sc.fog.mode !== 'off' || dark ? `<hr class="panel-divider"><div class="panel-section"><p class="t-sm muted"><span class="legend fog-dark"></span>Чёрное — то, чего отряд сейчас не видит. Уже найденные двери и метки остаются на карте.</p></div>` : ''}
  </div>`;
}

function party(ctx) {
  const c = ctx.c, sc = ctx.scene;
  const online = onlineUsers(ctx.cid);
  const chars = c.characters.filter((ch) => c.members.some((m) => m.characterId === ch.id && m.status === 'active') || sc?.tokens.some((t) => t.characterId === ch.id));
  const onCount = chars.filter((ch) => { const o = ownerOfCharacter(c, ch); return o && online.has(o.id); }).length;
  const pending = c.members.filter((m) => m.status === 'pending').length;
  const rows = chars.map((ch) => {
    const owner = ownerOfCharacter(c, ch);
    const on = owner ? online.has(owner.id) : null;
    const tok = sc?.tokens.find((t) => t.characterId === ch.id);
    const frac = Math.max(0, Math.min(1, Number(ch.hp) / Math.max(1, Number(ch.hpMax)))) || 0;
    const conds = (ch.conditions || []).map((id) => conditionById(id)).filter(Boolean);
    const mine = ch.id === ctx.myCharacterId;
    return `<button class="list-row party-row ${mine ? 'mine' : ''}" data-act="party-focus" data-id="${esc(ch.id)}">${avatarImg(ch.portrait, `hero ${mine ? 'mine' : ''}`, on)}
      <span class="grow col-tight"><span class="row-tight"><span class="primary ellipsis">${esc(ch.name)}</span>${conds.slice(0, 3).map((x) => `<span class="mini-cond" title="${esc(x.name)}">${icon(x.icon, 12)}</span>`).join('')}</span>
      <span class="secondary ellipsis">${esc(ch.className)} ${esc(ch.level)} · ${owner ? esc(owner.name) + (on ? '' : ' · не в сети') : 'без игрока'}${tok ? '' : ' · не на сцене'}</span>
      <span class="hp-line"><span class="hp-bar ${frac > 0.5 ? 'ok' : ''}"><i style="width:${frac * 100}%"></i></span><b class="${ch.hp <= 0 ? 'negative' : ''}">${esc(ch.hp)}/${esc(ch.hpMax)}</b></span></span>
      <span class="chip">КД ${esc(heroAc(ch))}</span></button>`;
  }).join('');
  return `<div class="widget panel party-widget">${head('Отряд', `${chars.length} ${plural(chars.length, 'герой', 'героя', 'героев')} · ${onCount} в сети`)}
    <div class="w-list scroll">${rows || '<p class="t-sm muted" style="padding:0 16px 12px">Пока никого — пригласите игроков</p>'}</div>
    ${ctx.isMaster ? `<div class="panel-footer party-foot">${c.invite?.code ? `<span class="col-tight grow"><small class="t-xs tertiary">Код комнаты</small><b class="mono">${esc(c.invite.code)}</b></span><button class="icon-btn icon-btn-sm" data-act="copy-code" data-tip="Скопировать код" aria-label="Скопировать код">${icon('copy-01', 18)}</button>` : ''}<button class="btn btn-primary" data-act="invite">${icon('user-add-01', 16)}Пригласить${pending ? ` · ${pending}` : ''}</button></div>` : ''}
  </div>`;
}

function setupPanel(ctx) {
  const c = ctx.c, sc = ctx.scene, st = ctx.ui.setup;
  const toks = sc.tokens.filter((t) => t.kind !== 'item' && st.pool.includes(t.id));
  const n = toks.filter((t) => st.ids.has(t.id)).length;
  const row = (t) => {
    const s = tokenStats(c, t);
    const self = st.self && t.characterId && c.members.some((m) => m.characterId === t.characterId && m.status === 'active' && m.role === 'player');
    return `<label class="list-row setup-row ${st.ids.has(t.id) ? '' : 'off'}"><input type="checkbox" class="check-input" data-act="setup-toggle" data-id="${esc(t.id)}" ${st.ids.has(t.id) ? 'checked' : ''}>${avatarImg(t.img, t.kind)}<span class="grow col-tight"><span class="primary ellipsis">${esc(ctx.nameOf(t, s))}${t.hidden ? ` ${icon('view-off', 12)}` : ''}</span></span>${self ? '<span class="chip chip-accent">бросает игрок</span>' : `<span class="init-roll-hint" data-tip="Бросок при «Начать бой»">к20 ${fmtMod(s.initBonus || 0)}</span>`}</label>`;
  };
  // Одинаковые существа мастера (двое и больше) — одной строкой «Гоблин ×N» с выбором пачек (#198).
  const byKind = new Map();
  for (const t of toks) { const k = groupKind(t); if (k) { if (!byKind.has(k)) byKind.set(k, []); byKind.get(k).push(t); } }
  const done = new Set();
  const rows = toks.map((t) => {
    const k = groupKind(t), kin = k && byKind.get(k);
    if (!kin || kin.length < 2) return row(t);
    if (done.has(k)) return '';
    done.add(k);
    return kindRow(ctx, k, kin, row);
  }).join('');
  return `<div class="widget panel init-widget setup-widget">${head('Начать бой', `Кто участвует · ${n} из ${toks.length}`)}
    <div class="w-list scroll init-list">${rows}</div>
    <label class="setting-row compact"><span class="titles"><span class="label-main">Игроки бросают сами</span></span><input type="checkbox" class="switch" data-act="setup-self" ${st.self ? 'checked' : ''} aria-label="Игроки бросают сами"></label>
    <div class="panel-footer"><span class="spacer"></span><button class="btn btn-sm btn-ghost" data-act="setup-cancel">Отмена</button><button class="btn btn-sm btn-primary" data-act="setup-start" ${n ? '' : 'disabled'}>${icon('sword-03', 14)}Начать бой</button></div></div>`;
}

const PACK_MODES = [['auto', 'Пачками', 'По 10 и меньше, рядом стоящие вместе'], ['one', 'Одной', 'Все одной строкой'], ['each', 'По одному', 'Каждый ходит сам']];
/** Строка вида в подготовке боя: «Гоблин ×N», как он пойдёт в бой, выбор пачек, раскрытие по одному. */
function kindRow(ctx, k, kin, row) {
  const st = ctx.ui.setup;
  const on = kin.filter((t) => st.ids.has(t.id));
  const summon = isSummonKind(k);
  const mode = st.mode[k] || (summon ? 'one' : 'auto');
  const sizes = planPacks(on, mode).map((p) => p.length);
  const packs = sizes.filter((x) => x > 1);
  const split = mode !== 'each' && on.some((t) => t.hidden) && on.some((t) => !t.hidden);
  const summary = !on.length ? 'не участвуют'
    : mode === 'each' || !packs.length ? 'каждый ходит отдельно'
    : `${packs.length === 1 ? (summon ? 'одна группа' : 'одна пачка') : `${packs.length} ${plural(packs.length, 'пачка', 'пачки', 'пачек')}`}: ${sizes.join(' + ')}${split ? ' · скрытые отдельно' : ''}`;
  const lead = kin[0], s = tokenStats(ctx.c, lead);
  const open = st.open.has(k);
  const by = summon ? ctx.scene.tokens.find((t) => t.id === lead.summonedBy) : null;
  const whose = summon ? ` · призыв: ${by ? ctx.nameOf(by) : 'игрок'}` : '';
  const selfRoll = summon && st.self && ctx.c.members.some((m) => m.userId === lead.ownerId && m.status === 'active' && m.role === 'player');
  return `<div class="setup-kind ${on.length ? '' : 'off'}">
    <div class="list-row setup-row"><input type="checkbox" class="check-input" data-act="setup-kind" data-kind="${esc(k)}" ${on.length ? 'checked' : ''} aria-label="${esc(baseName(s.name))}: ${on.length === kin.length ? 'убрать всех' : 'все в бой'}">${avatarImg(lead.img, lead.kind)}<span class="grow col-tight"><span class="primary ellipsis">${esc(baseName(ctx.nameOf(lead, s)))} ×${kin.length}${esc(whose)}</span><span class="secondary ellipsis">${on.length && on.length < kin.length ? `в бою ${on.length} · ` : ''}${esc(summary)}</span></span>${selfRoll && mode !== 'each' ? '<span class="chip chip-accent">бросает игрок</span>' : `<span class="init-roll-hint" data-tip="Бросок на пачку при «Начать бой»">к20 ${fmtMod(s.initBonus || 0)}</span>`}<button class="icon-btn icon-btn-xs" data-act="setup-kind-open" data-kind="${esc(k)}" aria-expanded="${open}" data-tip="${open ? 'Свернуть' : 'Выбрать по одному'}" aria-label="${open ? 'Свернуть' : 'Выбрать по одному'}">${icon(open ? 'arrow-up-01' : 'arrow-down-01', 14)}</button></div>
    <div class="setup-modes" role="radiogroup" aria-label="Как ходят">${PACK_MODES.map(([v, l, tip]) => `<button class="chip chip-md ${mode === v ? 'chip-accent' : ''}" data-act="setup-mode" data-kind="${esc(k)}" data-mode="${v}" role="radio" aria-checked="${mode === v}" data-tip="${tip}">${l}</button>`).join('')}</div>
    ${open ? `<div class="setup-members">${kin.map(row).join('')}</div>` : ''}
  </div>`;
}

function initiative(ctx) {
  const c = ctx.c, sc = ctx.scene, cb = c.combat;
  if (!cb.active && ctx.isMaster && ctx.ui.setup) return setupPanel(ctx);
  if (!cb.active) {
    return `<div class="widget panel init-widget">${head('Инициатива', 'Бой не идёт')}
      <div class="panel-section">${ctx.isMaster
        ? `<p class="t-sm muted">Выделите участников на карте или начните бой со всеми, кто виден на сцене.</p><button class="btn btn-primary btn-block" data-act="combat-start">${icon('sword-03', 16)}Начать бой</button>`
        : '<p class="t-sm muted">Мастер начнёт бой, когда враги нападут. Порядок ходов появится здесь.</p>'}</div></div>`;
  }
  const order = ctx.combatOrder();
  const cur = currentEntry(c, sc);
  // Очередь слотами (#198): пачка, у которой зрителю видно двоих и больше, — одной строкой; остальное — как прежде.
  const shown = order.filter((e) => ctx.isMasterView || ctx.tokenShown(e.token));
  const slots = [];
  for (const e of shown) { const last = slots.at(-1); if (last && last.key === e.slot) last.ms.push(e); else slots.push({ key: e.slot, ms: [e] }); }
  const marks = ctx.packMarks();
  const rows = slots.map((s) => (s.ms.length > 1 && s.ms[0].group ? packRow(ctx, s, cur, marks, order) : s.ms.map((e) => entryRow(ctx, e, cur, order)).join(''))).join('');
  const myTurn = cur && (ctx.isMine(cur.token) || ctx.owns(cur.token)); // свой герой или своя группа призывов (#198)
  const curPack = cur && slots.find((s) => s.key === cur.slot && s.ms.length > 1 && s.ms[0].group);
  const curName = curPack ? packTitle(ctx, curPack.ms, marks) : cur ? ctx.nameOf(cur.token, cur.stats) : '';
  return `<div class="widget panel init-widget">${head(`Бой · раунд ${combatRound(c, sc)}`, cur ? `Ходит ${curName}` : '')}
    <div class="w-list scroll init-list">${rows}</div>
    <div class="panel-footer">${ctx.isMaster
      ? `<button class="icon-btn icon-btn-sm" data-act="combat-prev" data-tip="Предыдущий ход">${icon('arrow-left-01', 18)}</button><button class="btn btn-primary grow" data-act="combat-next">Следующий ход${icon('arrow-right-01', 16)}</button><button class="icon-btn icon-btn-sm" data-act="combat-end" data-tip="Закончить бой">${icon('stop-circle', 18)}</button>`
      : myTurn ? `<button class="btn btn-primary btn-block" data-act="end-turn">${icon('tick-02', 16)}Закончить ход</button>`
      : cur && ctx.playsFor(cur.token) ? `<span class="t-sm muted grow">Ходит ${esc(curName)}</span><button class="btn btn-sm btn-ghost" data-act="end-turn" data-tip="Если ${esc(curName)} не за столом — закончите ход за него">${icon('tick-02', 14)}Закончить за него</button>`
      : `<span class="t-sm muted">${cur ? `Ждём, пока ходит ${esc(curName)}` : ''}</span>`}</div>
  </div>`;
}

/** Строка одиночки в очереди. */
/** Стрелки мастера для ничьей по инициативе (#197 S1): только у равных соседей. */
function tieButtons(ctx, order, slot, id) {
  if (!ctx.isMaster) return '';
  const m = tiedMoves(order, slot);
  if (!m.up && !m.down) return '';
  return `<span class="init-tie">${m.up ? `<button class="icon-btn icon-btn-xs" data-act="init-tie-up" data-id="${esc(id)}" data-tip="Выше при равной инициативе" aria-label="Выше при равной инициативе">${icon('arrow-up-01', 12)}</button>` : ''}${m.down ? `<button class="icon-btn icon-btn-xs" data-act="init-tie-down" data-id="${esc(id)}" data-tip="Ниже при равной инициативе" aria-label="Ниже при равной инициативе">${icon('arrow-down-01', 12)}</button>` : ''}</span>`;
}

function entryRow(ctx, e, cur, order = []) {
  const c = ctx.c, t = e.token, st = e.stats;
  const isCur = !!cur && cur.slot === e.slot;
  const mine = ctx.isMine(t);
  const showExact = ctx.isMasterView || t.kind === 'hero' || !!t.ownerId || !!t.summonedBy || c.settings.playersSeeHp === 'exact';
  const hp = st.hpMax ? (showExact ? `${st.hp}/${st.hpMax}` : woundLabel(st.hp, st.hpMax)) : '';
  const down = st.hpMax > 0 && st.hp <= 0;
  const initCell = ctx.isMaster
    ? `<button class="init-num ${e.init == null ? 'pending' : ''}" data-act="init-set" data-id="${esc(e.tokenId)}" data-tip="Изменить инициативу">${esc(e.init ?? '?')}</button>`
    : `<span class="init-num ${e.init == null ? 'pending' : ''}">${esc(e.init ?? '?')}</span>`;
  return `<div class="init-row ${isCur ? 'current' : ''} ${t.hidden ? 'is-hidden' : ''} ${down ? 'downed' : ''} ${t.kind}">
      ${initCell}<button class="init-who" data-act="init-focus" data-id="${esc(e.tokenId)}">${avatarImg(t.img, `${t.kind} ${mine ? 'mine' : ''}`)}<span class="grow col-tight"><span class="primary ellipsis">${esc(ctx.nameOf(t, st))}${t.hidden ? ` ${icon('view-off', 12)}` : ''}</span><span class="secondary ellipsis">${esc(hp)}${(st.conditions || []).length ? ` · ${st.conditions.map((x) => conditionById(x)?.name).filter(Boolean).join(', ')}` : ''}</span></span></button>
      ${mine && e.init == null ? `<button class="btn btn-sm btn-primary" data-act="init-roll" data-id="${esc(e.tokenId)}">${icon('dice-faces-06', 14)}Бросить</button>`
        : !ctx.isMaster && e.init == null && ctx.actsFor(t) ? `<button class="icon-btn icon-btn-xs" data-act="init-roll" data-id="${esc(e.tokenId)}" data-tip="Бросить за ${esc(ctx.nameOf(t, st))}" aria-label="Бросить инициативу за ${esc(ctx.nameOf(t, st))}">${icon('dice-faces-06', 14)}</button>` : ''}
      ${tieButtons(ctx, order, e.slot, e.tokenId)}${ctx.isMaster ? `<button class="icon-btn icon-btn-xs" data-act="init-remove" data-id="${esc(e.tokenId)}" data-tip="Убрать из боя">${icon('cancel-01', 14)}</button>` : ''}
    </div>`;
}

const fallen = (e) => e.stats.hpMax > 0 && e.stats.hp <= 0;
/** Имя пачки: у мастера «Гоблин · пачка 2», у игрока «Гоблин ×N» (N — видимые ему); скрытое имя — «Неизвестные существа». */
function packTitle(ctx, ms, marks) {
  const t = ms[0].token;
  const base = !ctx.isMasterView && t.nameHidden ? 'Неизвестные существа' : baseName(ctx.nameOf(t, ms[0].stats));
  return ctx.isMasterView ? `${base} · пачка ${marks.get(t.id)?.n ?? ''}` : `${base} ×${ms.length}`;
}

/** Строка пачки в очереди (#198): метка, кто в строю, раскрытие со списком, «Выделить пачку». */
function packRow(ctx, s, cur, marks, order = []) {
  const ms = s.ms, lead = ms[0], t = lead.token;
  const isCur = !!cur && cur.slot === s.key;
  const alive = ms.filter((e) => !fallen(e)).length;
  const mk = marks.get(t.id);
  const open = !!ctx.ui.packOpen?.has(s.key);
  const pend = lead.init == null ? 'pending' : '';
  const initCell = ctx.isMaster
    ? `<button class="init-num ${pend}" data-act="init-set" data-id="${esc(lead.tokenId)}" data-tip="Инициатива пачки">${esc(lead.init ?? '?')}</button>`
    : `<span class="init-num ${pend}">${esc(lead.init ?? '?')}</span>`;
  // Группа призывов игрока (#198 §4): один к20 владельца пишется во все записи группы.
  const roll = !ctx.isMaster && lead.init == null && ctx.actsFor(t) ? `<button class="btn btn-sm btn-primary" data-act="init-roll" data-id="${esc(lead.tokenId)}">${icon('dice-faces-06', 14)}Бросить</button>` : '';
  const members = open ? `<div class="pack-members">${ms.map((e) => {
    // Свои призывы игрок видит точно — как одиночек в очереди.
    const st = e.stats, showExact = ctx.isMasterView || !!e.token.ownerId || !!e.token.summonedBy || ctx.c.settings.playersSeeHp === 'exact';
    const hp = st.hpMax ? (showExact ? `${st.hp}/${st.hpMax}` : woundLabel(st.hp, st.hpMax)) : '';
    return `<div class="pack-member ${fallen(e) ? 'downed' : ''} ${e.token.hidden ? 'is-hidden' : ''}"><button class="init-who" data-act="init-focus" data-id="${esc(e.tokenId)}">${avatarImg(e.token.img, e.token.kind)}<span class="grow col-tight"><span class="primary ellipsis">${esc(ctx.nameOf(e.token, st))}${e.token.hidden ? ` ${icon('view-off', 12)}` : ''}</span><span class="secondary ellipsis">${esc(hp)}</span></span></button>${ctx.isMaster ? `<button class="icon-btn icon-btn-xs" data-act="pack-split" data-id="${esc(e.tokenId)}" data-tip="Отделить: свой ход с той же инициативой" aria-label="Отделить ${esc(ctx.nameOf(e.token, st))}">${icon('link-04', 14)}</button>` : ''}</div>`;
  }).join('')}</div>` : '';
  return `<div class="init-row pack ${isCur ? 'current' : ''} ${ms.every((e) => e.token.hidden) ? 'is-hidden' : ''} ${alive ? '' : 'downed'} foe">
      ${initCell}<button class="init-who" data-act="pack-open" data-slot="${esc(s.key)}" aria-expanded="${open}"><span class="pack-ava">${avatarImg(t.img, t.kind)}${mk ? `<b style="--pc:${mk.color}">${mk.n}</b>` : ''}</span><span class="grow col-tight"><span class="primary ellipsis">${esc(packTitle(ctx, ms, marks))}</span><span class="secondary ellipsis">${ctx.isMasterView ? `в строю ${alive} из ${ms.length}` : `в строю ${alive}`}</span></span>${icon(open ? 'arrow-up-01' : 'arrow-down-01', 14)}</button>
      ${roll}${tieButtons(ctx, order, s.key, lead.tokenId)}${ctx.isMaster ? `${isCur || open ? `<button class="icon-btn icon-btn-xs" data-act="pack-attack" data-id="${esc(lead.tokenId)}" data-tip="Атака толпой" aria-label="Атака толпой">${icon('sword-03', 14)}</button><button class="icon-btn icon-btn-xs" data-act="pack-select" data-id="${esc(lead.tokenId)}" data-tip="Выделить пачку" aria-label="Выделить пачку">${icon('cursor-rectangle-selection-01', 14)}</button>` : ''}<button class="icon-btn icon-btn-xs" data-act="pack-remove" data-id="${esc(lead.tokenId)}" data-tip="Убрать пачку из боя" aria-label="Убрать пачку из боя">${icon('cancel-01', 14)}</button>` : ''}
    </div>${members}`;
}

export { fmtMod, characterOf };
