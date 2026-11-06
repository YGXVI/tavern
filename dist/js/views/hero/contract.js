// Шов между экранами героя и данными (#203). Экраны берут данные только отсюда и сообщают о действиях только сюда.
// Настоящие герои (#202, YGXVI / Claude): лист и «Мои герои» читают персонажей кампаний пользователя через adapter.js,
// действия листа меняют персонажа теми же путями, что лист за столом (updateCampaign → команды листа на сервере).
// Адреса образцов (lira, torin, корнеры) и шаги, ещё не подключённые к данным, работают на витрине fixture.js.
import { LIRA, TORIN, HERO_LIST, SAVED_FROM_REFERENCE, CORNERS, LSS_IMPORT, LEVEL_UP, CREATION, CREATION_LIVE } from './fixture.js';
import { toast } from '../../ui/kit.js';
import { campaignsFor, membership, updateCampaign, userById } from '../../core/campaign.js';
import { currentUserId } from '../../core/auth.js';
import { toHeroView, toHeroCard, spellIndex } from './adapter.js';
import { applyHeroAction } from './actions.js';
import { indexCreation, newCreation, applyCreationChoice, creationModel, creationLiveModel, creationDoneModel, creationCharacter, quickCreation, quickResultModel } from './creation.js';
import { parseLss } from './lss.js';
import { isServerMode } from '../../core/store.js';
import { newLevelUp, levelUpModel, applyLevelUpChoice, levelUpRequest } from './levelup-model.js';

const HEROES = { lira: LIRA, torin: TORIN };

// Справочники заклинаний для листа: время, дистанция, школа. Без них лист показывает то, что записано у героя.
let spells = spellIndex();
const json = (p) => fetch(new URL(p, import.meta.url)).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))));
// Справочники конструктора для мастера создания (character-options, снаряжение, умения). Без них — витрина.
let creationIx = null;
await Promise.all(['spells-2014', 'spells-ref-2014', 'character-options-2014', 'equipment-2014', 'features-2014'].map((n) => json(`../../data/${n}.json`)))
  .then(([list, ref, options, equipment, features]) => {
    spells = spellIndex({ spells: list, ref });
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
    campaign: { id: c.id, name: c.name, live: false }, userId, spells,
    ownerName: userById(ch.ownerId)?.name || '', isMine: ch.ownerId === userId || (m?.role === 'player' && m.characterId === ch.id),
  };
};

/** Лист героя. corner — образец из CORNERS (только для образцов): down, concentration, noSlots, multiclass, unfinished. */
export function heroView(id, corner = '') {
  const userId = currentUserId();
  const real = findHero(id, userId);
  if (real) return { ...toHeroView(real.ch, ctxOf(real.c, real.ch, userId)), id: heroKey(real.c.id, real.ch.id), live: true, canLevelUp: canLevelUp(heroKey(real.c.id, real.ch.id)) };
  const base = HEROES[id] || LIRA;
  return corner && CORNERS[corner] ? { ...base, ...CORNERS[corner], corner } : base;
}

/** Отложенное из справочника (#/ref, «В книгу героя») — на этом устройстве; пусто — образец. */
function savedFromRef() {
  try { const p = JSON.parse(localStorage.getItem('rasputye-ref-v1') || '{}'); return (p.saved || []).map((k) => p.names?.[k]).filter(Boolean); } catch { return []; }
}
/** «Мои герои»: свои герои во всех кампаниях; пока своих нет — образцы. */
export function heroList() {
  const userId = currentUserId();
  const mine = [];
  for (const c of userId ? campaignsFor(userId) : []) {
    const m = membership(c, userId);
    for (const ch of c.characters || []) {
      if ((ch.profile || 'pc') !== 'pc') continue;
      if (ch.ownerId === userId || (m?.role === 'player' && m.characterId === ch.id)) mine.push({ ...toHeroCard(ch, ctxOf(c, ch, userId)), id: heroKey(c.id, ch.id) });
    }
  }
  const real = savedFromRef();
  return { heroes: mine.length ? mine : HERO_LIST, saved: real.length ? real : SAVED_FROM_REFERENCE, sample: !mine.length };
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
  // Имя — из окна (шаг «Образ» и быстрый герой пишут его только в свой черновик).
  const ui = readJSON(UI_KEY) || {};
  if (st.quick && typeof ui.quick?.name === 'string' && ui.quick.name !== st.draft.identity.name) applyCreationChoice(creationIx, st, { step: 'look', id: 'name', value: ui.quick.name });
  else if (!st.quick && typeof ui.name === 'string' && ui.name !== st.draft.identity.name) applyCreationChoice(creationIx, st, { step: 'look', id: 'name', value: ui.name });
  for (const k of ['pronoun', 'alignment', 'traits', 'ideals', 'bonds', 'flaws']) if (ui[k] !== undefined) st.look[k] = ui[k];
  return st;
}
const saveBuild = (st) => { try { sessionStorage.setItem(BUILD_KEY, JSON.stringify(st)); } catch { /* приватный режим */ } };
const campaignName = (st) => (st?.campaignId ? campaignsFor(currentUserId()).find((c) => c.id === st.campaignId)?.name : '') || '';

