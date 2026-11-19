// Fake chrome.* so the side panel runs in a normal tab with made-up cards and records. Served by dev/serve.py.
// Inspect window.__mock: .records, .cards, .calls (every op the panel sent), .fail (set to an op name to make it fail).
(() => {
  const lists = { l1: 'In progress', l2: 'Ongoing' };
  const cards = [
    { id: 'aaaaaaaaaaaaaaaaaaaaaaa1', name: 'Data pipeline', closed: false, idList: 'l1', pos: 1 },
    { id: 'aaaaaaaaaaaaaaaaaaaaaaa2', name: 'Website redesign', closed: false, idList: 'l1', pos: 2 },
    { id: 'aaaaaaaaaaaaaaaaaaaaaaa3', name: 'Team admin', closed: false, idList: 'l2', pos: 1 },
    { id: 'aaaaaaaaaaaaaaaaaaaaaaa5', name: 'Training', closed: false, idList: 'l2', pos: 2 },
    { id: 'aaaaaaaaaaaaaaaaaaaaaaa4', name: 'Old archived card', closed: true, idList: 'l2', pos: 3 },
  ].map((c) => ({ ...c, listName: lists[c.idList], listPos: c.idList === 'l1' ? 0 : 1 }));
  const [pipeline, website, admin, training, archived] = ['1', '2', '3', '5', '4'].map((n) => `aaaaaaaaaaaaaaaaaaaaaaa${n}`);
  const me = 'member0000000000000000001';
  // Dates are relative to this week's Monday so the week view is never empty.
  const monday = new Date();
  monday.setHours(12, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const day = (n) => { const d = new Date(monday); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  let nextId = 5000;
  // Entered at the end of the day it was for, unless `at` says otherwise.
  const rec = (cardId, date, h, comment = '', at = null) => ({
    id: nextId++, cardId, boardId: 'board1', memberId: me, date, time: Math.round(h * 3600), comment,
    createdAt: (at ?? new Date(`${date}T17:${String(5 + ((nextId * 7) % 50)).padStart(2, '0')}:00`)).toISOString(),
  });
  const records = [
    rec(archived, day(-4), 1, 'old'),
    rec(pipeline, day(0), 3, 'nightly ingest job'), rec(admin, day(0), 1, 'weekly planning'),
    rec(website, day(1), 4.5, 'design review with Priya'), rec(training, day(1), 1.5, 'Python course, module 3'),
    rec(pipeline, day(2), 2, 'fix schema drift'), rec(website, day(2), 2.5, ''),
    rec(admin, day(3), 0.5, 'expenses'), rec(pipeline, day(3), 3, 'backfill October'),
  ];
  const listeners = [];
  window.__mock = { records, cards, calls: [], fail: null };
  const ops = {
    context: () => ({ boardId: 'board1', member: { id: me, fullName: 'Sam Taylor' }, board: { name: 'Team projects' } }),
    cards: () => cards,
    listTime: () => records,
    openCard: () => true,
    addTime: ({ cardId, date, time, comment }) => { const r = rec(cardId, date, time / 3600, comment, new Date()); records.push(r); return r; },
    updateTime: ({ id, patches, expect }) => {
      const r = records.find((x) => x.id === id);
      if (!r) throw new Error('not found');
      if (expect && (expect.date !== r.date || expect.comment !== r.comment || expect.time !== r.time)) {
        throw new Error('This entry was changed somewhere else since, so it was left as it is.');
      }
      for (const p of patches) Object.assign(r, p);
      return r;
    },
  };
  const ev = () => ({ addListener: (fn) => listeners.push(fn) });
  window.chrome = {
    windows: { getCurrent: async () => ({ id: 1 }) },
    tabs: {
      query: async () => [{ id: 7, url: 'https://trello.com/b/x/test' }],
      get: async () => ({ id: 7, url: 'https://trello.com/b/x/test' }),
      sendMessage: async (_tab, msg) => {
        window.__mock.calls.push(JSON.parse(JSON.stringify(msg)));
        await new Promise((r) => setTimeout(r, 120));
        if (window.__mock.fail && window.__mock.fail === msg.op) return { ok: false, error: 'Everhour PUT /trello/time/1: HTTP 403 mock' };
        try { return { ok: true, data: JSON.parse(JSON.stringify(ops[msg.op](msg.args ?? {}))) }; } catch (e) { return { ok: false, error: e.message }; }
      },
      onActivated: ev(), onUpdated: ev(),
    },
    runtime: { onMessage: ev() },
    storage: { local: { get: async () => ({}), set: async () => {} } },
  };
})();
