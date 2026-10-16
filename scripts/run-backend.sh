#!/usr/bin/env bash
# Runs the Inox API server (foreground). cwd is .devstack/run so Inox's .env lookup finds nothing.
source "$(dirname "$0")/lib.sh"

load_env
cd "$DEVSTACK/run"
exec "$BIN/inox-server"
