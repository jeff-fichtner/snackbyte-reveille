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
    return this.#request('POST', '/start');
  }

  stop(): Promise<AgentResult> {
    return this.#request('POST', '/stop');
  }

  /** Pause the media player (003, media agents only). */
  pause(): Promise<AgentResult> {
    return this.#request('POST', '/pause');
  }

  /** Resume the media player (003, media agents only). */
  play(): Promise<AgentResult> {
    return this.#request('POST', '/play');
  }

  /**
   * Move the position relative to now (005, media agents only). `seconds` is **signed** —
   * positive forward, negative back — and is the first data ever to cross the seam in a
   * request. It is a parameter of the *operation*, never a name for *which target*
   * (Constitution I, DECISIONS 023). An integer needs no escaping: `-` and digits are
   * already query-safe, and the agent rejects anything that is not an integer.
   */
  seek(seconds: number): Promise<AgentResult> {
    return this.#request('POST', `/seek?seconds=${seconds}`);
  }

  /**
   * Step `count` items forward (005; count added 007, media agents only).
   *
   * `count` is always a POSITIVE magnitude — the caller has already turned the sign into
   * a choice between this and {@link previous} (007 FR-005). It is a parameter of the
   * operation, never a name for which item (DECISIONS 023/024).
   */
  next(count: number): Promise<AgentResult> {
    return this.#request('POST', `/next?count=${count}`);
  }

  /** Step to the previous playlist item (005, media agents only). */
  previous(count: number): Promise<AgentResult> {
    return this.#request('POST', `/previous?count=${count}`);
  }

  /** Read-only state, for `/status` and the US3 follow-up. Never mutates. */
  status(): Promise<AgentResult> {
    return this.#request('GET', '/status');
  }

  async #request(method: string, path: string): Promise<AgentResult> {
    let res: Response;
    try {
      res = await fetch(`${this.#baseUrl}${path}`, {
        method,
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
