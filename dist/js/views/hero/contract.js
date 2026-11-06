// Шов между экранами героя и данными (#203). Экраны берут данные только отсюда и сообщают о действиях только сюда.
// Настоящие герои (#202, YGXVI / Claude): лист и «Мои герои» читают персонажей кампаний пользователя через adapter.js,
// действия листа меняют персонажа теми же путями, что лист за столом (updateCampaign → команды листа на сервере).
// Адреса образцов (lira, torin, корнеры) и шаги, ещё не подключённые к данным, работают на витрине fixture.js.
import { LIRA, TORIN, CORNERS, LEVEL_UP, CREATION, CREATION_LIVE } from './fixture.js';
import { toast } from '../../ui/kit.js';
import { campaignsFor, membership, updateCampaign, userById } from '../../core/campaign.js';
import { currentUserId } from '../../core/auth.js';
import { toHeroView, toHeroCard, spellIndex, legacySpells } from './adapter.js';
import { archiveLocalCharacter, restoreLocalCharacter } from '../table/sheet-lifecycle.js';
import { applyHeroAction } from './actions.js';
import { indexCreation, newCreation, applyCreationChoice, creationModel, creationLiveModel, creationDoneModel, creationCharacter, quickCreation, quickClass } from './creation.js';
import { isServerMode } from '../../core/store.js';
import { newLevelUp, levelUpModel, applyLevelUpChoice, levelUpRequest } from './levelup-model.js';
import { gearIndex } from './gear.js';
import { startEdit, finishEdit, applyEdit } from './edit-model.js';
import { LIB, isLibKey, libraryHeroes, archivedLibraryHeroes, libraryHero, saveLibraryHero, updateLibraryHero, archiveLibraryHero, restoreLibraryHero } from './library.js';

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
// Свой герой вне кампаний («Мои герои», library.js) — «lib~персонаж».
export const heroKey = (cid, chid) => `${cid}~${chid}`;
/** Настоящий герой по адресу: кампания и персонаж, видимые пользователю, или свой герой вне кампаний ({ c: null, lib }). */
export function findHero(key, userId = currentUserId()) {
  if (!key || !userId) return null;
  if (isLibKey(key)) { const ch = libraryHero(userId, String(key).split('~')[1]); return ch ? { c: null, ch, lib: true } : null; }
  const [cid, chid] = String(key).includes('~') ? String(key).split('~') : [null, key];
  for (const c of campaignsFor(userId)) {
    if (cid && c.id !== cid) continue;
    const ch = (c.characters || []).find((x) => x.id === chid);
    if (ch) return { c, ch };
  }
  return null;
}
const ctxOf = (c, ch, userId) => {
  if (!c) return { campaign: null, userId, spells, gear, ownerName: '', isMine: true };
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
    const key = heroKey(real.lib ? LIB : real.c.id, real.ch.id), can = canLevelUp(key);
    return { ...v, id: key, live: true, lib: !!real.lib, canLevelUp: can, canEdit: can, down: v.vitals.hp.max > 0 && v.vitals.hp.now === 0 };
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
  // Свои герои вне кампаний — первыми: их приводят в кампании копией (bringToCampaign).
  const mine = libraryHeroes(userId).map((h) => ({ ...toHeroCard(h, ctxOf(null, h, userId)), id: heroKey(LIB, h.id), lib: true })), party = [];
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
  // Удалённые свои герои (архив кампаний) — их можно вернуть.
  const archived = (userId ? campaignsFor(userId) : []).flatMap((c) => (c.archivedCharacters || []).filter((ch) => ch.ownerId === userId && (ch.profile || 'pc') === 'pc')
    .map((ch) => ({ id: heroKey(c.id, ch.id), name: ch.name, portrait: toHeroCard(ch, ctxOf(c, ch, userId)).portrait, campaign: c.name })));
  archived.unshift(...archivedLibraryHeroes(userId).map((h) => ({ id: heroKey(LIB, h.id), name: h.name, portrait: toHeroCard(h, ctxOf(null, h, userId)).portrait, campaign: 'Мои герои' })));
  // На сервере «Мои герои» пока хранятся на этом устройстве — до таблицы личных героев (#202).
  return { heroes: mine, party, archived, saved: savedFromRef(), sample: false, deviceOnly: isServerMode() };
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
function buildState() {
  if (!creationIx) return null;
  const userId = currentUserId();
  let st = readJSON(BUILD_KEY);
  // Герой собирается сам по себе (#203): кампания есть, только если мастер создания открыт из неё («Свой герой»).
  if (!st || st.v !== 1 || st.userId !== userId) st = { ...newCreation(creationIx, { campaign: null, userId: userId || 'guest' }), userId };
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

// ——— Быстрый герой (89–90, #203): три ответа → класс, раса, навыки (creation.js → quickCreation) ———
function quickBuild(st, answers) {
  // Кампания — только если быстрого героя открыли из неё; иначе герой ничей, правила по умолчанию.
  const c = st.campaignId ? campaignsFor(currentUserId()).find((x) => x.id === st.campaignId) || null : null;
  const next = { ...quickCreation(creationIx, { campaign: c, userId: currentUserId(), answers }), userId: currentUserId(), quick: answers };
  next.look.portrait = answers.portrait || `assets/hero/class-${quickClass(answers.role, answers.talk)}.webp`;
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
    chosen: [['Раса', race || '—', 'race'], ['Класс', cls || '—', 'class'], ['Навыки', creationModel(creationIx, st).backgroundSkills?.list?.filter((x) => x.on).map((x) => x.name).join(', ') || 'по классу', 'background'], ['Характеристики', 'стандартный набор под класс', 'abilities'], ['Снаряжение', 'первый вариант каждого набора', 'equipment'], ['Заклинания', 'подобраны по классу', 'spells']],
    why: [QUICK_LABEL.role[a.role], QUICK_LABEL.talk[a.talk], d.name].filter(Boolean),
    ok: d.status === 'valid', missing: d.missing,
  };
}
export const creationView = () => {
  const st = buildState();
  if (!st) return CREATION;
  const m = creationModel(creationIx, st, { campaignName: campaignName(st) });
  m.look = { ...m.look, portrait: defaultPortrait(st), portraits: PORTRAITS };
  m.campaignId = st.campaignId || null;
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
  const k = heroKey(real.lib ? LIB : real.c.id, real.ch.id);
  let st = readJSON(LU_KEY);
  // Черновик — для этого героя и этого уровня; иначе начинаем заново.
  if (!st || st.v !== 1 || st.key !== k) st = newLevelUp(creationIx, real.ch, { key: k, campaignId: real.c?.id ?? null });
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
  return !!real && (!!real.lib || real.ch.ownerId === userId || membership(real.c, userId)?.role === 'master');
}
/**
 * Свой портрет из файла: в песочнице — на устройстве (idb:), на сервере — в хранилище картинок токенов кампании (тот же
 * путь, что у своих токенов игрока, TASK-183). cid — кампания героя (у мастера создания — кампания черновика).
 */
export async function uploadPortrait(file, cid = readJSON(BUILD_KEY)?.campaignId) {
  try {
    if (isServerMode()) {
      if (!cid || cid === LIB) throw new Error('Свой файл сервер пока хранит только в кампании: выберите портрет из набора или загрузите свой, когда приведёте героя в кампанию.');
      return await (await import('../../server/sync.js')).uploadTokenImage(cid, file);
    }
    const { storeImage } = await import('../../core/assets.js'); return (await storeImage(file)).ref;
  } catch (e) { say('Портрет не загрузился', e.message, 'alert-circle'); return null; }
}
/** Можно ли менять героя key целиком (портрет, удаление, заклинания): владелец или мастер кампании. */
export const canEditHero = (key) => canLevelUp(key);
/** Портрет героя — он же картинка его токенов на всех сценах кампании. */
function setPortrait(p = {}) {
  const real = findHero(p.heroId);
  if (!real || !p.ref) return;
  if (!canEditHero(p.heroId)) { say('Портрет меняет владелец героя или мастер'); return; }
  if (real.lib) { updateLibraryHero(currentUserId(), real.ch.id, (ch) => { ch.portrait = p.ref; }); say('Портрет обновлён', 'Копии героя в кампаниях меняются в их листах.', 'tick-02'); return; }
  updateCampaign(real.c.id, (c) => {
    const ch = c.characters.find((x) => x.id === real.ch.id);
    if (ch) ch.portrait = p.ref;
    for (const s of c.scenes || []) for (const t of s.tokens || []) if (t.characterId === real.ch.id) t.img = p.ref;
  });
  say('Портрет обновлён', 'Токен на карте — тоже.', 'tick-02');
}
/** Удалить героя: лист уходит в архив кампании, токены и участие в бою снимаются; вернуть — restoreHero. */
async function deleteHero(p = {}) {
  const real = findHero(p.heroId);
  if (!real) return;
  if (!canEditHero(p.heroId)) { say('Удалить героя может владелец или мастер'); return; }
  if (real.lib) {
    archiveLibraryHero(currentUserId(), real.ch.id);
    toast({ title: `${real.ch.name} — в удалённых`, body: 'Копии в кампаниях остались. Вернуть героя можно со страницы «Герои».', icon: 'delete-02', action: { label: 'Вернуть', onClick: () => restoreHero({ heroId: p.heroId }) } });
    location.hash = '#/heroes';
    return;
  }
  const userId = currentUserId(), cid = real.c.id, chid = real.ch.id, name = real.ch.name;
  const master = membership(real.c, userId)?.role === 'master';
  try {
    if (isServerMode()) {
      const [sync, { makeSheetCommand }] = await Promise.all([import('../../server/sync.js'), import('../../server/character-sheet.js')]);
      const meta = sync.characterSheetMeta(cid, chid);
      if (!meta) throw new Error('Лист ещё загружается — попробуйте через секунду.');
      await sync.submitCharacterCommand(makeSheetCommand({ campaignId: cid, characterId: chid, version: meta.version, kind: 'archive' }));
    } else updateCampaign(cid, (c) => archiveLocalCharacter(c, chid));
    // Место за столом освобождается: игрок соберёт или выберет другого героя. На сервере освободить место может мастер.
    if (!isServerMode() || master) updateCampaign(cid, (c) => { for (const m of c.members || []) if (m.characterId === chid) m.characterId = null; });
  } catch (e) { say('Героя не удалось удалить', e?.message || 'Сервер не принял команду.', 'alert-circle'); return; }
  toast({ title: `${name} — в архиве`, body: isServerMode() && !master ? 'Лист в архиве кампании. Чтобы собрать нового героя, попросите мастера освободить место.' : 'Лист в архиве кампании — вернуть можно со страницы «Герои».', icon: 'delete-02', action: { label: 'Вернуть', onClick: () => restoreHero({ heroId: heroKey(cid, chid) }) } });
  location.hash = '#/heroes';
}
async function restoreHero(p = {}) {
  const [cid, chid] = String(p.heroId || '').split('~');
  if (cid === LIB) { const h = restoreLibraryHero(currentUserId(), chid); if (h) say(`${h.name} снова в «Моих героях»`, '', 'tick-02'); return; }
  const c = campaignsFor(currentUserId()).find((x) => x.id === cid);
  const ch = c?.archivedCharacters?.find((x) => x.id === chid);
  if (!ch) return;
  try {
    if (isServerMode()) {
      const [sync, { makeSheetCommand }] = await Promise.all([import('../../server/sync.js'), import('../../server/character-sheet.js')]);
      const meta = sync.characterSheetMeta(cid, chid);
      if (!meta) throw new Error('Лист ещё загружается — попробуйте через секунду.');
      await sync.submitCharacterCommand(makeSheetCommand({ campaignId: cid, characterId: chid, version: meta.version, kind: 'restore' }));
    } else updateCampaign(cid, (camp) => restoreLocalCharacter(camp, chid));
  } catch (e) { say('Героя не удалось вернуть', e?.message || 'Сервер не принял команду.', 'alert-circle'); return; }
  // Своё место за столом свободно — герой снова садится на него (токен встаёт на сцену).
  const userId = currentUserId(), m = membership(c, userId);
  if (ch.ownerId === userId && m?.role === 'player' && !m.characterId) { const { claim } = await import('../screens.js'); claim(cid, userId, chid); return; }
  say(`${ch.name} снова в «${c.name}»`, 'Токен на карту ставит мастер или вы — за столом.', 'tick-02');
}
// Классы dnd.su в справочнике заклинаний → русские названия (для фильтра «Добавить заклинание»).
const SPELL_CLASS = { 'dndsu:class:12': 'Бард', 'dndsu:class:13': 'Жрец', 'dndsu:class:22': 'Друид', 'dndsu:class:16': 'Паладин', 'dndsu:class:17': 'Следопыт', 'dndsu:class:19': 'Чародей', 'dndsu:class:20': 'Колдун', 'dndsu:class:21': 'Волшебник' };
let spellList = null;
/** Все заклинания справочника для «Добавить заклинание»: любому герою, без ограничения по классу (#203). */
export function spellCatalog() {
  if (spellList) return spellList;
  spellList = [...spells.byId.values()].map((e) => ({
    ref: e.id, name: e.name?.ru || e.name?.en || e.id, en: e.name?.en || '', level: e.level ?? 0, school: spells.schools[e.school] || '',
    classes: [...new Set([...(e.classes?.base || []), ...(e.classes?.tceOptional || [])].map((k) => SPELL_CLASS[k]).filter(Boolean))],
    time: spells.ref[e.id]?.[0] || '', range: spells.ref[e.id]?.[1] || '', conc: !!e.concentration, ritual: !!e.ritual,
  })).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'ru'));
  return spellList;
}
export const SPELL_CLASSES = Object.values(SPELL_CLASS);
/** Снаряжение SRD для «Добавить предмет»: [{ ref, name, kind, weight }] (пусто — справочник не загрузился). */
export const gearCatalog = () => (gear ? [...gear.byId.values()].map((g) => ({ ref: g.id, name: g.ru, kind: g.kind, weight: g.weight })) : []);
// ——— Перенос из Long Story Short (72, #203): разбор файла — lss.js, разобранный лист живёт в вкладке до переноса ———
const LSS_KEY = 'rasputye-hero-lss-v1', LSS_ERR = 'rasputye-hero-lss-err';
/** Разобранный файл LSS или null — тогда экран просит файл (lssError — почему не подошёл прошлый). */
export const lssImportView = () => readJSON(LSS_KEY);
export const lssError = () => readJSON(LSS_ERR);
export async function loadLssFile(file) {
  try {
    const { parseLss } = await import('./lss.js');
    const parsed = parseLss(await file.text(), { fileName: `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} КБ`, spellNames: spells.byName, gear });
    sessionStorage.setItem(LSS_KEY, JSON.stringify(parsed));
    sessionStorage.removeItem(LSS_ERR);
  } catch (e) {
    try { sessionStorage.setItem(LSS_ERR, JSON.stringify({ file: file?.name || '', text: e.message })); } catch { /* приватный режим */ }
    say('Файл не подошёл', e.message, 'alert-circle');
  }
  window.dispatchEvent(new CustomEvent('hero:changed'));
}
export const dropLss = () => { try { sessionStorage.removeItem(LSS_KEY); sessionStorage.removeItem(LSS_ERR); } catch { /* приватный режим */ } window.dispatchEvent(new CustomEvent('hero:changed')); };

