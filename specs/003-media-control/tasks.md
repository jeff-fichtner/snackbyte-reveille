---
description: "Task list for 003-media-control"
---

# Tasks: Pause and resume the show from Discord

**Input**: Design documents from `/specs/003-media-control/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/agent-api.md](contracts/agent-api.md)

**Tests**: Unit tests are included for the pure, target-agnostic logic (config loaders,
command routing, status rendering, the media-state mapping) — that logic is the new
surface and is testable without a live player. Anything touching VLC is validated against
a **real** install (M0 + quickstart), never mocked — the reason M0 exists.

**Organization**: Tasks are grouped by user story so each is independently implementable
and testable. US1 is the MVP.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story the task serves (US1, US2)
- Exact file paths are included in every task

## Path Conventions

Monorepo, one package per component (unchanged): `contract/`, `agent/`, `orchestrator/`.
**No new package** — media is a second *adapter kind* in the existing `agent/`, a row not
a new component kind (plan Structure Decision, Constitution II).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Configuration surfaces for a media agent and a multi-kind orchestrator. No
behaviour yet.

- [ ] T001 [P] Extend `agent/.env.example` — add the **media target**: a value on the adapter selector that picks the media adapter (e.g. `GAME=vlc`, or rename the selector to a target discriminant if cleaner), plus the VLC values (web-interface base URL e.g. `http://127.0.0.1:8080`, and the web-interface password placeholder). Document each; every value required and fail-loud, no fallback. The games' blocks are unchanged.
- [ ] T002 [P] Rework `orchestrator/.env.example` — each `AGENTS` entry gains `kind` (`game` | `media`); document a media entry (`{ "name": "vlc", "url": "…", "kind": "media" }`, **no** `publicPort`). A missing/unknown `kind` fails loud.

**Checkpoint**: The config shapes for a media agent and a mixed-kind orchestrator are documented and copy-ready.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The target-agnostic machinery both stories need — the media adapter kind,
the additive contract, the server's per-kind verb dispatch, and the orchestrator's
kind-aware config.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T003 Extend the contract in `contract/src/index.ts` — add `MediaState = 'playing' | 'paused' | 'stopped'` and widen `AgentResponse.state` to `ServerState | MediaState`. **Additive** — every v2 field is unchanged; the no-discriminator contract test still passes (contracts/agent-api.md v3)
- [ ] T004 Define the `MediaAdapter` interface in `agent/src/adapter.ts` — `getState(): Promise<MediaState>`, `pause(): Promise<void>`, `resume(): Promise<void>` — beside `GameAdapter`. Extend `createAdapter` to return a media adapter for the media target; **nothing outside the adapter branches on the target** (FR-025-analog)
- [ ] T005 Recognise the media target in `agent/src/config.ts` — the adapter selector accepts the media value and requires the VLC config block (web URL, password) fail-loud, naming each; the game configs are untouched. `agent/src/index.ts` builds the media adapter at boot when selected
- [ ] T006 Dispatch media verbs in `agent/src/server.ts` — for a media adapter, route `POST /pause` → `pause()` and `POST /play` → `resume()`; for a game adapter, `POST /start`/`/stop` as today; `GET /status` for **both**, still **off the command mutex** (the game path is byte-for-byte unchanged). Responses per contracts/agent-api.md v3 (200 no-op, 409 stopped, 500 error)
- [ ] T007 Load kinds in `orchestrator/src/config.ts` — parse each `AGENTS` entry's `kind` (`game` | `media`, required, fail loud); a media entry has no `publicPort` (a game entry still requires one). The name still lives only here and on the Discord surface, never in the contract (FR-014)
- [ ] T008 [P] Unit-test the config loaders in `agent/src/config.test.ts` and `orchestrator/src/config.test.ts` — the media target's values and the `AGENTS` `kind` fail loud by name on missing/blank/unknown; no silent fallback; a game entry still requires `publicPort`, a media entry must not

**Checkpoint**: An agent boots as a media agent by config and answers `/pause` `/play`
`/status` on loopback; the orchestrator holds game and media targets by kind.

