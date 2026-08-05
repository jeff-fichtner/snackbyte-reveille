/**
 * Orchestrator configuration, read from the environment at startup.
 *
 * Every value is required and none has a fallback. A missing or blank value throws
 * here, at boot, naming the variable. `DISCORD_BOT_TOKEN` is a credential and the
 * repository is public.
 *
 * Since 004 the orchestrator is multi-tenant: `TENANTS` maps each Discord guild to
 * the set of targets its members may control. A guild sees and reaches ONLY its own
 * targets (isolation). No tenant or target id ever enters the contract — an agent's
 * URL is still its identity (Constitution I); tenancy is enforced here, not in the seam.
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
 * One controlled target, as the orchestrator knows it: a human name, the agent's
 * base URL (which IS the agent's identity — Constitution I), and, for a game, the
 * public port players connect to. The name lives ONLY here and on the Discord
 * surface, and is unique WITHIN its tenant; it never enters the contract (DECISIONS 002).
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

/**
 * A tenant: one Discord guild scoped to its own set of targets (004). The `guildId`
 * is the routing key AND the isolation boundary — a command from this guild may reach
 * only these `servers`. A target address MAY appear under more than one tenant
 * (shared) or exactly one (exclusive); both are valid (FR-014). One orchestrator holds
 * every tenant (Constitution II) — the bot does not multiply.
 */
export interface Tenant {
  readonly guildId: string;
  readonly name?: string;
  readonly servers: readonly ControlledServer[];
}

export interface OrchestratorConfig {
  readonly discordBotToken: string;
  readonly discordApplicationId: string;
  /**
   * Guild id → the tenant it names. Every configured guild; each isolated to its own
   * targets. Replaces 001's flat `AGENTS` + the 003 stopgap's `DISCORD_GUILD_ID`
   * comma-list. Never empty.
   */
  readonly tenants: ReadonlyMap<string, Tenant>;
  /**
   * How long, in ms, the US3 follow-up watches a just-launched server before it
   * gives up and posts "could not confirm" (FR-029). Required — a missing bound
   * would mean an unbounded wait. The `.env.example` suggests ~2min (SC-001).
   */
  readonly followupTimeoutMs: number;
}

/** Discord subcommand names — and therefore target names — are `[a-z0-9_-]{1,32}`. */
const NAME_PATTERN = /^[a-z0-9_-]{1,32}$/;

/**
 * Validate one tenant's `agents` list — the existing 003 per-target rules, only the
 * nesting changed. Names are unique WITHIN this list (a tenant); they may repeat
 * across tenants. Fails loud naming the offending entry.
 */
export function parseServers(rawAgents: unknown, where: string): readonly ControlledServer[] {
  if (!Array.isArray(rawAgents) || rawAgents.length === 0) {
    throw new Error(`${where}.agents must be a non-empty array of targets.`);
  }
  const seen = new Set<string>();
  return rawAgents.map((entry, i): ControlledServer => {
    const at = `${where}.agents[${i}]`;
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`${at} must be an object like {"name","url","kind"}.`);
    }
    const { name, url, kind, publicPort } = entry as Record<string, unknown>;

    if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
      throw new Error(`${at}.name must match ${NAME_PATTERN} (Discord subcommand rules), got ${JSON.stringify(name)}.`);
    }
    if (seen.has(name)) {
      throw new Error(`${at}.name duplicates another target ${JSON.stringify(name)} in the same tenant.`);
    }
    seen.add(name);

    if (typeof url !== 'string' || url.trim() === '') {
      throw new Error(`${at}.url must be a non-empty agent base URL, got ${JSON.stringify(url)}.`);
    }
    if (kind !== 'game' && kind !== 'media') {
      throw new Error(`${at}.kind must be 'game' or 'media', got ${JSON.stringify(kind)}.`);
    }
    const baseUrl = url.trim().replace(/\/+$/, '');

    // A game names a public port players connect to (/address); a media target has none.
    if (kind === 'game') {
      if (!Number.isInteger(publicPort) || (publicPort as number) <= 0) {
        throw new Error(`${at}.publicPort must be a positive integer for a game, got ${JSON.stringify(publicPort)}.`);
      }
      return { name, baseUrl, kind, publicPort: publicPort as number };
    }
    if (publicPort !== undefined) {
      throw new Error(`${at}.publicPort must be omitted for a media target (nothing is forwarded), got ${JSON.stringify(publicPort)}.`);
    }
    return { name, baseUrl, kind };
  });
}

/**
 * Parse `TENANTS` into a `guildId → Tenant` map, failing loud on anything malformed.
 * The shape is a JSON array of `{ guildId, name?, agents: [ {name,url,kind,publicPort?} ] }`.
 *
 * The 003 stopgap shape (a flat `AGENTS` and/or a `DISCORD_GUILD_ID` used for routing)
 * is REJECTED with a migration message rather than silently reinterpreted (FR-011) —
 * guessing which guild owns which target is exactly the silent-default the fail-loud
 * rule forbids.
 */
export function parseTenants(env: NodeJS.ProcessEnv = process.env): ReadonlyMap<string, Tenant> {
  if (env.AGENTS !== undefined || env.DISCORD_GUILD_ID !== undefined) {
    throw new Error(
      'AGENTS / DISCORD_GUILD_ID were replaced by TENANTS in 004 (each guild scoped to ' +
        'its own targets). Remove them and set TENANTS — see orchestrator/.env.example. ' +
        'The old shared-target shape is not reinterpreted automatically.',
    );
  }

  const raw = required('TENANTS', env);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(`Environment variable TENANTS must be a JSON array — could not parse it (${why}).`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Environment variable TENANTS must be a non-empty JSON array of tenants.');
  }

  const tenants = new Map<string, Tenant>();
  parsed.forEach((entry, i) => {
    const where = `TENANTS[${i}]`;
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`${where} must be an object like {"guildId","agents":[…]}.`);
    }
    const { guildId, name, agents } = entry as Record<string, unknown>;

    if (typeof guildId !== 'string' || guildId.trim() === '') {
      throw new Error(`${where}.guildId must be a non-empty Discord guild id, got ${JSON.stringify(guildId)}.`);
    }
    if (tenants.has(guildId)) {
      throw new Error(`${where}.guildId duplicates an earlier tenant ${JSON.stringify(guildId)}.`);
    }
    if (name !== undefined && typeof name !== 'string') {
      throw new Error(`${where}.name must be a string when present, got ${JSON.stringify(name)}.`);
    }

    const servers = parseServers(agents, where);
    // Omit `name` entirely when absent (exactOptionalPropertyTypes: no `name: undefined`).
    const base = { guildId, servers };
    tenants.set(guildId, typeof name === 'string' ? { ...base, name } : base);
  });
  return tenants;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OrchestratorConfig {
  return {
    discordBotToken: required('DISCORD_BOT_TOKEN', env),
    discordApplicationId: required('DISCORD_APPLICATION_ID', env),
    tenants: parseTenants(env),
    followupTimeoutMs: requiredPositiveInt('FOLLOWUP_TIMEOUT_MS', env),
  };
}
