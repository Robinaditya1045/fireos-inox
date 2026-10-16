#!/usr/bin/env bash
# Remote-only walk-through on VVD (validation: "every screen operable with arrows, select, back,
# play/pause"). Relaunches the app, injects only remote keys, and prints the focus/navigation/key
# log lines each step produced. Needs Metro + tools/devlog/devlog.mjs writing .devstack/logs/app-all.log.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="$ROOT/.devstack/logs/app-all.log"
# shellcheck disable=SC1090
source ~/vega/env
cd "$ROOT"

vega device terminate-app --appName com.fireosinox.tv.main >/dev/null 2>&1 || true
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
    | grep -E 'FOI .*\[(focus|nav|keys|room|auth)\]' | sed -E 's/^[0-9]+ FOI . //' | cut -c1-120 || true
  scripts/vvd.sh shot "$(printf 'dpad-%02d' "$n")" >/dev/null 2>&1 || echo "   (screenshot skipped: VVD window covered)"
}

step "launch → sign-in (default focus)"
step "up to password" KEY_UP
step "up to email" KEY_UP
step "select email (VVD shows no on-screen keyboard)" KEY_ENTER
step "down to password" KEY_DOWN
step "down to sign-in" KEY_DOWN
WAIT=4 step "select → sign in → lobby" KEY_ENTER
step "arrows in lobby keep focus on a room" KEY_RIGHT KEY_DOWN KEY_LEFT KEY_UP
WAIT=6 step "select → room" KEY_ENTER
step "menu opens chat" KEY_MENU
step "back closes chat (stays in room)" KEY_BACK
step "play/pause as member → toast" KEY_PLAYPAUSE
step "rewind / fast-forward as member → toast" KEY_REWIND KEY_FASTFORWARD
WAIT=3 step "back → lobby" KEY_BACK
step "back on lobby" KEY_BACK
echo "── app running after final back: $(vega device is-app-running --appName com.fireosinox.tv.main 2>&1 | tail -1)"
