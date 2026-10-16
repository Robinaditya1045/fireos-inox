#!/usr/bin/env bash
# Shared paths for the devstack scripts. Sourced, never executed.
set -euo pipefail

FIREOS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INOX_DIR="${INOX_DIR:-/home/robin/code/go/inox}"
DEVSTACK="$FIREOS_ROOT/.devstack"
INOX_SRC="$DEVSTACK/inox-src"
BIN="$DEVSTACK/bin"
COMPOSE=(docker compose -f "$FIREOS_ROOT/devstack/docker-compose.yml")

load_env() {
  if [[ ! -f "$DEVSTACK/env" ]]; then
    echo "missing $DEVSTACK/env — run scripts/render-env.sh first" >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1091
  source "$DEVSTACK/env"
  set +a
}
