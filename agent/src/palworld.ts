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
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentConfig } from './config.ts';
import type { ServerState } from '@reveille/contract';

/**
 * Launch flags, as used to observe the server's real behaviour during M0. Changing
 * them changes what the adapter was written against.
 */
const LAUNCH_ARGS = ['-useperfthreads', '-NoAsyncLoadingThread', '-UseMultithreadForDS'];

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

/**
 * Launch the game server and return the moment the spawn call succeeds.
 *
 * **Deliberately does not wait and does not verify the process survived.** A
 * server that dies immediately after launching is reported as started; the player
 * finds out by failing to join (spec Assumptions, Clarifications 2026-07-21).
 * "Started" therefore means the launch was issued without error — never a claim
 * the server stayed up (FR-004).
 *
 * Throws only if the launch itself could not be issued, which the caller reports
 * as a 500.
 */
export function start(config: AgentConfig): void {
  // Checking the path exists is config validation, not waiting on the server. It
  // turns the overwhelmingly common failure — a wrong PALWORLD_EXE_PATH — into a
  // clear message instead of a spawn that reports success and dies silently,
  // because `spawn` surfaces ENOENT asynchronously, after we have already
  // returned.
  if (!existsSync(config.palworldExePath)) {
    throw new Error(`PALWORLD_EXE_PATH does not exist: ${config.palworldExePath}`);
  }

  const child = spawn(config.palworldExePath, LAUNCH_ARGS, {
    cwd: dirname(config.palworldExePath),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });

  // The server outlives the agent: killing or restarting the agent must never
  // take the game server with it.
  child.unref();

  // Anything that goes wrong after this point is the server's business, not the
  // launch's. Log it and move on — reacting would be the verification the spec
  // explicitly defers.
  child.on('error', (error: Error) => {
    process.stderr.write(`spawn reported an error after launch was issued: ${error.message}\n`);
  });
}

/** Seconds Palworld counts down before shutting down, announced to anyone connected. */
const SHUTDOWN_WAIT_SECONDS = 1;

/**
 * Save the world, verify the save succeeded, and only then shut the server down.
 *
 * **Availability is disposable; durability is not** (Constitution IV). If the save
 * cannot be confirmed, this throws and the server is LEFT RUNNING — losing a
 * session's progress is categorically worse than any amount of downtime (FR-006).
 *
 * `POST /v1/api/stop` is Palworld's *force* stop and is banned by name, as is any
 * OS-level process termination. Neither may ever appear in a path reachable from
 * here: they are precisely the "kill it to satisfy the call" that Principle IV
 * rejects (DECISIONS 009).
 *
 * The whole operation is bounded (FR-007) — a stop that hangs forever is as bad as
 * one that loses data. Exceeding the bound throws with the server still running.
 */
export async function stop(config: AgentConfig): Promise<void> {
  const deadline = Date.now() + config.stopTimeoutMs;
  const remaining = (): number => {
    const left = deadline - Date.now();
    if (left <= 0) {
      throw new Error(
        `Stop exceeded its ${config.stopTimeoutMs}ms bound; server left running (FR-007).`,
      );
    }
    return left;
  };

  // 1. Save, and VERIFY it. This is the whole guarantee (SC-002).
  let saved: Response;
  try {
    saved = await restFetch(config, '/v1/api/save', { method: 'POST' }, remaining());
  } catch (error: unknown) {
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not save the world (${why}); server left running.`);
  }
  if (!saved.ok) {
    throw new Error(`Could not save the world (save returned HTTP ${saved.status}); server left running.`);
  }

  // 2. Only now may it be shut down — gracefully, never killed.
  let shutdown: Response;
  try {
    shutdown = await restFetch(
      config,
      '/v1/api/shutdown',
      {
        method: 'POST',
        body: JSON.stringify({ waittime: SHUTDOWN_WAIT_SECONDS, message: 'Stopping via Reveille' }),
      },
      remaining(),
    );
  } catch (error: unknown) {
    const why = error instanceof Error ? error.message : String(error);
    // The world IS saved at this point, so nothing is at risk — but the server is
    // still up and saying otherwise would be a lie.
    throw new Error(`World saved, but shutdown could not be issued (${why}); server left running.`);
  }
  if (!shutdown.ok) {
    throw new Error(
      `World saved, but shutdown returned HTTP ${shutdown.status}; server left running.`,
    );
  }
}
