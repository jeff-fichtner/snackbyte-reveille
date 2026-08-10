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
 *
 * v5 (007) adds three OPTIONAL observation fields. They are additive in fact and not
 * merely in name: a game agent sets none of them, and an agent that omits all three is
 * indistinguishable from a target with nothing to report — both render correctly,
 * because a missing part is omitted from the reply rather than filled in (FR-009).
 */
export interface AgentResponse {
  state: ServerState | MediaState;
  /**
   * Technical detail for the OPERATOR — logged, never shown to a member (007 FR-005,
   * FR-006). It is a diagnostic, so it MUST NOT be used to carry display content: that
   * is what the observation fields below are for. Overloading one field as both is how
   * internals reached the channel in the first place.
   */
  message?: string;
  /**
   * What the target observed is loaded — the player's title where it has one, its
   * filename where it does not, ABSENT where neither exists (007 FR-009). Never
   * truncated here: shortening is a presentation decision and belongs to the
   * orchestrator (FR-005, FR-009a).
   */
  title?: string;
  /** How far into the item the target is, right now, in whole seconds. */
  elapsedSeconds?: number;
  /** How long the item is, in whole seconds. Absent when the target has no total. */
  totalSeconds?: number;
}
