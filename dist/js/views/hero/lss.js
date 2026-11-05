// Перенос героя из Long Story Short (экран 72, #203): файл .json из LSS → герой в формате листа (docs/data.md, старые
// поля: stats, saves, skills, attacks, slots, текстовые spells/inventory/features). Разбор терпимый: чего нет или что не
// узнали — не выдумываем, а показываем пунктом «посмотрите» с решением игрока.
import { ABILITIES, SKILLS, CLASSES, RACES } from '../../data/rules.js';

// Навыки LSS (английские ключи) → наши ID.
const SKILL_KEY = { acrobatics: 'acrobatics', 'animal handling': 'animal', animalhandling: 'animal', arcana: 'arcana', athletics: 'athletics', deception: 'deception', history: 'history', insight: 'insight', intimidation: 'intimidation', investigation: 'investigation', medicine: 'medicine', nature: 'nature', perception: 'perception', performance: 'performance', persuasion: 'persuasion', religion: 'religion', 'sleight of hand': 'sleight', sleightofhand: 'sleight', stealth: 'stealth', survival: 'survival' };
const val = (x) => (x && typeof x === 'object' && 'value' in x ? x.value : x);
const num = (x) => { const n = Number(String(val(x) ?? '').replace(/[^\d−+-]/g, '').replace('−', '-')); return Number.isFinite(n) ? n : null; };
const str = (x) => { const v = val(x); return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''; };

/** Текст из поля LSS: строка или документ редактора (ProseMirror: {data: {content: [...]}}) — абзацами. */
export function lssText(x) {
  const v = val(x);
  if (typeof v === 'string') return v.trim();
  const doc = v?.data ?? v;
  const out = [];
  const walk = (n, line) => {
    if (!n) return line;
    if (typeof n.text === 'string') return line + n.text;
    let cur = line;
    for (const c of n.content || []) cur = walk(c, cur);
    if (['paragraph', 'heading', 'listItem', 'list_item'].includes(n.type)) { if (cur.trim()) out.push(cur.trim()); return ''; }
    return cur;
  };
  const rest = walk(doc, '');
  if (rest.trim()) out.push(rest.trim());
  return out.join('\n');
}

const byName = (list, name) => {
  const n = String(name || '').toLowerCase().replace(/ё/g, 'е');
  if (!n) return null;
  return list.find((x) => { const k = x.name.toLowerCase().replace(/ё/g, 'е'); return n === k || n.startsWith(k.slice(0, Math.max(4, k.length - 2))); }) || null;
};

/**
 * Разобрать файл LSS. Возвращает { hero, matched: {ok, of, text}, issues: [{kind, title, text, key}], summary } или бросает
 * ошибку с понятным текстом, если это не лист LSS.
 */
