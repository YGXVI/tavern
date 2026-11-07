// Смена хода для наложений (#193): истечение, временные хиты Героизма, повторный спасбросок Удержания.
// Работает только у мастера: у него есть права на все строки, и событие срабатывает один раз.
import { addLog, characterOf, monsterOf, patchTokenStats, tokenStats, updateCampaign } from '../../core/campaign.js';
import { effectInstances, recipeOf, removeRows, turnPlan } from '../../rules/effect-rows.js';
import { abilityModifier } from './sheet-rules.js';
import { sheetBonus } from './sheet-fields.js';
import { ABILITIES } from '../../data/rules.js';
import { initiativeOrder } from './combat.js';
import { conditionRoll } from './effects-roll.js';
import { doRoll } from './dice.js';

/** Токен существа: строка наложения хранит либо токен, либо героя. */
const tokenOf = (scene, id) => scene?.tokens?.find((t) => t.id === id || t.characterId === id) || null;

/** Бонус спасброска: у героя с листа, у существа из статблока. null — неизвестен. */
function saveBonus(c, scene, id, ability) {
  const ch = characterOf(c, id) || characterOf(c, tokenOf(scene, id)?.characterId);
  if (ch) return sheetBonus(ch, 'saves', ability, ability).value;
  const t = tokenOf(scene, id), m = t?.monsterId ? monsterOf(c, t.monsterId) : null;
  return Number.isSafeInteger(m?.saves?.[ability]) ? m.saves[ability] : abilityModifier(m?.stats?.[ability]);
}

/** Кто ходит сейчас: токены слота и герои на них. */
function slotIds(c, scene) {
  const order = initiativeOrder(c, scene), cb = c.combat;
  const cur = order.find((e) => e.tokenId === cb.current) || order[cb.turn];
  if (!cur) return [];
  return order.filter((e) => e.slot === cur.slot).flatMap((e) => [e.tokenId, tokenOf(scene, e.tokenId)?.characterId]).filter(Boolean);
}

function applyTurn(ctx, ended, started) {
  const c = ctx.c, round = c.combat.round || 1, plan = turnPlan(c.effects || [], { ended, started, round });
  if (!plan.expire.length && !plan.tempHp.length && !plan.saves.length) return;
  const gone = [...plan.expire];
  for (const { row, ability } of plan.saves) {
    const t = tokenOf(ctx.scene, row.target), name = t ? tokenStats(c, t).name : 'Цель', spell = recipeOf(row.ref)?.label;
    const bonus = saveBonus(c, ctx.scene, row.target, ability), word = ABILITIES.find((a) => a.id === ability)?.name || ability;
    if (bonus == null || !Number.isFinite(row.dc)) { updateCampaign(ctx.cid, (x) => addLog(x, { kind: 'combat', text: `${name}: повторите спасбросок (${word}) против заклинания «${spell}»` })); continue; }
    const p = conditionRoll(characterOf(c, row.target) || t, { kind: 'save', ability }, effectInstances(c, row.target));
    if (p.autoFail) continue;
    const r = doRoll(ctx, { label: `${name}: спасбросок (${word}), ${spell}, СЛ ${row.dc}`, dice: { 20: 1, ...p.dice }, mod: bonus + p.mod, minus: p.minus, adv: p.adv, kind: 'check', vis: t?.hidden ? 'gm' : 'all' });
    if (r.total >= row.dc) gone.push(row);
  }
  ctx.mutateScene((s, x) => {
    for (const { target, value, row } of plan.tempHp) {
      const t = tokenOf(s, target);
      if (t) patchTokenStats(x, s, t.id, (st) => ({ tempHp: Math.max(st.tempHp || 0, value) }));
      addLog(x, { kind: 'combat', text: `${t ? tokenStats(x, t).name : 'Цель'}: временные хиты ${value} (${recipeOf(row.ref)?.label})` });
    }
    if (gone.length) {
      x.effects = removeRows(x.effects || [], (x.effects || []).filter((r) => gone.some((g) => g.id === r.id)), round);
      for (const r of gone) addLog(x, { kind: 'combat', text: `Закончилось: ${recipeOf(r.ref)?.label}` });
    }
  });
}

/** Следит за очередью. Первый снимок только запоминается: перезагрузка страницы не повторяет событие хода. */
export function turnWatcher(ctx) {
  let key = null, ids = [];
  return () => {
    const c = ctx.c, cb = c?.combat;
    if (!cb?.active || !ctx.scene) { key = null; ids = []; return; }
    const now = `${cb.round}|${cb.current ?? cb.turn}`;
    if (now === key) return;
    const first = key === null, ended = ids;
    key = now; ids = slotIds(c, ctx.scene);
    // Мы внутри рассылки изменений: свои правки делаем сразу после неё.
    const started = ids;
    if (!first && ctx.isMaster && (c.effects || []).length) queueMicrotask(() => { if (ctx.c?.combat?.active) applyTurn(ctx, ended, started); });
  };
}
