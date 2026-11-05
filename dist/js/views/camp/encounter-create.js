// Короткая карточка из встречи: сохраняет шаблон, не ставит токен на карту.
import { esc } from '../../core/dom.js';
import { modal, panelHeader, toast } from '../../ui/kit.js';
import { saveCreature, uploadLibraryImage } from '../../core/library.js';
import { SIZES } from '../../data/rules.js';
import { tokenFields, parseHp, intOrNull } from '../table/own-creature-num.js';
import { tokenImageEditor } from '../table/token-image.js';
import { creatureImgTag, hydrateCreatureImages, attachImageDrop, dropLibraryImages } from '../creature-img.js';

export function quickEncounterCreature({ name = '', onSave }) {
  let img = '', busy = false, saved = false, detach = () => {};
  const uploaded = new Set();
  const field = (key, label, placeholder = '') => `<label class="field"><span class="label">${label}</span><span class="input"><input data-field="${key}" placeholder="${placeholder}" ${key === 'name' ? `value="${esc(name)}" maxlength="40"` : ''}></span></label>`;
  const m = modal(`${panelHeader('Своё существо', 'Добавим во встречу и сохраним в «Мои существа»')}
    <div class="panel-section cc-body">
      <div class="row" style="gap:12px"><span class="avatar lg foe" data-face></span><button class="btn btn-secondary btn-sm" data-picture>Картинка токена</button></div>
      ${field('name', 'Имя', 'Страж')}
      <label class="field"><span class="label">Размер</span><span class="input"><select data-field="size">${SIZES.map((s) => `<option value="${s.id}" ${s.id === 'medium' ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></span></label>
      <div class="cc-grid">${field('ac', 'КД', '13')}${field('hp', 'Хиты', '9 или 2к8+2')}${field('speed', 'Скорость, фт', '30')}${field('init', 'Инициатива', '+2')}${field('cr', 'Опасность (ПО)', '1/4')}</div>
      <p class="t-xs muted">Числа необязательны. Атаки и остальные параметры можно добавить в «Моих существах».</p>
      <p class="t-sm cc-err" data-error hidden></p>
    </div><div class="panel-footer"><button class="btn btn-ghost" data-close>Отмена</button><span class="spacer"></span><button class="btn btn-primary" data-save>Добавить во встречу</button></div>`, {
    className: 'enc-creature-modal', dismissable: false,
    onClose: () => { detach(); if (!saved) dropLibraryImages([...uploaded]); },
  });
  const value = (key) => m.box.querySelector(`[data-field="${key}"]`).value.trim();
  const face = () => { m.box.querySelector('[data-face]').innerHTML = creatureImgTag(img, value('name')); hydrateCreatureImages(m.box); };
  const error = (e) => { const node = m.box.querySelector('[data-error]'); node.hidden = false; node.textContent = e.message || String(e); };
  const store = async (file) => { const ref = await uploadLibraryImage(file); uploaded.add(ref); if (!m.root.isConnected) dropLibraryImages([ref]); return ref; };
  face(); m.box.querySelector('[data-field="name"]').focus();
  m.box.querySelector('[data-field="name"]').addEventListener('input', face);
  m.box.querySelector('[data-picture]').addEventListener('click', () => {
    if (busy) return;
    tokenImageEditor({ ref: img, defaultRef: `ini:${value('name') || '?'}`, toast, store, done: (ref) => { img = ref; if (m.root.isConnected) face(); } });
  });
  detach = attachImageDrop(m.box, { toast, onFile: async (file) => {
    if (busy) return; busy = true;
    try { img = await store(file); if (m.root.isConnected) face(); } finally { busy = false; }
  } });
  m.box.querySelector('[data-save]').addEventListener('click', async () => {
    if (busy) return;
    const st = Object.fromEntries(['name', 'size', 'ac', 'hp', 'speed', 'init', 'cr'].map((k) => [k, value(k)]));
    const hp = parseHp(st.hp, () => 0.5);
    if (!st.name) { error(new Error('Нужно имя существа')); return; }
    if (Number.isNaN(hp) || ['ac', 'speed', 'init'].some((k) => Number.isNaN(intOrNull(st[k])))) { error(new Error('Проверьте числа. Хиты — число или формула вроде 2к8+2')); return; }
    busy = true; m.box.querySelectorAll('button, input, select').forEach((n) => { n.disabled = true; });
    try {
      const f = tokenFields(st, () => 0.5);
      const creature = await saveCreature({ name: st.name, size: st.size, img, ac: f.ac ?? null, hp: hp?.hp ?? null, hpFormula: hp?.formula || '', cr: st.cr || null, speed: { walk: f.speed ?? null }, stats: { dex: f.initBonus == null ? null : Math.max(1, Math.min(30, 10 + 2 * f.initBonus)) } });
      saved = true; dropLibraryImages([...uploaded].filter((r) => r !== creature.img));
      onSave(creature); m.close();
    } catch (e) { error(e); }
    finally { busy = false; if (m.root.isConnected) m.box.querySelectorAll('button, input, select').forEach((n) => { n.disabled = false; }); }
  });
}
