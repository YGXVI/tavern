// Точка входа Edge Function. vendor/ собирает tools/deploy-build-check.sh из dist/js (те же файлы, что у браузера).
import { handle } from './handler.js';
import { checkCreate, checkLevelUp } from './vendor/js/rules/build-check.js';
import options from './vendor/js/data/character-options-2014.json' with { type: 'json' };
import spells from './vendor/js/data/spells-2014.json' with { type: 'json' };
import equipment from './vendor/js/data/equipment-2014.json' with { type: 'json' };
import features from './vendor/js/data/features-2014.json' with { type: 'json' };

const catalogues = { options, spells, equipment, features };
const env = { url: Deno.env.get('SUPABASE_URL')!, anonKey: Deno.env.get('SUPABASE_ANON_KEY')!, key: Deno.env.get('BUILD_CHECK_KEY')! };
Deno.serve((req: Request) => handle(req, { check: { checkCreate, checkLevelUp }, catalogues, env, fetch }));
