import { placeEncounter, placeEncounterRows } from './encounters.js';
// Стол и дом кампании (#203): действия из дома по адресу #/c/<кампания>/do/<действие>/…, Ctrl K — справочник,
// перенос заметок игроков из журнала в книгу кампании клиентом мастера.
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
      await placeEncounter(ctx, enc.id, { fight: b === 'fight' });
    }
  }
  return { fromHash, unmount() { offSub(); removeEventListener('keydown', onKey); } };
}

async function placeMonsters(ctx, rows, opts) { return placeEncounterRows(ctx, rows, opts); }
