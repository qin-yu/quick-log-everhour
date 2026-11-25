import {
  WEEKDAYS, addDays, formatDuration, formatHours, parseDuration, parseYMD, shortDate, sortRecent, todayYMD,
  weekLabel, weekMatrix, weekStart,
} from '../lib/time.js';
import { cardChoices, editPatches, enteredAt, myRecords, normaliseRecord } from '../lib/everhour.js';
import { History, makeStep } from '../lib/history.js';

const RECENT_PAGE = 15;
const MAX_ENTRY = 24 * 3600;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const $ = (id) => document.getElementById(id);
const history = new History(); // this board's writes from this panel, for Undo / Redo
const IS_MAC = /Mac/.test(navigator.platform);
const KEYS = IS_MAC ? { undo: '⌘Z', redo: '⇧⌘Z' } : { undo: 'Ctrl+Z', redo: 'Ctrl+Y' };

const state = {
  windowId: null,
  tabId: null,
  ctx: null, // {boardId, member: {id, fullName}, board: {name}}
  cards: new Map(), // cardId -> {name, url, closed}
  mine: [], // my normalised records on this board
  monday: weekStart(todayYMD()),
  target: 35,
  recentShown: RECENT_PAGE,
  freshId: null, // id to flash once in the recent list
  editing: null, // {id, mode: 'edit' | 'delete'} while an editor is open
  loadSeq: 0,
};

// ---------------------------------------------------------------- tiny DOM helper
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

// Top line for loading and load errors: kind 'info' or 'error'. The next successful load clears it.
function setStatus(text, kind = 'info') {
  const el = $('status');
  el.hidden = !text;
  el.className = `status ${kind}`;
  el.replaceChildren();
  if (!text) return;
  el.append(h('span', {}, text));
  if (kind === 'error') el.append(h('button', { class: 'link dismiss', title: 'Dismiss', 'aria-label': 'Dismiss', onClick: () => setStatus('') }, '✕'));
}

// Floating bar at the bottom for the outcome of a write, so it is in view wherever the panel is scrolled.
// It offers Undo / Redo whenever the history has something; the keyboard shortcuts work even after it hides.
let toastTimer = null;
function toast(text, { kind = 'note', sticky = false } = {}) {
  const el = $('toast');
  clearTimeout(toastTimer);
  el.hidden = !text;
  el.className = `toast ${kind}`;
  el.replaceChildren();
  if (!text) return;
  el.append(h('span', {}, text));
  const busy = sticky && kind !== 'error';
  if (!busy && history.undo.length) el.append(h('button', { class: 'link', title: `Undo (${KEYS.undo})`, onClick: () => travel('undo') }, 'Undo'));
  if (!busy && history.redo.length) el.append(h('button', { class: 'link', title: `Redo (${KEYS.redo})`, onClick: () => travel('redo') }, 'Redo'));
  el.append(h('button', { class: 'link dismiss', title: 'Dismiss', 'aria-label': 'Dismiss', onClick: () => toast('') }, '✕'));
  if (!sticky) toastTimer = setTimeout(() => toast(''), history.undo.length || history.redo.length ? 30000 : 6000);
}

// Undo or redo the latest step. A "changed somewhere else" refusal from the hook can never succeed, so that
// step is dropped; any other failure keeps it for another try.
let travelling = false;
async function travel(direction) {
  if (travelling) return;
  const undoing = direction === 'undo';
  if (!(undoing ? history.undo : history.redo).length) {
    toast(undoing ? 'Nothing to undo.' : 'Nothing to redo.');
    return;
  }
  travelling = true;
  toast(undoing ? 'Undoing…' : 'Redoing…', { sticky: true });
  try {
    const step = await history.move(direction, async (request) => {
      try {
        await op('updateTime', request);
      } catch (err) {
        if (/changed somewhere else/.test(err?.message ?? '')) err.permanent = true;
        throw err;
      }
    });
    state.freshId = step.id;
    toast(`${undoing ? 'Undid' : 'Redid'} ${step.noun}: ${step.what}.`);
  } catch (err) {
    toast(`${undoing ? 'Undo' : 'Redo'} failed: ${err.message ?? err}`, { kind: 'error', sticky: true });
  } finally {
    travelling = false;
  }
  await load({ quiet: true });
}

