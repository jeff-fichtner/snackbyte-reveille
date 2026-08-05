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
 * WHAT MAY AND MAY NOT APPEAR HERE. 005 moved this line (DECISIONS 022): the rule is
 * **no KNOWLEDGE of content**, not **no MOVEMENT through content**. 003's older phrasing
 * — "Reveille toggles playback, never chooses what plays" — no longer describes the file.
 *
 *   Permitted : blind relative movement — `pl_next`, `pl_previous`, and a RELATIVE
 *               `seek`. None of them needs to know what is loaded.
 *   Forbidden : anything that does — `pl_jump` (a NOMINATED item, the sharpest contrast
 *               with `pl_next`), `pl_play`, `in_play`, `in_enqueue`, `pl_empty`,
 *               `pl_delete`; plus volume, `pl_stop`, and OS-level process termination.
 *   Forbidden : an ABSOLUTE seek (FR-011). A bare `val=30` seeks *to* 0:30 rather than
 *               forward 30s — silent and plausible-looking — so every seek carries an
 *               explicit sign.
 *
 * `vlc.test.ts` asserts all of the above against this source, and additionally pins the
 * exact request line each permitted command emits.
 */
import type { MediaState } from '@reveille/contract';
import type { VlcConfig } from './config.ts';
import type { MediaAdapter } from './adapter.ts';

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
  const res = await vlcFetch(config);
  const body = (await res.json()) as { state?: unknown };
  if (body.state === 'playing' || body.state === 'paused' || body.state === 'stopped') {
    return body.state;
  }
  throw new Error(`VLC reported an unrecognised state: ${JSON.stringify(body.state)}.`);
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
export async function next(config: VlcConfig): Promise<void> {
  await vlcFetch(config, NEXT_COMMAND);
}

/** Step to the previous item. Mirror of {@link next}. */
export async function previous(config: VlcConfig): Promise<void> {
  await vlcFetch(config, PREVIOUS_COMMAND);
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
    pause: () => pause(config),
    resume: () => resume(config),
    seek: (seconds: number) => seek(config, seconds),
    next: () => next(config),
    previous: () => previous(config),
  };
}
