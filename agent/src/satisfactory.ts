/**
 * THE ONLY SATISFACTORY-AWARE CODE IN THE SYSTEM (alongside palworld.ts).
 *
 * Nothing above this file knows which game this is. A `GameAdapter` over
 * Satisfactory's official HTTPS API, spoken with the built-in `node:https` — no
 * runtime dependency, matching the agent's zero-dep rule (the API is self-signed
 * TLS on loopback, which `fetch` cannot be told to accept without one).
 *
 * Every fact here was observed against the real server during M0, not taken from
 * docs — see `specs/002-second-game-server/m0-satisfactory.md`. In particular:
 *   - the control API answers ~10s after launch on a session-less server, so "the
 *     API answers" is NOT "running"; `running` means `isGameRunning` is true.
 *   - the process to look for is `FactoryServer…`, never a loose `Factory…` match:
 *     the game CLIENT is `FactoryGameSteam-Win64-Shipping.exe` and would fool one.
 *
 * OS-level process termination MUST NOT appear in this file. Satisfactory's
 * `Shutdown` is graceful by construction; there is no force path, and none may be
 * added. A stop that cannot be graceful is not a stop (Constitution IV).
 */
import { request as httpsRequest } from 'node:https';
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { URL } from 'node:url';
import type { SatisfactoryConfig } from './config.ts';
import type { ServerState } from '@reveille/contract';
import type { GameAdapter } from './adapter.ts';

/** Launch flag the server was observed against during M0. */
const LAUNCH_ARGS = ['-log'];

/**
 * Process names that mean "a server exists", checked like Palworld's pair: the
 * launcher closes the window before the child appears; the child covers the
 * launcher exiting early (research R2). Both begin `FactoryServer` — which is what
 * keeps the game client (`FactoryGameSteam-Win64-Shipping.exe`) from counting.
 */
const LAUNCHER_PROCESS = 'FactoryServer.exe';
const SERVER_PROCESS = 'FactoryServer-Win64-Shipping.exe';

/** How long to wait on the HTTPS API before treating it as not answering. */
const API_PROBE_TIMEOUT_MS = 3_000;

interface ApiResult {
  readonly status: number;
  readonly json: unknown;
}

/**
 * Call the Satisfactory HTTPS API. Every function POSTs `{function, data}` to the
 * one `/api/v1` path; the token, when present, is a Bearer header.
 *
 * `rejectUnauthorized: false` is scoped to this loopback, self-signed endpoint —
 * the API presents a self-signed cert and is never reachable off-box (FR-014).
 * Throws on transport failure or timeout.
 */