export function parseLss(text, { fileName = '', spellNames = null } = {}) {
  let outer;
  try { outer = JSON.parse(text); } catch { throw new Error('Это не JSON — выгрузите лист из Long Story Short кнопкой «Экспорт».'); }
  let d = outer?.data ?? outer;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { throw new Error('Внутри файла нет листа персонажа.'); } }
  if (!d || typeof d !== 'object' || !(d.stats || d.info || d.name)) throw new Error('Не похоже на лист Long Story Short: нет имени и характеристик.');

  const issues = [], ok = [];
  const info = d.info || {};
  const name = str(d.name) || str(info.name) || 'Без имени';
  const level = Math.max(1, Math.min(20, num(info.level) || 1));
  const clsText = str(info.charClass) || str(info.class);
  const cls = byName(CLASSES, clsText);
  if (!cls) issues.push({ kind: 'warn', key: 'class', title: clsText ? `Класс «${clsText}» не узнали` : 'В файле нет класса', text: 'Лист будет без расчётов класса: ячейки и умения правьте вручную. Можно перенести как есть или вернуться и поправить файл.' });
  const raceText = str(info.race);
  const race = byName(RACES, raceText);

  const stats = {};
  for (const a of ABILITIES) { const s = num(d.stats?.[a.id]?.score ?? d.stats?.[a.id]); if (Number.isInteger(s)) stats[a.id] = s; }
  if (Object.keys(stats).length < 6) issues.push({ kind: 'error', key: 'stats', title: 'Не все характеристики', text: `В файле ${Object.keys(stats).length} из 6. Недостающие поставим 10 — поправьте в листе.` });
  else ok.push('характеристики');
  for (const a of ABILITIES) if (!Number.isInteger(stats[a.id])) stats[a.id] = 10;

  const saves = ABILITIES.filter((a) => d.saves?.[a.id]?.isProf).map((a) => a.id);
  const skills = [], expert = [];
  for (const [k, s] of Object.entries(d.skills || {})) {
    const id = SKILL_KEY[k.toLowerCase()] || (SKILLS.some((x) => x.id === k) ? k : null);
    if (!id) continue;
    const p = Number(s?.isProf ?? s?.prof ?? 0);
    if (p >= 1) skills.push(id);
    if (p >= 2) expert.push(id);
  }
  if (saves.length || skills.length) ok.push('спасброски и навыки');

  const vit = d.vitality || {};
  const hpMax = num(vit['hp-max']) ?? num(vit.hpMax);
  const hp = num(vit['hp-current']) ?? hpMax;
  const ac = num(vit.ac);
  const speed = num(vit.speed) || 30;
  const hd = String(str(vit['hit-die']) || (cls ? `d${cls.hd}` : '')).replace(/^к/, 'd');
  if (!hpMax) issues.push({ kind: 'warn', key: 'hp', title: 'Хитов в файле нет', text: 'Поставим среднее по классу — проверьте в листе.' });
  else ok.push('хиты и КД');

  const attacks = (d.weaponsList || []).map((w) => ({ name: str(w.name), bonus: num(w.mod), damage: str(w.dmg).replace(/к/g, 'd'), type: '', note: str(w.notes) })).filter((w) => w.name);
  if (attacks.length) ok.push(`атаки (${attacks.length})`);

  // Ячейки: «slots-1»: {value: 4}.
  const slots = {};
  for (let c = 1; c <= 9; c += 1) { const n = num(d.spells?.[`slots-${c}`]); if (n) slots[c] = { max: n, used: 0 }; }
  // Заклинания: тексты по кругам («spells-level-0» … «spells-level-9») — строками «Заговоры: …» / «1: …».
  const t = d.text || {};
  const lines = [], unknown = [];
  for (let c = 0; c <= 9; c += 1) {
    const raw = lssText(t[`spells-level-${c}`]);
    const names = raw.split(/[\n,;]+/).map((x) => x.replace(/^[-•·\s]+/, '').trim()).filter(Boolean);
    if (!names.length) continue;
    lines.push(`${c ? c : 'Заговоры'}: ${names.join(', ')}`);
    if (spellNames) for (const n of names) if (!spellNames.has(n.toLowerCase())) unknown.push(n);
  }
  const spellCount = lines.reduce((n, l) => n + l.split(':')[1].split(',').length, 0);
  if (spellCount) ok.push(`заклинания (${spellCount})`);
  if (unknown.length) issues.push({ kind: 'warn', key: 'spells', title: `${unknown.length} заклинаний нет в справочнике`, text: `${unknown.slice(0, 4).join(', ')}${unknown.length > 4 ? '…' : ''} — перенесём названием, без подсказок времени и дистанции.` });

  const inventory = lssText(t.equipment) || lssText(t.items);
  if (inventory) ok.push('снаряжение');
  const features = [lssText(t.features), lssText(t.traits)].filter(Boolean).join('\n');
  const coins = {};
  for (const k of ['pp', 'gp', 'ep', 'sp', 'cp']) { const n = num(d.coins?.[k]); if (n) coins[k] = n; }
  const personality = { traits: lssText(t.personality), ideals: lssText(t.ideals), bonds: lssText(t.bonds), flaws: lssText(t.flaws), backstory: lssText(t.background) };
  const notes = [lssText(t['notes-1']), lssText(t['notes-2']), lssText(t.notes)].filter(Boolean).join('\n\n');
  const langs = lssText(t.prof);
  const profs = { ...(expert.length ? { skills: Object.fromEntries(skills.map((x) => [x, expert.includes(x) ? 2 : 1])) } : {}), ...(langs ? { languages: langs } : {}) };
  if (!d.avatar && !info.avatar) issues.push({ kind: 'warn', key: 'portrait', title: 'Портрета в файле нет', text: 'Возьмём арт класса — потом можно выбрать другой в листе.' });

  const hero = {
    name, level, classId: cls?.id || null, className: clsText || cls?.name || '', raceId: race?.id || null, raceName: raceText || race?.name || '',
    background: str(info.background), alignment: str(info.alignment), xp: num(info.experience) || 0,
    stats, saves, skills, ...(Object.keys(profs).length ? { proficiencies: profs } : {}),
    hpMax: hpMax || (cls ? cls.hd + Math.floor((stats.con - 10) / 2) + (level - 1) * (cls.hd / 2 + 1 + Math.floor((stats.con - 10) / 2)) : 8), hp: hp ?? hpMax ?? 8, tempHp: 0,
    ...(ac ? { ac } : {}), speed, hd: cls?.hd, hitDice: hd ? `${level}${hd}` : '',
    attacks, slots, spells: lines.join('\n'), inventory, features, coins, notes,
    personality, portrait: cls ? `assets/hero/class-${cls.id}.webp` : 'assets/hero/race-human.webp',
    conditions: [], deathSaves: { s: 0, f: 0 },
  };
  const of = ok.length + issues.length;
  return {
    hero, file: fileName,
    matched: { ok: ok.length, of, text: ok.join(', ') || 'почти ничего' },
    summary: [hero.raceName, `${hero.className || 'Без класса'} ${level}`, 'из LSS'].filter(Boolean).join(' · '),
    issues,
  };
}
