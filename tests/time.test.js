import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, formatDuration, formatHours, isoWeek, parseDuration, parseYMD, shortDate,
  sortRecent, todayYMD, weekDays, weekLabel, weekMatrix, weekStart,
} from '../src/lib/time.js';

test('parseYMD rejects malformed and impossible dates', () => {
  assert.throws(() => parseYMD('2026-2-1'));
  assert.throws(() => parseYMD('2026-02-30'));
  assert.equal(parseYMD('2026-02-28').getUTCDate(), 28);
});

test('addDays crosses month, year and DST boundaries', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-29', 1), '2026-03-30'); // UK clocks change 29 Mar 2026
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('weekStart returns the Monday of the ISO week', () => {
  assert.equal(weekStart('2026-11-18'), '2026-11-16'); // Wednesday
  assert.equal(weekStart('2026-11-16'), '2026-11-16'); // Monday
  assert.equal(weekStart('2026-11-22'), '2026-11-16'); // Sunday
  assert.equal(weekStart('2027-01-01'), '2026-12-28');
});

test('weekDays lists Monday to Sunday', () => {
  assert.deepEqual(weekDays('2026-11-30'), [
    '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06',
  ]);
});

test('isoWeek matches ISO 8601 numbering, including year edges', () => {
  assert.deepEqual(isoWeek('2026-11-18'), { year: 2026, week: 47 });
  assert.deepEqual(isoWeek('2026-01-01'), { year: 2026, week: 1 }); // Thursday
  assert.deepEqual(isoWeek('2027-01-01'), { year: 2026, week: 53 }); // 2026 has 53 ISO weeks
  assert.deepEqual(isoWeek('2021-01-03'), { year: 2020, week: 53 });
  assert.deepEqual(isoWeek('2024-12-30'), { year: 2025, week: 1 });
});

test('weekLabel formats within and across months and years', () => {
  assert.equal(weekLabel('2026-11-16'), '16–22 Nov 2026 · W47');
  assert.equal(weekLabel('2026-11-30'), '30 Nov – 6 Dec 2026 · W49');
  assert.equal(weekLabel('2026-12-28'), '28 Dec 2026 – 3 Jan 2027 · W53');
  assert.equal(weekLabel('2026-11-16', 2026), '16–22 Nov · W47');
  assert.equal(weekLabel('2026-11-30', 2026), '30 Nov – 6 Dec · W49');
  assert.equal(weekLabel('2026-11-16', 2027), '16–22 Nov 2026 · W47');
  assert.equal(weekLabel('2026-12-28', 2026), '28 Dec 2026 – 3 Jan 2027 · W53');
});

test('shortDate', () => {
  assert.equal(shortDate('2026-11-17'), 'Tue 17 Nov');
});

test('todayYMD uses the local calendar date', () => {
  assert.equal(todayYMD(new Date(2026, 10, 18, 23, 59)), '2026-11-18');
});

test('parseDuration accepts the common ways of typing hours', () => {
  const cases = {
    '1.5': 5400, '1,5': 5400, '.5': 1800, '2': 7200, '1:30': 5400, '0:45': 2700,
    '90m': 5400, '45 min': 2700, '2h': 7200, '1.5h': 5400, '1h30': 5400, '1h 30m': 5400, ' 1H 15M ': 4500,
    '0.33': 1200, // rounds to whole minutes
  };
  for (const [input, want] of Object.entries(cases)) assert.equal(parseDuration(input), want, input);
});

test('parseDuration rejects junk, zero and negatives', () => {
  for (const input of ['', '  ', 'abc', '0', '0:00', '-1', '1:75', '1h-30m', null, undefined]) {
    assert.equal(parseDuration(input), null, String(input));
  }
});

test('formatDuration and formatHours', () => {
  assert.equal(formatDuration(5400), '1h 30m');
  assert.equal(formatDuration(3600), '1h');
  assert.equal(formatDuration(900), '15m');
  assert.equal(formatDuration(0), '0m');
  assert.equal(formatHours(5400), '1.5');
  assert.equal(formatHours(4500), '1.25');
  assert.equal(formatHours(1200), '0.33');
  assert.equal(formatHours(0), '');
});

test('sortRecent puts the highest id first without mutating input', () => {
  const input = [{ id: 5824468 }, { id: '5826700' }, { id: 5825135 }];
  assert.deepEqual(sortRecent(input).map((r) => Number(r.id)), [5826700, 5825135, 5824468]);
  assert.equal(input[0].id, 5824468);
});

test('weekMatrix groups by card and weekday and ignores other weeks', () => {
  const recs = [
    { date: '2026-11-16', seconds: 3600, cardId: 'a', cardName: 'Pipeline' },
    { date: '2026-11-16', seconds: 1800, cardId: 'a', cardName: 'Pipeline' },
    { date: '2026-11-17', seconds: 7200, cardId: 'b', cardName: 'Admin' },
    { date: '2026-11-22', seconds: 3600, cardId: 'b', cardName: 'Admin' },
    { date: '2026-11-15', seconds: 9999, cardId: 'a', cardName: 'Pipeline' }, // previous Sunday
    { date: '2026-11-23', seconds: 9999, cardId: 'a', cardName: 'Pipeline' }, // next Monday
  ];
  const m = weekMatrix(recs, '2026-11-16');
  assert.equal(m.total, 3600 + 1800 + 7200 + 3600);
  assert.deepEqual(m.rows.map((r) => r.cardName), ['Admin', 'Pipeline']);
  assert.deepEqual(m.rows[1].perDay, [5400, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(m.dayTotals, [5400, 7200, 0, 0, 0, 0, 3600]);
});
