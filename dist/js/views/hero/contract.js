// Шов между экранами героя и данными (#203). Экраны берут данные только отсюда и сообщают о действиях только сюда.
// Сейчас — витринные образцы из fixture.js. Подключение (агенты YGXVI): заменить тела функций ниже, сохранив форму
// объектов из docs/hero-view.md, и сделать настоящими обработчики в heroActions. Экраны трогать не нужно.
import { LIRA, TORIN, HERO_LIST, SAVED_FROM_REFERENCE, CORNERS, LSS_IMPORT, LEVEL_UP, CREATION, CREATION_LIVE } from './fixture.js';
import { toast } from '../../ui/kit.js';

const HEROES = { lira: LIRA, torin: TORIN };

/** Лист героя. corner — образец из CORNERS: down, concentration, noSlots, multiclass, unfinished. */
export function heroView(id, corner = '') {
  const base = HEROES[id] || LIRA;
  return corner && CORNERS[corner] ? { ...base, ...CORNERS[corner], corner } : base;
}
/** «Мои герои»: карточки и сохранённое из справочника. */
/** Отложенное из справочника (#/ref, «В книгу героя») — на этом устройстве; пусто — образец. */
function savedFromRef() {
  try { const p = JSON.parse(localStorage.getItem('rasputye-ref-v1') || '{}'); return (p.saved || []).map((k) => p.names?.[k]).filter(Boolean); } catch { return []; }
}
export const heroList = () => { const real = savedFromRef(); return { heroes: HERO_LIST, saved: real.length ? real : SAVED_FROM_REFERENCE }; };
/** Мастер создания: шаги, варианты, правила кампании, быстрый герой. */
export const creationView = () => CREATION;
/** Живой лист справа на шаге stepId. */
export const creationLive = (stepId) => CREATION_LIVE[stepId] || CREATION_LIVE.race;
/** Повышение уровня. */
export const levelUpView = () => LEVEL_UP;
/** Разбор файла Long Story Short. */
export const lssImportView = () => LSS_IMPORT;

const stub = (name) => (payload) => {
  console.info('[hero]', name, payload ?? '');
  toast({ title: 'Пока на образце', body: `«${name}» подключат к данным позже.`, icon: 'information-circle', timeout: 2400 });
};

/**
 * Действия экранов. Каждое получает простой объект и ничего не возвращает: экраны обновятся по данным.
 * Подключение заменяет заглушки; список имён и полей — в docs/hero-view.md.
 */
export const heroActions = {
  createFrom: stub('Новый герой'),            // { path: 'steps' | 'quick' | 'lss' }
  choose: stub('Выбор в мастере'),             // { step, id, value }
  finish: stub('Готово'),                      // { draftId }
  bringToCampaign: stub('Привести в кампанию'),// { heroId, campaignId }
  setHp: stub('Хиты'),                         // { heroId, delta, temp }
  roll: stub('Бросок'),                        // { heroId, what, formula }
  useResource: stub('Ячейка или умение'),      // { heroId, id, left }
  toggleCondition: stub('Состояние'),          // { heroId, id }
  dropConcentration: stub('Снять концентрацию'),// { heroId }
  rest: stub('Отдых'),                         // { heroId, kind: 'short' | 'long', hitDice, recover: [levels] }
  deathSave: stub('Спасбросок от смерти'),     // { heroId }
  prepare: stub('Подготовка заклинания'),      // { heroId, spellId, prepared }
  cast: stub('Сотворить'),                     // { heroId, spellId, slot }
  editField: stub('Правка листа'),             // { heroId, field, value }
  addItem: stub('Предмет'),                    // { heroId }
  levelUp: stub('Повышение уровня'),           // { heroId, hp: 'average' | 'roll', spells: [names] }
  importLss: stub('Импорт из LSS'),            // { decisions: { [issue]: choice } }
};
