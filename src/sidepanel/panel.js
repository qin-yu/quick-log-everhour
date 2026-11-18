import {
  WEEKDAYS, addDays, formatDuration, formatHours, parseDuration, parseYMD, shortDate, sortRecent, todayYMD, weekDays,
  weekLabel, weekMatrix, weekStart,
} from '../lib/time.js';
import { editPatches, enteredAt, myRecords, normaliseRecord } from '../lib/everhour.js';

const RECENT_PAGE = 15;
const MAX_ENTRY = 24 * 3600;
const $ = (id) => document.getElementById(id);

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
  statusKind: null,
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

// kind: 'info' (cleared by the next successful load), 'error', or 'note' (stays until replaced, dismissed or timed out).
let noteTimer = null;
function setStatus(text, kind = 'info', action = null) {
  const el = $('status');
  clearTimeout(noteTimer);
  state.statusKind = text ? kind : null;
  el.hidden = !text;
  el.className = `status ${kind}`;
  el.replaceChildren();
  if (!text) return;
  el.append(h('span', {}, text));
  if (action) el.append(h('button', { class: 'link', onClick: action.run }, action.label));
  if (kind !== 'info') el.append(h('button', { class: 'link dismiss', title: 'Dismiss', 'aria-label': 'Dismiss', onClick: () => setStatus('') }, '✕'));
  if (kind === 'note') noteTimer = setTimeout(() => setStatus(''), 20000);
}

// ---------------------------------------------------------------- talking to the Everhour frame
async function op(name, args = {}) {
  if (state.tabId == null) throw new Error('No Trello tab');
  let res;
  try {
    res = await chrome.tabs.sendMessage(state.tabId, { type: 'everhour-op', op: name, args });
  } catch (err) {
    if (/Receiving end does not exist|Could not establish connection/i.test(String(err?.message))) {
      throw new Error('Everhour is not loaded in this tab. Open a board that has the Everhour Power-Up; if you just installed or reloaded trello-fast, reload the Trello tab once.');
    }
    throw err;
  }
  if (!res) throw new Error('No answer from Everhour in this tab. Reload the Trello tab.');
  if (!res.ok) throw new Error(res.error || 'Everhour request failed');
  return res.data;
}

const isTrelloBoardUrl = (url) => /^https:\/\/trello\.com\/[bc]\//.test(url ?? '');

// Debug: open this page in a normal tab as index.html?tab=<trello tab id> to pin it to that tab.
const PINNED_TAB = Number(new URLSearchParams(location.search).get('tab')) || null;

async function bindActiveTab() {
  const tab = PINNED_TAB
    ? await chrome.tabs.get(PINNED_TAB).catch(() => null)
    : (await chrome.tabs.query({ active: true, windowId: state.windowId }))[0];
  const tabId = tab && isTrelloBoardUrl(tab.url) ? tab.id : null;
  if (tabId !== state.tabId) {
    state.tabId = tabId;
    state.ctx = null;
    state.editing = null;
  }
  if (tabId == null) {
    state.mine = [];
    render();
    setStatus('Open a Trello board that uses Everhour in this window.');
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
    state.ctx = ctx;
    state.cards = new Map((cards ?? []).map((c) => [c.id, c]));
    state.mine = myRecords(records.map(normaliseRecord), ctx.member.id);
    if (state.statusKind !== 'note') setStatus('');
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
  $('week-label').textContent = weekLabel(state.monday);
  $('target').value = String(state.target);
  $('who').textContent = state.ctx ? `${state.ctx.member.fullName} · ${state.ctx.board.name}` : '';
  renderWeek();
  renderRecent();
}

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
    row.perDay.map((s, i) => h('td', { class: [s ? '' : 'zero', m.days[i] === today ? 'today' : ''].join(' ').trim() || null }, formatHours(s) || '·')),
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) return showError(form, 'Pick a date.');
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

// Send the PUTs, refresh, and offer an undo that puts the old values back (a delete is time 0, so the record survives).
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
  const undo = editPatches(after, rec);
  state.editing = null;
  state.freshId = rec.id;
  setStatus(`${verb}: ${cardName(rec.cardId)}, ${formatDuration(after.seconds || rec.seconds)} on ${shortDate(after.date)}.`, 'note',
    undo.length ? { label: 'Undo', run: () => undoWrite(rec, undo) } : null);
  await load({ quiet: true });
}

async function undoWrite(rec, patches) {
  setStatus('Undoing…');
  try {
    await op('updateTime', { id: rec.id, patches });
    state.freshId = rec.id;
    setStatus('Undone.', 'note');
  } catch (err) {
    setStatus(`Undo failed: ${err.message ?? err}`, 'error');
  }
  await load({ quiet: true });
}

// ---------------------------------------------------------------- wiring
async function saveSettings() {
  await chrome.storage.local.set({ monday: state.monday, target: state.target });
}
function goWeek(monday) {
  state.monday = monday;
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
chrome.tabs.onActivated.addListener(({ windowId }) => { if (!PINNED_TAB && windowId === state.windowId) load(); });
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (PINNED_TAB || tab.windowId !== state.windowId || !tab.active) return;
  if (info.url && !isTrelloBoardUrl(info.url)) load();
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleReload(0); });

(async function init() {
  state.windowId = (await chrome.windows.getCurrent()).id;
  const saved = await chrome.storage.local.get(['monday', 'target']);
  if (typeof saved.monday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(saved.monday)) state.monday = weekStart(saved.monday);
  if (Number(saved.target) > 0) state.target = Number(saved.target);
  render();
  await load();
})();

// Exposed for debugging from DevTools.
globalThis.trelloFast = { state, load, weekDays };
