#!/usr/bin/env bash
# Браузерные наборы tests/browser/** (#204, аудит 06.11, T1). Нужны Playwright с Chromium (NODE_PATH или node_modules).
# Сервер поднимается здесь; каждый набор — отдельным процессом, чтобы падение одного не скрывало остальные.
set -uo pipefail
cd "$(dirname "$0")/.."
python3 -m http.server 4173 --directory dist >/dev/null 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null' EXIT
sleep 1
failed=()
tails=""
for suite in server-e2e/guest server-e2e/e2e server-e2e/encounters server-e2e/own-creature server-e2e/token-approval \
  sheet/e2e sheet/actions sheet/growth sheet/server sheet/npc table-combat/e2e table-combat/init-mini token-image/e2e file-drop/e2e reference-layout/e2e; do
  echo "::group::$suite"
  log="$(mktemp)"
  if ! node "tests/browser/$suite.mjs" >"$log" 2>&1; then failed+=("$suite"); tails+="
--- $suite
$(grep -v '^ *at ' "$log" | tail -n 12 | cut -c1-200)"; fi
  cat "$log"
  echo "::endgroup::"
done
if [ "${#failed[@]}" -gt 0 ]; then echo "Упали наборы: ${failed[*]}$tails"; exit 1; fi
echo "Браузерные наборы: все прошли"
