// Шов между экранами героя и данными (#203). Экраны берут данные только отсюда и сообщают о действиях только сюда.
// Настоящие герои (#202, YGXVI / Claude): лист и «Мои герои» читают персонажей кампаний пользователя через adapter.js,
// действия листа меняют персонажа теми же путями, что лист за столом (updateCampaign → команды листа на сервере).
// Адреса образцов (lira, torin, корнеры) и шаги, ещё не подключённые к данным, работают на витрине fixture.js.
import { LIRA, TORIN, CORNERS, LEVEL_UP, CREATION, CREATION_LIVE } from './fixture.js';
import { toast } from '../../ui/kit.js';
import { campaignsFor, membership, updateCampaign, userById } from '../../core/campaign.js';
import { currentUserId } from '../../core/auth.js';
import { toHeroView, toHeroCard, spellIndex } from './adapter.js';
import { applyHeroAction } from './actions.js';
import { indexCreation, newCreation, applyCreationChoice, creationModel, creationLiveModel, creationDoneModel, creationCharacter } from './creation.js';
import { isServerMode } from '../../core/store.js';
import { newLevelUp, levelUpModel, applyLevelUpChoice, levelUpRequest } from './levelup-model.js';
import { gearIndex } from './gear.js';

const HEROES = { lira: LIRA, torin: TORIN };

// Справочники заклинаний для листа: время, дистанция, школа. Без них лист показывает то, что записано у героя.
let spells = spellIndex();
const json = (p) => fetch(new URL(p, import.meta.url)).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))));
// Справочники конструктора для мастера создания (character-options, снаряжение, умения). Без них — витрина.
let creationIx = null;
// Снаряжение SRD по ID и русскому названию: имена, вес, КД и атаки в листе (gear.js, #203).
let gear = null;
await Promise.all(['spells-2014', 'spells-ref-2014', 'character-options-2014', 'equipment-2014', 'features-2014', 'spells-srd-2014'].map((n) => json(`../../data/${n}.json`)))
  .then(([list, ref, options, equipment, features, srd]) => {
    spells = spellIndex({ spells: list, ref, srd });
    gear = gearIndex(equipment);
    creationIx = indexCreation({ options, spells: list, equipment, features }, ref);
  })
  .catch(() => { /* без справочника — подписи с листа и витрина мастера */ });

// Адрес настоящего героя — «кампания~персонаж»: один и тот же персонаж бывает в нескольких кампаниях (копии).
export const heroKey = (cid, chid) => `${cid}~${chid}`;
/** Настоящий герой по адресу (или по ID персонажа — первый найденный): кампания и персонаж, видимые пользователю. */
export function findHero(key, userId = currentUserId()) {
  if (!key || !userId) return null;
  const [cid, chid] = String(key).includes('~') ? String(key).split('~') : [null, key];
  for (const c of campaignsFor(userId)) {
    if (cid && c.id !== cid) continue;
    const ch = (c.characters || []).find((x) => x.id === chid);
    if (ch) return { c, ch };
  }
  return null;
}
const ctxOf = (c, ch, userId) => {
  const m = membership(c, userId);
  return {
    campaign: { id: c.id, name: c.name, live: false }, userId, spells, gear,
    ownerName: userById(ch.ownerId)?.name || '', isMine: ch.ownerId === userId || (m?.role === 'player' && m.characterId === ch.id),
  };
};

/** Лист героя. corner — образец из CORNERS (только для образцов): down, concentration, noSlots, multiclass, unfinished. */
export function heroView(id, corner = '') {
  const userId = currentUserId();
  const real = findHero(id, userId);
  if (real) {
    const v = toHeroView(real.ch, ctxOf(real.c, real.ch, userId));
    // 0 хитов — панель спасбросков от смерти вместо обычного боя (корнер 67 на настоящих данных).
    return { ...v, id: heroKey(real.c.id, real.ch.id), live: true, canLevelUp: canLevelUp(heroKey(real.c.id, real.ch.id)), down: v.vitals.hp.max > 0 && v.vitals.hp.now === 0 };
  }
  // Образцы макета (lira, torin, корнеры) — только для превью листа на карте; остальные адреса — «героя нет».
  if (!HEROES[id]) return null;
  const base = HEROES[id];
  return corner && CORNERS[corner] ? { ...base, ...CORNERS[corner], corner } : base;
}

