# Everhour Trello Power-Up: how it talks to its backend

Read from Everhour's public Power-Up bundles, build `59ce56d2` (`app.everhour.com/trello-powerup/{root,card-back-section,add-time-dialog,edit-time-modal}.59ce56d2.js`), on 2026-11-18. Items marked *(verify live)* still need confirming from real traffic once the extension is loaded.

## Frames

- **Root (connector) frame**: `https://app.everhour.com/trello-powerup/?v=2`. It is hidden (0×0) and stays loaded on every board page that has Everhour. Its HTML loads Trello's client `https://p.trellocdn.com/power-up.min.js` (global `TrelloPowerUp`) and then `root.59ce56d2.js`, which calls `TrelloPowerUp.initialize({...})` with these capabilities:
  - `board-buttons`: **Time** opens a fullscreen modal at `./edit-time-modal.59ce56d2.html`; **Total** opens a popup at `total-popup.59ce56d2.html`.
  - `card-back-section`: an iframe `./card-back-section.59ce56d2.html` (height 85) showing "Time Tracking". When the card has time, its action **Edit time** opens `edit-time-modal` with `args.data = {card}`.
  - `card-badges`, and others.
- **Secondary frames**: the card back section, the add-time dialog and the edit-time/Time modal. They are separate `app.everhour.com` iframes and get their Trello context from the URL hash (`TrelloPowerUp.iframe()`).
- The Time modal has tabs `dashboard` (per-weekday totals) and `report` (the entries table). The last tab used is kept in that frame's `localStorage["time-modal-tab"]`.

## Auth

Every API call is a `fetch` to `https://app.everhour.com/api` + path, with headers `Content-Type: application/json` and **`x-jira-addon-token: <JWT>`**. No cookies are involved.

The JWT is Trello's Power-Up JWT, obtained from the Power-Up client:

- `t.jwt()` for single-card or user calls;
- `t.jwt({state: JSON.stringify(boardIds)})` for board-wide time lists, at most 82 board ids per JWT.

Behind the scenes Trello's web client mints it with `POST https://trello.com/1/plugin/<idPlugin>/jwt`. Everhour's plugin id is `607eabc3361c748446d62490`, as seen on the test board. Decoding the JWT gives `idMember`, `idOrganization` and `organizationMembership`.

A non-OK response or HTTP 204 rejects with the `Response`; otherwise the body is JSON.

## Endpoints

| Call in bundle | Method and path | Body or query |
|---|---|---|
| `getTimeRequest(jwt, params)` | `GET /trello/time?<qs>` | `{cardId}` for one card. **No params** with a board-state JWT returns all time on those boards (all members, all dates), which callers filter by `boardId`. |
| `getTimeByIdRequest(jwt, id)` | `GET /trello/time/{id}` | |
| `addTimeRequest(jwt, body)` | `POST /trello/time` | `{memberId, cardId, date, time, comment}` |
| `editTimeRequest(jwt, id, patch)` | `PUT /trello/time/{id}` | Everhour sends **one field per call**: `{time}`, `{date}`, `{comment}` or `{isInvoiced}`. |
| delete | `PUT /trello/time/{id}` | `{time: 0}`. There is no DELETE. The UI's "Delete" calls `updateTime(id, 0)`, and lists drop records with `time <= 0`. |
| `getProfileDataRequest` / `updateProfileDataRequest` | `GET` / `PUT /trello/user` | |
| `getSubscriptionRequest` | `GET /trello/subscription` | `{type: 'paid'\|'trial'\|'free-limited', expireAt, billing, …}` |
| | `GET /trello/news`, `POST /trello/subscription/{trial,checkout}` | Not used here. |

## Time record

Here is a record as returned by add, edit and get, matching the shape Everhour fakes in its debug path:

```json
{
  "id": 5826700, "cardId": "<trello card id>", "boardId": "<trello board id>", "memberId": "<trello member id>",
  "date": "YYYY-MM-DD", "time": 5400, "comment": "", "createdAt": "<ISO 8601>", "createdBy": "<member id>",
  "isInvoiced": false,
  "card": { "time": 12600, "timeByUser": { "<member id>": 5400 } }
}
```

- `time` is in **seconds**. Everhour's timer rounds with `timeRound(sec, 60, 60)`.
- `date` uses `DATE_FORMAT = "YYYY-MM-DD"`, taken from the local day.
- `card` holds the card's new totals after the write. It is present on write responses; whether list responses include it is *(verify live)*.
- Ids increase monotonically with creation (seen in the cache: 5824468 → 5826700 over one day), and `createdAt` is also available.

## Card state in Trello pluginData (must be kept in sync)

Everhour mirrors per-card totals into Trello pluginData so badges and the card back render without an API call: `t.get(cardId, 'shared')` returns `{time, estimate, timeByUser: {memberId: seconds}, original: cardId, rate?, budget?, isShowBilling?}`.

After every add or edit, `applyReportedTime(record)` runs:

```js
const s = await getCardState(record.cardId);              // t.get(cardId,'shared') with defaults
if (record.card) {
  const old = s.timeByUser[record.memberId] || 0, now = record.card.timeByUser?.[record.memberId] || 0;
  s.timeByUser[record.memberId] = now; s.time += now - old;
  await tSet(record.cardId, 'shared', s);                   // t.set(...) + broadcast below
}
```

`tSet` is `t.set(...)` followed by `new BroadcastChannel('eh-' + t.secret.slice(0, 6)).postMessage({type: 'data-changed', cardId})`. Every Everhour frame listens on that channel and re-renders. **A write made from outside Everhour must do the same**, or card badges and the card back keep the old totals.

## Permissions (client-side)

`isEditable(record)` returns false on a free subscription, false for a record on another board, and true only for board admins or the record's own member. Whether the server enforces the same rules is *(verify live)*.

## How trello-fast uses this

The extension doesn't hand-craft auth. Its MAIN-world hook in the root frame traps `window.TrelloPowerUp` before `power-up.min.js` defines it. It then wraps `initialize`, so each capability callback hands over its `t`; the hook keeps the board-context `t` from `board-buttons`. With that `t` it can:

- mint a fresh JWT per request: `t.jwt({state})` for the board-wide list and plain `t.jwt()` for single-record GET, PUT and POST, as Everhour does;
- read card names and list placement (`t.cards('id', 'name', 'url', 'closed', 'idList', 'pos')` plus `t.lists('id', 'name')`);
- add time with the same `POST /trello/time` body as Everhour's Add time, always using `t.getContext().member` as `memberId`;
- open cards (`t.showCard(id)`);
- update card pluginData and broadcast `data-changed`, exactly as Everhour does.
