import { isServerMode } from '../../core/store.js';
// Постановка полной встречи: все источники проходят подготовку до первой записи.
import { encounters, encounterById, encounterCreature } from '../camp/encounters.js';
import { listCreatures } from '../../core/library.js';
import { loadSrdBestiary } from '../../data/bestiary.js';
import { toMonster } from '../../rules/creature.js';
import { monsterToken } from '../../data/demo.js';
import { nextTokenName } from '../../core/campaign.js';
import { sizeById } from '../../data/rules.js';
import { freeSpots, gridSize } from '../../rules/geometry.js';
import { viewCenter, preparedCopy, commitCreatures } from './p-side.js';

export { encounters };
export async function placeEncounter(ctx, id, { at = null, fight = false } = {}) {
  if (!ctx.isMasterView || !ctx.scene || ctx.ui.encounterPlacing) return [];
  const encounter = encounterById(ctx.cid, ctx.userId, id);
  if (!encounter) { ctx.toast({ title: 'Встреча не найдена', icon: 'alert-circle' }); return []; }
  ctx.ui.encounterPlacing = true;
  ctx.panels.renderSide?.(true);
  const dismiss = ctx.toast({ title: 'Ставлю встречу…', icon: 'hourglass', timeout: 0 });
  try {
    const ids = await placeEncounterRows(ctx, encounter.monsters, { at, hidden: encounter.opts?.hidden !== false, label: encounter.name });
    if (ids.length && ctx.scene?.tokens.some((t) => t.id === ids[0]) && (fight || encounter.opts?.combat)) ctx.panels.combatToggle(ids);
    return ids;
  } catch (e) { ctx.toast({ title: 'Встреча не поставлена', body: e.message || String(e), icon: 'alert-circle' }); return []; }
  finally { ctx.ui.encounterPlacing = false; ctx.panels.renderSide?.(true); dismiss?.(); }
}

export async function placeEncounterRows(ctx, rows, { at = null, hidden = true, label = '' } = {}) {
  if (!ctx.isMasterView || !ctx.scene) return [];
  const sceneId = ctx.sceneId;
  await loadSrdBestiary();
  let library = [];
  if (rows.some((r) => r.id.startsWith('libsrc:'))) {
    try { library = await listCreatures(); }
    catch (e) { if (rows.some((r) => r.id.startsWith('libsrc:') && !r.creature)) throw e; }
  }
  const prepared = [];
  for (const row of rows) {
    const source = encounterCreature(row, library);
    if (!source) throw new Error(`Существо «${row.id}» недоступно. Исправьте состав встречи.`);
    if (!Number.isInteger(row.count) || row.count < 1 || row.count > 40) throw new Error('Во встрече допустимо от 1 до 40 существ каждого вида');
    const own = row.id.startsWith('libsrc:');
    const copy = own ? await preparedCopy(ctx, source) : null;
    prepared.push({ m: own ? toMonster(source) : source, copy, count: row.count });
  }
  if (ctx.sceneId !== sceneId || !ctx.root.isConnected) return [];
  const sc = structuredClone(ctx.scene), g = sc.grid, size = gridSize(g);
  const origin = at || viewCenter(ctx), made = [], copies = [];
  for (const { m, copy, count } of prepared) {
    if (copy) copies.push(copy);
    const n = sizeById(m.size).cells;
    const spots = freeSpots(sc, origin, count, n);
    if (spots.length !== count) throw new Error('На карте не хватает свободного места для всей встречи');
    for (const p of spots) {
      const c = Math.round((p.x - (g.offsetX || 0)) / size - n / 2), r = Math.round((p.y - (g.offsetY || 0)) / size - n / 2);
      const t = monsterToken(copy ? `lib:${copy.id}` : m.id, nextTokenName(sc, m.name), c, r, { ...g, size }, { hidden, ...(copy ? { img: copy.img } : {}) }, m);
      sc.tokens.push(t); made.push(t);
    }
  }
  if (!made.length) return [];
  const ids = new Set(made.map((t) => t.id));
  await commitCreatures(ctx, sceneId, made, copies, {
    label: label || 'Встреча',
    ...(isServerMode() ? { redoRemote: async () => {
      // После удаления Realtime может ещё держать старые строки. Повторяем по серверу, а не по этому кэшу.
      const { loadCampaign, persistCreatureTokens } = await import('../../server/sync.js');
      await loadCampaign(ctx.cid);
      await persistCreatureTokens(ctx.cid, sceneId, made);
      if (ctx.sceneId === sceneId) ctx.select([...ids]);
    } } : {}),
    // Снимки остаются: история повтора ссылается на них и на их картинки.
    undo: (s) => { s.tokens = s.tokens.filter((t) => !ids.has(t.id)); },
    redo: (s, c) => { for (const copy of copies) (c.creatures ||= {})[copy.id] = structuredClone(copy); s.tokens.push(...structuredClone(made)); },
  });
  if (ctx.sceneId === sceneId) {
    ctx.select([...ids]);
    ctx.toast({ title: `На карте: ${label || 'Встреча'} · ${made.length}`, body: hidden ? 'Скрыты от игроков' : 'Встреча поставлена', icon: 'monster' });
  }
  return [...ids];
}
