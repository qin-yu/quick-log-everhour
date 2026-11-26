# quick-log-everhour

Published as **Quick Time Log & Edit for Everhour on Trello**; the repo is quick-log-everhour. The project started as trello-fast, and the page-script events (`trello-fast:req`, `trello-fast:res`, `trello-fast:changed`) still carry that name. A browser extension (Manifest V3) for Chrome and Firefox that adds a side panel (in Firefox, a sidebar) to Trello for faster time logging with the **Everhour Trello Power-Up**, which is what the team board uses for time tracking.

## Why it exists

Two pain points with Everhour's own UI inside Trello:

1. Everhour's "Time" report doesn't update after you add time. After a page reload you have to click Time, filter to yourself and page back to the week you were looking at.
2. When you mistype an entry it is hard to find again. Edit time needs a member filter and a date range before the entry shows up.

The side panel shows **my week** (cards × Mon–Sun, totals against a 35 h target) and **my most recently entered records**, newest first. Each record can be edited or deleted in place, with Undo. New time is logged from a form at the top, and clicking a cell in the week table prefills its card and day. The panel stays on the chosen week and refreshes by itself whenever Everhour writes time.

## Boards

- Real board: the team's board on the Crick's Trello. The Trello REST API is not available for it.
- Test board: a personal board with the Everhour Power-Up added. **Every write path (edit, delete) is verified here before it touches the real board.**
- Links to both boards are in `CLAUDE.local.md`, which is kept out of git.

## Architecture

Time data lives in Everhour, not Trello, so the Trello API isn't needed. Everhour's Power-Up runs in `app.everhour.com` iframes inside trello.com. Its hidden root frame (`/trello-powerup/?v=2`) is always loaded on a board page. The extension's MAIN-world hook in that frame captures the Power-Up client handle `t` that Trello passes to Everhour, then uses it the way Everhour itself does: `t.jwt()` for the `x-jira-addon-token` header, `t.cards()` for card names, `t.set()` to keep card totals in sync, and `t.showCard()` to open a card. No API key is involved and no token is stored.

```
side panel ──chrome.tabs.sendMessage(tabId)──► everhour-bridge (every Everhour frame; only the root frame answers)
     ▲                                               │ DOM CustomEvents (JSON strings)
     │                                               ▼
     │                         everhour-hook (root frame, MAIN): t.jwt() + fetch /api/trello/*
     └── runtime "time-changed" ◄── bridge ◄── everhour-hook (MAIN, every Everhour frame): wraps fetch, sees POST/PUT /api/trello/time
```

- `manifest.json` declares MV3, `storage` and two content scripts on `https://app.everhour.com/trello-powerup/*` with `all_frames` and `document_start`: the hook (MAIN world) and the bridge (isolated). It carries both browsers' keys so the folder loads unpacked in either: `side_panel`, the `sidePanel` permission and `background.service_worker` for Chrome; `sidebar_action`, `background.scripts` and `browser_specific_settings.gecko` (ID, `strict_min_version` 140, `data_collection_permissions`) for Firefox. `scripts/manifest.js` strips the other browser's keys for each store zip.
- `src/background.js` only makes the action icon open the panel: `sidePanel.setPanelBehavior` in Chrome, `sidebarAction.toggle()` in Firefox, picked by whether `chrome.sidePanel` exists. Nothing is relayed through the background script: the panel messages the tab directly and the bridges message the panel directly.
- `src/content/everhour-hook.js` runs in the MAIN world:
  - in every Everhour frame it wraps `fetch` and reports successful POST/PUT to `/api/trello/time`;
  - in the root frame it traps `window.TrelloPowerUp` to capture `t` and serves the bridge's requests: `context`, `cards` (with list names), `listTime`, `openCard`, `addTime` and `updateTime`. The write ops check that the card or record belongs to the signed-in member on this board. `updateTime` also takes an optional `expect` and refuses to write if the record no longer matches it.
