/**
 * Mutual exclusion for command handling (T013a).
 *
 * Reading the state and then acting on it is a check-then-act: without this, two
 * concurrent `/start`s both read `stopped` before either spawns, and both launch —
 * exactly what FR-008 forbids. Concurrent commands must resolve to one clean
 * winner, never a half-executed pair.
 *
 * This is NOT retained state. Nothing survives the request; it only stops two
 * requests from interleaving, so FR-012 and the contract's no-state-between-
 * requests rule both still hold.
 */

/** Tail of the chain. Each queued task runs only after the previous settles. */
let tail: Promise<unknown> = Promise.resolve();

/** Run `task` once every previously-queued task has settled. */
export function serialize<T>(task: () => Promise<T>): Promise<T> {
  // Chain off a settled-either-way tail so one rejection cannot wedge the queue.
  const result = tail.then(task, task);
  tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
