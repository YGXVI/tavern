// Переводчик настоящего героя (Character, docs/data.md) в HeroView — форму, которую показывают экраны героя
// (docs/hero-view.md, #202/#203). Только чтение и расчёт подписей: правил здесь нет, числа берутся из readCharacter
// (лист за столом) и справочников. Чего у героя нет — пустые списки и прочерки, а не выдуманные значения.
import { readCharacter } from '../table/sheet-model.js';
import { attackBonus } from '../table/sheet-fields.js';
import { ABILITIES, SKILLS, CONDITIONS, classById, raceById, mod } from '../../data/rules.js';
import { srcOf } from '../../core/assets.js';
import { castKind, diceText, DMG } from '../ref/spell-power.js';
import { wornItems, armorClass, weaponAttacks, classResources, featureText, flavorFeature } from './gear.js';

const MINUS = '−';
export const signed = (n) => (Number.isFinite(n) ? (n < 0 ? `${MINUS}${Math.abs(n)}` : `+${n}`) : '—');
const num = (n, d = 0) => (Number.isFinite(n) ? n : d);
const str = (s) => (typeof s === 'string' ? s : '');
const die = (n) => (n ? `к${n}` : '');
// Порог опыта следующего уровня (PHB 2014, таблица «Развитие персонажа»).
const XP_NEXT = [300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000, null];
const CLASS_REF = (ref) => (typeof ref === 'string' ? ref.split(':').pop() : null);
// Время сотворения → группа боя. Неизвестное время — обычное действие; минуты и часы — «Особое» (#203, ревью листа).
const SPELL_TIME = (t) => (/реакц/i.test(t) ? 'reaction' : /бонусн/i.test(t) ? 'bonus' : !t || (/действ/i.test(t) && !/мин|час/i.test(t)) ? 'action' : 'special');
// Названия старых листов, которые в справочнике dnd.su записаны иначе.
const SPELL_ALIAS = { 'духовное оружие': 'божественное оружие' };
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Справочники для заклинаний (необязательно): { spells: spells-2014.json, ref: spells-ref-2014.json }.
 * Без них заклинание показывается с тем, что записано на листе.
 */