/**
 * Положить готового героя (данные листа) в кампанию: песочница — сразу, сервер — createCharacterSheet. Если у игрока
 * в этой кампании ещё нет героя — он садится за стол этим героем, иначе открывается лист.
 */
async function placeHero(c, data, { title }) {
  const userId = currentUserId();
  const id = (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `ch-${Date.now().toString(36)}`);
  const hero = structuredClone(data);
  const m = membership(c, userId);
  const seat = m?.role === 'player' && !m.characterId;
  let unchecked = false;
  try {
    if (isServerMode()) {
      const sync = await import('../../server/sync.js');
      // Герой из конструктора — командой создания с проверкой сборки (P4b). Правленый вручную команду может не пройти:
      // тогда он приходит обычным листом, с пометкой «сборка не проверена сервером».
      if (hero.creation) {
        const { id: _id, ownerId: _owner, version: _v, managed: _m, controllers: _c, archivedAt: _a, ...body } = hero;
        try { unchecked = !(await sync.createHeroSheet(c.id, { characterId: id, operationId: crypto.randomUUID(), data: body })).verified; }
        catch (e) { if (e?.kind !== 'validation') throw e; unchecked = true; await sync.createCharacterSheet(c.id, { ...hero, id, ownerId: userId }); }
      } else await sync.createCharacterSheet(c.id, { ...hero, id, ownerId: userId });
    } else updateCampaign(c.id, (camp) => { camp.characters.push({ ...hero, id, ownerId: userId }); });
  } catch (e) { say(`${title} не удалось`, e?.message || 'Сервер не принял героя.', 'alert-circle'); return null; }
  say(`${hero.name} — в «${c.name}»`, `${seat ? 'Садитесь за стол.' : 'Лист открыт.'}${unchecked ? ' Сборка не проверена сервером — мастер это увидит.' : ''}`, 'tick-02');
  // Игрок без героя садится им за стол: место в кампании, токен на сцене, стол (claim; на сервере — claim_character).
  if (seat) { const { claim } = await import('../screens.js'); claim(c.id, userId, id); } else location.hash = `#/hero/${heroKey(c.id, id)}`;
  return id;
}
/** Перенос из LSS: герой ложится в «Мои герои», дальше — «Куда привести» (кампания из ?c= — первой). */
function importLss(p = {}) {
  const v = lssImportView();
  const userId = currentUserId();
  if (!v || !userId) return;
  const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `ch-${Date.now().toString(36)}`;
  saveLibraryHero(userId, { ...v.hero, id });
  try { sessionStorage.removeItem(LSS_KEY); } catch { /* приватный режим */ }
  say(`${v.hero.name} — в «Моих героях»`, 'Осталось выбрать кампанию.', 'tick-02');
  location.hash = `#/hero/${heroKey(LIB, id)}/bring${p.campaignId ? `?c=${encodeURIComponent(p.campaignId)}` : ''}`;
}
/** Привести героя в кампанию — копией листа (у каждой кампании свой экземпляр); свой герой остаётся в «Моих героях». */
async function bringToCampaign(p = {}) {
  const real = findHero(p.heroId);
  const c = campaignsFor(currentUserId()).find((x) => x.id === p.campaignId);
  if (!real || !c) { say('Не нашёл героя или кампанию'); return; }
  const { id, ownerId, updatedAt, archivedAt, ...data } = structuredClone(real.ch);
  await placeHero(c, data, { title: 'Перенос героя' });
}
/**
 * Кампании, куда можно привести героя key (кроме той, где он уже лежит): free — игрок там без героя и сядет за стол,
 * master — пользователь ведёт её, dup — там уже есть его герой с тем же именем.
 */
