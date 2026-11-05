// Кадр сохраняется обычной картинкой: карта и все миниатюры показывают один результат.
import { modal, panelHeader } from '../../ui/kit.js';
import { imageUrl, pickImageFile } from '../creature-img.js';

export function imagePlacement(width, height, zoom = 1, x = 0, y = 0) {
  const scale = Math.max(1 / width, 1 / height) * zoom;
  return { width: width * scale, height: height * scale, x: (1 - width * scale) / 2 + x, y: (1 - height * scale) / 2 + y };
}

/** done(ref, file): file нужен также при сохранении существа в личную библиотеку. */
export function tokenImageEditor({ ref = '', defaultRef = '', title = 'Картинка токена', toast, store, done }) {
  let img = null, sourceRef = ref, localUrl = '', zoom = 1, x = 0, y = 0;
  let revision = 0, dirty = false, saving = false, drag = null;
  const m = modal(`${panelHeader(title, 'Перетащите картинку и выберите масштаб')}
    <div class="panel-section token-image-editor">
      <canvas width="512" height="512" data-preview role="img" aria-label="Предпросмотр круглого токена"></canvas>
      <p class="t-sm muted" data-status aria-live="polite">Загрузка картинки…</p>
      <label class="field">Масштаб<input class="slider" data-zoom type="range" min="0.1" max="8" step="0.01" value="1" aria-label="Масштаб картинки"></label>
      <div class="row"><button class="btn btn-sm btn-secondary" data-fit>Вписать целиком</button><button class="btn btn-sm btn-secondary" data-center>По центру</button></div>
      <div class="grid-2"><label class="field">По горизонтали<input class="slider" data-x type="range" min="-2" max="2" step="0.01" value="0"></label><label class="field">По вертикали<input class="slider" data-y type="range" min="-2" max="2" step="0.01" value="0"></label></div>
      <div class="row"><button class="btn btn-sm btn-secondary" data-upload>Загрузить другую</button>${defaultRef ? '<button class="btn btn-sm btn-ghost" data-default>Вернуть стандартную</button>' : ''}</div>
    </div><div class="panel-footer"><button class="btn btn-ghost" data-close>Отмена</button><span class="spacer"></span><button class="btn btn-primary" data-save disabled>Сохранить</button></div>`, {
    className: 'token-image-modal',
    onClose: () => { revision++; if (localUrl) URL.revokeObjectURL(localUrl); },
  });
  const box = m.box, canvas = box.querySelector('[data-preview]'), save = box.querySelector('[data-save]');
  const status = box.querySelector('[data-status]');
  const sliders = ['zoom', 'x', 'y'].map((k) => box.querySelector(`[data-${k}]`));
  const sync = () => { [zoom, x, y].forEach((v, i) => { sliders[i].value = v; }); };
  function draw(target = canvas) {
    const c = target.getContext('2d');
    c.clearRect(0, 0, target.width, target.height);
    if (!img) return;
    const p = imagePlacement(img.naturalWidth, img.naturalHeight, zoom, x, y);
    c.drawImage(img, p.x * target.width, p.y * target.height, p.width * target.width, p.height * target.height);
  }
  async function load(nextRef, file = null) {
    const current = ++revision;
    img = null; save.disabled = true; status.textContent = 'Загрузка картинки…'; draw();
    try {
      if (localUrl) { URL.revokeObjectURL(localUrl); localUrl = ''; }
      const url = file ? (localUrl = URL.createObjectURL(file)) : await imageUrl(nextRef);
      if (current !== revision || !m.root.isConnected) return;
      if (!url) throw new Error('Картинка недоступна. Загрузите другой файл.');
      const next = new Image(); next.crossOrigin = 'anonymous'; next.src = url;
      await next.decode();
      if (current !== revision || !m.root.isConnected) return;
      img = next; sourceRef = nextRef; zoom = 1; x = y = 0; dirty = !!file;
      sync(); draw(); save.disabled = false; status.textContent = 'Можно двигать мышью, пальцем или ползунками.';
    } catch (err) { if (current === revision && m.root.isConnected) status.textContent = err.message; }
  }
  box.addEventListener('input', (e) => {
    if (!sliders.includes(e.target) || saving) return;
    [zoom, x, y] = sliders.map((s) => Number(s.value)); dirty = true; draw();
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (!img || saving || e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: x, oy: y };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId || saving) return;
    const r = canvas.getBoundingClientRect();
    x = Math.max(-2, Math.min(2, drag.ox + (e.clientX - drag.x) / r.width));
    y = Math.max(-2, Math.min(2, drag.oy + (e.clientY - drag.y) / r.height));
    dirty = true; sync(); draw();
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(ev, () => { drag = null; });
  box.addEventListener('click', async (e) => {
    if (saving) return;
    if (e.target.closest('[data-upload]')) pickImageFile(toast, (file) => { if (m.root.isConnected) load('', file); });
    if (e.target.closest('[data-default]')) load(defaultRef);
    if (e.target.closest('[data-center]') && img) { zoom = 1; x = y = 0; dirty = true; sync(); draw(); }
    if (e.target.closest('[data-fit]') && img) {
      // Весь прямоугольник помещается внутри круга, включая углы.
      zoom = Math.max(0.001, Math.min(img.naturalWidth, img.naturalHeight) / Math.hypot(img.naturalWidth, img.naturalHeight));
      sliders[0].min = Math.min(0.1, zoom); x = y = 0; dirty = true; sync(); draw();
    }
    if (!e.target.closest('[data-save]') || !img) return;
    saving = true; save.disabled = true;
    try {
      let nextRef = sourceRef, file = null;
      if (dirty) {
        const output = document.createElement('canvas'); output.width = output.height = 512; draw(output);
        const blob = await new Promise((resolve) => output.toBlob(resolve, 'image/webp', 0.92));
        if (!blob) throw new Error('Не удалось сохранить картинку.');
        file = new File([blob], 'token.webp', { type: blob.type });
        nextRef = await store(file);
      }
      if (m.root.isConnected) { done(nextRef, file); m.close(); }
    } catch (err) { status.textContent = err.message; }
    finally { saving = false; if (m.root.isConnected) save.disabled = false; }
  });
  box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') m.close(); });
  if (ref) load(ref); else status.textContent = 'Загрузите PNG, JPEG или WebP до 5 МБ.';
  return m;
}
