// Числа карточки «своего существа» (#190 E): разбор полей, бросок хитов по формуле, что поправил мастер.
// Без DOM — покрыто тестами (tests/own-creature.test.js).
import { roll } from '../../../engine.js';

/** «13» → 13, «» → null, мусор → NaN. */
export const intOrNull = (v) => { const s = String(v ?? '').trim().replace(/^\+/, '').replace('−', '-'); return s === '' ? null : /^-?\d{1,4}$/.test(s) ? Number(s) : NaN; };
/** Хиты: число или формула «2к8+2» — бросок; {hp, formula} или null (пусто) или NaN (мусор). */
export function parseHp(v, random) {
  const s = String(v ?? '').trim().replace(/\s/g, '').replace(/к/gi, 'd');
  if (!s) return null;
  if (/^\d{1,4}$/.test(s)) return { hp: Number(s), formula: '' };
  if (!/^\d{0,3}d\d{1,3}([+-]\d{1,4})?$/i.test(s)) return NaN;
  try { return { hp: Math.max(1, roll(s, random).total), formula: s }; } catch { return NaN; }
}
/** Поля токена из карточки: только заданные числа (пустые — мастер заполнит). */
export function tokenFields(st, random) {
  const out = {};
  const ac = intOrNull(st.ac), sp = intOrNull(st.speed), fly = intOrNull(st.fly), ini = intOrNull(st.init), hp = parseHp(st.hp, random);
  if (Number.isFinite(ac)) out.ac = Math.max(0, Math.min(40, ac));
  if (hp && Number.isFinite(hp.hp)) { out.hp = hp.hp; out.hpMax = hp.hp; }
  if (Number.isFinite(sp)) out.speed = Math.max(0, Math.min(500, sp));
  if (Number.isFinite(fly) && fly > 0) out.fly = Math.min(500, fly);
  if (Number.isFinite(ini)) out.initBonus = Math.max(-10, Math.min(20, ini));
  return out;
}
/** Что мастер поправил: «КД 13 → 12, хиты 4 → 6». */
export function diffNumbers(a, b) {
  const names = [['ac', 'КД'], ['hpMax', 'хиты'], ['speed', 'скорость'], ['initBonus', 'инициатива']];
  return names.filter(([k]) => (a?.[k] ?? null) !== (b?.[k] ?? null)).map(([k, l]) => `${l} ${a?.[k] ?? '—'} → ${b?.[k] ?? '—'}`).join(', ');
}

