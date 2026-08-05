# Implementation Plan: Each guild controls its own targets

**Branch**: `004-tenant-isolation` | **Date**: 2026-08-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-tenant-isolation/spec.md`

## Summary

Replace the 003 multi-guild stopgap (several guilds sharing one target set) with proper
tenant isolation: each Discord guild is scoped to its own set of controllable targets and
can see and reach **only** its own. The change is **orchestrator-side only** — the config
becomes a per-guild target map, commands register per guild scoped to that guild's set,
every interaction is routed within the tenant its guild selects, and `/status` folds only
that guild's targets. The **contract and the agent are untouched** (FR-008, SC-005): no
tenant or target identifier enters the seam, so a future off-box target is an additive
change (a different address plus the authentication of a separate, deferred spec), never a
rewrite of this one. One orchestrator serves every tenant (FR-004).

## Technical Context

**Language/Version**: TypeScript on Node 24 — types stripped at runtime, no build step;
`erasableSyntaxOnly` on, so a passing `tsc` also guarantees the code runs. Unchanged.

**Primary Dependencies**: `discord.js` (orchestrator, already present); native `fetch`.
**No new runtime dependency** — this feature adds none.

**Storage**: None. Configuration is read from the environment at boot and nothing is
persisted; routing state is derived per interaction (the derive-don't-store rule holds).

**Testing**: `node:test`, tests beside source as `*.test.ts`. Pure, target-agnostic logic
(config parsing, tenant routing, scoped registration, scoped status) is unit-tested without
Discord or a live agent — that logic is the whole surface of this feature.

**Target Platform**: The orchestrator runs where it always has (dials out to Discord, no
inbound). Agents run on Windows and are **not touched** by this feature.

**Project Type**: Existing monorepo — `contract/`, `agent/`, `orchestrator/`. This feature
touches **only `orchestrator/`**. No new package (Constitution II: a tenant is a row, not a
component).

**Performance Goals**: N/A. Config is small; routing is a map lookup per interaction. No
throughput or latency target beyond the existing "acknowledge within a few seconds".

**Constraints**: No tenant/target id in the contract (Constitution I); exactly one
orchestrator (Constitution II); every configuration value required and fail-loud (no silent
fallback); the agent and the seam byte-for-byte unchanged (FR-008, SC-005).

**Scale/Scope**: ∞ guilds × ∞ targets, bounded only by configuration and Discord's own
per-guild command limits. Realistically a handful of guilds and targets. Small.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

- **I. The Seam Is Inviolable** — **PASS.** The orchestrator↔agent contract is unchanged; no
  tenant id and no target id enters a path or body (FR-007). An agent's address remains its
  identity. The agent is byte-for-byte the same artifact (FR-008), which is exactly what keeps
  a future off-box target additive. A 001–003 seam-conformance check still passes (SC-005).
- **II. Components Are Welded; Only The Orchestrator Relocates** — **PASS.** Exactly one
  orchestrator serves all tenants (FR-004). A tenant is **configuration** — a guild mapped to a
  set of targets — not a new component. Nothing multiplies except rows in the config. No fourth
  component kind is introduced.
- **III. Build The Minimum; Defer By Default** — **PASS.** Agent authentication and off-box
  addressing are explicitly out of scope (FR-013) and **no scaffolding is built for them** — the
  readiness comes from *not violating* the seam, not from preparing for the future.
- **IV. A Stop That Cannot Be Graceful Is Not A Stop** — **N/A.** The agent, its adapters, and
  the stop path are untouched. Every game's save-before-stop guarantee is unaffected.
- **V. Record The Decision Before Deleting The Reasoning** — **APPLIES.** The tenancy model, the
  replacement of the 003 stopgap, and the widening of the trust model from "one private guild" to
  "one private guild per tenant" MUST be recorded in `DECISIONS.md` (a polish task) before the
  stopgap's reasoning is overwritten.

**The acceptance test** ("if adding a capability needs a new *kind* rather than a *row*, something
was drawn wrong"): a tenant is a **row** — one more `{guild → targets}` entry. **PASS.**

**Amendment needed?** **No.** No principle changes. Guild cardinality is not a numbered principle;
the trust model lives in the spec, and widening it to per-tenant is recorded in `DECISIONS`, not
in the constitution. (Contrast 003, which *did* amend Principle II to admit a non-game target — a
component-definition change. Tenancy changes no component definition.)

## Project Structure

### Documentation (this feature)

```text
specs/004-tenant-isolation/
├── plan.md              # This file
├── research.md          # Phase 0 output — the design decisions
├── data-model.md        # Phase 1 — Tenant / Target / routing model
├── quickstart.md        # Phase 1 — how to prove isolation end to end
├── contracts/           # Phase 1 — the seam is UNCHANGED; the config schema is the contract
└── tasks.md             # /speckit-tasks output (not created here)
```

### Source Code (repository root)

```text
orchestrator/                 # THE ONLY PACKAGE THIS FEATURE TOUCHES
├── src/
│   ├── config.ts             # tenant model: guild → its target set (replaces flat AGENTS +
│   │                         #   the stopgap's comma-guild list); fail-loud parsing
│   ├── config.test.ts        # tenant config parsing + fail-loud + shared/exclusive
│   ├── index.ts              # per-guild command registration scoped to the guild's set;
│   │                         #   the guild gate becomes "is this a configured tenant?";
│   │                         #   dispatch resolves the tenant by guildId, then routes in it
│   ├── commands.ts           # routeToAgent / handleStatus scoped to ONE tenant's agent map
│   ├── commands.test.ts      # scoped routing + isolation + scoped /status
│   └── (agent-client.ts, followup.ts unchanged)
│
contract/  ── UNTOUCHED (the seam does not change — SC-005)
agent/     ── UNTOUCHED (an agent never knows it belongs to a tenant — FR-008)
```

**Structure Decision**: No new package; the change is confined to `orchestrator/`. `config.ts`
gains the tenant model, `index.ts` scopes registration and routing by guild, `commands.ts`
routes within a single tenant's map. `contract/` and `agent/` are deliberately not opened —
their being untouched is the measurable form of "the seam stays clean" (SC-005) and is what
makes off-box a future bolt-on.

## Complexity Tracking

> No Constitution violations. Nothing to justify.

The only governance obligation is a `DECISIONS.md` entry (Principle V) recording the tenancy
model, the stopgap replacement, and the per-tenant trust widening — captured as a polish task,
not a violation.
