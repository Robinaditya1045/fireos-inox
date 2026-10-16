#!/usr/bin/env bash
# Generates the mock backend's HLS fixture: a 60 s synthetic test pattern + 440 Hz tone (no licence
# needed), as a 3-rendition ladder close to Inox's transcoder output (MPEG-TS segments, H.264 Main,
# stereo AAC-LC — 5.1 does not decode on VVD, friction F7). Output is git-ignored.
#   scripts/make-hls-fixture.sh [seconds]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/tools/mock-inox/fixtures/hls/fixture"
SECS="${1:-60}"

rm -rf "$OUT" && mkdir -p "$OUT"
ffmpeg -loglevel error -y \
  -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=$SECS" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=$SECS" \
  -filter_complex "[0:v]split=3[a][b][c];[a]scale=1920:1080[v0];[b]scale=1280:720[v1];[c]scale=854:480[v2]" \
  -map "[v0]" -map "[v1]" -map "[v2]" -map 1:a -map 1:a -map 1:a \
  -c:v libx264 -profile:v main -preset veryfast -g 120 -keyint_min 120 -sc_threshold 0 -pix_fmt yuv420p \
  -b:v:0 5000k -b:v:1 2800k -b:v:2 1400k \
  -c:a aac -ac 2 -b:a 128k \
  -f hls -hls_time 4 -hls_playlist_type vod -hls_segment_type mpegts \
  -hls_segment_filename "$OUT/%v/seg_%03d.ts" \
  -master_pl_name master.m3u8 \
  -var_stream_map "v:0,a:0,name:1080p v:1,a:1,name:720p v:2,a:2,name:480p" \
  "$OUT/%v/index.m3u8"
echo "$OUT/master.m3u8"
