/**
 * The agent's HTTP server — one per controlled game server, welded to it.
 *
 * Direction is orchestrator -> agent, always. The agent never initiates
 * (Constitution I).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AgentResponse } from '@reveille/contract';
import { loadConfig } from './config.ts';
import { serialize } from './serialize.ts';

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

async function route(req: IncomingMessage): Promise<{ status: number; body: AgentResponse }> {
  const path = (req.url ?? '').split('?')[0];

  if (req.method !== 'POST') {
    return { status: 405, body: { state: 'error', message: 'Only POST is supported.' } };
  }

  switch (path) {
    case '/start':
      // Implemented by US1 (T017).
      return { status: 501, body: { state: 'error', message: 'Not implemented yet.' } };
    case '/stop':
      // Implemented by US2 (T020).
      return { status: 501, body: { state: 'error', message: 'Not implemented yet.' } };
    default:
      return { status: 404, body: { state: 'error', message: `No such endpoint: ${path}` } };
  }
}

export function createAgentServer(): ReturnType<typeof createServer> {
  return createServer((req, res) => {
    // Every command runs to completion before the next begins (T013a).
    void serialize(() => route(req))
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
const server = createAgentServer();

server.listen(config.port, BIND_ADDRESS, () => {
  process.stdout.write(`agent listening on http://${BIND_ADDRESS}:${config.port}\n`);
});
