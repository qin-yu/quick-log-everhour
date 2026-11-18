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

Time data lives in Everhour, not Trello, so the Trello API isn't needed. Everhour's Power-Up runs in `app.everhour.com` iframes inside trello.com. Its hidden root frame (`/trello-powerup/?v=2`) is always loaded on a board page. The extension's MAIN-world hook in that frame captures the Power-Up client handle `t` that Trello passes to Everhour, then uses it the way Everhour itself does: `t.jwt()` for the `x-jira-addon-token` header, `t.cards()` for card names, `t.set()` to keep card totals in sync, and `t.showCard()` to open a card. No API key is involved and no token is stored.

```
side panel ──runtime msg──► background (service worker) ──tabs.sendMessage(frameId)──► everhour-bridge (root frame, isolated)
     ▲                                                                                     │ DOM events
     │                                                                                     ▼
     │                                                         everhour-hook (root frame, MAIN): t.jwt() + fetch /api/trello/*
     └──── "time-changed" ◄── bridge ◄── everhour-hook (MAIN, every Everhour frame): wraps fetch, sees POST/PUT /api/trello/time
```

- `manifest.json` declares MV3, `sidePanel`, `storage` and two content scripts on `https://app.everhour.com/trello-powerup/*` with `all_frames` and `document_start`: the hook (MAIN world) and the bridge (isolated).
- `src/background.js` opens the side panel from the action icon, remembers which frame in each tab is the Everhour root frame, and relays panel requests to it and change notices from any frame to the panel.
- `src/content/everhour-hook.js` runs in the MAIN world:
  - in every Everhour frame it wraps `fetch` and reports successful POST/PUT to `/api/trello/time`;
  - in the root frame it traps `window.TrelloPowerUp` to capture `t` and serves the bridge's requests.
- `src/content/everhour-bridge.js` runs in the isolated world. It relays between `chrome.runtime` and the hook via DOM `CustomEvent`s with JSON-string details.
- `src/lib/everhour.js` normalises records to `{id, date, seconds, comment, memberId, cardId, createdAt}`.
- `src/lib/time.js` holds pure helpers: ISO weeks (Mon–Sun), duration parsing (`1.5`, `1:30`, `90m`) and the card × weekday matrix.
- `src/sidepanel/` holds the panel UI.

Everhour record IDs increase monotonically, so "most recently entered" means sorting by `id` descending. Records also carry `createdAt`. Delete is `PUT /trello/time/{id}` with `{time: 0}`, because Everhour has no DELETE.

Everhour's endpoint details are in [docs/everhour-api.md](docs/everhour-api.md).

## Constraints

- Never use the Trello REST API, and never modify Everhour's own DOM. All UI lives in the side panel.
- Writes go only through explicit user actions in the panel (save or confirmed delete), using the same requests Everhour itself sends.
- JWTs are minted per request with `t.jwt()` and never stored, logged or sent anywhere except `app.everhour.com/api`.
- After any write, mirror Everhour's `applyReportedTime`: update the card's `shared` pluginData and broadcast `data-changed` on `BroadcastChannel('eh-' + t.secret.slice(0, 6))`. See `docs/everhour-api.md`.
- Plain JavaScript ES modules with no build step and no dependencies, so the folder loads as an unpacked extension.

## Run and test

- Install: open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick this folder. Open a Trello board that has Everhour, then click the extension icon to open the panel.
- Unit tests: `node --test tests/` (or `npm test`). These cover the pure helpers in `src/lib/`. `package.json` exists only to mark the folder as ES modules for Node; there are no dependencies.
- End to end: add time on the test board via Everhour. The panel should update without a reload. Edit and delete the record from the panel, then check Everhour's Edit time view.

## Conventions

- Conventional Commits, one commit per semantically separate step, with no AI attribution trailers.
- After each step, append a section to [docs/devlog.md](docs/devlog.md) covering what was done, why, what was found and what is still open. Keep this file up to date when the architecture changes.
- Markdown: one line per paragraph, never hard-wrapped.
