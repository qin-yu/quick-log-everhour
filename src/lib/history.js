// Undo and redo for the panel's writes. Every write changes one Everhour record, so a step is that record's
// before and after snapshots. A log goes from seconds 0 to its time; a delete goes from its time to 0. Everhour
// deletes by setting time to 0, so a record always survives and every step can be replayed either way.
import { editPatches } from './everhour.js';

const snapshot = (r) => ({ date: r.date, comment: r.comment ?? '', seconds: r.seconds });

/** One undoable change to record `id`. `meta` is carried along for messages, e.g. {noun: 'edit', what: 'Card, Mon 16 Nov'}. */
export const makeStep = (id, before, after, meta = {}) => ({ ...meta, id, before: snapshot(before), after: snapshot(after) });

/**
 * The updateTime request that moves a record across a step, as {id, patches, expect}.
 * `expect` is what the record must still look like, so nothing is overwritten if it was changed elsewhere since.
 */
export function stepRequest(step, direction) {
  const [from, to] = direction === 'undo' ? [step.after, step.before] : [step.before, step.after];
  return { id: step.id, patches: editPatches(from, to), expect: { date: from.date, comment: from.comment, time: from.seconds } };
}

export class History {
  constructor(limit = 50) {
    this.limit = limit;
    this.undo = [];
    this.redo = [];
  }

  /** Record a new change. Like any editor, it clears what could be redone. */
  push(step) {
    this.undo.push(step);
    if (this.undo.length > this.limit) this.undo.shift();
    this.redo = [];
  }

  clear() {
    this.undo = [];
    this.redo = [];
  }

  /**
   * Undo or redo the latest step with `apply(request)`. Returns the step, or null when there is nothing to do.
   * If apply throws, the step stays where it was so it can be tried again, unless the error has `permanent` set
   * (the record changed elsewhere, so the step can never apply cleanly).
   */
  async move(direction, apply) {
    const from = direction === 'undo' ? this.undo : this.redo;
    const to = direction === 'undo' ? this.redo : this.undo;
    const step = from.pop();
    if (!step) return null;
    try {
      await apply(stepRequest(step, direction));
    } catch (err) {
      if (!err?.permanent) from.push(step);
      throw err;
    }
    to.push(step);
    return step;
  }
}
