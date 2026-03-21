#!/bin/zsh
set -euo pipefail

BASE="$HOME/crm-bot-v3"
mkdir -p "$BASE/debug"

while true; do
  cd "$BASE"
  node ./crm-watch.js >> "$BASE/debug/crmwatch.out" 2>> "$BASE/debug/crmwatch.err" || true
  sleep 5
done
