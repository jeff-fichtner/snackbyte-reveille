# Data Model: tenant isolation (004)

Everything here is **orchestrator-side and in-memory**, built from configuration at boot and
never persisted (derive-don't-store). The contract types (`contract/`) are unchanged.

## Entities

### Tenant

A Discord guild mapped to the set of targets its members may control. The unit of isolation.

| Field | Type | Notes |
|-------|------|-------|
| `guildId` | string | The Discord guild id. **The routing key and the isolation boundary.** Unique across tenants. |
| `name` | string? | Optional human label for logs/errors. Not used for routing. |
| `servers` | `ControlledServer[]` | This tenant's targets — the **existing 003 shape**, unchanged: `{ name, baseUrl, kind: 'game'\|'media', publicPort? }`. Non-empty. |

Derived at load into per-tenant maps for O(1) routing:
- `agents: Map<name, AgentClient>` — one client per target in this tenant.
- `ports: Map<name, number>` — public ports for this tenant's **game** targets (for `/address`).

### Target (unchanged from 001–003)

A controllable thing on a host, addressed by its agent's URL. **This feature does not change
the target, its agent, or the contract.** A target is identified globally by its `baseUrl`
(Constitution I); its `name` is identified **only within its tenant**.

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | `[a-z0-9_-]{1,32}` (Discord subcommand rules). Unique **within a tenant**; may repeat across tenants. |
| `baseUrl` | string | The agent's address = its identity. Globally unique. Opaque (loopback today; must not be assumed — FR-009). |
| `kind` | `'game' \| 'media'` | Selects the verb set (games: start/stop/address; media: pause/play; both: status). |
| `publicPort` | number? | Games only; required for a game, forbidden for media (as 003). |

### Orchestrator configuration (the shape that changes)

| Field | Type | Notes |
|-------|------|-------|
| `tenants` | `Map<guildId, Tenant>` | Replaces 001's flat `AGENTS` + the 003 stopgap's `DISCORD_GUILD_ID` comma-list. Non-empty. |
| `discordBotToken`, `discordApplicationId`, `followupTimeoutMs` | as today | Unchanged. |

`DISCORD_GUILD_ID` (single or comma-list) no longer exists as target-routing config — the guild
ids live inside `TENANTS`. Its presence in the old form triggers a loud migration error (FR-011).

## Relationships

```
OrchestratorConfig
  └── tenants: Map<guildId, Tenant>          (1 orchestrator → N tenants — FR-004: still ONE orchestrator)
        └── Tenant
              └── servers: ControlledServer[] (1 tenant → N targets, non-empty)
                    └── Target (by baseUrl)   (a Target/baseUrl MAY appear under >1 Tenant — shared; FR-014)
```

- **One orchestrator → many tenants.** The orchestrator does not multiply (Constitution II).
- **One tenant → many targets** (≥1; empty is a fail-loud error).
- **A target (by `baseUrl`) → one or many tenants.** Shared is allowed; exclusivity is "listed
  under one tenant only" (FR-014). Sharing needs no coordination — the same `baseUrl` simply
  appears in two tenants' maps.

## Validation rules (fail loud at startup — FR-010)

1. `TENANTS` present, non-blank, a non-empty JSON array — else refuse to start naming `TENANTS`.
2. Each tenant: `guildId` present and non-blank; **unique** across tenants (a duplicate guild is
   an error).
3. Each tenant's `servers`: a **non-empty** array; each entry validated by the existing 003 rules
   (`name` pattern; `kind` ∈ {game, media}; game requires positive-int `publicPort`; media forbids
   it; `baseUrl` non-empty, trailing slash normalised).
4. `name` unique **within** a tenant (may repeat across tenants).
5. The **old shape** (`AGENTS` and/or a `DISCORD_GUILD_ID` used for routing) present → refuse to
   start with a migration message (FR-011). No silent reinterpretation.
6. Every other required variable unchanged and still fail-loud.

## The isolation invariant (the thing tests assert)

> For any interaction from guild `g`: the set of targets reachable by that command equals exactly
> `tenants.get(g).servers`, and is empty (the command is ignored) when `g ∉ tenants`.

Structural, not filtered: a command handler is only ever handed the resolved tenant's maps, so a
target outside the tenant is **not in scope** — it cannot be named, routed to, or revealed
(FR-002, FR-003, FR-012). A shared target is reachable from each tenant that lists it, and from no
other.

## No state transitions

Nothing here has a lifecycle. Tenants and their maps are built once at boot and are immutable for
the process's life; changing them is a configuration edit and a restart (FR-005). Per-interaction
routing derives from the immutable map — no stored state (contract Rule: no state between requests
holds, now per tenant).
