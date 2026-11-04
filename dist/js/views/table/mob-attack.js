// Атака толпой (#198 §5, честный режим; только у мастера). Пачка бьёт одну цель: у каждой атаки свой к20,
// натуральная 20 — крит (удваиваются только кубы урона), натуральная 1 — промах, иначе сравнение с КД цели.
// Чего приложение пока само не знает (до движка эффектов #193), мастер отмечает руками: преимущество/помеха,
// укрытие, сопротивление/уязвимость/иммунитет цели, число атак на атакующего. Без 3D-кубов — сводка и строки.
// Урон — по каждому попаданию отдельно: временные хиты, сопротивление с округлением вниз, проверка концентрации
// за каждое попадание; герой на 0 хитов — провал спасброска от смерти за попадание, за крит — два.
import { esc, plural, uid } from '../../core/dom.js';
import { icon } from '../../icons.js';
import { srcOf } from '../../core/assets.js';
import { tokenStats, patchTokenStats, addLog, updateCampaign } from '../../core/campaign.js';
import { modal } from '../../ui/kit.js';
import { bus, emitLocal } from '../../core/store.js';
import { footprintAt, footprintGap } from '../../rules/geometry.js';
import { sizeById } from '../../data/rules.js';
import { initiativeOrder, slotMembers } from './combat.js';
import { attackOutcome, critDamageFormula, heroDamage } from '../../rules/attack.js';
import { showRollToast } from './dice.js';

// ——— Правила (чистые функции, покрыты тестами) ———
const rnd = (sides, random = Math.random) => Math.floor(random() * sides) + 1;

/** Дальность действия: {melee: фт} | {range: {normal, long}} | обе (метательное) | null — не указано. */
export function attackReach(a) {
  if (!a) return null;
  const out = {};
  if (Number.isFinite(a.attack?.reach)) out.melee = a.attack.reach;
  if (Number.isFinite(a.attack?.range?.normal)) out.range = { normal: a.attack.range.normal, long: a.attack.range.long || a.attack.range.normal };
  const text = `${a.desc || ''} ${a.note || ''}`;
  let m;
  if (out.melee == null && (m = text.match(/reach (\d+) ft/i) || text.match(/досягаемость (\d+) фт/i))) out.melee = Number(m[1]);
  if (!out.range && (m = text.match(/range (\d+)\/(\d+) ft/i) || text.match(/дистанция (\d+)\/(\d+) фт/i))) out.range = { normal: Number(m[1]), long: Number(m[2]) };
  return out.melee != null || out.range ? out : null;
}

/** Достаёт ли атакующий цель: {ok, disadv, ft}. reach null — дальность не указана, считаем «достаёт». */
export function inReach(scene, attacker, target, reach) {
  const g = scene.grid, feet = g.feet || 5;
  const fp = (t) => { const n = sizeById(t.size).cells; return { ...footprintAt(g, t.x, t.y, n), n }; };
  const ft = footprintGap(fp(attacker), fp(target)) * feet;
  if (!reach) return { ok: true, disadv: false, ft, unknown: true };
  if (reach.melee != null && ft <= reach.melee) return { ok: true, disadv: false, ft };
  if (reach.range) {
    if (ft <= reach.range.normal) return { ok: true, disadv: false, ft };
    if (ft <= reach.range.long) return { ok: true, disadv: true, ft };
  }
  return { ok: false, disadv: false, ft };
}

/** Крит удваивает только кубы: «1d6+2» → «2d6+2» (общая функция аудита #197). */
export const critDice = critDamageFormula;

