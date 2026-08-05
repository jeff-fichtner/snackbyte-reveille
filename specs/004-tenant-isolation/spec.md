# Feature Specification: Each guild controls its own targets

**Feature Branch**: `004-tenant-isolation`

**Created**: 2026-08-04

**Status**: Draft

**Input**: User description: "Multi-tenancy. Replace the stopgap where several Discord guilds all drive one shared target set with proper isolation: each guild is scoped to its own set of controllable targets and cannot see or touch any other guild's. One orchestrator serves everyone (∞ guilds, ∞ targets). Build it correct so that putting a target on another machine later is an additive change (authentication + off-box addressing are a separate, future spec — out of scope now, and not needed for a long time). Keep the seam clean: no tenant or target identifier in the orchestrator↔agent contract."

## Overview

Reveille controls targets on a host from Discord. The 003 stopgap let the same commands
work in more than one guild — but every guild drove the **same** target set, so anyone in
any configured guild could control everything. That is multi-*guild*, not multi-*tenant*.

This feature makes each guild a **tenant**: a guild is mapped to its own set of targets,
and its members can see and control **only** that set. One guild's command can never reach
another guild's target, and a guild cannot even see targets that are not its own. A single
orchestrator still serves every tenant — the bot does not multiply.

It is deliberately scoped to **isolation and the tenancy model**, not to running targets on
other people's machines. Every target stays loopback-local to the orchestrator's own host,
exactly as today; no authentication and no network exposure is added. The value delivered
now is a correct, isolated model that replaces the shared-target stopgap. The value
protected for later is that putting a target on a different machine becomes a configuration
change (a different address plus the authentication a separate future spec will add), never
a rewrite of this one — because the seam is kept clean here.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A guild controls only its own targets (Priority: P1) 🎯 MVP

Two guilds are configured, each with its own set of targets. A member of guild A sees and
controls only A's targets; a member of guild B sees and controls only B's. Neither can see,
select, or reach the other's targets — the isolation is total from each guild's point of
view.

**Why this priority**: This is the whole feature. Isolation is the thing the stopgap lacks;
everything else is configuration and hygiene on top of it.

**Independent Test**: Configure guild A with target X and guild B with target Y (disjoint).
From A, only X is offered and only X responds; Y is neither listed nor reachable. From B,
the reverse. No command issued in one guild has any effect on the other's target.

**Acceptance Scenarios**:

1. **Given** guild A is scoped to target X and guild B to target Y, **When** a member of A opens the command picker, **Then** only X's commands are offered — Y does not appear.
2. **Given** the same configuration, **When** a member of A issues a command, **Then** it acts only on X, and Y is never touched (FR-002).
3. **Given** a target that both guilds are configured to control, **When** either guild commands it, **Then** it works from both — a target may be deliberately shared, and isolation means "only what is in your set", not "belongs to exactly one guild".
4. **Given** `/status` in guild A, **When** it runs, **Then** it reports only A's targets — never B's — each in its own vocabulary, as today.

---

### User Story 2 - Stand up a new tenant by configuration alone (Priority: P2)

The operator adds a new guild and the set of targets it may control. The bot registers that
guild's commands and routes them, with no code change — one more row, exactly like adding a
game or a target within a guild.

**Why this priority**: The isolation guarantee (US1) delivers the value; being able to add a
tenant without touching code is what makes it a *model* rather than a one-off. It also
proves the "more rows, never new kinds" test holds for tenants.

**Independent Test**: Add a third guild with its target set to configuration, restart, and
confirm its commands appear in that guild and route to its targets — with no code edited, and
the existing tenants unchanged.

**Acceptance Scenarios**:

1. **Given** a running control plane, **When** the operator adds a guild + its targets to configuration and restarts, **Then** that guild's commands appear in it and control its targets, and no other tenant's behavior changes.
2. **Given** a tenant is removed from configuration, **When** the control plane restarts, **Then** that guild is no longer served (its commands do nothing there) and the remaining tenants are unaffected.