/** Отложенное из справочника (#/ref, «В книгу героя») — на этом устройстве; пусто — образец. */
function savedFromRef() {
  try { const p = JSON.parse(localStorage.getItem('rasputye-ref-v1') || '{}'); return (p.saved || []).map((k) => p.names?.[k]).filter(Boolean); } catch { return []; }
}
/**
 * «Герои»: свои герои во всех кампаниях; у мастера — ещё герои его кампаний (party, с именем игрока).
 * Образцов больше нет (#203): пусто — значит пусто.
 */
export function heroList() {
  const userId = currentUserId();
  const mine = [], party = [];
  for (const c of userId ? campaignsFor(userId) : []) {
    const m = membership(c, userId);
    for (const ch of c.characters || []) {
      if ((ch.profile || 'pc') !== 'pc') continue;
      const card = { ...toHeroCard(ch, ctxOf(c, ch, userId)), id: heroKey(c.id, ch.id) };
      if (ch.ownerId === userId || (m?.role === 'player' && m.characterId === ch.id)) mine.push(card);
      else if (m?.role === 'master') {
        const seat = c.members.find((x) => x.characterId === ch.id && x.status === 'active');
        party.push({ ...card, player: seat ? userById(seat.userId)?.name || 'игрок' : '' });
      }
    }
  }
  return { heroes: mine, party, saved: savedFromRef(), sample: false };
}
/** Мастер создания для кампании cid (из «Кем сядете за стол?»): черновик другой кампании начинается заново. */
export function startCreation(cid) {
  if (!cid || !creationIx) return;
  const st = readJSON(BUILD_KEY);
  if (st?.campaignId === cid && st.userId === currentUserId()) return;
  const c = campaignsFor(currentUserId()).find((x) => x.id === cid);
  if (!c) return;
  try { sessionStorage.removeItem(BUILD_KEY); sessionStorage.removeItem(UI_KEY); } catch { /* приватный режим */ }
  saveBuild({ ...newCreation(creationIx, { campaign: c, userId: currentUserId() }), userId: currentUserId() });
}
// ——— Мастер создания на конструкторе (#200/#202, P3) ———
// Черновик конструктора живёт в sessionStorage вкладки до отправки; имя, мировоззрение и черты — из черновика окна.
const BUILD_KEY = 'rasputye-hero-build-v1', UI_KEY = 'rasputye-hero-draft';
const readJSON = (k, store = sessionStorage) => { try { return JSON.parse(store.getItem(k)) || null; } catch { return null; } };
/** Кампания для нового героя: где игрок ещё без героя, иначе любая, где он играет или ведёт. */
function targetCampaign(userId, preferred) {
  const list = userId ? campaignsFor(userId).filter((c) => membership(c, userId)?.status === 'active') : [];
  const role = (c) => membership(c, userId);
  return list.find((c) => c.id === preferred) || list.find((c) => role(c).role === 'player' && !role(c).characterId)
    || list.find((c) => role(c).role === 'player') || list[0] || null;
}
function buildState() {
  if (!creationIx) return null;
  const userId = currentUserId();
  let st = readJSON(BUILD_KEY);
  if (!st || st.v !== 1 || st.userId !== userId) {
    const c = targetCampaign(userId);
    st = { ...newCreation(creationIx, { campaign: c, userId: userId || 'guest' }), userId };
  }
  // Имя — из окна (шаг «Образ» пишет его только в свой черновик).
  const ui = readJSON(UI_KEY) || {};
  if (typeof ui.name === 'string' && ui.name !== st.draft.identity.name) applyCreationChoice(creationIx, st, { step: 'look', id: 'name', value: ui.name });
  for (const k of ['pronoun', 'alignment', 'traits', 'ideals', 'bonds', 'flaws']) if (ui[k] !== undefined) st.look[k] = ui[k];
  return st;
}
const saveBuild = (st) => { try { sessionStorage.setItem(BUILD_KEY, JSON.stringify(st)); } catch { /* приватный режим */ } };
const campaignName = (st) => (st?.campaignId ? campaignsFor(currentUserId()).find((c) => c.id === st.campaignId)?.name : '') || '';

