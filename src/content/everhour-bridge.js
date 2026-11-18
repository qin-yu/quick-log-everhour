// Isolated-world script in every app.everhour.com/trello-powerup/* frame.
// Relays between chrome.runtime (side panel) and everhour-hook.js (MAIN world) with DOM events whose
// detail is a JSON string. Only the root frame answers requests; every frame forwards change notices.
(() => {
  const IS_ROOT = /^\/trello-powerup\/(index\.html)?$/.test(location.pathname);
  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => { /* panel closed */ });

  window.addEventListener('trello-fast:changed', (event) => {
    let detail = {};
    try { detail = JSON.parse(event.detail); } catch { /* ignore */ }
    send({ type: 'time-changed', method: detail.method, id: detail.id, cardId: detail.cardId });
  });

  if (!IS_ROOT) return;

  const pending = new Map();
  window.addEventListener('trello-fast:res', (event) => {
    let msg;
    try { msg = JSON.parse(event.detail); } catch { return; }
    const done = pending.get(msg?.rid);
    if (done) { pending.delete(msg.rid); done(msg); }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'everhour-op') return undefined;
    const rid = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(rid);
      sendResponse({ ok: false, error: 'Timed out waiting for Everhour' });
    }, 30000);
    pending.set(rid, (res) => { clearTimeout(timer); sendResponse({ ok: res.ok, data: res.data, error: res.error }); });
    window.dispatchEvent(new CustomEvent('trello-fast:req', { detail: JSON.stringify({ rid, op: msg.op, args: msg.args }) }));
    return true; // async sendResponse
  });

  send({ type: 'everhour-ready' });
})();