---

## Phase 3: User Story 1 - Pause and resume the show (Priority: P1) 🎯 MVP

**Goal**: From Discord, pause an already-playing show and resume it from the same spot.

**Independent Test**: With a video playing in VLC, `/pause` pauses it within ~2s and
`/play` resumes from where it stopped; nothing loaded → both refused honestly; the agent
down → "could not reach". No content was chosen or changed by Discord.

### Implementation for User Story 1

- [ ] T009 [US1] **M0 for VLC** — enable VLC's web interface + set its password (the one-time operator setup), then **observe**: the control endpoint and port (default `8080`); that Basic auth is empty-user + password; the exact `command=` names for pause/resume (`pl_forcepause` / `pl_forceresume`); the `state` values in `status.json` (`playing`/`paused`/`stopped`); how *nothing loaded* presents; and that the interface binds loopback. Feeds T010 and **must precede it** (quickstart Prerequisites). Record in `specs/003-media-control/m0-vlc.md`. Operator-only step
- [ ] T010 [US1] Implement `agent/src/vlc.ts` as a `MediaAdapter` over VLC's HTTP web interface using native **`fetch`** (plain HTTP on loopback, Basic auth empty-user + password — keeps zero runtime deps, no `node:https`): `getState` (`GET status.json` → map `state` to `playing`/`paused`/`stopped`), `pause` (`?command=pl_forcepause`), `resume` (`?command=pl_forceresume`). **No content-selection, playlist, seek, or OS-level kill may appear here** (FR-004, FR-011). Written against T009's observations, not docs
- [ ] T011 [P] [US1] Add `agent/src/vlc.test.ts` — source-level guarantees mirroring the game adapters' bans: no OS-level process termination (`process.kill`, `.kill(`, `taskkill`, `Stop-Process`); no content-selection commands (`pl_play` with an id, `in_play`, `pl_empty`, `pl_jump`, seek); the base URL is loopback
- [ ] T012 [US1] Add `pause()` and `play()` to `orchestrator/src/agent-client.ts` (POST `/pause`, `/play`), and register `/pause` and `/play` as **bare commands** (no subcommand — one media target, SC-001 "two taps") in `orchestrator/src/index.ts`, dispatched to the media target
- [ ] T013 [US1] Route + reply in `orchestrator/src/commands.ts` — `describePause` / `describeResume`: paused / resumed (200), already-in-that-state as a **no-op** (FR-007), refused when stopped (409, FR-008), and unreachable distinct from a state (FR-009); name is resolved to the one media target, and a media command never touches a game (FR-021)
- [ ] T014 [P] [US1] Unit-test pause/resume routing + replies in `orchestrator/src/commands.test.ts` — 200 reads as done, no-op reads as no-op (not failure), 409-stopped refused honestly, unreachable distinct; a media command reaches only the media agent

**Checkpoint**: `/pause` from a phone pauses the show; `/play` resumes it. **The remote is
real** — the MVP.

---

## Phase 4: User Story 2 - See it in /status (Priority: P2)

**Goal**: The media player's state appears in the same `/status` as the games.

**Independent Test**: With a game running and the show paused, `/status` lists both — the
game as *running*, the player as *paused* — each in its own vocabulary; a closed player
lists *unreachable* while the games still report normally.

### Implementation for User Story 2

- [ ] T015 [US2] Fold media into `describeStatus` in `orchestrator/src/commands.ts` — `/status` already queries every configured target via `agent-client.status()`; render a media target in its own vocabulary (`playing`/`paused`/`stopped`), `unreachable` when its agent does not answer (FR-023/026), alongside the games in theirs. Extending it is **additive** — game rendering is unchanged (FR-013). Say nothing about content (FR-011)
- [ ] T016 [P] [US2] Unit-test the folded status in `orchestrator/src/commands.test.ts` — a media target rendered in its vocabulary; unreachable distinct from stopped; the game targets still rendered as before

**Checkpoint**: `/status` reports every target on watson, games and the player, each in its own state.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: The recorded scope-widening (constitution + decisions), docs, tooling, and
the regression that the games are unchanged.

