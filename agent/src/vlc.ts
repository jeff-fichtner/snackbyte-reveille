/**
 * THE ONLY VLC-AWARE CODE IN THE SYSTEM.
 *
 * Nothing above this file knows the target is VLC, or even that it is a media
 * player rather than a game — the server dispatches by the adapter's `kind`
 * (adapter.ts), never by which target it is (FR-025). Swapping VLC for another
 * player is a different adapter here, not a change to the seam.
 *
 * This talks to VLC's built-in HTTP web interface over loopback, exactly as
 * observed during M0 — `specs/003-media-control/m0-vlc.md` for the endpoint, auth,
 * state values and the force pause/resume commands, and
 * `specs/005-more-media-commands/m0-vlc-controls.md` for the stepping and relative-seek
 * commands — not from docs. Plain HTTP with native `fetch`: the interface binds
 * `127.0.0.1` and speaks HTTP, so unlike Satisfactory there is no self-signed TLS and
 * therefore no `node:https`, and the agent keeps zero runtime dependencies.
 *
 * WHAT MAY AND MAY NOT APPEAR HERE. The line has moved twice. 005 (DECISIONS 022) went
 * from "no MOVEMENT through content" to "no KNOWLEDGE of content". 007 (DECISIONS 024)
 * corrects that phrasing: it was always about **persistence and opinions**, never about
 * **observation**. The rule is **mechanism, not policy** and **level-triggered, not
 * edge-triggered** — observe current reality, act, and forget.
 *
 *   Permitted : OBSERVING what the player reports in the response already fetched —
 *               the title, the position, the duration — and handing it upward to be
 *               told once and discarded. Nothing observed is ever stored (FR-011).
 *
 *   Permitted : blind relative movement — `pl_next`, `pl_previous`, and a RELATIVE
 *               `seek`. None of them needs to know what is loaded.
 *   Forbidden : CHOOSING content — `pl_jump` (a NOMINATED item, the sharpest contrast
 *               with `pl_next`), `pl_play`, `in_play`, `in_enqueue`, `pl_empty`,
 *               `pl_delete`; plus volume, `pl_stop`, and OS-level process termination.
 *               Selecting what plays is the operator's job; this file has no opinion.
 *   Forbidden : STORING anything about content between calls — no cache, no memo, no
 *               "last seen". Every reading is fresh, used once, and dropped.
 *   Forbidden : an ABSOLUTE seek (FR-011). A bare `val=30` seeks *to* 0:30 rather than
 *               forward 30s — silent and plausible-looking — so every seek carries an
 *               explicit sign.
 *
 * `vlc.test.ts` asserts all of the above against this source, and additionally pins the
 * exact request line each permitted command emits.
 */
import type { MediaState } from '@reveille/contract';
import type { VlcConfig } from './config.ts';
import type { MediaAdapter, MediaObservation } from './adapter.ts';

/** The status document and the command sink are the same endpoint (M0 §1, §4). */
const STATUS_PATH = '/requests/status.json';

/**
 * The **force** variants, not the toggles. `pl_pause` toggles, so it would flip the
 * wrong way if our read of the state were stale; forcing the target state is
 * idempotent, which is what the already-in-state no-op in the server relies on (M0 §4).
 */
const PAUSE_COMMAND = 'pl_forcepause';
const RESUME_COMMAND = 'pl_forceresume';

/**
 * Relative seek (005). **The sign prefix is what makes it relative** — measured, not
 * assumed (`m0-vlc-controls.md` §3): `val=%2B30` moves forward 30s and `val=-30` moves
 * back 30s, but a bare `val=30` is an **absolute** seek to 0:30. Sending the unsigned
 * form for "forward 30 seconds" would jump the show to the 30-second mark and look
 * plausible while doing it, which is why `vlc.test.ts` bans the unsigned form outright.
 */
const SEEK_COMMAND = 'seek';

/**
 * Blind playlist stepping (005). These take **no parameters** — that is precisely why
 * they are permitted: a step needs to know nothing about what is loaded, while
 * `pl_jump` (still banned) needs the playlist. That contrast is the line DECISIONS 022
 * draws, and `vlc.test.ts` enforces both halves of it.
 */
