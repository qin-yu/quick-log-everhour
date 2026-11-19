#!/bin/sh
# Build the Chrome Web Store upload: dist/quick-time-log-<version>.zip, holding only what the extension loads.
# Usage: npm run package   (or: sh scripts/package.sh)
set -eu
cd "$(dirname "$0")/.."

node --test tests/ >/dev/null || { echo 'Unit tests failed; not packaging.' >&2; exit 1; }

# Every path the manifest references must exist, or the store rejects the upload.
node --input-type=module -e "
import { readFileSync, existsSync } from 'node:fs';
const m = JSON.parse(readFileSync('manifest.json', 'utf8'));
const paths = [
  ...Object.values(m.icons ?? {}),
  ...Object.values(m.action?.default_icon ?? {}),
  m.background?.service_worker,
  m.side_panel?.default_path,
  ...(m.content_scripts ?? []).flatMap((c) => [...(c.js ?? []), ...(c.css ?? [])]),
].filter(Boolean);
const missing = paths.filter((p) => !existsSync(p));
if (missing.length) { console.error('Missing files referenced by manifest.json:', missing.join(', ')); process.exit(1); }
"

version=$(node -p "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8')).version")
out="dist/quick-time-log-$version.zip"
mkdir -p dist
rm -f "$out"
zip -q -X -r "$out" manifest.json icons/*.png src -x '*.DS_Store'
echo "$out"
unzip -l "$out" | tail -n +4 | sed '$d' | sed '$d' | awk '{print "  " $4}'
