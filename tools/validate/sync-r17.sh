#!/usr/bin/env bash
# R17 sync run: relaunches the TV app into the room, drives the Inox web client as host through
# tools/validate/sync-script-r17.json (long pauses + seeks), and analyses TV vs room/web.
#   tools/validate/sync-r17.sh <name>     → .devstack/evidence/sync-run-<name>.txt
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1090
source ~/vega/env
LOG=.devstack/logs/app-all.log
vega device terminate-app --appName com.fireosinox.tv.main >/dev/null 2>&1 || true
sleep 1
start=$(wc -l < "$LOG")
vega device launch-app --appName com.fireosinox.tv.main >/dev/null
sleep 14
scripts/vvd.sh key KEY_ENTER   # sign in (prefilled dev user)
sleep 4
scripts/vvd.sh key KEY_ENTER   # first room
sleep 8
node tools/validate/browser-host.mjs tools/validate/sync-script-r17.json > ".devstack/logs/web-$1.log" 2>&1
tail -n +"$((start + 1))" "$LOG" > ".devstack/logs/app-$1.log"
node tools/validate/analyze-sync.mjs ".devstack/logs/web-$1.log" ".devstack/logs/app-$1.log" > ".devstack/evidence/sync-run-$1.txt"
grep -E '\[sync\] (STALL|RACE)|resetting media element' ".devstack/logs/app-$1.log" | sed -E 's/^[0-9]+ FOI . //' >> ".devstack/evidence/sync-run-$1.txt" || true
cat ".devstack/evidence/sync-run-$1.txt"
