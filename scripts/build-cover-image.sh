#!/bin/sh
# Regenerate the lock-screen artwork from the square cover source.
#
# The OS media controls (iOS lock screen, Android notification, macOS Now
# Playing) want a square image, and the source already is one, so this only
# resizes. Three sizes so the platform can pick: 512 for a lock screen, 192 for
# a notification, 96 for the compact rows some launchers use.
#
# JPEG rather than WebP: this goes to the platform's media decoder rather than
# to a browser, and JPEG is the one format all of them accept.
#
# Run from the repo root: sh scripts/build-cover-image.sh
set -e
SRC=assets/cat-with-logo-dark.jpg
[ -f "$SRC" ] || { echo "missing $SRC"; exit 1; }

for size in 96 192 512; do
  sips -Z $size -s format jpeg -s formatOptions 80 \
    "$SRC" --out "public/cover-$size.jpg" >/dev/null
done

ls -la public/cover-*.jpg | awk '{printf "%6.0f KB  %s\n", $5/1024, $9}'
