/**
 * The agent's entry point — loads config, binds the server, listens.
 *
 * The server logic lives in `server.ts` (side-effect-free, testable); this file is
 * the only place that reads the environment and opens a socket.
 */
import { loadConfig } from './config.ts';
import { createAdapter } from './adapter.ts';
import { createAgentServer } from './server.ts';

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

// Config is loaded first so a missing value fails at boot, loudly, before anything
// is listening.
const config = loadConfig();
const server = createAgentServer(createAdapter(config));

server.listen(config.port, BIND_ADDRESS, () => {
  process.stdout.write(`agent listening on http://${BIND_ADDRESS}:${config.port}\n`);
});
