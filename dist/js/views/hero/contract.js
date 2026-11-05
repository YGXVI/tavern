// Шов между экранами героя и данными (#203). Экраны берут данные только отсюда и сообщают о действиях только сюда.
// Настоящие герои (#202, YGXVI / Claude): лист и «Мои герои» читают персонажей кампаний пользователя через adapter.js,
// действия листа меняют персонажа теми же путями, что лист за столом (updateCampaign → команды листа на сервере).
// Адреса образцов (lira, torin, корнеры) и шаги, ещё не подключённые к данным, работают на витрине fixture.js.
import { LIRA, TORIN, CORNERS, LSS_IMPORT, LEVEL_UP, CREATION, CREATION_LIVE } from './fixture.js';
import { toast } from '../../ui/kit.js';
import { campaignsFor, membership, updateCampaign, userById } from '../../core/campaign.js';
import { currentUserId } from '../../core/auth.js';
import { toHeroView, toHeroCard, spellIndex } from './adapter.js';
import { applyHeroAction } from './actions.js';
import { indexCreation, newCreation, applyCreationChoice, creationModel, creationLiveModel, creationDoneModel, creationCharacter } from './creation.js';
import { isServerMode } from '../../core/store.js';
import { newLevelUp, levelUpModel, applyLevelUpChoice, levelUpRequest } from './levelup-model.js';
import { GEAR_RU, EQ_RU } from '../ref/world-text.js';

const HEROES = { lira: LIRA, torin: TORIN };

// Справочники заклинаний для листа: время, дистанция, школа. Без них лист показывает то, что записано у героя.
let spells = spellIndex();
const json = (p) => fetch(new URL(p, import.meta.url)).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))));
// Справочники конструктора для мастера создания (character-options, снаряжение, умения). Без них — витрина.
let creationIx = null;
// Снаряжение SRD по русскому названию: вес и вид для сумки старых листов (#203, ревью листа).
let gear = new Map();
await Promise.all(['spells-2014', 'spells-ref-2014', 'character-options-2014', 'equipment-2014', 'features-2014', 'spells-srd-2014'].map((n) => json(`../../data/${n}.json`)))
  .then(([list, ref, options, equipment, features, srd]) => {
    spells = spellIndex({ spells: list, ref, srd });
    gear = new Map(equipment.entries.map((e) => [(EQ_RU[e.name.en] || GEAR_RU[e.name.en] || e.name.ru || e.name.en || '').toLowerCase(), { kind: e.kind, weight: e.weight?.lb, en: e.name.en }]));
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
export const creationView = () => { const st = buildState(); return st ? creationModel(creationIx, st, { campaignName: campaignName(st) }) : CREATION; };
/** Живой лист справа на шаге stepId. */
export const creationLive = (stepId) => { const st = buildState(); return st ? creationLiveModel(creationIx, st) : CREATION_LIVE[stepId] || CREATION_LIVE.race; };
/** Итог «Герой готов»: null — витрина. */
export const creationDone = () => { const st = buildState(); return st ? { ...creationDoneModel(creationIx, st), campaign: campaignName(st) } : null; };
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
/** Разбор файла Long Story Short. */
export const lssImportView = () => LSS_IMPORT;

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
  if (!st || payload.step === 'quick') return stub('Выбор в мастере')(payload);
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
  bringToCampaign: stub('Привести в кампанию'),// { heroId, campaignId }
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
  addItem: stub('Предмет'),                    // { heroId }
  levelUp,                                     // { heroId, hp: 'average' | 'roll', spells: [names], extra, tab, auto, done }
  importLss: stub('Импорт из LSS'),            // { decisions: { [issue]: choice } }
};
