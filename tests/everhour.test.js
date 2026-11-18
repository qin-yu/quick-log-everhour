import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editPatches, enteredAt, myRecords, normaliseRecord } from '../src/lib/everhour.js';

const raw = {
  id: '5826700', cardId: 'c1', boardId: 'b1', memberId: 'm1', date: '2026-11-17', time: 5400,
  comment: 'review', createdAt: '2026-11-17T22:29:00.000Z', createdBy: 'm1', isInvoiced: false,
};

test('normaliseRecord maps API fields', () => {
  assert.deepEqual(normaliseRecord(raw), {
    id: 5826700, date: '2026-11-17', seconds: 5400, comment: 'review',
    memberId: 'm1', cardId: 'c1', boardId: 'b1', createdAt: '2026-11-17T22:29:00.000Z',
  });
});

test('normaliseRecord tolerates missing and odd fields', () => {
  const r = normaliseRecord({ id: 1, date: '2026-11-17T00:00:00Z', time: null });
  assert.equal(r.date, '2026-11-17');
  assert.equal(r.seconds, 0);
  assert.equal(r.comment, '');
  assert.equal(r.createdAt, null);
});

test('myRecords keeps only my non-deleted records', () => {
  const recs = [
    { id: 1, memberId: 'm1', seconds: 60 },
    { id: 2, memberId: 'm2', seconds: 60 },
    { id: 3, memberId: 'm1', seconds: 0 },
  ];
  assert.deepEqual(myRecords(recs, 'm1').map((r) => r.id), [1]);
});

test('editPatches sends only changed fields, one per request, time last', () => {
  const rec = normaliseRecord(raw);
  assert.deepEqual(editPatches(rec, { seconds: 5400, date: '2026-11-17', comment: 'review' }), []);
  assert.deepEqual(editPatches(rec, { seconds: 3600 }), [{ time: 3600 }]);
  assert.deepEqual(editPatches(rec, { seconds: 3600, date: '2026-11-16', comment: 'x' }), [
    { date: '2026-11-16' }, { comment: 'x' }, { time: 3600 },
  ]);
  assert.deepEqual(editPatches(rec, { comment: '' }), [{ comment: '' }]);
});

test('enteredAt shows time today and date otherwise', () => {
  const now = new Date(2026, 10, 18, 12, 0);
  assert.equal(enteredAt(new Date(2026, 10, 18, 9, 5).toISOString(), now), '09:05');
  assert.equal(enteredAt(new Date(2026, 10, 17, 22, 29).toISOString(), now), '17 Nov 22:29');
  assert.equal(enteredAt(null, now), '');
  assert.equal(enteredAt('nonsense', now), '');
});
