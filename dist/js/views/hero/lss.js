// Перенос героя из Long Story Short (экран 72, #203): файл .json из LSS → герой в формате листа (docs/data.md:
// classes, proficiencies, overrides, attacks, slotPools, hitDicePools, spellSources, resources, featureEntries,
// inventoryItems, coins). Формат сверен с четырьмя настоящими выгрузками с сайта (06.11.2026) и конвертером
// Foundry → LSS — см. tests/fixtures/lss/README.md. Разбор терпимый: чего нет — не выдумываем; что легло не так, как
// в LSS, — пункт «посмотрите» на экране переноса.
import { ABILITIES, SKILLS, CLASSES, RACES } from '../../data/rules.js';
import { wornItems, armorClass } from './gear.js';

// Навыки LSS (английские ключи) → наши ID.
const SKILL_KEY = { acrobatics: 'acrobatics', 'animal handling': 'animal', animalhandling: 'animal', arcana: 'arcana', athletics: 'athletics', deception: 'deception', history: 'history', insight: 'insight', intimidation: 'intimidation', investigation: 'investigation', medicine: 'medicine', nature: 'nature', perception: 'perception', performance: 'performance', persuasion: 'persuasion', religion: 'religion', 'sleight of hand': 'sleight', sleightofhand: 'sleight', stealth: 'stealth', survival: 'survival' };
const AB = new Set(ABILITIES.map((a) => a.id));
const abName = (id) => ABILITIES.find((a) => a.id === id)?.name || id;
// Половинные заклинатели получают магию со 2 уровня.
const HALF = new Set(['paladin', 'ranger']);

const val = (x) => (x && typeof x === 'object' && !Array.isArray(x) && 'value' in x ? x.value : x);
/** Число из поля LSS: 5, "18", "+2", "−1". Пусто или не число — null, а не 0. */
const num = (x) => {
  const v = val(x);
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = /^\s*([+−-]?)\s*(\d+)/.exec(String(v ?? ''));
  return m ? Number(m[2]) * (m[1] && m[1] !== '+' ? -1 : 1) : null;
};
const str = (x) => { const v = val(x); return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''; };
const mod = (s) => Math.floor((s - 10) / 2);
const signed = (n) => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);
const words = (s) => s.split(/\s+/).filter(Boolean).length;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const low = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').trim();
const plural = (n, one, few, many) => { const a = n % 10, b = n % 100; return `${n} ${a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many}`; };
// «БОНУСНОЕ ВЛАДЕНИЕ» → «Бонусное владение»; обычные названия не трогаем.
const tame = (s) => (/[а-яё]/.test(s) || !/[А-ЯЁ]{3}/.test(s) ? s : s[0] + s.slice(1).toLowerCase());

// ——— Текст LSS: документ редактора (ProseMirror), HTML-строка или просто строка → абзацы с жирным/курсивом ———
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
const fromHtml = (s) => s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?(p|div|li|h\d)[^>]*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m, k) => ENT[k]);
/** Абзацы поля LSS: [{text, runs:[{text, bold, italic}]} | null — пустой абзац]. */
export function lssParas(x) {
  const v = val(x);
  const d = v && typeof v === 'object' && 'data' in v ? v.data : v;
  if (typeof d === 'string') return fromHtml(d).split('\n').map((t) => t.replace(/\s+/g, ' ').trim()).map((t) => (t ? { text: t, runs: [{ text: t }] } : null));
  const out = [];
  const inline = (n, runs) => {
    if (!n || typeof n !== 'object') return;
    if (typeof n.text === 'string') { const m = new Set((n.marks || []).map((k) => k.type)); runs.push({ text: n.text, bold: m.has('bold'), italic: m.has('italic') }); }
    else if (n.type === 'hardBreak') runs.push({ text: ' ' });
    for (const c of n.content || []) inline(c, runs);
  };
  const block = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'paragraph' || n.type === 'heading') {
      const runs = [];
      for (const c of n.content || []) inline(c, runs);
      const text = runs.map((r) => r.text).join('').replace(/\s+/g, ' ').trim();
      out.push(text ? { text, runs } : null);
      return;
    }
    for (const c of n.content || []) block(c);
  };
  block(d);
  return out;
}
/** Текст поля LSS абзацами через перевод строки. */
export const lssText = (x) => lssParas(x).filter(Boolean).map((p) => p.text).join('\n');

/**
 * «Имя: описание», «Имя — описание», «Имя - описание», а с sentence — и «Имя. Описание…» → [имя, описание].
 * Двоеточие и тире внутри скобок не делят; скобки из имени уходят в описание: «Латы (от Тобиаса): КД 18» → Латы.
 */
