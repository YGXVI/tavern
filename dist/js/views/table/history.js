// Отмена и повтор действий на сцене. Каждое действие хранит обратную операцию,
// поэтому «Отменить» не перетирает чужие изменения, сделанные в это время.
import { updateScene } from '../../core/campaign.js';

export class History {
  constructor() { this.done = []; this.undone = []; this.pending = false; }
  push(entry) { this.done.push(entry); if (this.done.length > 80) this.done.shift(); this.undone = []; }
  get canUndo() { return !this.pending && this.done.length > 0; }
  get canRedo() { return !this.pending && this.undone.length > 0; }
  undo(ctx) {
    if (this.pending) return null;
    const e = this.done.pop(); if (!e) return null;
    updateScene(ctx.cid, e.sceneId, (s, c) => e.undo(s, c));
    this.undone.push(e);
    return e;
  }
  redo(ctx) {
    if (this.pending) return null;
    const e = this.undone.pop(); if (!e) return null;
    if (e.redoRemote) {
      this.pending = true;
      Promise.resolve().then(() => e.redoRemote(ctx)).then(() => {
        this.done.push(e);
        ctx.toast({ title: `Повторено: ${e.label || 'действие'}`, icon: 'redo-02' });
      }, (error) => {
        this.undone.push(e);
        ctx.toast({ title: 'Не удалось повторить', body: error.message || String(error), icon: 'alert-circle' });
      }).finally(() => { this.pending = false; ctx.invalidate('chrome'); });
      return null;
    }
    updateScene(ctx.cid, e.sceneId, (s, c) => e.redo(s, c));
    this.done.push(e);
    return e;
  }
}

/** Помощник: снимок части сцены до и после изменения (для небольших массивов: стены, свет, туман). */
export function snapshotUndo(label, field) {
  let before = null, after = null;
  return {
    label,
    capture(scene) { before = structuredClone(scene[field]); },
    finish(scene) { after = structuredClone(scene[field]); },
    entry() {
      const b = before, a = after;
      return { label, undo: (s) => { s[field] = structuredClone(b); }, redo: (s) => { s[field] = structuredClone(a); } };
    },
  };
}
