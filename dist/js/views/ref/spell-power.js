// Сила заклинания по английскому тексту SRD 5.1 (#203): кости урона или лечения, рост по ячейке и уровню героя,
// чем бьёт — атакой заклинанием или спасброском. Общее для справочника (ползунок ячейки) и листа героя (чипы атаки).
const ORD = (n) => Number(String(n).replace(/\D/g, ''));
export function powerOf(it) {
  const t = it.srdText; if (!t) return null;
  const body = t.text.slice(0, 2).join(' '); // урон из побочных эффектов дальше по тексту (как у «Исполнения желаний») не считаем
  const m = body.match(/(\d+)d(\d+)(?:\s*\+\s*(\d+))?\s+(?:(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)\s+)?damage/i)
    || body.match(/regains? (?:a number of )?hit points equal to (\d+)d(\d+)(?:\s*\+\s*(?:your spellcasting ability modifier|(\d+)))?/i);
  if (!m) return null;
  const heal = /hit points/i.test(m[0]);
  const base = { n: Number(m[1]), d: Number(m[2]), plus: Number(m[3]) || 0, type: heal ? null : (m[4] || '').toLowerCase(), heal, mod: heal && /spellcasting ability modifier/i.test(m[0]) };
  if (!it.level) {
    const all = t.text.join(' ');
    const c = /increases by (\d+)d(\d+) when you reach 5th level/i.test(all) || /two beams at 5th level/i.test(all);
    return c ? { ...base, cantrip: true } : { ...base, cantrip: true, flat: true };
  }
  // Несколько снарядов: «три дротика», «три луча» — и ещё по одному за круг выше.
  const many = body.match(/\b(two|three|four)\s+(?:glowing\s+)?(darts|rays)\b/i);
  const more = (t.higher || '').match(/one (?:more|additional) (?:dart|ray) for each slot level above (\d+)/i);
  if (many && more) return { ...base, darts: { base: { two: 2, three: 3, four: 4 }[many[1].toLowerCase()], from: ORD(more[1]), word: /dart/i.test(many[2]) ? 'дротик' : 'луч' } };
  const h = (t.higher || '').match(/increases by (\d+)d(\d+) for (?:each|every) (?:(two) )?slot levels? above (\d+)/i);
  return { ...base, step: h ? { n: Number(h[1]), every: h[3] ? 2 : 1, from: ORD(h[4]) } : null };
}
export const DMG = { acid: 'кислота', bludgeoning: 'дробящий', cold: 'холод', fire: 'огонь', force: 'силовое поле', lightning: 'электричество', necrotic: 'некротическая энергия', piercing: 'колющий', poison: 'яд', psychic: 'психическая энергия', radiant: 'излучение', slashing: 'рубящий', thunder: 'звук' };
export function diceAt(p, it, v) {
  if (p.darts) { const k = p.darts.base + Math.max(0, v - p.darts.from); return { n: p.n * k, d: p.d, plus: p.plus * k, avg: k * (p.n * (p.d + 1) / 2 + p.plus), k }; }
  let n = p.n;
  if (p.cantrip && !p.flat) n = p.n * (1 + (v >= 5) + (v >= 11) + (v >= 17));
  else if (p.step && v > p.step.from) n = p.n + p.step.n * Math.floor((v - p.step.from) / p.step.every);
  return { n, d: p.d, plus: p.plus, avg: n * (p.d + 1) / 2 + p.plus };
}


const SAVE = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };
/** Чем бьёт заклинание: { attack: 'melee'|'ranged' } или { save: 'dex' } или null — по первым абзацам SRD. */
export function castKind(srdText) {
  const body = (srdText?.text || []).slice(0, 2).join(' ');
  const atk = body.match(/make a (melee|ranged) spell attack/i);
  if (atk) return { attack: atk[1].toLowerCase() };
  const sv = body.match(/(strength|dexterity|constitution|intelligence|wisdom|charisma) saving throw/i);
  return sv ? { save: SAVE[sv[1].toLowerCase()] } : null;
}
/** Кости заклинания на уровне героя (заговор) или на своём круге: «2к8», «3 × 1к4+1», «1к8 + мод.» или ''. */
export function diceText(srdText, level, heroLevel = 1) {
  const p = powerOf({ srdText, level });
  if (!p) return '';
  const x = diceAt(p, { level }, level ? level : heroLevel);
  if (p.darts) return `${x.k} × ${p.n}к${p.d}${p.plus ? `+${p.plus}` : ''}`;
  return `${x.n}к${x.d}${x.plus ? `+${x.plus}` : ''}${p.mod ? ' + мод.' : ''}`;
}
