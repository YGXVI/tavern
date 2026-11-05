// Переводчик настоящего героя (Character, docs/data.md) в HeroView — форму, которую показывают экраны героя
// (docs/hero-view.md, #202/#203). Только чтение и расчёт подписей: правил здесь нет, числа берутся из readCharacter
// (лист за столом) и справочников. Чего у героя нет — пустые списки и прочерки, а не выдуманные значения.
import { readCharacter } from '../table/sheet-model.js';
import { ABILITIES, SKILLS, CONDITIONS, classById, raceById, mod } from '../../data/rules.js';
import { srcOf } from '../../core/assets.js';

const MINUS = '−';
export const signed = (n) => (Number.isFinite(n) ? (n < 0 ? `${MINUS}${Math.abs(n)}` : `+${n}`) : '—');
const num = (n, d = 0) => (Number.isFinite(n) ? n : d);
const str = (s) => (typeof s === 'string' ? s : '');
const die = (n) => (n ? `к${n}` : '');
// Порог опыта следующего уровня (PHB 2014, таблица «Развитие персонажа»).
const XP_NEXT = [300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000, null];
const CLASS_REF = (ref) => (typeof ref === 'string' ? ref.split(':').pop() : null);
const SPELL_TIME = (t) => (/реакц/i.test(t) ? 'reaction' : /бонусн/i.test(t) ? 'bonus' : /действ/i.test(t) && !/мин|час/i.test(t) ? 'action' : 'special');

/**
 * Справочники для заклинаний (необязательно): { spells: spells-2014.json, ref: spells-ref-2014.json }.
 * Без них заклинание показывается с тем, что записано на листе.
 */
export function spellIndex(refs = {}) {
  const byId = new Map(), byName = new Map();
  for (const e of refs.spells?.entries || []) { byId.set(e.id, e); if (e.name?.ru) byName.set(e.name.ru.toLowerCase(), e); }
  return { byId, byName, ref: refs.ref?.spells || {}, schools: refs.ref?.schools || {} };
}

/**
 * Заклинания старого листа — текстом по строкам «Заговоры: А, Б» / «1: В, Г». ID несёт круг (legacy-<круг>-<n>):
 * по нему действие «Сотворить» тратит ячейку старого листа. Названия сверяются со справочником.
 */
export function legacySpells(text, sp = spellIndex()) {
  const out = [];
  for (const line of String(text || '').split(/\n+/)) {
    const m = /^\s*(Заговоры|\d)\s*(?:ур\.?|круг)?\s*:\s*(.+)$/i.exec(line);
    if (!m) continue;
    const level = /^\d$/.test(m[1]) ? Number(m[1]) : 0;
    for (const raw of m[2].split(/[,;]/)) {
      const name = raw.trim().replace(/\.$/, '');
      if (!name) continue;
      const e = sp.byName?.get(name.toLowerCase());
      out.push({ id: `legacy-${level}-${out.length}`, name, circle: level, ref: e?.id, prepared: true, description: null });
    }
  }
  return out;
}
const legacyList = (text) => String(text || '').split(/[,\n]+/).map((x) => x.trim().replace(/\.$/, '')).filter(Boolean);

/**
 * Character → HeroView.
 * ctx: { campaign: {id, name, live}?, userId, ownerName?, spells: spellIndex(...)? }
 */
