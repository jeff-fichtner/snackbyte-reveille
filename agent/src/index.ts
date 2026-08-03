/**
 * The agent's HTTP server — one per controlled game server, welded to it.
 *
 * Direction is orchestrator -> agent, always. The agent never initiates
 * (Constitution I).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AgentResponse } from '@reveille/contract';
import { loadConfig, type AgentConfig } from './config.ts';
import { serialize } from './serialize.ts';
import { createAdapter, type GameAdapter } from './adapter.ts';

/**
 * Loopback, and NOT configurable.
 *
 * The control interface must never be reachable from the network (FR-013). Making
 * the bind address a setting would mean a stray edit could expose remote process
 * control on a home machine, so it is a constant. Widening it is a code change
 * that must arrive with authentication — the no-auth trade is only valid while
 * this holds (spec Assumptions).
 */
const BIND_ADDRESS = '127.0.0.1';

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
    // Launched but the control API is not answering yet, so there is nothing to ask
    // to save. Refused, and the launching process is left untouched (FR-017).
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

/** GET /status — the server's state, read-only. Changes nothing (FR-022, SC-005). */
async function handleStatus(adapter: GameAdapter): Promise<Outcome> {
  const state = await adapter.getState();
  return { status: 200, body: { state } };
}

/** The mutating verbs. POST-only; `/status` is handled before this, off the mutex. */
async function route(req: IncomingMessage, adapter: GameAdapter): Promise<Outcome> {
  const path = (req.url ?? '').split('?')[0];

  if (req.method !== 'POST') {
    return { status: 405, body: { state: 'error', message: 'Only POST is supported.' } };
  }

  switch (path) {
    case '/start':
      return await handleStart(adapter);
    case '/stop':
      return await handleStop(adapter);
    default:
      return { status: 404, body: { state: 'error', message: `No such endpoint: ${path}` } };
  }
}

export function createAgentServer(config: AgentConfig): ReturnType<typeof createServer> {
  const adapter = createAdapter(config);
  return createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];

    // `/status` is read-only and is polled (US3). It must NOT sit on the command
    // mutex: serialized, a poll would stall behind an in-flight /stop (which holds
    // the mutex through save + shutdown) and each poll would in turn delay real
    // commands. It is safe concurrently precisely because it only reads (contract
    // Rule 2). Handled here, ahead of the POST-only guard, so a GET is admitted.
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

// Entry point. Config is loaded first so a missing value fails at boot, loudly,
// before anything is listening.
const config = loadConfig();
const server = createAgentServer(config);

server.listen(config.port, BIND_ADDRESS, () => {
  process.stdout.write(`agent listening on http://${BIND_ADDRESS}:${config.port}\n`);
});
