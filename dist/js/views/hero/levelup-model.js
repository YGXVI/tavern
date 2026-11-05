// Окно повышения уровня на настоящих правилах (#202): экраны sol0139 (views/hero/levelup.js) получают план
// rules/level-up.js (levelUpPlan), выборы окна — изменения черновика плана, запись — levelUpPayload → level_up_character.
// Чистые функции: состояние (класс и черновик плана) хранит вызывающий; справочники — indexCreation (creation.js).
import { evaluateBuild, proposeBuildChange, confirmBuildChange } from '../../rules/character-builder.js';
import { levelUpPlan, levelUpPayload } from '../../rules/level-up.js';
import { ABILITIES, SKILLS, mod } from '../../data/rules.js';
import { PORTS } from './creation.js';
import { LEVEL_UP } from './fixture.js';

const MINUS = '−';
const signed = (n) => (Number.isFinite(n) ? (n < 0 ? `${MINUS}${Math.abs(n)}` : `+${n}`) : '—');
const tail = (id) => String(id || '').split(':').pop();
const nameOf = (ix, id) => ix.defs.get(id)?.name?.ru || ix.features.get(id)?.name?.ru || ix.features.get(id)?.name?.en || ix.spells.get(id)?.name?.ru || ix.spells.get(id)?.name?.en || tail(id);
const spellName = (ix, id) => ix.spells.get(id)?.name?.ru || ix.spells.get(id)?.name?.en || id;
const EXTRA_RU = { subclass: 'Подкласс', feature_option: 'Особенность', asi_or_feat: 'Улучшение характеристик', tool: 'Инструменты', expertise: 'Экспертиза', favored_enemy: 'Излюбленный враг', terrain: 'Излюбленная местность', skill: 'Навыки' };

/** Класс, который поднимаем: первый класс героя (мультикласс — решение мастера, в окне пока не предлагается). */
export function heroClassRef(hero) {
  const c = Array.isArray(hero?.classes) && hero.classes[0];
  return c?.ref || (hero?.classId ? `srd51:class:${hero.classId}` : null);
}

export function newLevelUp(ix, hero, { key, campaignId }) {
  const classId = heroClassRef(hero);
  const plan = classId ? levelUpPlan(hero, classId, ix.cats) : { supported: false, reason: 'На листе не указан класс.' };
  return { v: 1, key, campaignId, characterId: hero?.id, classId, fromLevel: plan.fromLevel ?? null, nextDraft: plan.nextDraft ?? null, tab: 0, focus: null, operationId: null };
}

/** План с черновиком окна (выборы игрока поверх плана). */
function planOf(ix, st, hero) {
  const plan = st.classId ? levelUpPlan(hero, st.classId, ix.cats) : { supported: false, reason: 'На листе не указан класс.' };
  if (plan.supported && plan.mode !== 'simple' && st.nextDraft) plan.nextDraft = st.nextDraft;
  return plan;
}
const evaluate = (ix, plan) => evaluateBuild(plan.context, ix.cats, plan.nextDraft, PORTS);
function change(ix, st, plan, ch) {
  st.nextDraft = confirmBuildChange(proposeBuildChange(plan.nextDraft, ch, plan.context, ix.cats, PORTS));
  plan.nextDraft = st.nextDraft;
  st.operationId = null; st.payload = null; // запрос изменился — новый запрос и ID операции
}
const spellChoices = (ev, plan) => ev.choices.filter((c) => c.kind === 'spell' && (plan.choices.some((p) => p.id === c.id) || c.origin?.characterLevel === plan.toLevel));
const extraChoices = (ev, plan) => ev.choices.filter((c) => EXTRA_RU[c.kind] && plan.choices.some((p) => p.id === c.id));
function optionsOf(c, ev) {
  if (c.options?.length) return c.options;
  const book = ev.choices.find((x) => x.kind === 'spell' && /spellbook/.test(x.id));
  return /prepared/.test(c.id) && Array.isArray(book?.selected) ? book.selected : [];
}
const choiceLabel = (c) => (/cantrips/.test(c.id) ? 'Заговоры' : /spellbook/.test(c.id) ? 'В книге' : /prepared/.test(c.id) ? 'Готово к бою' : /known/.test(c.id) ? 'Известные' : 'Заклинания');
const asiValue = (v) => (Array.isArray(v) ? null : v?.type === 'asi' ? Object.entries(v.increases || {}).map(([k, n]) => `+${n} ${ABILITIES.find((a) => a.id === k)?.short}`).join(', ') : null);

