#!/usr/bin/env bash
# Выкатка проверки сборки героя (P4b, #202) на ТЕСТОВЫЙ проект Supabase. Запускается из CI после миграций.
# Нужны: SUPABASE_ACCESS_TOKEN, BUILD_CHECK_KEY, TEST_SUPABASE_URL, TEST_DATABASE_URL. Боевой проект отвергается.
set -euo pipefail
PROD_REF=ilsuespohsuligyiqjsx
REF=$(printf '%s' "$TEST_SUPABASE_URL" | sed -E 's#^https://([a-z0-9]{20})\.supabase\.co/?$#\1#')
[[ "$REF" =~ ^[a-z0-9]{20}$ ]] || { echo "Неверный TEST_SUPABASE_URL"; exit 1; }
[ "$REF" != "$PROD_REF" ] || { echo "Это боевой проект — отказ"; exit 1; }
[ "${#BUILD_CHECK_KEY}" -ge 32 ] || { echo "BUILD_CHECK_KEY короче 32 символов"; exit 1; }

FN=supabase/functions/validate-build
rm -rf "$FN/vendor" && mkdir -p "$FN/vendor/js/rules" "$FN/vendor/js/data" "$FN/vendor/js/views/table"
cp dist/js/rules/build-check.js dist/js/rules/character-builder.js dist/js/rules/level-up.js "$FN/vendor/js/rules/"
cp dist/js/data/rules.js dist/js/data/character-options-2014.json dist/js/data/spells-2014.json dist/js/data/equipment-2014.json dist/js/data/features-2014.json "$FN/vendor/js/data/"
cp dist/js/views/table/sheet-rules.js "$FN/vendor/js/views/table/"
[ "${PREPARE_ONLY:-}" = 1 ] && exit 0

SB="npx --yes supabase@2.105.0"
ENVF=$(mktemp); trap 'rm -f "$ENVF"' EXIT
printf 'BUILD_CHECK_KEY=%s\n' "$BUILD_CHECK_KEY" > "$ENVF"
$SB secrets set --env-file "$ENVF" --project-ref "$REF"
$SB functions deploy validate-build --project-ref "$REF"
HASH=$(printf '%s' "$BUILD_CHECK_KEY" | sha256sum | cut -d' ' -f1)
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -v h="$HASH" <<'SQL'
insert into public.build_check_key(id, key_hash) values (true, :'h') on conflict (id) do update set key_hash = excluded.key_hash;
SQL
echo "Проверка сборки выкачена на $REF"