/** Мастер создания: шаги, варианты, правила кампании, быстрый герой. */
// Портреты на выбор (#203): арты классов и рас и портреты героев из набора. Свой файл — загрузкой (песочница).
const CLASS_IDS = ['barbarian', 'bard', 'cleric', 'druid', 'fighter', 'monk', 'paladin', 'ranger', 'rogue', 'sorcerer', 'warlock', 'wizard'];
const RACE_IDS = ['human', 'dwarf', 'elf', 'halfling', 'dragonborn', 'gnome', 'half-elf', 'half-orc', 'tiefling'];
export const PORTRAITS = [...CLASS_IDS.map((k) => `assets/hero/class-${k}.webp`), ...RACE_IDS.map((k) => `assets/hero/race-${k}.webp`), ...['lira', 'mira', 'garr', 'elian', 'torin'].map((k) => `assets/portraits/${k}.webp`)];
const tailId = (id) => String(id || '').split(':').pop();
const defaultPortrait = (st) => st.look.portrait || `assets/hero/class-${CLASS_IDS.includes(tailId(st.draft.levelHistory?.[0]?.classId)) ? tailId(st.draft.levelHistory[0].classId) : 'fighter'}.webp`;

// ——— Быстрый герой (89–90, #203): три ответа → класс, раса и предыстория, остальное — как «обычно» в мастере ———
const QUICK_CLASS = (role, talk) => ({
  front: talk === 'fist' ? 'barbarian' : talk === 'word' ? 'paladin' : 'fighter', range: 'ranger',
  magic: talk === 'word' ? 'sorcerer' : talk === 'trick' ? 'warlock' : 'wizard', heal: talk === 'word' ? 'bard' : talk === 'fist' ? 'druid' : 'cleric',
  shadow: talk === 'fist' ? 'monk' : 'rogue',
}[role] || 'fighter');
const QUICK_RACE = { barbarian: 'half-orc', fighter: 'human', paladin: 'dragonborn', ranger: 'elf', wizard: 'gnome', sorcerer: 'tiefling', warlock: 'tiefling', cleric: 'dwarf', bard: 'half-elf', druid: 'elf', rogue: 'halfling', monk: 'elf' };
const full = (b) => !b || /выбрано (\d+) из \1/.test(b.note);
/** Собрать героя по ответам быстрого героя: новый черновик той же кампании, все выборы — первые подходящие. */
function quickBuild(st, answers) {
  const c = campaignsFor(currentUserId()).find((x) => x.id === st.campaignId) || targetCampaign(currentUserId());
  const next = { ...newCreation(creationIx, { campaign: c, userId: currentUserId() }), userId: currentUserId(), quick: answers };
  const ch = (x) => applyCreationChoice(creationIx, next, x);
  const m = () => creationModel(creationIx, next);
  const cls = QUICK_CLASS(answers.role, answers.talk);
  ch({ step: 'race', id: QUICK_RACE[cls] }); ch({ step: 'class', id: cls }); ch({ step: 'background', id: m().backgrounds[0]?.id || 'acolyte' }); ch({ step: 'abilities', id: 'auto' });
  for (let i = 0; i < 10; i += 1) {
    const box = [...m().extra.race, ...m().extra.class].find((b) => !full(b)); if (!box) break;
    for (const it of box.list) { if (full([...m().extra.race, ...m().extra.class].find((x) => x.choiceId === box.choiceId))) break; ch({ step: 'class', id: 'extra', value: `${box.choiceId}|${it.value}` }); }
    if (!full([...m().extra.race, ...m().extra.class].find((x) => x.choiceId === box.choiceId))) break;
  }
  for (const s of m().backgroundSkills?.list?.filter((x) => !x.from) || []) if (!full(m().backgroundSkills)) ch({ step: 'background', id: 'skill', value: s.name });
  for (const l of m().backgroundLangs?.list?.filter((x) => !x.from) || []) { if (full(m().backgroundLangs)) break; ch({ step: 'background', id: 'lang', value: l.name }); }
  for (const g of m().equipment?.groups || []) ch({ step: 'equipment', id: 'eq', value: `${g.title}|${g.options[0].name}` });
  ch({ step: 'spells', id: 'auto' });
  if (answers.name) ch({ step: 'look', id: 'name', value: answers.name });
  next.look.portrait = answers.portrait || `assets/hero/class-${cls}.webp`;
  return next;
}
const QUICK_LABEL = { role: { front: 'стоять впереди', range: 'бить издалека', magic: 'колдовать', heal: 'лечить и вдохновлять', shadow: 'действовать из тени' }, talk: { fist: 'кулаком', word: 'словом', trick: 'хитростью', book: 'знанием' } };
/** Итог быстрого героя той же формы, что образец 90. */
function quickResult(st) {
  const d = creationDoneModel(creationIx, st);
  const [race, cls] = String(d.line || '').split(' · ');
  const a = st.quick || {};
  return {
    portrait: defaultPortrait(st), name: d.name || 'Новый герой', summary: d.line,
    abilities: d.abilities, facts: d.facts.slice(0, 4),
    chosen: [['Раса', race || '—', 'race'], ['Класс', cls || '—', 'class'], ['Характеристики', 'стандартный набор под класс', 'abilities'], ['Снаряжение', 'первый вариант каждого набора', 'equipment'], ['Заклинания', 'подобраны по классу', 'spells']],
    why: [QUICK_LABEL.role[a.role], QUICK_LABEL.talk[a.talk], d.name].filter(Boolean),
    ok: d.status === 'valid', missing: d.missing,
  };
}
export const creationView = () => {
  const st = buildState();
  if (!st) return CREATION;
  const m = creationModel(creationIx, st, { campaignName: campaignName(st) });
  m.look = { ...m.look, portrait: defaultPortrait(st), portraits: PORTRAITS };
  const a = st.quick || {};
  m.quick = { ...CREATION.quick, built: !!st.quick, portraits: PORTRAITS, picked: { role: a.role || 'front', talk: a.talk || 'fist', name: a.name ?? m.look.name ?? '' }, result: quickResult(st) };
  return m;
};
/** Живой лист справа на шаге stepId. */
export const creationLive = (stepId) => { const st = buildState(); return st ? { ...creationLiveModel(creationIx, st), portrait: defaultPortrait(st) } : CREATION_LIVE[stepId] || CREATION_LIVE.race; };
/** Итог «Герой готов»: null — витрина. */
export const creationDone = () => {
  const st = buildState();
  if (!st) return null;
  const d = { ...creationDoneModel(creationIx, st), campaign: campaignName(st), art: defaultPortrait(st) };
  // КД со стартовым доспехом и щитом — так же, как его посчитает лист (gear.js), а не «без доспехов».
  if (d.status === 'valid') {
    try {
      const hero = creationCharacter(creationIx, structuredClone(st), { userId: currentUserId() });
      const v = toHeroView(hero.data, { spells, gear });
      d.facts = d.facts.map((f) => (f.label === 'Класс доспеха' ? { ...f, value: String(v.vitals.ac.value), sub: v.vitals.ac.note || f.sub } : f));
    } catch { /* итог без КД со снаряжением */ }
  }
  return d;
};
// ——— Повышение уровня (#202): план rules/level-up.js, запись — level_up_character ———
const LU_KEY = 'rasputye-hero-levelup-v1';
function levelUpState(key) {
  const real = findHero(key);
  if (!real || !creationIx) return null;
  const k = heroKey(real.c.id, real.ch.id);
  let st = readJSON(LU_KEY);
  // Черновик — для этого героя и этого уровня; иначе начинаем заново.
  if (!st || st.v !== 1 || st.key !== k) st = newLevelUp(creationIx, real.ch, { key: k, campaignId: real.c.id });
  return { st, real, key: k };
}
const saveLevelUp = (st) => { try { sessionStorage.setItem(LU_KEY, JSON.stringify(st)); } catch { /* приватный режим */ } };
/** Повышение уровня героя key; без настоящего героя — витрина. */
export const levelUpView = (key) => {
  const s = key && levelUpState(key);
  if (!s) return LEVEL_UP;
  return levelUpModel(creationIx, s.st, s.real.ch, heroView(s.key));
};
/** Может ли пользователь повысить героя: владелец или мастер кампании. */
export function canLevelUp(key) {
  const real = findHero(key), userId = currentUserId();
  return !!real && (real.ch.ownerId === userId || membership(real.c, userId)?.role === 'master');
}
/** Свой портрет из файла: в песочнице — на устройстве (idb:), на сервере загрузка игрокам ещё не включена. */
export async function uploadPortrait(file) {
  if (isServerMode()) { say('Свой портрет — чуть позже', 'Пока выберите из набора: загрузку портретов игрокам включим на сервере.'); return null; }
  try { const { storeImage } = await import('../../core/assets.js'); return (await storeImage(file)).ref; } catch (e) { say('Портрет не загрузился', e.message, 'alert-circle'); return null; }
}
/** Снаряжение SRD для «Добавить предмет»: [{ ref, name, kind, weight }] (пусто — справочник не загрузился). */
export const gearCatalog = () => (gear ? [...gear.byId.values()].map((g) => ({ ref: g.id, name: g.ru, kind: g.kind, weight: g.weight })) : []);
// ——— Перенос из Long Story Short (72, #203): разбор файла — lss.js, разобранный лист живёт в вкладке до переноса ———
const LSS_KEY = 'rasputye-hero-lss-v1';
/** Разобранный файл LSS или null — тогда экран просит файл. */
export const lssImportView = () => readJSON(LSS_KEY);
export async function loadLssFile(file) {
  try {
    const { parseLss } = await import('./lss.js');
    const parsed = parseLss(await file.text(), { fileName: `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} КБ`, spellNames: spells.byName });
    sessionStorage.setItem(LSS_KEY, JSON.stringify(parsed));
  } catch (e) { say('Файл не подошёл', e.message, 'alert-circle'); return; }
  window.dispatchEvent(new CustomEvent('hero:changed'));
}
export const dropLss = () => { try { sessionStorage.removeItem(LSS_KEY); } catch { /* приватный режим */ } window.dispatchEvent(new CustomEvent('hero:changed')); };