// ---------------------------------------------------------------- talking to the Everhour frame
async function op(name, args = {}) {
  if (state.tabId == null) throw new Error('No Trello tab');
  let res;
  try {
    res = await chrome.tabs.sendMessage(state.tabId, { type: 'everhour-op', op: name, args });
  } catch (err) {
    if (/Receiving end does not exist|Could not establish connection/i.test(String(err?.message))) {
      throw new Error('Everhour is not loaded in this tab. Open a board that has the Everhour Power-Up; if you just installed or updated this extension, reload the Trello tab once. If that doesn’t help, check that the extension is allowed on app.everhour.com.');
    }
    throw err;
  }
  if (!res) throw new Error('No answer from Everhour in this tab. Reload the Trello tab.');
  // After an update the panel is already new, but an open Trello tab keeps the old page scripts until it reloads.
  if (!res.ok && /^Unknown request /.test(res.error ?? '')) {
    throw new Error('This Trello tab is still running the previous version of the extension. Reload the Trello tab.');
  }
  if (!res.ok) throw new Error(res.error || 'Everhour request failed');
  return res.data;
}

const isTrelloBoardUrl = (url) => /^https:\/\/trello\.com\/[bc]\//.test(url ?? '');
// tab.url is only visible on sites we may access, so a missing url means either another site or that the
// user withheld trello.com (Firefox: about:addons → Permissions; Chrome: Site access).
const hasTrelloAccess = () => chrome.permissions.contains({ origins: ['https://trello.com/*'] }).catch(() => true);
const NO_ACCESS = 'This extension isn’t allowed on trello.com, so it can’t see which tab is a board. Allow it on trello.com and app.everhour.com in the extension’s site access settings (Firefox: about:addons → Permissions), then reload the Trello tab.';

async function bindActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, windowId: state.windowId });
  const tabId = tab && isTrelloBoardUrl(tab.url) ? tab.id : null;
  if (tabId !== state.tabId) {
    state.tabId = tabId;
    state.ctx = null;
    state.editing = null;
    history.clear();
  }
  if (tabId == null) {
    state.mine = [];
    render();
    const blocked = tab && tab.url === undefined && !(await hasTrelloAccess());
    setStatus(blocked ? NO_ACCESS : 'Open a Trello board that uses Everhour in this window.');
    return false;
  }
  return true;
}

// ---------------------------------------------------------------- loading
async function load({ quiet = false } = {}) {
  const seq = ++state.loadSeq;
  if (!(await bindActiveTab())) return;
  if (!quiet) setStatus('Loading from Everhour…');
  $('refresh').disabled = true;
  try {
    const [ctx, cards, records] = await Promise.all([
      state.ctx ? Promise.resolve(state.ctx) : op('context'),
      op('cards'),
      op('listTime'),
    ]);
    if (seq !== state.loadSeq) return; // a newer load started
    if (state.ctx?.boardId && ctx.boardId !== state.ctx.boardId) history.clear(); // same tab, another board
    state.ctx = ctx;
    state.cards = new Map((cards ?? []).map((c) => [c.id, c]));
    state.mine = myRecords(records.map(normaliseRecord), ctx.member.id);
    setStatus('');
  } catch (err) {
    if (seq !== state.loadSeq) return;
    setStatus(String(err.message ?? err), 'error');
  } finally {
    if (seq === state.loadSeq) $('refresh').disabled = false;
  }
  render();
}

let reloadTimer = null;
function scheduleReload(delay = 400) {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => load({ quiet: true }), delay);
}

// ---------------------------------------------------------------- rendering
const cardName = (cardId) => {
  const c = state.cards.get(cardId);
  if (!c) return 'Archived or hidden card';
  return c.closed ? `${c.name} (archived)` : c.name;
};
const openCard = (cardId) => op('openCard', { cardId }).catch((err) => setStatus(String(err.message ?? err), 'error'));

function render() {
  $('week-label').textContent = weekLabel(state.monday, Number(todayYMD().slice(0, 4)));
  $('week-label').title = weekLabel(state.monday);
  $('target').value = String(state.target);
  $('who').textContent = state.ctx ? `${state.ctx.member.fullName} · ${state.ctx.board.name}` : '';
  renderAdd();
  renderWeek();
  renderRecent();
}

// ---------------------------------------------------------------- log new time
const add = {
  form: $('add'), card: $('add-card'), date: $('add-date'), time: $('add-time'), comment: $('add-comment'), error: $('add-error'),
};
let cardOptionsKey = '';

// Today when looking at this week, otherwise the Monday of the week on screen.
const defaultAddDate = () => (weekStart(todayYMD()) === state.monday ? todayYMD() : state.monday);
const isOpenCard = (id) => !!id && state.cards.has(id) && !state.cards.get(id).closed;

