# trello-fast

Published as **Quick Time Log & Edit for Everhour on Trello**; the repo and code keep the name trello-fast. A Chrome extension (Manifest V3) that adds a side panel to Trello for faster time logging with the **Everhour Trello Power-Up**, which is what the team board uses for time tracking.

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

- `manifest.json` declares MV3, `sidePanel`, `storage` and two content scripts on `https://app.everhour.com/trello-powerup/*` with `all_frames` and `document_start`: the hook (MAIN world) and the bridge (isolated).
- `src/background.js` only makes the action icon open the side panel. Nothing is relayed through the service worker: the panel messages the tab directly and the bridges message the panel directly.
- `src/content/everhour-hook.js` runs in the MAIN world:
  - in every Everhour frame it wraps `fetch` and reports successful POST/PUT to `/api/trello/time`;
  - in the root frame it traps `window.TrelloPowerUp` to capture `t` and serves the bridge's requests: `context`, `cards` (with list names), `listTime`, `openCard`, `addTime` and `updateTime`. The write ops check that the card or record belongs to the signed-in member on this board.
- `src/content/everhour-bridge.js` runs in the isolated world. It relays between `chrome.runtime` and the hook via DOM `CustomEvent`s with JSON-string details.
- `src/lib/everhour.js` normalises records to `{id, date, seconds, comment, memberId, cardId, createdAt}`, turns an edit into per-field PUTs (`editPatches`) and orders the card picker (`cardChoices`).
- `src/lib/time.js` holds pure helpers: ISO weeks (Mon–Sun), duration parsing (`1.5`, `1:30`, `90m`) and the card × weekday matrix.
- `src/sidepanel/` holds the panel UI.
- `icons/` holds the PNGs the manifest uses, rendered with `rsvg-convert` from `icon.svg` (48 and 128 px, with Chrome's 16 px margin) and `icon-small.svg` (16 and 32 px, full bleed).

Everhour record IDs increase monotonically, so "most recently entered" means sorting by `id` descending. Records also carry `createdAt`. Delete is `PUT /trello/time/{id}` with `{time: 0}`, because Everhour has no DELETE.

Everhour's endpoint details are in [docs/everhour-api.md](docs/everhour-api.md).

## Constraints

- Never use the Trello REST API, and never modify Everhour's own DOM. All UI lives in the side panel.
- Writes go only through explicit user actions in the panel (log, save, confirmed delete or undo), using the same requests Everhour itself sends.
- JWTs are minted per request with `t.jwt()` and never stored, logged or sent anywhere except `app.everhour.com/api`.
- After any write, mirror Everhour's `applyReportedTime`: update the card's `shared` pluginData and broadcast `data-changed` on `BroadcastChannel('eh-' + t.secret.slice(0, 6))`. See `docs/everhour-api.md`.
- Plain JavaScript ES modules with no build step and no dependencies, so the folder loads as an unpacked extension.

## Run and test

- Install: open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick this folder. Open a Trello board that has Everhour, then click the extension icon to open the panel.
- Unit tests: `node --test tests/` (or `npm test`). These cover the pure helpers in `src/lib/`. `package.json` exists only to mark the folder as ES modules for Node; there are no dependencies.
- Panel UI without the extension: `python3 dev/serve.py`, then open <http://localhost:8765/src/sidepanel/index.html>. It injects `dev/mock-chrome.js`, a fake `chrome.*` with made-up cards and records; `window.__mock.calls` lists every op the panel sent and `window.__mock.fail = '<op>'` makes that op fail. Browser automation can't open `chrome-extension://` pages, so this is how the panel gets driven.
- End to end: add time on the test board via Everhour. The panel should update without a reload. Edit and delete the record from the panel, then check Everhour's Edit time view.

## Conventions

- Conventional Commits, one commit per semantically separate step, with no AI attribution trailers.
- After each step, append a section to [docs/devlog.md](docs/devlog.md) covering what was done, why, what was found and what is still open. Keep this file up to date when the architecture changes.
- Markdown: one line per paragraph, never hard-wrapped.
