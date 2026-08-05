# Research: tenant isolation (004)

No `NEEDS CLARIFICATION` remained after `/speckit-clarify` (the one open choice —
shared vs. exclusive targets — was resolved: both, per target). This file records the
design decisions the plan rests on. All are orchestrator-side; the contract and agent do
not change.

## R1 — Configuration shape: a per-guild target map (`TENANTS`)

**Decision.** Replace the orchestrator's flat `AGENTS` array and the 003 stopgap's
comma-separated `DISCORD_GUILD_ID` with a single `TENANTS` value: a JSON array of
`{ guildId, name?, agents: [ {name, url, kind, publicPort?} ] }`. Each tenant is a guild id
mapped to the exact set of targets its members may control — the same per-target shape
001–003 already validate (`name`, `url`, `kind` game|media, `publicPort` for games only),
nested under a guild.

**Rationale.** The guild is the routing key and the isolation boundary, so the config is
keyed by guild. Reusing the existing per-target shape means the target validation from 003
is unchanged — only its *nesting* changes. A target is still addressed by `url` (its identity,
Constitution I); the guild scoping lives entirely in this structure, never in the contract.

**Alternatives considered.**
- *Keep `AGENTS` flat + a separate `guild → [names]` map.* Rejected: two structures to keep in
  sync, and a name would have to be globally unique across tenants (breaks per-tenant naming).
- *A `tenantId` threaded into the contract so agents self-identify.* Rejected outright —
  violates Constitution I (an agent's URL is its identity; no id in the seam).

## R2 — In-memory model: `Map<guildId, Tenant>`

**Decision.** At boot, `loadConfig` parses `TENANTS` into a `Map<guildId, Tenant>`, where a
`Tenant` holds its guild id, its optional label, and its own `Map<name, AgentClient>` plus
its own `Map<name, publicPort>` (games). Everything downstream resolves a tenant by
`interaction.guildId` and then operates **only within that tenant's maps**.

**Rationale.** One lookup by guild id yields the entire, isolated world a command may act on.
Isolation becomes a structural property (you literally hold only your tenant's maps), not a
filter that could be forgotten. It mirrors 003's existing per-name maps, just one level in.

**Alternatives considered.** A global name→agent map filtered by a guild-allowlist per call.
Rejected: isolation-by-filter is a bug waiting to happen (miss one call site and a guild
reaches another's target); isolation-by-structure cannot leak.

## R3 — Command registration: per guild, scoped to that guild's set

**Decision.** Register each guild's command set **to that guild**, built from **only that
tenant's targets** — reusing 003's kind-partitioned `buildCommands` (game verbs per game
target; bare `/pause`·`/play` if the tenant has a media target; `/status` always). Each guild
sees only its own targets in the picker (FR-003).

**Rationale.** 003 already registers per guild (the stopgap looped guilds) and already
partitions commands by kind; this narrows the input from "all targets" to "this tenant's
targets". A guild literally cannot submit a target it does not own, because the target is not
in its registered command surface.

**Alternatives considered.** Register a global command set and reject out-of-tenant targets at
runtime. Rejected: leaks the existence of other tenants' targets in the picker (violates
FR-012's "or their existence") and pushes isolation to a runtime check.

## R4 — Routing & the guild gate

**Decision.** The `interactionCreate` gate becomes "is `interaction.guildId` a configured
tenant?" — if not, ignore (FR-006). If yes, resolve that tenant and route the command **only
within its** `Map<name, AgentClient>`. `routeToAgent` and `handleStatus` take a tenant's maps,
never a global one.

**Rationale.** The existing single-guild gate (`guildId !== discordGuildId`) generalises to set
membership over configured tenants, and routing already goes through `routeToAgent` — it just
receives the tenant's map. One guild's command cannot name another's target because the other's
map is never in scope (FR-002).

**Alternatives considered.** Covered by R2 — structural scoping over per-call filtering.

## R5 — Shared vs. exclusive targets

**Decision.** A target may appear in more than one tenant's `agents` list (shared) or exactly
one (exclusive) — the operator's choice per target (FR-014, Clarifications). No special handling:
a shared target is simply the same `url` present in two tenants' maps. Target **names are scoped
to their tenant** — two tenants may reuse a name for different agents; the `url` stays globally
unique and is the identity.

**Rationale.** Shared-allowed is the superset (exclusivity is "don't list it twice"), so it
precludes nothing and keeps the current both-guilds-control-watson setup legal. Because each
tenant has its own name→agent map, a shared `url` in two maps needs no coordination — each
tenant routes its own command to that url independently.

**Alternatives considered.** Enforce exclusivity (a target belongs to exactly one guild).
Rejected in clarify — it would split the current setup and is strictly less flexible.

## R6 — `/status` is scoped to the tenant

**Decision.** `/status` in a guild queries **only that tenant's** agents and folds them into one
reply, exactly as 003 does but over the tenant's map (FR-012). It reveals nothing about any other
tenant's targets or their existence.

**Rationale.** `handleStatus` already queries "every agent" and folds; narrowing "every agent" to
"this tenant's agents" is the whole change. Read-only and off the command mutex, unchanged.

**Alternatives considered.** A cross-tenant/global operator view. Explicitly out of scope (spec)
— additive later with no rework.

## R7 — Migration: reject the stopgap shape loudly

**Decision.** The old configuration — a flat `AGENTS` plus a comma-separated `DISCORD_GUILD_ID`
list sharing one target set — is **rejected at startup** with a message directing the operator to
the `TENANTS` shape (FR-011). It is never silently reinterpreted.

**Rationale.** Silently mapping the old shared shape onto the new scoped one would guess the
operator's intent (which guild owns what) — exactly the silent-default the fail-loud rule forbids.
A loud rejection makes migration a deliberate, one-time edit.

**Alternatives considered.** Auto-migrate the stopgap (every guild gets every target). Rejected:
that *is* the shared-everything behavior we are replacing, and guessing scope is unsafe.

## R8 — The contract and agent stay untouched (the readiness decision)

**Decision.** `contract/` and `agent/` are not opened. Tenancy is enforced entirely in the
orchestrator. The measurable form is SC-005: the seam types are unchanged and a 001–003
conformance check still passes.

**Rationale.** This is the whole "build it correct so off-box is additive later" bet. Because no
tenant/target id enters the seam and the agent never learns it belongs to a tenant, a future
off-box target is a different `url` (plus the auth of a separate spec) in a tenant's list — no
change here.
