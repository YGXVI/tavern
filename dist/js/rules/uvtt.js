// Импорт карт Universal VTT (.dd2vtt из Dungeondraft, .uvtt, .df2vtt): картинка, сетка, стены, двери, свет.
// Чистые функции: разбор JSON в данные сцены «Распутья». Координаты файла — в клетках, у нас — в пикселях карты.

const round = (v) => Math.round(v * 10) / 10;

/** Цвет источника ARGB/RGB «ffeccd8b» → наш пресет света: тёплый, холодный или магия. */
export function lightPresetColor(hex) {
  const h = String(hex || '').replace(/^#/, '');
  const rgb = h.length >= 8 ? h.slice(2, 8) : h.slice(0, 6);
  const r = parseInt(rgb.slice(0, 2), 16), g = parseInt(rgb.slice(2, 4), 16), b = parseInt(rgb.slice(4, 6), 16);
  if (![r, g, b].every(Number.isFinite)) return 'warm';
  if (b > r + 30 && b > g) return r > g ? 'magic' : 'cold';
  return 'warm';
}

/**
 * Разобрать файл Universal VTT. feet — сколько футов в клетке.
 * Возвращает {width, height, ppg, walls[], lights[], image: {base64, mime} | null, counts}.
 * Бросает Error с понятным текстом, если это не карта Universal VTT.
 */
export function parseUniversalVTT(json, { feet = 5, uid = () => Math.random().toString(36).slice(2, 10) } = {}) {
  const d = typeof json === 'string' ? JSON.parse(json) : json;
  const res = d?.resolution;
  const ppg = Number(res?.pixels_per_grid);
  if (!res || !ppg || !res.map_size) throw new Error('Это не карта Universal VTT (.dd2vtt): нет размера и сетки.');
  const ox = Number(res.map_origin?.x) || 0, oy = Number(res.map_origin?.y) || 0;
  const P = (p) => ({ x: round((Number(p.x) - ox) * ppg), y: round((Number(p.y) - oy) * ppg) });
  const width = Math.round(Number(res.map_size.x) * ppg), height = Math.round(Number(res.map_size.y) * ppg);
  const walls = [];
  const addLine = (pts, kind = 'wall') => {
    for (let i = 1; i < (pts?.length || 0); i++) {
      const a = P(pts[i - 1]), b = P(pts[i]);
      if (Math.hypot(a.x - b.x, a.y - b.y) < 1) continue;
      walls.push({ id: `w-${uid()}`, a, b, kind, open: false, locked: false });
    }
  };
  for (const line of d.line_of_sight || []) addLine(line);
  for (const line of d.objects_line_of_sight || []) addLine(line);
  let doors = 0;
  for (const p of d.portals || []) {
    const [a, b] = p.bounds || [];
    if (!a || !b) continue;
    walls.push({ id: `w-${uid()}`, a: P(a), b: P(b), kind: 'door', open: p.closed === false, locked: false });
    doors++;
  }
  const lights = [];
  for (const l of d.lights || []) {
    if (!l.position) continue;
    const total = Math.max(5, Math.round((Number(l.range) || 4) * feet / 5) * 5);
    const bright = Math.max(5, Math.round(total / 2 / 5) * 5);
    const pos = P(l.position);
    lights.push({ id: `l-${uid()}`, x: Math.round(pos.x), y: Math.round(pos.y), preset: 'torch', name: 'Свет из карты', bright, dim: Math.max(0, total - bright), color: lightPresetColor(l.color), flicker: false });
  }
  let image = null;
  if (typeof d.image === 'string' && d.image.length > 32) {
    const base64 = d.image.replace(/^data:[^,]+,/, '');
    const mime = base64.startsWith('iVBOR') ? 'image/png' : base64.startsWith('UklGR') ? 'image/webp' : base64.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
    image = { base64, mime };
  }
  return { width, height, ppg, walls, lights, image, counts: { walls: walls.length - doors, doors, lights: lights.length } };
}

/** Пересчитать сцену под уменьшенную картинку (если карта больше 6000 px). */
export function scaleImport(data, k) {
  if (k === 1) return data;
  const S = (p) => ({ x: round(p.x * k), y: round(p.y * k) });
  return {
    ...data,
    width: Math.round(data.width * k), height: Math.round(data.height * k), ppg: data.ppg * k,
    walls: data.walls.map((w) => ({ ...w, a: S(w.a), b: S(w.b) })),
    lights: data.lights.map((l) => ({ ...l, x: Math.round(l.x * k), y: Math.round(l.y * k) })),
  };
}
