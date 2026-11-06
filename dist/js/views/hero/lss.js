// Перенос героя из Long Story Short (экран 72, #202). Файл LSS — {jsonType: 'character', version, data: "<JSON строкой>"};
// внутри: name, info (charClass, level, race, background, alignment, experience), stats, saves, skills, vitality, spells
// (slots-N), coins, weaponsList и тексты (документы редактора: spells-level-N, equipment, items, features, traits, prof,
// personality, ideals, bonds, flaws). Поля сверены по открытому конвертеру Foundry → LSS (github.com/Elfrey/elfrey-lss-converter).
// Результат — обычный лист Character (как «Свой герой»): выборы конструктора файл не хранит, поэтому сборку не проверяем,
// а показываем расхождения. Чистые функции, без DOM.
import { CLASSES, RACES, SKILLS, ABILITIES, mod, profBonus } from '../../data/rules.js';
import { makeCharacter } from '../../data/demo.js';

const val = (x) => (x && typeof x === 'object' && 'value' in x ? x.value : x);
const num = (x) => { const n = Number(String(val(x) ?? '').replace(/[^\d−+-]/g, '').replace('−', '-')); return Number.isFinite(n) && String(val(x) ?? '').trim() !== '' ? n : null; };
const str = (x) => (typeof val(x) === 'string' ? val(x).trim() : val(x) == null ? '' : String(val(x)));
const CLASS_EN = { barbarian: 'barb', bard: 'bard', cleric: 'cler', druid: 'drui', fighter: 'figh', monk: 'monk', paladin: 'pala', ranger: 'rang', rogue: 'rogu', sorcerer: 'sorc', warlock: 'warl', wizard: 'wiza' };
const SKILL_KEY = { animalhandling: 'animal', sleightofhand: 'sleight' };

/** Текст из документа редактора LSS ({type:'doc', content:[…]}): абзацы — строками. */
export function docText(doc) {
  const out = [];
  const walk = (n, line) => {
    if (!n || typeof n !== 'object') return line;
    if (n.type === 'text' && typeof n.text === 'string') return line + n.text;
    if (Array.isArray(n.content)) {
      const block = ['paragraph', 'heading', 'listItem', 'list_item'].includes(n.type);
      let cur = block ? '' : line;
      for (const c of n.content) cur = walk(c, cur);
      if (block) { if (cur.trim()) out.push(cur.trim()); return line; }
      return cur;
    }
    return line;
  };
  const rest = walk(doc, '');
  if (rest.trim()) out.push(rest.trim());
  return out;
}
const textOf = (t, key) => docText(t?.[key]?.value?.data ?? t?.[key]?.data ?? t?.[key]);

function matchClass(s) {
  const low = s.toLowerCase();
  return CLASSES.find((c) => low.startsWith(c.name.toLowerCase().slice(0, 5)) || low.startsWith(c.id) || low.startsWith(CLASS_EN[c.id])) || null;
}
const matchRace = (s) => { const low = s.toLowerCase(); return RACES.find((r) => low.startsWith(r.name.toLowerCase().slice(0, 5)) || low.startsWith(r.id)) || null; };

/**
 * Разобрать текст файла. Возвращает { hero, view } или { error }.
 * hero — Character без ID и владельца; view — форма LSS_IMPORT (fixture.js) для экрана.
 */
