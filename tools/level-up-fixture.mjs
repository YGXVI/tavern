// #202: фикстура повышения уровня для local PostgreSQL (supabase/tests/local_pg.py) — из фикстуры создания fighter1.
// Запуск: node tools/level-up-fixture.mjs > supabase/tests/character_level_up_fixture.json
// tests/level-up.test.js сверяет файл с тем, что считает движок сейчас.
import { readFileSync } from 'node:fs';
import { levelUpPlan, levelUpPayload } from '../dist/js/rules/level-up.js';

const read = p => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
export function levelUpFixture() {
  const cats = { options: read('dist/js/data/character-options-2014.json'), spells: read('dist/js/data/spells-2014.json'),
    equipment: read('dist/js/data/equipment-2014.json'), features: read('dist/js/data/features-2014.json') };
  const fighter = read('supabase/tests/character_create_fixtures.json').find(f => f.name === 'fighter1');
  const plan = levelUpPlan(fighter.data, 'srd51:class:fighter', cats);
  if (plan.choices.length) throw new Error('fighter 1→2 не должен требовать выборов');
  let n = 0;
  const payload = levelUpPayload(fighter.data, plan, cats, { makeId: () => `20000000-0000-4000-8000-${String(++n).padStart(12, '0')}` });
  return { from: 'fighter1', operationId: '20000000-0000-4000-8000-0000000000ff', hpGain: plan.hp.gain, payload };
}
if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(`${JSON.stringify(levelUpFixture(), null, 1)}\n`);
