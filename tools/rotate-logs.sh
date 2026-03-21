#!/bin/zsh
set -euo pipefail
setopt NULL_GLOB

BASE="$HOME/crm-bot-v3"
DEBUG_DIR="$BASE/debug"
MAX_BYTES=$((1024 * 1024))   # 1 MB
KEEP=3

mkdir -p "$DEBUG_DIR"

rotate_one() {
  local f="$1"

  [ -f "$f" ] || return 0

  local size
  size=$(wc -c < "$f" 2>/dev/null | tr -d ' ')

  [ "${size:-0}" -ge "$MAX_BYTES" ] || return 0

  local i
  for (( i=KEEP; i>=1; i-- )); do
    if [ -f "$f.$i" ]; then
      if [ "$i" -eq "$KEEP" ]; then
        rm -f "$f.$i"
      else
        mv "$f.$i" "$f.$((i+1))"
      fi
    fi
  done

  mv "$f" "$f.1"
  : > "$f"
}

for f in "$DEBUG_DIR"/*.out "$DEBUG_DIR"/*.err "$DEBUG_DIR"/*.log; do
  [ -e "$f" ] || continue
  rotate_one "$f"
done
