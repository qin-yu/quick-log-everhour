# Devlog

Newest section at the bottom. Each section says what was done, why, what was found and what is still open.

## 2026-11-18 — Discovery and plan

**Found.** The team board's time tracking is the Everhour Trello Power-Up. I identified it without opening the board: Chrome's HTTP cache has entries keyed under `trello.com` for `app.everhour.com/trello-powerup/{root,card-back-section,add-time-dialog,edit-time-modal}.*` and for `app.everhour.com/api/trello/{time,time/<id>,time?cardId=<trelloCardId>,user,subscription,news}`. No time-tracking browser extension is installed, so the "Time" button and the Edit time dialog both come from the Power-Up.

**Found.** Everhour time record IDs in the cache increase monotonically in time order (5824468 … 5826700 over 17 Nov), so newest-entered means highest ID.

**Found.** Chrome is enrolled in Crick cloud management. The only local machine policy force-installs one security extension, and nothing I could see blocks Developer mode or unpacked extensions. The Chrome profiles are personal Google accounts.

**Decision.** Build a Chrome MV3 extension with a **Chrome side panel**: a week overview and recent entries, with edit and delete in the panel. The user chose both. The panel doesn't touch Everhour's own dialogs. It reuses the Power-Up's same-origin API from inside its iframe, because the Trello API isn't available on the Crick board and the data lives in Everhour anyway. Everhour's public API (`api.everhour.com`, `X-Api-Key`) is for full Everhour accounts; the Power-Up works without one.

**Open.** The exact request and response shapes and the auth mechanism of `/api/trello/*` are unknown. They need a look at live network traffic via Claude in Chrome (`/chrome`) on the test board, where Everhour still has to be added.

## 2026-11-18 — Repo scaffold

Ran `git init` on `main` and added `.gitignore`, `CLAUDE.md` (purpose, boards, architecture, constraints, run/test, conventions) and this devlog.

## 2026-11-18 — Time helpers (done before the API step)

Claude in Chrome isn't connected to this session yet, so the Everhour API discovery (planned step 2) is blocked. I moved ahead with the pure helpers, which don't depend on the API.

Added `src/lib/time.js` and `tests/time.test.js`, with 13 tests that pass under `node --test`.

- Dates are `YYYY-MM-DD` strings and the arithmetic is done in UTC, so DST changes can't shift a day.
- ISO week helpers: `weekStart`, `weekDays`, `isoWeek`, `weekLabel`. 2026 has 53 ISO weeks; this is tested.
- `parseDuration` accepts `1.5`, `1,5`, `1:30`, `90m`, `2h`, `1h30`, `1h 30m`. A bare number means hours, the result is rounded to whole minutes, and zero or negative input is rejected.
- `formatDuration` (`1h 30m`) is for entries and `formatHours` (`1.5`) is for table cells.
- `sortRecent` sorts by id descending.
- `weekMatrix` returns card × weekday seconds with row and day totals, rows sorted by total.

Added a minimal `package.json` with `"type": "module"` and an `npm test` script. Chrome ignores it, and there are still no dependencies and no build step.

## 2026-11-18 — Everhour API discovery

Claude in Chrome was connected (`claude --chrome --resume`). On the test board, Everhour's only resident frame is the hidden root `https://app.everhour.com/trello-powerup/?v=2`. Opening a card adds `card-back-section.59ce56d2.html`.

The browser tool's network log only shows top-frame requests, so it doesn't see Everhour's cross-origin iframe traffic. It did show Trello minting the Power-Up JWT: `POST /1/plugin/607eabc3361c748446d62490/jwt`. My first attempt to read the bundle inside the browser tripped the tool's privacy filter, and I didn't work around it. Instead, with the user's OK, I downloaded the four public bundles (build `59ce56d2`) with curl into the session scratchpad and read them there.

**Found** (full write-up in `docs/everhour-api.md`):

