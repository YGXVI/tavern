// Параметры заклинаний для справочника (#203): время, дистанция, длительность, компоненты, типы урона, ссылка.
// Источник — data/spells/spells.json (снимок заголовков карточек dnd.su, Яра). Текста эффекта там нет и сюда не попадает.
// Запуск: node tools/spells-ref.mjs  →  dist/js/data/spells-ref-2014.json
import { readFileSync, writeFileSync } from 'node:fs';

const src = JSON.parse(readFileSync(new URL('../data/spells/spells.json', import.meta.url), 'utf8'));
const out = {
  note: 'СГЕНЕРИРОВАНО tools/spells-ref.mjs из data/spells/spells.json — не править руками. Только параметры, без текста эффекта.',
  classes: Object.fromEntries(src.classes.filter((c) => c.has_spell_list).map((c) => [c.id, c.name_ru])),
  schools: Object.fromEntries(src.schools.map((s) => [s.code, s.name_ru])),
  damage: Object.fromEntries(src.damage_types.map((d) => [d.code, d.name_ru])),
  // id → [время, дистанция, длительность, компоненты, типы урона, ссылка на карточку]
  spells: Object.fromEntries(src.spells.map((s) => [s.id, [s.casting_time, s.range_text, s.duration_text, s.components_text, s.damage_types || [], s.source_url]])),
};
writeFileSync(new URL('../dist/js/data/spells-ref-2014.json', import.meta.url), JSON.stringify(out));
console.log(`spells-ref-2014.json: ${Object.keys(out.spells).length} заклинаний`);
