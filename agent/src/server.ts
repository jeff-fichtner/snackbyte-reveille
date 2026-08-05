/**
 * The agent's HTTP server — one per controlled target, welded to it.
 *
 * Direction is orchestrator -> agent, always. The agent never initiates
 * (Constitution I). This module is side-effect-free: it builds a server from an
 * adapter and returns it; `index.ts` is the entry point that binds and listens.
 *
 * The verb set follows the adapter's `kind`: a game adapter answers `/start` and
 * `/stop`, a media adapter `/pause` and `/play`; both answer `/status`. The game
 * path is byte-for-byte what it was in 002 (FR-013).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AgentResponse } from '@reveille/contract';
import { serialize } from './serialize.ts';
import type { Adapter, GameAdapter, MediaAdapter } from './adapter.ts';

function send(res: ServerResponse, status: number, body: AgentResponse): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

interface Outcome {
  status: number;
  body: AgentResponse;
}

/**
 * POST /start — launch the server unless one is already up or coming up.
 *
 * The state read and the spawn are a check-then-act, which is only safe because
 * every command is serialized (T013a). Without that, two concurrent starts both
 * read `stopped` and both launch (FR-008).
 */
async function handleStart(adapter: GameAdapter): Promise<Outcome> {
  const state = await adapter.getState();

  // FR-008 forbids a second instance while running OR starting. `starting` is the
  // window where the process exists but the control API has not come up yet — before
  // DECISIONS 010 it was indistinguishable from `stopped`, and this spawned twice.
  if (state === 'running') {
    return { status: 409, body: { state, message: 'Server is already running.' } };
  }
  if (state === 'starting') {
    return { status: 409, body: { state, message: 'A start is already in progress.' } };
  }

  try {
    adapter.start();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 500, body: { state: 'error', message: `Failed to launch: ${message}` } };
  }

  // 202, not 200: the launch was issued. It is not a claim the server is up or
  // joinable, and the agent never finds out (FR-004).
  return { status: 202, body: { state: 'starting' } };
}

/**
 * POST /stop — save the world, then shut the server down.
 *
 * Refuses rather than forces in every ambiguous case. Nothing here may terminate a
 * process, and a stop is never queued for later: an unattended shutdown no player
 * directly commanded is forbidden outright (FR-010, FR-017).
 */
async function handleStop(adapter: GameAdapter): Promise<Outcome> {
  const state = await adapter.getState();

  if (state === 'stopped') {
    return { status: 409, body: { state, message: 'Server is already stopped.' } };
  }
  if (state === 'starting') {
    return {
      status: 409,
      body: { state, message: 'A start is in progress. Try again shortly.' },
    };
  }

  try {
    await adapter.stop();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    // The server is still running in every one of these paths, which is the point:
    // a stop that cannot be graceful is not a stop (Constitution IV).
    return { status: 500, body: { state: 'error', message } };
  }

  return { status: 200, body: { state: 'stopped' } };
}

/**
 * POST /pause — force-pause the current item (003, media agents only).
 *
 * A pause while already paused is a 200 no-op (nothing changed). Nothing loaded is
 * refused honestly (409) rather than pretended (FR-007, FR-008). No content is
 * selected or changed — only the play/pause state (FR-004).
 */
async function handlePause(adapter: MediaAdapter): Promise<Outcome> {
  const state = await adapter.getState();
  if (state === 'stopped') {
    return { status: 409, body: { state, message: 'Nothing is playing.' } };
  }
  if (state === 'paused') {
    // Already in the target state — a reported no-op, not a failure (FR-007).
    return { status: 200, body: { state: 'paused', message: 'Already paused.' } };
  }
  try {
    await adapter.pause();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 500, body: { state: 'error', message } };
  }
  return { status: 200, body: { state: 'paused' } };
}

/** POST /play — force-resume the paused item (003, media agents only). */
async function handleResume(adapter: MediaAdapter): Promise<Outcome> {
  const state = await adapter.getState();
  if (state === 'stopped') {
    return { status: 409, body: { state, message: 'Nothing is loaded to resume.' } };
  }
  if (state === 'playing') {
    return { status: 200, body: { state: 'playing', message: 'Already playing.' } };
  }
  try {
    await adapter.resume();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 500, body: { state: 'error', message } };
  }
  return { status: 200, body: { state: 'playing' } };
}

/**
 * POST /next and POST /previous — step blindly to the adjacent playlist item (005).
 *
 * No parameters: a blind step carries none, which is what makes it permitted. Same shape
 * and same tier as `/pause` — `stopped` is refused honestly, because M0 §9 measured both
 * commands no-opping silently with nothing loaded while still answering 200.
 *
 * A `200` here means the step was **issued**. It is not a claim that the item changed:
 * M0 §8 measured VLC wrapping at the playlist boundary, and checking for that would
 * require knowing the playlist (FR-002).
 */
