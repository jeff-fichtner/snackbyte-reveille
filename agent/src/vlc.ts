/**
 * THE ONLY VLC-AWARE CODE IN THE SYSTEM.
 *
 * Nothing above this file knows the target is VLC, or even that it is a media
 * player rather than a game — the server dispatches by the adapter's `kind`
 * (adapter.ts), never by which target it is (FR-025). Swapping VLC for another
 * player is a different adapter here, not a change to the seam.
 *
 * This talks to VLC's built-in HTTP web interface over loopback, exactly as
 * observed during M0 (`specs/003-media-control/m0-vlc.md`) — not from docs. Plain
 * HTTP with native `fetch`: the interface binds `127.0.0.1` and speaks HTTP, so
 * unlike Satisfactory there is no self-signed TLS and therefore no `node:https`,
 * and the agent keeps zero runtime dependencies.
 *
 * What MUST NOT appear here (FR-004, FR-011): no OS-level process termination, and
 * no content control of any kind — no playlist, no file/item selection, no seek, no
 * volume. Reveille toggles playback of whatever the operator already loaded; it
 * never chooses or changes *what* plays. `vlc.test.ts` asserts these bans on the
 * source.
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
  };
}
