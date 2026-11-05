// Стол и дом кампании (#203): действия из дома по адресу #/c/<кампания>/do/<действие>/…, Ctrl K — справочник,
// перенос заметок игроков из журнала в книгу кампании клиентом мастера.
import { freeSpots, gridSize } from '../../rules/geometry.js';
import { monsterToken } from '../../data/demo.js';
import { monsterById, loadSrdBestiary } from '../../data/bestiary.js';
import { nextTokenName } from '../../core/campaign.js';
import { sizeById } from '../../data/rules.js';
import { subscribe } from '../../core/store.js';
import { startSession, foldInbox } from '../camp/book-store.js';
import { encounterById } from '../camp/encounters.js';

export function mountHomeHooks(ctx) {
  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') { e.preventDefault(); import('../ref/table-ref.js').then((m) => m.openTableReference(ctx)); }
  };
  addEventListener('keydown', onKey);
  // Журнал хранит только последние записи — мастер за столом сразу переносит заметки игроков в книгу.
  const fold = () => { if (ctx.isMaster) foldInbox(ctx.cid, ctx.userId); };
  const offSub = subscribe(fold);
  fold();

  // ——— Действия из дома кампании ———
  function fromHash() {
    const m = location.hash.match(/^#\/c\/([^/]+)\/do\/([a-z-]+)(?:\/([^/?#]+))?(?:\/([^/?#]+))?/);
    if (!m || m[1] !== ctx.cid) return;
    const [, , act, a, b] = m;
    const arg = a ? decodeURIComponent(a) : null;
    history.replaceState(null, '', `#/c/${ctx.cid}`);
    if (!ctx.isMaster) return;
    run(act, arg, b).catch((err) => ctx.toast({ title: 'Не получилось', body: err.message || String(err), icon: 'alert-circle' }));
  }
  async function run(act, arg, b) {
    const P = await import('./p-side.js');
    if (act === 'scenes') ctx.panels.toggleSide('scenes');
    if (act === 'new-scene') P.newSceneModal(ctx);
    if (act === 'edit' && arg) { ctx.switchScene(arg); ctx.toast({ title: 'Вы смотрите сцену', body: 'Игроки её не видят, пока вы её не покажете', icon: 'view' }); }
    if (act === 'show' && arg) P.activateScene(ctx, arg);
    if (act === 'start') {
      startSession(ctx.cid);
      if (arg && arg !== ctx.c.activeSceneId) P.activateScene(ctx, arg); else if (arg) ctx.switchScene(arg);
      ctx.toast({ title: 'Игра началась', body: 'Игроки увидят, что сессия идёт', icon: 'play' });
    }
    if (act === 'place' && arg) await placeMonsters(ctx, [{ id: arg, count: 1 }], { hidden: true });
    if (act === 'encounter' && arg) {
      const enc = encounterById(ctx.cid, ctx.userId, arg);
      if (!enc) { ctx.toast({ title: 'Встреча не найдена', body: 'Встречи хранятся на устройстве, где их собрали', icon: 'alert-circle' }); return; }
      if (enc.sceneId && enc.sceneId !== ctx.sceneId && ctx.c.scenes.some((s) => s.id === enc.sceneId)) ctx.switchScene(enc.sceneId);
      const ids = await placeMonsters(ctx, enc.monsters, { hidden: enc.opts?.hidden !== false, label: enc.name });
      if (ids.length && (b === 'fight' || enc.opts?.combat)) ctx.panels.combatToggle(ids);
    }
  }
  return { fromHash, unmount() { offSub(); removeEventListener('keydown', onKey); } };
}

/** Поставить существ из бестиария на текущую сцену у центра экрана. Возвращает id новых токенов. */
async function placeMonsters(ctx, rows, { hidden = true, label = '' } = {}) {
  await loadSrdBestiary().catch(() => null);
  const sc0 = ctx.scene; if (!sc0) { ctx.toast({ title: 'Сначала создайте сцену', icon: 'maps' }); return []; }
  const { viewCenter, commitCreatures } = await import('./p-side.js');
  const sceneId = ctx.sceneId;
  const at = viewCenter(ctx);
  const sc = structuredClone(sc0);
  const g = sc.grid, s = gridSize(g);
  const made = [];
  for (const row of rows) {
    const m = monsterById(row.id); if (!m) continue;
    const n = sizeById(m.size).cells;
    for (const p of freeSpots(sc, at, row.count, n)) {
      const c0 = Math.round((p.x - (g.offsetX || 0)) / s - n / 2), r0 = Math.round((p.y - (g.offsetY || 0)) / s - n / 2);
      const t = monsterToken(m.id, nextTokenName(sc, m.name), c0, r0, { ...g, size: s }, { hidden }, m);
      sc.tokens.push(t); made.push(t);
    }
  }
  if (!made.length) return [];
  await commitCreatures(ctx, sceneId, made, null, {
    label: label || 'Существа',
    undo: (x) => { const ids = new Set(made.map((t) => t.id)); x.tokens = x.tokens.filter((t) => !ids.has(t.id)); },
    redo: (x) => { for (const t of made) x.tokens.push(structuredClone(t)); },
  });
  ctx.select?.(made.map((t) => t.id));
  ctx.toast({ title: `На карте: ${label ? `«${label}» · ` : ''}${made.length} ${made.length === 1 ? 'существо' : made.length < 5 ? 'существа' : 'существ'}`, body: hidden ? 'Скрыто от игроков — откройте, когда придёт время' : 'Игроки видят, если в обзоре героев', icon: 'monster' });
  return made.map((t) => t.id);
}

