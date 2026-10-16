#!/usr/bin/env bash
# Network-loss validation on VVD (docs/dev/testing.md): with the TV playing in the room,
#  1. remove the VVD → host reverse forward (the TV can open no new connections),
#  2. restart the Inox server (drops the TV's established socket),
#  3. as host, SEEK to $TARGET and PLAY while the TV is still cut off,
#  4. after $OUTAGE seconds restore the forward; the TV must reconnect and resync.
# Prints the phase timestamps (host epoch ms); analyse with the app log afterwards.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="${TARGET:-60}"
OUTAGE="${OUTAGE:-20}"
# shellcheck disable=SC1090
source ~/vega/env
cd "$ROOT"

echo "cut_at=$(date +%s%3N)"
vega device stop-port-forwarding --port 18080 --forward false >/dev/null
pid=$(pgrep -f "^$ROOT/.devstack/bin/inox-server")
kill "$pid"
sleep 2
(setsid nohup scripts/run-backend.sh >> .devstack/logs/server.log 2>&1 &)
for _ in $(seq 1 20); do curl -sf http://127.0.0.1:18080/healthz >/dev/null && break; sleep 1; done
echo "server_back_at=$(date +%s%3N)"
node tools/sync-probe/probe.mjs send SEEK "{\"media_time_seconds\":$TARGET}" >/dev/null
node tools/sync-probe/probe.mjs send PLAY "{\"media_time_seconds\":$TARGET}" | grep 'SENT PLAY' | awk '{print "host_play_at=" $1}'
sleep "$OUTAGE"
scripts/vvd.sh shot 15-netkill-reconnecting >/dev/null
echo "restore_at=$(date +%s%3N)"
scripts/vvd-forward.sh >/dev/null
