import { attachImageDrop, imageFileName } from '../creature-img.js';
import { storeTokenImage } from './p-token.js';
import { creatureCard } from './own-creature.js';

/** Внешняя картинка на карте — черновик существа в точке отпускания. */
export function attachCreatureFileDrop(ctx) {
  let loading = false;
  return attachImageDrop(ctx.root, {
    toast: ctx.toast,
    accepts: (e) => !!ctx.scene && !!e.target.closest?.('.viewport'),
    onFile: async (file, e) => {
      if (loading) return;
      loading = true;
      const sceneId = ctx.sceneId, at = ctx.camera.toWorld(e.clientX, e.clientY);
      const dismiss = ctx.toast({ title: 'Загружаю картинку…', icon: 'hourglass', timeout: 0 });
      try {
        const img = await storeTokenImage(ctx, file);
        if (ctx.root.isConnected && ctx.sceneId === sceneId) creatureCard(ctx, { at, name: imageFileName(file).slice(0, 40), img, file });
      } finally { loading = false; dismiss?.(); }
    },
  });
}
