/**
 * Which targets the console can command, and where they are (008 FR-011 – FR-015).
 *
 * Built **fresh on every invocation** and never cached — the console persists nothing
 * between runs (FR-016). There is no `TargetMap` living anywhere; there is a function that
 * produces one and a process that exits.
 *
 * Read from the **same tenant configuration the orchestrator reads**, through the
 * orchestrator's own `parseTenants`, and read **directly from the environment** — the
 * orchestrator process is never contacted. That is what lets every target command work
 * while the bot is stopped (FR-009), which is precisely when a local control path earns
 * its place.
 *
 * **Never built from `agent/.env.*`** (FR-015). Those files carry neither `kind` nor
 * `publicPort`, so a map derived from them would have to re-decide which verbs apply to
 * which target — the name→group lookup table this codebase forbids. The agents' env files
 * answer a different question (*which processes run on this box*), and `plane.ts` asks it.
 */
import { parseTenants, type Tenant } from '../config.ts';

/** One commandable target, as the console knows it. An agent's URL is its identity. */
export interface ConsoleTarget {
  readonly name: string;
  readonly baseUrl: string;
  readonly kind: 'game' | 'media';
  /** Games only — the port players connect to, for `address`. Media forwards nothing. */
  readonly publicPort: number | undefined;
}

/** How a tenant reads in an error: its friendly name when it has one, else its guild id. */
function describeTenant(tenant: Tenant): string {
  return tenant.name !== undefined ? `${tenant.name} (${tenant.guildId})` : tenant.guildId;
}

/**
 * The union of every tenant's targets, keyed by name (FR-012).
 *
 * The console has no guild, so it unions rather than picking one. **This is not an
 * isolation break**: 004's boundary is guild↔guild, and the host operator — who can already
 * reach every agent over loopback — sits outside it. What 004 protects is one *guild's
 * members* from reaching another guild's target, which is untouched.
 *
 * Throws, naming the variable, when the configuration is missing or malformed (FR-014).
 * There is no fallback map and no built-in default address.
 */
export function buildTargetMap(env: NodeJS.ProcessEnv = process.env): Map<string, ConsoleTarget> {
  const tenants = [...parseTenants(env).values()];
  const targets = new Map<string, ConsoleTarget>();
  // Remembered only to name the *other* tenant in a conflict — a conflict is reported with
  // both sides or it is not actionable.
  const origin = new Map<string, Tenant>();

  for (const tenant of tenants) {
    for (const server of tenant.servers) {
      const existing = targets.get(server.name);
      if (existing !== undefined) {
        // Same name, same address: the documented shared-target case (004 FR-014). One
        // target reachable by two guilds is one target, so it unions to a single entry.
        if (existing.baseUrl === server.baseUrl) continue;

        // Same name, DIFFERENT address. Picking either would command the wrong machine, and
        // it would do so silently — the exact shape of failure the no-silent-defaults rule
        // exists to prevent. Name both tenants: the operator has to know which two to fix.
        const first = origin.get(server.name);
        throw new Error(
          `Target ${JSON.stringify(server.name)} means two different machines: ` +
            `${existing.baseUrl} in tenant ${first ? describeTenant(first) : 'unknown'}, ` +
            `and ${server.baseUrl} in tenant ${describeTenant(tenant)}. ` +
            `The console has no guild, so it cannot choose between them — rename one in TENANTS.`,
        );
      }

      targets.set(server.name, {
        name: server.name,
        baseUrl: server.baseUrl,
        kind: server.kind,
        publicPort: server.kind === 'game' ? server.publicPort : undefined,
      });
      origin.set(server.name, tenant);
    }
  }

  return targets;
}

/**
 * The one media target the bare verbs act on (`pause`, `play`, `next`, …).
 *
 * `undefined` when there is none — the caller refuses in the member's own terms.
 *
 * **Throws when the union holds more than one.** `config.ts` already refuses a *tenant* with
 * two media targets, because the bare verbs cannot name a second; the union can reach the
 * same state from two tenants that each pass on their own. Same argument, same answer: the
 * alternative is silently commanding the first one found, which is a wrong action rather
 * than a failed one.
 */
export function resolveMediaTarget(
  targets: ReadonlyMap<string, ConsoleTarget>,
): ConsoleTarget | undefined {
  const media = [...targets.values()].filter((t) => t.kind === 'media');
  if (media.length > 1) {
    throw new Error(
      `TENANTS has more than one media target across its tenants (${media
        .map((t) => t.name)
        .join(', ')}). The media commands are bare and cannot name a second, ` +
        `so the console cannot choose — give the tenants a shared player, or run them separately.`,
    );
  }
  return media[0];
}
