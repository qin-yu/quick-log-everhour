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