// The <select> is rebuilt only when the card list changes, so a refresh doesn't close it or lose the choice.
function renderAdd() {
  const ready = state.tabId != null && !!state.ctx;
  add.form.hidden = !ready;
  if (!ready) return;
  const { recent, groups } = cardChoices([...state.cards.values()], state.mine);
  const key = JSON.stringify([recent.map((c) => c.id), groups.map((g) => [g.list, g.cards.map((c) => [c.id, c.name])])]);
  if (key === cardOptionsKey) return;
  cardOptionsKey = key;
  const keep = add.card.value;
  const option = (c) => h('option', { value: c.id }, c.name);
  add.card.replaceChildren(
    h('option', { value: '', disabled: true }, 'Choose a card…'),
    ...(recent.length ? [h('optgroup', { label: 'Recently used' }, recent.map(option))] : []),
    ...groups.map((g) => h('optgroup', { label: g.list }, g.cards.map(option))));
  add.card.value = isOpenCard(keep) ? keep : recent[0]?.id ?? '';
}

function prefillAdd(cardId, date) {
  if (isOpenCard(cardId)) add.card.value = cardId;
  add.date.value = date;
  add.error.hidden = true;
  add.form.scrollIntoView({ block: 'nearest' });
  add.time.focus();
  add.time.select();
}

add.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const cardId = add.card.value;
  const seconds = parseDuration(add.time.value);
  const date = add.date.value;
  const comment = add.comment.value.trim();
  const fail = (message, field) => {
    add.error.textContent = message;
    add.error.hidden = false;
    field?.focus();
  };
  if (!isOpenCard(cardId)) return fail('Choose a card.', add.card);
  if (seconds == null) return fail('Time not understood. Try 1.5, 1:30, 90m or 1h 30m.', add.time);
  if (seconds > MAX_ENTRY) return fail('At most 24 h in one entry.', add.time);
  if (!YMD.test(date)) return fail('Pick a date.', add.date);
  add.error.hidden = true;
  const controls = [...add.form.elements];
  controls.forEach((el) => { el.disabled = true; });
  let rec;
  try {
    rec = await op('addTime', { cardId, date, time: seconds, comment });
  } catch (err) {
    controls.forEach((el) => { el.disabled = false; });
    return fail(String(err.message ?? err));
  }
  controls.forEach((el) => { el.disabled = false; });
  add.time.value = '';
  add.comment.value = '';
  add.time.focus();
  const id = Number(rec?.id) || null;
  state.freshId = id;
  if (weekStart(date) !== state.monday) { state.monday = weekStart(date); saveSettings(); }
  const logged = { date, comment, seconds };
  if (id) history.push(makeStep(id, { ...logged, seconds: 0 }, logged, { noun: 'log', what: `${cardName(cardId)}, ${shortDate(date)}` }));
  toast(`Logged ${formatDuration(seconds)} on ${cardName(cardId)}, ${shortDate(date)}.`);
  await load({ quiet: true });
});

function renderWeek() {
  const box = $('week');
  box.replaceChildren();
  if (state.tabId == null || !state.ctx) return;
  const m = weekMatrix(state.mine.map((r) => ({ ...r, cardName: cardName(r.cardId) })), state.monday);
  const today = todayYMD();
  const targetSec = state.target * 3600;
  const pct = targetSec ? Math.min(100, (m.total / targetSec) * 100) : 0;
  const left = targetSec - m.total;
  box.append(
    h('div', { class: 'total-line' },
      h('span', { class: 'big' }, `${formatHours(m.total) || '0'} h`),
      h('span', { class: 'muted' }, `of ${state.target} h`),
      h('span', { class: 'muted' }, left > 0 ? `· ${formatDuration(left)} to go` : left < 0 ? `· ${formatDuration(-left)} over` : '· done')),
    h('div', { class: `meter ${left === 0 ? 'full' : left < 0 ? 'over' : ''}` }, h('div', { style: `width:${pct}%` })),
  );
  if (!m.rows.length) {
    box.append(h('div', { class: 'empty' }, 'No time logged by you this week.'));
    return;
  }
  const dayHead = m.days.map((d, i) => h('th', { class: d === today ? 'today' : null, title: shortDate(d) },
    WEEKDAYS[i].slice(0, 2), h('br'), String(parseYMD(d).getUTCDate())));
  const body = m.rows.map((row) => h('tr', {},
    h('td', { class: 'card' }, h('button', { title: `${row.cardName} — open card`, onClick: () => openCard(row.cardId) }, row.cardName)),
    row.perDay.map((s, i) => {
      const loggable = isOpenCard(row.cardId);
      return h('td', {
        class: [s ? '' : 'zero', m.days[i] === today ? 'today' : '', loggable ? 'cell' : ''].join(' ').trim() || null,
        title: loggable ? `Log time on ${row.cardName}, ${shortDate(m.days[i])}` : null,
        onClick: loggable ? () => prefillAdd(row.cardId, m.days[i]) : null,
      }, formatHours(s) || '·');
    }),
    h('td', { class: 'sum' }, formatHours(row.total))));
  box.append(h('table', {},
    h('thead', {}, h('tr', {}, h('th', { class: 'card' }, 'Card'), dayHead, h('th', { class: 'sum' }, 'Σ'))),
    h('tbody', {}, body),
    h('tfoot', {}, h('tr', {},
      h('td', { class: 'card' }, 'Total'),
      m.dayTotals.map((s, i) => h('td', { class: m.days[i] === today ? 'today' : null }, formatHours(s) || '·')),
      h('td', { class: 'sum' }, formatHours(m.total) || '0')))));
}

