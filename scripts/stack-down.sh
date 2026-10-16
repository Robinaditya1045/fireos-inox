#!/usr/bin/env bash
# Stops the local infrastructure. Pass -v to also delete its data volumes.
source "$(dirname "$0")/lib.sh"

"${COMPOSE[@]}" down "$@"
