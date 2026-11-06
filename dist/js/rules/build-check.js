// P4b (#202): независимая проверка сборки героя тем же движком, что и конструктор. Работает в Edge Function
// validate-build (supabase/functions) и в тестах: чистая функция без DOM, сети и хранилища.
// Браузеру не верим: сборка заново считается из data.creation (раса, класс, выборы, характеристики) и сверяется
// с тем, что клиент прислал в лист. Текст, портрет и заметки не проверяются — на правила они не влияют.
import { evaluateBuild, toCharacterData, defaultCreationContext, DEFAULT_PORTS } from './character-builder.js';
import { draftFromCreation } from './level-up.js';
import { creationHitPoints } from '../views/table/sheet-rules.js';

const PORTS = { ...DEFAULT_PORTS, creationHitPoints };
const sorted = (list, key) => (Array.isArray(list) ? list.map(key).filter((x) => x != null).sort() : []);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Что сверяем со сборкой: числа и всё, что даёт герою возможности. Потраченное и ID здесь не важны.
const FIELDS = {
  level: (d) => d.level, stats: (d) => Object.keys(d.stats || {}).sort().map((k) => [k, d.stats[k]]), speed: (d) => d.speed,
  classes: (d) => sorted(d.classes, (c) => `${c.ref}:${c.levels}:${c.subclassRef ?? ''}`),
  saves: (d) => Object.keys(d.proficiencies?.saves || {}).sort(), skills: (d) => Object.keys(d.proficiencies?.skills || {}).sort().map((k) => [k, d.proficiencies.skills[k]]),
  knownSpells: (d) => sorted(d.knownSpells, (s) => s.ref ?? s.name), featureEntries: (d) => sorted(d.featureEntries, (f) => f.ref ?? f.name),
  slotPools: (d) => sorted(d.slotPools, (s) => `${s.kind}:${s.circle}:${s.max}`), hitDicePools: (d) => sorted(d.hitDicePools, (p) => `${p.die}:${p.total}`),
};

function rebuild(creation, catalogues, policy) {
  const draft = draftFromCreation(creation);
  if (!draft) return { errors: [{ code: 'creation', message: 'Нет блока creation версии 1.' }] };
  const context = { ...defaultCreationContext({ policyRevision: draft.policyRevision }), ...(policy || {}), policyRevision: draft.policyRevision, startLevel: draft.levelHistory.length };
  const ev = evaluateBuild(context, catalogues, draft, PORTS);
  if (ev.status !== 'valid') return { errors: [...ev.errors, ...(ev.missing || [])].map((e) => ({ code: e.code, message: e.message })) };
  return { rebuilt: toCharacterData(ev, draft, catalogues, { makeId: () => 'check' }, PORTS).data, errors: [] };
}

/** Новый герой: data — лист для create_character_sheet. Возвращает { ok, errors[] }. */
export function checkCreate(data, catalogues, { policy = null } = {}) {
  const { rebuilt, errors } = rebuild(data?.creation, catalogues, policy);
  if (errors.length) return { ok: false, errors };
  const bad = Object.entries(FIELDS).filter(([, read]) => !same(read(rebuilt), read(data))).map(([k]) => ({ code: 'mismatch', field: k, message: `Поле «${k}» не совпадает со сборкой.` }));
  if (rebuilt.hpMax !== data.hpMax) bad.push({ code: 'mismatch', field: 'hpMax', message: 'Хиты не совпадают со сборкой.' });
  return { ok: !bad.length, errors: bad };
}

/** Повышение уровня: payload — { creation, patch } для level_up_character. Сверяются поля, которые меняет patch. */
export function checkLevelUp(payload, catalogues, { policy = null } = {}) {
  const { rebuilt, errors } = rebuild(payload?.creation, catalogues, policy);
  if (errors.length) return { ok: false, errors };
  const p = payload.patch || {};
  const view = { ...p, proficiencies: p.proficiencies };
  const bad = Object.entries(FIELDS).filter(([k]) => (k === 'saves' || k === 'skills' ? 'proficiencies' in p : k in p))
    .filter(([, read]) => !same(read(rebuilt), read(view))).map(([k]) => ({ code: 'mismatch', field: k, message: `Поле «${k}» не совпадает со сборкой.` }));
  return { ok: !bad.length, errors: bad };
}