// While an editor is open the list is left alone, so a background refresh can't wipe what is being typed.
function renderRecent({ force = false } = {}) {
  if (state.editing && !force) return;
  const list = $('recent');
  list.replaceChildren();
  const recent = sortRecent(state.mine);
  $('more').hidden = recent.length <= state.recentShown;
  if (state.tabId == null || !state.ctx) return;
  if (!recent.length) {
    list.append(h('li', { class: 'empty' }, 'You have no time on this board yet.'));
    return;
  }
  for (const rec of recent.slice(0, state.recentShown)) list.append(recentItem(rec));
  state.freshId = null; // flash once
}

function recentItem(rec) {
  const ed = state.editing?.id === rec.id ? state.editing : null;
  const entered = enteredAt(rec.createdAt);
  const li = h('li', {
    class: [rec.id === state.freshId ? 'fresh' : '', ed ? 'open' : ''].join(' ').trim() || null,
    'data-id': rec.id,
    title: ed ? null : 'Click to edit',
    onClick: (e) => { if (!e.target.closest('button, input, form, .confirm')) openEditor(rec.id, 'edit'); },
  });
  li.append(h('div', { class: 'row' },
    h('div', { class: 'what' },
      h('span', { class: 'name' }, cardName(rec.cardId)),
      h('span', { class: 'meta' }, `${shortDate(rec.date)}${entered ? ` · entered ${entered}` : ''}`)),
    h('span', { class: 'dur' }, formatDuration(rec.seconds)),
    h('span', { class: 'actions' },
      h('button', { title: 'Edit', 'aria-label': 'Edit entry', onClick: () => openEditor(rec.id, 'edit') }, '✎'),
      h('button', { class: 'danger', title: 'Delete', 'aria-label': 'Delete entry', onClick: () => openEditor(rec.id, 'delete') }, '🗑'))));
  if (rec.comment) li.append(h('div', { class: 'comment' }, rec.comment));
  if (ed?.mode === 'edit') li.append(editForm(rec));
  if (ed?.mode === 'delete') li.append(deleteConfirm(rec));
  return li;
}

// ---------------------------------------------------------------- edit and delete
function openEditor(id, mode) {
  state.editing = { id, mode };
  renderRecent({ force: true });
}

function closeEditor() {
  state.editing = null;
  renderRecent({ force: true });
}

const onEscape = (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closeEditor(); }
};

function editForm(rec) {
  const dur = h('input', { id: 'ed-dur', value: formatDuration(rec.seconds), autocomplete: 'off', placeholder: '1.5 · 1:30 · 90m' });
  const date = h('input', { id: 'ed-date', type: 'date', value: rec.date, required: true });
  const comment = h('input', { id: 'ed-comment', value: rec.comment, maxlength: 2000, autocomplete: 'off' });
  const error = h('div', { class: 'error', hidden: true });
  const form = h('form', { class: 'edit', onKeydown: onEscape },
    h('label', { for: 'ed-dur' }, 'Time'), dur,
    h('label', { for: 'ed-date' }, 'Date'), date,
    h('label', { for: 'ed-comment' }, 'Comment'), comment,
    error,
    h('div', { class: 'buttons' },
      h('button', { type: 'button', class: 'link', onClick: () => openCard(rec.cardId) }, 'Open card ↗'),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', onClick: closeEditor }, 'Cancel'),
      h('button', { type: 'submit', class: 'primary' }, 'Save')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const seconds = parseDuration(dur.value);
    if (seconds == null) return showError(form, 'Time not understood. Try 1.5, 1:30, 90m or 1h 30m.');
    if (seconds > MAX_ENTRY) return showError(form, 'At most 24 h in one entry.');
    if (!YMD.test(date.value)) return showError(form, 'Pick a date.');
    const text = comment.value.trim();
    const patches = editPatches(rec, { seconds, date: date.value, comment: text === rec.comment.trim() ? undefined : text });
    if (!patches.length) return closeEditor();
    write(rec, patches, form, 'Saved');
  });
  requestAnimationFrame(() => { dur.focus(); dur.select(); });
  return form;
}

