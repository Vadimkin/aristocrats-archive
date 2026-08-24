#!/bin/sh
# Regenerate the masthead backgrounds from the full-resolution source.
#
# The illustration carries film grain, which JPEG handles badly — WebP is
# roughly half the size at matching quality (2400w: 153 KB vs 317 KB), and the
# grain is what makes the native 3019w version cost 569 KB, so 2400w is the
# practical ceiling.
#
# Run from the repo root: sh scripts/build-header-image.sh
set -e
SRC=assets/studio-large.jpg
[ -f "$SRC" ] || { echo "missing $SRC"; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

sips -Z 1200 -s format png "$SRC" --out "$tmp/sm.png" >/dev/null
sips -Z 2400 -s format png "$SRC" --out "$tmp/lg.png" >/dev/null

cwebp -quiet -q 78 -m 6 "$tmp/sm.png" -o public/studio-header.webp
cwebp -quiet -q 72 -m 6 "$tmp/lg.png" -o public/studio-header-lg.webp

ls -la public/studio-header*.webp | awk '{printf "%6.0f KB  %s\n", $5/1024, $9}'