async function handleStep(adapter: MediaAdapter, step: 'next' | 'previous'): Promise<Outcome> {
  const state = await adapter.getState();
  if (state === 'stopped') {
    return { status: 409, body: { state, message: 'Nothing is playing.' } };
  }
  try {
    await (step === 'next' ? adapter.next() : adapter.previous());
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 500, body: { state: 'error', message } };
  }
  return { status: 200, body: { state } };
}

/**
 * POST /seek?seconds=<signed integer> — move the position relative to now (005).
 *
 * `seconds` is **required and has no default here**. The 30-second default belongs to the
 * Discord surface, where a *member* may omit the argument; by the time a request reaches
 * the seam the amount is always explicit, so an absent or malformed one is a caller bug
 * and gets a 400 naming it. That is not pedantry: M0 §6 measured VLC parsing a non-numeric
 * `val` as 0 and applying it as an ABSOLUTE seek to the start, so quietly substituting a
 * default here would be destructive rather than merely wrong.
 *
 * The amount itself is otherwise unvalidated — no clamping, no range check (FR-005).
 */
async function handleSeek(adapter: MediaAdapter, req: IncomingMessage): Promise<Outcome> {
  const raw = new URL(req.url ?? '', 'http://agent.invalid').searchParams.get('seconds');
  if (raw === null || raw.trim() === '') {
    return {
      status: 400,
      body: { state: 'error', message: 'Missing required query parameter `seconds`.' },
    };
  }
  // Integer-only, sign allowed. `Number` alone would accept `1e3`, ` 12 `, and `0x1f`.
  if (!/^-?\d+$/.test(raw.trim())) {
    return {
      status: 400,
      body: {
        state: 'error',
        message: `Query parameter \`seconds\` must be an integer, got ${JSON.stringify(raw)}.`,
      },
    };
  }
  const seconds = Number(raw.trim());

  const state = await adapter.getState();
  // M0 §9: every media command no-ops SILENTLY with nothing loaded, and still answers
  // 200. Forwarding blind would report success for an action that did not happen.
  if (state === 'stopped') {
    return { status: 409, body: { state, message: 'Nothing is playing.' } };
  }
  try {
    await adapter.seek(seconds);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 500, body: { state: 'error', message } };
  }
  // 200 means ISSUED, never achieved: the position is not read back (FR-003), and M0 §5
  // showed VLC accepts absurd positions literally. `state` is what it was, not a claim.
  return { status: 200, body: { state } };
}

/** GET /status — the target's state, read-only. Changes nothing (FR-022, SC-005). */
async function handleStatus(adapter: Adapter): Promise<Outcome> {
  const state = await adapter.getState();
  return { status: 200, body: { state } };
}

/** The mutating verbs, dispatched by adapter kind. POST-only; `/status` is off the mutex. */
async function route(req: IncomingMessage, adapter: Adapter): Promise<Outcome> {
  const path = (req.url ?? '').split('?')[0];

  if (req.method !== 'POST') {
    return { status: 405, body: { state: 'error', message: 'Only POST is supported.' } };
  }

  if (adapter.kind === 'game') {
    switch (path) {
      case '/start':
        return await handleStart(adapter);
      case '/stop':
        return await handleStop(adapter);
      default:
        return { status: 404, body: { state: 'error', message: `No such endpoint: ${path}` } };
    }
  }

  switch (path) {
    case '/pause':
      return await handlePause(adapter);
    case '/play':
      return await handleResume(adapter);
    case '/seek':
      return await handleSeek(adapter, req);
    case '/next':
      return await handleStep(adapter, 'next');
    case '/previous':
      return await handleStep(adapter, 'previous');
    default:
      return { status: 404, body: { state: 'error', message: `No such endpoint: ${path}` } };
  }
}

export function createAgentServer(adapter: Adapter): ReturnType<typeof createServer> {
  return createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];

    // `/status` is read-only and is polled. It must NOT sit on the command mutex:
    // serialized, a poll would stall behind an in-flight command and each poll would
    // in turn delay real commands. It is safe concurrently precisely because it only
    // reads (contract Rule 2). Handled here, ahead of the POST-only guard, so a GET
    // is admitted.
    const settle = (out: Outcome): void => send(res, out.status, out.body);
    const fail = (error: unknown): void => {
      const message = error instanceof Error ? error.message : String(error);
      send(res, 500, { state: 'error', message });
    };

    if (req.method === 'GET' && path === '/status') {
      void handleStatus(adapter).then(settle).catch(fail);
      return;
    }

    // Every mutating command runs to completion before the next begins (T013a).
    void serialize(() => route(req, adapter))
      .then(settle)
      .catch(fail);
  });
}
