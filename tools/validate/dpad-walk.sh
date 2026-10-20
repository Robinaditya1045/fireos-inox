#!/usr/bin/env bash
# Remote-only walk-through on VVD (validation: "every screen operable with arrows, select, back,
# menu, play/pause"). Relaunches the app, injects only remote keys, and prints the focus/navigation/
# key log lines each step produced, plus a screenshot per step when the VVD window is uncovered.
# Starts from whatever the app restores: with a stored session it signs out first (that is a step
# too), so every run walks sign-in → lobby → room overlays → lobby → exit. Needs Metro, the dev
# build (prefilled TV user) and tools/devlog/devlog.mjs writing .devstack/logs/app-all.log.
#   tools/validate/dpad-walk.sh > .devstack/evidence/dpad-walk.txt
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="$ROOT/.devstack/logs/app-all.log"
# shellcheck disable=SC1090
source ~/vega/env
cd "$ROOT"

vega device terminate-app --appName com.fireosinox.tv.main >/dev/null 2>&1 || true
start=$(wc -l < "$LOG")
vega device launch-app --appName com.fireosinox.tv.main >/dev/null
sleep 14

n=0
step() {
  local label="$1"; shift
  n=$((n + 1))
  local t; t=$(date +%s%3N)
  [[ $# -gt 0 ]] && scripts/vvd.sh key "$@"
  sleep "${WAIT:-2}"
  echo "── $label ${*:+(keys: $*)}"
  tr -d '\000' < "$LOG" | awk -v t="$t" '$1+0>t' \
    | grep -E 'FOI .*\[(focus|nav|keys|room|auth|ui|exit|storage|lobby)\]' | sed -E 's/^[0-9]+ FOI . //' | cut -c1-120 || true
  scripts/vvd.sh shot "$(printf 'dpad-%02d' "$n")" >/dev/null 2>&1 || echo "   (screenshot skipped: VVD window covered)"
}

first=$(tail -n +"$((start + 1))" "$LOG" | grep -E -o '\[nav\] screen \{"name":"(signin|lobby)"\}' | head -1 || true)
echo "── launch → ${first:-unknown screen}"
if [[ "$first" == *lobby* ]]; then
  step "up to Sign out" KEY_UP
  WAIT=4 step "select → sign out → sign-in" KEY_ENTER
fi

step "sign-in: up to password" KEY_UP
step "up to email" KEY_UP
step "select email → D-pad keyboard (no system keyboard on VVD)" KEY_ENTER
step "back → form, focus on email" KEY_BACK
step "down to password, down to Sign in" KEY_DOWN KEY_DOWN
WAIT=4 step "select → sign in → lobby" KEY_ENTER
step "arrows in lobby move between cards" KEY_RIGHT KEY_LEFT
WAIT=7 step "select → room" KEY_ENTER
step "left wakes the status banner" KEY_LEFT
step "up → reaction tray" KEY_UP
step "back closes the tray" KEY_BACK
step "select → control bar" KEY_ENTER
step "right moves along the bar" KEY_RIGHT KEY_RIGHT
step "back closes the bar" KEY_BACK
step "menu → chat panel" KEY_MENU
step "back closes chat (stays in room)" KEY_BACK
mark=$(date +%s%3N)
step "down → library (controllers) or toast (members)" KEY_DOWN
# Back again only if the library opened; otherwise Back would leave the room.
if tr -d '\000' < "$LOG" | awk -v t="$mark" '$1+0>t' | grep -q '\[ui\] overlay {"overlay":"library"}'; then
  step "back closes the library" KEY_BACK
fi
WAIT=4 step "back → lobby, focus on this room" KEY_BACK
step "back on lobby → Leave Inox? (focus Stay)" KEY_BACK
step "back closes the dialog" KEY_BACK
step "back → dialog, right to Exit" KEY_BACK KEY_RIGHT
WAIT=3 step "select → exit" KEY_ENTER
echo "── app running after Exit: $(vega device is-app-running --appName com.fireosinox.tv.main 2>&1 | tail -1)"
