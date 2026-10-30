// Камера стола: панорамирование и масштаб мира через CSS transform.
// Экран = мир × z + (x, y). Масштаб вокруг курсора, плавные перелёты для «Смотрите сюда».
import { clamp } from '../../core/dom.js';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 6;

export class Camera {
  constructor(viewport, world, onChange) {
    this.vp = viewport;
    this.world = world;
    this.x = 0; this.y = 0; this.z = 1;
    this.onChange = onChange;
    this.anim = null;
    this.raf = 0;
  }

  get size() { return { w: this.vp.clientWidth, h: this.vp.clientHeight }; }

  apply() {
    // Пока камера движется — отдельный слой (плавно); через миг покоя — обычный transform без will-change,
    // чтобы браузер перерисовал карту и токены в чёткости текущего масштаба (TASK-045).
    this.world.style.transform = `translate3d(${this.x}px, ${this.y}px, 0) scale(${this.z})`;
    this.world.style.willChange = 'transform';
    clearTimeout(this.settle);
    this.settle = setTimeout(() => {
      this.world.style.willChange = 'auto';
      this.world.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.z})`;
    }, 160);
    this.world.style.setProperty('--z', this.z);
    this.world.style.setProperty('--iz', 1 / this.z);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.onChange?.(this));
  }

  toWorld(sx, sy) {
    const r = this.vp.getBoundingClientRect();
    return { x: (sx - r.left - this.x) / this.z, y: (sy - r.top - this.y) / this.z };
  }

  toScreen(wx, wy) {
    const r = this.vp.getBoundingClientRect();
    return { x: wx * this.z + this.x + r.left, y: wy * this.z + this.y + r.top };
  }

  stop() { if (this.anim) { cancelAnimationFrame(this.anim); this.anim = null; } this.goal = null; }

  set(x, y, z) { this.stop(); this.x = x; this.y = y; this.z = clamp(z, MIN_ZOOM, MAX_ZOOM); this.apply(); }

  pan(dx, dy) { this.stop(); this.x += dx; this.y += dy; this.apply(); }

  /** Масштаб вокруг экранной точки (клиентские координаты). */
  zoomAt(sx, sy, factor) {
    this.stop();
    const r = this.vp.getBoundingClientRect();
    const px = sx - r.left, py = sy - r.top;
    const nz = clamp(this.z * factor, MIN_ZOOM, MAX_ZOOM);
    const k = nz / this.z;
    this.x = px - (px - this.x) * k;
    this.y = py - (py - this.y) * k;
    this.z = nz;
    this.apply();
  }

  zoomStep(dir) {
    const { w, h } = this.size;
    const r = this.vp.getBoundingClientRect();
    const steps = [0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4, 6];
    // Шаг считаем от масштаба, к которому камера уже летит: быстрые нажатия «−»/«+» складываются (TASK-034).
    const cur = this.goal?.z ?? this.z;
    let target = cur;
    if (dir > 0) target = steps.find((s) => s > cur + 0.001) ?? MAX_ZOOM;
    else target = [...steps].reverse().find((s) => s < cur - 0.001) ?? MIN_ZOOM;
    this.animateZoom(r.left + w / 2, r.top + h / 2, target);
  }

  animateZoom(sx, sy, target, ms = 180) {
    const r = this.vp.getBoundingClientRect();
    const px = sx - r.left, py = sy - r.top;
    const wx = (px - this.x) / this.z, wy = (py - this.y) / this.z;
    const nz = clamp(target, MIN_ZOOM, MAX_ZOOM);
    this.animateTo(px - wx * nz, py - wy * nz, nz, ms);
  }

  /** Плавно показать прямоугольник мира целиком. */
  fit(rect, pad = 80, animate = false, insetTop = 0, insetBottom = 0) {
    const { w, h } = this.size;
    const availH = Math.max(100, h - insetTop - insetBottom);
    const z = clamp(Math.min((w - pad * 2) / rect.w, (availH - pad * 2) / rect.h), MIN_ZOOM, MAX_ZOOM);
    const x = (w - rect.w * z) / 2 - rect.x * z;
    const y = insetTop + (availH - rect.h * z) / 2 - rect.y * z;
    if (animate) this.animateTo(x, y, z); else this.set(x, y, z);
  }

  /** Поставить точку мира в центр экрана. */
  centerOn(wx, wy, z = this.z, animate = true) {
    const { w, h } = this.size;
    const x = w / 2 - wx * z, y = h / 2 - wy * z;
    if (animate) this.animateTo(x, y, z, 420); else this.set(x, y, z);
  }

  animateTo(x, y, z, ms = 260) {
    this.stop();
    this.goal = { x, y, z };
    const from = { x: this.x, y: this.y, z: this.z };
    const t0 = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms), k = ease(t);
      // Масштаб интерполируем логарифмически — так перелёт выглядит ровно.
      this.z = Math.exp(Math.log(from.z) + (Math.log(z) - Math.log(from.z)) * k);
      this.x = from.x + (x - from.x) * k;
      this.y = from.y + (y - from.y) * k;
      this.apply();
      this.anim = t < 1 ? requestAnimationFrame(step) : null;
      if (t >= 1) this.goal = null;
    };
    this.anim = requestAnimationFrame(step);
  }

  /** Видимая область мира. */
  viewRect() {
    const { w, h } = this.size;
    return { x: -this.x / this.z, y: -this.y / this.z, w: w / this.z, h: h / this.z };
  }
}
