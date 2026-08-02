# Implementation Plan: A second controlled game server

**Branch**: `002-second-game-server` | **Date**: 2026-08-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-second-game-server/spec.md`

## Summary

Add a second controlled server — a Satisfactory dedicated server — behind the same
Discord bot, and a `/status` command, without changing the orchestrator↔agent
contract or introducing a new kind of component. The work is almost entirely
game-agnostic: a formal `GameAdapter` interface the agent selects by configuration,
an orchestrator that holds many agents by name and routes a named command to one,
a read-only status verb, and a post-launch follow-up that finally lets the system
say a server is *up* — but only once it has observed it.

Only one slice is game-specific: a `satisfactory.ts` adapter speaking Satisfactory's
HTTPS API, structurally identical to what `palworld.ts` already does (ask for state,
save, verify, then shut down) with different mechanics. That slice is written against
**observed** behaviour at M0, exactly as the Palworld adapter was.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 24 (LTS), every package — unchanged from 001.

**Primary Dependencies**: `discord.js` (orchestrator only). The agent keeps **zero
runtime dependencies**: `node:http` for its server, native `fetch` for Palworld's
plain-HTTP REST, and **`node:https`** (built-in) for Satisfactory's TLS API — the
one new wrinkle, needed because that API is always TLS-wrapped with a self-signed
certificate and `node:https` can accept it on loopback (`rejectUnauthorized: false`)
where native `fetch` cannot without a dependency.

**Storage**: N/A. FR-012 forbids state that outlives a process. US3's pending
follow-up is explicitly **not** persisted (FR-032) — a wait lost to a restart is
preferable to a claim made from stale state.

**Testing**: `node:test` + `node:assert`, unchanged. Adapter behaviour is verified
against a **real** Satisfactory install (M0), never mocks — the same discipline M0
exists for.

**Target Platform**: Both agents → Windows 11 on `watson`, each beside its game
server. Orchestrator → generic Linux under WSL2 at this milestone.

**Project Type**: Monorepo, one package per component plus the shared contract —
unchanged. No new package.

**Performance Goals**: Command acknowledged in Discord < 3s (SC-004). A named
command touches exactly one server and never delays another (SC-003). Status returns
each server's state without changing any (SC-005).

**Constraints**: Every agent binds `127.0.0.1` only (FR-013). The contract gains a
status verb but **no server/machine identifier** (Constitution I). Adding a third
server is configuration + a deployment, no contract change (FR-024). The Satisfactory
API's TLS port must never be exposed — only the game port is forwarded (FR-015).

**Scale/Scope**: Two servers today, designed for a handful. Three verbs
(start/stop/status) plus one asynchronous follow-up.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against [constitution v1.0.0](../../.specify/memory/constitution.md).

| Principle | Gate | Assessment |
|---|---|---|
| **I. The seam is inviolable** | Orchestrator→agent over HTTP; agent URL is identity; no discriminator in the contract | **PASS** — a second server is a second agent at a second address in orchestrator *config*, never a parameter. The status verb is additive and carries no server id. The `GameAdapter` interface is **internal to the agent**, not part of the seam. |
| **II. Components are welded** | Each agent welded to its game server; orchestrator relocates; no new kind | **PASS** — two agents (Palworld, Satisfactory), each beside its server. One orchestrator gains a name→address map. No fourth component type; a second game is a *row* (the acceptance test). |
| **III. Build the minimum** | Nothing speculative; no abstraction against one implementation | **PASS** — the `GameAdapter` interface is extracted *because a second adapter now exists*, not in anticipation. `/status` and the follow-up are the spec's scope, not gold-plating. |
| **IV. Graceful stop or none** | `stop` saves then exits; cannot-save fails, never kills | **PASS** — `satisfactory.ts` does `SaveGame` → verify → `Shutdown`, forbidding the force paths by the same contract test that guards `palworld.ts`. |
| **V. Record before deleting** | Chosen candidates reach `DECISIONS.md` with what they beat | **PASS** — new entries planned: the `GameAdapter` seam, adapter-selection-by-config, orchestrator multi-agent config, the status verb, the follow-up model, and Satisfactory-over-HTTPS. |

**No violations. Complexity Tracking is empty.**

The acceptance test — *"a new capability requires a new row, not a new kind"* — holds:
a second game is a second agent (a row); the components are still exactly three kinds.

## Project Structure

### Documentation (this feature)

```text
specs/002-second-game-server/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output — the game-agnostic decisions + Satisfactory API
├── data-model.md        # Phase 1 output — ControlledServer, GameAdapter, config shapes
├── quickstart.md        # Phase 1 output — two-server validation
├── contracts/
│   └── agent-api.md     # Phase 1 output — the seam, now three verbs (status added)
└── tasks.md             # Phase 2 — NOT created by /speckit-plan
```

### Source Code (repository root)

```text
snackbyte-reveille/
├── contract/
│   └── src/index.ts             # ServerState, AgentResponse unchanged; + the status
│                                #   response shape. NO server/machine id ever.
│
├── agent/                       # 1 deployment PER controlled server · WINDOWS · loopback
│   └── src/
│       ├── index.ts             # node:http server: /start, /stop, + /status. Adapter-agnostic.
│       ├── config.ts            # + GAME selects the adapter; + game-specific values
│       ├── adapter.ts           # NEW — the GameAdapter interface: getState/start/stop
│       ├── palworld.ts          # implements GameAdapter (existing, unchanged in shape)
│       └── satisfactory.ts      # NEW — implements GameAdapter over the HTTPS API (node:https)
│
└── orchestrator/                # exactly 1 · LINUX (WSL2)
    └── src/
        ├── index.ts             # registers /start /stop /status with a subcommand per server
        ├── config.ts            # + AGENTS: name → base URL map (many, not one)
        ├── agent-client.ts      # unchanged shape; + status(); reaches ONE named agent
        ├── commands.ts          # routes a named command to its agent; renders replies
        └── followup.ts          # NEW — after a launch, poll status to the bound; post up/timeout
```

**Structure Decision**: Same three packages, no new one — a second game is a second
*deployment* of the existing agent, chosen by its `GAME` config, not new code
structure (DECISIONS 001). The one genuinely new file on each side —
`agent/src/adapter.ts` (the interface) and `orchestrator/src/followup.ts` (US3) —
each earns its place: the interface because a second adapter now exists to conform
to it, the follow-up because US3 is a genuinely new behaviour (watching, not
answering). `agent/src/satisfactory.ts` is the only new *Palworld-agnostic-breaking*
file, and like `palworld.ts` it is the single place that knows its game.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. No entries.