---

### Edge Cases

- **A command arrives from an unconfigured guild.** Ignored — only configured guilds command
  anything. Trust is per-guild: each configured guild is private and trusted (the same
  posture as 001–003), now enforced per tenant.
- **A guild is configured with an empty target set, or a duplicate guild appears, or a target
  reference is unknown.** The orchestrator refuses to start, naming the problem — no silent
  fallback and no partially-served tenant.
- **A target appears in more than one guild's set.** Allowed and deliberate (a shared target).
  Each guild that lists it may control it; a guild that does not list it cannot. Isolation is
  set-membership, not exclusive ownership.
- **The same target name is used by two different tenants for two different agents.** Names
  are scoped to their tenant, so this is allowed — a name identifies a target *within* a
  guild, never globally. (An address still identifies an agent uniquely.)
- **The 003 stopgap configuration is still present** (one shared target set across a guild
  list). It is replaced by the per-guild target map; the old shape is rejected loudly at
  startup rather than silently reinterpreted.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every command MUST be scoped to the guild it originated from — a member of a
  guild may see and control **only** the targets configured for that guild.
- **FR-002**: A target configured for one guild MUST NOT be visible, selectable, or reachable
  from any other guild. One guild's command MUST NOT be able to reach another guild's target
  under any input.
- **FR-003**: The command surface a guild sees — the slash commands and the targets they name
  — MUST reflect only that guild's targets. A target that is not in a guild's set MUST NOT be
  selectable in that guild (an unknown target cannot even be submitted).
- **FR-004**: A **single** orchestrator MUST serve all tenants — exactly one bot and one
  control process, regardless of how many guilds or targets exist (Constitution II: the
  orchestrator does not multiply per tenant). Running one orchestrator per tenant is out of
  scope.
- **FR-005**: Adding, removing, or changing a tenant — a guild and the set of targets it may
  control — MUST be a **configuration change only**, with no code change (the acceptance test:
  more rows, never new kinds).
- **FR-006**: An interaction from a guild not present in the configuration MUST be ignored —
  no target is acted on. Only configured guilds may command anything.
- **FR-007**: A tenant MUST be modeled as a guild identifier mapped to a set of targets, each
  target identified by its agent's **address**. **No tenant identifier and no target
  identifier may enter the orchestrator↔agent contract** — an agent's address remains its
  identity (Constitution I). This is what keeps a future off-box target an additive change.
- **FR-008**: The agent MUST remain unchanged by this feature — it does not know it belongs to
  a tenant, it answers only its own verbs at its own address, and it is the same artifact as
  today. Tenancy is enforced entirely on the orchestrator side.
- **FR-009**: Configuration MUST treat each target's address as **opaque** — the tenancy model
  MUST NOT assume, require, or hard-code loopback. A future target on another machine must be
  reachable by supplying a different address (plus the authentication a separate future spec
  adds), never by restructuring tenancy. (This feature adds no such address and no
  authentication — see FR-013.)
- **FR-010**: A malformed tenant configuration — a duplicate guild, a guild with an empty
  target set, an unknown or malformed target reference, or a missing required value — MUST
  make the orchestrator **fail loud at startup**, naming the problem. No silent fallback and
  no partially-served tenant.
- **FR-011**: The 003 multi-guild stopgap — a single shared target set applied across a list
  of guilds — MUST be **replaced** by the per-guild target map. The stopgap's configuration
  shape MUST NOT be silently reinterpreted; if present, it is rejected loudly so the operator
  migrates deliberately.
- **FR-012**: `/status` issued in a guild MUST report only that guild's targets, each in its
  own vocabulary — folded exactly as today, but scoped to the tenant. It MUST NOT reveal any
  other tenant's targets or their existence.