- [ ] T017 Amend `.specify/memory/constitution.md` — broaden **Principle II** ("welded to a game server process" → "welded to a controllable target on a host") and the opening line ("control plane for self-hosted game servers" → "…for controllable targets on a host"); MINOR version bump per Governance. This is the constitution change the widening requires (plan Complexity Tracking)
- [ ] T018 Record `DECISIONS.md` entries (Constitution V) — the scope-widening (game servers → controllable targets), media as a **second adapter kind** with its own verbs, the additive **seam v3** (media verbs + `MediaState`), and **VLC-over-its-HTTP-interface** (loopback, plain HTTP, `fetch`, zero deps). Written before the widening is treated as settled elsewhere
- [ ] T019 [P] Update `CLAUDE.md` — the media target, the `MediaAdapter` boundary and adapter-by-config across kinds, the `/pause` `/play` verbs, the folded `/status`, VLC's one-time web-interface setup, and that media adds **no exposure**
- [ ] T020 [P] Extend `scripts/reveille.ps1` — add the media agent to the control-plane start/stop/status set (its own env file, loopback port), so one command still brings the whole plane up
- [ ] T021 Run the full [quickstart.md](quickstart.md) §5 — the **SC-007 regression**: every 001/002 behaviour (start/stop/status/address, all refusals, save-durability) is unchanged by adding media, and the game agents never answer the media verbs
- [ ] T022 Run [quickstart.md](quickstart.md) §4 — the **no-exposure check** (SC-004): from outside the network, confirm media control opened no new port (the web interface and the media agent are loopback-only)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **blocks both user stories**
- **US1 (Phase 3)**: depends on Foundational. T009 (M0) blocks T010 (the adapter); T010 + T012 + T013 make the remote real
- **US2 (Phase 4)**: depends on Foundational (the orchestrator kind config T007 and the media agent's `/status` T006). Independent of US1 in code
- **Polish (Phase 5)**: T021/T022 after the stories; T017/T018 (constitution/decisions) any time after the design is settled

### Within a story

- Adapter/handler → registration → routing → test, each layer calling the one before.
- Strictly sequential where a task edits a file an earlier task created.

### Parallel Opportunities

- T001, T002 parallel (separate files).
- T008 parallel after its targets exist; T011, T014, T016 are each a test file, parallel with each other once their story's code lands.
- T019, T020 parallel (docs vs tooling).

---

## Implementation Strategy

### MVP: User Story 1 only

1. Setup → 2. Foundational → 3. US1 (incl. VLC M0 + `vlc.ts`).
4. **STOP and validate** — `/pause` from a phone pauses the show; `/play` resumes; the games untouched.

That is a working remote: pause and pick a show back up from Discord. The folded status is
convenience layered on top.

### Incremental delivery

- Setup + Foundational → an agent runs as a media agent by config; the orchestrator knows the media target.
- **+ US1 → MVP: pause and resume from Discord.**
- + US2 → the player shows up in `/status`.
- + Polish → the widening recorded, documented, tooled, and the games proven unchanged.

### Prerequisite outside this task list

**VLC M0 (T009) gates the adapter**, exactly as the game M0s gated 001/002: VLC's web
interface must be enabled and observed before `vlc.ts` is written against it.

---

## Notes

- **The seam gains two verbs (`pause`, `play`) and a media state — nothing else.** No
  target id, no content selector. A 001/002 conformance check still passes (SC-007,
  contracts v3).
- **`agent/src/vlc.ts` is the only new file that may know VLC.** Nothing else branches on
  which target it is (FR-025-analog).
- **The agent keeps zero runtime dependencies** — VLC's web interface is plain HTTP on
  loopback, so native `fetch` reaches it; no `node:https`.
- **Nothing persists.** Playback state is derived per request (FR-012-analog).
- **No network exposure is added** — control is loopback, the video is local.
- Commit after each task or logical group. Secrets (the VLC password) stay in `.env`;
  **the repository is public**.