export function spellIndex(refs = {}) {
  const byId = new Map(), byName = new Map();
  for (const e of refs.spells?.entries || []) { byId.set(e.id, e); if (e.name?.ru) byName.set(e.name.ru.toLowerCase(), e); }
  for (const [a, b] of Object.entries(SPELL_ALIAS)) if (byName.has(b) && !byName.has(a)) byName.set(a, byName.get(b));
  // srd — тексты SRD 5.1 по индексу (spells-srd-2014.json): по ним кости и «атака или спасбросок» в строках боя.
  return { byId, byName, ref: refs.ref?.spells || {}, schools: refs.ref?.schools || {}, srd: refs.srd?.spells || {} };
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
// Языки конструктора — английскими названиями SRD (и секретные языки классов: друидический, воровской жаргон).
const LANG = { common: 'Общий', dwarvish: 'Дварфийский', elvish: 'Эльфийский', giant: 'Великанский', gnomish: 'Гномий', goblin: 'Гоблинский', halfling: 'Полуросликов', orc: 'Орочий', abyssal: 'Бездны', celestial: 'Небесный', draconic: 'Драконий', 'deep speech': 'Глубинная речь', 'deep-speech': 'Глубинная речь', infernal: 'Инфернальный', primordial: 'Первичный', sylvan: 'Сильван', undercommon: 'Подземный', druidic: 'Друидический', "thieves' cant": 'Воровской жаргон', 'thieves’ cant': 'Воровской жаргон', 'thieves-cant': 'Воровской жаргон' };
const ruLangs = (t) => t.split(/,\s*/).map((x) => LANG[x.trim().toLowerCase()] || x.trim()).filter(Boolean).join(', ');
// Инструменты и оружие конструктора (строки «Инструменты: Lute, Bagpipes», «Crossbow, light») — русскими названиями
// снаряжения SRD: сначала длинные имена, чтобы «Crossbow, light» не распалось на два.
const enNames = new WeakMap();
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’]/g, "['’]");
function ruGear(t, gear) {
  let out = String(t || '');
  if (!gear || !/[A-Za-z]/.test(out)) return out;
  if (!enNames.has(gear)) enNames.set(gear, [...gear.byId.values()].filter((g) => g.en && g.ru && g.en !== g.ru).sort((a, b) => b.en.length - a.en.length));
  for (const g of enNames.get(gear)) if (out.toLowerCase().includes(g.en.toLowerCase().slice(0, 4))) out = out.replace(new RegExp(`(^|[^A-Za-z])${esc(g.en)}(?![A-Za-z])`, 'gi'), (m, pre) => pre + g.ru);
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
    return { id: base?.id || null, name: str(c.name) || base?.name || 'Класс', short: base?.name || str(c.name), level: num(c.levels ?? c.level ?? r.level, 1), sub: str(c.subclass), hitDie: die(base?.hd || s.hd) };
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
    resources.push({ id: p.id, circle: num(p.circle), name: `Ячейки ${p.circle} ур.`, kind: 'slot', total, left: Math.max(0, total - num(p.spent)) });
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
  // Заряды умений класса (Ярость, Второе дыхание, Ци…), которых конструктор ещё не записал: считаем по уровню (gear.js).
  const mods = Object.fromEntries(ABILITIES.map((a) => [a.id, am(a.id)]));
  const clsRes = classResources(classes.filter((c) => c.id), mods, s.resources || []);
  for (const x of clsRes) resources.push({ id: x.id, name: x.name, kind: 'use', total: x.total, left: x.left, recovery: x.recovery, derived: true });

  // Заклинания.
  const sources = r.spellSources || [];
  const src0 = sources.find((x) => x?.ability) || sources[0];
  // Без источника магии у героя из конструктора магии нет (паладин и следопыт 1 уровня); у старого листа — по классу,
  // а половинным заклинателям — со 2 уровня.
  const cls0 = classById(s.classId);
  const castAb = src0?.ability || (s.creation || (['paladin', 'ranger'].includes(cls0?.id) && num(r.level, 1) < 2) ? null : cls0?.spell) || null;
  const castMod = castAb ? am(castAb) : 0;
  const dcSet = Number.isFinite(src0?.dcOverride) ? src0.dcOverride : null, atkSet = Number.isFinite(src0?.attackOverride) ? src0.attackOverride : null;
  const dc = castAb ? dcSet ?? 8 + prof + castMod : null, atk = castAb ? atkSet ?? prof + castMod : null;
  const known = r.knownSpells?.length ? r.knownSpells : legacySpells(r.spells.legacyText, sp);
  const spells = known.map((k) => {
    const e = sp.byId.get(k.ref), p = sp.ref[k.ref] || [];
    const level = num(k.circle ?? e?.level);
    return {
      id: k.id, name: str(k.name) || e?.name?.ru || 'Заклинание', level, school: sp.schools[e?.school] || '',
      time: p[0] || '', range: p[1] || '', duration: p[2] || '', comp: p[3] || '',
      prepared: level === 0 ? true : k.prepared !== false, conc: !!e?.concentration || undefined, ritual: !!(k.ritual || e?.ritual) || undefined,
      text: str(k.description), srd: !!e?.srd, how: castKind(sp.srd[e?.srd?.index]), dice: diceText(sp.srd[e?.srd?.index], level, num(r.level, 1)),
      dmgType: (p[4] || []).map((t) => DMG[t]).filter(Boolean)[0] || '', srdText: e?.srd ? sp.srd[e.srd.index]?.text || [] : [],
    };
  }).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'ru'));
  const spellcasting = castAb ? {
    ability: ABILITIES.find((a) => a.id === castAb)?.name || '', short: ABILITIES.find((a) => a.id === castAb)?.short || '',
    mod: signed(castMod), dc, attack: signed(atk), abilityId: castAb, sourceId: src0?.id || null, extra: src0?.id === 'src-extra',
    prepared: { now: spells.filter((x) => x.level > 0 && x.prepared).length, max: spells.filter((x) => x.level > 0).length },
    book: { now: spells.length, max: spells.length }, spells,
  } : null;

  // Действия: атаки листа и заклинания по времени сотворения.
  const actions = { action: [], bonus: [], reaction: [], special: [] };
  // Сумка — до действий: атаки нового героя берутся из надетого оружия.
  const gear = ctx.gear || null;
  // Старая сумка строкой: «…, 23 зм» — это деньги, а не предмет (если монет на листе нет).
  const COIN = { зм: 'gp', см: 'sp', мм: 'cp', пм: 'pp', эм: 'ep' }, legacyCoins = {};
  const rawItems = r.inventory.entries?.length ? r.inventory.entries : legacyList(r.inventory.legacyText).filter((name) => {
    const m = /^(\d+)\s*(зм|см|мм|пм|эм)$/i.exec(name.trim());
    if (m) legacyCoins[COIN[m[2].toLowerCase()]] = (legacyCoins[COIN[m[2].toLowerCase()]] || 0) + Number(m[1]);
    return !m;
  }).map((name, i) => ({ id: `legacy-item-${i}`, name: cap(name), quantity: 1 }));
  const worn = wornItems(rawItems, gear);
  const profText = [s.proficiencies?.tools, s.proficiencies?.weapons].filter(Boolean).join('\n');
  // Атаки надетым оружием (#203, правка героя): у героя из конструктора и у того, кто сам надевал оружие, — рядом со
  // своими атаками (атака с тем же именем заменяет строку оружия). Перенесённый лист с атаками ведёт их сам, как раньше.
  const ownAttack = new Set((r.attacks || []).map((a) => str(a.name).trim().toLowerCase()).filter(Boolean));
  if (!ownAttack.size || s.creation || rawItems.some((x) => x.equipped === true)) actions.action.push(...weaponAttacks(worn, mods, prof, profText).filter((w) => !ownAttack.has(w.name.toLowerCase())));
  for (const x of clsRes) if (x.row) actions[x.row].push({ id: x.id, name: x.name, sub: x.sub || '', icon: 'feature', res: x.id, left: x.left });
  // Строка атаки старого листа с именем заклинания (заговор «Священное пламя») — не отдельная строка, а чипы заклинания.
  const spellNames = new Set(spells.map((x) => x.name.toLowerCase()));
  const attackOf = new Map();
  for (const [i, a] of (r.attacks || []).entries()) {
    const save = /спасбросок\s+([А-ЯЁ]{3})?\s*СЛ\s*(\d+)/i.exec(str(a.note));
    // Бонус атаки: записанный итог, иначе — характеристика (+ мастерство при владении), как в листе за столом.
    const calc = Number.isFinite(a.bonus) ? a.bonus : a.ability ? attackBonus(s, a) : null;
    const hit = save ? undefined : Number.isFinite(calc) ? signed(calc) : undefined;
    const row = { id: a.id || `attack-${i}`, name: str(a.name) || 'Атака', sub: [a.note, a.type].filter(Boolean).join(' · '), icon: 'weapon', hit, dc: save ? `СЛ ${save[2]}` : undefined, dmg: str(a.damage).replace(/d/g, 'к') || undefined };
    if (spellNames.has(row.name.toLowerCase())) attackOf.set(row.name.toLowerCase(), row); else actions.action.push(row);
  }
  for (const x of spells) {
    if (x.level > 0 && !x.prepared) continue;
    const old = attackOf.get(x.name.toLowerCase());
    const hit = old ? old.hit : x.how?.attack && atk != null ? signed(atk) : undefined;
    const dcChip = old ? old.dc : x.how?.save && dc != null ? `СЛ ${dc}` : undefined;
    const sub = [x.level ? `${x.level} ур.` : 'Заговор', x.range, x.how?.save ? `спасбросок ${ABILITIES.find((a) => a.id === x.how.save)?.short || ''}` : '', x.dmgType].filter(Boolean).join(' · ');
    const row = { id: x.id, name: x.name, sub, icon: 'spell', slotLevel: x.level || undefined, hit, dc: dcChip, dmg: old?.dmg || x.dice || undefined, explain: dcChip ? 'dc' : undefined };
    actions[SPELL_TIME(x.time)].push(row);
  }
  // «Заклинаний пока нет» — только заклинателю без заклинаний; воину эта строка ни к чему.
  if (spellcasting && !spells.length) actions.special.push({ empty: true, name: 'Заклинаний пока нет', action: 'Выбрать' });

  // Сумка.
  // Сумка: имена и вес — из снаряжения SRD (по ref или русскому названию), «надето» — с листа или стартовый комплект (gear.js).
  const ICON = { armor: 'armor', shield: 'armor', weapon: 'weapon' };
  const items = worn;
  const lb = (w) => (w > 0 && w < 1 ? String(Math.round(w * 100) / 100).replace('.', ',') : w);
  const item = (x) => ({ id: x.id || '', name: x.g?.ru || cap(str(x.name)) || 'Предмет', sub: [(x.weight ?? x.g?.weight) ? `${lb(x.weight ?? x.g?.weight)} фнт` : '', str(x.description)].filter(Boolean).join(' · '), qty: num(x.quantity, 1), icon: ICON[x.g?.kind] || 'bag', tag: x.attuned ? 'Настроен' : undefined, equipped: !!x.equipped, wearable: ['armor', 'shield', 'weapon'].includes(x.g?.kind), auto: !!x.auto });
  const load = items.reduce((n, x) => n + num(x.weight ?? x.g?.weight) * num(x.quantity, 1), 0);
  const carry = num(score('str'), 10) * 15;
  const coins = { pp: 0, ep: 0, gp: 0, sp: 0, cp: 0, ...(s.coins && Object.values(s.coins).some((x) => x > 0) ? s.coins : legacyCoins) };

  const hp = { now: num(r.hp.current), max: num(r.hp.max), temp: num(r.hp.temp) };
  // КД не записан (герой из конструктора: доспехи в сумке, лист ведёт КД вручную) — без доспехов: 10 + Ловкость.
  const acKnown = Number.isFinite(r.ac);
  const acCalc = acKnown ? null : armorClass(worn, mods, classes.map((c) => c.id));
  const ac = acKnown ? r.ac : acCalc.value;
  const perc = 10 + skillVal('perception'), ins = 10 + skillVal('insight'), inv = 10 + skillVal('investigation');
  const strMod = am('str');
  const explain = {
    ac: acKnown ? `КД ${ac} — записано на листе` : acCalc.explain,
    init: `к20 ${signed(num(r.initiative))} = Ловкость ${signed(am('dex'))}`,
    hp: `${hp.max} хитов — ${classes.map((c) => `${c.name} ${c.level} (${c.hitDie})`).join(', ') || 'по листу'}, Телосложение ${signed(am('con'))} за уровень`,
  };
  // Подсказки «откуда число» у атак оружием — по ключу строки.
  for (const row of actions.action) if (row.explain && row.explain.includes(' = ')) { explain[`atk.${row.id}`] = row.explain; row.explain = `atk.${row.id}`; }
  if (spellcasting) explain.dc = dcSet != null ? `СЛ ${dc} — записано на листе` : `СЛ ${dc} = 8 + ${spellcasting.ability} ${signed(castMod)} + мастерство ${signed(prof)}`;
  for (const a of abilities) explain[`save.${a.key}`] = `к20 ${a.save} = ${a.name} ${a.mod}${a.saveProf ? ` + мастерство ${signed(prof)}` : ''}`;

  const conditions = (r.conditions || []).map((id) => ({ id, name: CONDITIONS.find((c) => c.id === id)?.name || id }));
  const pers = s.personality || {};
  // Без своего портрета — картинка класса (у всех 12 классов SRD есть арт в assets/hero).
  const clsKey = CLASS_REF(r.classes[0]?.ref) || r.classes[0]?.classId || s.classId;
  const pic = srcOf(s.portrait) || `assets/hero/class-${classById(clsKey) ? clsKey : 'wizard'}.webp`;
  const pt = profText.toLowerCase();
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
      hp, ac: { value: ac, note: acKnown ? '' : acCalc.note }, init: signed(num(r.initiative)), speed: `${num(r.movement.walk, 30)} фт`, prof: signed(prof),
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
    features: r.features.entries?.length ? r.features.entries.filter((f) => !flavorFeature(f.ref)).map((f) => ({ name: str(f.name), source: str(f.source), text: str(f.description) || featureText(f.ref) }))
      : r.features.legacyText ? [{ name: 'Умения', source: 'с листа', text: r.features.legacyText }] : [],
    traits: [],
    proficiencies: {
      armor: { light: /лёгк|легк/.test(pt), medium: /средн/.test(pt), heavy: /тяж/.test(pt), shield: /щит/.test(pt) }, weapons: { simple: /просто/.test(pt), martial: /воинск/.test(pt), other: /оружие:[^\n]*(кинжал|рапир|арбалет|лук|меч|посох|дротик|праща|булав)/.test(pt) },
      languages: ruLangs(str(s.proficiencies?.languages)) || '—', tools: ruGear(str(s.proficiencies?.tools), gear) || '—', weaponsText: ruGear(str(s.proficiencies?.weapons), gear),
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
  return { id: v.id, name: v.name, portrait: v.portrait, line: v.summary, summary: [v.summary, ctx.campaign?.name].filter(Boolean).join(' · '), campaign: ctx.campaign || null, hp: v.vitals.hp, stats: { hp: String(v.vitals.hp.max), ac: String(v.vitals.ac.value), level: String(v.level) }, status: 'ready' };
}