- **FR-013**: This feature MUST add **no authentication and no off-box addressing**. Every
  target stays loopback-local to the orchestrator's host, and no inbound network exposure is
  introduced. Cross-machine targets and the authentication they require are a separate, future
  capability explicitly out of scope here.

### Key Entities

- **Tenant** (configuration, orchestrator-side): a Discord guild, identified by its guild id,
  mapped to the set of targets its members may control. Lives only in orchestrator
  configuration and on the Discord surface — never in the contract. Adding one is one more
  entry.
- **Target** (unchanged from 001–003): a controllable thing on a host — a game or a media
  player — identified by its agent's address (Constitution I). A target may belong to one
  tenant or, deliberately, to several. Nothing about the target or its agent changes here.
- **Command** (transient, per interaction): a slash command carrying its originating guild.
  The guild is the routing key that selects the tenant, and therefore the only target set the
  command may reach. The guild is never sent across the seam.

## Success Criteria *(mandatory)*

- **SC-001**: With two guilds configured to disjoint target sets, a member of each guild can
  see and control **100%** of that guild's targets and **0%** of the other guild's — verified
  by confirming neither guild can list or reach the other's target under any command.
- **SC-002**: Adding a new tenant (a guild and its targets) is a configuration edit plus a
  restart — **zero** code changes — after which that guild's commands are available in it and
  the existing tenants are unchanged.
- **SC-003**: An interaction from an unconfigured guild results in **no** action on any
  target, every time.
- **SC-004**: Every existing command behaves exactly as before **within a guild's own scope**
  — start/stop/status/address for games and pause/play/status for media are unchanged for the
  targets a guild owns (001–003 behavior preserved per tenant).
- **SC-005**: The orchestrator↔agent contract is **unchanged** — no tenant or target
  identifier is added to it, so a 001–003 seam-conformance check still passes. (This is the
  measurable form of "the seam stays clean", which is what makes off-box additive later.)
- **SC-006**: A malformed tenant configuration prevents startup with a message naming the
  problem **100%** of the time — the control plane never boots into a partially-served or
  mis-scoped state.

## Assumptions

- **One orchestrator, one bot, serving all tenants** (Constitution II). A federated model —
  one orchestrator and one bot per tenant — is a different shape and is out of scope; so is
  any multi-process/sharded orchestrator.
- **Every target is loopback-local to the orchestrator's host today.** Practically, that host
  is `watson` and the targets are the games and VLC already there. The tenancy model is built
  so that a future target on a *different* machine is reachable by configuring a different
  address (plus authentication, a separate spec) — but this feature adds neither.
- **A target may appear in one or more tenants' sets.** Isolation means a guild can reach only
  the targets in its own set; it does **not** mean a target belongs to exactly one guild. This
  accommodates a deliberately shared target without weakening the "can't reach what isn't
  yours" guarantee.
- **Target names are scoped to their tenant.** A name identifies a target within a guild, not
  globally; two tenants may reuse a name for different agents. An agent's **address** remains
  globally unique and is its identity.
- **Trust remains per-guild and unauthenticated at the user level.** Each configured guild is
  private and trusted; any member may command that guild's targets with no role or auth step —
  the same trade as 001–003, now made per tenant. The trust boundary is the guild.
- **The 003 stopgap is superseded.** The comma-separated shared-guild list is replaced by the
  per-guild target map; migration is a deliberate configuration change by the operator.

## Out of Scope

- **Agent authentication and off-box target addressing.** The moment a target lives on another
  machine, the agent must authenticate the caller and bind beyond loopback — a separate, future
  spec. This feature keeps the seam ready for it (FR-007, FR-009) but builds none of it.
- **A federated deployment** (one orchestrator/bot per tenant) and any multi-process or sharded
  orchestrator.
- **Per-user roles or permissions within a guild.** Authorization inside a tenant stays "any
  member" (the guild is the trust boundary).
- **A cross-tenant or global admin view.** No tenant can see another; there is no aggregated
  view across tenants.