/** Выбор окна повышения. Возвращает подсказку или null. */
export function applyLevelUpChoice(ix, st, hero, p = {}) {
  const plan = planOf(ix, st, hero);
  if (!plan.supported || plan.mode === 'simple') return null;
  const ev = evaluate(ix, plan);
  const toggle = (c, opt) => {
    const cur = Array.isArray(c.selected) ? [...c.selected] : [];
    const at = cur.indexOf(opt);
    if (at >= 0) cur.splice(at, 1); else if (cur.length < c.count) cur.push(opt); else return { title: 'Уже выбрано достаточно', body: `Снимите одно из ${c.count}, чтобы взять другое.` };
    change(ix, st, plan, { type: 'setSelection', choiceId: c.id, value: cur.length ? cur : undefined });
    return null;
  };
  if (p.tab !== undefined) { st.tab = Number(p.tab) || 0; return null; }
  if (p.extra) {
    const [choiceId, opt] = String(p.extra).split('|');
    const c = ev.choices.find((x) => x.id === choiceId);
    if (!c) return null;
    if (c.kind === 'asi_or_feat') {
      const ab = opt.replace(/^asi2:/, '');
      const same = c.selected?.type === 'asi' && c.selected.increases?.[ab] === 2;
      change(ix, st, plan, { type: 'setSelection', choiceId, value: same ? undefined : { type: 'asi', increases: { [ab]: 2 } } });
      return null;
    }
    if (c.count === 1 && (c.kind === 'subclass' || c.kind === 'feature_option')) { change(ix, st, plan, { type: 'setSelection', choiceId, value: c.selected === opt ? undefined : opt }); return null; }
    return toggle(c, opt);
  }
  if (p.auto) {
    for (let guard = 0; guard < 6; guard += 1) {
      const e = evaluate(ix, plan);
      const c = spellChoices(e, plan).find((x) => (x.selected?.length || 0) < x.count && optionsOf(x, e).length);
      if (!c) break;
      const have = new Set(c.selected || []);
      const pick = optionsOf(c, e).filter((id) => !have.has(id) && !(c.unavailable || []).some((u) => u.option === id)).sort((a, b) => spellName(ix, a).localeCompare(spellName(ix, b), 'ru'));
      change(ix, st, plan, { type: 'setSelection', choiceId: c.id, value: [...have, ...pick].slice(0, c.count) });
    }
    return { title: 'Заклинания выбраны', body: 'Поменять можно в списке.' };
  }
  if (p.spells?.length) {
    const c = spellChoices(ev, plan)[st.tab];
    const id = c && optionsOf(c, ev).find((x) => spellName(ix, x) === p.spells[0]);
    st.focus = p.spells[0];
    return id ? toggle(c, id) : null;
  }
  return null;
}

