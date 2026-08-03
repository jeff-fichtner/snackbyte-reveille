/**
 * Agent configuration, read from the environment at startup.
 *
 * Every value is required and none has a fallback. A missing or blank value
 * throws here, at boot, naming the variable — never later, indirectly, as strange
 * behaviour. One of these is an admin credential and one bounds a data-loss
 * guarantee; neither may be guessed.
 *
 * `GAME` selects which adapter the agent runs. It is the ONE config value the rest
 * of the system branches on, and only at construction (adapter.ts) — nothing
 * downstream knows which game it is (FR-025). Which game-specific variables are
 * required follows from `GAME`: a Palworld agent is never asked for Satisfactory's
 * values, and vice versa.
 */

/** Read a required variable, or throw naming it. */
export function required(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy agent/.env.example to agent/.env and fill it in — there is no default.`,
    );
  }
  return raw.trim();
}

/** Read a required variable that must be a positive integer, or throw naming it. */
export function requiredPositiveInt(name: string, env: NodeJS.ProcessEnv = process.env): number {
  const raw = required(name, env);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `Environment variable ${name} must be a positive integer, got ${JSON.stringify(raw)}.`,
    );
  }
  return value;
}

/** The games this one binary can control, chosen per deployment by `GAME`. */
export type Game = 'palworld' | 'satisfactory';

/** Shared by every agent regardless of game. The bind ADDRESS is not here — see index.ts. */
interface CommonConfig {
  /** Port to listen on. Loopback-bound; a second agent is a second port. */
  readonly port: number;
  /** Ceiling on a whole /stop. Exceeding it leaves the server running (FR-007). */
  readonly stopTimeoutMs: number;
}

export interface PalworldConfig extends CommonConfig {
  readonly game: 'palworld';
  /** Full path to PalServer.exe (the launcher, not the child). */
  readonly palworldExePath: string;
  /** Base URL of the Palworld REST API, loopback only. */
  readonly palworldRestBaseUrl: string;
  /** `AdminPassword` from PalWorldSettings.ini; REST Basic auth depends on it. */
  readonly palworldAdminPassword: string;
}

export interface SatisfactoryConfig extends CommonConfig {
  readonly game: 'satisfactory';
  /** Base URL of the Satisfactory HTTPS API, loopback only (self-signed TLS). */
  readonly satisfactoryApiBaseUrl: string;
  /** Admin password set when the server was claimed; Bearer login depends on it. */
  readonly satisfactoryAdminPassword: string;
  /** The claimed session the server auto-loads and saves (M0, `m0-satisfactory.md`). */
  readonly satisfactorySessionName: string;
}

/**
 * One agent controls exactly one game. The `game` tag is the discriminant every
 * adapter narrows on; no other field is read across games.
 */
export type AgentConfig = PalworldConfig | SatisfactoryConfig;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const game = required('GAME', env);
  const port = requiredPositiveInt('AGENT_PORT', env);
  const stopTimeoutMs = requiredPositiveInt('STOP_TIMEOUT_MS', env);

  if (game === 'palworld') {
    return {
      game: 'palworld',
      port,
      stopTimeoutMs,
      palworldExePath: required('PALWORLD_EXE_PATH', env),
      palworldRestBaseUrl: required('PALWORLD_REST_BASE_URL', env).replace(/\/+$/, ''),
      palworldAdminPassword: required('PALWORLD_ADMIN_PASSWORD', env),
    };
  }

  if (game === 'satisfactory') {
    return {
      game: 'satisfactory',
      port,
      stopTimeoutMs,
      satisfactoryApiBaseUrl: required('SATISFACTORY_API_BASE_URL', env).replace(/\/+$/, ''),
      satisfactoryAdminPassword: required('SATISFACTORY_ADMIN_PASSWORD', env),
      satisfactorySessionName: required('SATISFACTORY_SESSION_NAME', env),
    };
  }

  // A missing GAME already threw above; this is a wrong one. Fail loud, naming the
  // valid values — never fall back to a default game (a silent default here would
  // control the wrong server).
  throw new Error(
    `Environment variable GAME must be 'palworld' or 'satisfactory', got ${JSON.stringify(game)}.`,
  );
}