function splitHead(text, sentence = true) {
  let depth = 0, at = -1, len = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '(') depth += 1;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (!depth && c === ':' && /\s/.test(text[i + 1] || '')) { at = i; len = 1; break; }
    else if (!depth && /[—–-]/.test(c) && text[i - 1] === ' ' && text[i + 1] === ' ') { at = i - 1; len = 3; break; }
  }
  if (at > 1) { const r = tidy(text.slice(0, at), text.slice(at + len)); if (r[0].length <= 60) return r; }
  if (sentence) { const m = /^([^.!?(:]{3,80}?)[.!]\s+(?=\S)(.{20,})$/s.exec(text); if (m) return tidy(m[1], m[2]); }
  return [text, ''];
}
function tidy(head, rest) {
  const notes = [];
  const name = head.replace(/\s*\(([^)]*)\)\s*/g, (m, x) => { notes.push(x.trim()); return ' '; }).replace(/\s+/g, ' ').trim().replace(/[:.\s]+$/, '');
  if (!name) return [head.trim(), rest.trim()];
  return [name, [notes.filter(Boolean).join('; '), rest.trim()].filter(Boolean).join('. ')];
}
const shortLine = (t) => t.length <= 60 && words(t) <= 6 && !/[.!?…]$/.test(t);
// Связный текст, а не строка списка: длинный или законченная фраза.
const prose = (t) => words(t) >= 12 || (/[.!?…]$/.test(t) && words(t) >= 5);
// Продолжение предыдущей записи: строка таблицы «1 - …», счётчик «3/4» (но не «1-й уровень»).
const isRow = (t) => /^\d+\s*[-–—.)]\s+\S/.test(t) || /^\d+\s*\/\s*\d+$/.test(t);

/**
 * Абзацы блока LSS → записи {name, description, source}. Жирное в начале абзаца или строка с двоеточием на конце —
 * заголовок, следующий абзац — его описание; курсив сразу после заголовка — откуда умение; «Имя — описание» — запись;
 * связный текст без пустой строки — продолжение описания; короткие строки — отдельные записи (списки вещей).
 */
export function lssEntries(ps) {
  const out = [];
  let cur = null, gap = true;
  const add = (name, description = '', head = false) => {
    const raw = String(name).trim();
    const n = tame(raw.replace(/[:.\s]+$/, '').trim());
    if (!n) return;
    cur = { name: n, description: description.replace(/^[:.\s—–-]+/, '').trim(), source: '' };
    Object.defineProperty(cur, 'head', { value: head || /:$/.test(raw), enumerable: false });
    out.push(cur);
  };
  const more = (t) => { cur.description = cur.description ? `${cur.description}\n${t}` : t; };
  for (const p of ps) {
    if (!p) { gap = true; continue; }
    const t = p.text;
    let lead = '';
    for (const r of p.runs) { if (r.bold) lead += r.text; else if (r.text.trim()) break; else lead += r.text; }
    lead = lead.replace(/\s+/g, ' ').trim();
    const italic = !lead && p.runs.every((r) => r.italic || !r.text.trim());
    if (cur && isRow(t)) more(t);
    else if (lead) {
      const rest = t.startsWith(lead) ? t.slice(lead.length).trim() : '';
      if (rest) add(lead, rest, true); else { const [n, dsc] = splitHead(lead, false); add(n, dsc, true); }
    } else if (italic && cur && !cur.description && !cur.source) cur.source = t;
    else if (cur && !gap && !cur.description && cur.head && !shortLine(t)) more(t);
    else {
      const [n, dsc] = splitHead(t, false);
      if (dsc) add(n, dsc);
      else if (cur && !gap && prose(t)) more(t);
      else { const [n2, d2] = splitHead(t, true); add(n2, d2); }
    }
    gap = false;
  }
  return out;
}

const byName = (list, name) => {
  const n = low(name);
  if (!n) return null;
  return list.find((x) => { const k = low(x.name); return n === k || n.startsWith(k.slice(0, Math.max(4, k.length - 2))); }) || null;
};
/** «Воин (3) / Жрец (2)», «Волшебник 5», «чародей» → [{name, levels|null}]. */
function classParts(text) {
  return String(text || '').split(/\s*(?:\/|,|\+|;|\sи\s)\s*/).map((s) => s.trim()).filter(Boolean).map((part) => {
    const m = /^(.+?)\s*\(?\s*(\d{1,2})\s*(?:ур\.?|уровень)?\s*\)?$/i.exec(part);
    return m ? { name: m[1].trim(), levels: Number(m[2]) } : { name: part, levels: null };
  });
}
/** Урон LSS → {damage: '1d10+5', type, note}: «к» только в кости, [STR] — модификатором, двуручный «(1к10)» — в заметку. */
function parseDamage(text, mods, prof, extra = 0) {
  let t = String(text || '').replace(/\[(STR|DEX|CON|INT|WIS|CHA|PROF|PB)\]/gi, (m, k) => { const a = k.toLowerCase(); return String(a === 'prof' || a === 'pb' ? prof : mods[a] ?? 0); });
  const dice = (s) => s.replace(/(\d*)\s*[кkдd]\s*(\d+)/gi, (m, a, b) => `${a || 1}d${b}`);
  let vers = '';
  t = t.replace(/\(\s*(\d*\s*[кkдd]\s*\d+)\s*\)/i, (m, x) => { vers = dice(x).replace(/\s+/g, ''); return ' '; });
  const tm = /([а-яё][а-яё\s,]*)$/i.exec(t);
  const type = tm ? tm[1].replace(/[\s,]+$/, '').trim() : '';
  if (tm) t = t.slice(0, tm.index);
  const expr = dice(t).replace(/\s+/g, '').replace(/−/g, '-');
  const terms = expr.match(/[+-]?[^+-]+/g) || [];
  const diceTerms = terms.filter((x) => /d/.test(x)).map((x) => x.replace(/^\+/, ''));
  if (!diceTerms.length || terms.some((x) => !/^[+-]?(\d+d\d+|\d+)$/.test(x))) return { damage: expr || String(text || '').trim(), type, note: '' };
  const flat = terms.filter((x) => !/d/.test(x)).reduce((n, x) => n + Number(x), 0) + extra;
  const tailN = flat ? (flat > 0 ? `+${flat}` : `${flat}`) : '';
  return { damage: `${diceTerms.join('+')}${tailN}`, type, note: vers ? `двумя руками ${vers.replace(/d/g, 'к')}${tailN}` : '' };
}

