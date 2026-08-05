/**
 * The one boundary that knows a specific target — and the single place that selects
 * which one is active.
 *
 * There are two adapter *kinds*: a `GameAdapter` (a game server — start / stop) and a
 * `MediaAdapter` (a video player — pause / resume). Both derive their state. The HTTP
 * layer dispatches an adapter's verbs by its `kind` and never asks which specific
 * target it is (FR-025). Adding a target is a new adapter plus one `case` below —
 * never a change to anything above.
 */
import type { ServerState, MediaState } from '@reveille/contract';
import type { AgentConfig } from './config.ts';
import { createPalworldAdapter } from './palworld.ts';
import { createSatisfactoryAdapter } from './satisfactory.ts';
import { createVlcAdapter } from './vlc.ts';

export interface GameAdapter {
  readonly kind: 'game';
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

export interface MediaAdapter {
  readonly kind: 'media';
  /** What the player is doing right now — never remembered (FR-012). */
  getState(): Promise<MediaState>;
  /** Force-pause the current item. A no-op if already paused. */
  pause(): Promise<void>;
  /** Force-resume from where it paused. A no-op if already playing. */
  resume(): Promise<void>;
  /**
   * Move the position **relative to now** by `seconds` — positive forward, negative
   * back (005). Deliberately **unbounded**: never clamped, capped, or range-checked
   * (FR-005). The caller has already rejected a non-integer amount, and the direction
   * lives in the sign, not in the verb, which is why there is one method and not two.
   */
  seek(seconds: number): Promise<void>;
  /**
   * Step blindly to the next playlist item (005). Carries no id, index, or count, and
   * MUST NOT inspect the playlist or check whether a next item exists — a blind step is
   * what makes it permitted at all (DECISIONS 022).
   */
  next(): Promise<void>;
  /** Step blindly to the previous item. Mirror of {@link MediaAdapter.next}. */
  previous(): Promise<void>;
}

/** Either kind of adapter. The `kind` tag is how the server picks the verb set. */
export type Adapter = GameAdapter | MediaAdapter;

/**
 * Build the adapter named by `TARGET`. This `switch` is the only target branch in the
 * whole agent; everything else holds an `Adapter` and dispatches by its `kind`.
 */
export function createAdapter(config: AgentConfig): Adapter {
  switch (config.target) {
    case 'palworld':
      return createPalworldAdapter(config);
    case 'satisfactory':
      return createSatisfactoryAdapter(config);
    case 'vlc':
      return createVlcAdapter(config);
  }
}