- Every call goes to `https://app.everhour.com/api` with header `x-jira-addon-token: <t.jwt()>`, no cookies. Board-wide lists use `t.jwt({state: JSON.stringify(boardIds)})` with `GET /trello/time` and no query; a single card uses `?cardId=`.
- Add is `POST /trello/time` `{memberId, cardId, date, time, comment}`. Edit is `PUT /trello/time/{id}` with one field per call. **Delete is a PUT with `{time: 0}`**; there is no DELETE.
- A record looks like `{id, cardId, boardId, memberId, date: 'YYYY-MM-DD', time: seconds, comment, createdAt, createdBy, isInvoiced, card: {time, timeByUser}}`.
- After every write Everhour mirrors per-card totals into Trello pluginData (`t.set(cardId, 'shared', state)`) and broadcasts `{type: 'data-changed', cardId}` on `BroadcastChannel('eh-' + secret6)`. Writes from the panel have to do the same, or badges go stale.
- The root frame loads `p.trellocdn.com/power-up.min.js` as a normal global script before Everhour calls `TrelloPowerUp.initialize`.
- Client-side, editing is disabled on a free subscription and limited to your own records unless you're a board admin.

**Decision: architecture change.** The plan was to capture auth headers from Everhour's own requests and replay them. Instead, the MAIN-world hook traps `window.TrelloPowerUp`, wraps `initialize`, and keeps the `t` that Trello hands to Everhour's `board-buttons` callback. With that one handle we can:

- mint a fresh JWT per request, so no token is stored and expiry isn't a problem;
- get card names with `t.cards()`, which also removes the planned trello.com content script;
- open cards with `t.showCard()`;
- keep pluginData in sync after writes.

Change detection wraps `fetch` in every Everhour frame and watches POST/PUT on `/api/trello/time`. Updated `CLAUDE.md` to match.

**Open (verify live):**

