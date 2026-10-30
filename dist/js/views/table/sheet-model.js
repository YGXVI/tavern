// Read-only адаптер старого Character. Это view model, не новый формат записи JSONB.
import { ABILITIES, SKILLS } from '../../data/rules.js';
import { abilityModifier, knownInteger, sheetProficiency, checkBonus } from './sheet-rules.js';

const list = (value) => Array.isArray(value) ? structuredClone(value) : [];
const text = (value) => typeof value === 'string' ? value : '';
const section = (value) => ({ entries: list(value), legacyText: text(value) });

export function readLegacyCharacter(character) {
  if (!character || typeof character !== 'object' || Array.isArray(character)) throw new TypeError('Нужен Character');
  const source = structuredClone(character);
  const warnings = [];
  const level = knownInteger(source.level);
  const proficiency = sheetProficiency(level);
  const abilities = Object.fromEntries(ABILITIES.map(({ id }) => [id, knownInteger(source.stats?.[id])]));
  const saves = list(source.saves), skills = list(source.skills);
  const hitDiceMatch = typeof source.hitDice === 'string' ? /^(\d+)\s*[dдк]\s*(4|6|8|10|12|20)$/i.exec(source.hitDice.trim()) : null;
  // У старого листа нет счётчика потраченных костей: не объявляем их все доступными.
  const hitDice = hitDiceMatch ? [{ id: 'legacy-hit-dice', die: Number(hitDiceMatch[2]), total: knownInteger(Number(hitDiceMatch[1])), spent: null }] : [];
  if (hitDice.length) warnings.push({ path: 'hitDice', reason: 'Уточните потраченные кости перед автоматическим отдыхом' });
  const slots = source.slots && typeof source.slots === 'object' && !Array.isArray(source.slots) ? source.slots : {};
  const slotPools = Object.entries(slots).filter(([circle]) => /^[1-9]$/.test(circle)).map(([circle, pool]) => ({
    id: `legacy-slot-${circle}`, circle: Number(circle), max: knownInteger(pool?.max), spent: knownInteger(pool?.used),
    kind: 'legacy', recovery: 'manual',
  }));
  if (slotPools.length) warnings.push({ path: 'slots', reason: 'Уточните источник магии и правило восстановления ячеек' });
  return {
    source,
    identity: {
      id: source.id ?? null, ownerId: source.ownerId ?? null, name: text(source.name), portrait: source.portrait ?? null,
      ancestry: text(source.raceName), background: text(source.background), alignment: text(source.alignment),
    },
    classes: source.classId || source.className ? [{ id: 'legacy-class', classId: source.classId ?? null, name: text(source.className), levels: level, subclass: null }] : [],
    level, abilities, proficiency,
    hp: { current: knownInteger(source.hp), max: knownInteger(source.hpMax), temp: knownInteger(source.tempHp) },
    ac: knownInteger(source.ac),
    movement: { walk: knownInteger(source.speed) },
    initiative: source.initBonus === undefined ? abilityModifier(abilities.dex) : knownInteger(source.initBonus),
    deathSaves: { successes: knownInteger(source.deathSaves?.s), failures: knownInteger(source.deathSaves?.f) },
    conditions: list(source.conditions), hitDice, slotPools,
    saves: Object.fromEntries(ABILITIES.map(({ id }) => [id, checkBonus({ score: abilities[id], proficiency, multiplier: saves.includes(id) ? 1 : 0 })])),
    skills: Object.fromEntries(SKILLS.map(({ id, ab }) => [id, checkBonus({ score: abilities[ab], proficiency, multiplier: skills.includes(id) ? 1 : 0 })])),
    attacks: list(source.attacks),
    spells: section(source.spells), inventory: section(source.inventory), features: section(source.features), notes: text(source.notes),
    warnings,
  };
}
