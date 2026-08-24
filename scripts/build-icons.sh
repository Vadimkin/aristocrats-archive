#!/bin/sh
# Regenerate the favicon and home-screen icons from the square logo artwork.
#
# Two crops, because one image cannot serve both ends of the size range:
#
#   Home screen / manifest (180, 192, 512) keep the full illustration. At those
#   sizes the room and the cat are readable, and they are the brand — cropping
#   to the "A" would throw away what makes the icon recognisable.
#
#   Browser favicon (16, 32, 48) is a centre crop to the "A" mark. The full
#   scene at 16px is a smudge; the mark is centred in the artwork already, so a
#   square centre crop lands on it without any hand-placed offset.
#
# PNG rather than JPEG: apple-touch-icon is a PNG slot by Apple's docs, and the
# artwork is flat colour, which PNG stores in less space than the lock-screen
# photos in build-cover-image.sh.
#
# Run from the repo root: sh scripts/build-icons.sh
set -e
SRC=assets/cat-with-light-logo.jpg
[ -f "$SRC" ] || { echo "missing $SRC"; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Full artwork — home screen, PWA install, manifest.
for size in 180 192 512; do
  sips -Z $size -s format png "$SRC" --out "$tmp/full-$size.png" >/dev/null
done
cp "$tmp/full-180.png" public/apple-touch-icon.png
cp "$tmp/full-192.png" public/icon-192.png
cp "$tmp/full-512.png" public/icon-512.png

# Centre crop to the mark — the ring is ~555px across in a 1041px source, so a
# 600 crop fills the frame with it and leaves a hair of margin. Favicons are
# never corner-masked, so the mark can run this close to the edge.
sips -c 600 600 -s format png "$SRC" --out "$tmp/mark.png" >/dev/null
# 32 covers the 2x rendering of a 16px favicon slot; nothing asks for more.
for size in 16 32; do
  sips -Z $size -s format png "$tmp/mark.png" --out "public/favicon-$size.png" >/dev/null
done

ls -la public/apple-touch-icon.png public/icon-*.png public/favicon-*.png |
  awk '{printf "%6.0f KB  %s\n", $5/1024, $9}'
