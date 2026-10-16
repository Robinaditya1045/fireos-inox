#!/usr/bin/env bash
# Builds the Inox server, worker and migrator from the snapshot (never from the Inox workspace).
source "$(dirname "$0")/lib.sh"

[[ -d "$INOX_SRC/backend" ]] || { echo "no snapshot — run scripts/inox-snapshot.sh" >&2; exit 1; }
mkdir -p "$BIN"
cd "$INOX_SRC/backend"
for cmd in server worker migrate; do
  GOFLAGS=-mod=readonly go build -o "$BIN/inox-$cmd" "./cmd/$cmd"
done
ls -1 "$BIN"
