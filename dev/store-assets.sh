#!/bin/sh
# Regenerate the Chrome Web Store images in store/:
#   screenshot-1.png, screenshot-2.png  1280x800, the panel on mock data (dev/store-shot.html at 2x)
#   promo-small-440x280.png             small promo tile (store/promo-small.svg)
# Needs Google Chrome and rsvg-convert. Usage: sh dev/store-assets.sh
set -eu
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PORT=8766

python3 dev/serve.py "$PORT" >/dev/null 2>&1 &
server=$!
profile=$(mktemp -d)
trap 'kill "$server" 2>/dev/null; rm -rf "$profile"' EXIT
curl -s -o /dev/null --retry 20 --retry-connrefused --retry-delay 1 "http://localhost:$PORT/manifest.json"

for n in 1 2; do
  "$CHROME" --headless --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check \
    --user-data-dir="$profile" --window-size=640,400 --force-device-scale-factor=2 --virtual-time-budget=5000 \
    --screenshot="$PWD/store/screenshot-$n.png" "http://localhost:$PORT/dev/store-shot.html?shot=$n" >/dev/null 2>&1
done
rsvg-convert -w 440 -h 280 store/promo-small.svg -o store/promo-small-440x280.png
sips -g pixelWidth -g pixelHeight store/*.png | paste - - -