export function toHeroView(ch, ctx = {}) {
  const r = readCharacter(ch);
  const s = r.source;
  const sp = ctx.spells || spellIndex();
  const prof = num(r.proficiency, 2);
  const score = (a) => r.abilities[a];
  const am = (a) => (Number.isFinite(score(a)) ? mod(score(a)) : 0);

  const classes = (r.classes.length ? r.classes : []).map((c) => {
    const base = classById(c.classId || CLASS_REF(c.ref)) || classById(s.classId);
    return { name: str(c.name) || base?.name || 'Класс', short: base?.name || str(c.name), level: num(c.levels ?? c.level ?? r.level, 1), sub: str(c.subclass), hitDie: die(base?.hd || s.hd) };
  });
  const classText = classes.map((c) => `${c.name} ${c.level}`).join(' / ') || 'Без класса';
  const race = str(s.raceName) || raceById(s.raceId)?.name || '';
  const background = str(s.background);
  const level = num(r.level, 1);

  const abilities = ABILITIES.map((a) => ({
    key: a.id, short: a.short, name: a.name, score: score(a.id) ?? '—', mod: signed(am(a.id)),
    save: signed(r.saves[a.id]?.value), saveProf: Number(s.proficiencies?.saves?.[a.id] ?? (s.saves || []).includes(a.id)) > 0,
  }));
  const skillMult = (id) => Number(s.proficiencies?.skills?.[id] ?? ((s.skills || []).includes(id) ? 1 : 0));
  const skillVal = (id) => { const v = r.skills[id]; return Number.isFinite(v?.value) ? v.value : Number.isFinite(v) ? v : am(SKILLS.find((x) => x.id === id)?.ab); };
  const skills = SKILLS.map((k) => ({
    name: k.name, ab: ABILITIES.find((a) => a.id === k.ab)?.short || '', mod: signed(skillVal(k.id)),
    prof: skillMult(k.id) >= 2 ? 'expert' : skillMult(k.id) >= 1 ? 'prof' : 'none',
  })).sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  // Ресурсы: ячейки по кругам, способности с зарядами, кости хитов.
  const resources = [];
  for (const p of r.slotPools || []) {
    const total = num(p.max); if (!total) continue;
    resources.push({ id: p.id, name: `Ячейки ${p.circle} ур.`, kind: 'slot', total, left: Math.max(0, total - num(p.spent)) });
  }
  for (const p of r.resources || []) {
    const total = num(p.max); if (!total) continue;
    resources.push({ id: p.id, name: str(p.name) || 'Умение', kind: 'use', total, left: Math.max(0, total - num(p.spent)) });
  }
  const hd = r.hitDice || [];
  const hdTotal = hd.reduce((n, p) => n + num(p.total), 0);
  const hdLeft = hd.reduce((n, p) => n + Math.max(0, num(p.total) - num(p.spent)), 0);
  const hdDie = hd.length === 1 ? die(hd[0].die) : hd.map((p) => die(p.die)).join('/');
  for (const p of hd) if (num(p.total)) resources.push({ id: p.id, name: `Кости хитов ${die(p.die)}`, kind: 'use', total: num(p.total), left: Math.max(0, num(p.total) - num(p.spent)) });

  // Заклинания.
  const sources = r.spellSources || [];
  const src0 = sources[0];
  const castAb = src0?.ability || classById(s.classId)?.spell || null;
  const castMod = castAb ? am(castAb) : 0;
  const dc = castAb ? 8 + prof + castMod : null, atk = castAb ? prof + castMod : null;
  const known = r.knownSpells?.length ? r.knownSpells : legacySpells(r.spells.legacyText, sp);
  const spells = known.map((k) => {
    const e = sp.byId.get(k.ref), p = sp.ref[k.ref] || [];
    const level = num(k.circle ?? e?.level);
    return {
      id: k.id, name: str(k.name) || e?.name?.ru || 'Заклинание', level, school: sp.schools[e?.school] || '',
      time: p[0] || '', range: p[1] || '', duration: p[2] || '', comp: p[3] || '',
      prepared: level === 0 ? true : k.prepared !== false, conc: !!e?.concentration || undefined, ritual: !!(k.ritual || e?.ritual) || undefined,
      text: str(k.description), srd: !!e?.srd,
    };
  }).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'ru'));
  const spellcasting = castAb ? {
    ability: ABILITIES.find((a) => a.id === castAb)?.name || '', short: ABILITIES.find((a) => a.id === castAb)?.short || '',
    mod: signed(castMod), dc, attack: signed(atk),
    prepared: { now: spells.filter((x) => x.level > 0 && x.prepared).length, max: spells.filter((x) => x.level > 0).length },
    book: { now: spells.length, max: spells.length }, spells,
  } : null;

  // Действия: атаки листа и заклинания по времени сотворения.
  const actions = { action: [], bonus: [], reaction: [], special: [] };
  for (const [i, a] of (r.attacks || []).entries()) {
    const hit = Number.isFinite(a.bonus) ? signed(a.bonus) : undefined;
    actions.action.push({ id: a.id || `attack-${i}`, name: str(a.name) || 'Атака', sub: [a.note, a.type].filter(Boolean).join(' · '), icon: 'weapon', hit, dmg: str(a.damage).replace(/d/g, 'к') || undefined });
  }
  for (const x of spells) {
    if (x.level > 0 && !x.prepared) continue;
    const row = { id: x.id, name: x.name, sub: [x.level ? `${x.level} ур.` : 'Заговор', x.range].filter(Boolean).join(' · '), icon: 'spell', slotLevel: x.level || undefined };
    actions[SPELL_TIME(x.time)].push(row);
  }
  if (!spellcasting) actions.special.push({ empty: true, name: 'Заклинаний пока нет', action: '' });

  // Сумка.
  const items = r.inventory.entries?.length ? r.inventory.entries : legacyList(r.inventory.legacyText).map((name) => ({ name, quantity: 1 }));
  const item = (x) => ({ name: str(x.name) || 'Предмет', sub: [x.weight ? `${x.weight} фнт` : '', str(x.description)].filter(Boolean).join(' · '), qty: num(x.quantity, 1), icon: 'bag', tag: x.attuned ? 'Настроен' : x.equipped ? 'Надето' : undefined });
  const load = items.reduce((n, x) => n + num(x.weight) * num(x.quantity, 1), 0);
  const carry = num(score('str'), 10) * 15;
  const coins = { pp: 0, ep: 0, gp: 0, sp: 0, cp: 0, ...(s.coins || {}) };

  const hp = { now: num(r.hp.current), max: num(r.hp.max), temp: num(r.hp.temp) };
  // КД не записан (герой из конструктора: доспехи в сумке, лист ведёт КД вручную) — без доспехов: 10 + Ловкость.
  const acKnown = Number.isFinite(r.ac), ac = acKnown ? r.ac : 10 + am('dex');
  const perc = 10 + skillVal('perception'), ins = 10 + skillVal('insight'), inv = 10 + skillVal('investigation');
  const strMod = am('str');
  const explain = {
    ac: acKnown ? `КД ${ac} — записано на листе` : `КД ${ac} = 10 + Ловкость ${signed(am('dex'))} (без доспехов; наденьте доспех в листе за столом)`,
    init: `к20 ${signed(num(r.initiative))} = Ловкость ${signed(am('dex'))}`,
    hp: `${hp.max} хитов — ${classes.map((c) => `${c.name} ${c.level} (${c.hitDie})`).join(', ') || 'по листу'}, Телосложение ${signed(am('con'))} за уровень`,
  };
  if (spellcasting) explain.dc = `СЛ ${dc} = 8 + ${spellcasting.ability} ${signed(castMod)} + мастерство ${signed(prof)}`;
  for (const a of abilities) explain[`save.${a.key}`] = `к20 ${a.save} = ${a.name} ${a.mod}${a.saveProf ? ` + мастерство ${signed(prof)}` : ''}`;

  const conditions = (r.conditions || []).map((id) => ({ id, name: CONDITIONS.find((c) => c.id === id)?.name || id }));
  const pers = s.personality || {};
  const pic = srcOf(s.portrait) || 'assets/hero/class-wizard.webp';
  return {
    id: s.id, name: str(s.name) || 'Без имени', portrait: pic, art: pic,
    subtitle: [classText, race, background].filter(Boolean).join(' · '),
    summary: [race, classText].filter(Boolean).join(' · '),
    fullTitle: [race, classText, ...classes.map((c) => c.sub).filter(Boolean), background, str(s.alignment)].filter(Boolean).join(' · '),
    race, background, alignment: str(s.alignment), pronoun: '',
    classes, level, xp: { now: num(s.xp), next: XP_NEXT[Math.min(19, Math.max(0, level - 1))] },
    player: ctx.ownerName || '', isMine: !!ctx.userId && (s.ownerId === ctx.userId || ctx.isMine === true),
    campaign: ctx.campaign || null,
    status: s.creation ? 'ready' : 'ready',
    vitals: {
      hp, ac: { value: ac, note: acKnown ? '' : 'без доспехов' }, init: signed(num(r.initiative)), speed: `${num(r.movement.walk, 30)} фт`, prof: signed(prof),
      size: 'Средний', carry: `${carry} фнт`, jump: { long: `${num(score('str'), 10)} фут.`, high: `${Math.max(0, 3 + strMod)} фут.` },
      passive: { perception: perc, insight: ins, investigation: inv },
      deathSaves: { ok: num(r.deathSaves.successes), fail: num(r.deathSaves.failures) },
      inspiration: !!s.inspiration, exhaustion: num(s.exhaustion), hitDice: { left: hdLeft, total: hdTotal, die: hdDie },
    },
    concentration: s.concentration ? { spell: str(s.concentration.spell || s.concentration) } : null,
    conditions, abilities, skills, resources,
    economy: [{ name: 'Действие', left: true }, { name: 'Бонусное', left: true }, { name: 'Реакция', left: true }, { name: `${num(r.movement.walk, 30)} фт`, left: true }],
    actions, spellcasting,
    inventory: {
      load: { now: Math.round(load), max: carry }, coins,
      equipped: items.filter((x) => x.equipped).map(item), pack: items.filter((x) => !x.equipped).map(item), attunement: items.filter((x) => x.attuned).map(item),
    },
    features: r.features.entries?.length ? r.features.entries.map((f) => ({ name: str(f.name), source: str(f.source), text: str(f.description) }))
      : r.features.legacyText ? [{ name: 'Умения', source: 'с листа', text: r.features.legacyText }] : [],
    traits: [],
    proficiencies: {
      armor: { light: false, medium: false, heavy: false, shield: false }, weapons: { simple: false, martial: false, other: false },
      languages: str(s.proficiencies?.languages) || '—', tools: str(s.proficiencies?.tools) || '—', weaponsText: '',
    },
    personality: {
      traits: str(pers.traits), ideals: str(pers.ideals), bonds: str(pers.bonds), flaws: str(pers.flaws),
      backstoryTitle: background ? `${background}.` : '', backstory: str(pers.backstory), appearance: str(pers.appearance),
      allies: [], goals: [], extra: [], treasures: [], notes: str(s.notes) ? [s.notes] : [],
    },
    explain,
  };
}

/** Карточка «Моих героев». */
export function toHeroCard(ch, ctx = {}) {
  const v = toHeroView(ch, ctx);
  return { id: v.id, name: v.name, portrait: v.portrait, summary: [v.summary, ctx.campaign?.name].filter(Boolean).join(' · '), campaign: ctx.campaign || null, stats: { hp: String(v.vitals.hp.max), ac: String(v.vitals.ac.value), level: String(v.level) }, status: 'ready' };
}