export function parseLss(text, { fileName = 'персонаж.json', size = 0 } = {}) {
  let outer;
  try { outer = JSON.parse(text); } catch { return { error: 'Это не JSON — нужен файл .json, выгруженный из Long Story Short.' }; }
  let d = outer?.data ?? outer;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return { error: 'В файле повреждён блок data.' }; } }
  if (!d || typeof d !== 'object' || (!d.name && !d.info && !d.stats)) return { error: 'В файле нет листа персонажа LSS (name, info, stats).' };

  const issues = [], ok = [];
  const name = str(d.name) || 'Герой из LSS';
  const classText = str(d.info?.charClass);
  const cls = matchClass(classText);
  const levels = [...classText.matchAll(/(\d+)/g)].map((m) => Number(m[1]));
  const level = Math.min(20, Math.max(1, num(d.info?.level) ?? (levels.reduce((a, b) => a + b, 0) || 1)));
  const raceText = str(d.info?.race);
  const race = matchRace(raceText);
  if (cls) ok.push('класс'); else issues.push({ kind: 'warn', title: `Класс «${classText || 'не указан'}» не узнали`, text: 'Лист сохранит название из файла; кость хитов и спасброски проверьте сами.', primary: 'Понятно' });
  if (/\//.test(classText)) issues.push({ kind: 'warn', title: 'Мультикласс', text: `В файле «${classText}». Перенесём общий уровень ${level} и первый класс; уровни остальных впишите в листе.`, primary: 'Понятно' });
  if (race) ok.push('раса'); else if (raceText) issues.push({ kind: 'warn', title: `Раса «${raceText}» не из базовых`, text: 'Сохраним название, особенности расы впишите в лист сами.', primary: 'Понятно' });

  const stats = {};
  for (const a of ABILITIES) { const s = num(d.stats?.[a.id]?.score ?? d.stats?.[a.id]); if (s !== null) stats[a.id] = s; }
  if (Object.keys(stats).length === 6) ok.push('характеристики');
  else issues.push({ kind: 'error', title: 'Не все характеристики', text: 'Недостающие поставим 10 — поправьте в листе.', primary: 'Понятно' });
  const saves = ABILITIES.filter((a) => d.saves?.[a.id]?.isProf).map((a) => a.id);
  const skillProf = {};
  for (const [key, s] of Object.entries(d.skills || {})) {
    const k = String(s?.name || key).toLowerCase().replace(/[\s_-]/g, '');
    const id = SKILL_KEY[k] || SKILLS.find((x) => x.id === k)?.id;
    const p = Number(s?.isProf === true ? 1 : s?.isProf || 0);
    if (id && p > 0) skillProf[id] = p >= 2 ? 2 : 1;
  }
  if (saves.length || Object.keys(skillProf).length) ok.push('спасброски и навыки');

  const v = d.vitality || {};
  const hpMax = num(v['hp-max']), hp = num(v['hp-current']) ?? hpMax, ac = num(v.ac), speed = num(v.speed);
  if (hpMax !== null) ok.push('хиты'); else issues.push({ kind: 'warn', title: 'В файле нет максимума хитов', text: 'Поставим по кости класса и Телосложению — проверьте в листе.', primary: 'Понятно' });
  if (ac !== null) ok.push('КД');
  const dieText = str(v['hit-die']);
  const die = Number(/(\d+)/.exec(dieText)?.[1]) || cls?.hd || 8;
  const diceLeft = num(v['hp-dice-current']);
  const fileProf = num(d.proficiency);
  if (fileProf !== null && fileProf !== profBonus(level)) issues.push({ kind: 'warn', title: `Бонус мастерства ${fileProf}`, text: `По правилам на ${level} уровне +${profBonus(level)}. Лист посчитает сам.`, primary: 'Взять по правилам' });

  const slotPools = [];
  for (const [key, s] of Object.entries(d.spells || {})) {
    const c = Number(/^slots-(\d)$/.exec(key)?.[1]); const max = num(s?.value ?? s);
    if (c && max) slotPools.push({ id: `lss-slot-${c}`, name: 'Ячейки заклинаний', circle: c, kind: 'spellcasting', max, spent: 0, recovery: 'long' });
  }
  for (const [key, s] of Object.entries(d.spellsPact || {})) {
    const c = Number(/^slots-(\d)$/.exec(key)?.[1]); const max = num(s?.value ?? s);
    if (c && max) slotPools.push({ id: `lss-pact-${c}`, name: 'Магия договора', circle: c, kind: 'pact', max, spent: 0, recovery: 'short' });
  }
  if (slotPools.length) { ok.push('ячейки'); issues.push({ kind: 'warn', title: 'Потраченные ячейки не переносим', text: 'Все ячейки будут полными — отметьте потраченные за столом.', primary: 'Понятно' }); }

  const t = d.text || {};
  const spellLines = [];
  for (let n = 0; n <= 9; n += 1) { const names = textOf(t, `spells-level-${n}`); if (names.length) spellLines.push(`${n ? n : 'Заговоры'}: ${names.join(', ')}`); }
  const items = [...textOf(t, 'equipment'), ...textOf(t, 'items')];
  const feats = [...textOf(t, 'features'), ...textOf(t, 'traits')];
  const attacks = (Array.isArray(d.weaponsList) ? d.weaponsList : []).map((w) => ({ name: str(w?.name) || 'Атака', bonus: num(w?.mod) ?? 0, damage: str(w?.dmg).replace(/к/g, 'd'), type: '', note: '' }));
  const persona = [['Черты', 'personality'], ['Идеалы', 'ideals'], ['Привязанности', 'bonds'], ['Слабости', 'flaws'], ['Предыстория', 'background']]
    .map(([label, key]) => [label, textOf(t, key).join(' ')]).filter(([, x]) => x);
  if (spellLines.length) ok.push(`заклинания: ${spellLines.reduce((n, l) => n + l.split(',').length, 0)}`);
  if (items.length) ok.push(`предметы: ${items.length}`);
  if (attacks.length) ok.push(`атаки: ${attacks.length}`);
  issues.push({ kind: 'warn', title: 'Портрета в файле нет', text: 'Пока покажем инициалы. Картинку можно поставить за столом в листе героя.', primary: 'Понятно' });

  const coins = {};
  for (const k of ['pp', 'ep', 'gp', 'sp', 'cp']) { const c = num(d.coins?.[k]); if (c) coins[k] = c; }
  const conMod = mod(stats.con ?? 10);
  const hero = makeCharacter({
    name, portrait: `ini:${name}`, classId: cls?.id || 'fighter', className: cls ? classText.replace(/\s*\(?\d+\)?\s*$/, '').split('/')[0].trim() || cls.name : classText || 'Класс',
    raceId: race?.id || 'human', raceName: raceText || race?.name || '', level, hd: die,
    background: str(d.info?.background), alignment: str(d.info?.alignment),
    stats, saves, skills: Object.keys(skillProf),
    ac: ac ?? 10 + mod(stats.dex ?? 10), hpMax: hpMax ?? die + conMod + (level - 1) * (die / 2 + 1 + conMod), hp: hp ?? undefined,
    speed: speed ?? race?.speed ?? 30, darkvision: race?.darkvision ?? 0, attacks,
    spells: spellLines.join('\n'), inventory: items.join(', '), features: feats.join('\n'),
    notes: persona.map(([l, x]) => `${l}: ${x}`).join('\n'),
  });
  hero.tempHp = num(v['hp-temp']) ?? 0;
  hero.proficiencies = { saves: Object.fromEntries(saves.map((s) => [s, 1])), skills: skillProf, languages: textOf(t, 'prof').join('; ') };
  hero.hitDicePools = [{ id: 'lss-hd', name: `d${die}`, die, total: level, spent: diceLeft !== null ? Math.max(0, Math.min(level, level - diceLeft)) : 0 }];
  if (slotPools.length) { hero.slotPools = slotPools; delete hero.slots; }
  if (Object.keys(coins).length) hero.coins = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, ...coins };
  if (num(d.info?.experience)) hero.xp = num(d.info.experience);
  delete hero.id; delete hero.ownerId;

  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const castAb = cls?.spell, dc = castAb ? 8 + profBonus(level) + mod(stats[castAb] ?? 10) : '—';
  return {
    hero,
    view: {
      live: true, file: `${fileName}${size ? ` · ${Math.max(1, Math.round(size / 1024))} КБ` : ''}`,
      matched: { ok: ok.length, of: ok.length + issues.filter((i) => i.kind === 'error').length, text: ok.join(', ') || 'ничего' },
      hero: { initials, name, summary: [raceText, classText || '—', 'из LSS'].filter(Boolean).join(' · '), hp: hero.hpMax, ac: hero.ac, dc },
      issues,
    },
  };
}
