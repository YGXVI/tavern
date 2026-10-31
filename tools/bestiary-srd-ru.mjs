// TASK-117: точная привязка самостоятельного перевода к английскому SRD 5.1.
import { createHash } from 'node:crypto';

export const SECTIONS = ['special_abilities', 'actions', 'legendary_actions', 'reactions'];
export const hashEnglish = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

export function sourceEntries(catalogue) {
  const entries = [];
  for (const monster of catalogue.monsters) {
    const block = monster.stat_block;
    if (block?.source !== 'srd_api_2014') continue;
    // Новый раздел нельзя незаметно оставить за пределами перевода.
    const visit = (value, path) => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (/legend/i.test(key) && key !== 'legendary_actions') {
          throw new Error(`${monster.id}: новый легендарный раздел ${path}.${key}`);
        }
        visit(child, `${path}.${key}`);
      }
    };
    visit(block, 'stat_block');
    if (block.bonus_actions?.length) throw new Error(`${monster.id}: новый раздел bonus_actions`);
    for (const section of SECTIONS) {
      for (const entry of block[section] || []) {
        if (typeof entry.description_en !== 'string' || !entry.description_en.trim()) {
          throw new Error(`${monster.id}/${section}/${entry.name_en}: пустой английский оригинал`);
        }
        entries.push({ id: monster.id, section, name: entry.name_en, en: entry.description_en });
      }
    }
  }
  return entries;
}

export function translationFor(translations, id, section, entry) {
  const hash = hashEnglish(entry.description_en);
  const ru = translations.monsters?.[id]?.[section]?.[entry.name_en]?.[hash]?.ru;
  if (typeof ru !== 'string' || !ru.trim()) {
    throw new Error(`${id}/${section}/${entry.name_en}/${hash}: отсутствует актуальный непустой перевод`);
  }
  return ru;
}

export function validateTranslations(catalogue, translations, { allowUnused = false } = {}) {
  if (translations.schema_version !== 1 || translations.language !== 'ru'
      || translations.source?.stat_block_source !== 'srd_api_2014') {
    throw new Error('Неверный формат русского слоя SRD');
  }
  const entries = sourceEntries(catalogue);
  const expected = new Set();
  for (const e of entries) {
    translationFor(translations, e.id, e.section, { name_en: e.name, description_en: e.en });
    expected.add(JSON.stringify([e.id, e.section, e.name, hashEnglish(e.en)]));
  }
  if (!allowUnused) for (const [id, sections] of Object.entries(translations.monsters || {})) {
    if (!entries.some((e) => e.id === id)) throw new Error(`Лишний ID перевода: ${id}`);
    for (const [section, names] of Object.entries(sections)) {
      if (!SECTIONS.includes(section) || !Object.keys(names).length) throw new Error(`Лишний раздел: ${id}/${section}`);
      for (const [name, hashes] of Object.entries(names)) {
        if (!Object.keys(hashes).length) throw new Error(`Пустое имя: ${id}/${section}/${name}`);
        for (const [hash, value] of Object.entries(hashes)) {
          if (!expected.has(JSON.stringify([id, section, name, hash]))) throw new Error(`Лишний или устаревший перевод: ${id}/${section}/${name}/${hash}`);
          if (Object.keys(value).join() !== 'ru') throw new Error(`Лишнее поле перевода: ${id}/${section}/${name}`);
        }
      }
    }
  }
  return entries;
}

// Это контроль записи механики, не доказательство смысловой эквивалентности.
export function mechanicalTokens(text) {
  const normalized = text.replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/−/g, '-').replace(/[dк](?=\d)/gi, 'd');
  const measures = [...normalized.matchAll(/(\d+d\d+|\d+)(\s*\(\d*d\d+(?:\s*[+-]\s*\d+)?\))?\s*-?\s*(hours?|час(?:а|ов)?|minutes?|минут(?:а|у|ы)?|days?|день|дня|дней|rounds?|раунд(?:а|ов)?|miles?|мил(?:я|и|ь|ю)|inches|inch|дюйм(?:а|ов)?)(?![a-zа-яё])/gi)].map((m) => {
    const unit = /^(hour|час)/i.test(m[3]) ? 'hour' : /^(minute|минут)/i.test(m[3]) ? 'minute'
      : /^(day|день|дня|дней)/i.test(m[3]) ? 'day' : /^(round|раунд)/i.test(m[3]) ? 'round'
        : /^(mile|мил)/i.test(m[3]) ? 'mile' : 'inch';
    return `${(m[1] + (m[2] || '')).replace(/\s/g, '')}:${unit}`;
  }).sort();
  return {
    numbers: (normalized.match(/\d+/g) || []).sort((a, b) => +a - +b),
    dice: (normalized.match(/\d*d\d+(?:\s*[+-]\s*\d+)?/g) || []).map((x) => x.replace(/\s/g, '')).sort(),
    dc: [...normalized.matchAll(/(?:\bDC(?: of)?|Сл(?: высвобождения|, равной)?)\s+(\d+)/g)].map((m) => m[1]).sort(),
    bonuses: (normalized.match(/[+-]\d+(?!\d)/g) || []).sort(),
    feet: [...normalized.matchAll(/(\d+(?:\/\d+)?)\s*(?:-?(?:foot|feet)|ft\.|фт\.)/gi)].map((m) => m[1]).sort(),
    measures,
  };
}
