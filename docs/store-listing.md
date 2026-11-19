# Chrome Web Store listing

Text and choices for each field in the developer dashboard. The package is `dist/quick-time-log-<version>.zip`, built with `npm run package`.

## Store listing tab

**Name** comes from `manifest.json`: Quick Time Log & Edit for Everhour on Trello

**Summary** also comes from `manifest.json` (113 of 132 characters): See your Everhour week on Trello in a side panel, and log, fix or delete entries without hunting through filters.

**Description** is plain text; paste the block below as is:

```
A side panel for Trello boards that track time with the Everhour Power-Up.

YOUR WEEK, ALWAYS CURRENT
• Cards × Mon–Sun with day and card totals, against your weekly target (35 h by default).
• Move between weeks with ‹ ›. The panel remembers the week you were on.
• Refreshes by itself whenever you add or change time in Everhour's own dialogs.

LOG TIME FAST
• Pick a card (recently used first), date and time, then press Enter.
• Time can be 1.5, 1:30, 90m or 1h 30m.
• Click a cell in the week table to prefill that card and day.

FIX MISTAKES IN SECONDS
• Your latest entries come first. No member filter, no date range.
• Click an entry to change its time, date or comment, or delete it.
• Undo and redo every log, save and delete, with one click or ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Y).

HOW IT WORKS
The extension uses the connection Trello already gives the Everhour Power-Up, and sends the same requests Everhour's own dialogs send. There is no API key, no extra sign-in and no server of its own.

Requires a Trello board with the Everhour Power-Up. Works on your own entries only.

Not affiliated with or endorsed by Everhour, Trello or Atlassian.
```

**Category** is Productivity → Workflow & Planning. **Language** is English (United Kingdom).

**Additional fields:**

- Official URL: leave empty. It needs a site verified in Google Search Console.
- Homepage URL: <https://github.com/qin-yu/quick-log-everhour>
- Support URL: <https://github.com/qin-yu/quick-log-everhour/issues>
- Mature content: no.

**Graphics:**

| Field | File |
|---|---|
| Store icon (128×128) | `icons/icon-128.png` |
| Screenshots (1280×800) | `store/screenshot-1.png`, `store/screenshot-2.png` |
| Small promo tile (440×280) | `store/promo-small-440x280.png` |

The screenshots use made-up data from `dev/mock-chrome.js`. Never use screenshots of the real board, because the listing is public. Regenerate them with `sh dev/store-assets.sh`.

## Privacy tab

**Single purpose:** Show and edit your own Everhour time entries for the open Trello board in Chrome's side panel.

**Permission justifications:**

- `sidePanel`: Shows the extension's interface (your week and your latest time entries) in Chrome's side panel next to the Trello board.
- `storage`: Remembers the week you were viewing and your weekly hours target between sessions, on this computer only.
- Host permission `https://trello.com/*`: Lets the panel read the active tab's address to check whether it is a Trello board, so that it only talks to Everhour on Trello board pages.
- Content scripts on `https://app.everhour.com/trello-powerup/*`: Everhour's Trello Power-Up runs inside Trello in app.everhour.com frames. The scripts run in those frames for two reasons. They read and save your time entries through the Power-Up's own connection. They also notice when Everhour saves time, so the panel can refresh.

**Remote code:** No, I am not using remote code. All JavaScript ships in the package; network requests exchange JSON data with Everhour only.

**Data usage:** tick the following, each with the reason given.

- Personally identifiable information: your Trello name and member ID. The name is shown in the panel footer and the ID picks out your entries.
- Authentication information: short-lived Power-Up tokens created through Trello's library to authorise each request to Everhour. They are never stored.
- User activity: the content script checks whether Everhour's own save requests succeeded, so the panel can refresh. Nothing else is monitored.
- Website content: card names, time entries and comments on the open board.

Tick all three certifications: data is not sold or transferred to third parties, not used for purposes unrelated to the single purpose, and not used for creditworthiness or lending.

**Privacy policy URL:** <https://github.com/qin-yu/quick-log-everhour/blob/main/PRIVACY.md>. It must open without signing in, so the repo has to stay public.

## Test instructions tab

For the reviewer; the field takes at most 500 characters (this is 457). Paste as is:

```
Needs a Trello board with the Everhour Power-Up; the extension has no sign-in of its own.
1. On any Trello board, add the Everhour Power-Up and connect an Everhour account.
2. Reload the board and click the toolbar icon. The side panel shows your week and latest entries.
3. Pick a card, type 1:30, press Log. The entry shows in the panel and on the card's Everhour badge.
4. Click the entry to edit or delete it. Undo at the bottom (or Cmd/Ctrl+Z) reverts.
```

## Distribution tab

- **Visibility:** Public. The first plan was Unlisted, but the user chose Public at submission.
- **Regions:** all.
- **Price:** free.

## Before each upload

1. Bump `version` in `manifest.json`. The store rejects a version it has already seen.
2. Run the end-to-end check on the test board: log, edit, delete and Undo, with Everhour's badge and Edit time agreeing.
3. If anything under `src/content/` changed, do a read-only check on the real board.
4. Run `npm run package` and upload the zip.
5. After the update reaches people, tell them to reload their Trello tab once. The panel says so too if they forget.
