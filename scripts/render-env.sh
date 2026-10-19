#!/usr/bin/env bash
# Renders devstack/env.template into .devstack/env.
# DEV_HOST is the host name the VVD and the host browser both use to reach the API; it defaults to
# localhost, which works because scripts/vvd-forward.sh reverse-forwards the API port into the VVD.
source "$(dirname "$0")/lib.sh"

export DEV_HOST="${DEV_HOST:-localhost}"
export FIREOS_ROOT
mkdir -p "$DEVSTACK" "$DEVSTACK/storage" "$DEVSTACK/run"
# A random SESSION_SECRET per machine, kept across re-renders (a committed one would be public).
secret_file="$DEVSTACK/session-secret"
if [[ ! -s "$secret_file" ]]; then
  (umask 077; head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$secret_file")
fi
SESSION_SECRET="$(cat "$secret_file")"
export SESSION_SECRET
(umask 077; envsubst '${DEV_HOST} ${FIREOS_ROOT} ${SESSION_SECRET}' < "$FIREOS_ROOT/devstack/env.template" > "$DEVSTACK/env")
chmod 600 "$DEVSTACK/env"
echo "wrote $DEVSTACK/env (DEV_HOST=$DEV_HOST)"