function deleteConfirm(rec) {
  const yes = h('button', { class: 'danger', onClick: () => write(rec, [{ time: 0 }], box, 'Deleted') }, 'Delete');
  const box = h('div', { class: 'confirm', onKeydown: onEscape },
    h('span', {}, `Delete ${formatDuration(rec.seconds)} on ${shortDate(rec.date)}?`),
    h('button', { onClick: closeEditor }, 'Cancel'),
    yes,
    h('div', { class: 'error', hidden: true }));
  requestAnimationFrame(() => yes.focus());
  return box;
}

function showError(box, message) {
  const el = box.querySelector('.error');
  el.textContent = message;
  el.hidden = false;
}

const applyPatches = (rec, patches) => patches.reduce((r, p) => ({
  ...r,
  ...('date' in p && { date: p.date }),
  ...('comment' in p && { comment: p.comment }),
  ...('time' in p && { seconds: p.time }),
}), rec);

// Send the PUTs, record the step for Undo / Redo, and refresh. A delete is time 0, so the record survives.
async function write(rec, patches, box, verb) {
  const controls = [...box.querySelectorAll('input, button')];
  controls.forEach((el) => { el.disabled = true; });
  box.querySelector('.error').hidden = true;
  try {
    await op('updateTime', { id: rec.id, patches });
  } catch (err) {
    controls.forEach((el) => { el.disabled = false; });
    showError(box, String(err.message ?? err));
    return;
  }
  const after = applyPatches(rec, patches);
  state.editing = null;
  state.freshId = rec.id;
  history.push(makeStep(rec.id, rec, after, { noun: verb === 'Deleted' ? 'delete' : 'edit', what: `${cardName(rec.cardId)}, ${shortDate(after.date)}` }));
  toast(`${verb}: ${cardName(rec.cardId)}, ${formatDuration(after.seconds || rec.seconds)} on ${shortDate(after.date)}.`);
  await load({ quiet: true });
}

// ---------------------------------------------------------------- wiring
async function saveSettings() {
  await chrome.storage.local.set({ monday: state.monday, target: state.target });
}
function goWeek(monday) {
  state.monday = monday;
  add.date.value = defaultAddDate();
  saveSettings();
  render();
}

$('prev').addEventListener('click', () => goWeek(addDays(state.monday, -7)));
$('next').addEventListener('click', () => goWeek(addDays(state.monday, 7)));
$('this-week').addEventListener('click', () => goWeek(weekStart(todayYMD())));
$('refresh').addEventListener('click', () => load());
$('more').addEventListener('click', () => { state.recentShown += RECENT_PAGE; renderRecent({ force: true }); });
$('target').addEventListener('change', () => {
  const v = Number($('target').value);
  if (v > 0 && v <= 80) { state.target = v; saveSettings(); }
  render();
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.tab?.id !== state.tabId) return;
  if (msg?.type === 'time-changed') {
    if (msg.method === 'POST' && msg.id) state.freshId = Number(msg.id);
    scheduleReload(400);
  } else if (msg?.type === 'everhour-ready') {
    state.ctx = null; // board may have changed
    scheduleReload(600);
  }
});
chrome.tabs.onActivated.addListener(({ windowId }) => { if (windowId === state.windowId) load(); });
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (tab.windowId !== state.windowId || !tab.active) return;
  if (info.url && !isTrelloBoardUrl(info.url)) load();
});
// ⌘Z / Ctrl+Z undo; ⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y redo.
document.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  let direction = null;
  if ((e.metaKey || e.ctrlKey) && !e.altKey && key === 'z') direction = e.shiftKey ? 'redo' : 'undo';
  else if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && key === 'y') direction = 'redo';
  if (!direction) return;
  const field = e.target.closest?.('input, textarea, select');
  if (field && field.value !== '') return; // a field with text keeps its own undo; an empty one (e.g. time after Log) doesn't need it
  e.preventDefault();
  travel(direction);
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleReload(0); });

(async function init() {
  state.windowId = (await chrome.windows.getCurrent()).id;
  const saved = await chrome.storage.local.get(['monday', 'target']);
  if (typeof saved.monday === 'string' && YMD.test(saved.monday)) state.monday = weekStart(saved.monday);
  if (Number(saved.target) > 0) state.target = Number(saved.target);
  add.date.value = defaultAddDate();
  render();
  await load();
})();
