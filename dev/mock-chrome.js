// Fake chrome.* so the side panel runs in a normal tab with made-up cards and records. Served by dev/serve.py.
// Inspect window.__mock: .records, .cards, .calls (every op the panel sent), .fail (set to an op name to make it fail).
(() => {
  const lists = { l1: 'Doing', l2: 'Backlog' };
  const cards = [
    { id: 'aaaaaaaaaaaaaaaaaaaaaaa1', name: 'Data pipeline', closed: false, idList: 'l1', pos: 1 },
    { id: 'aaaaaaaaaaaaaaaaaaaaaaa2', name: 'Website redesign', closed: false, idList: 'l1', pos: 2 },
    { id: 'aaaaaaaaaaaaaaaaaaaaaaa3', name: 'Team admin', closed: false, idList: 'l2', pos: 1 },
    { id: 'aaaaaaaaaaaaaaaaaaaaaaa4', name: 'Old archived card', closed: true, idList: 'l2', pos: 2 },
  ].map((c) => ({ ...c, listName: lists[c.idList], listPos: c.idList === 'l1' ? 0 : 1 }));
  const me = 'member0000000000000000001';
  let nextId = 5000;
  const rec = (cardId, date, h, comment = '', mins = 0) => ({
    id: nextId++, cardId, boardId: 'board1', memberId: me, date, time: Math.round(h * 3600), comment,
    createdAt: new Date(Date.now() - (60 - mins) * 60000).toISOString(),
  });
  const records = [
    rec(cards[0].id, '2026-11-16', 3, 'pipeline', 1), rec(cards[2].id, '2026-11-16', 1, '', 2),
    rec(cards[1].id, '2026-11-17', 4.5, 'design review', 3), rec(cards[0].id, '2026-11-18', 2, '', 4),
    rec(cards[3].id, '2026-11-10', 1, 'old'),
  ];
  const listeners = [];
  window.__mock = { records, cards, calls: [], fail: null };
  const ops = {
    context: () => ({ boardId: 'board1', member: { id: me, fullName: 'Test User' }, board: { name: 'Test board' } }),
    cards: () => cards,
    listTime: () => records,
    openCard: () => true,
    addTime: ({ cardId, date, time, comment }) => { const r = { ...rec(cardId, date, time / 3600, comment, 60) }; records.push(r); return r; },
    updateTime: ({ id, patches }) => {
      const r = records.find((x) => x.id === id);
      if (!r) throw new Error('not found');
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
