#!/bin/zsh
set -euo pipefail

BASE="$HOME/crm-bot-v3"
mkdir -p "$BASE/debug"

while true; do
  cd "$BASE"
  node ./crm-session-watch.js >> "$BASE/debug/sessionwatch.out" 2>> "$BASE/debug/sessionwatch.err" || true
  sleep 5
done
