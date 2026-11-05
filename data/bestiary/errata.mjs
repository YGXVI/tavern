// #196 A: воспроизводимые поправки к снимку SRD API (errata.json). Чистая функция: возвращает копию каталога.
// Поправка применяется, только если в снимке ровно её 'from' — иначе ошибка: снимок изменился, поправку пересмотреть.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function applyErrata(catalogue, errata, { partial = false } = {}) {
  const out = structuredClone(catalogue);
  const byIndex = new Map(out.monsters.filter((m) => m.identity?.srd_index && m.stat_block).map((m) => [m.identity.srd_index, m]));
  for (const e of errata.entries) {
    const m = byIndex.get(e.srd_index);
    if (!m) { if (partial) continue; throw new Error(`errata: нет записи SRD ${e.srd_index}`); }
    let node = m.stat_block;
    for (const k of e.path.slice(0, -1)) node = node?.[k];
    const key = e.path.at(-1);
    if (!node || !same(node[key], e.from)) throw new Error(`errata: ${e.srd_index}.${e.path.join('.')} = ${JSON.stringify(node?.[key])}, ожидалось ${JSON.stringify(e.from)} — снимок изменился`);
    node[key] = structuredClone(e.to);
  }
  return out;
}
