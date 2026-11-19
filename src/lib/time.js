// Pure date/duration helpers. Dates are 'YYYY-MM-DD' strings (calendar days, no time zone),
// durations are integer seconds. Weeks are ISO weeks: Monday to Sunday.

const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' -> UTC midnight Date. Throws on malformed input. */
export function parseYMD(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd ?? '');
  if (!m) throw new Error(`bad date: ${ymd}`);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCMonth() !== +m[2] - 1) throw new Error(`bad date: ${ymd}`);
  return d;
}

/** UTC-midnight Date -> 'YYYY-MM-DD'. */
export const formatYMD = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Today's calendar date in the local time zone. */
export const todayYMD = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

export const addDays = (ymd, n) => formatYMD(new Date(parseYMD(ymd).getTime() + n * DAY_MS));

/** Monday of the ISO week containing ymd. */
export function weekStart(ymd) {
  const dow = (parseYMD(ymd).getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  return addDays(ymd, -dow);
}

/** The seven dates Monday…Sunday of the week starting at monday. */
export const weekDays = (monday) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

/** ISO week-numbering year and week number of ymd. */
export function isoWeek(ymd) {
  const thursday = addDays(weekStart(ymd), 3); // the ISO year is the year of the week's Thursday
  const year = parseYMD(thursday).getUTCFullYear();
  const week = Math.floor((parseYMD(thursday) - Date.UTC(year, 0, 1)) / DAY_MS / 7) + 1;
  return { year, week };
}

/**
 * '16–22 Nov 2026 · W47', or '30 Nov – 6 Dec 2026 · W49' across months.
 * With `currentYear`, a week that lies wholly in that year drops it: '16–22 Nov · W47'.
 */
export function weekLabel(monday, currentYear = null) {
  const a = parseYMD(monday);
  const b = parseYMD(addDays(monday, 6));
  const { week } = isoWeek(monday);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth();
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const left = sameMonth
    ? `${a.getUTCDate()}`
    : `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]}${sameYear ? '' : ` ${a.getUTCFullYear()}`}`;
  const sep = sameMonth ? '–' : ' – ';
  const year = sameYear && b.getUTCFullYear() === currentYear ? '' : ` ${b.getUTCFullYear()}`;
  return `${left}${sep}${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}${year} · W${week}`;
}

/** 'Tue 17 Nov' */
export function shortDate(ymd) {
  const d = parseYMD(ymd);
  return `${WEEKDAYS[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/**
 * Parse a duration typed by a person into seconds, or null if it isn't one.
 * Accepts '1.5', '1,5', '1:30', '90m', '45 min', '2h', '1h30', '1h 30m', '1.5h'. Bare numbers are hours.
 */
export function parseDuration(input) {
  const s = String(input ?? '').trim().toLowerCase().replace(',', '.');
  if (!s) return null;
  let m;
  if ((m = /^(\d+):([0-5]\d)$/.exec(s))) return toSec(+m[1] * 60 + +m[2]);
  if ((m = /^(\d+(?:\.\d+)?|\.\d+)\s*(?:h|hr|hrs|hours?)?$/.exec(s))) return toSec(parseFloat(m[1]) * 60);
  if ((m = /^(\d+)\s*(?:m|min|mins|minutes?)$/.exec(s))) return toSec(+m[1]);
  if ((m = /^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\s*(\d+)\s*(?:m|min|mins|minutes?)?$/.exec(s)))
    return toSec(parseFloat(m[1]) * 60 + +m[2]);
  return null;
}
const toSec = (minutes) => (minutes > 0 && Number.isFinite(minutes) ? Math.round(minutes) * 60 : null);

/** 5400 -> '1h 30m', 3600 -> '1h', 900 -> '15m', 0 -> '0m'. */
export function formatDuration(seconds) {
  const total = Math.round((seconds || 0) / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Compact decimal hours for table cells: 5400 -> '1.5', 4500 -> '1.25', 0 -> ''. */
export function formatHours(seconds) {
  if (!seconds) return '';
  return String(Math.round((seconds / 3600) * 100) / 100);
}

/** Newest-entered first. Everhour record ids grow monotonically with creation time. */
export const sortRecent = (records) => [...records].sort((a, b) => Number(b.id) - Number(a.id));

/**
 * Hours per card per weekday for one week.
 * records: [{date, seconds, cardId, cardName}]. Returns rows sorted by total, descending.
 */
export function weekMatrix(records, monday) {
  const days = weekDays(monday);
  const index = new Map(days.map((d, i) => [d, i]));
  const rows = new Map();
  for (const r of records) {
    const i = index.get(r.date);
    if (i === undefined) continue;
    const key = r.cardId ?? r.cardName ?? '?';
    let row = rows.get(key);
    if (!row) rows.set(key, (row = { cardId: r.cardId, cardName: r.cardName, perDay: Array(7).fill(0), total: 0 }));
    if (!row.cardName && r.cardName) row.cardName = r.cardName;
    row.perDay[i] += r.seconds;
    row.total += r.seconds;
  }
  const sorted = [...rows.values()].sort((a, b) => b.total - a.total || String(a.cardName).localeCompare(String(b.cardName)));
  const dayTotals = days.map((_, i) => sorted.reduce((s, r) => s + r.perDay[i], 0));
  return { days, rows: sorted, dayTotals, total: dayTotals.reduce((a, b) => a + b, 0) };
}