const NEXT_COMMAND = 'pl_next';
const PREVIOUS_COMMAND = 'pl_previous';

/** How long to wait on the loopback web interface before treating it as unreachable. */
const PROBE_TIMEOUT_MS = 2_000;

function authHeader(config: VlcConfig): string {
  // VLC's web interface uses Basic auth with an EMPTY username and the configured
  // password (M0 §2). A wrong/blank password returns 401 — a loud transport failure,
  // never a silent wrong-behaviour.
  return 'Basic ' + Buffer.from(`:${config.vlcPassword}`).toString('base64');
}

/**
 * Hit the web interface. `command` is issued as a `?command=` query on the status
 * endpoint, and the response is the post-command status either way. Throws on
 * transport failure, timeout, or a non-2xx (which the caller turns into a 500).
 */
async function vlcFetch(config: VlcConfig, command?: string): Promise<Response> {
  const url = command
    ? `${config.vlcBaseUrl}${STATUS_PATH}?command=${command}`
    : `${config.vlcBaseUrl}${STATUS_PATH}`;
  const res = await fetch(url, {
    headers: { Authorization: authHeader(config) },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`VLC web interface returned HTTP ${res.status}.`);
  }
  return res;
}

/**
 * What the player is doing right now, derived by asking — never remembered (FR-012).
 *
 * VLC's three `state` strings are exactly the contract's three `MediaState` values
 * (M0 §3), so this is a direct pass-through. An unexpected value is thrown rather
 * than coerced: guessing a state would be precisely the silent-wrong-behaviour the
 * fail-loud rule forbids.
 */
export async function getState(config: VlcConfig): Promise<MediaState> {
  return (await observe(config)).state;
}

/**
 * State AND what the player says is loaded, from ONE read (007).
 *
 * Every field path here was **measured**, not read from documentation
 * (`specs/007-better-replies/m0-vlc-metadata.md`), and the measurement caught two traps
 * that a plausible implementation would have walked straight into:
 *
 *   1. **`information.title` is an integer title INDEX, not a name** — it measured `0`.
 *      Reaching for the obvious-looking field yields a number that would render as a
 *      perfectly plausible title. The name lives at `information.category.meta.title`.
 *   2. **The whole `information` block disappears when nothing is loaded** — not merely
 *      the title. A direct `body.information.category.meta.title` THROWS on a stopped
 *      player, so the block is guarded rather than the field.
 *
 * The title/filename fallback happens **here** rather than in the orchestrator, so one
 * settled name crosses the seam (FR-009). Measured: VLC does NOT synthesise a title from
 * the filename, so both branches are live. Shortening a long name is a *presentation*
 * decision and deliberately does NOT happen here (FR-005, FR-009a).
 */
export async function observe(config: VlcConfig): Promise<MediaObservation> {
  const res = await vlcFetch(config);
  const body = (await res.json()) as {
    state?: unknown;
    time?: unknown;
    length?: unknown;
    information?: { category?: { meta?: { title?: unknown; filename?: unknown } } };
  };

  if (body.state !== 'playing' && body.state !== 'paused' && body.state !== 'stopped') {
    throw new Error(`VLC reported an unrecognised state: ${JSON.stringify(body.state)}.`);
  }

  // Trap 2: guard the block, not the field.
  const meta = body.information?.category?.meta;
  const title = typeof meta?.title === 'string' && meta.title.trim() !== ''
    ? meta.title
    : typeof meta?.filename === 'string' && meta.filename.trim() !== ''
      ? meta.filename
      : undefined;

  return {
    state: body.state,
    ...(title !== undefined ? { title } : {}),
    ...(positive(body.time) ? { elapsedSeconds: body.time } : {}),
    // Measured: `length` is 0 when there is no total (and when nothing is loaded). Zero
    // means ABSENT, not a zero-length item — reporting "of 0:00" would be invented detail.
    ...(positive(body.length) ? { totalSeconds: body.length } : {}),
  };
}

