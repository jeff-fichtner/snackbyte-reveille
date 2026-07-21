/**
 * THE ONLY PALWORLD-AWARE CODE IN THE SYSTEM.
 *
 * Nothing above this file knows which game this is. Swapping Palworld for another
 * game is a different adapter here and a different deployment — not a change to
 * the seam (DECISIONS 001).
 *
 * `POST /v1/api/stop` (Palworld's force-stop) and OS-level process termination
 * MUST NOT appear anywhere in this file. A stop that cannot be graceful is not a
 * stop (Constitution IV, DECISIONS 009).
 */
import { execFile } from 'node:child_process';
import type { AgentConfig } from './config.ts';
import type { ServerState } from '@reveille/contract';

/** Process names that mean "a server exists", checked in that order of likelihood. */
const LAUNCHER_PROCESS = 'PalServer.exe';
const SERVER_PROCESS = 'PalServer-Win64-Shipping-Cmd.exe';

/** How long to wait on the REST API before treating it as not answering. */
const REST_PROBE_TIMEOUT_MS = 2_000;

function authHeader(config: AgentConfig): string {
  // The REST API uses Basic auth with a literal `admin` user.
  return 'Basic ' + Buffer.from(`admin:${config.palworldAdminPassword}`).toString('base64');
}

/** Call the Palworld REST API. Throws on transport failure or timeout. */
export async function restFetch(
  config: AgentConfig,
  path: string,
  init: RequestInit = {},
  timeoutMs = REST_PROBE_TIMEOUT_MS,
): Promise<Response> {
  return await fetch(`${config.palworldRestBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(config),
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** True when the REST API answers, which is the only proof the server is serving. */
async function restAnswers(config: AgentConfig): Promise<boolean> {
  try {
    const res = await restFetch(config, '/v1/api/info');
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * True when a Palworld process exists at all.
 *
 * Both names are checked because each covers the other's blind spot: the launcher
 * exists from the instant `spawn` returns, closing the window before the child
 * appears; the child covers the launcher exiting early while the server keeps
 * running (research R2). This answers "does something exist", never "is it up" —
 * the REST API answers that (DECISIONS 010).
 */
export async function serverProcessExists(): Promise<boolean> {
  const found = await new Promise<string>((resolve) => {
    execFile(
      'tasklist.exe',
      ['/FO', 'CSV', '/NH'],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => resolve(error ? '' : stdout),
    );
  });
  return found.includes(LAUNCHER_PROCESS) || found.includes(SERVER_PROCESS);
}

/**
 * Derive the server's state by asking, right now. Nothing is remembered between
 * calls (FR-012).
 *
 * Never returns `error` — that is an operation outcome, not a derived state.
 */
export async function getState(config: AgentConfig): Promise<Exclude<ServerState, 'error'>> {
  if (await restAnswers(config)) return 'running';
  if (await serverProcessExists()) return 'starting';
  return 'stopped';
}
