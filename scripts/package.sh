#!/bin/sh
# Build the store uploads, each holding only what the extension loads:
#   dist/quick-time-log-<version>-chrome.zip   for the Chrome Web Store
#   dist/quick-time-log-<version>-firefox.zip  for addons.mozilla.org
# manifest.json has both browsers' keys; scripts/manifest.js strips the other browser's keys for each zip.
# The unpacked copies stay in dist/<browser>/ (e.g. for: npx web-ext lint --source-dir dist/firefox).
# Usage: npm run package   (or: sh scripts/package.sh)
set -eu
cd "$(dirname "$0")/.."

node --test tests/ >/dev/null || { echo 'Unit tests failed; not packaging.' >&2; exit 1; }

version=$(node -p "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8')).version")
mkdir -p dist
for browser in chrome firefox; do
  stage="dist/$browser"
  out="dist/quick-time-log-$version-$browser.zip"
  rm -rf "$stage" "$out"
  mkdir -p "$stage/icons"
  node scripts/manifest.js "$browser" "$stage/manifest.json"
  cp icons/*.png "$stage/icons/"
  cp -R src "$stage/src"
  (cd "$stage" && zip -q -X -r "../$(basename "$out")" manifest.json icons src -x '*.DS_Store')
  echo "$out"
  unzip -l "$out" | tail -n +4 | sed '$d' | sed '$d' | awk '{print "  " $4}'
done
