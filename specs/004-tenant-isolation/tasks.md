---
description: "Task list for 004-tenant-isolation"
---

# Tasks: Each guild controls its own targets

**Input**: Design documents from `/specs/004-tenant-isolation/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/config-schema.md](contracts/config-schema.md)

**Tests**: Unit tests cover the pure, orchestrator-side logic that *is* this feature —
tenant config parsing, scoped routing, isolation, scoped `/status`. The contract and agent
are untouched, so there is no new seam to test; instead the quickstart's §7 asserts that
`contract/` and `agent/` did not change (SC-005).

**Organization**: Grouped by user story. US1 (isolation) is the MVP.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1, US2
- Exact file paths are in every task

## Path Conventions

Monorepo (`contract/`, `agent/`, `orchestrator/`). **This feature touches only
`orchestrator/`.** `contract/` and `agent/` are deliberately not opened — a tenant is a row,
not a new component (Constitution II), and the seam does not change (Constitution I, SC-005).

---

## Phase 1: Setup

**Purpose**: The configuration surface for tenants. No behaviour yet.

- [X] T001 [P] Rework `orchestrator/.env.example` — replace the flat `AGENTS` and the 003 stopgap `DISCORD_GUILD_ID` comma-list with the **`TENANTS`** shape: a JSON array of `{ guildId, name?, agents: [ {name,url,kind,publicPort?} ] }` (per [contracts/config-schema.md](contracts/config-schema.md)). Document every field, that a target may be shared or exclusive (FR-014), that all values are required and fail-loud, and that the **legacy shape is rejected** with a migration message (FR-011). `DISCORD_BOT_TOKEN`/`DISCORD_APPLICATION_ID`/`FOLLOWUP_TIMEOUT_MS` unchanged.

**Checkpoint**: The tenant config shape is documented and copy-ready.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The tenant config model both stories depend on. **⚠️ Blocks US1 and US2.**

- [X] T002 Rework `orchestrator/src/config.ts` — parse `TENANTS` into a `Map<guildId, Tenant>`, each `Tenant` holding its `guildId`, optional `name`, and its `ControlledServer[]` (**reuse the existing 003 per-target validation** for `name`/`kind`/`publicPort`/`url` unchanged). Fail loud, naming the problem: missing/blank/non-array `TENANTS`; a duplicate `guildId`; a tenant with an empty `agents` array; a bad target entry; and the **legacy `AGENTS`/routing-`DISCORD_GUILD_ID`** present → a migration error (FR-010, FR-011). `name` unique **within** a tenant (may repeat across tenants). **This replaces the 003 stopgap** (`discordGuildIds` + top-level `parseAgents`).
- [X] T003 [P] Rework `orchestrator/src/config.test.ts` — tenant parsing into the per-guild map; fail-loud for each rule above; a **shared** target (same `url` under two tenants) and an **exclusive** one both load (FR-014); a `name` reused across tenants is allowed; the legacy shape is rejected. **Remove the stopgap `parseGuildIds` tests** (superseded).

**Checkpoint**: The orchestrator loads tenants by guild from config, or fails loud; no behaviour wired yet.

---

## Phase 3: User Story 1 - A guild controls only its own targets (Priority: P1) 🎯 MVP

**Goal**: A member of a guild sees and controls only that guild's targets; no guild can see or reach another's.

**Independent Test**: Configure guild A → target X and guild B → target Y (disjoint). From A, only X is offered and only X responds; Y is neither listed nor reachable. From B, the reverse.

### Implementation for User Story 1

- [X] T004 [US1] Rework `orchestrator/src/index.ts` — build each tenant's `agents`/`ports` maps from config; **register each guild's commands scoped to only that tenant's targets** (reuse the kind-partitioned `buildCommands`, per tenant); the interaction gate becomes "is `interaction.guildId` a configured tenant?" — ignore otherwise (FR-006); dispatch **resolves the tenant by `guildId`** and routes within it (including the US3 follow-up's agent lookup). Replaces the stopgap's guild loop + single-guild gate.
- [X] T005 [US1] Scope routing in `orchestrator/src/commands.ts` — `routeToAgent`, `handleStatus`, `handleStart`/`handleStop`/`handleAddress`/`handlePause`/`handleResume` operate on **one tenant's** `agents`/`ports` map (passed in), never a global one. A name resolves within the tenant only, so a guild cannot name or reach another tenant's target (FR-002, FR-003).
- [X] T006 [P] [US1] Unit-test isolation in `orchestrator/src/commands.test.ts` — scoped `routeToAgent` reaches only the tenant's targets; a name belonging to another tenant is *unknown* (refused with that tenant's valid list, never routed); scoped `handleStatus` folds only the tenant's targets and reveals no other (FR-012); the unknown-name refusal never crosses tenants (FR-002).

**Checkpoint**: Isolation holds — each guild's commands are scoped to its own targets. **The MVP.**

---

## Phase 4: User Story 2 - Stand up a new tenant by configuration alone (Priority: P2)

**Goal**: Adding a tenant is a config change only — no code — and leaves other tenants unchanged.

**Independent Test**: Add a third guild + its targets to `TENANTS`, restart, and confirm its commands appear in that guild and route to its targets, with no code edited and the existing tenants unchanged.

### Implementation for User Story 2

- [X] T007 [P] [US2] Unit-test config-only extensibility in `orchestrator/src/config.test.ts` — N tenants load independently into the map; each yields its own scoped target set; adding or removing one tenant changes only that entry and leaves the others' maps identical (proves "more rows, never new kinds" for tenants — no code path is per-tenant-specific).

**Checkpoint**: A tenant is added/removed by editing `TENANTS` alone; other tenants are unaffected.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [X] T008 Record a `DECISIONS.md` entry (Constitution V) — the **tenancy model** (guild → its own target set, one orchestrator), the **replacement of the 003 stopgap** (shared-target multi-guild list → per-guild map), and the **per-tenant trust widening** ("one private guild" → "one private guild per tenant"). Written before the stopgap's reasoning is overwritten. Note **no constitution amendment** is needed (a tenant is a row; the seam and components are unchanged).
- [X] T009 [P] Update `CLAUDE.md` — the tenant model and `TENANTS` config, per-guild command scoping and isolation, that the agent and contract are untouched (the seam stays clean, off-box stays additive), and that the 003 multi-guild stopgap is superseded.
- [X] T010 [P] Update `site/index.html` per the v1.2.0 homepage rule — evaluate and apply: the **isolation guarantee** is worth a line (each guild controls only its own targets), but a *single* guild's experience is unchanged (no new command or target from a user's view), so the interactive demo needs no change. Land the minimal honest touch; do not invent user-facing behaviour 004 does not add.
- [X] T011 Migrate the live `orchestrator/.env` on `watson` from the stopgap (`DISCORD_GUILD_ID` comma-list + `AGENTS`) to `TENANTS` — the deploy/operator step (mirrors the game `.env` migrations); restart the orchestrator so it re-registers each guild's scoped commands. Operator step.
- [X] T012 Run the full [quickstart.md](quickstart.md) — isolation (§1), shared/exclusive (§2), add-a-tenant (§3), scoped `/status` (§4), unconfigured-guild-ignored (§5), fail-loud config (§6), and the **SC-005 seam-unchanged check (§7)**: `git diff` on `contract/` and `agent/` is empty and the 001–003 contract shape is intact.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup — **blocks both user stories**. T002 before T003.
- **US1 (Phase 3)**: depends on Foundational. T004 + T005 together (index wires what commands scopes); T006 tests them.
- **US2 (Phase 4)**: depends on Foundational (the per-guild map) and US1's per-tenant registration. Independent of US1 in code — it only *tests* multi-tenant loading.
- **Polish (Phase 5)**: after the stories. T008/T009/T010 any time after the design is settled; T011 (live migration) + T012 (quickstart) last.

### Within a story

- Config model → registration/routing → test, each layer calling the one before.
- The seam is a guardrail, not a task: `contract/` and `agent/` must stay untouched (asserted by T012 §7).

### Parallel opportunities

- T001 (env docs) parallel with nothing blocking it.
- T003 after T002; T006, T007 are test files, parallel with each other once their code lands.
- T009, T010 parallel (docs vs. site).

---

## Implementation Strategy

### MVP: User Story 1 only

1. Setup → 2. Foundational → 3. US1 (config model → scoped registration/routing → isolation tests).
4. **STOP and validate** — two guilds, disjoint sets, each reaches only its own; neither sees the other's.

That is tenant isolation: the stopgap's "everyone shares everything" replaced by "each guild its own."

### Incremental delivery

- Setup + Foundational → the orchestrator loads tenants by guild (or fails loud).
- **+ US1 → MVP: isolation.**
- + US2 → adding a tenant is config-only, proven.
- + Polish → recorded (DECISIONS), documented (CLAUDE.md + homepage), migrated live, and the seam proven unchanged.

---

## Notes

- **The seam gains nothing.** No tenant/target id enters the contract; `contract/` and `agent/`
  are not opened (SC-005). That is what keeps a future off-box target additive (a different
  `url` + a separate spec's auth), not a rewrite of this.
- **Isolation is structural, not a filter** — a handler only ever holds its resolved tenant's
  maps (data-model.md), so another guild's target is never in scope to leak.
- **The 003 stopgap is superseded**, not extended: `discordGuildIds` + shared `AGENTS` → the
  per-guild `TENANTS` map; the old shape is rejected loudly (FR-011).
- **No new dependency, no new package, no constitution amendment.** A tenant is a row.
