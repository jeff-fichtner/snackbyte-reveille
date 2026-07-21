/**
 * Agent configuration, read from the environment at startup.
 *
 * Every value is required and none has a fallback. A missing or blank value
 * throws here, at boot, naming the variable — never later, indirectly, as strange
 * behaviour. One of these is an admin credential and one bounds a data-loss
 * guarantee; neither may be guessed.
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

export interface AgentConfig {
  /** Port to listen on. The bind ADDRESS is not configurable — see index.ts. */
  readonly port: number;
  /** Full path to PalServer.exe (the launcher, not the child). */
  readonly palworldExePath: string;
  /** Base URL of the Palworld REST API, loopback only. */
  readonly palworldRestBaseUrl: string;
  /** `AdminPassword` from PalWorldSettings.ini; REST Basic auth depends on it. */
  readonly palworldAdminPassword: string;
  /** Ceiling on a whole /stop. Exceeding it leaves the server running (FR-007). */
  readonly stopTimeoutMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  return {
    port: requiredPositiveInt('AGENT_PORT', env),
    palworldExePath: required('PALWORLD_EXE_PATH', env),
    palworldRestBaseUrl: required('PALWORLD_REST_BASE_URL', env).replace(/\/+$/, ''),
    palworldAdminPassword: required('PALWORLD_ADMIN_PASSWORD', env),
    stopTimeoutMs: requiredPositiveInt('STOP_TIMEOUT_MS', env),
  };
}
