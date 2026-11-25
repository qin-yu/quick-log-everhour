import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { manifestFor, referencedFiles } from '../scripts/manifest.js';

const base = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const root = new URL('../', import.meta.url);

test('the Chrome manifest keeps the side panel and drops every Firefox key', () => {
  const m = manifestFor(base, 'chrome');
  assert.equal(m.background.service_worker, 'src/background.js');
  assert.equal(m.background.scripts, undefined);
  assert.equal(m.sidebar_action, undefined);
  assert.equal(m.browser_specific_settings, undefined);
  assert.ok(m.side_panel.default_path);
  assert.ok(m.permissions.includes('sidePanel'));
  assert.ok(m.minimum_chrome_version);
});

test('the Firefox manifest keeps the sidebar and drops every Chrome key', () => {
  const m = manifestFor(base, 'firefox');
  assert.deepEqual(m.background.scripts, ['src/background.js']);
  assert.equal(m.background.service_worker, undefined);
  assert.equal(m.side_panel, undefined);
  assert.equal(m.minimum_chrome_version, undefined);
  assert.ok(!m.permissions.includes('sidePanel'));
  assert.ok(m.permissions.includes('storage'));
  assert.ok(m.sidebar_action.default_panel);
  assert.ok(m.browser_specific_settings.gecko.id);
  assert.ok(m.browser_specific_settings.gecko.data_collection_permissions);
});

test('both browsers load the same panel page and background script', () => {
  const chrome = manifestFor(base, 'chrome');
  const firefox = manifestFor(base, 'firefox');
  assert.equal(chrome.side_panel.default_path, firefox.sidebar_action.default_panel);
  assert.deepEqual([chrome.background.service_worker], firefox.background.scripts);
  assert.deepEqual(chrome.content_scripts, firefox.content_scripts);
});

test('every file either manifest references exists', () => {
  for (const browser of ['chrome', 'firefox']) {
    const missing = referencedFiles(manifestFor(base, browser)).filter((p) => !existsSync(new URL(p, root)));
    assert.deepEqual(missing, [], `${browser}: missing ${missing.join(', ')}`);
  }
});

test('manifestFor leaves its input alone and rejects unknown browsers', () => {
  const before = JSON.stringify(base);
  manifestFor(base, 'chrome');
  manifestFor(base, 'firefox');
  assert.equal(JSON.stringify(base), before);
  assert.throws(() => manifestFor(base, 'safari'), /Unknown browser/);
});
