#!/usr/bin/env bash
# Starts Postgres and Redis for the local stack, then applies Inox's migrations from the snapshot.
source "$(dirname "$0")/lib.sh"

"${COMPOSE[@]}" up -d --wait
load_env
"$BIN/inox-migrate" --command=up --dir="$INOX_SRC/backend/migrations" --db="$DATABASE_URL"
