#!/usr/bin/env bash
# Тестовая база (DEC-018, #204): применяет новые миграции supabase/migrations/*.sql к ТЕСТОВОМУ проекту
# Supabase и прогоняет проверки прав supabase/tests/rls.sql. Запускается в CI на ветке test.
# История — в supabase_migrations.schema_migrations (та же таблица, что у Supabase CLI), каждая миграция —
# в своей транзакции вместе с записью в историю. Боевую базу скрипт трогать отказывается.
# Запуск: TEST_DATABASE_URL='postgresql://…pooler.supabase.com:5432/postgres' tools/migrate-test-db.sh
set -euo pipefail

PROD_REF='ilsuespohsuligyiqjsx'
url="${TEST_DATABASE_URL:?Нет TEST_DATABASE_URL}"
case "$url" in *"$PROD_REF"*) echo "TEST_DATABASE_URL указывает на боевую базу — отказ." >&2; exit 1;; esac

dir="$(cd "$(dirname "$0")/.." && pwd)"
psql_db() { PGOPTIONS='-c client_min_messages=warning' psql "$url" -X -v ON_ERROR_STOP=1 -q "$@"; }

psql_db -c "create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);"
applied="$(psql_db -tA -c 'select version from supabase_migrations.schema_migrations')"

for file in "$dir"/supabase/migrations/*.sql; do
  base="$(basename "$file" .sql)"; version="${base%%_*}"; name="${base#*_}"
  if grep -qx "$version" <<<"$applied"; then continue; fi
  echo "Миграция $base"
  { echo 'begin;'; cat "$file"; echo
    echo "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name');"
    echo 'commit;'; } | psql_db -f -
done

echo 'Проверка прав (rls.sql)'
result="$(psql_db -tA -F '|' -f "$dir/supabase/tests/rls.sql" | grep -v '^$')"
total="$(grep -c '' <<<"$result")"
failed="$(grep -E '\|f\|' <<<"$result" || true)"
if [ -n "$failed" ]; then echo "Проверки прав не прошли:" >&2; echo "$failed" >&2; exit 1; fi
echo "Проверки прав: $total ok"