- whether list responses include `card` and `createdAt`;
- whether the server rejects edits on a free plan (the test board's subscription type is unknown);
- whether `t` from `board-buttons` keeps working for the life of the page.

## 2026-11-18 — Read-only side panel with auto-refresh

Plan steps 4 (read-only panel) and 5 (refresh on change) became one commit. The fetch hook that detects Everhour's writes is the same script that serves the panel's reads, so splitting them would have meant committing a half-wired hook.

**Built:**

- `manifest.json` with the side panel, `storage`, and two content scripts on Everhour's frames: `everhour-hook.js` (MAIN world) and `everhour-bridge.js` (isolated).
- The hook captures `t` in the root frame and serves these ops: `context`, `cards`, `listTime`, `openCard` and `updateTime`. `updateTime` is wired but has no UI yet. In every frame it reports successful POST/PUT to `/api/trello/time`.
- `src/lib/everhour.js`: `normaliseRecord`, `myRecords`, `editPatches` and `enteredAt`, with 5 tests. That makes 18 tests in total.
- The side panel:
  - week header with ‹ › and This week, plus ⟳;
  - total against target with a meter;
  - card × Mon–Sun table with today highlighted, where clicking a card opens it;
  - latest entries by id descending, with "entered HH:MM" from `createdAt`;
  - the week and target are saved in `chrome.storage.local`.
- On `time-changed` from the tab, the panel reloads after 400 ms and flashes the new record. It also reloads when it becomes visible again and when the active tab changes.

**Simplified compared with the plan:**

- No background relay. `chrome.tabs.sendMessage(tabId)` reaches every frame's bridge and only the root-frame bridge registers a listener, so the service worker is reduced to `setPanelBehavior`. This also avoids MV3 worker restarts losing a frame map.
- No 6-week window and no session-ID merge. `GET /trello/time` with the board as JWT state returns every record on the board, so "latest entered" is exact even for back-dated entries.
- No trello.com content script for card names, because `t.cards()` covers it.
- Debug aid: `src/sidepanel/index.html?tab=<id>` opened as a normal tab pins the panel to that Trello tab.

**Verified:** the user loaded the unpacked extension and the panel shows the week and latest entries on the test board.

**Feedback:** clicking a latest entry only opens its card on the page, which doesn't help fix a typo. Next step: edit and delete in place.

## 2026-11-18 — Edit and delete in the panel

**Built** (`src/sidepanel/panel.js` and `panel.css`):

- Clicking a latest entry (or its ✎) opens an inline editor with time, date and comment. Time accepts `1.5`, `1:30`, `90m` or `1h 30m`, up to 24 h. Enter saves, Esc cancels, and "Open card ↗" moved into the editor.
- 🗑 opens an inline confirm. No `window.confirm`, because a modal dialog would block the panel.
- Only the changed fields are sent, one PUT each via `editPatches`, with time last, then the panel reloads. The hook then mirrors `applyReportedTime`, so badges stay in step.
- After every save or delete the status line offers **Undo**, which applies `editPatches(after, before)`. Because Everhour deletes by setting time to 0, the record survives and a delete can be undone with a PUT of the old time.
- While an editor is open, background refreshes leave the list alone so typing isn't wiped. The week table still updates.
- Status messages now come in three kinds: `info` is cleared by the next load, `error`, and `note` stays up to 20 s and can be dismissed.

**Checked against Everhour's bundles:** for single-record GET and PUT, Everhour calls `t.jwt()` with no state, and every PUT returns the full record including `card` totals. The hook now calls `t.jwt()` the same way.

**Testing limit:** the browser tool refuses `chrome-extension://` URLs, so the `?tab=` debug page can't be driven from here. Write-path verification on the test board is done by the user.

The user asked to commit this step; no failures were reported. Point-by-point test results (Undo and badge sync) are still pending. Next: add new entries from the panel.

## 2026-11-18 — Mock harness for the panel UI

The browser tool refuses `chrome-extension://` URLs, so the real panel can't be clicked through from here. `dev/serve.py` serves the repo on localhost and injects `dev/mock-chrome.js` into the panel page. That file is a fake `chrome.*` with made-up cards, lists and records, implementing the same ops as the hook. `window.__mock.calls` records what the panel sent and `window.__mock.fail` forces an op to fail.

What it covers: rendering, forms, validation, focus, Undo and the exact ops and patches the panel sends. What it doesn't cover: the hook, the bridge and Everhour itself, which still need a run on the test board.

## 2026-11-18 — Log new time from the panel

User request: add new entries straight from the panel.

**Built:**

- A form at the top of the panel with card, date, time, a **Log** button and an optional comment. Enter submits. After logging, the card stays selected, time and comment clear and focus returns to time, so several entries can be typed in a row. The status line offers **Undo**, which sets time to 0 like a delete.
- The card picker starts with "Recently used" (my last 8 distinct open cards by entry id), then every open card grouped by Trello list in board order (`cardChoices`, tested). Archived cards are left out. The `<select>` is rebuilt only when the card list changes, so background refreshes don't close it or reset it.
- Date defaults to today when viewing this week, otherwise to the Monday of the week on screen. Logging into another week moves the panel to that week.
- Clicking a cell in the week table fills the form with that card and day and focuses time. That's the quickest way to back-fill a day.
- Hook op `addTime({cardId, date, time, comment})`:
  - validates its input and checks the card is an open card on this board;
  - POSTs `{memberId, cardId, date, time, comment}` with `memberId` from `t.getContext()`, exactly as Everhour's Add time does;
  - then mirrors `applyReportedTime`.
- The `cards` op now adds `listName` and `listPos` from `t.lists()`. If that call fails, the cards still load, just ungrouped.

**Bug found with the harness:** `replaceChildren` doesn't flatten arrays, so the per-list option groups were missing and a stray text node could appear. Fixed by spreading the arrays.

**Verified in the harness:**

- logging an entry (`1:15` became `time: 4500`), with the table and latest entries updating and focus returning to time;
- Undo of a log;
- cell prefill, including no prefill for archived cards;
- editing sends only `{time}`;
- a failed delete shows the error, keeps the confirm open and re-enables the buttons;
- delete followed by Undo.

**Open:** a real run on the test board of add, edit, delete and Undo, checking that Everhour's badge and Edit time agree.

## 2026-11-18 — Stale page scripts after an update

The user's first try at logging returned `Unknown request addTime`. The panel page is read fresh from disk, but the hook and bridge in the Trello page are the copies Chrome injected when the tab loaded. A newer panel was talking to an older hook. Fix for the user: ↻ on trello-fast in `chrome://extensions`, then reload the Trello tab. Re-injecting from the service worker wouldn't help: the hook has to trap `TrelloPowerUp` at `document_start`, before Everhour initialises, so only a tab reload gets a working hook.

The panel now turns any `Unknown request …` from the hook into that instruction, so future version mismatches explain themselves.

## 2026-11-19 — Chrome Web Store release prep

The user chose route 2: publish to the Chrome Web Store as **Unlisted** for the team. Replacing Everhour with our own Power-Up was discussed and parked. It would need a backend, because pluginData caps at 4096 characters per card, and the whole team would have to switch.

**Step 1 — remove debug hooks.** Removed the `?tab=` pin and `globalThis.trelloFast` from the panel. The browser tool can't open `chrome-extension://` pages, so the pin never helped. UI work goes through `dev/serve.py` instead.

**Step 2 — name and icons.**

- The store name is **Quick Time Log & Edit for Everhour on Trello**, 44 of 75 characters, chosen by the user. Brands come last in the "… for X" form, so it doesn't read as an official Trello or Everhour product. `short_name` is "Quick Time Log", and the toolbar tooltip is "Quick Time Log & Edit".
- The manifest description doubles as the store summary, 113 of 132 characters.
- The icon is a white clock with speed lines on an indigo tile, kept away from Trello blue. It's drawn in `icons/icon.svg` with Chrome's 16 px transparent margin. The toolbar sizes come from a full-bleed, clock-only `icons/icon-small.svg` so they stay legible at 16 px. Rendered with `rsvg-convert`.

**Step 3 — packaging.** Added `scripts/package.sh`, run as `npm run package`. It refuses to build if the unit tests fail or if any path in the manifest is missing. Otherwise it writes `dist/quick-time-log-<version>.zip` with the 13 files the extension loads, leaving out dev, tests, docs and the SVG sources. `dist/` is gitignored. Added a Release section to CLAUDE.md.

**Narrow-panel fix (found while making screenshots).** At about 340 px, which is close to the side panel's default width, the week label was truncated to "16–22 Nov 2026 · W…" and the Total row ran together ("6 4.53.5"). `weekLabel(monday, currentYear)` now drops the year when the whole week lies in the current year (tested), and the full label moved to the tooltip. Below 380 px the table gets a 30 % card column, 12 px digits and tighter padding.

**Step 4 — listing material.**

- `README.md` covers what the panel does, how to install and use it, how it works, its limits and how to develop it.
- `PRIVACY.md` matches the code. There is no server and no analytics. Data goes only to Everhour, and to Trello through the Power-Up library. Only the viewed week and the target are stored locally, and tokens are created per request and never stored.
- `docs/store-listing.md` has copy for every dashboard field.
  - Category: Workflow & Planning.
  - Single purpose and a justification for each permission and content script.
  - Remote code: none.
  - Data use is declared generously: personal info, auth tokens, user activity (the hook watches Everhour's own saves) and website content. Over-declaring costs nothing in review, and under-declaring can get the listing taken down.
- Store images: two 1280×800 screenshots and a 440×280 promo tile, regenerated by `dev/store-assets.sh`. Headless Chrome renders `dev/store-shot.html`, which frames the mock panel next to a caption, at 640×400 and 2x.
- The mock data now uses made-up card names, because the real ones came from the user's timesheet. Mock dates are now relative to the current week, so the panel never looks empty.

**Still to do (user):**

- the end-to-end run on the test board;
- registering the developer account (one-time fee, 2-step verification);
- hosting PRIVACY.md at a public URL;
- uploading `dist/quick-time-log-0.1.0.zip` as Unlisted.

**Icon v2 — spinning hand.**

- The user asked for an icon based on Everhour's, with its hour hand spinning fast. I kept the idea but not Everhour's logo: a modified third-party logo on a store listing invites an impersonation rejection or a takedown, and it would undo the deliberately non-official name.
- The new mark is a clock whose hand at 2 o'clock leaves a motion blur and three fading ghost hands, so the speed reads at 48 px and the clock at 16 px. The old speed lines are gone.
- My first versions laid wedges side by side, which left visible seams with alpha, and read as a speedometer. The fix stacks wedges that all start at the hand and reach back different distances.
- `icons/build.py` now generates all the artwork, including the promo tile. Store images were regenerated.

## 2026-11-19 — Test-board run, and Undo moved to a toast

**User test on the test board:** log, edit and delete all work against the real Everhour. This is the first live confirmation of the write path. **But they couldn't find Undo.** It lived in the status line at the top of the panel, which isn't sticky. When you edit an entry further down the list, that line is scrolled out of view, and it vanished after 20 s.

**Fix:**

- The outcome of a write is now a toast fixed at the bottom of the panel: "Saved: card, 45m on Mon 16 Nov. Undo ✕". It stays 30 s with Undo, or 6 s without.
- ⌘Z or Ctrl+Z triggers the same Undo. It's ignored while the focus is in a field with text, so that field's own text undo still works. It does fire in an empty field, so ⌘Z right after Log (when focus is back in the empty time field) undoes the log.
- The top status line now carries only loading messages and load errors.
- `main` got bottom padding so the toast can't hide the last entry.

Checked in the harness: the toast stays in view after scrolling down and editing, ⌘Z restores the old time, ⌘Z in a field with text is left alone, and ⌘Z after Log removes the logged entry.

## 2026-11-19 — Redo, and undo as a real history

The user asked for ⇧⌘Z redo. Single-level undo plus redo would have surprised anyone who presses ⌘Z twice, so undo became a proper history.

- New `src/lib/history.js`, with 4 tests (23 in total).
  - A step is `{id, before, after}` snapshots of one record's date, comment and seconds. A log goes from 0 s and a delete goes to 0 s, so every step replays in either direction as plain PUTs; Everhour keeps time-0 records.
  - `History.move(direction, apply)` pops a step, applies it and pushes it onto the other stack. A new change clears redo, and the stack keeps the last 50 steps.
  - If applying fails, the step stays put so it can be retried, unless the error is marked `permanent`.
- **Optimistic concurrency check.** Every undo or redo sends `expect` (the record's state before the replay). The hook's `updateTime` refuses with "changed somewhere else" if the record no longer matches, so an undo can never overwrite an edit made in Everhour's own dialogs in the meantime. That refusal marks the step permanent and drops it. The mock implements the same check.
- Keys: ⌘Z / Ctrl+Z undoes; ⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y redoes. As before, they're ignored in a field with text. The toast shows Undo and/or Redo while there is something to do, and the shortcuts keep working after it hides. The history is cleared when the panel switches tab or board.
- Verified in the harness with real key presses: log, edit and delete, then three undos (board total 17 → 17.5 → 20 → 19), "Nothing to undo", two redos (→ 20 → 17.5), a new edit clearing redo, and an undo refused after the record changed behind the panel.
- The hook changed, so the user needs ↻ in `chrome://extensions` plus a Trello tab reload. An old hook ignores `expect`, so undo still works with it, just without the check.
- The user reloaded the extension and checked undo and redo on the test board against the real Everhour: it works.

## 2026-11-19 — Real board, quick look

The user opened the panel on the real board and gave it a quick look. Nothing looked wrong, but they did not compare it cell by cell with Everhour's Time report. If numbers ever look off on the real board, that comparison is the first thing to do.

## 2026-11-19 — Renamed to quick-log-everhour, history cleaned before going public

The repo is going public on GitHub, so that the privacy policy has a public address. The user picked the name quick-log-everhour. The page-script event names keep the old `trello-fast:` prefix, because users never see them.

- The panel's stale-tab message used to say "click ↻ on trello-fast in chrome://extensions". The extension isn't called that any more, and store installs have no ↻ button, so it now just says to reload the Trello tab.
- The history was rewritten once, before the first push, with `git filter-branch`:
  - Every commit got the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. CLAUDE.md now asks for it on every new commit.
  - Author and committer dates are exactly as before. The user commits with `gitpast`, which sets both. Names and emails are also unchanged. All 20 commits were compared one by one.
  - The two board links are gone from CLAUDE.md in every commit. They now live in `CLAUDE.local.md`, which is gitignored.
  - The first mock data and one unit test used real card names from the team board. Every commit now has made-up names instead.
  - `icons/__pycache__/` is gone from every commit and is gitignored.
- Checked after the rewrite: the tests pass at every commit, and no commit contains a board ID, a real card name or a `.pyc` file.
- A bundle of the history from before the rewrite is in the session scratchpad. That folder is temporary, so the bundle isn't a lasting backup.

Still open: choose where the repo lives (the user's own account or the Crick org), create it, push, and put PRIVACY.md's public URL into `docs/store-listing.md`.

## 2026-11-19 — Public on GitHub

The repo is public at <https://github.com/qin-yu/quick-log-everhour> under the user's own account, with the rewritten history. The privacy policy URL for the store is <https://github.com/qin-yu/quick-log-everhour/blob/main/PRIVACY.md>, and it opens without signing in. `docs/store-listing.md` now has that URL.

Still open: register the Chrome Web Store developer account, upload `dist/quick-time-log-0.1.0.zip` as Unlisted, and share the link with the team.

## 2026-11-19 — Submitted as Public

While filling in the Chrome Web Store dashboard, the user chose **Public** visibility instead of the planned Unlisted. Anyone can now find the listing in the store. README, CLAUDE.md and `docs/store-listing.md` were updated to match. The listing notes also gained the homepage and support URLs (the GitHub repo and its issues) and test instructions for the reviewer.

What changes in practice: people outside the team will install it, so support will come through GitHub issues and store reviews. If an Everhour update breaks the extension, strangers will notice too.

## 2026-11-19 — Submitted for review

Version 0.1.0 was submitted to the Chrome Web Store as a Public item with ID `aiecjmnlmjibieahllgholncfkplddhm`. The store gave a 500-character limit for the reviewer's test instructions, so they were shortened to fit.

Next steps:

- Wait for the review result, which arrives by email to the developer account.
- If the item is rejected, fix whatever the reason names, bump the version and upload again.
- Once it is live, uninstall or turn off the unpacked copy. Two copies would put two bridges in the same Everhour frames.

## 2026-11-24 — MIT licence

The user decided to keep the repo on their own GitHub account rather than move it to the Crick org, and to license it under MIT so that anyone, colleagues included, can use it and contribute. Added `LICENSE` with the copyright held by Qin Yu, a License section in the README and `"license": "MIT"` in `package.json`.

The store package is unchanged, because `scripts/package.sh` ships only `manifest.json`, `icons/*.png` and `src/`.

## 2026-11-25 — Firefox support

**Why.** The user wants the extension in Firefox as well as Chrome, under the same rule: no build step and no dependencies, and the repo folder loads unpacked as is.

**Found.** The extension's core already runs in Firefox; only its shell is Chrome-specific.

- Firefox has supported promises on the `chrome.*` namespace in MV3 since version 106, so `panel.js` and the bridge need no polyfill.
- Firefox has supported `world: "MAIN"` for manifest content scripts since 128.
- The bridge and hook already pass `CustomEvent` details as JSON strings. Firefox's Xray wrappers would block page code from reading an object created in the isolated world, so strings are the form that works there.
- The panel binds to its window's active tab. That matches Firefox's sidebar, which is one per window, the same as Chrome's global side panel.

The parts that differ are the panel (`side_panel` in Chrome, `sidebar_action` in Firefox), the background script (a service worker in Chrome, `background.scripts` in Firefox) and Firefox's `browser_specific_settings.gecko`.

**Done.**

- **`manifest.json`** now has both browsers' keys. Chrome 121+ ignores `background.scripts`, and Firefox 121+ ignores `background.service_worker`.
  - The gecko ID is `quick-log-everhour@qin-yu.github.io`.
  - `strict_min_version` is 140. MAIN-world content scripts need 128. Firefox 127 and older reject `data_collection_permissions`. Firefox's built-in data consent needs 140, which is also the current ESR.
  - `data_collection_permissions` mirrors the Chrome Web Store's data-usage answers.
- **`src/background.js`** picks the side panel when `chrome.sidePanel` exists; otherwise `action.onClicked` calls `browser.sidebarAction.toggle()`. Firefox only opens a sidebar from a user action, so the call is synchronous in the click handler.
- **`scripts/manifest.js`** has two pure functions, both with unit tests:
  - `manifestFor(base, browser)` strips the other browser's keys, and for Firefox also `minimum_chrome_version` and the `sidePanel` permission.
  - `referencedFiles` replaces the inline path check that used to be in `package.sh`.
- **`npm run package`** now stages `dist/chrome/` and `dist/firefox/` and writes `dist/quick-time-log-<version>-chrome.zip` and `-firefox.zip`.
- **Panel.** `tab.url` is only visible on sites the extension may access, so it is also missing on any non-Trello tab. The panel now asks `chrome.permissions.contains` for trello.com and, when access was withheld, says how to turn it back on instead of asking for a board. "Everhour is not loaded" now also mentions access to app.everhour.com.
  - The mock grew `permissions.contains` and a `__mock.noAccess` flag.
  - Checked in the mock: the hint shows when access is withheld and clears when access is restored.
- **Docs.** README, PRIVACY.md and `docs/store-listing.md` now cover Firefox; the store listing has a new Firefox Add-ons section.

**Checked.**

- `npx web-ext lint` (10.8.0) on `dist/firefox` gives 0 errors and 2 warnings, both expected:
  - Android's minimum version: we don't target Android, which has no sidebar.
  - `sidePanel.setPanelBehavior`: the call is behind the feature check.
- Linting the repo folder adds the two dev-only warnings, `sidePanel` and `service_worker`.
- 28 unit tests pass.

**Open.**

- Not yet run in Firefox against Trello. Whether the MAIN-world hook traps `window.TrelloPowerUp` at `document_start` before the Power-Up's own script runs can only be seen on the test board. If it does, the week table loads.
  - The full end-to-end check also has to be done in Firefox: log, edit, delete, undo and redo, auto-refresh after Everhour's own Add time, card badges and switching tabs.
  - After that, a read-only check on the real board in Firefox.
- Chrome regression check of the unpacked folder and of `dist/chrome/`.
- Before the first AMO upload, decide whether `data_collection_permissions` should stay as the four categories or become `["none"]`. It depends on whether Mozilla counts data that goes only to Everhour as collection. See `docs/store-listing.md`.

## 2026-11-26 — Firefox checked, ready for AMO

**Checked.** The user loaded the repo folder as a temporary add-on in Firefox 161 and confirmed that the extension works on the test board. So in Firefox the MAIN-world hook captures `t` at `document_start` too, which was the one risk the docs couldn't settle.

**Decided.** `data_collection_permissions` keeps its four required categories (`personallyIdentifyingInfo`, `authenticationInfo`, `websiteActivity` and `websiteContent`). Mozilla's add-on policy treats any data "handled outside of the add-on" as transmission. It has no exemption for data sent to the service the user is working in, and `"none"` is only for add-ons that send nothing. So Firefox asks users to accept these categories at install.

**Done.** `docs/store-listing.md` now has ready-to-paste blocks for the AMO description and for the reviewer notes. The reviewer notes explain why the hook runs in the MAIN world. There is also a short note on how AMO signs and reviews.

**Open.**

- Submit to AMO (the user does this in the Developer Hub).
- Once the listing is live, update the README's Firefox install section and the Release section of `CLAUDE.md` with the AMO link.
- Mozilla has previews of a new Add-on Policies and Distribution Agreement dated 1 December 2026. Skim them for anything that affects this add-on.

## 2026-11-26 — Submitted to AMO

The user submitted `dist/quick-time-log-0.1.0-firefox.zip` to addons.mozilla.org as a listed add-on, using the text in `docs/store-listing.md`. The slug is `quick-time-log-everhour-trello`, not the `quick-time-log-everhour` the notes had suggested, and the notes now use it.

- **Source code question:** answered No. The package holds the hand-written files as they are. The only processing is `scripts/manifest.js` removing the Chrome keys from `manifest.json`, which leaves a readable JSON file.
- **Notes to reviewer:** the paste-ready block, which explains why the hook runs in the MAIN world.

Right after submission, AMO's public API still returned 401 for the slug, because the add-on isn't public until it is signed. The `firefox` branch was merged into `main` and pushed, so the repo the listing links to now covers Firefox.

**Open.**

- Wait for the signing email.
- Once the add-on is live, install it from AMO and remove the temporary copy. Then replace the "not on Firefox Add-ons yet" line in the README with the link, and mark the listing live in `CLAUDE.md`.
