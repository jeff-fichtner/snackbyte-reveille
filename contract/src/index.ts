/**
 * The seam between the orchestrator and an agent.
 *
 * An agent's base URL IS its identity. No server identifier, machine identifier,
 * or routing discriminator may ever appear in these types — a second controlled
 * server is a second address in configuration, never a parameter here
 * (Constitution I, DECISIONS 002). Adding one is an architecture change.
 */

/**
 * What the game server is, derived per request and never stored.
 *
 * `running` / `starting` / `stopped` are answers about the server. `error` is an
 * answer about an *operation* — it is never what `getState()` derives.
 */
export type ServerState = 'starting' | 'running' | 'stopped' | 'error';

/** Every agent response, for both verbs. */
export interface AgentResponse {
  state: ServerState;
  message?: string;
}
