#!/usr/bin/env bash
# Runs the dev player lab (apps/vega/src/dev/PlayerLab.tsx) on VVD for one stream and hls.js config,
# saves its [lab] log lines, then restores the normal app config. Needs VVD, Metro and devlog running.
#   tools/validate/player-lab.sh <name> <url> [level] [hls-config-json] [suite: basic|pause|resume|drift|fix|recovery]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="$ROOT/.devstack/logs/app-all.log"
OUT="$ROOT/.devstack/evidence/lab-$1.txt"
cd "$ROOT"
# shellcheck disable=SC1090
source ~/vega/env
# Stop the app before touching the config: Metro would hot-reload a running app into the lab, and a
# second launch on top of that restarts it mid-trial (seen on the first run).
vega device terminate-app --appName com.fireosinox.tv.main >/dev/null 2>&1 || true
start=$(wc -l < "$LOG")
node scripts/write-app-config.mjs --player-lab "$2" --lab-level "${3:--1}" --lab-hls "${4:-{\}}" --lab-suite "${5:-basic}" >/dev/null
trap 'vega device terminate-app --appName com.fireosinox.tv.main >/dev/null 2>&1 || true; node scripts/write-app-config.mjs >/dev/null' EXIT
sleep 2
vega device launch-app --appName com.fireosinox.tv.main >/dev/null
for _ in $(seq 1 600); do
  sleep 2
  if tail -n +"$((start + 1))" "$LOG" | grep -q '\[lab\] \(DONE\|failed\)'; then break; fi
done
tail -n +"$((start + 1))" "$LOG" | grep '\[lab\]' > "$OUT"
echo "$OUT ($(wc -l < "$OUT") lines)"
grep -E '\[lab\] (READY|RESULT|JUMP|failed)' "$OUT" | sed -E 's/^[0-9]+ FOI . \[lab\] //' | cut -c1-260