/** A usable whole-second reading. Rejects absent, negative, fractional, and 0-as-absent. */
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Force-pause the current item. The server only calls this when the state is
 * `playing` (it 409s on `stopped` and no-ops when already `paused`), so this just
 * issues the command. Throws if the interface cannot be reached.
 */
export async function pause(config: VlcConfig): Promise<void> {
  await vlcFetch(config, PAUSE_COMMAND);
}

/** Force-resume the paused item. Mirror of {@link pause}. */
export async function resume(config: VlcConfig): Promise<void> {
  await vlcFetch(config, RESUME_COMMAND);
}

/**
 * Move the position relative to now. `seconds` is signed — positive forward, negative
 * back — and is passed through **exactly as given**: no clamping, no capping, no range
 * check, and no conversion to a magnitude (FR-005). VLC honours absurd values literally
 * (M0 §5 measured `+99999` landing at t=100119 on a 240s item, and a negative time being
 * accepted and reported), and correcting for that would be precisely the outcome-checking
 * FR-003 forbids.
 *
 * A positive amount is percent-encoded (`%2B`) rather than sent as a raw `+`. VLC happened
 * to tolerate the raw form (M0 §4), but a `+` in a query string is form-encoded whitespace
 * by spec — the one character that decides relative-vs-absolute must not rest on a parser's
 * leniency.
 *
 * The server has already rejected a missing or non-integer amount with a 400, which matters
 * more than it looks: M0 §6 measured `val=abc` parsing as 0 and applying as an absolute seek
 * to the START. A silent default here would be destructive, not merely wrong.
 */
export async function seek(config: VlcConfig, seconds: number): Promise<void> {
  const signed = seconds < 0 ? String(seconds) : `%2B${seconds}`;
  await vlcFetch(config, `${SEEK_COMMAND}&val=${signed}`);
}

/**
 * Step to the next playlist item. Issues the command and nothing else — the playlist is
 * never read, no item is counted or named, and no check is made that a next item exists.
 *
 * What happens next is the player's business and is neither inspected nor claimed: M0 §8
 * measured VLC **wrapping** from the last item back to the first even with no `--loop`
 * set, and §7 measured a step **resuming** a paused player. Both are recorded so replies
 * stay honest, not so this code compensates for them (FR-003).
 */
export async function next(config: VlcConfig, count: number): Promise<void> {
  await step(config, NEXT_COMMAND, count);
}

/** Step to the previous item. Mirror of {@link next}. */
export async function previous(config: VlcConfig, count: number): Promise<void> {
  await step(config, PREVIOUS_COMMAND, count);
}

/**
 * Issue a blind step `count` times (007).
 *
 * **VLC has no "next times N"** — `pl_next` takes no argument, so N really is N requests.
 * They are deliberately **sequential**, not concurrent: the player applies them in order,
 * and firing them in parallel would race for no benefit on a loopback interface measured
 * at ~22ms per call (`m0-vlc-metadata.md` §5).
 *
 * The caller holds the agent's command mutex for the whole of this, so the sequence is one
 * indivisible operation — no other command lands midway (FR-019). `/status` is unaffected:
 * it deliberately does not sit on that mutex.
 *
 * `count` is **not** bounded here (FR-016), and the cost of that is recorded rather than
 * fixed: a very large count holds the mutex for a very long time. Clamping it would be the
 * exact opinion this file is forbidden to hold.
 */
async function step(config: VlcConfig, command: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await vlcFetch(config, command);
  }
}

/**
 * Bind the functions above to a config, presenting the target-agnostic
 * `MediaAdapter` the rest of the agent speaks (adapter.ts). No behaviour of its
 * own — it only closes over `config` so nothing upstream has to thread it, and
 * nothing upstream has to know this is VLC.
 */
export function createVlcAdapter(config: VlcConfig): MediaAdapter {
  return {
    kind: 'media',
    getState: () => getState(config),
    observe: () => observe(config),
    pause: () => pause(config),
    resume: () => resume(config),
    seek: (seconds: number) => seek(config, seconds),
    next: (count: number) => next(config, count),
    previous: (count: number) => previous(config, count),
  };
}
