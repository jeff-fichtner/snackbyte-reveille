/**
 * Agent configuration, read from the environment at startup.
 *
 * Every value is required and none has a fallback. A missing or blank value
 * throws here, at boot, naming the variable — never later, indirectly, as strange
 * behaviour. One of these is an admin credential and one bounds a data-loss
 * guarantee; neither may be guessed.
 *
 * `TARGET` selects which adapter the agent runs — a game (`palworld`,
 * `satisfactory`) or the media player (`vlc`). It is the ONE config value the rest
 * of the system branches on, and only at construction (adapter.ts) — nothing
 * downstream knows which target it is (FR-025). Which target-specific variables are
 * required follows from `TARGET`: a Palworld agent is never asked for Satisfactory's
 * or VLC's values. (`TARGET` was `GAME` through 002; renamed in 003 because the
 * agent now controls targets, not only games.)
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

/** The targets this one binary can control, chosen per deployment by `TARGET`. */
export type Target = 'palworld' | 'satisfactory' | 'vlc';

/** Shared by every agent regardless of target. The bind ADDRESS is not here — see index.ts. */
interface CommonConfig {
  /** Port to listen on. Loopback-bound; a second agent is a second port. */
  readonly port: number;
}

export interface PalworldConfig extends CommonConfig {
  readonly target: 'palworld';
  /** Full path to PalServer.exe (the launcher, not the child). */
  readonly palworldExePath: string;
  /** Base URL of the Palworld REST API, loopback only. */
  readonly palworldRestBaseUrl: string;
  /** `AdminPassword` from PalWorldSettings.ini; REST Basic auth depends on it. */
  readonly palworldAdminPassword: string;
  /** Ceiling on a whole /stop. Exceeding it leaves the server running (FR-007). */
  readonly stopTimeoutMs: number;
}

export interface SatisfactoryConfig extends CommonConfig {
  readonly target: 'satisfactory';
  /** Full path to FactoryServer.exe (the launcher, not the child). */
  readonly satisfactoryExePath: string;
  /** Base URL of the Satisfactory HTTPS API, loopback only (self-signed TLS). */
  readonly satisfactoryApiBaseUrl: string;
  /** Admin password set when the server was claimed; Bearer login depends on it. */
  readonly satisfactoryAdminPassword: string;
  /** The claimed session the server auto-loads and saves (M0, `m0-satisfactory.md`). */
  readonly satisfactorySessionName: string;
  /** Ceiling on a whole /stop. Exceeding it leaves the server running (FR-007). */
  readonly stopTimeoutMs: number;
}

export interface VlcConfig extends CommonConfig {
  readonly target: 'vlc';
  /** Base URL of VLC's HTTP web interface, loopback only (plain HTTP). */
  readonly vlcBaseUrl: string;
  /** VLC's Lua HTTP password; Basic auth (empty user) depends on it. */
  readonly vlcPassword: string;
}

/**
 * One agent controls exactly one target. The `target` tag is the discriminant every
 * adapter narrows on; no other field is read across targets. Media (`vlc`) has no
 * `stopTimeoutMs` — it never stops a process, it controls playback of what is loaded.
 */
export type AgentConfig = PalworldConfig | SatisfactoryConfig | VlcConfig;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const target = required('TARGET', env);
  const port = requiredPositiveInt('AGENT_PORT', env);

  if (target === 'palworld') {
    return {
      target: 'palworld',
      port,
      palworldExePath: required('PALWORLD_EXE_PATH', env),
      palworldRestBaseUrl: required('PALWORLD_REST_BASE_URL', env).replace(/\/+$/, ''),
      palworldAdminPassword: required('PALWORLD_ADMIN_PASSWORD', env),
      stopTimeoutMs: requiredPositiveInt('STOP_TIMEOUT_MS', env),
    };
  }

  if (target === 'satisfactory') {
    return {
      target: 'satisfactory',
      port,
      satisfactoryExePath: required('SATISFACTORY_EXE_PATH', env),
      satisfactoryApiBaseUrl: required('SATISFACTORY_API_BASE_URL', env).replace(/\/+$/, ''),
      satisfactoryAdminPassword: required('SATISFACTORY_ADMIN_PASSWORD', env),
      satisfactorySessionName: required('SATISFACTORY_SESSION_NAME', env),
      stopTimeoutMs: requiredPositiveInt('STOP_TIMEOUT_MS', env),
    };
  }

  if (target === 'vlc') {
    return {
      target: 'vlc',
      port,
      vlcBaseUrl: required('VLC_BASE_URL', env).replace(/\/+$/, ''),
      vlcPassword: required('VLC_PASSWORD', env),
    };
  }

  // A missing TARGET already threw above; this is a wrong one. Fail loud, naming the
  // valid values — never fall back to a default (a silent default here would control
  // the wrong target).
  throw new Error(
    `Environment variable TARGET must be 'palworld', 'satisfactory', or 'vlc', got ${JSON.stringify(target)}.`,
  );
}
