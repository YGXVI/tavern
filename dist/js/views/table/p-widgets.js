// Виджеты слева сверху: зрение и свет, отряд, инициатива, кубы.
import { esc, fmtMod, plural } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { srcOf } from '../../core/assets.js';
import { onlineUsers } from '../../core/store.js';
import { characterOf, ownerOfCharacter, tokenStats, myCharacter } from '../../core/campaign.js';
import { LIGHTS, conditionById, woundLabel } from '../../data/rules.js';
import { diceWidget } from './dice.js';
import { currentEntry } from './combat.js';

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
        return `<button class="list-row ${on ? 'current' : ''}" data-act="viewas" data-id="${esc(t.characterId)}">${avatarImg(t.img, 'hero')}<span class="grow col-tight"><span class="primary">${esc(st.name)}</span><span class="secondary">${st.darkvision ? `тёмное зрение ${st.darkvision} фт` : 'без тёмного зрения'}${t.light ? ` · ${esc(lightName(t.light))}` : ''}</span></span>${on ? '<span class="chip chip-accent">сейчас</span>' : icon('view', 18)}</button>`;
      }).join('') || '<p class="t-sm muted">На сцене нет героев</p>'}</div>
      <button class="btn btn-secondary btn-block" data-act="preview-players">${icon('view-off', 16)}Как видят игроки</button>
    </div></div>`;
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
      <div class="setting-row">${icon('eye', 20)}<span class="titles"><span class="label-main">Тёмное зрение</span><span class="hint">${st?.darkvision ? `${st.darkvision} фт — в темноте как в сумерках, без цвета` : 'Нет — в темноте видно только освещённое'}</span></span></div>
      <div class="setting-row">${icon('fire', 20)}<span class="titles"><span class="label-main">${light ? esc(lightName(light)) : 'Без источника света'}</span><span class="hint">${light ? 'Светит и вам, и отряду' : 'Зажгите факел, если в темноте ничего не видно'}</span></span><input type="checkbox" class="switch" data-act="my-light" ${light ? 'checked' : ''} ${tok ? '' : 'disabled'} aria-label="Факел"></div>
      <div class="setting-row">${icon(dark ? 'moon-02' : 'sun-01', 20)}<span class="titles"><span class="label-main">${dark ? 'Здесь темно' : 'Здесь светло'}</span><span class="hint">${c.settings.sharedVision ? 'Вы видите то же, что и весь отряд' : 'Вы видите только глазами своего героя'}</span></span></div>
    </div>
    ${sc.fog.mode !== 'off' || dark ? `<hr class="panel-divider"><div class="panel-section"><p class="t-sm muted"><span class="legend fog-seen"></span>Серое — где вы уже были: карту помните, а кто там сейчас, не видно.</p><p class="t-sm muted"><span class="legend fog-dark"></span>Чёрное — ещё не исследовано.</p></div>` : ''}
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
    const frac = Math.max(0, Math.min(1, ch.hp / Math.max(1, ch.hpMax)));
    const conds = (ch.conditions || []).map((id) => conditionById(id)).filter(Boolean);
    const mine = ch.id === ctx.myCharacterId;
    return `<button class="list-row party-row ${mine ? 'mine' : ''}" data-act="party-focus" data-id="${esc(ch.id)}">${avatarImg(ch.portrait, `hero ${mine ? 'mine' : ''}`, on)}
      <span class="grow col-tight"><span class="row-tight"><span class="primary ellipsis">${esc(ch.name)}</span>${conds.slice(0, 3).map((x) => `<span class="mini-cond" title="${esc(x.name)}">${icon(x.icon, 12)}</span>`).join('')}</span>
      <span class="secondary ellipsis">${esc(ch.className)} ${ch.level} · ${owner ? esc(owner.name) + (on ? '' : ' · не в сети') : 'без игрока'}${tok ? '' : ' · не на сцене'}</span>
      <span class="hp-line"><span class="hp-bar ${frac > 0.5 ? 'ok' : ''}"><i style="width:${frac * 100}%"></i></span><b class="${ch.hp <= 0 ? 'negative' : ''}">${ch.hp}/${ch.hpMax}</b></span></span>
      <span class="chip">КД ${ch.ac}</span></button>`;
  }).join('');
  return `<div class="widget panel party-widget">${head('Отряд', `${chars.length} ${plural(chars.length, 'герой', 'героя', 'героев')} · ${onCount} в сети`)}
    <div class="w-list scroll">${rows || '<p class="t-sm muted" style="padding:0 16px 12px">Пока никого — пригласите игроков</p>'}</div>
    ${ctx.isMaster ? `<div class="panel-footer"><button class="btn btn-secondary btn-block" data-act="invite">${icon('user-add-01', 16)}Пригласить${pending ? ` · заявки: ${pending}` : ''}</button></div>` : ''}
  </div>`;
}

function initiative(ctx) {
  const c = ctx.c, sc = ctx.scene, cb = c.combat;
  if (!cb.active) {
    return `<div class="widget panel init-widget">${head('Инициатива', 'Бой не идёт')}
      <div class="panel-section">${ctx.isMaster
        ? `<p class="t-sm muted">Выделите участников на карте или начните бой со всеми, кто виден на сцене.</p><button class="btn btn-primary btn-block" data-act="combat-start">${icon('sword-03', 16)}Начать бой</button>`
        : '<p class="t-sm muted">Мастер начнёт бой, когда враги нападут. Порядок ходов появится здесь.</p>'}</div></div>`;
  }
  const order = ctx.combatOrder();
  const cur = currentEntry(c, sc);
  const rows = order.filter((e) => ctx.isMasterView || ctx.tokenShown(e.token)).map((e) => {
    const t = e.token, st = e.stats;
    const isCur = cur?.tokenId === e.tokenId;
    const mine = ctx.isMine(t);
    const showExact = ctx.isMasterView || t.kind === 'hero' || c.settings.playersSeeHp === 'exact';
    const hp = st.hpMax ? (showExact ? `${st.hp}/${st.hpMax}` : woundLabel(st.hp, st.hpMax)) : '';
    const down = st.hpMax > 0 && st.hp <= 0;
    const initCell = ctx.isMaster
      ? `<button class="init-num ${e.init == null ? 'pending' : ''}" data-act="init-set" data-id="${esc(e.tokenId)}" data-tip="Изменить инициативу">${e.init ?? '?'}</button>`
      : `<span class="init-num ${e.init == null ? 'pending' : ''}">${e.init ?? '?'}</span>`;
    return `<div class="init-row ${isCur ? 'current' : ''} ${t.hidden ? 'is-hidden' : ''} ${down ? 'downed' : ''} ${t.kind}">
      ${initCell}<button class="init-who" data-act="init-focus" data-id="${esc(e.tokenId)}">${avatarImg(t.img, `${t.kind} ${mine ? 'mine' : ''}`)}<span class="grow col-tight"><span class="primary ellipsis">${esc(st.name)}${t.hidden ? ` ${icon('view-off', 12)}` : ''}</span><span class="secondary ellipsis">${esc(hp)}${(st.conditions || []).length ? ` · ${st.conditions.map((x) => conditionById(x)?.name).filter(Boolean).join(', ')}` : ''}</span></span></button>
      ${mine && e.init == null ? `<button class="btn btn-sm btn-primary" data-act="init-roll" data-id="${esc(e.tokenId)}">${icon('dice-faces-06', 14)}Бросить</button>` : ''}
      ${ctx.isMaster ? `<button class="icon-btn icon-btn-xs" data-act="init-remove" data-id="${esc(e.tokenId)}" data-tip="Убрать из боя">${icon('cancel-01', 14)}</button>` : ''}
    </div>`;
  }).join('');
  const myTurn = cur && ctx.isMine(cur.token);
  return `<div class="widget panel init-widget">${head(`Бой · раунд ${cb.round}`, cur ? `Ходит ${cur.name}` : '')}
    <div class="w-list scroll init-list">${rows}</div>
    <div class="panel-footer">${ctx.isMaster
      ? `<button class="icon-btn icon-btn-sm" data-act="combat-prev" data-tip="Предыдущий ход">${icon('arrow-left-01', 18)}</button><button class="btn btn-primary grow" data-act="combat-next">Следующий ход${icon('arrow-right-01', 16)}</button><button class="icon-btn icon-btn-sm" data-act="combat-end" data-tip="Закончить бой">${icon('stop-circle', 18)}</button>`
      : myTurn ? `<button class="btn btn-primary btn-block" data-act="end-turn">${icon('tick-02', 16)}Закончить ход</button>` : `<span class="t-sm muted">${cur ? `Ждём, пока ходит ${esc(cur.name)}` : ''}</span>`}</div>
  </div>`;
}

export { fmtMod, characterOf };
