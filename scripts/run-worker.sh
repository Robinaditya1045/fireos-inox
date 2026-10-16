#!/usr/bin/env bash
# Runs the Inox transcoding worker (foreground). Needs ffmpeg on PATH.
source "$(dirname "$0")/lib.sh"

load_env
cd "$DEVSTACK/run"
exec "$BIN/inox-worker"
