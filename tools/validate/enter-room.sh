#!/usr/bin/env bash
# Relaunches the TV app and enters the room the lobby focuses (the last one entered, else the first),
# signing in with the prefilled dev user only if the app lands on Sign-in (the session persists since
# M2). Waits on the app's own [nav]/[room] log lines instead of fixed sleeps, so a second Enter can
# never land in the room (where it opens the control bar). Needs tools/devlog writing app-all.log.
#   tools/validate/enter-room.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1090
source ~/vega/env
LOG=.devstack/logs/app-all.log

# Prints the first new log line (after line $1) matching $2, waiting up to $3 seconds.
wait_for() {
  local from=$1 pattern=$2 secs=$3 line
  for ((i = 0; i < secs * 4; i++)); do
    line=$(tail -n +"$((from + 1))" "$LOG" | grep -E -m1 "$pattern" || true)
    if [[ -n "$line" ]]; then echo "$line"; return 0; fi
    sleep 0.25
  done
  echo "enter-room: timed out waiting for /$pattern/" >&2
  return 1
}

vega device terminate-app --appName com.fireosinox.tv.main >/dev/null 2>&1 || true
sleep 1
start=$(wc -l < "$LOG")
vega device launch-app --appName com.fireosinox.tv.main >/dev/null
screen=$(wait_for "$start" '\[nav\] screen \{"name":"(signin|lobby)"\}' 40)
if [[ "$screen" == *signin* ]]; then
  sleep 1
  mark=$(wc -l < "$LOG")
  scripts/vvd.sh key KEY_ENTER   # Sign in is focused when the dev user is prefilled
  wait_for "$mark" '\[nav\] screen \{"name":"lobby"\}' 20 >/dev/null
fi
wait_for "$start" '\[lobby\] initial focus' 20 >/dev/null
sleep 0.5
mark=$(wc -l < "$LOG")
scripts/vvd.sh key KEY_ENTER
wait_for "$mark" '\[room\] entered' 20 | sed -E 's/^[0-9]+ FOI . //'
