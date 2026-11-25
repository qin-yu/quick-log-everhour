// manifest.json carries the keys of both browsers so the repo folder loads unpacked in Chrome and Firefox.
// For a store upload, manifestFor() strips the other browser's keys so each store sees a clean manifest.
// CLI (used by scripts/package.sh): node scripts/manifest.js <chrome|firefox> <outfile>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BROWSERS = ['chrome', 'firefox'];

export function manifestFor(base, browser) {
  if (!BROWSERS.includes(browser)) throw new Error(`Unknown browser: ${browser}`);
  const m = structuredClone(base);
  if (browser === 'chrome') {
    delete m.background?.scripts;
    delete m.sidebar_action;
    delete m.browser_specific_settings;
  } else {
    delete m.background?.service_worker;
    delete m.side_panel;
    delete m.minimum_chrome_version;
    if (m.permissions) m.permissions = m.permissions.filter((p) => p !== 'sidePanel');
  }
  return m;
}

// Every file path the manifest points at; the store rejects an upload if any is missing.
export function referencedFiles(m) {
  return [...new Set([
    ...Object.values(m.icons ?? {}),
    ...Object.values(m.action?.default_icon ?? {}),
    m.background?.service_worker,
    ...(m.background?.scripts ?? []),
    m.side_panel?.default_path,
    m.sidebar_action?.default_panel,
    ...Object.values(m.sidebar_action?.default_icon ?? {}),
    ...(m.content_scripts ?? []).flatMap((c) => [...(c.js ?? []), ...(c.css ?? [])]),
  ].filter(Boolean))];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [browser, out] = process.argv.slice(2);
  if (!BROWSERS.includes(browser) || !out) {
    console.error('Usage: node scripts/manifest.js <chrome|firefox> <outfile>');
    process.exit(2);
  }
  const m = manifestFor(JSON.parse(readFileSync('manifest.json', 'utf8')), browser);
  const missing = referencedFiles(m).filter((p) => !existsSync(p));
  if (missing.length) {
    console.error(`Missing files referenced by the ${browser} manifest:`, missing.join(', '));
    process.exit(1);
  }
  writeFileSync(out, `${JSON.stringify(m, null, 2)}\n`);
}
