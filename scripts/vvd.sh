#!/usr/bin/env bash
# VVD helpers used for validation and demos.
#   scripts/vvd.sh shot <name>        screenshot the VVD screen → .devstack/evidence/<name>.png
#   scripts/vvd.sh key KEY_DOWN ...   inject remote buttons (inputd-cli button_press)
#   scripts/vvd.sh logs [n]           last n app log lines tagged FOI
#   scripts/vvd.sh relaunch           build Debug and (re)launch the app
set -euo pipefail
# shellcheck disable=SC1090
source ~/vega/env
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_ID=com.fireosinox.tv

case "${1:-}" in
  shot)
    # The VVD window renders with GL; xwd cannot read it, so grab the composited screen region —
    # but only when nothing covers it, or the capture would contain other parts of the desktop.
    if ! python3 "$ROOT/scripts/vvd-visible.py"; then
      echo "VVD window is covered by another window; not capturing" >&2
      exit 2
    fi
    geom=$(xwininfo -name "Vega Virtual Device" | awk '/Absolute upper-left X/{x=$4}/Absolute upper-left Y/{y=$4}/Height:/{h=$2}END{print x, y, h}')
    read -r x y h <<<"$geom"
    w=$(( h * 16 / 9 ))   # the screen area is 16:9; the on-screen remote sits to its right
    mkdir -p "$ROOT/.devstack/evidence"
    ffmpeg -loglevel error -y -f x11grab -video_size "${w}x${h}" -i ":0.0+${x},${y}" -frames:v 1 "$ROOT/.devstack/evidence/$2.png"
    echo "$ROOT/.devstack/evidence/$2.png"
    ;;
  key)
    shift
    for k in "$@"; do
      vega device run-cmd --command "inputd-cli button_press $k" >/dev/null
      sleep 0.4
    done
    ;;
  logs)
    vega device run-cmd --command "loggingctl log -v $APP_ID -o short_precise | grep FOI | tail -n ${2:-40}"
    ;;
  relaunch)
    (cd "$ROOT/apps/vega" && npm run build:debug >/dev/null && vega run-app build/x86_64-debug/fireosinox_x86_64.vpkg | tail -1)
    ;;
  *)
    sed -n '2,7p' "$0"
    exit 1
    ;;
esac
