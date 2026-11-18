# trello-fast

A Chrome extension (Manifest V3) that adds a side panel to Trello for faster time logging with the **Everhour Trello Power-Up**, which is what the team board uses for time tracking.

## Why it exists

Two pain points with Everhour's own UI inside Trello:

1. Everhour's "Time" report doesn't update after you add time. After a page reload you have to click Time, filter to yourself and page back to the week you were looking at.
2. When you mistype an entry it is hard to find again. Edit time needs a member filter and a date range before the entry shows up.

The side panel shows **my week** (cards × Mon–Sun, totals against a 35 h target) and **my most recently entered records**, newest first. Each record can be edited or deleted in place. The panel stays on the chosen week and refreshes by itself whenever Everhour writes time.

## Boards

- Real board: the team's board on the Crick's Trello. The Trello REST API is not available for it.
- Test board: a personal board with the Everhour Power-Up added. **Every write path (edit, delete) is verified here before it touches the real board.**
- Links to both boards are in `CLAUDE.local.md`, which is kept out of git.

## Architecture

Time data lives in Everhour, not Trello, so the Trello API isn't needed. Everhour's Power-Up UI runs in `app.everhour.com` iframes inside trello.com. The extension injects scripts into those iframes and calls Everhour's own `/api/trello/*` endpoints same-origin, reusing the Power-Up's existing auth. No API key is involved.

```
side panel ──runtime msg──► background (service worker) ──tabs.sendMessage(frameId)──► everhour-bridge (Everhour iframe)
     ▲                                                                                     │ same-origin fetch /api/trello/*
     └──────────── "time-changed" broadcast ◄── everhour-hook (MAIN world, every Everhour iframe) sees POST/PUT/DELETE
```

- `manifest.json` declares MV3, `sidePanel`, `storage` and content scripts on `https://app.everhour.com/trello-powerup/*` with `all_frames`.
- `src/background.js` opens the side panel from the action icon, tracks which frame hosts the bridge in each tab, and relays messages.
- `src/content/everhour-hook.js` runs in the MAIN world. It wraps `fetch`/XHR, captures the auth headers the Power-Up sends, and reports successful writes to time.
- `src/content/everhour-bridge.js` runs in the isolated world. It executes the panel's requests (`me`, `listTime`, `updateTime`, `deleteTime`) and forwards `time-changed`.
- `src/lib/everhour.js` builds requests and normalises records to `{id, date, seconds, comment, userId, cardId, cardName}`.
- `src/lib/time.js` holds pure helpers: ISO weeks (Mon–Sun), duration parsing (`1.5`, `1:30`, `90m`) and the card × weekday matrix.
- `src/sidepanel/` holds the panel UI.

Everhour record IDs increase monotonically, so "most recently entered" means sorting by `id` descending.

Everhour's endpoint details are in [docs/everhour-api.md](docs/everhour-api.md).

## Constraints

- Never use the Trello REST API, and never modify Everhour's own DOM. All UI lives in the side panel.
- Writes go only through explicit user actions in the panel (save or confirmed delete), using the same requests Everhour itself sends.
- Captured auth headers stay in memory or `chrome.storage.session`. Never write them to `storage.local`, logs or files.
- Plain JavaScript ES modules with no build step and no dependencies, so the folder loads as an unpacked extension.

## Run and test

- Install: open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick this folder. Open a Trello board that has Everhour, then click the extension icon to open the panel.
- Unit tests: `node --test tests/`. These cover the pure helpers in `src/lib/`.
- End to end: add time on the test board via Everhour. The panel should update without a reload. Edit and delete the record from the panel, then check Everhour's Edit time view.

## Conventions

- Conventional Commits, one commit per semantically separate step, with no AI attribution trailers.
- After each step, append a section to [docs/devlog.md](docs/devlog.md) covering what was done, why, what was found and what is still open. Keep this file up to date when the architecture changes.
- Markdown: one line per paragraph, never hard-wrapped.