/**
 * Положить готового героя (данные листа) в кампанию: песочница — сразу, сервер — createCharacterSheet. Если у игрока
 * в этой кампании ещё нет героя — он садится за стол этим героем, иначе открывается лист.
 */
async function placeHero(c, data, { title }) {
  const userId = currentUserId();
  const id = (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `ch-${Date.now().toString(36)}`);
  const hero = structuredClone(data);
  // Черт характера сервер пока не хранит (#202): переносим их в заметки, чтобы не потерять.
  if (isServerMode() && hero.personality) {
    const p = hero.personality, lines = [['Черты', p.traits], ['Идеалы', p.ideals], ['Привязанности', p.bonds], ['Слабости', p.flaws], ['Предыстория', p.backstory]].filter(([, x]) => x);
    if (lines.length) hero.notes = [hero.notes, lines.map(([k, x]) => `${k}: ${x}`).join('\n')].filter(Boolean).join('\n\n');
    delete hero.personality;
  }
  const m = membership(c, userId);
  const seat = m?.role === 'player' && !m.characterId;
  try {
    if (isServerMode()) { const sync = await import('../../server/sync.js'); await sync.createCharacterSheet(c.id, { ...hero, id, ownerId: userId }); }
    else updateCampaign(c.id, (camp) => { camp.characters.push({ ...hero, id, ownerId: userId }); });
  } catch (e) { say(`${title} не удалось`, e?.message || 'Сервер не принял героя.', 'alert-circle'); return null; }
  say(`${hero.name} — в «${c.name}»`, seat ? 'Садитесь за стол.' : 'Лист открыт.', 'tick-02');
  if (seat) { const { claim } = await import('../screens.js'); claim(c.id, userId, id); } else location.hash = `#/hero/${heroKey(c.id, id)}`;
  return id;
}
async function importLss(p = {}) {
  const v = lssImportView();
  if (!v) return;
  const st = readJSON(BUILD_KEY);
  const c = targetCampaign(currentUserId(), p.campaignId || st?.campaignId);
  if (!c) { say('Нет кампании', 'Войдите в кампанию по приглашению мастера — герой появится в ней.'); return; }
  const id = await placeHero(c, v.hero, { title: 'Перенос' });
  if (id) try { sessionStorage.removeItem(LSS_KEY); } catch { /* приватный режим */ }
}
/** Привести героя в другую кампанию — копией листа (у каждой кампании свой экземпляр, как при выборе героя). */
async function bringToCampaign(p = {}) {
  const real = findHero(p.heroId);
  const c = campaignsFor(currentUserId()).find((x) => x.id === p.campaignId);
  if (!real || !c) { say('Не нашёл героя или кампанию'); return; }
  const { id, ownerId, ...data } = structuredClone(real.ch);
  await placeHero(c, data, { title: 'Перенос героя' });
}
/** Кампании, куда можно привести героя key: где пользователь играет или ведёт, кроме текущей. */
export const bringTargets = (key) => { const real = findHero(key); return campaignsFor(currentUserId()).filter((c) => c.id !== real?.c.id && membership(c, currentUserId())?.status === 'active').map((c) => ({ id: c.id, name: c.name, free: membership(c, currentUserId())?.role === 'player' && !membership(c, currentUserId()).characterId })); };