/** Бросок урона по формуле из нескольких слагаемых («1d8 + 2d6 + 3»): {total, text} или null. */
export function rollDamage(f, random = Math.random) {
  const src = String(f || '').replace(/\s/g, '').replace(/к/gi, 'd');
  if (!src || !/^[+-]?(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$/i.test(src)) return null;
  let total = 0;
  const parts = [];
  for (const [, sign, n, sides, flat] of src.matchAll(/([+-]?)(?:(\d*)d(\d+)|(\d+))/gi)) {
    const k = sign === '-' ? -1 : 1;
    if (sides) { const vals = Array.from({ length: Number(n) || 1 }, () => rnd(Number(sides), random)); total += k * vals.reduce((a, b) => a + b, 0); parts.push(vals.join('+')); }
    else { total += k * Number(flat); parts.push(`${sign === '-' ? '−' : '+'}${flat}`); }
  }
  return { total: Math.max(0, total), text: parts.join(' ') };
}

/** Исход атаки: натуральная 20 — крит, натуральная 1 — промах, иначе итог против КД (общая функция аудита #197). */
export const outcome = attackOutcome;

/** Урон с учётом отношения цели: сопротивление — половина вниз, уязвимость — вдвое, иммунитет — 0. */
export const adjust = (dmg, rel) => (rel === 'resist' ? Math.floor(dmg / 2) : rel === 'vuln' ? dmg * 2 : rel === 'immune' ? 0 : dmg);

/**
 * Применить попадания по очереди к снимку цели {hp, hpMax, tempHp, conditions[], deathSaves?}. Возвращает новый
 * снимок, сколько урона дошло (dealt) и подсказки (концентрация, спасброски от смерти).
 */
export function applyHits(s0, hits, rel, isHero) {
  const s = { ...s0, tempHp: s0.tempHp || 0, conditions: [...(s0.conditions || [])], deathSaves: s0.deathSaves ? { ...s0.deathSaves } : undefined };
  const notes = [];
  let dealt = 0;
  for (const h of hits) {
    const dmg = adjust(h.damage, rel);
    if (dmg <= 0) continue;
    if (isHero) {
      // Герой — по общим правилам урона (#197 M1): провалы при 0 хитов, мгновенная смерть.
      const was = s.hp;
      const r = heroDamage(s, dmg, { crit: !!h.crit });
      s.hp = r.hp; s.tempHp = r.tempHp; s.deathSaves = r.deathSaves;
      dealt += dmg;
      if (was > 0 && s.hp > 0 && s.conditions.includes('concentration')) notes.push(`Проверка концентрации: спасбросок ТЕЛ СЛ ${Math.max(10, Math.floor(dmg / 2))}`);
      if (r.dropped && !s.conditions.includes('unconscious')) { s.conditions = s.conditions.filter((x) => x !== 'concentration'); s.conditions.push('unconscious'); }
      if (r.dead) { notes.push(was > 0 ? 'Урон не меньше максимума хитов — мгновенная смерть' : 'Три провала спасброска от смерти — герой погибает'); break; }
      continue;
    }
    const absorbed = Math.min(s.tempHp, dmg);
    s.tempHp -= absorbed;
    s.hp = Math.max(0, s.hp - (dmg - absorbed));
    dealt += dmg;
    if (s.conditions.includes('concentration')) notes.push(`Проверка концентрации: спасбросок ТЕЛ СЛ ${Math.max(10, Math.floor(dmg / 2))}`);
  }
  return { state: s, dealt, notes };
}

/** Бросок атак: по attacks атак на каждого. adv: 'adv' | 'dis' | null — на всех; disadv по дальности — у атакующего. */
export function rollAttacks({ attackers, bonus, damage, attacks = 1, adv = null, random = Math.random }) {
  const out = [];
  for (const a of attackers) {
    for (let k = 0; k < attacks; k++) {
      const mode = adv === 'adv' && a.disadv ? null : adv === 'adv' ? 'adv' : (adv === 'dis' || a.disadv) ? 'dis' : null;
      const d1 = rnd(20, random), d2 = mode ? rnd(20, random) : null;
      const nat = mode === 'adv' ? Math.max(d1, d2) : mode === 'dis' ? Math.min(d1, d2) : d1;
      const normal = rollDamage(damage, random), crit = rollDamage(critDice(damage), random);
      out.push({ id: a.id, name: a.name, nat, other: d2, mode, total: nat + bonus, normal, crit });
    }
  }
  return out;
}

// ——— Окно ———
const SEG = (name, val, opts) => `<div class="mob-seg" role="radiogroup">${opts.map(([v, l]) => `<button class="${val === v ? 'on' : ''}" data-set="${name}" data-v="${v}" role="radio" aria-checked="${val === v}">${l}</button>`).join('')}</div>`;
const fallen = (st) => st.hpMax > 0 && st.hp <= 0;

/** Открыть атаку толпой для пачки, где стоит tokenId. */
export function mobAttack(ctx, tokenId) {
  const sc = ctx.scene; if (!sc) return;
  const order = initiativeOrder(ctx.c, sc);
  const pack = (slotMembers(order, tokenId).length ? slotMembers(order, tokenId) : order.filter((e) => e.tokenId === tokenId)).filter((e) => !fallen(e.stats));
  if (!pack.length) { ctx.toast({ title: 'Некому атаковать', body: 'Все члены пачки выбыли', icon: 'sword-03' }); return; }
  const lead = pack[0];
  const actions = (lead.stats.monster?.actions || []).filter((a) => a.bonus || a.attack?.bonus != null).map((a, i) => ({ ...a, i, bonus: a.bonus ?? a.attack.bonus }));
  if (!actions.length) { ctx.toast({ title: 'В статблоке нет атак', body: 'Атака толпой берёт действие с бонусом к попаданию', icon: 'sword-03' }); return; }
  const memberIds = new Set(pack.map((e) => e.tokenId));
  const targets = sc.tokens.filter((t) => t.kind !== 'item' && !memberIds.has(t.id));
  const pickTarget = [...(ctx.ui.targets || [])].find((id) => targets.some((t) => t.id === id))
    || [...ctx.ui.selection].find((id) => targets.some((t) => t.id === id))
    || [...targets].filter((t) => t.kind === 'hero').sort((a, b) => Math.hypot(a.x - lead.token.x, a.y - lead.token.y) - Math.hypot(b.x - lead.token.x, b.y - lead.token.y))[0]?.id
    || targets[0]?.id;
  if (!pickTarget) { ctx.toast({ title: 'Нет цели', body: 'Поставьте на сцену того, кого атакуют', icon: 'sword-03' }); return; }

  const st = { target: pickTarget, action: actions[0].i, adv: null, cover: 0, rel: null, attacks: 1, on: new Set(pack.filter((e) => !e.token.hidden).map((e) => e.tokenId)), result: null, ac: null };
  const name = (t) => ctx.nameOf(t);
  const packName = `${(ctx.nameOf(lead.token) || '').replace(/\s+\d+$/, '')} ×${pack.length}`;
  const dlg = modal('', { className: 'mob-modal' });

  const reachInfo = () => {
    const target = sc.tokens.find((t) => t.id === st.target);
    const a = actions.find((x) => x.i === st.action);
    const reach = attackReach(a);
    return { target, a, reach, map: new Map(pack.map((e) => [e.tokenId, target ? inReach(sc, e.token, target, reach) : { ok: true }])) };
  };

  const render = () => {
    const { target, a, reach, map } = reachInfo();
    const tst = target ? tokenStats(ctx.c, target) : null;
    const can = pack.filter((e) => st.on.has(e.tokenId) && map.get(e.tokenId)?.ok);
    if (st.result) return renderResult(target, tst, a);
    const reachText = !reach ? 'Дальность в статблоке не указана — проверьте сами, кто достаёт'
      : reach.melee != null && !reach.range ? `Рукопашная, досягаемость ${reach.melee} фт`
      : reach.range && reach.melee == null ? `Дальнобойная, ${reach.range.normal}/${reach.range.long} фт (дальше обычной — с помехой)`
      : `Рукопашная ${reach.melee} фт или метание ${reach.range.normal}/${reach.range.long} фт`;
    dlg.set(`<div class="panel-header"><div class="titles"><div class="title">Атака толпой</div><div class="subtitle">${esc(packName)}${target ? ` → ${esc(name(target))}` : ''}</div></div><button class="icon-btn icon-btn-sm" data-close aria-label="Закрыть">${icon('cancel-01', 18)}</button></div>
      <div class="panel-section mob-grid">
        <label class="field"><span class="label">Цель</span><span class="input"><select data-target>${targets.map((t) => `<option value="${esc(t.id)}" ${t.id === st.target ? 'selected' : ''}>${esc(name(t))}${t.hidden ? ' (скрыт)' : ''} · КД ${tokenStats(ctx.c, t).ac ?? '—'}</option>`).join('')}</select></span></label>
        <label class="field"><span class="label">Действие</span><span class="input"><select data-action>${actions.map((x) => `<option value="${x.i}" ${x.i === st.action ? 'selected' : ''}>${esc(x.name)} · ${x.bonus >= 0 ? '+' : ''}${x.bonus}${x.damage ? ` · ${esc(x.damage)}${x.type ? ` ${esc(x.type)}` : ''}` : ''}</option>`).join('')}</select></span></label>
        <p class="t-sm muted">${esc(reachText)}</p>
      </div>
      <div class="panel-section"><div class="label">Кто атакует · достают ${can.length} из ${pack.length}</div>
        <div class="mob-who">${pack.map((e) => {
          const r = map.get(e.tokenId) || {}, on = st.on.has(e.tokenId);
          const tag = r.ok === false ? `далеко · ${r.ft} фт` : r.disadv ? 'с помехой' : e.token.hidden ? 'скрыт' : '';
          return `<button class="mob-a ${on ? 'on' : ''} ${r.ok === false ? 'far' : ''}" data-who="${esc(e.tokenId)}" aria-pressed="${on}">${srcOf(e.token.img) ? `<span class="avatar xs"><img src="${esc(srcOf(e.token.img))}" alt=""></span>` : ''}<span>${esc(name(e.token))}</span>${tag ? `<small>${esc(tag)}</small>` : ''}</button>`;
        }).join('')}</div>
        ${pack.some((e) => e.token.hidden) ? '<p class="t-sm muted">Скрытые по умолчанию не атакуют — их бросок выдал бы засаду.</p>' : ''}
      </div>
      <div class="panel-section mob-marks">
        <div class="mob-mark"><span class="t-sm">Броски</span>${SEG('adv', st.adv, [[null, 'Обычно'], ['adv', 'Преим.'], ['dis', 'Помеха']])}</div>
        <div class="mob-mark"><span class="t-sm">Укрытие цели</span>${SEG('cover', st.cover, [[0, 'Нет'], [2, '+2'], [5, '+5']])}</div>
        <div class="mob-mark"><span class="t-sm">Цель к урону${a?.type ? ` (${esc(a.type)})` : ''}</span>${SEG('rel', st.rel, [[null, 'Обычно'], ['resist', 'Сопр.'], ['vuln', 'Уязв.'], ['immune', 'Иммун.']])}</div>
        <div class="mob-mark"><span class="t-sm">Атак у каждого</span>${SEG('attacks', st.attacks, [[1, '×1'], [2, '×2'], [3, '×3']])}</div>
      </div>
      <div class="panel-footer"><span class="t-sm muted grow">${tst ? `КД цели ${(tst.ac ?? 10) + Number(st.cover)}` : ''}</span><button class="btn btn-sm btn-ghost" data-close>Отмена</button><button class="btn btn-sm btn-primary" data-roll ${can.length && a?.damage ? '' : 'disabled'}>${icon('sword-03', 14)}Бросить ${can.length * st.attacks} ${plural(can.length * st.attacks, 'атаку', 'атаки', 'атак')}</button></div>`);
  };

  const hitsOf = () => st.result.map((r) => ({ ...r, res: outcome(r.nat, r.total, st.ac) })).map((r) => ({ ...r, damage: r.res === 'crit' ? r.crit?.total || 0 : r.res === 'hit' ? r.normal?.total || 0 : 0, isCrit: r.res === 'crit' }));
  const renderResult = (target, tst, a) => {
    const rows = hitsOf();
    const hits = rows.filter((r) => r.res !== 'miss');
    const crits = hits.filter((r) => r.isCrit).length;
    const sum = hits.reduce((s, r) => s + adjust(r.damage, st.rel), 0);
    dlg.set(`<div class="panel-header"><div class="titles"><div class="title">Атака толпой · ${esc(a.name)}</div><div class="subtitle">${esc(packName)} → ${esc(name(target))}</div></div><button class="icon-btn icon-btn-sm" data-close aria-label="Закрыть">${icon('cancel-01', 18)}</button></div>
      <div class="panel-section"><div class="mob-sum"><b>${rows.length} ${plural(rows.length, 'атака', 'атаки', 'атак')}: ${hits.length} ${plural(hits.length, 'попадание', 'попадания', 'попаданий')}${crits ? ` (${crits} ${plural(crits, 'крит', 'крита', 'критов')})` : ''}</b><span>урон ${sum}${st.rel ? ` · ${{ resist: 'сопротивление', vuln: 'уязвимость', immune: 'иммунитет' }[st.rel]}` : ''}</span></div>
        <label class="mob-ac"><span class="t-sm">КД цели</span><span class="input"><input type="number" min="0" max="40" data-ac value="${st.ac}"></span><small class="muted">Поправьте, если цель успела наложить «Щит», — попадания пересчитаются</small></label></div>
      <div class="panel-section mob-rows">${rows.map((r) => `<div class="mob-row ${r.res}"><span class="grow ellipsis">${esc(r.name)}</span><span class="mono">к20 ${r.mode ? `${r.nat} <s>${r.other === r.nat ? r.nat : r.other}</s>` : r.nat} ${a.bonus >= 0 ? '+' : '−'} ${Math.abs(a.bonus)} = ${r.total}</span><b>${r.res === 'crit' ? 'крит' : r.res === 'hit' ? 'попал' : 'мимо'}</b><span class="mono dmg">${r.res === 'miss' ? '—' : adjust(r.damage, st.rel)}</span></div>`).join('')}</div>
      <div class="panel-footer"><button class="btn btn-sm btn-ghost" data-back>${icon('arrow-left-01', 14)}Назад</button><span class="spacer"></span><button class="btn btn-sm btn-secondary" data-reroll>Перебросить</button><button class="btn btn-sm btn-primary" data-apply ${hits.length ? '' : 'disabled'}>${icon('first-aid-kit', 14)}Нанести урон${hits.length ? ` · ${sum}` : ''}</button></div>`);
  };

  const doRoll = () => {
    const { target, a, map } = reachInfo();
    const tst = tokenStats(ctx.c, target);
    const attackers = pack.filter((e) => st.on.has(e.tokenId) && map.get(e.tokenId)?.ok).map((e) => ({ id: e.tokenId, name: name(e.token), disadv: !!map.get(e.tokenId)?.disadv }));
    st.result = rollAttacks({ attackers, bonus: a.bonus, damage: a.damage, attacks: Number(st.attacks), adv: st.adv });
    st.ac = (tst.ac ?? 10) + Number(st.cover);
    // Журнал — одна запись; видимость — как у бросков мастера за монстров (скрытый остаётся скрытым).
    const rows = hitsOf(), hits = rows.filter((r) => r.res !== 'miss');
    const hidden = !!ctx.ui.dicePool?.hidden || attackers.some((x) => sc.tokens.find((t) => t.id === x.id)?.hidden);
    const entry = { id: uid('r-'), at: Date.now(), userId: ctx.userId, kind: 'attack', label: `${packName}: ${a.name} → ${name(target)}`, total: hits.length, detail: `${rows.length} ${plural(rows.length, 'атака', 'атаки', 'атак')} против КД ${st.ac}: ${hits.length} ${plural(hits.length, 'попадание', 'попадания', 'попаданий')}${hits.filter((r) => r.isCrit).length ? `, критов ${hits.filter((r) => r.isCrit).length}` : ''} · к20: ${rows.map((r) => r.nat).join(', ')}`, hidden, vis: hidden ? 'gm' : 'all', nat: null };
    updateCampaign(ctx.cid, (c) => addLog(c, entry));
    bus.send('roll', { cid: ctx.cid, entry });
    showRollToast(ctx, entry, true);
    render();
  };

  const apply = () => {
    const { target, a } = reachInfo();
    const hits = hitsOf().filter((r) => r.res !== 'miss').map((r) => ({ damage: r.damage, crit: r.isCrit }));
    if (!hits.length || !target) return;
    let before = null, after = null, res = null;
    const id = target.id, isHero = target.kind === 'hero';
    const pick = (x) => ({ hp: x.hp, tempHp: x.tempHp || 0, conditions: [...(x.conditions || [])], ...(x.deathSaves ? { deathSaves: { ...x.deathSaves } } : {}) });
    ctx.mutateScene((s, c) => {
      patchTokenStats(c, s, id, (x) => {
        before = pick(x);
        res = applyHits({ ...pick(x), hpMax: x.hpMax }, hits, st.rel, isHero);
        const out = { hp: res.state.hp, tempHp: res.state.tempHp, conditions: res.state.conditions, ...(res.state.deathSaves ? { deathSaves: res.state.deathSaves } : {}) };
        after = { ...before, ...out };
        return out;
      });
      addLog(c, { kind: 'hp', userId: ctx.userId, text: `${tokenStats(c, s.tokens.find((t) => t.id === id)).name}: урон ${res?.dealt ?? 0} — атака толпой (${hits.length} ${plural(hits.length, 'попадание', 'попадания', 'попаданий')}, ${a.name})` });
    }, {
      label: 'Атака толпой',
      undo: (s, c) => { if (before) patchTokenStats(c, s, id, () => structuredClone(before)); },
      redo: (s, c) => { if (after) patchTokenStats(c, s, id, () => structuredClone(after)); },
    });
    for (const n of res?.notes || []) ctx.toast({ title: n.startsWith('Проверка') ? 'Концентрация' : 'Спасброски от смерти', body: `${name(target)}: ${n}`, icon: n.startsWith('Проверка') ? 'brain-02' : 'skull' });
    bus.send('hp-flash', { cid: ctx.cid, ids: [id], delta: -(res?.dealt || 0) });
    emitLocal('hp-flash', { cid: ctx.cid, ids: [id], delta: -(res?.dealt || 0) });
    dlg.close();
  };

  dlg.box.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { dlg.close(); return; }
    const who = e.target.closest('[data-who]');
    if (who) { const k = who.dataset.who; st.on.has(k) ? st.on.delete(k) : st.on.add(k); render(); return; }
    const set = e.target.closest('[data-set]');
    if (set) { const v = set.dataset.v; st[set.dataset.set] = v === '' || v === 'null' ? null : /^\d+$/.test(v) ? Number(v) : v; render(); return; }
    if (e.target.closest('[data-roll]') || e.target.closest('[data-reroll]')) { doRoll(); return; }
    if (e.target.closest('[data-back]')) { st.result = null; render(); return; }
    if (e.target.closest('[data-apply]')) apply();
  });
  dlg.box.addEventListener('change', (e) => {
    if (e.target.matches('[data-target]')) { st.target = e.target.value; render(); }
    if (e.target.matches('[data-action]')) { st.action = Number(e.target.value); render(); }
  });
  dlg.box.addEventListener('input', (e) => {
    if (e.target.matches('[data-ac]')) { const v = Number(e.target.value); if (Number.isFinite(v)) { st.ac = v; const pos = e.target.selectionStart; render(); const inp = dlg.box.querySelector('[data-ac]'); inp.focus(); try { inp.setSelectionRange(pos, pos); } catch { /* number input */ } } }
  });
  dlg.box.addEventListener('keydown', (e) => e.stopPropagation());
  render();
}
