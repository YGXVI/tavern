// Время сессии записи: монотонные часы процесса от старта + UTC-метка старта.
import { performance } from 'node:perf_hooks';

/** Часы сессии. `elapsed()` — миллисекунды от старта, не зависят от перевода системных часов. */
export function createClock({ now = () => performance.now(), wall = () => Date.now() } = {}) {
  const t0 = now();
  const startedAt = new Date(wall());
  return {
    startedAtUtc: startedAt.toISOString(),
    elapsed: () => Math.max(0, Math.round(now() - t0)),
  };
}

/** 3723456 → "01:02:03.456". */
export function formatOffset(ms) {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const rest = total % 1000;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}.${p(rest, 3)}`;
}

/** Имя каталога сессии: 20261102-153000-<guildId> (время UTC). */
export function sessionDirName(isoUtc, guildId) {
  const stamp = isoUtc.replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `${stamp}-${guildId}`;
}