const say = (title, body, icon = 'information-circle') => toast({ title, body, icon, timeout: 2600 });
const stub = (name) => (payload) => {
  console.info('[hero]', name, payload ?? '');
  say('Пока на образце', `«${name}» подключат к данным позже.`);
};
// Действие листа настоящего героя: меняем персонажа в кампании, экран перерисуется по данным.
const live = (name) => (payload = {}) => {
  const real = findHero(payload.heroId);
  const chid = real?.ch.id;
  if (!real) return stub(name)(payload);
  let note = null;
  updateCampaign(real.c.id, (c) => {
    const ch = c.characters.find((x) => x.id === chid);
    if (ch) note = applyHeroAction(ch, name, payload, { random: Math.random });
  });
  if (note) say(note.title, note.body || '', note.icon);
};

/**
 * Действия экранов. Каждое получает простой объект и ничего не возвращает: экраны обновятся по данным.
 * Список имён и полей — в docs/hero-view.md.
 */
function choose(payload = {}) {
  const st = buildState();
  if (!st) return stub('Выбор в мастере')(payload);
  // Быстрый герой: каждый ответ пересобирает черновик целиком (quickBuild); портрет — в черновик окна.
  if (payload.step === 'quick') {
    const answers = { ...(st.quick || {}), [payload.id]: payload.value };
    saveBuild(quickBuild(st, answers));
    window.dispatchEvent(new CustomEvent('hero:changed'));
    return;
  }
  if (payload.step === 'look' && payload.id === 'portrait') { st.look.portrait = String(payload.value || ''); saveBuild(st); window.dispatchEvent(new CustomEvent('hero:changed')); return; }
  const note = applyCreationChoice(creationIx, st, payload);
  saveBuild(st);
  if (note) say(note.title, note.body || '', note.icon);
  window.dispatchEvent(new CustomEvent('hero:changed'));
}
let finishing = false;
async function finish() {
  const st = buildState();
  if (!st) return stub('Готово')();
  const userId = currentUserId();
  const c = targetCampaign(userId, st.campaignId);
  if (!c) { say('Нет кампании', 'Войдите в кампанию по приглашению мастера — герой появится в ней.'); return; }
  st.campaignId = c.id;
  let hero;
  try { hero = creationCharacter(creationIx, st, { userId }); } catch (e) {
    say('Герой ещё не готов', (e.missing || []).slice(0, 3).map((m) => m.message).join(' ') || e.message, 'alert-circle');
    return;
  }
  hero.data.portrait = defaultPortrait(st); // портрет — он же токен на карте
  saveBuild(st); // ID героя и операции — до отправки: повтор после обрыва пошлёт тот же запрос
  if (finishing) return;
  finishing = true;
  const m = membership(c, userId);
  const claim = m?.role === 'player' && !m.characterId;
  try {
    if (isServerMode()) {
      const sync = await import('../../server/sync.js');
      await sync.createHeroSheet(c.id, hero, claim);
    } else {
      updateCampaign(c.id, (camp) => {
        if (camp.characters.some((x) => x.id === hero.characterId)) return;
        camp.characters.push({ ...hero.data, id: hero.characterId, ownerId: userId });
        const me = camp.members.find((x) => x.userId === userId);
        if (claim && me) me.characterId = hero.characterId;
      });
    }
  } catch (e) {
    finishing = false;
    const kind = e?.kind;
    say('Герой не создан', kind === 'network' ? 'Нет связи — нажмите ещё раз, отправим тот же запрос.' : kind === 'duplicate' ? 'Такой ID уже занят — начните заново.' : e?.message || 'Сервер не принял героя.', 'alert-circle');
    if (kind === 'duplicate') sessionStorage.removeItem(BUILD_KEY);
    return;
  }
  finishing = false;
  try { sessionStorage.removeItem(BUILD_KEY); sessionStorage.removeItem(UI_KEY); } catch { /* приватный режим */ }
  say(`${hero.data.name} готов`, `Герой в кампании «${c.name}».`, 'tick-02');
  // Игрок садится за стол этим героем: токен встаёт на сцену, открывается стол. Иначе — лист нового героя.
  if (claim) {
    const { seatHero } = await import('../screens.js');
    seatHero(c.id, userId, hero.characterId);
    return;
  }
  location.hash = `#/hero/${heroKey(c.id, hero.characterId)}`;
}

