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
import { indexCreation, newCreation, applyCreationChoice, creationModel, creationLiveModel, creationDoneModel, creationCharacter } from './creation.js';
import { isServerMode } from '../../core/store.js';

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
  if (real) return { ...toHeroView(real.ch, ctxOf(real.c, real.ch, userId)), id: heroKey(real.c.id, real.ch.id), live: true };
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
/** Повышение уровня. */
export const levelUpView = () => LEVEL_UP;
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
  location.hash = `#/hero/${heroKey(c.id, hero.characterId)}`;
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
  levelUp: stub('Повышение уровня'),           // { heroId, hp: 'average' | 'roll', spells: [names] }
  importLss: stub('Импорт из LSS'),            // { decisions: { [issue]: choice } }
};
