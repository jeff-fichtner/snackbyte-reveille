# Implementation Plan: Start and stop the game server from Discord

**Branch**: `main` (no branch hook registered; spec directory is `001-discord-start-stop`) | **Date**: 2026-07-21 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-discord-start-stop/spec.md`

## Summary

Two Node processes on the always-on gaming PC. The **orchestrator** hosts a
Discord bot with `/start` and `/stop`; the **agent** sits beside the Palworld
server and actuates it. They talk over HTTP on loopback even though they share a
machine, because that seam is what the architecture is built on.

Start spawns `PalServer.exe` and reports that the launch was issued — nothing
more. Stop calls the Palworld REST API's `save`, checks it succeeded, then
`shutdown`; if the save fails the server is left running and the failure is
reported. Neither process remembers anything: "is it running?" is answered by
asking the Palworld REST API at the moment of the request.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 24 (LTS), every package

**Primary Dependencies**: `discord.js` (orchestrator only). Agent has **zero**
runtime dependencies — `node:http` plus native `fetch`

**Storage**: N/A — FR-012 forbids state that outlives a process

**Testing**: `node:test` + `node:assert` (built in, no config, no dependencies)

**Target Platform**: Agent → Windows 11 on `watson`, beside the game server.
Orchestrator → generic Linux, running under WSL2 on `watson` at this milestone

**Project Type**: Monorepo, one package per component plus a shared contract

**Performance Goals**: Command acknowledged in Discord < 3s (SC-004). Start
returns as soon as the spawn call returns; no joinability wait

**Constraints**: Agent binds `127.0.0.1` only (FR-013). Stop bounded in time
(FR-007). Force-stop paths forbidden (FR-006). No persisted state (FR-012)

**Scale/Scope**: One game server, one host, a handful of players. Two verbs

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against [constitution v1.0.0](../../.specify/memory/constitution.md).

| Principle | Gate | Pre-design | Post-design |
|---|---|---|---|
| **I. The seam is inviolable** | Orchestrator → agent over HTTP, even co-located. Actuator URL is identity; no discriminator in the contract | PASS | **PASS** — `contracts/agent-api.md` has two paths, no id parameter. Agent address is one config value |
| **II. Components are welded** | Agent lives with the game server; orchestrator separate; no emitter | PASS | **PASS** — two packages, agent Windows-pinned beside `PalServer.exe`, no `emitter/` created |
| **III. Build the minimum** | Nothing beyond the milestone; no placeholder structure | PASS | **PASS** — no state machine, no presence, no retry, no verification. Agent takes zero dependencies |
| **IV. Graceful stop or none** | `stop` saves then exits; cannot-save must fail, not kill | PASS | **PASS** — `save` → check → `shutdown`. `POST /v1/api/stop` and process termination explicitly forbidden in the contract |
| **V. Record before deleting** | Chosen candidates reach `DECISIONS.md` with what they beat | PASS | **PASS** — REST-over-RCON recorded as [DECISIONS 009](../../initial-architecture/DECISIONS.md) |

**No violations. No outstanding obligations. Complexity Tracking is empty.**

## Project Structure

### Documentation (this feature)

```text
specs/001-discord-start-stop/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── agent-api.md     # Phase 1 output — the seam
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 — NOT created by /speckit-plan
```

### Source Code (repository root)

```text
snackbyte-reveille/
├── contract/                  # the seam, defined once
│   ├── package.json
│   └── src/index.ts           # request/response types for start + stop
│
├── agent/                     # 1 per controlled server · WINDOWS · loopback only
│   ├── package.json           # zero runtime dependencies
│   └── src/
│       ├── index.ts           # node:http server, two routes
│       ├── config.ts          # port, PalServer.exe path, REST admin password
│       └── palworld.ts        # THE ONLY Palworld-aware code: spawn, save, shutdown, info
│
└── orchestrator/              # exactly 1 · LINUX (WSL2) · owns the Discord gateway
    ├── package.json           # discord.js
    └── src/
        ├── index.ts           # bot startup, slash-command registration
        ├── commands.ts        # /start and /stop handlers
        └── agent-client.ts    # this side of the seam
```

**Structure Decision**: Three packages in the existing monorepo, one per
component plus the contract, per DECISIONS 003. No `emitter/` package — nothing
sleeps at this milestone and Principle III forbids creating it in advance.

The Palworld-specific surface is confined to `agent/src/palworld.ts`. That file is
the adapter; nothing above it knows which game this is, which is what makes
DECISIONS 001's game-agnostic axis real rather than aspirational.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. No entries.
