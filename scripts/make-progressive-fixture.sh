#!/usr/bin/env bash
# Generates single-file test videos for the Custom URL feature (D16): the same synthetic test
# pattern + 440 Hz tone as the HLS fixture, as an MP4 (faststart) and an MKV, both H.264 Main with
# stereo AAC-LC (5.1 does not decode on VVD, friction F7). Serve them with tools/validate/static-cdn.mjs.
# Output is git-ignored.
#   scripts/make-progressive-fixture.sh [seconds]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/.devstack/cdn"
SECS="${1:-120}"

mkdir -p "$OUT"
ffmpeg -loglevel error -y \
  -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=$SECS" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=$SECS" \
  -c:v libx264 -profile:v main -preset veryfast -g 60 -pix_fmt yuv420p -b:v 2500k \
  -c:a aac -ac 2 -b:a 128k \
  -movflags +faststart "$OUT/fixture.mp4"
ffmpeg -loglevel error -y -i "$OUT/fixture.mp4" -c copy "$OUT/fixture.mkv"
ls -l "$OUT"/fixture.mp4 "$OUT"/fixture.mkv
