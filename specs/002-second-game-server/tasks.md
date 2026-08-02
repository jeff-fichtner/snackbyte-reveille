---
description: "Task list for 002-second-game-server"
---

# Tasks: A second controlled game server

**Input**: Design documents from `/specs/002-second-game-server/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/agent-api.md](contracts/agent-api.md)

**Tests**: Unit tests are included for the pure, game-agnostic logic (config
loaders, command routing, status rendering, the follow-up state machine) — that
logic is the new surface and is testable without a live game, and the project's
testing discipline writes tests beside their source. Everything that touches a game
server is validated against a **real** install (M0 + quickstart), never mocked —
the reason M0 exists.

**Organization**: Tasks are grouped by user story so each is independently
implementable and testable. US1 is the MVP.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story the task serves (US1, US2, US3)
- Exact file paths are included in every task

## Path Conventions

Monorepo, one package per component (unchanged from 001): `contract/`, `agent/`,
`orchestrator/`. **No new package** — a second game is a second *deployment* of the
agent (DECISIONS 001).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Configuration surfaces for a second agent and a multi-agent orchestrator.
No behaviour yet.

- [ ] T001 [P] Extend `agent/.env.example` — add `GAME` (`palworld` | `satisfactory`, required, selects the adapter) and the Satisfactory-specific values (REST/HTTPS base URL, admin password placeholder, stop bound in ms). Document each; every value required and fail-loud, no fallback
- [ ] T002 [P] Rework `orchestrator/.env.example` — replace the single `AGENT_BASE_URL` with an `AGENTS` map (server name → agent base URL) and a per-server game public port. Document the shape; a blank/empty map fails loud

**Checkpoint**: The config shapes for two servers are documented and copy-ready.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The game-agnostic machinery every story needs — the adapter boundary,
adapter-by-config, the status verb, and the orchestrator's many-agents config.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T003 Define the `GameAdapter` interface in `agent/src/adapter.ts` — `getState(): Promise<'running'|'starting'|'stopped'>`, `start(config): void`, `stop(config): Promise<void>`. The exact shape `palworld.ts` already satisfies; `error` is never a derived state (research R1, DECISIONS 010)
- [ ] T004 Refactor `agent/src/palworld.ts` to implement `GameAdapter` explicitly — **no behaviour change**. The force-stop-ban and save-before-shutdown source tests must still pass byte-for-byte (SC-009)
- [ ] T005 Implement adapter selection in `agent/src/config.ts` — add required `GAME` (fail loud naming it; `palworld` | `satisfactory`). In `agent/src/index.ts`, load the named adapter at boot; **nothing outside the adapter branches on the game** (FR-025)
- [ ] T006 Add `GET /status` to `agent/src/index.ts` — return `{ state }` from `getState()`, read-only, run through the same serialization as the other verbs; 200 with `running`/`starting`/`stopped`, never `error` as a state (contracts/agent-api.md v2)
- [ ] T007 [P] Add `status()` to `orchestrator/src/agent-client.ts` — `GET /status`, returning the parsed state or the distinct "could not reach the host" outcome (FR-009)
- [ ] T008 Load many agents in `orchestrator/src/config.ts` — parse `AGENTS` into a name→base-URL map (required, non-empty, fail loud) plus each server's game public port. Replaces the single `AGENT_BASE_URL`; the name lives only here and in the Discord surface, never in the contract (FR-024)
- [ ] T009 [P] Unit-test the config loaders in `agent/src/config.test.ts` and `orchestrator/src/config.test.ts` — `GAME` and `AGENTS` fail loud by name on missing/blank/empty; no silent fallback

**Checkpoint**: An agent boots for either game by `GAME`; both answer `/start`
`/stop` `/status` on loopback; the orchestrator holds many agents by name.

---

## Phase 3: User Story 1 - Start and stop a named server (Priority: P1) 🎯 MVP

**Goal**: Name a server; that one starts or stops; the other is untouched.

**Independent Test**: With both stopped, `/start satisfactory` launches Satisfactory
and Palworld stays stopped; `/stop satisfactory` saves its world and exits, Palworld
unaffected; `/start palworld` runs alongside a running Satisfactory (SC-003).

### Implementation for User Story 1

- [ ] T010 [US1] **M0 for Satisfactory** — claim the server from the game client (set the admin password, name it, create/load a session), start it by hand, and **observe**: the `PasswordLogin`→token→`QueryServerState`/`SaveGame`/`Shutdown` request/response shapes and token lifetime; how long after launch the API begins answering; the child process name(s) for the `starting`/`stopped` split; that `7777/TCP` is the API and `7777/UDP` the game. Feeds T011 and **must precede it** (quickstart Prerequisites). Operator-only step
- [ ] T011 [US1] Implement `agent/src/satisfactory.ts` as a `GameAdapter` over the HTTPS API using built-in **`node:https`** (`rejectUnauthorized: false` scoped to loopback — keeps zero runtime deps): `getState` (`QueryServerState` answers ⇒ `running`; a Satisfactory process exists ⇒ `starting`; else `stopped`), `start` (spawn detached, do not wait or verify), `stop` (`SaveGame` → verify → `Shutdown`). **`POST`-force paths and OS-level kill MUST NOT appear here** — the same source ban test that guards `palworld.ts` extends to this file (Constitution IV). Written against T010's observations, not docs
- [ ] T012 [US1] Register `/start` and `/stop` from the `AGENTS` config in `orchestrator/src/index.ts` — one subcommand per server name, **replacing the hardcoded `palworld` subcommand currently on `main`**. Discord requires a subcommand, enforcing "no default target" (FR-019); an unknown name cannot be submitted through the picker and is refused server-side (FR-020)
- [ ] T013 [US1] Route a named start/stop to its agent in `orchestrator/src/commands.ts` — look the name up in the agent map, call that one agent, and **name the server in the reply** (FR-018). A command against one server has no effect on any other (FR-021); unreachable is reported for that server alone (FR-009)
- [ ] T014 [P] [US1] Unit-test routing + reply in `orchestrator/src/commands.test.ts` — a named command reaches only its agent; the reply names the server; an unknown name is rejected with the valid list; one server's outcome is independent of another's

**Checkpoint**: `/start satisfactory` from a phone launches Satisfactory; Palworld
is untouched. **The second server is real** — the MVP.

---

## Phase 4: User Story 2 - Ask what is running (Priority: P2)

**Goal**: A read-only view of every server's state, changing nothing.

**Independent Test**: With Palworld running and Satisfactory stopped, `/status`
reports each correctly and alters neither (SC-005); an agent that is down is reported
`unreachable` while the others report normally.

### Implementation for User Story 2

- [ ] T015 [US2] Register `/status` (no subcommand — it names no server) in `orchestrator/src/index.ts`
- [ ] T016 [US2] Implement the `/status` handler in `orchestrator/src/commands.ts` — query **every** configured agent via `agent-client.status()`, report each server's state independently, `unreachable` for any whose agent does not answer (FR-023, FR-026), each server still a valid entry. Say **nothing** about who or how many are connected (FR-011)
- [ ] T017 [P] [US2] Unit-test `describeStatus` in `orchestrator/src/commands.test.ts` — each server rendered with its own state; unreachable distinct from stopped; no player data anywhere; the command changes nothing (read-only)

**Checkpoint**: `/status` reports both servers, independently, touching neither.

---

## Phase 5: User Story 3 - Told when it is actually up (Priority: P3)

**Goal**: After a launch, a follow-up message when the control API reports `running`
— or that it could not be confirmed.

**Independent Test**: `/start satisfactory`, then do nothing; a later message reports
it is running, naming the server, with no further command. Against a server that will
not come up, the follow-up reports "could not confirm", never "failed".

### Implementation for User Story 3

- [ ] T018 [US3] Add the follow-up bound to `orchestrator/src/config.ts` — `FOLLOWUP_TIMEOUT_MS`, required, fail loud, a default aligned with SC-001's two-minute join target. Bounds how long US3 waits before "could not confirm" (FR-029)
- [ ] T019 [US3] Implement `orchestrator/src/followup.ts` — after a `/start` returns 202, poll the agent's `/status` until `running` or the bound elapses, then post a **new message** in the same channel (FR-028): "running — try joining" (the clarified meaning of *up* — the control API answers, not a joinability probe) or "could not confirm within N" — **never "failed"** (FR-029). Held in memory only; a restart abandons the wait and posts nothing (FR-032). No follow-up for a refused start (FR-030); every follow-up names its server (FR-031)
- [ ] T020 [US3] Make the immediate `/start` reply read *in progress* in `orchestrator/src/commands.ts` — restore the amber `progress` tone (left unreachable in code since `main`), meaning "launching", and arm the follow-up from `handleStart` on a 202 (FR-027). A 409/refusal stays terminal and arms nothing
- [ ] T021 [P] [US3] Unit-test the follow-up state machine in `orchestrator/src/followup.test.ts` — `running` before the bound → "running"; bound elapses → "could not confirm" (asserts it never reads as "failed"); a refused start arms no follow-up; the pending wait holds nothing that would survive a restart

**Checkpoint**: A start you walk away from tells you when it is up — or honestly that
it could not confirm. The milestone is complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Exposure, the /address interaction, docs, decisions, and the regression
that 001 is unchanged. **T022 is not optional.**

- [ ] T022 Satisfactory exposure per [quickstart.md](quickstart.md) — forward **`7777/UDP` only**; add a firewall rule blocking `7777/TCP` from the LAN (mirroring `Reveille - block Palworld REST API`); confirm from **outside** the network that only `7777/UDP` answers and the HTTPS API does not (FR-014, FR-015, SC-007). **Not optional** — the 7777 UDP-game / TCP-API split is the trap (research R7)
- [ ] T023 Reconcile `/address` with the multi-server config in `orchestrator/src/index.ts` + `commands.ts` — it currently assumes one `GAME_PUBLIC_PORT`; two servers share the public IP but differ in game port, so `/address` must name a server (subcommand) or report per-server. The out-of-band `/address` from `main` meets 002's config here
- [ ] T024 [P] Update `CLAUDE.md` — the second server, the `GameAdapter` boundary and adapter-by-config, the status verb, and Satisfactory's ports (`7777/UDP` game, `7777/TCP` API, loopback-only)
- [ ] T025 [P] Record `DECISIONS.md` entries (Constitution V) — the `GameAdapter` seam, adapter-selection-by-config, orchestrator multi-agent config, the status verb (contract v2, additive), the US3 follow-up model, and Satisfactory-over-HTTPS with the 7777 UDP/TCP split
- [ ] T026 Run the full [quickstart.md](quickstart.md) end to end, including §5 — the **SC-009 regression**: every 001 behaviour (start/stop, all refusals, and the zero-tolerance save-durability, SC-002) is unchanged by adding Satisfactory

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **blocks all user stories**
- **US1 (Phase 3)**: depends on Foundational. T010 (M0) blocks T011 (the adapter);
  T011 + T012 + T013 make a named second server real
- **US2 (Phase 4)**: depends on Foundational (the agent `/status` endpoint T006 and
  the orchestrator agent map T008). Independent of US1 in code
- **US3 (Phase 5)**: depends on Foundational **and US1** — it arms its follow-up from
  the `/start` flow (T013/T020) and polls the status endpoint
- **Polish (Phase 6)**: T022 after T011 (Satisfactory runs); T026 after all stories

### Within a story

- Adapter/handler → registration → routing → test, each layer calling the one before.
- Strictly sequential where a task edits a file an earlier task created.

### Parallel Opportunities

- T001, T002 parallel (separate files).
- T007, T009 parallel after their targets exist.
- T014, T017, T021 are each a test file, parallel with each other once their story's
  code lands.
- T024, T025 parallel (docs vs decisions).
- **US2 and US3 cannot be parallelised by different people cleanly**: both edit
  `orchestrator/src/commands.ts` and `index.ts`. With one developer this is moot.

---

## Implementation Strategy

### MVP: User Story 1 only

1. Setup → 2. Foundational → 3. US1 (incl. Satisfactory M0 + adapter).
4. **STOP and validate** — `/start satisfactory` from a phone, join; Palworld untouched.

That is a working two-server system: name a server, start/stop it. Status and the
follow-up are convenience layered on top.

### Incremental delivery

- Setup + Foundational → an agent runs either game by config; the orchestrator knows
  both.
- **+ US1 → MVP: two servers, named commands.**
- + US2 → ask what's running.
- + US3 → told when it's up.
- + Polish → exposed safely, documented, and 001 proven unchanged.

### Prerequisite outside this task list

**Satisfactory M0 (T010) gates the adapter**, exactly as Palworld's M0 gated 001's:
the server must be claimed from the game client and its API observed before
`satisfactory.ts` is written. Palworld's M0 is already satisfied (001).

---

## Notes

- **The seam gains one verb (`status`) and nothing else** — no server id, no
  discriminator. A 001 conformance check still passes (SC-009, contracts v2).
- **`agent/src/satisfactory.ts` is the only new file that may know its game**, and
  `palworld.ts` the only existing one. Nothing else branches on which game (FR-025).
- **The agent keeps zero runtime dependencies** — `node:https` (built-in) for
  Satisfactory's TLS, `fetch` for Palworld, `node:http` for the server.
- **Nothing persists**, including US3's pending wait (FR-012, FR-032).
- Commit after each task or logical group. Secrets stay in `.env`; **the repository
  is public**.