let leveling = false;
async function levelUp(p = {}) {
  const s = levelUpState(p.heroId);
  if (!s) return stub('Повышение уровня')(p);
  const { st, real } = s;
  if (!p.done) {
    const note = applyLevelUpChoice(creationIx, st, real.ch, p);
    saveLevelUp(st);
    if (note) say(note.title, note.body || '', note.icon);
    window.dispatchEvent(new CustomEvent('hero:changed'));
    return;
  }
  if (!canLevelUp(p.heroId)) { say('Повышает владелец героя или мастер'); return; }
  let req;
  try { req = levelUpRequest(creationIx, st, real.ch); } catch (e) { say('Повышение не готово', e.message, 'alert-circle'); return; }
  saveLevelUp(st);
  if (leveling) return;
  leveling = true;
  try {
    if (isServerMode()) {
      const sync = await import('../../server/sync.js');
      await sync.levelUpHeroSheet(real.c.id, real.ch.id, req);
    } else {
      updateCampaign(real.c.id, (camp) => {
        const ch = camp.characters.find((x) => x.id === real.ch.id);
        if (!ch) return;
        Object.assign(ch, structuredClone(req.payload.patch));
        if (req.payload.creation) ch.creation = structuredClone(req.payload.creation);
        if (Number.isFinite(req.gain)) { ch.hpMax = (ch.hpMax || 0) + req.gain; ch.hp = (ch.hp || 0) + req.gain; }
      });
    }
  } catch (e) {
    leveling = false;
    const kind = e?.kind;
    if (kind === 'conflict') { sessionStorage.removeItem(LU_KEY); say('Лист изменился', 'Откройте повышение заново — план пересчитается по новому листу.', 'alert-circle'); return; }
    say('Уровень не записан', kind === 'network' ? 'Нет связи — нажмите ещё раз, отправим тот же запрос.' : e?.message || 'Сервер не принял повышение.', 'alert-circle');
    return;
  }
  leveling = false;
  try { sessionStorage.removeItem(LU_KEY); } catch { /* приватный режим */ }
  say(`${real.ch.name}: ${st.fromLevel + 1} уровень`, Number.isFinite(req.gain) ? `+${req.gain} хитов` : '', 'tick-02');
  location.hash = `#/hero/${s.key}`;
}

