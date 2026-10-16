#!/usr/bin/env bash
# Guard for decision D1. First run records Inox's HEAD and status; later runs report any difference.
# The owner may work on Inox in parallel, so a difference means "check this", not "we broke it".
source "$(dirname "$0")/lib.sh"

baseline="$DEVSTACK/inox-baseline.txt"
current() {
  echo "HEAD $(git --no-optional-locks -C "$INOX_DIR" rev-parse HEAD)"
  git --no-optional-locks -C "$INOX_DIR" status --porcelain=v1
}

mkdir -p "$DEVSTACK"
if [[ ! -f "$baseline" ]]; then
  current > "$baseline"
  echo "baseline recorded: $baseline"
  exit 0
fi

if diff -u "$baseline" <(current); then
  echo "inox unchanged since baseline"
else
  echo "inox differs from baseline (see diff above)" >&2
  exit 1
fi
