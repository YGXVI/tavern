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

const HEROES = { lira: LIRA, torin: TORIN };

// Справочники заклинаний для листа: время, дистанция, школа. Без них лист показывает то, что записано у героя.
let spells = spellIndex();
const json = (p) => fetch(new URL(p, import.meta.url)).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))));
await Promise.all([json('../../data/spells-2014.json'), json('../../data/spells-ref-2014.json')])
  .then(([list, ref]) => { spells = spellIndex({ spells: list, ref }); })
  .catch(() => { /* без справочника — подписи с листа */ });

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
/** Мастер создания: шаги, варианты, правила кампании, быстрый герой. */
export const creationView = () => CREATION;
/** Живой лист справа на шаге stepId. */
export const creationLive = (stepId) => CREATION_LIVE[stepId] || CREATION_LIVE.race;
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
export const heroActions = {
  createFrom: stub('Новый герой'),            // { path: 'steps' | 'quick' | 'lss' }
  choose: stub('Выбор в мастере'),             // { step, id, value }
  finish: stub('Готово'),                      // { draftId }
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