/** levelUpView(): объект формы LEVEL_UP (fixture.js). v — HeroView героя (adapter.js). */
export function levelUpModel(ix, st, hero, v) {
  const plan = planOf(ix, st, hero);
  if (!plan.supported) return { ...LEVEL_UP, isLive: true, supported: false, reason: plan.reason };
  const simple = plan.mode === 'simple';
  const ev = simple ? null : evaluate(ix, plan);
  const cls = ix.defs.get(st.classId);
  const className = cls?.name?.ru || v.classes[0]?.name || 'Класс';
  const gain = plan.hp.gain, hpNow = v.vitals.hp.max;
  const missing = simple ? plan.errors.map((e) => e.message) : [...ev.errors, ...(ev.missing || [])].map((m) => m.message);
  const status = simple ? (plan.errors.length ? 'invalid' : 'valid') : ev.status;

  // Новое на уровне
  const feats = plan.features.map((f) => ({ name: nameOf(ix, f.ref), text: ix.features.get(f.ref)?.description?.ru || ix.features.get(f.ref)?.text?.ru || '' }));
  const extra = simple ? [] : extraChoices(ev, plan).map((c) => {
    if (c.kind === 'asi_or_feat') {
      const sel = c.selected?.type === 'asi' ? Object.keys(c.selected.increases || {})[0] : null;
      return { title: 'Улучшение характеристик: +2 к одной', note: asiValue(c.selected) ? `выбрано: ${asiValue(c.selected)}` : 'выбрано 0 из 1', choiceId: c.id,
        list: ABILITIES.map((a) => ({ name: `${a.name} +2`, value: `asi2:${a.id}`, on: a.id === sel || undefined })) };
    }
    const bad = new Set((c.unavailable || []).map((u) => u.option));
    const isSel = (o) => (Array.isArray(c.selected) ? c.selected.includes(o) : c.selected === o);
    return { title: `${EXTRA_RU[c.kind]}: ${nameOf(ix, c.origin?.definitionId)}`, note: `выбрано ${Array.isArray(c.selected) ? c.selected.length : c.selected ? 1 : 0} из ${c.count}`, choiceId: c.id,
      list: (c.options || []).filter((o) => !bad.has(o)).map((o) => ({ name: SKILLS.find((k) => k.id === o)?.name || nameOf(ix, o), value: o, on: isSel(o) || undefined })) };
  });

  // Ячейки: было → станет (станет — когда сборка полная).
  let after = null;
  if (!simple && status === 'valid') { try { after = levelUpPayload(hero, plan, ix.cats, { makeId: () => 'preview' }).patch; } catch { after = null; } }
  const slotRows = (pools) => new Map((pools || []).filter((s) => s.kind !== 'pact' || true).map((s) => [s.circle, s.max]));
  const was = slotRows(hero.slotPools), will = after?.slotPools ? slotRows(after.slotPools) : was;
  const circles = [...new Set([...was.keys(), ...will.keys()])].sort((a, b) => a - b);
  const slots = circles.map((c) => ({ name: `${c} круг`, from: was.get(c) ?? 0, to: will.get(c) ?? was.get(c) ?? 0 }));

  // Заклинания
  const sc = simple ? [] : spellChoices(ev, plan);
  const tab = Math.min(st.tab, Math.max(0, sc.length - 1));
  const meta = (id) => { const r = ix.ref[id] || [], e = ix.spells.get(id); return [ix.schools[e?.school], r[1], r[0]].filter(Boolean).join(' · '); };
  const lists = sc.map((c) => optionsOf(c, ev).map((id) => ({ name: spellName(ix, id), meta: meta(id), on: c.selected?.includes(id) || undefined, conc: ix.spells.get(id)?.concentration || undefined, ritual: ix.spells.get(id)?.ritual || undefined, focus: spellName(ix, id) === st.focus || undefined })));
  const focusId = sc[tab] && optionsOf(sc[tab], ev).find((id) => spellName(ix, id) === st.focus);

  const prof = (lvl) => 2 + Math.floor((lvl - 1) / 4);
  return {
    ...LEVEL_UP, isLive: true, supported: true, simple, status, missing,
    heroId: v.id, from: plan.fromLevel, to: plan.toLevel, className, note: simple ? 'Герой собран без конструктора — выборы уровня вписываются в лист вручную' : `${plan.toLevel} уровень: ${className}`,
    hp: {
      title: 'Сколько хитов прибавить?', hint: `${className} получает к${plan.hitDie} за уровень плюс Телосложение. Сервер прибавит среднее — так решено для всех кампаний.`, rule: 'Хиты: среднее значение кости',
      options: [{ id: 'average', name: 'Взять среднее', sub: Number.isFinite(gain) ? `+${gain} хитов` : 'по формуле', text: `Половина к${plan.hitDie} + 1 и модификатор Телосложения.`, tags: ['Надёжно'], icon: 'favourite' }],
      now: { label: 'Максимум хитов сейчас', value: hpNow, sub: `${plan.fromLevel} уровень` },
      after: { label: `Станет на ${plan.toLevel} уровне`, value: Number.isFinite(gain) ? hpNow + gain : '—', sub: Number.isFinite(gain) ? `+${gain} — среднее к${plan.hitDie}` : 'укажите Телосложение' },
      gave: Number.isFinite(gain) ? [`Максимум хитов ${hpNow} → ${hpNow + gain}`, `Кость хитов к${plan.hitDie} — ещё одна`] : [],
    },
    news: {
      title: `Что приходит на ${plan.toLevel} уровне`, hint: extra.length ? 'Выберите то, что просит уровень, — блоки ниже. Остальное впишется в лист само.' : 'Здесь ничего не выбираете — посмотрите, что изменится.',
      chip: `${className} · ${plan.classLevel} уровень класса`,
      feature: feats[0] ? { tag: `${plan.toLevel} уровень`, name: feats[0].name, text: feats[0].text || 'Описание — в справочнике и в листе.', warn: simple ? plan.note : '' } : { tag: `${plan.toLevel} уровень`, name: simple ? 'Выборы уровня — вручную' : 'Новых умений нет', text: simple ? plan.note : 'На этом уровне класс даёт только хиты и мастерство.', warn: '' },
      slots, extra,
      more: [...feats.slice(1).map((f) => ({ label: 'Ещё умение', value: f.name, sub: '' })), { label: 'Бонус мастерства', value: signed(prof(plan.toLevel)), sub: prof(plan.toLevel) !== prof(plan.fromLevel) ? 'вырос' : 'без изменений' }],
      gave: feats.map((f) => f.name),
    },
    spells: {
      live: true, title: sc.length ? 'Новые заклинания' : 'Новых заклинаний нет', hint: sc.length ? 'Отметьте заклинания, которые просит уровень. «Собрать за меня» возьмёт подходящие по алфавиту.' : 'На этом уровне список заклинаний не растёт.',
      progress: sc.map((c) => ({ label: choiceLabel(c), now: c.selected?.length || 0, max: c.count })),
      tabs: sc.length ? sc.map(choiceLabel) : ['Без заклинаний'], tab, list: lists[tab] || [], lists,
      detail: focusId ? { tag: ix.spells.get(focusId)?.level ? `${ix.spells.get(focusId).level} круг` : 'Заговор', name: spellName(ix, focusId), text: (ix.ref[focusId] || []).slice(0, 4).filter(Boolean).join(' · ') } : { tag: 'Заклинание', name: 'Выберите в списке', text: 'Нажмите, чтобы взять или убрать.' },
      gave: ['Заклинания впишутся в лист'],
    },
    live: [['Хиты', Number.isFinite(gain) ? `${hpNow} → ${hpNow + gain}` : String(hpNow)], ['Уровень', `${plan.fromLevel} → ${plan.toLevel}`], ['Мастерство', signed(prof(plan.toLevel))], ['Умения', feats.map((f) => f.name).join(', ') || '—']],
    done: {
      changes: [`${plan.toLevel} уровень`, ...(Number.isFinite(gain) ? [`+${gain} хитов`] : []), ...feats.map((f) => f.name), ...extra.filter((b) => b.list.some((x) => x.on)).map((b) => b.list.filter((x) => x.on).map((x) => x.name).join(', '))],
      note: status === 'valid' ? 'Уровень запишет сервер: он сам прибавит хиты и проверит, что прежние уровни не изменились.' : `Не хватает: ${missing.slice(0, 3).join(' ')}`,
      hp: { value: Number.isFinite(gain) ? hpNow + gain : hpNow, sub: Number.isFinite(gain) ? `+${gain} за уровень` : '' },
    },
  };
}

/** Тело команды level_up_character. Бросает ошибку с пояснением, если выборы не закончены. */
export function levelUpRequest(ix, st, hero, { newId = () => crypto.randomUUID() } = {}) {
  const plan = planOf(ix, st, hero);
  if (!plan.supported) throw new Error(plan.reason);
  // Запрос замораживается до ответа: повтор после обрыва шлёт те же ID и данные.
  st.payload ||= levelUpPayload(hero, plan, ix.cats, { makeId: () => newId() });
  st.operationId ||= newId();
  return { payload: st.payload, operationId: st.operationId, gain: plan.hp.gain };
}
