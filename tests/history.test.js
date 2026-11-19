import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History, makeStep, stepRequest } from '../src/lib/history.js';

const rec = { id: 7, date: '2026-11-16', comment: 'old', seconds: 3600, cardId: 'c' };

test('stepRequest moves a record either way and states what it must look like first', () => {
  const edit = makeStep(7, rec, { ...rec, seconds: 2700, comment: 'new' });
  assert.deepEqual(stepRequest(edit, 'undo'), {
    id: 7, patches: [{ comment: 'old' }, { time: 3600 }], expect: { date: '2026-11-16', comment: 'new', time: 2700 },
  });
  assert.deepEqual(stepRequest(edit, 'redo'), {
    id: 7, patches: [{ comment: 'new' }, { time: 2700 }], expect: { date: '2026-11-16', comment: 'old', time: 3600 },
  });
  const log = makeStep(8, { ...rec, seconds: 0 }, rec);
  assert.deepEqual(stepRequest(log, 'undo').patches, [{ time: 0 }]);
  assert.deepEqual(stepRequest(log, 'redo').patches, [{ time: 3600 }]);
  const del = makeStep(7, rec, { ...rec, seconds: 0 });
  assert.deepEqual(stepRequest(del, 'undo'), { id: 7, patches: [{ time: 3600 }], expect: { date: '2026-11-16', comment: 'old', time: 0 } });
});

test('History undoes and redoes in order, and a new change clears redo', async () => {
  const h = new History();
  const sent = [];
  const apply = async (req) => { sent.push(req.patches[0].time); };
  h.push(makeStep(1, { ...rec, seconds: 0 }, { ...rec, seconds: 600 }));
  h.push(makeStep(2, { ...rec, seconds: 0 }, { ...rec, seconds: 1200 }));
  assert.equal((await h.move('undo', apply)).id, 2);
  assert.equal((await h.move('undo', apply)).id, 1);
  assert.equal(await h.move('undo', apply), null);
  assert.equal((await h.move('redo', apply)).id, 1);
  assert.deepEqual(sent, [0, 0, 600]);
  h.push(makeStep(3, rec, rec));
  assert.equal(h.redo.length, 0);
  assert.equal(await h.move('redo', apply), null);
});

test('History keeps a step after a failed try, but drops it when the failure is permanent', async () => {
  const h = new History();
  h.push(makeStep(1, rec, { ...rec, seconds: 0 }));
  await assert.rejects(h.move('undo', async () => { throw new Error('offline'); }));
  assert.equal(h.undo.length, 1);
  await assert.rejects(h.move('undo', async () => { throw Object.assign(new Error('changed'), { permanent: true }); }));
  assert.equal(h.undo.length, 0);
  assert.equal(h.redo.length, 0);
});

test('History forgets the oldest steps past its limit', () => {
  const h = new History(2);
  for (const id of [1, 2, 3]) h.push(makeStep(id, rec, rec));
  assert.deepEqual(h.undo.map((s) => s.id), [2, 3]);
});
