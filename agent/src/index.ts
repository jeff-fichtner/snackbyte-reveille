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
import { getState, start } from './palworld.ts';

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
async function handleStart(config: AgentConfig): Promise<Outcome> {
  const state = await getState(config);

  // FR-008 forbids a second instance while running OR starting. `starting` is the
  // window where the process exists but the REST API has not come up yet — before
  // DECISIONS 010 it was indistinguishable from `stopped`, and this spawned twice.
  if (state === 'running') {
    return { status: 409, body: { state, message: 'Server is already running.' } };
  }
  if (state === 'starting') {
    return { status: 409, body: { state, message: 'A start is already in progress.' } };
  }

  try {
    start(config);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 500, body: { state: 'error', message: `Failed to launch: ${message}` } };
  }

  // 202, not 200: the launch was issued. It is not a claim the server is up or
  // joinable, and the agent never finds out (FR-004).
  return { status: 202, body: { state: 'starting' } };
}

async function route(req: IncomingMessage, config: AgentConfig): Promise<Outcome> {
  const path = (req.url ?? '').split('?')[0];

  if (req.method !== 'POST') {
    return { status: 405, body: { state: 'error', message: 'Only POST is supported.' } };
  }

  switch (path) {
    case '/start':
      return await handleStart(config);
    case '/stop':
      // Implemented by US2 (T020).
      return { status: 501, body: { state: 'error', message: 'Not implemented yet.' } };
    default:
      return { status: 404, body: { state: 'error', message: `No such endpoint: ${path}` } };
  }
}

export function createAgentServer(config: AgentConfig): ReturnType<typeof createServer> {
  return createServer((req, res) => {
    // Every command runs to completion before the next begins (T013a).
    void serialize(() => route(req, config))
      .then((out) => send(res, out.status, out.body))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        send(res, 500, { state: 'error', message });
      });
  });
}

// Entry point. Config is loaded first so a missing value fails at boot, loudly,
// before anything is listening.
const config = loadConfig();
const server = createAgentServer(config);

server.listen(config.port, BIND_ADDRESS, () => {
  process.stdout.write(`agent listening on http://${BIND_ADDRESS}:${config.port}\n`);
});
