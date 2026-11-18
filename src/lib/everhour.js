// Shapes of Everhour Power-Up data. See docs/everhour-api.md.

/** Raw API record -> {id, date, seconds, comment, memberId, cardId, boardId, createdAt}. */
export function normaliseRecord(r) {
  return {
    id: Number(r.id),
    date: String(r.date ?? '').slice(0, 10),
    seconds: Math.max(0, Math.round(Number(r.time) || 0)),
    comment: r.comment ?? '',
    memberId: r.memberId,
    cardId: r.cardId,
    boardId: r.boardId,
    createdAt: r.createdAt ?? null,
  };
}

/** Records of one member that still count (deleted records have time 0). */
export const myRecords = (records, memberId) => records.filter((r) => r.memberId === memberId && r.seconds > 0);

/**
 * The PUTs needed to turn `rec` into `next`, one field per request like Everhour's own UI does.
 * Time goes last so the final response carries the card totals after every change.
 * next: {seconds?, date?, comment?}; undefined fields are left alone.
 */
export function editPatches(rec, next) {
  const out = [];
  if (next.date !== undefined && next.date !== rec.date) out.push({ date: next.date });
  if (next.comment !== undefined && next.comment !== rec.comment) out.push({ comment: next.comment });
  if (next.seconds !== undefined && next.seconds !== rec.seconds) out.push({ time: next.seconds });
  return out;
}

/** Local 'HH:MM' for today, 'D Mon HH:MM' otherwise; '' when unknown. */
export function enteredAt(iso, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return hm;
  return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })} ${hm}`;
}
