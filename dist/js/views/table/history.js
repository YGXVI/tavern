// Отмена и повтор действий на сцене. Каждое действие хранит обратную операцию,
// поэтому «Отменить» не перетирает чужие изменения, сделанные в это время.
import { updateScene } from '../../core/campaign.js';

export class History {
  constructor() { this.done = []; this.undone = []; }
  push(entry) { this.done.push(entry); if (this.done.length > 80) this.done.shift(); this.undone = []; }
  get canUndo() { return this.done.length > 0; }
  get canRedo() { return this.undone.length > 0; }
  undo(ctx) {
    const e = this.done.pop(); if (!e) return null;
    updateScene(ctx.cid, e.sceneId, (s, c) => e.undo(s, c));
    this.undone.push(e);
    return e;
  }
  redo(ctx) {
    const e = this.undone.pop(); if (!e) return null;
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
