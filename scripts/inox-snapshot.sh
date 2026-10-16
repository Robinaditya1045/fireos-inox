#!/usr/bin/env bash
# Copies Inox's committed HEAD (backend + frontend) into .devstack/inox-src.
# `git archive` only reads the repository, so the Inox workspace is never modified (decision D1).
source "$(dirname "$0")/lib.sh"

rm -rf "$INOX_SRC"
mkdir -p "$INOX_SRC"
git --no-optional-locks -C "$INOX_DIR" archive --format=tar HEAD backend frontend | tar -x -C "$INOX_SRC"
git --no-optional-locks -C "$INOX_DIR" rev-parse HEAD > "$INOX_SRC/INOX_COMMIT"
echo "snapshot of inox $(cat "$INOX_SRC/INOX_COMMIT") → $INOX_SRC"
