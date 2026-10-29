// Бой: инициатива, ходы, расход движения. Правила 5e 2014: к20 + модификатор Ловкости.
import { roll } from '../../../engine.js';
import { tokenStats, addLog } from '../../core/campaign.js';

/** Порядок ходов на текущей сцене: инициатива по убыванию, ничья — по бонусу, затем по имени. */
export function initiativeOrder(c, scene) {
  const cb = c.combat;
  if (!cb?.entries?.length || !scene) return [];
  const ids = new Set(scene.tokens.map((t) => t.id));
  return cb.entries
    .filter((e) => ids.has(e.tokenId))
    .map((e) => {
      const t = scene.tokens.find((x) => x.id === e.tokenId);
      const st = tokenStats(c, t);
      return { ...e, name: st.name, bonus: st.initBonus ?? 0, token: t, stats: st };
    })
    .sort((a, b) => (b.init ?? -99) - (a.init ?? -99) || b.bonus - a.bonus || a.name.localeCompare(b.name, 'ru'));
}

export function rollInitiative(c, t) {
  const st = tokenStats(c, t);
  const r = roll(`1d20${st.initBonus >= 0 ? '+' : ''}${st.initBonus || 0}`);
  return { init: r.total, natural: r.rolls[0] };
}

export function startCombat(c, scene, tokenIds, rolls = {}) {
  const entries = tokenIds.map((id) => {
    const t = scene.tokens.find((x) => x.id === id);
    // null — игрок бросит сам; до броска стоит в конце очереди.
    return { tokenId: id, init: id in rolls ? rolls[id] : rollInitiative(c, t).init };
  });
  c.combat = { active: true, sceneId: scene.id, round: 1, turn: 0, entries, moved: {}, startedAt: Date.now() };
  addLog(c, { kind: 'combat', text: `Бой начался: ${entries.length} участников` });
}

export function endCombat(c) {
  c.combat = { active: false, round: 1, turn: 0, entries: [], moved: {} };
  addLog(c, { kind: 'combat', text: 'Бой окончен' });
}

/** Павший враг (0 хитов) пропускает ход; герой с 0 хитов ходит — бросает спасброски от смерти. */
const fallenFoe = (e) => e.token?.kind === 'foe' && e.stats?.hpMax > 0 && e.stats.hp <= 0;

export function advanceTurn(c, scene, dir = 1) {
  const order = initiativeOrder(c, scene);
  if (!order.length) return;
  let turn = c.combat.turn;
  for (let step = 0; step < order.length; step++) {
    turn += dir;
    if (turn >= order.length) { turn = 0; c.combat.round += 1; }
    if (turn < 0) { turn = order.length - 1; c.combat.round = Math.max(1, c.combat.round - 1); }
    if (!fallenFoe(order[turn])) break;
  }
  c.combat.turn = turn;
  const cur = order[turn];
  if (cur) c.combat.moved[cur.tokenId] = 0;
}

export function currentEntry(c, scene) {
  if (!c.combat?.active) return null;
  const order = initiativeOrder(c, scene);
  return order[c.combat.turn % Math.max(1, order.length)] || null;
}