function apiCall(
  config: SatisfactoryConfig,
  fn: string,
  data: Record<string, unknown>,
  token: string | undefined,
  timeoutMs: number,
): Promise<ApiResult> {
  const url = new URL(config.satisfactoryApiBaseUrl);
  const payload = JSON.stringify({ function: fn, data });
  return new Promise<ApiResult>((resolve, reject) => {
    const req = httpsRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        rejectUnauthorized: false,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...(token !== undefined ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          let json: unknown = undefined;
          try {
            json = body === '' ? {} : JSON.parse(body);
          } catch {
            json = {};
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Satisfactory API timed out after ${timeoutMs}ms`)));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/** Pull `data.authenticationToken` out of a login response, or undefined. */
function tokenOf(json: unknown): string | undefined {
  const t = (json as { data?: { authenticationToken?: unknown } })?.data?.authenticationToken;
  return typeof t === 'string' && t !== '' ? t : undefined;
}

/** Read `data.serverGameState.isGameRunning`. */
function isGameRunning(json: unknown): boolean {
  return (
    (json as { data?: { serverGameState?: { isGameRunning?: unknown } } })?.data?.serverGameState
      ?.isGameRunning === true
  );
}

/** True when a Satisfactory dedicated-server process exists — never the client. */
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
 * Bind the config into the `GameAdapter` the agent speaks. The admin token is
 * fetched once and reused (it is a stable per-privilege token, M0); a 401 re-logs
 * in once, in case the server was reclaimed.
 */
export function createSatisfactoryAdapter(config: SatisfactoryConfig): GameAdapter {
  let token: string | undefined;

  async function login(timeoutMs: number): Promise<string> {
    const { status, json } = await apiCall(
      config,
      'PasswordLogin',
      { MinimumPrivilegeLevel: 'Administrator', Password: config.satisfactoryAdminPassword },
      undefined,
      timeoutMs,
    );
    const t = tokenOf(json);
    if (status < 200 || status >= 300 || t === undefined) {
      throw new Error(`Satisfactory admin login failed (HTTP ${status}).`);
    }
    token = t;
    return t;
  }

  /** Call an admin function, logging in first and once more on a 401. */
  async function authed(fn: string, data: Record<string, unknown>, timeoutMs: number): Promise<ApiResult> {
    const res = await apiCall(config, fn, data, token ?? (await login(timeoutMs)), timeoutMs);
    if (res.status !== 401) return res;
    return await apiCall(config, fn, data, await login(timeoutMs), timeoutMs);
  }

  return {
    kind: 'game',
    /**
     * Derive the state by asking now (FR-012). `stopped` when no process exists;
     * `running` only once the world is actually up (`isGameRunning`); otherwise
     * `starting` — the process is up but the API is silent or the world has not
     * loaded yet. Never `error`, and never throws: any API failure while a process
     * exists is `starting`.
     */
    async getState(): Promise<Exclude<ServerState, 'error'>> {
      if (!(await serverProcessExists())) return 'stopped';
      try {
        const { status, json } = await authed('QueryServerState', {}, API_PROBE_TIMEOUT_MS);
        return status >= 200 && status < 300 && isGameRunning(json) ? 'running' : 'starting';
      } catch {
        return 'starting';
      }
    },

    /**
     * Launch and return the instant the spawn is issued — no wait, no verify
     * (FR-004). The world comes up on its own because the server's
     * `autoLoadSessionName` is set to the configured session (M0); this call only
     * starts the process, exactly as Palworld's does.
     */
    start(): void {
      if (!existsSync(config.satisfactoryExePath)) {
        throw new Error(`SATISFACTORY_EXE_PATH does not exist: ${config.satisfactoryExePath}`);
      }
      const child = spawn(config.satisfactoryExePath, LAUNCH_ARGS, {
        cwd: dirname(config.satisfactoryExePath),
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      // The server outlives the agent.
      child.unref();
      child.on('error', (error: Error) => {
        process.stderr.write(`spawn reported an error after launch was issued: ${error.message}\n`);
      });
    },

    /**
     * Save the world, verify the save was accepted, and only then shut down —
     * gracefully, never killed. If the save cannot be confirmed this throws with
     * the server LEFT RUNNING: losing progress is worse than any downtime
     * (Constitution IV, SC-002). The whole operation is bounded (FR-007).
     */
    async stop(): Promise<void> {
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

      // 1. Save, and VERIFY it was accepted. This is the whole guarantee (SC-002).
      let save: ApiResult;
      try {
        save = await authed('SaveGame', { SaveName: config.satisfactorySessionName }, remaining());
      } catch (error: unknown) {
        const why = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not save the world (${why}); server left running.`);
      }
      if (save.status < 200 || save.status >= 300) {
        throw new Error(`Could not save the world (save returned HTTP ${save.status}); server left running.`);
      }

      // 2. Only now may it be shut down — gracefully. There is no force path here.
      let shutdown: ApiResult;
      try {
        shutdown = await authed('Shutdown', {}, remaining());
      } catch (error: unknown) {
        const why = error instanceof Error ? error.message : String(error);
        throw new Error(`World saved, but shutdown could not be issued (${why}); server left running.`);
      }
      if (shutdown.status < 200 || shutdown.status >= 300) {
        throw new Error(
          `World saved, but shutdown returned HTTP ${shutdown.status}; server left running.`,
        );
      }
    },
  };
}
