#!/bin/zsh
set -euo pipefail

BASE="$HOME/crm-bot-v3"
mkdir -p "$BASE/debug"

while true; do
  cd "$BASE"
  node ./crm-worker.js >> "$BASE/debug/crmworker.out" 2>> "$BASE/debug/crmworker.err" || true
  sleep 3
done
