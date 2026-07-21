---

description: "Task list for 001-discord-start-stop"
---

# Tasks: Start and stop the game server from Discord

**Input**: Design documents from `/specs/001-discord-start-stop/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/agent-api.md](contracts/agent-api.md)

**Tests**: **No automated test tasks.** Tests are optional in this template and
were not requested; the spec's posture is explicitly "extreme happy path", and
Constitution Principle III forbids building beyond the milestone. Validation is
the manual end-to-end run in [quickstart.md](quickstart.md), which is a task in
the final phase. `node:test` is chosen in the plan so tests have a home when they
are wanted — not so they are written now.

**Organization**: Tasks are grouped by user story so each is independently
implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story the task serves (US1, US2)
- Exact file paths are included in every task

## Path Conventions

Monorepo, one package per component, per [plan.md](plan.md) and DECISIONS 003:
`contract/`, `agent/`, `orchestrator/` at repository root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the three packages and the toolchain. No behaviour yet.

- [ ] T001 Add the npm workspaces for `contract`, `agent`, `orchestrator` to the existing root `package.json` — it already exists, carrying the `version` the release flow reads for its MAJOR.MINOR line. Do not overwrite that field
- [ ] T002 [P] Create `tsconfig.base.json` at repo root, copying conventions from `snackbyte-base` by hand (Node 24 target, strict) — do not scaffold from the template, per DECISIONS 004
- [ ] T003 [P] Create `eslint.config.js` at repo root, same source of conventions
- [ ] T004 [P] Create `contract/package.json` and `contract/tsconfig.json` — zero dependencies
- [ ] T005 [P] Create `agent/package.json` and `agent/tsconfig.json` — **zero runtime dependencies**, depends on `contract` only
- [ ] T006 [P] Create `orchestrator/package.json` and `orchestrator/tsconfig.json` — `discord.js`, depends on `contract`
- [ ] T007 [P] Create `agent/.env.example` with agent port, `PalServer.exe` path, Palworld REST base URL, admin password placeholder, and the stop bound in milliseconds (FR-007)
- [ ] T008 [P] Create `orchestrator/.env.example` with Discord bot token, application id, guild id, agent base URL placeholders

**Checkpoint**: `npm install` succeeds at root; three empty packages build.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The seam, configuration, and both process skeletons. Everything here
is shared by both user stories.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T009 Define `ServerState` and `AgentResponse` in `contract/src/index.ts` exactly as specified in [contracts/agent-api.md](contracts/agent-api.md) — no server or machine identifier in any type
- [ ] T010 [P] Implement configuration loading in `agent/src/config.ts` reading from environment; fail fast with a clear message if the Palworld admin password is empty, or if the stop bound is missing or not a positive integer (FR-007)
- [ ] T011 [P] Implement configuration loading in `orchestrator/src/config.ts` reading bot token and agent base URL from environment — the agent URL is a config value, never a constant (FR-013 / DECISIONS 002)
- [ ] T012 Implement the Palworld helpers in `agent/src/palworld.ts`: a `fetch` wrapper adding Basic auth, plus `getState(): Promise<ServerState>` returning `running` when `GET /v1/api/info` answers, else `starting` when a `PalServer.exe` **or** `PalServer-Win64-Shipping-Cmd.exe` process exists, else `stopped` (research R3) — those three only; `error` is an operation outcome, never a derived state. Both names are checked — the launcher covers the window before the child appears, the child covers the launcher exiting early (R2). Nothing is retained between calls (FR-012). **This file is the only Palworld-aware code in the system**
- [ ] T013 Create the HTTP server in `agent/src/index.ts` using `node:http`, **binding to `127.0.0.1` only** (FR-013), routing `POST /start` and `POST /stop` to not-yet-implemented handlers returning 501
- [ ] T013a Serialize command handling in `agent/src/index.ts` so `/start` and `/stop` cannot interleave — each handler's read-state-then-act sequence runs to completion before the next begins. Without this, two concurrent `/start`s both read `stopped` before either spawns and both launch (FR-008). Concurrent commands MUST resolve to one clean winner, never a half-executed pair (spec.md Edge Cases). In-process mutual exclusion only — nothing survives the request, so FR-012 and the contract's no-state-between-requests rule both hold
- [ ] T014 [P] Implement `orchestrator/src/agent-client.ts` — POSTs to the agent and returns the **HTTP status alongside** the parsed `AgentResponse`; `starting` is both a 202 (launch issued) and a 409 (already starting), so `state` alone cannot separate them. Maps transport failure to a distinct "could not reach the host" outcome (FR-009)
- [ ] T015 Implement bot startup and slash-command registration for `/start` and `/stop` in `orchestrator/src/index.ts`, deferring each reply immediately so acknowledgement lands under 3 seconds (SC-004). Leave `default_member_permissions` unset — any member of the Discord server may issue either command, with no role check of any kind (FR-001)

**Checkpoint**: Agent answers on loopback with 501s; bot connects and both commands appear in Discord.

---

## Phase 3: User Story 1 - Start the server from Discord (Priority: P1) 🎯 MVP

**Goal**: Either player types `/start` from any device and the game server launches.

**Independent Test**: With the server down, `POST /start` returns 202 and
`PalServer.exe` is running; a second call returns 409 and no second instance
exists. Then the same via `/start` in Discord. Fully testable with no stop
capability.

### Implementation for User Story 1

- [ ] T016 [US1] Implement `start()` in `agent/src/palworld.ts` — spawn `PalServer.exe` with `-useperfthreads -NoAsyncLoadingThread -UseMultithreadForDS`, detached, returning as soon as the spawn call succeeds. **Do not wait, do not verify the process survived** (Clarifications 2026-07-21)
- [ ] T017 [US1] Implement the `POST /start` handler in `agent/src/index.ts` — call `getState()` first and return 409 carrying that state if it is `running` **or** `starting`; FR-008 forbids a second instance in both cases, and `starting` is the ~90-second window where the REST API is still silent. Otherwise spawn and return 202 `starting`; 500 `error` if the spawn call itself fails
- [ ] T018 [US1] Implement the `/start` command handler in `orchestrator/src/commands.ts` — defer the reply, call the agent, and edit the reply with the outcome. Key off the HTTP status to separate 202 `starting` ("launching it now") from 409 `starting` ("a start is already in progress") — FR-004 requires already-in-that-state reported distinctly from action-taken. Report unreachable-host distinctly from a host-side failure (FR-009)

**Checkpoint**: `/start` from a phone launches the server. **This alone is a usable system** — the host is always on, and stopping can be done at the machine.

---

## Phase 4: User Story 2 - Stop the server without losing the world (Priority: P2)

**Goal**: Either player types `/stop`, the world is saved, and the server exits.

**Independent Test**: With the server running and a world in a known state,
`POST /stop` returns 200; restarting shows everything from immediately before the
stop (SC-002). A stop during a start returns 409 `starting` and leaves the
launching process untouched.

### Implementation for User Story 2

- [ ] T019 [US2] Implement `stop()` in `agent/src/palworld.ts` — `POST /v1/api/save`, **verify it succeeded**, then `POST /v1/api/shutdown`. If the save fails or the overall operation exceeds the configured bound, return a failure and **leave the server running** (FR-006, FR-007). **`POST /v1/api/stop` and any process-kill path MUST NOT appear in this file** (DECISIONS 009, Constitution IV)
- [ ] T020 [US2] Implement the `POST /stop` handler in `agent/src/index.ts` — resolve current state via `getState()`; 409 `stopped` if `stopped`; 409 `starting` if `starting`, leaving the launching process untouched (FR-017); otherwise run `stop()` and return 200 `stopped` or 500 `error` with the server still running
- [ ] T021 [US2] Implement the `/stop` command handler in `orchestrator/src/commands.ts` — defer, call the agent, and report the outcome, including the refusal cases, in plain language

**Checkpoint**: Both commands work end to end. The original problem statement is satisfied.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: The operational work that makes it safe and repeatable. **T022 is not optional.**

- [ ] T022 Verify exposure per [quickstart.md](quickstart.md) §2 — confirm the agent port and Palworld REST port 8212 refuse connections from the LAN, that only 8211/UDP is reachable from the public address (SC-007), and that `RCONEnabled=False` and a real `AdminPassword` are set in `PalWorldSettings.ini`. Also confirm this was achieved **without** disabling the host firewall, placing the host in a router DMZ, or removing any existing protection (FR-016) — record which single forwarding rule was added
- [ ] T023 [P] Write `CLAUDE.md` at repository root — operational context only (build, run, test commands; package layout; the loopback-bind rule). Architecture belongs in `initial-architecture/`. This was deliberately deferred until commands existed to document; they now do
- [ ] T025 Run the full [quickstart.md](quickstart.md) validation end to end, including §4 — the deliberate save-durability test, which is the zero-tolerance guarantee (SC-002)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **blocks both user stories**
- **User Story 1 (Phase 3)**: depends on Foundational
- **User Story 2 (Phase 4)**: depends on Foundational. Independent of US1 in code — both extend `palworld.ts` and `index.ts`, so they touch shared files but neither calls the other
- **Polish (Phase 5)**: T022 can run as soon as the agent binds (after T013). T025 requires both stories
- **T013a blocks T017 and T020**: both handlers rely on the serialization it installs, and without it the state check in each is a check-then-act race

### Within Each User Story

- Adapter function (`palworld.ts`) → agent route (`index.ts`) → Discord handler (`commands.ts`)
- Strictly sequential within a story: each layer calls the one before it

### Parallel Opportunities

- T002–T008 all parallel — separate files, no dependencies
- T010, T011, T014 parallel after T009
- T023 has no ordering constraint against the rest of Phase 5
- **US1 and US2 cannot be parallelised by different people** without conflict: both edit `agent/src/palworld.ts`, `agent/src/index.ts`, and `orchestrator/src/commands.ts`. With one developer this is irrelevant; noted so it is not assumed otherwise

---

## Parallel Example: Phase 1

```bash
# After T001, launch all of these together:
Task: "Create tsconfig.base.json at repo root"
Task: "Create eslint.config.js at repo root"
Task: "Create contract/package.json and contract/tsconfig.json"
Task: "Create agent/package.json and agent/tsconfig.json"
Task: "Create orchestrator/package.json and orchestrator/tsconfig.json"
Task: "Create agent/.env.example"
Task: "Create orchestrator/.env.example"
```

---

## Implementation Strategy

### MVP: User Story 1 only

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1
4. **STOP and validate** — `/start` from a phone, join the server
5. Run T022 before anyone outside the house connects

That is a working system. Stopping happens at the machine until US2 lands.

### Incremental delivery

- Setup + Foundational → skeletons talk over the seam
- **+ US1 → MVP, playable**
- + US2 → the milestone is complete
- + Polish → safe and documented

### Prerequisite outside this task list

**M0 must be done first**: the Palworld server installed via SteamCMD, started by
hand, and joined by both players, with `RESTAPIEnabled=True` and a real
`AdminPassword` configured. T016 and T019 are written against observed behaviour,
not documentation.

---

## Notes

- **The seam is not negotiable.** The orchestrator reaches the agent only over HTTP, even sharing a machine (Constitution I). No direct calls, no shared module holding process handles
- `agent/src/palworld.ts` is the **only** file that may know this is Palworld
- The agent keeps **zero** runtime dependencies — `node:http` plus native `fetch`
- **Nothing persists.** State is derived per request via `getState()` (FR-012). The serialization in T013a is mutual exclusion within a request, not retained state
- Secrets live in `.env`, never committed. **The repository is public**
- Commit after each task or logical group
