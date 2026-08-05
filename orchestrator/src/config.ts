/**
 * Orchestrator configuration, read from the environment at startup.
 *
 * Every value is required and none has a fallback. A missing or blank value throws
 * here, at boot, naming the variable. `DISCORD_BOT_TOKEN` is a credential and the
 * repository is public.
 */

export function required(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy orchestrator/.env.example to orchestrator/.env and fill it in — there is no default.`,
    );
  }
  return raw.trim();
}

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

/**
 * One controlled server, as the orchestrator knows it: a human name, the agent's
 * base URL (which IS the agent's identity — Constitution I), and the public port
 * players connect to for that game. The name lives ONLY here and on the Discord
 * surface; it never enters the contract (DECISIONS 002). Adding a server is one
 * more entry here plus deploying its agent (FR-024) — no code change.
 */
interface CommonServer {
  readonly name: string;
  readonly baseUrl: string;
}

/** A game target — `/start`/`/stop`/`/address` apply; it names a public port for `/address`. */
export interface GameServer extends CommonServer {
  readonly kind: 'game';
  readonly publicPort: number;
}

/** A media target — `/pause`/`/play` apply; nothing is forwarded, so no public port. */
export interface MediaServer extends CommonServer {
  readonly kind: 'media';
}

/** One controlled target, of either kind. The `kind` tag picks the verbs and the report. */
export type ControlledServer = GameServer | MediaServer;

export interface OrchestratorConfig {
  readonly discordBotToken: string;
  readonly discordApplicationId: string;
  readonly discordGuildId: string;
  /** Every server this orchestrator controls, keyed by name. Never empty. */
  readonly servers: readonly ControlledServer[];
  /**
   * How long, in ms, the US3 follow-up watches a just-launched server before it
   * gives up and posts "could not confirm" (FR-029). Required — a missing bound
   * would mean an unbounded wait. The `.env.example` suggests ~2min (SC-001).
   */
  readonly followupTimeoutMs: number;
}

/** Discord subcommand names — and therefore server names — are `[a-z0-9_-]{1,32}`. */
const NAME_PATTERN = /^[a-z0-9_-]{1,32}$/;

/**
 * Parse `AGENTS` into the server list, failing loud on anything malformed. The
 * shape is a JSON array of `{name, url, publicPort}`. A blank/empty/one-bad-entry
 * value throws naming `AGENTS` and the problem — never boots with a partial map.
 */
export function parseAgents(env: NodeJS.ProcessEnv = process.env): readonly ControlledServer[] {
  const raw = required('AGENTS', env);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(`Environment variable AGENTS must be a JSON array — could not parse it (${why}).`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Environment variable AGENTS must be a non-empty JSON array of servers.');
  }

  const seen = new Set<string>();
  return parsed.map((entry, i): ControlledServer => {
    const where = `AGENTS[${i}]`;
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`${where} must be an object like {"name","url","publicPort"}.`);
    }
    const { name, url, kind, publicPort } = entry as Record<string, unknown>;

    if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
      throw new Error(`${where}.name must match ${NAME_PATTERN} (Discord subcommand rules), got ${JSON.stringify(name)}.`);
    }
    if (seen.has(name)) {
      throw new Error(`${where}.name duplicates an earlier server name ${JSON.stringify(name)}.`);
    }
    seen.add(name);

    if (typeof url !== 'string' || url.trim() === '') {
      throw new Error(`${where}.url must be a non-empty agent base URL, got ${JSON.stringify(url)}.`);
    }
    if (kind !== 'game' && kind !== 'media') {
      throw new Error(`${where}.kind must be 'game' or 'media', got ${JSON.stringify(kind)}.`);
    }
    const baseUrl = url.trim().replace(/\/+$/, '');

    // A game names a public port players connect to (/address); a media target has none.
    if (kind === 'game') {
      if (!Number.isInteger(publicPort) || (publicPort as number) <= 0) {
        throw new Error(`${where}.publicPort must be a positive integer for a game, got ${JSON.stringify(publicPort)}.`);
      }
      return { name, baseUrl, kind, publicPort: publicPort as number };
    }
    if (publicPort !== undefined) {
      throw new Error(`${where}.publicPort must be omitted for a media target (nothing is forwarded), got ${JSON.stringify(publicPort)}.`);
    }
    return { name, baseUrl, kind };
  });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OrchestratorConfig {
  return {
    discordBotToken: required('DISCORD_BOT_TOKEN', env),
    discordApplicationId: required('DISCORD_APPLICATION_ID', env),
    discordGuildId: required('DISCORD_GUILD_ID', env),
    servers: parseAgents(env),
    followupTimeoutMs: requiredPositiveInt('FOLLOWUP_TIMEOUT_MS', env),
  };
}
