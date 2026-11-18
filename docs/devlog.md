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
