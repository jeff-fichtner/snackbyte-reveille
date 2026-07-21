/**
 * This side of the seam. The orchestrator's only way to reach an agent.
 *
 * Never import agent code directly — even while they share a machine, the call is
 * an HTTP call (Constitution I).
 */
import type { AgentResponse } from '@reveille/contract';

/** The agent answered. `status` matters: `starting` is both a 202 and a 409. */
export interface AgentReached {
  readonly reached: true;
  readonly status: number;
  readonly body: AgentResponse;
}

/**
 * The agent could not be reached at all — host off, asleep, or the agent not
 * running. Indistinguishable from each other at this stage, and deliberately
 * distinct from "the command failed on the host" (FR-009).
 */
export interface AgentUnreachable {
  readonly reached: false;
  readonly reason: string;
}

export type AgentResult = AgentReached | AgentUnreachable;

/** How long to wait on the agent before calling it unreachable. */
const DEFAULT_TIMEOUT_MS = 45_000;

export class AgentClient {
  readonly #baseUrl: string;
  readonly #timeoutMs: number;

  constructor(baseUrl: string, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.#baseUrl = baseUrl.replace(/\/+$/, '');
    this.#timeoutMs = timeoutMs;
  }

  start(): Promise<AgentResult> {
    return this.#post('/start');
  }

  stop(): Promise<AgentResult> {
    return this.#post('/stop');
  }

  async #post(path: string): Promise<AgentResult> {
    let res: Response;
    try {
      res = await fetch(`${this.#baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error: unknown) {
      // Transport failure only. A non-2xx is a REACHED host with an outcome.
      return { reached: false, reason: error instanceof Error ? error.message : String(error) };
    }

    let body: AgentResponse;
    try {
      body = (await res.json()) as AgentResponse;
    } catch {
      return {
        reached: true,
        status: res.status,
        body: { state: 'error', message: `Agent returned unreadable body (HTTP ${res.status}).` },
      };
    }

    return { reached: true, status: res.status, body };
  }
}