export const heroActions = {
  createFrom: (p = {}) => (p.path === 'steps' && creationIx ? undefined : stub('Новый герой')(p)), // { path: 'steps' | 'quick' | 'lss' }
  choose,                                      // { step, id, value }
  finish,                                      // { draftId }
  bringToCampaign,                             // { heroId, campaignId }
  setHp: live('setHp'),                        // { heroId, delta, temp }
  roll: live('roll'),                          // { heroId, what, formula }
  useResource: live('useResource'),            // { heroId, id }
  toggleCondition: live('toggleCondition'),    // { heroId, id }
  dropConcentration: live('dropConcentration'),// { heroId }
  rest: live('rest'),                          // { heroId, kind: 'short' | 'long', hitDice, recover: [levels] }
  deathSave: live('deathSave'),                // { heroId }
  prepare: live('prepare'),                    // { heroId, spellId, prepared }
  cast: live('cast'),                          // { heroId, spellId, slot }
  editField: live('editField'),                // { heroId, field, value }
  addItem: live('addItem'),                    // { heroId, name, quantity, ref?, weight? }
  removeItem: live('removeItem'),              // { heroId, itemId }
  equip: live('equip'),                        // { heroId, itemId, auto: [ids] }
  coins: live('coins'),                        // { heroId, pp, ep, gp, sp, cp }
  levelUp,                                     // { heroId, hp: 'average' | 'roll', spells: [names], extra, tab, auto, done }
  importLss,                                   // { campaignId? } — разобранный файл из loadLssFile
};
