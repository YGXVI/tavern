// Вкладка «Встречи» (#203, макет 62): список встреч, сложность для отряда, существа из бестиария, постановка на сцену.
import { html, raw, on, esc } from '../../core/dom.js';
import { menu, confirmDialog, toast } from '../../ui/kit.js';
import { monsterById, loadSrdBestiary } from '../../data/bestiary.js';
import { sceneOf } from '../../core/campaign.js';
import { encounters, encounterById, saveEncounter, newEncounter, deleteEncounter, addToEncounter } from './encounters.js';
import { difficulty, LABELS } from './encounter-math.js';
import { xpFor } from '../ref/data.js';
import { loadSection, search } from '../ref/data.js';
import { ic, caps } from './parts.js';

const CHIP = ['chip-pos', 'chip-accent', 'chip-warn', 'chip-neg'];

export function mountTab(ctx, body) {
  const offs = [];
  const L = (type, sel, fn) => offs.push(on(body, type, sel, fn));
  let sel = ctx.st.rest[0] || null;
  let q = '';
  let creatures = null;
  loadSrdBestiary().then(() => render(), () => {});
  loadSection('creatures').then((list) => { creatures = list; if (q) drawSearch(); }, () => {});

  const levels = () => ctx.c.characters.map((h) => h.level || 1);
  const diffOf = (e) => difficulty(levels(), e.monsters.map((m) => ({ cr: monsterById(m.id)?.cr, count: m.count })));
  function render() {
    const c = ctx.c, list = encounters(c.id, ctx.user.id);
    if (!sel || !list.some((e) => e.id === sel)) sel = list[0]?.id || null;
    const enc = sel ? encounterById(c.id, ctx.user.id, sel) : null;
    body.innerHTML = String(html`<div class="cp-enc">
      <aside class="cp-enc-list"><div class="cp-enc-head"><h2>Встречи</h2><span class="spacer"></span><button class="btn btn-secondary btn-sm" data-new>${ic('plus-sign')}Новая</button></div>
        ${list.map((e) => { const d = diffOf(e); const sc = sceneOf(c, e.sceneId); return html`<a class="cp-enc-item ${e.id === sel ? 'current' : ''}" href="${ctx.href('encounters', e.id)}"><span class="row"><b>${e.name}</b><span class="spacer"></span><span class="chip ${CHIP[d.level] || ''}">${d.label}</span></span><small>${d.count} ${d.count === 1 ? 'существо' : d.count < 5 && d.count > 1 ? 'существа' : 'существ'} · ${sc?.name || 'без сцены'}</small></a>`; })}
        ${!list.length ? html`<p class="t-sm muted">Встреч пока нет. Соберите первую — сложность для отряда посчитаем сами.</p>` : ''}
        <p class="t-xs tertiary">${ic('information-circle', 14)}Встречи хранятся на этом устройстве и не видны игрокам.</p>
      </aside>
      ${enc ? detail(c, enc) : html`<section class="cp-card cp-enc-detail cp-empty">${ic('monster', 28)}<h3>Выберите или создайте встречу</h3><p>Существа из бестиария, сложность для вашего отряда и постановка на сцену одним нажатием.</p><button class="btn btn-primary" data-new>${ic('plus-sign')}Новая встреча</button></section>`}
    </div>`);
    if (q) drawSearch();
  }
  function detail(c, enc) {
    const d = diffOf(enc);
    const sc = sceneOf(c, enc.sceneId);
    const party = levels();
    const lvls = [...new Set(party)];
    const zone = (k) => html`<span class="cp-zone z${k} ${d.level === k ? 'on' : ''}"></span>`;
    const opt = (key, label) => html`<label class="cp-opt"><span>${label}</span><input type="checkbox" class="switch" data-opt="${key}" ${enc.opts?.[key] ? 'checked' : ''}></label>`;
    return html`<section class="cp-card cp-enc-detail">
      <div class="cp-enc-title"><input class="cp-title-input" data-name value="${enc.name}" maxlength="60" aria-label="Название встречи"><button class="chip chip-md" data-scene>${ic('maps', 14)}${sc ? `Сцена: ${sc.name}` : 'Без сцены'}</button><span class="spacer"></span><button class="icon-btn icon-btn-sm" data-encmenu aria-label="Ещё">${ic('more-horizontal', 18)}</button></div>
      <div class="cp-diff"><div class="row">${caps('Сложность для отряда')}<span class="spacer"></span><b class="cp-diff-label z${d.level}">${d.label}</b></div>
        <div class="cp-diff-bar">${[0, 1, 2, 3].map(zone)}</div>
        <div class="cp-diff-th">${[0, 1, 2, 3].map((k) => html`<span>${LABELS[k]} · ${d.party[k].toLocaleString('ru')}</span>`)}</div>
        <p class="t-xs tertiary">${party.length ? `Отряд: ${party.length} ${party.length === 1 ? 'герой' : party.length < 5 ? 'героя' : 'героев'}${lvls.length === 1 ? ` ${lvls[0]} уровня` : ''}.` : 'В отряде пока нет героев — считаем как для одного героя 1 уровня.'} Существа дают ${d.raw.toLocaleString('ru')} опыта${d.count > 1 ? `, за ${d.count} — поправка ×${String(d.mult).replace('.', ',')}: ${d.adjusted.toLocaleString('ru')}` : ''}.</p></div>
      ${caps('Существа')}
      <div class="cp-mons">${enc.monsters.map((row, i) => { const m = monsterById(row.id); return html`<div class="cp-mon"><span class="avatar md foe">${m?.img ? html`<img src="${m.img}" alt="" loading="lazy">` : ''}</span><span class="grow"><b>${m?.name || row.id}</b><small>Опасн. ${m?.cr ?? '—'} · ${xpFor(m?.cr).toLocaleString('ru')} опыта каждый</small></span>
          <span class="cp-stepper"><button data-dec="${i}" aria-label="Меньше">−</button><b>${row.count}</b><button data-inc="${i}" aria-label="Больше">+</button></span>
          <button class="icon-btn icon-btn-sm" data-monmenu="${i}" aria-label="Ещё">${ic('more-horizontal', 18)}</button></div>`; })}
        <label class="cp-mon-add">${ic('search-01', 18)}<input data-msearch value="${q}" placeholder="Добавить существо — поиск по справочнику, ${creatures?.length || 334} в бестиарии" autocomplete="off"><kbd>Ctrl K</kbd></label>
        <div class="cp-mon-found" data-found></div></div>
      ${caps('При постановке на сцену')}
      <div class="cp-opts">${opt('hidden', 'Поставить скрытыми — игроки увидят, когда откроете')}${opt('combat', 'Сразу бросить инициативу и начать бой')}${opt('pack', 'Одинаковых — одной пачкой: один ход на всех')}</div>
      <div class="cp-enc-actions"><a class="btn btn-primary btn-sm ${enc.monsters.length ? '' : 'disabled'}" href="#/c/${c.id}/do/encounter/${enc.id}">${ic('maps')}Поставить на «${(sc || sceneOf(c, c.activeSceneId))?.name || 'текущую сцену'}»</a>
        <a class="btn btn-secondary btn-sm ${enc.monsters.length ? '' : 'disabled'}" href="#/c/${c.id}/do/encounter/${enc.id}/fight">${ic('sword-01')}Поставить и начать бой</a><span class="spacer"></span><span class="t-xs tertiary">Встречу можно ставить много раз</span></div>
    </section>`;
  }
  function drawSearch() {
    const box = body.querySelector('[data-found]'); if (!box) return;
    if (!q.trim()) { box.innerHTML = ''; return; }
    if (!creatures) { box.innerHTML = '<p class="t-sm muted">Открываю бестиарий…</p>'; return; }
    const r = search(creatures, q, 8);
    box.innerHTML = String(r.list.length ? r.list.map((it) => html`<button class="cp-mon-pick" data-add="${it.monsterId}"><span class="avatar sm foe">${it.m.img ? html`<img src="${it.m.img}" alt="">` : ''}</span><b>${it.name}</b><small>${it.en} · опасн. ${it.m.cr}</small>${ic('plus-sign', 16)}</button>`) : html`<p class="t-sm muted">Не нашлось.</p>`);
  }
  const cur = () => encounterById(ctx.cid, ctx.user.id, sel);
  const change = (fn) => { const e = cur(); if (!e) return; fn(e); saveEncounter(ctx.cid, ctx.user.id, e); render(); };

  L('click', '[data-new]', () => { const e = newEncounter(ctx.cid, ctx.user.id, { sceneId: ctx.c.activeSceneId || null }); sel = e.id; history.replaceState(null, '', ctx.href('encounters', e.id)); render(); body.querySelector('[data-name]')?.select(); });
  L('change', '[data-name]', (e, inp) => change((en) => { en.name = inp.value.trim() || 'Встреча'; }));
  L('change', '[data-opt]', (e, inp) => change((en) => { en.opts = { ...en.opts, [inp.dataset.opt]: inp.checked }; }));
  L('click', '[data-inc]', (e, b) => change((en) => { en.monsters[b.dataset.inc].count = Math.min(40, en.monsters[b.dataset.inc].count + 1); }));
  L('click', '[data-dec]', (e, b) => change((en) => { const r = en.monsters[b.dataset.dec]; r.count -= 1; if (r.count <= 0) en.monsters.splice(Number(b.dataset.dec), 1); }));
  L('click', '[data-monmenu]', (e, b) => {
    const en = cur(); const row = en?.monsters[b.dataset.monmenu]; if (!row) return;
    menu([{ icon: 'book-open-01', label: 'Статблок в справочнике', href: `#/ref/creatures/${String(row.id).replace(/^srd:/, '')}` }, 'divider', { icon: 'delete-02', label: 'Убрать из встречи', danger: true, onClick: () => change((x) => { x.monsters.splice(Number(b.dataset.monmenu), 1); }) }], b, { placement: 'bottom' });
  });
  L('input', '[data-msearch]', (e, inp) => { q = inp.value; drawSearch(); });
  L('click', '[data-add]', (e, b) => { addToEncounter(ctx.cid, ctx.user.id, sel, b.dataset.add); q = ''; render(); body.querySelector('[data-msearch]')?.focus(); });
  L('click', '[data-scene]', (e, b) => {
    menu([{ icon: 'cancel-01', label: 'Без сцены', onClick: () => change((en) => { en.sceneId = null; }) }, 'divider', ...ctx.c.scenes.map((s) => ({ icon: 'maps', label: s.name, onClick: () => change((en) => { en.sceneId = s.id; }) }))], b, { placement: 'bottom' });
  });
  L('click', '[data-encmenu]', (e, b) => {
    menu([{ icon: 'copy-01', label: 'Копия встречи', onClick: () => { const en = cur(); const x = newEncounter(ctx.cid, ctx.user.id, { name: `${en.name} — копия`, sceneId: en.sceneId, monsters: structuredClone(en.monsters) }); sel = x.id; render(); } },
      'divider', { icon: 'delete-02', label: 'Удалить встречу', danger: true, onClick: async () => { if (!(await confirmDialog({ title: 'Удалить встречу?', body: 'Существа на картах останутся.', ok: 'Удалить', danger: true }))) return; deleteEncounter(ctx.cid, ctx.user.id, sel); sel = null; render(); } }], b, { placement: 'bottom' });
  });
  L('click', 'a.disabled', (e) => { e.preventDefault(); toast({ title: 'Во встрече пока никого', body: 'Добавьте существ через поиск', icon: 'monster' }); });
  render();
  return { update: render, route(rest) { sel = rest[0] || sel; render(); }, unmount() { for (const off of offs) off(); } };
}
export { esc, raw };