export const bringTargets = (key) => {
  const real = findHero(key), userId = currentUserId(), name = String(real?.ch?.name || '').trim().toLowerCase();
  return campaignsFor(userId).filter((c) => c.id !== real?.c?.id && membership(c, userId)?.status === 'active').map((c) => {
    const m = membership(c, userId);
    return { id: c.id, name: c.name, free: m.role === 'player' && !m.characterId, master: m.role === 'master', dup: !!name && (c.characters || []).some((x) => x.ownerId === userId && String(x.name).trim().toLowerCase() === name) };
  });
};

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
  // Заклинания старого листа (строкой) — списком со ссылками на справочник: первая правка переносит их в knownSpells.
  if (['addSpell', 'removeSpell'].includes(name) && !(real.ch.knownSpells || []).length) payload = { ...payload, legacy: legacySpells(real.ch.spells, spells).map((s) => ({ name: s.name, circle: s.circle, ref: s.ref })) };
  let note = null;
  // Свой герой вне кампаний меняется в «Моих героях»; его черты характера хранятся и в серверном режиме (на устройстве).
  if (real.lib) note = updateLibraryHero(currentUserId(), chid, (ch) => applyHeroAction(ch, name, payload, { random: Math.random }));
  else updateCampaign(real.c.id, (c) => {
    const ch = c.characters.find((x) => x.id === chid);
    if (ch) note = applyHeroAction(ch, name, payload, { random: Math.random });
  });
  // Трату ячейки или заряда можно вернуть из подсказки — на телефоне её легко нажать случайно.
  if (note?.undo) toast({ title: note.title, body: note.body || '', icon: note.icon, action: { label: 'Вернуть', onClick: () => live('refund')({ heroId: payload.heroId, id: note.undo.id }) } });
  else if (note) say(note.title, note.body || '', note.icon);
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
    // Имя сохраняется при выходе из поля: перерисовка в этот момент съела бы клик по кнопке «Собрать героя».
    if (payload.id !== 'name') window.dispatchEvent(new CustomEvent('hero:changed'));
    return;
  }
  if (payload.step === 'look' && payload.id === 'portrait') { st.look.portrait = String(payload.value || ''); saveBuild(st); window.dispatchEvent(new CustomEvent('hero:changed')); return; }
  const note = applyCreationChoice(creationIx, st, payload);
  saveBuild(st);
  if (note) say(note.title, note.body || '', note.icon);
  window.dispatchEvent(new CustomEvent('hero:changed'));
}
let finishing = false;
/**
 * «Создать героя» (мастер и быстрый герой): герой ложится в «Мои герои», дальше — экран «Куда привести»
 * (#203: герой создаётся отдельно от кампаний). Кампания, из которой открыли мастер, там предложена первой.
 */
