// MAIN-world script in every app.everhour.com/trello-powerup/* frame. See CLAUDE.md and docs/everhour-api.md.
//
// Every frame: wrap fetch and announce successful POST/PUT to /api/trello/time ("trello-fast:changed").
// Root frame only: capture the Power-Up client handle `t` that Trello gives Everhour, and serve the
// bridge's requests ("trello-fast:req" -> "trello-fast:res") using that handle, the way Everhour does.
(() => {
  if (window.__trelloFastHook) return;
  window.__trelloFastHook = true;

  const API = 'https://app.everhour.com/api';
  const IS_ROOT = /^\/trello-powerup\/(index\.html)?$/.test(location.pathname);
  const emit = (type, detail) => window.dispatchEvent(new CustomEvent(type, { detail: JSON.stringify(detail) }));
  const origFetch = window.fetch;

  // ---------------------------------------------------------------- change detection (all frames)
  window.fetch = async function (input, init) {
    const res = await origFetch.apply(window, arguments);
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url ?? '';
      const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (res.ok && (method === 'POST' || method === 'PUT') && url.startsWith(`${API}/trello/time`)) {
        res.clone().json()
          .then((rec) => emit('trello-fast:changed', { method, id: rec?.id ?? null, cardId: rec?.cardId ?? null }))
          .catch(() => emit('trello-fast:changed', { method, id: null, cardId: null }));
      }
    } catch { /* never break Everhour */ }
    return res;
  };

  if (!IS_ROOT) return;

  // ---------------------------------------------------------------- capture `t` (root frame)
  let boardT = null;
  let anyT = null;
  const waiters = [];
  const capture = (capability, t) => {
    if (!t || typeof t.jwt !== 'function' || typeof t.getContext !== 'function') return;
    anyT ??= t;
    if (capability === 'board-buttons') boardT = t;
    const ready = boardT ?? anyT;
    waiters.splice(0).forEach((resolve) => resolve(ready));
  };
  const wrapPowerUp = (TP) => {
    if (!TP || TP.__trelloFastWrapped || typeof TP.initialize !== 'function') return TP;
    const initialize = TP.initialize;
    TP.initialize = function (capabilities, ...rest) {
      const wrapped = {};
      for (const [name, fn] of Object.entries(capabilities ?? {})) {
        wrapped[name] = typeof fn === 'function'
          ? function (t, ...args) { try { capture(name, t); } catch { /* ignore */ } return fn.call(this, t, ...args); }
          : fn;
      }
      return initialize.call(this, wrapped, ...rest);
    };
    TP.__trelloFastWrapped = true;
    return TP;
  };
  let powerUp = window.TrelloPowerUp;
  if (powerUp) wrapPowerUp(powerUp);
  else {
    Object.defineProperty(window, 'TrelloPowerUp', {
      configurable: true,
      enumerable: true,
      get: () => powerUp,
      set: (value) => { powerUp = wrapPowerUp(value); },
    });
  }

  const getT = () => {
    const ready = boardT ?? anyT;
    if (ready) return Promise.resolve(ready);
    return new Promise((resolve, reject) => {
      waiters.push(resolve);
      setTimeout(() => reject(new Error('Everhour has not started on this board yet. Reload the Trello tab.')), 10000);
    });
  };

  // ---------------------------------------------------------------- Everhour API, as Everhour calls it
  async function api(t, method, path, body, state) {
    const jwt = await t.jwt(state ? { state: JSON.stringify(state) } : {});
    const res = await origFetch(API + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-jira-addon-token': jwt },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.text()).slice(0, 200); } catch { /* ignore */ }
      throw new Error(`Everhour ${method} ${path.split('?')[0]}: HTTP ${res.status}${msg ? ` ${msg}` : ''}`);
    }
    return res.status === 204 ? null : res.json();
  }

  let channel = null;
  // Mirror of Everhour's Store.getCardState + applyReportedTime + tSet: keep the card's pluginData totals in step.
  async function applyReportedTime(t, rec) {
    if (!rec?.card || !rec.cardId) return;
    const s = (await t.get(rec.cardId, 'shared')) ?? {};
    if (s.time === undefined) s.time = 0;
    if (s.estimate === undefined) s.estimate = 0;
    if (s.timeByUser === undefined) s.timeByUser = {};
    if (s.original === undefined) s.original = rec.cardId;
    if (s.original !== rec.cardId) Object.assign(s, { time: 0, estimate: 0, timeByUser: {}, original: rec.cardId, rate: 0, budget: 0, isShowBilling: false });
    const before = s.timeByUser[rec.memberId] || 0;
    const after = rec.card.timeByUser?.[rec.memberId] || 0;
    s.timeByUser[rec.memberId] = after;
    s.time += after - before;
    await t.set(rec.cardId, 'shared', s);
    try {
      channel ??= new BroadcastChannel(`eh-${t.secret.slice(0, 6)}`);
      channel.postMessage({ type: 'data-changed', cardId: rec.cardId });
    } catch { /* re-render is best effort */ }
  }

  const PATCH_CHECKS = {
    date: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v),
    comment: (v) => typeof v === 'string' && v.length <= 2000,
    time: (v) => Number.isInteger(v) && v >= 0 && v <= 24 * 3600,
  };

  const ops = {
    async context() {
      const t = await getT();
      const ctx = t.getContext();
      const [member, board] = await Promise.all([t.member('id', 'fullName', 'username'), t.board('id', 'name', 'url')]);
      return { boardId: ctx.board, member, board };
    },
    async listTime() {
      const t = await getT();
      const boardId = t.getContext().board;
      const records = await api(t, 'GET', '/trello/time', null, [boardId]);
      return (records ?? []).filter((r) => r.boardId === boardId);
    },
    async cards() {
      const t = await getT();
      return t.cards('id', 'name', 'url', 'closed');
    },
    async openCard({ cardId }) {
      const t = await getT();
      await t.showCard(cardId);
      return true;
    },
    // patches: [{date}|{comment}|{time}], applied in order, one PUT each (like Everhour). [{time: 0}] deletes.
    async updateTime({ id, patches }) {
      if (!Number.isInteger(id) || !Array.isArray(patches) || !patches.length) throw new Error('Bad update request');
      for (const p of patches) {
        const keys = Object.keys(p ?? {});
        if (keys.length !== 1 || !PATCH_CHECKS[keys[0]]?.(p[keys[0]])) throw new Error(`Bad field in update: ${keys.join(',')}`);
      }
      const t = await getT();
      const { board, member } = t.getContext();
      const current = await api(t, 'GET', `/trello/time/${id}`);
      if (current?.memberId !== member || current?.boardId !== board) throw new Error('That record is not yours on this board');
      let rec = current;
      for (const p of patches) rec = await api(t, 'PUT', `/trello/time/${id}`, p);
      await applyReportedTime(t, rec);
      return rec;
    },
  };

  window.addEventListener('trello-fast:req', async (event) => {
    let req;
    try { req = JSON.parse(event.detail); } catch { return; }
    const { rid, op, args } = req ?? {};
    if (!rid || !Object.hasOwn(ops, op)) return emit('trello-fast:res', { rid, ok: false, error: `Unknown request ${op}` });
    try {
      emit('trello-fast:res', { rid, ok: true, data: await ops[op](args ?? {}) });
    } catch (err) {
      emit('trello-fast:res', { rid, ok: false, error: String(err?.message ?? err) });
    }
  });
})();