/**
 * Разобрать файл LSS. Возвращает { hero, matched: {ok, of, text}, issues: [{kind, title, text, key}], summary, avatar }
 * или бросает ошибку с понятным текстом, если это не лист LSS. gear — gearIndex снаряжения SRD (необязательно):
 * по нему предметы сумки получают русские названия, вес и КД.
 */
export function parseLss(text, { fileName = '', spellNames = null, gear = null } = {}) {
  let outer;
  try { outer = JSON.parse(text); } catch { throw new Error('Это не JSON — выгрузите лист из Long Story Short кнопкой «Экспорт».'); }
  let d = outer?.data ?? outer;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { throw new Error('Внутри файла нет листа персонажа.'); } }
  if (!d || typeof d !== 'object' || !(d.stats || d.info || d.name)) throw new Error('Не похоже на лист Long Story Short: нет имени и характеристик.');

  const issues = [], blocks = [];
  const issue = (kind, key, title, body) => issues.push({ kind, key, title, text: body });
  const block = (name, keys = []) => blocks.push({ name, keys });
  const info = d.info || {}, t = d.text || {}, vit = d.vitality || {};
  const name = str(d.name) || str(info.name) || 'Без имени';
  const notesExtra = [];

  // Класс: один или несколько с уровнями; подкласс — у основного (больший уровень).
  const clsText = str(info.charClass) || str(info.class);
  const parts = classParts(clsText);
  const infoLevel = num(info.level);
  if (parts.length === 1 && !parts[0].levels) parts[0].levels = infoLevel || 1;
  for (const p of parts) if (!p.levels) p.levels = 1;
  const level = Math.max(1, Math.min(20, parts.reduce((n, p) => n + p.levels, 0) || infoLevel || 1));
  const main = parts.reduce((m, p, i) => (p.levels > (parts[m]?.levels || 0) ? i : m), 0);
  const subclass = str(info.charSubclass);
  const defs = parts.map((p) => byName(CLASSES, p.name));
  const classes = parts.map((p, i) => ({ id: `lss-class-${i + 1}`, name: defs[i]?.name || cap(p.name), subclass: i === main ? subclass : '', levels: p.levels, ...(defs[i] ? { ref: `srd51:class:${defs[i].id}` } : {}) }));
  const cls = defs[main] || null;
  const unknownCls = parts.filter((p, i) => !defs[i]).map((p) => p.name);
  if (!clsText) issue('warn', 'class', 'В файле нет класса', 'Лист будет без расчётов класса: ячейки и умения правьте вручную.');
  else if (unknownCls.length) issue('warn', 'class', `Класс «${unknownCls.join(', ')}» не узнали`, 'Перенесём названием, без расчётов класса: заряды и ячейки — как в файле.');
  block('класс', ['class']);
  const raceText = str(info.race);
  const race = byName(RACES, raceText);
  if (raceText && !race) issue('info', 'race', `Раса «${raceText}» — не из SRD 5.1`, 'Перенесём названием. Расовые умения — те, что записаны в файле.');

  // Характеристики; предмет, задающий значение («Повязка интеллекта»: Интеллект 19), — поправка LSS bonuses.
  const stats = {};
  for (const a of ABILITIES) { const s = num(d.stats?.[a.id]?.score ?? d.stats?.[a.id]); if (Number.isInteger(s)) stats[a.id] = s; }
  const statKeys = [];
  if (Object.keys(stats).length < 6) { issue('error', 'stats', 'Не все характеристики', `В файле ${Object.keys(stats).length} из 6. Недостающие поставим 10 — поправьте в листе.`); statKeys.push('stats'); }
  for (const a of ABILITIES) if (!Number.isInteger(stats[a.id])) stats[a.id] = 10;
  const acBonus = [], wAtk = {}, wDmg = {}, otherBonus = [];
  for (const b of Array.isArray(d.bonuses) ? d.bonuses : []) {
    const target = String(b?.target || ''), e = num(b?.expr), label = str(b?.label);
    const sm = /^stat\.(\w+)\.score$/.exec(target), wm = /^weapon\.(.+)\.(attack|damage)$/.exec(target);
    if (e == null) { otherBonus.push(label || target); continue; }
    if (sm && AB.has(sm[1])) {
      const base = stats[sm[1]];
      const next = b.mode === 'set' || b.kind === 'override' ? Math.max(base, e) : base + e;
      if (next !== base) {
        stats[sm[1]] = next;
        const why = label ? `от «${label}»` : 'поправка LSS';
        issue('warn', 'stats', `${abName(sm[1])} ${next} — ${why}`, `Без неё ${base}. Записали ${next}; если предмет снимете — поправьте в листе.`);
        notesExtra.push(`${abName(sm[1])} ${next} ${why} (без неё ${base}).`);
        statKeys.push('bonus');
      }
    } else if (target === 'ac') acBonus.push({ e, label });
    else if (wm) (wm[2] === 'attack' ? wAtk : wDmg)[wm[1]] = ((wm[2] === 'attack' ? wAtk : wDmg)[wm[1]] || 0) + e;
    else otherBonus.push(label || target);
  }
  if (otherBonus.length) issue('warn', 'bonus', 'Не все поправки LSS перенесли', `${otherBonus.slice(0, 4).join(', ')} — впишите их в лист вручную.`);
  block('характеристики', statKeys);
  const mods = Object.fromEntries(ABILITIES.map((a) => [a.id, mod(stats[a.id])]));
  const prof = num(d.proficiency) || 2 + Math.floor((level - 1) / 4);

  // Спасброски и навыки: владение 0/1/2; своё итоговое значение LSS (customModifier) или прибавка (bonus) — ручной итог листа.
  const saves = [], skills = [], profSaves = {}, profSkills = {}, overrides = {}, custom = [];
  const ownTotal = (kind, id, entry, computed, label) => {
    const set = num(entry?.customModifier), add = num(entry?.bonus);
    const total = set != null ? set : add ? computed + add : null;
    if (total == null || total === computed) return;
    (overrides[kind] ||= {})[id] = { value: total, reason: 'из Long Story Short' };
    custom.push(`${label} ${signed(total)}`);
  };
  for (const a of ABILITIES) {
    const s = d.saves?.[a.id];
    const p = s?.isProf === true || Number(s?.isProf) >= 1 ? 1 : 0;
    if (p) { saves.push(a.id); profSaves[a.id] = 1; }
    ownTotal('saves', a.id, s, mods[a.id] + p * prof, `спасбросок ${abName(a.id)}`);
  }
  for (const [k, s] of Object.entries(d.skills || {})) {
    const id = SKILL_KEY[k.toLowerCase()] || (SKILLS.some((x) => x.id === k) ? k : null);
    if (!id) continue;
    const p = s?.isProf === true ? 1 : Math.max(0, Math.min(2, Number(s?.isProf ?? s?.prof ?? 0) || 0));
    if (p >= 1) { skills.push(id); profSkills[id] = p >= 2 ? 2 : 1; }
    const sk = SKILLS.find((x) => x.id === id);
    ownTotal('skills', id, s, mods[sk.ab] + Math.floor(p * prof), sk.name);
  }
  const ini = num(vit.initiative);
  const initBonus = ini != null && ini !== mods.dex ? ini : undefined;
  if (initBonus != null) custom.push(`инициатива ${signed(initBonus)}`);
  if (custom.length) issue('warn', 'custom', 'Свои значения из LSS', `${custom.slice(0, 5).join(', ')}${custom.length > 5 ? '…' : ''} — записали как ручные итоги листа, расчёт по правилам их не меняет.`);
  if (saves.length || skills.length) block('спасброски и навыки', ['custom']);

  // Хиты, кости хитов, КД.
  const hpMax = num(vit['hp-max']) ?? num(vit.hpMax);
  const hp = num(vit['hp-current']) ?? hpMax;
  const tempHp = Math.max(0, num(vit['hp-temp']) ?? 0);
  if (!hpMax) issue('warn', 'hp', 'Хитов в файле нет', 'Поставим среднее по классу — проверьте в листе.');
  const multi = vit['hp-dice-multi'] && typeof vit['hp-dice-multi'] === 'object' ? Object.entries(vit['hp-dice-multi']).filter(([k, x]) => /^[dкk]\d+$/i.test(k) && num(x?.max)) : [];
  const dieOf = (s) => Number(/(\d+)/.exec(String(s || ''))?.[1]) || null;
  let hitDicePools;
  if (multi.length) hitDicePools = multi.map(([k, x]) => { const die = dieOf(k), total = num(x.max); return { id: `lss-hd-${die}`, name: `к${die}`, die, total, spent: Math.max(0, total - (num(x.current) ?? total)) }; });
  else {
    const die = dieOf(str(vit['hit-die'])) || cls?.hd || null;
    const left = num(vit['hp-dice-current']);
    hitDicePools = die ? [{ id: `lss-hd-${die}`, name: `к${die}`, die, total: level, spent: left == null ? 0 : Math.max(0, level - left) }] : [];
  }

  // Сумка: снаряжение, предметы, вещи из блока «Атаки» (его часто ведут списком вещей) и настроенные предметы.
  const gearKey = new Map();
  if (gear) for (const [k, g] of gear.byName) gearKey.set(low(k), g);
  const items = [];
  const putItem = (nameRaw, description = '', extra = {}) => {
    let nm = String(nameRaw).trim(), qty = 1;
    const q = /^(.+?)\s*[×xх]\s*(\d+)$/i.exec(nm) || /^(.+?)\s*\(?(\d+)\s*шт\.?\)?$/i.exec(nm) || /^(.+?)\s*\((\d+)\)$/.exec(nm);
    if (q) { nm = q[1].trim(); qty = Number(q[2]); }
    if (!nm) return;
    const g = gearKey.get(low(nm));
    const same = items.find((x) => low(x.name) === low(g?.ru || nm));
    if (same) { if (extra.attuned) same.attuned = true; if (description && !same.description) same.description = description; if (!extra.attuned) same.quantity += qty; return; }
    items.push({ id: `lss-item-${items.length + 1}`, name: g?.ru || cap(nm), quantity: qty, ...(g ? { ref: g.id, ...(g.weight ? { weight: g.weight } : {}) } : {}), equipped: false, attuned: !!extra.attuned, description });
  };
  const splitCommas = (s) => { const out = []; let depth = 0, cur = ''; for (const c of s) { if (c === '(') depth += 1; if (c === ')') depth = Math.max(0, depth - 1); if (c === ',' && !depth) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out.map((x) => x.trim()).filter(Boolean); };
  // Запятые делят только «Снаряжение» («кинжал, верёвка, факел»); в заметках «глаза, клыки и мясо» — одна вещь.
  const putEntries = (list, commas = false) => {
    for (const e of list) {
      const pieces = commas && !e.description && e.name.includes(',') ? splitCommas(e.name) : [e.name];
      if (pieces.length > 1 && pieces.every((x) => words(x) <= 8)) pieces.forEach((x) => putItem(x)); else putItem(e.name, e.description);
    }
  };
  putEntries(lssEntries(lssParas(t.equipment)), true);
  putEntries(lssEntries(lssParas(t.items)));
  // Атаки текстом: «Боевой топор +6 1к8+4 рубящий»; остальное в блоке «Атаки» — вещи.
  const textAttacks = [], attackParas = [];
  for (const p of lssParas(t.attacks)) {
    const m = p && /^(.{2,40}?)\s+([+−-]\s?\d{1,2})\s+(\d+\s*[кkдd]\s*\d+.*)$/i.exec(p.text);
    if (m) textAttacks.push({ name: m[1], bonus: num(m[2]), dmg: m[3] }); else attackParas.push(p);
  }
  putEntries(lssEntries(attackParas));
  const attuned = (Array.isArray(d.attunementsList) ? d.attunementsList : []).filter((x) => str(x?.value));
  for (const x of attuned) putItem(str(x.value), '', { attuned: x.checked !== false });
  if (items.length) block(`сумка (${items.length})`);

  // КД: в LSS записанное + кнопка щита (+2 или своё) + поправки «КД»; пустое (10 + Ловкость) — по доспеху из сумки.
  const lssAc = num(vit.ac);
  const shieldOn = vit.shield?.value === true;
  const shieldAc = shieldOn ? num(vit.shield.mod) ?? 2 : 0;
  let ac = lssAc == null ? null : lssAc + shieldAc + acBonus.reduce((n, b) => n + b.e, 0);
  const acKeys = [];
  if (ac != null && ac !== lssAc) {
    issue('warn', 'ac', `КД ${ac}`, `${lssAc} в LSS${shieldAc ? ` + щит ${signed(shieldAc)}` : ''}${acBonus.map((b) => ` + ${b.label || 'поправка'} ${signed(b.e)}`).join('')}. Проверьте в листе.`);
    acKeys.push('ac');
  }
  if (gear && (ac == null || ac <= 10 + mods.dex)) {
    const worn = wornItems(items, gear);
    if (worn.some((x) => x.equipped && ['armor', 'shield'].includes(x.g?.kind))) {
      const calc = armorClass(worn, mods, defs.filter(Boolean).map((c) => c.id));
      if (calc.value !== ac) {
        issue('warn', 'ac', `КД ${calc.value} — по снаряжению`, `${ac == null ? 'В LSS КД не записан' : `В LSS ${ac}`}, а в сумке ${worn.filter((x) => x.equipped && ['armor', 'shield'].includes(x.g?.kind)).map((x) => x.g.ru.toLowerCase()).join(' и ')}. ${calc.explain}.`);
        ac = null; acKeys.push('ac');
      }
    }
  }
  if (hpMax || ac != null) block('хиты и КД', ['hp', ...acKeys]);

  // Атаки: интерактивные (weaponsList) и строками из блока «Атаки».
  const attacks = [];
  for (const [i, w] of (Array.isArray(d.weaponsList) ? d.weaponsList : []).entries()) {
    const nm = str(w?.name);
    if (!nm) continue;
    const dmgText = str(w.dmg);
    const ph = /\[(STR|DEX|CON|INT|WIS|CHA)\]/i.exec(dmgText);
    const ability = AB.has(w.ability) ? w.ability : ph ? ph[1].toLowerCase() : 'str';
    const own = !!w.isProf;
    const explicit = num(w.modBonus) || num(w.mod) || null; // «+0» в LSS — «не задано»
    const bonus = explicit ?? mods[ability] + (own ? prof : 0) + (wAtk[w.id] || 0);
    const dm = parseDamage(dmgText, mods, prof, wDmg[w.id] || 0);
    attacks.push({ id: `lss-attack-${i + 1}`, name: cap(nm), ability, proficient: own, bonus, damage: dm.damage, type: dm.type, note: [dm.note, str(w.notes).replace(/\s+/g, ' ')].filter(Boolean).join(' · ') });
  }
  for (const a of textAttacks) { const dm = parseDamage(a.dmg, mods, prof); attacks.push({ id: `lss-attack-${attacks.length + 1}`, name: cap(a.name), bonus: a.bonus, damage: dm.damage, type: dm.type, note: dm.note }); }
  if (attacks.length) block(`атаки (${attacks.length})`);

  // Магия: ячейки (filled — потраченные), ячейки договора, характеристика и ручные бонус/СЛ, заклинания текстом и карточками.
  const sp = d.spells && typeof d.spells === 'object' ? d.spells : {};
  const checked = (c) => Object.entries(sp).filter(([k, x]) => new RegExp(`^level-${c}-slot-\\d+$`).test(k) && x?.isChecked).length;
  const slotPools = [];
  for (let c = 1; c <= 9; c += 1) {
    const max = num(sp[`slots-${c}`]);
    if (max > 0) slotPools.push({ id: `lss-slot-${c}`, name: 'Ячейки заклинаний', circle: c, kind: 'spellcasting', max, spent: Math.min(max, Math.max(0, num(sp[`slots-${c}`]?.filled) ?? checked(c))), recovery: 'long' });
  }
  for (const [k, x] of Object.entries(d.spellsPact && typeof d.spellsPact === 'object' ? d.spellsPact : {})) {
    const c = Number(/^slots-(\d)$/.exec(k)?.[1]), max = num(x);
    if (c && max > 0) slotPools.push({ id: `lss-pact-${c}`, name: 'Магия договора', circle: c, kind: 'pact', max, spent: Math.min(max, Math.max(0, num(x?.filled) ?? 0)), recovery: 'short' });
  }
  const lines = [], unknown = [];
  for (let c = 0; c <= 9; c += 1) {
    const names = lssText(t[`spells-level-${c}`]).split(/[\n,;]+/).map((x) => x.replace(/^[-•·\s]+/, '').trim()).filter(Boolean);
    if (!names.length) continue;
    lines.push(`${c ? c : 'Заговоры'}: ${names.join(', ')}`);
    if (spellNames) for (const n of names) if (!spellNames.has(n.toLowerCase())) unknown.push(n);
  }
  const spellCount = lines.reduce((n, l) => n + l.split(':')[1].split(',').length, 0);
  const cards = new Set(['prepared', 'book', 'granted', 'slotless'].flatMap((k) => (Array.isArray(outer?.spells?.[k]) ? outer.spells[k] : [])).filter((x) => typeof x === 'string'));
  const magicKeys = [];
  if (unknown.length) { issue('warn', 'spells', `${plural(unknown.length, 'заклинания', 'заклинаний', 'заклинаний')} нет в справочнике`, `${unknown.slice(0, 4).join(', ')}${unknown.length > 4 ? '…' : ''} — перенесём названием, без подсказок времени и дистанции.`); magicKeys.push('spells'); }
  if (cards.size) { issue('warn', 'cards', `${plural(cards.size, 'заклинание', 'заклинания', 'заклинаний')} карточками`, 'LSS выгружает вместо их названий только свои номера. Впишите заклинания в листе, вкладка «Магия».'); magicKeys.push('cards'); }
  const casterText = str(d.casterClass);
  const caster = defs.find((x) => x?.spell && !(HALF.has(x.id) && parts[defs.indexOf(x)].levels < 2)) || null;
  const spellSources = [];
  if (caster || casterText || slotPools.length || spellCount) {
    const base = d.spellsInfo?.base?.code;
    const ability = AB.has(base) ? base : caster?.spell || cls?.spell || null;
    if (ability) {
      const atk = prof + mods[ability], dc = 8 + atk;
      const atkSet = num(d.spellsInfo?.mod?.customModifier) ?? num(d.spellsInfo?.mod?.value);
      const dcSet = num(d.spellsInfo?.save?.customModifier) ?? num(d.spellsInfo?.save?.value);
      spellSources.push({ id: 'lss-magic', name: casterText || caster?.name || cls?.name || 'Магия', ability, kind: '', attackOverride: atkSet != null && atkSet !== atk ? atkSet : null, dcOverride: dcSet != null && dcSet !== dc ? dcSet : null });
      if ((atkSet != null && atkSet !== atk) || (dcSet != null && dcSet !== dc)) { issue('warn', 'magic', 'Свои бонус и СЛ заклинаний', `${atkSet != null && atkSet !== atk ? `атака ${signed(atkSet)} (по правилам ${signed(atk)})` : ''}${dcSet != null && dcSet !== dc ? ` СЛ ${dcSet} (по правилам ${dc})` : ''} — записали как в LSS.`); magicKeys.push('magic'); }
    }
  }
  if (slotPools.length || spellCount || cards.size) block(spellCount ? `заклинания (${spellCount})` : 'магия', magicKeys);

  // Заряды умений: Ци, Ярость, Магическое восстановление…
  const resources = Object.values(d.resources && typeof d.resources === 'object' ? d.resources : {}).filter((r) => str(r?.name) && num(r?.max)).map((r, i) => {
    const max = num(r.max);
    return { id: `lss-res-${i + 1}`, name: str(r.name), max, spent: Math.max(0, max - (num(r.current) ?? max)), recovery: r.isShortRest ? 'short' : r.isLongRest ? 'long' : 'manual' };
  });

  // Умения: особенности (traits), умения (features) и черты (feats) — каждой строкой своё; сопротивления и иммунитеты.
  const featureEntries = [];
  const putFeature = (e, source) => {
    const same = featureEntries.find((x) => low(x.name) === low(e.name));
    if (same) { if (e.description && !same.description.includes(e.description)) same.description = [same.description, e.description].filter(Boolean).join('\n'); return; }
    featureEntries.push({ id: `lss-feature-${featureEntries.length + 1}`, name: e.name, source: e.source || source, description: e.description });
  };
  for (const e of lssEntries(lssParas(t.traits))) putFeature(e, 'Long Story Short');
  for (const e of lssEntries(lssParas(t.features))) putFeature(e, 'Long Story Short');
  for (const e of lssEntries(lssParas(t.feats))) putFeature(e, 'Черта');

  // Владения: строки «Знание языков:», «Доспехи:», «Оружие:», «Инструменты …:», «Сопротивление к:», «Иммунитет к:».
  const LBL = [[/язык/i, 'languages'], [/доспех/i, 'armor'], [/оружи/i, 'weapons'], [/инструмент/i, 'tools'], [/сопротивлени/i, 'resist'], [/иммунитет/i, 'immune'], [/уязвим/i, 'vuln']];
  const bucket = {}, bare = [];
  for (const p of lssParas(t.prof)) {
    if (!p) continue;
    const m = /^([^:]{2,40}):\s*(.*)$/.exec(p.text);
    const key = m && LBL.find(([re]) => re.test(m[1]))?.[1];
    if (!key) { bare.push(p.text); continue; }
    const v = m[2].replace(/^нет(?=[\s.,;]|$)[.,;]?\s*/i, '').replace(/[,\s]+$/, '').trim();
    if (!v) continue;
    (bucket[key] ||= []).push(key === 'tools' ? `${m[1].trim()}: ${v}` : v);
  }
  const anyLabel = Object.keys(bucket).length > 0 || lssParas(t.prof).some((p) => p && /^[^:]{2,40}:/.test(p.text));
  const flags = d.prof && typeof d.prof === 'object' ? d.prof : {};
  const flag = (k) => flags[k]?.value === true;
  const armorText = bucket.armor?.join(', ') || [flag('armor-light') && 'Лёгкие доспехи', flag('armor-medium') && 'Средние доспехи', flag('armor-heavy') && 'Тяжёлые доспехи', flag('armor-label') && 'Щиты'].filter(Boolean).join(', ');
  const weaponText = bucket.weapons?.join(', ') || [flag('weapon-simple') && 'Простое оружие', flag('weapon-martial') && 'Воинское оружие'].filter(Boolean).join(', ');
  const languages = bucket.languages?.join(', ') || (!anyLabel ? bare.join(', ') : '');
  // Доспехи и оружие — строками в tools, как пишет конструктор (docs/data.md: languages и tools — свободный текст).
  const tools = [armorText && `Доспехи: ${armorText}`, weaponText && `Оружие: ${weaponText}`, ...(bucket.tools || []), anyLabel && bare.length ? `Прочее: ${bare.join('; ')}` : ''].filter(Boolean).join('\n');
  for (const [k, title] of [['resist', 'Сопротивления'], ['immune', 'Иммунитеты'], ['vuln', 'Уязвимости']]) if (bucket[k]) putFeature({ name: title, description: bucket[k].join(', ') }, 'Long Story Short');
  if (featureEntries.length) block(`умения (${featureEntries.length})`);
  if (languages || tools) block('владения и языки');

  // Деньги: монеты; только общий счёт («total») без разбивки — как золото.
  const coins = {};
  for (const k of ['pp', 'gp', 'ep', 'sp', 'cp']) { const n = num(d.coins?.[k]); if (n) coins[k] = n; }
  const total = num(d.coins?.total);
  const coinKeys = [];
  if (!Object.keys(coins).length && total > 0) { coins.gp = total; issue('warn', 'coins', `${total} зм — общим счётом`, 'В LSS записан только общий счёт без разбивки по монетам. Перенесли его золотом — поправьте в сумке, если это не так.'); coinKeys.push('coins'); }
  if (Object.keys(coins).length) block('деньги', coinKeys);

  // Характер, внешность (subInfo и блок «Внешность»), заметки всех страниц, союзники и задания.
  const SUB = [['age', 'Возраст'], ['height', 'рост'], ['weight', 'вес'], ['eyes', 'глаза'], ['skin', 'кожа'], ['hair', 'волосы']];
  const look = SUB.map(([k, l]) => (str(d.subInfo?.[k]) && str(d.subInfo[k]) !== '0' ? `${l} ${str(d.subInfo[k])}` : '')).filter(Boolean).join(', ');
  const appearance = [look ? cap(look) : '', lssText(t.appearance)].filter(Boolean).join('\n');
  const personality = { traits: lssText(t.personality), ideals: lssText(t.ideals), bonds: lssText(t.bonds), flaws: lssText(t.flaws), backstory: lssText(t.background), ...(appearance ? { appearance } : {}) };
  if (Object.values(personality).some(Boolean)) block('характер и внешность');
  const pages = Object.keys(t).filter((k) => /^notes-\d+$/.test(k)).sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
  const notes = [...pages.map((k) => lssText(t[k])), lssText(t.notes),
    lssText(t.allies) ? `Союзники и организации:\n${lssText(t.allies)}` : '', lssText(t.quests) ? `Задания:\n${lssText(t.quests)}` : '',
    notesExtra.length ? `Из Long Story Short: ${notesExtra.join(' ')}` : ''].filter(Boolean).join('\n\n');
  if (notes) block('заметки');

  if (String(outer?.edition || d.edition || '') === '2024') issue('warn', 'edition', 'Лист из редакции 2024', 'У нас правила 5e 2014: расчёты листа могут разойтись с LSS.');
  const avatar = !!(d.avatar?.webp || d.avatar?.jpeg || (typeof d.avatar === 'string' && d.avatar));

  const hero = {
    name, level, classes, classId: cls?.id || null, className: cls?.name || cap(parts[main]?.name || ''), raceId: race?.id || null, raceName: raceText || race?.name || '',
    background: str(info.background), alignment: str(info.alignment), xp: num(info.experience) || 0,
    stats, saves, skills, proficiencies: { saves: profSaves, skills: profSkills, ...(languages ? { languages } : {}), ...(tools ? { tools } : {}) },
    ...(Object.keys(overrides).length ? { overrides } : {}),
    hpMax: hpMax || (cls ? cls.hd + mods.con + (level - 1) * (cls.hd / 2 + 1 + mods.con) : 8), hp: hp ?? hpMax ?? 8, tempHp,
    ...(ac != null ? { ac } : {}), speed: num(vit.speed) || 30, ...(initBonus != null ? { initBonus } : {}), ...(num(vit.darkvision) > 0 ? { darkvision: num(vit.darkvision) } : {}),
    hd: cls?.hd, hitDicePools, ...(hitDicePools.length === 1 ? { hitDice: `${hitDicePools[0].total}d${hitDicePools[0].die}` } : {}),
    attacks, slotPools, spellSources, spells: lines.join('\n'), resources, featureEntries, inventoryItems: items, coins, notes, personality,
    portrait: cls ? `assets/hero/class-${cls.id}.webp` : 'assets/hero/race-human.webp',
    conditions: [], deathSaves: { s: Math.max(0, num(vit.deathSuccesses) ?? 0), f: Math.max(0, num(vit.deathFails) ?? 0) },
    ...(num(d.exhaustion) > 0 ? { exhaustion: num(d.exhaustion) } : {}), ...(d.inspiration === true ? { inspiration: true } : {}),
  };
  // Совпало: блоки файла, перенесённые без замечаний, из всех найденных в файле.
  const flagged = new Set(issues.map((x) => x.key));
  const okBlocks = blocks.filter((b) => !b.keys.some((k) => flagged.has(k)));
  return {
    hero, file: fileName, avatar,
    matched: { ok: okBlocks.length, of: blocks.length, text: okBlocks.map((b) => b.name).join(', ') || 'почти ничего' },
    summary: [hero.raceName, classes.length > 1 ? classes.map((c) => `${c.name} ${c.levels}`).join(' / ') : `${hero.className || 'Без класса'} ${level}`, 'из LSS'].filter(Boolean).join(' · '),
    issues,
  };
}