async function finish() {
  const st = buildState();
  if (!st) return stub('Готово')();
  const userId = currentUserId();
  if (!userId) { say('Войдите, чтобы сохранить героя'); return; }
  let hero;
  try { hero = creationCharacter(creationIx, st, { userId }); } catch (e) {
    say('Герой ещё не готов', (e.missing || []).slice(0, 3).map((m) => m.message).join(' ') || e.message, 'alert-circle');
    return;
  }
  hero.data.portrait = defaultPortrait(st); // портрет — он же токен на карте
  if (finishing) return;
  finishing = true;
  saveLibraryHero(userId, { ...hero.data, id: hero.characterId });
  finishing = false;
  try { sessionStorage.removeItem(BUILD_KEY); sessionStorage.removeItem(UI_KEY); } catch { /* приватный режим */ }
  say(`${hero.data.name} — в «Моих героях»`, 'Осталось выбрать кампанию.', 'tick-02');
  location.hash = `#/hero/${heroKey(LIB, hero.characterId)}/bring${st.campaignId ? `?c=${encodeURIComponent(st.campaignId)}` : ''}`;
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
  const grow = (ch) => {
    Object.assign(ch, structuredClone(req.payload.patch));
    if (req.payload.creation) ch.creation = structuredClone(req.payload.creation);
    if (Number.isFinite(req.gain)) { ch.hpMax = (ch.hpMax || 0) + req.gain; ch.hp = (ch.hp || 0) + req.gain; }
  };
  try {
    if (real.lib) updateLibraryHero(currentUserId(), real.ch.id, grow);
    else if (isServerMode()) {
      const sync = await import('../../server/sync.js');
      await sync.levelUpHeroSheet(real.c.id, real.ch.id, req);
    } else {
      updateCampaign(real.c.id, (camp) => {
        const ch = camp.characters.find((x) => x.id === real.ch.id);
        if (ch) grow(ch);
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

// ——— Правка героя (#203, edit.js) ———
/** Всё для экрана правки: лист, копия данных, можно ли править, где хранится (lib — «Мои герои», server — сервер). */
export function editState(key) {
  const real = findHero(key), v = heroView(key);
  if (!real || !v) return null;
  return { v, data: startEdit(real.ch).draft, canEdit: !!v.canEdit, lib: !!real.lib, server: !real.lib && isServerMode(), campaign: real.c ? { id: real.c.id, name: real.c.name } : null };
}
/** Лист по черновику правки — живой просмотр (те же числа, что покажет лист после «Сохранить»). */
export function editPreview(key, draft) {
  const real = findHero(key);
  if (!real) return null;
  return toHeroView({ ...draft, id: real.ch.id, ownerId: real.ch.ownerId }, ctxOf(real.c, real.ch, currentUserId()));
}
export const heroGear = () => gear;
/** «Сохранить» правку: только изменённые поля листа; на сервере — командой edit, как правки листа за столом. */
function saveEdit(p = {}) {
  const real = findHero(p.heroId);
  if (!real || !canLevelUp(p.heroId)) { say('Править нельзя', 'Героя нет или он не ваш.', 'alert-circle'); return false; }
  const server = !real.lib && isServerMode();
  const res = finishEdit(p.base || {}, p.draft || {}, { server });
  if (res.error) { say('Не сохранено', res.error, 'alert-circle'); return false; }
  if (!res.changed.length && !res.dropped.length) { say('Без изменений', 'Лист остался как был.', 'tick-02'); return true; }
  const chid = real.ch.id;
  if (real.lib) updateLibraryHero(currentUserId(), chid, (ch) => { applyEdit(ch, res.patch); });
  else if (res.changed.length) updateCampaign(real.c.id, (c) => { const ch = c.characters.find((x) => x.id === chid); if (ch) applyEdit(ch, res.patch); });
  say(`${res.patch.name || real.ch.name}: сохранено`, res.dropped.length ? `Сервер не хранит: ${res.dropped.join(', ')}.` : '', res.dropped.length ? 'information-circle' : 'tick-02');
  return true;
}

export const heroActions = {
  createFrom: (p = {}) => (p.path === 'steps' && creationIx ? undefined : stub('Новый герой')(p)), // { path: 'steps' | 'quick' | 'lss' }
  choose,                                      // { step, id, value }
  finish,                                      // { draftId }
  bringToCampaign,                             // { heroId, campaignId }
  setHp: live('setHp'),                        // { heroId, delta, temp }
  roll: live('roll'),                          // { heroId, what, formula }
  useResource: live('useResource'),            // { heroId, id }
  refund: live('refund'),                      // { heroId, id } — вернуть одну трату (кнопка в подсказке)
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
  addSpell: live('addSpell'),                  // { heroId, name, circle, ref?, ritual?, description? } — любому герою
  removeSpell: live('removeSpell'),            // { heroId, spellId, name }
  spellAbility: live('spellAbility'),          // { heroId, ability: 'int'|'wis'|'cha', sourceId? }
  setPortrait,                                 // { heroId, ref } — портрет и картинка токенов
  deleteHero,                                  // { heroId } — в архив кампании (вернуть — restoreHero)
  restoreHero,                                 // { heroId }
  saveEdit,                                    // { heroId, base, draft } — правка героя (edit.js); true — сохранено
};
