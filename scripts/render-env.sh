#!/usr/bin/env bash
# Renders devstack/env.template into .devstack/env.
# DEV_HOST is the host name the VVD and the host browser both use to reach the API; it defaults to
# localhost, which works because scripts/vvd-forward.sh reverse-forwards the API port into the VVD.
source "$(dirname "$0")/lib.sh"

export DEV_HOST="${DEV_HOST:-localhost}"
export FIREOS_ROOT
mkdir -p "$DEVSTACK" "$DEVSTACK/storage" "$DEVSTACK/run"
envsubst '${DEV_HOST} ${FIREOS_ROOT}' < "$FIREOS_ROOT/devstack/env.template" > "$DEVSTACK/env"
echo "wrote $DEVSTACK/env (DEV_HOST=$DEV_HOST)"