/** Мастер создания: шаги, варианты, правила кампании, быстрый герой. */
export const creationView = () => {
  const st = buildState();
  if (!st) return CREATION;
  const cv = creationModel(creationIx, st, { campaignName: campaignName(st) });
  // Быстрый герой: итог — по сборке из ответов (если её ещё нет — по ответам по умолчанию).
  const q = st.quick ? st : quickState();
  return { ...cv, quick: { ...CREATION.quick, live: true, campaign: campaignName(q), result: quickResultModel(creationIx, q) } };
};
function quickState() {
  const ui = readJSON(UI_KEY) || {}, a = { ...CREATION.quick.picked, ...(ui.quick || {}) };
  const userId = currentUserId();
  return quickCreation(creationIx, { campaign: targetCampaign(userId), userId: userId || 'guest', role: a.role, talk: a.talk, name: a.name });
}
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
// ——— Перенос из Long Story Short (lss.js): файл — в sessionStorage до принятия ———
const LSS_KEY = 'rasputye-hero-lss-v1';
/** Разбор загруженного файла; файла ещё нет — { needFile: true } (витрина — без справочников). */
export const lssImportView = () => {
  if (!creationIx) return LSS_IMPORT;
  const f = readJSON(LSS_KEY);
  if (!f) return { live: true, needFile: true, campaign: campaignName({ campaignId: targetCampaign(currentUserId())?.id }) };
  const r = parseLss(f.text, f);
  return r.error ? { live: true, needFile: true, error: r.error } : { ...r.view, campaign: campaignName({ campaignId: targetCampaign(currentUserId())?.id }) };
};
async function importLss(p = {}) {
  if (!creationIx) return stub('Импорт из LSS')(p);
  if (p.file) {
    try { sessionStorage.setItem(LSS_KEY, JSON.stringify({ text: p.file.text, fileName: p.file.name, size: p.file.size })); } catch { say('Файл слишком большой для вкладки'); return; }
    window.dispatchEvent(new CustomEvent('hero:changed'));
    return;
  }
  if (p.reset) { sessionStorage.removeItem(LSS_KEY); window.dispatchEvent(new CustomEvent('hero:changed')); return; }
  if (!p.accept && !p.later) return; // решения по расхождениям — пометки на экране
  const f = readJSON(LSS_KEY);
  const r = f && parseLss(f.text, f);
  if (!r || r.error) { say('Нет файла', r?.error || 'Загрузите .json из Long Story Short.'); return; }
  const userId = currentUserId();
  const c = targetCampaign(userId);
  if (!c) { say('Нет кампании', 'Войдите в кампанию по приглашению мастера — герой появится в ней.'); return; }
  const m = membership(c, userId);
  const claim = m?.role === 'player' && !m.characterId;
  const id = f.characterId || `ch-${crypto.randomUUID().slice(0, 12)}`;
  f.characterId = id; sessionStorage.setItem(LSS_KEY, JSON.stringify(f)); // повтор не создаст второго героя
  const hero = { ...r.hero, id, ownerId: isServerMode() ? userId : r.hero.ownerId ?? userId };
  try {
    updateCampaign(c.id, (camp) => {
      if (camp.characters.some((x) => x.id === id)) return;
      camp.characters.push(hero);
      const me = camp.members.find((x) => x.userId === userId);
      if (claim && me && !isServerMode()) me.characterId = id;
    });
    if (isServerMode()) {
      const sync = await import('../../server/sync.js');
      await sync.whenSynced(c.id);
      if (claim) await sync.rpc('claim_character', { p_campaign: c.id, p_character: id });
      await sync.loadCampaign(c.id, { silent: true });
    }
  } catch (e) { say('Герой не перенесён', e?.message || 'Сервер не принял лист.', 'alert-circle'); return; }
  sessionStorage.removeItem(LSS_KEY);
  say(`${hero.name} перенесён`, `Герой в кампании «${c.name}».`, 'tick-02');
  location.hash = `#/hero/${heroKey(c.id, id)}`;
}

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
  if (payload.step === 'quick') {
    // Ответ быстрого мастера — пересобрать героя; дорабатывать можно пошагово (то же состояние).
    const ui = readJSON(UI_KEY) || {};
    const a = { ...CREATION.quick.picked, ...(ui.quick || {}), [payload.id]: payload.value };
    const userId = currentUserId();
    const q = { ...quickCreation(creationIx, { campaign: targetCampaign(userId, st.campaignId), userId: userId || 'guest', role: a.role, talk: a.talk, name: a.name }), userId };
    saveBuild(q);
    window.dispatchEvent(new CustomEvent('hero:changed'));
    return;
  }
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
  bringToCampaign: (p = {}) => { // { heroId, campaignId }
    if (!creationIx) return stub('Привести в кампанию')(p);
    // Быстрый герой по ответам по умолчанию ещё не сохранён — сохранить его, а не черновик пошагового мастера.
    if (!buildState()?.quick) saveBuild({ ...quickState(), userId: currentUserId() });
    return finish();
  },
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
  importLss,                                   // { file? , decisions, later?, accept?, reset? }
};
