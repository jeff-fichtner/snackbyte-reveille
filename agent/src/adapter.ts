/**
 * The one boundary that knows a specific game — and the single place that selects
 * which one is active.
 *
 * `GameAdapter` is the shape every game satisfies: derive the state, launch, and
 * stop gracefully. The HTTP layer, the serializer, and the orchestrator all speak
 * only this interface; none of them branches on which game it is (FR-025). Adding a
 * game is a new implementation of this interface plus one `case` below — never a
 * change to anything above.
 */
import type { ServerState } from '@reveille/contract';
import type { AgentConfig } from './config.ts';
import { createPalworldAdapter } from './palworld.ts';
import { createSatisfactoryAdapter } from './satisfactory.ts';

export interface GameAdapter {
  /**
   * The server's state, derived by asking right now — never remembered (FR-012).
   * `error` is an operation outcome, so it is not one of the states here.
   */
  getState(): Promise<Exclude<ServerState, 'error'>>;
  /** Launch, and return the instant the spawn is issued — no wait, no verify (FR-004). */
  start(): void;
  /** Save, verify, then shut down gracefully; throw rather than force (Constitution IV). */
  stop(): Promise<void>;
}

/**
 * Build the adapter named by `GAME`. This `switch` is the only game branch in the
 * whole agent; everything else holds a `GameAdapter` and never asks what it is.
 */
export function createAdapter(config: AgentConfig): GameAdapter {
  switch (config.game) {
    case 'palworld':
      return createPalworldAdapter(config);
    case 'satisfactory':
      return createSatisfactoryAdapter(config);
  }
}
