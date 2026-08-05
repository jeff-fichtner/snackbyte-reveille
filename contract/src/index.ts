/**
 * The seam between the orchestrator and an agent.
 *
 * An agent's base URL IS its identity. No server identifier, machine identifier,
 * or routing discriminator may ever appear in these types — a second controlled
 * server is a second address in configuration, never a parameter here
 * (Constitution I, DECISIONS 002). Adding one is an architecture change.
 */

/**
 * What a game server is, derived per request and never stored.
 *
 * `running` / `starting` / `stopped` are answers about the server. `error` is an
 * answer about an *operation* — it is never what a game adapter's `getState()` derives.
 */
export type ServerState = 'starting' | 'running' | 'stopped' | 'error';

/**
 * What a media player is doing, derived per request and never stored (003, seam v3).
 * A media agent answers `/status` in this vocabulary instead of `ServerState`; there
 * is no media `error` state (a read that fails to reach the player is a transport
 * fact the orchestrator classifies as unreachable, like the games').
 */
export type MediaState = 'playing' | 'paused' | 'stopped';

/**
 * Every agent response, for every verb. `state` is answered in the target's own
 * vocabulary — a game agent returns a `ServerState`, a media agent a `MediaState`.
 * Additive: v1/v2 game agents are unchanged (seam v3, additive).
 */
export interface AgentResponse {
  state: ServerState | MediaState;
  message?: string;
}