- `src/content/everhour-bridge.js` runs in the isolated world. It relays between `chrome.runtime` and the hook via DOM `CustomEvent`s with JSON-string details. Keep the details strings: Firefox's Xray wrappers stop page code from reading objects created in the isolated world.
- `src/lib/everhour.js` normalises records to `{id, date, seconds, comment, memberId, cardId, createdAt}`, turns an edit into per-field PUTs (`editPatches`) and orders the card picker (`cardChoices`).
- `src/lib/history.js` holds the panel's undo and redo stacks. A step is one record's before and after snapshot, a log goes from 0 s and a delete goes to 0 s, so every step replays either way as plain PUTs. Each replay sends `expect`, and the hook refuses it if the record was changed elsewhere since.
- `src/lib/time.js` holds pure helpers: ISO weeks (Mon–Sun), duration parsing (`1.5`, `1:30`, `90m`) and the card × weekday matrix.
- `src/sidepanel/` holds the panel UI, the same page in both browsers. It calls `chrome.*` with promises, which Firefox also supports in MV3, so there is no polyfill.
- `icons/` holds the PNGs the manifest uses. `python3 icons/build.py` is the source of the artwork: a clock whose hand is spinning fast, shown as a motion blur plus ghost hands. It writes `icon.svg` (48 and 128 px, with Chrome's 16 px margin), `icon-small.svg` (16 and 32 px, full bleed) and `store/promo-small.svg`, then renders the PNGs with `rsvg-convert`. The artwork is our own, never a modified Everhour or Trello logo, because the listing must not look official.

Everhour record IDs increase monotonically, so "most recently entered" means sorting by `id` descending. Records also carry `createdAt`. Delete is `PUT /trello/time/{id}` with `{time: 0}`, because Everhour has no DELETE.

Everhour's endpoint details are in [docs/everhour-api.md](docs/everhour-api.md).

## Constraints

- Never use the Trello REST API, and never modify Everhour's own DOM. All UI lives in the side panel.
- Writes go only through explicit user actions in the panel (log, save, confirmed delete or undo), using the same requests Everhour itself sends.
- JWTs are minted per request with `t.jwt()` and never stored, logged or sent anywhere except `app.everhour.com/api`.
- After any write, mirror Everhour's `applyReportedTime`: update the card's `shared` pluginData and broadcast `data-changed` on `BroadcastChannel('eh-' + t.secret.slice(0, 6))`. See `docs/everhour-api.md`.
- Plain JavaScript ES modules with no build step and no dependencies, so the folder loads as an unpacked extension in Chrome and Firefox.

## Run and test

- Install in Chrome: open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick this folder. Open a Trello board that has Everhour, then click the extension icon to open the panel. Loading the folder unpacked needs Chrome 121+, because older versions reject `background.scripts`; the store zip leaves it out.
- Install in Firefox: open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and pick `manifest.json`, or run `npx web-ext run --start-url <test board>`. Click the toolbar icon (in the Extensions menu until pinned) to toggle the sidebar.
- Unit tests: `node --test tests/` (or `npm test`). These cover the pure helpers in `src/lib/` and the per-browser manifest split in `scripts/manifest.js`. `package.json` exists only to mark the folder as ES modules for Node; there are no dependencies.
- Panel UI without the extension: `python3 dev/serve.py`, then open <http://localhost:8765/src/sidepanel/index.html>. It injects `dev/mock-chrome.js`, a fake `chrome.*` with made-up cards and records; `window.__mock.calls` lists every op the panel sent, `window.__mock.fail = '<op>'` makes that op fail and `window.__mock.noAccess = true` acts as if trello.com access were withheld. Browser automation can't open `chrome-extension://` pages, so this is how the panel gets driven.
- End to end: add time on the test board via Everhour. The panel should update without a reload. Edit and delete the record from the panel, then check Everhour's Edit time view. Do this in both browsers.

## Release

- Distributed through the Chrome Web Store as **Public**: anyone can find and install it. Strangers will use it too, so an Everhour change that breaks it shows up as store reviews and GitHub issues, not just team messages.
- Firefox: submitted to addons.mozilla.org as listed on 2026-11-26, slug `quick-time-log-everhour-trello`, waiting for signing and publication. The gecko ID `quick-log-everhour@qin-yu.github.io` must never change once uploaded.
- Bump `version` in `manifest.json`, then run `npm run package`. It runs the unit tests, then for each browser writes that browser's manifest (checking that every file it references exists) and `dist/quick-time-log-<version>-<chrome|firefox>.zip` containing only `manifest.json`, `icons/*.png` and `src/`. Upload each zip to its store. `npx web-ext lint --source-dir dist/firefox` must report 0 errors.
- Before uploading, run the end-to-end check on the test board in both browsers, and after any change to the hook, a read-only check on the real board in both.
- [docs/store-listing.md](docs/store-listing.md) has the text for every field in both stores' dashboards: description, permission justifications and data-use answers. Keep it in step with what the code does, and keep [PRIVACY.md](PRIVACY.md) in step too.
- Store images live in `store/` and are regenerated with `sh dev/store-assets.sh`. It runs headless Chrome over `dev/store-shot.html` at 2x for the 1280×800 screenshots and `rsvg-convert` for the promo tile. The mock data in `dev/mock-chrome.js` must stay made-up, never real card names, because the listing is public to anyone with the link.

## Conventions

- Conventional Commits, one commit per semantically separate step. Every commit ends with a `Co-Authored-By: Claude <model> <noreply@anthropic.com>` trailer naming the model that did the work, e.g. `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. When rewriting history, keep each commit's author and committer dates exactly as they are (the user commits with `gitpast`, which sets both).
- After each step, append a section to [docs/devlog.md](docs/devlog.md) covering what was done, why, what was found and what is still open. Keep this file up to date when the architecture changes.
- Markdown: one line per paragraph, never hard-wrapped.
