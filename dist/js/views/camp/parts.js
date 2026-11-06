// Общие куски дома кампании (#203): строки отряда, раздатка, мелочи.
import { html, raw, plural, timeAgo } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { srcOf } from '../../core/assets.js';
import { onlineUsers } from '../../core/store.js';
import { userById } from '../../core/campaign.js';
import { portrait, modal, panelHeader } from '../../ui/kit.js';

export const ic = (n, s = 16) => raw(icon(n, s));
export const caps = (t) => html`<span class="cp-caps">${t}</span>`;
export const cardHead = (title, right = '') => html`<div class="cp-card-head">${caps(title)}<span class="cp-rule"></span>${right}</div>`;

/** Герои отряда: [{ch, member, user, online}] — сначала с игроками. */
export function party(c) {
  const online = onlineUsers(c.id);
  return c.characters.map((ch) => {
    const m = c.members.find((x) => x.characterId === ch.id && x.status === 'active') || null;
    return { ch, member: m, user: m ? userById(m.userId) : null, online: !!(m && online.has(m.userId)) };
  }).sort((a, b) => (!!b.member - !!a.member) || String(a.ch.name).localeCompare(String(b.ch.name), 'ru'));
}
export const heroSub = (ch) => [ch.className, ch.level ? `${ch.level} ур.` : ''].filter(Boolean).join(' · ');
export function partyRow(c, p, me, { hp = true } = {}) {
  const who = p.user ? `${p.user.name}${p.user.id === me ? ' — вы' : ''}` : 'без игрока';
  return html`<a class="cp-party" href="#/c/${c.id}/sheet/${encodeURIComponent(p.ch.id)}">${portrait(p.ch.portrait, 'md hero', p.ch.name, p.member ? p.online : null)}
    <span class="cp-party-t"><b>${p.ch.name}</b><small>${heroSub(p.ch)}${hp ? ` · ${p.ch.hp ?? '—'}/${p.ch.hpMax ?? '—'}` : ''}</small></span>
    <span class="cp-party-who ${p.online ? '' : 'off'}">${p.member && !p.online && p.user?.id !== me ? 'не в сети' : who}</span></a>`;
}
export function levelsLine(c) {
  const lv = [...new Set(c.characters.map((h) => h.level).filter(Boolean))].sort((a, b) => a - b);
  return lv.length === 1 ? `Все ${lv[0]} уровня` : lv.length ? `уровни ${lv[0]}–${lv.at(-1)}` : '';
}
export function slotsText(ch) {
  const s = Object.entries(ch?.slots || {}).filter(([k]) => /^[1-9]$/.test(k)).sort((a, b) => a[0] - b[0]);
  return s.length ? s.map(([, v]) => Math.max(0, (v?.max || 0) - (v?.used || 0))).join(' · ') : '—';
}

/** Раздатка — модальное окно для чтения. */
export function openHandout(h) {
  modal(html`${panelHeader(h.title || 'Раздатка', h.shownAt ? `от мастера · ${timeAgo(h.shownAt)}` : 'от мастера')}
    <div class="modal-body scroll"><div class="panel-section cp-handout">${h.img ? html`<img src="${srcOf(h.img)}" alt="">` : ''}${h.text ? html`<div class="cp-handout-paper">${String(h.text).split(/\n+/).map((p) => html`<p>${p}</p>`)}</div>` : ''}</div></div>
    <div class="panel-footer"><span class="spacer"></span><button class="btn btn-secondary" data-close>Закрыть</button></div>`, { className: 'cp-handout-modal' });
}
export const handoutIcon = (h) => (h.img ? 'maps' : 'note-edit');
export { plural, portrait };
