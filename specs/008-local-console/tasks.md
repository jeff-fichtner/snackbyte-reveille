---

description: "Task list for 008 — One console for the operator"
---

# Tasks: One console for the operator

**Input**: Design documents from `/specs/008-local-console/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/console-surface.md](contracts/console-surface.md), [quickstart.md](quickstart.md)

**Tests**: Included. `node:test`, beside their source as `*.test.ts` — the repository's standing convention, and `npm run check:all` must stay green at every step, not only at the end.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete work)
- **[Story]**: US1 / US2 / US3 — user-story phases only

## Two hard orderings

1. **T001 precedes all code.** Constitution V and FR-035: the `DECISIONS.md` entry recording the console as a second client of the seam — and the never-outlive-the-human rule — is written *before* the thing it justifies exists.
2. **T002 (M0) blocks every US2 implementation task.** `detached` and `windowsHide` set different Windows process-creation flags and their interaction is the whole question (`research.md` §5). This repository measures rather than assumes; guessing here means writing the launcher twice.

---

## Phase 1: Setup

- [X] T001 Record `DECISIONS.md` 025 in `initial-architecture/DECISIONS.md` — the console as a second client of the seam, why it is **not** a fourth kind of component, and the never-outlive-the-human rule that keeps that true. **Before any code** (FR-035, Constitution V)
- [X] T002 Run the M0 spawn measurement and record `specs/008-local-console/m0-windows-spawn.md` — all four observations from `quickstart.md` §1: no window, serving on its port, survives the launching terminal, log fills. **Blocks all of Phase 4** (`research.md` §5)
- [X] T003 [P] Add `logs/` to `.gitignore` — service output is operator data, never committed
- [X] T004 [P] Add a console entry script to `orchestrator/package.json` so the console is runnable from the workspace as well as the shim

---

## Phase 2: Foundational (blocks every user story)

**Purpose**: the shared machinery every story needs. The surface derivation, rendering, and exit codes live here deliberately rather than in US1 — if US1 hand-wrote an argv parser, US3 would replace it, which is the exact second-copy drift this feature exists to remove (`plan.md`, Complexity Tracking).

- [X] T005 Extract the pure core of each handler in `orchestrator/src/commands.ts` as `runX(...) → { reply, serverName }` — routing, verb choice, defaults and sign handling move in; Discord I/O stays out
- [X] T006 Rewrite the handlers in `orchestrator/src/commands.ts` and `orchestrator/src/index.ts` as *defer → run → `sendReply`*, so Discord behaviour is unchanged and now delegated
- [X] T007 [P] Test in `orchestrator/src/commands.test.ts` that every existing reply assertion still holds through the extracted cores — the refactor must be provably behaviour-preserving. This is also what carries FR-023 (never claim an outcome the agent did not report) into the console: the guarantee is inherited by reusing `describeX` unchanged rather than re-implemented
- [X] T008 Create `orchestrator/src/console/targets.ts` — build the target map by unioning every tenant via the orchestrator's own `parseTenants` (FR-011, FR-012)
- [X] T009 [P] Test in `orchestrator/src/console/targets.test.ts`: same name + same URL unions to one; same name + **different** URL refuses naming both tenants (FR-013); malformed or missing `TENANTS` throws naming the variable (FR-014); the map is never built from `agent/.env.*` (FR-015)
- [X] T010 Create `orchestrator/src/console/surface.ts` — derive the runnable command surface and argv parsing from `buildCommandGroups`, authoring no command name or description (FR-005)
- [X] T011 [P] Test in `orchestrator/src/console/surface.test.ts`: a target verb missing its name fails naming the targets, and for `start`/`stop` also names both objects (FR-003); a verb aimed at the wrong kind is refused without contacting anything; an unknown name lists the valid ones
- [X] T012 Create `orchestrator/src/console/render.ts` — print `reply.text`, then `footnote`, then `diagnostic`, then which agent URL answered (FR-021, `contracts/console-surface.md` §4)
- [X] T013 [P] Test in `orchestrator/src/console/render.test.ts`: the first line is exactly what Discord renders; `diagnostic` appears here and only here; **and the secrets guard — no value from `process.env`, above all `DISCORD_BOT_TOKEN`, can reach any output path** (`research.md` §9)
- [X] T014 Create `orchestrator/src/console/index.ts` — the entry point: argv → verb → run → render → exit code (`0` / `2` / `3` / `64`, with `1` deliberately unused)
- [X] T015 [P] Test in `orchestrator/src/console/index.test.ts` that each of the four outcome classes maps to its code and that refused (`2`) and unreachable (`3`) never collapse together (FR-022)
- [X] T016 Rewrite `scripts/reveille.cmd` to launch the console with `--env-file=<root>/orchestrator/.env`, passing the repository root from `%~dp0` so `reveille` works from any directory (`research.md` §9)

**Checkpoint**: the console runs, parses, renders, and exits correctly — with no command wired yet.

---

## Phase 3: User Story 1 — Command a target from the machine it runs on (P1) 🎯 MVP

**Goal**: the operator starts, stops, and nudges targets from a shell on `watson`, with Discord and the orchestrator both irrelevant to whether it works.

**Independent test**: stop the orchestrator entirely, then run every target command and confirm each behaves exactly as it does from Discord.

- [X] T017 [US1] Wire the game verbs — `start`, `stop`, `address` — in `orchestrator/src/console/index.ts` through the Phase 2 cores, as **bare** verbs mirroring the Discord commands one-for-one (FR-001)
- [X] T018 [US1] Implement the foreground watch for `reveille start <game>` in `orchestrator/src/console/index.ts`: poll until the target is observed running or `FOLLOWUP_TIMEOUT_MS` expires, then exit. Never detach a watcher (FR-018, SC-001)
- [X] T019 [P] [US1] Test in `orchestrator/src/console/index.test.ts` that the watch always terminates, that interrupting it does not cancel the issued launch and says so (FR-019), and that no watcher outlives the process (FR-017)
- [X] T020 [US1] Wire the media verbs — `pause`, `play`, `next`, `previous`, `forward`, `back` — inheriting the signed-magnitude and default rules unchanged from 005/007
- [X] T021 [US1] Wire `reveille status` to fold every target in the union, in each target's own vocabulary
- [X] T022 [P] [US1] Test that no target command reads or contacts the orchestrator, so all of them work while it is stopped (FR-008, FR-009, SC-005)
- [X] T023 [P] [US1] Test that an invocation persists nothing between runs — no state file, cache, or memo (FR-016, SC-006)

**Checkpoint**: US1 is independently shippable. The windows are still there; the console is already useful.

---

## Phase 4: User Story 2 — A control plane that leaves no windows and keeps its output (P2)

**Goal**: `plane up` starts everything with no window anywhere, confirms each service is really serving, and keeps output that used to vanish with a closed window.

**Independent test**: run `plane up`, confirm no window appears, all four services answer, logs fill, and everything survives closing the launching terminal.

**Blocked by T002.**

- [X] T024 [US2] Create `orchestrator/src/console/plane.ts` — discover services from `agent/.env.*` plus `orchestrator/.env`, taking each agent's port from its own `AGENT_PORT`. No hardcoded table (`research.md` §4)
- [X] T025 [P] [US2] Test in `orchestrator/src/console/plane.test.ts` that a newly added `agent/.env.<target>` is discovered with no code change, and that the port has exactly one source
- [X] T026 [US2] Create `orchestrator/src/console/logs.ts` — rotate the current log to one prior generation on `plane up`, then start fresh (FR-028)
- [X] T027 [P] [US2] Test in `orchestrator/src/console/logs.test.ts`: at most two generations ever exist, a first-ever run has only one, and restarting never destroys the log of the crash being investigated (SC-003)
- [X] T028 [US2] Implement `plane up` in `orchestrator/src/console/plane.ts` — spawn windowless and detached per the **measured** M0 flags, redirect output to each service's log, then verify readiness per kind: an agent answers `GET /status` 200, the orchestrator writes its connected line. **Name the readiness bound explicitly and assert that expiry reports `failed`** — an unbounded wait would contradict the always-terminates rule in `contracts/console-surface.md` §6 (FR-026, FR-027, FR-031, FR-034, `research.md` §6)
- [X] T029 [P] [US2] Test that a service which exits at boot is reported **failed, never started**, names its log, and drives a non-zero exit (FR-034, SC-010). Also assert **no window was created for any service** (SC-002), the observation T002 measured
- [X] T030 [US2] Implement `plane down` in `orchestrator/src/console/plane.ts` — enumerate processes and match on entry script **and** env file, never a recorded id alone (FR-032)
- [X] T031 [P] [US2] Test the Constitution IV guard in `orchestrator/src/console/plane.test.ts`: the matcher can never select a game server, VLC, or an unrelated `node` process, so `plane down` cannot change any controlled target (FR-033, SC-008)
- [X] T032 [US2] Implement `plane status` and `plane restart`, including scoping any `plane` verb to one named service and defaulting to all. This completes the `plane` namespace — `up`, `down`, `restart`, `status`, `logs` (FR-002, FR-007, FR-030), and its wording must satisfy FR-024, which T047 pins
- [X] T033 [US2] Implement `plane logs` — one merged, followable view across the services' logs (FR-029)
- [X] T034 [P] [US2] Test that `plane up` is idempotent (an already-running service is skipped, never launched twice) and that the exit code reflects the worst service outcome (FR-030)

**Checkpoint**: no windows, output preserved, targets provably untouched.

---

## Phase 5: User Story 3 — A local surface that cannot disagree with Discord (P3)

**Goal**: the listing and the diagnosis are structurally incapable of drifting from the Discord surface.

**Independent test**: add a command to `buildCommandGroups` and confirm it appears in both Discord's registration and `reveille help` with no second list edited.

- [X] T035 [US3] Implement `reveille help` and bare `reveille` in `orchestrator/src/console/index.ts`, rendering `describeCommandList(buildCommandGroups(...))` (FR-004)
- [X] T036 [P] [US3] Test in `orchestrator/src/console/surface.test.ts` that the listing's entries are exactly the registered entries — a command cannot be listed that is not registered, omitted when it is, or described differently (FR-006, SC-004)
- [X] T037 [US3] Implement the FR-025 addition in `orchestrator/src/console/index.ts` — an **unreachable** target also reports whether its agent process is running, while a reachable one reads exactly as Discord reports it
- [X] T038 [P] [US3] Test both halves of FR-025: player closed but agent up, and agent down — the two must be distinguishable from one command (SC-009)
- [X] T039 [P] [US3] Test that an ambiguous or unknown command contacts nothing and exits non-zero (FR-003, SC-007)

**Checkpoint**: all three stories complete and independently verified.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T040 Delete `scripts/reveille.ps1` — there must be no second way to manage the plane (FR-036)
- [X] T041 Update `CLAUDE.md` — the new verb split, the `plane` namespace, the logs, and the fact that the console is not a component
- [X] T042 [P] Verify the seam is untouched: `contract/` and `agent/` unmodified, still eight verbs, no target identifier in any path (FR-010, Constitution I)
- [X] T043 [P] Verify no runtime dependency was added anywhere, and that the agent still has zero (`plan.md`, Technical Context)
- [X] T044 [P] Re-check `site/index.html` makes no claim this feature invalidates, and record the finding — the Constitution makes the homepage a spec deliverable, so "no change needed" must be *verified*, not assumed
- [X] T045 Run `npm run check:all` — typecheck, lint, and every test green
- [X] T046 Run `quickstart.md` end to end on `watson` — **§1, §4, §5, §6, §7, §8, §9, §10 run live and passing**. §2's live game start and §3's media mutations were deliberately not run (see Phase 8)

---

## Phase 7: Added by analysis (2026-08-10)

Two requirements had no task. Appended rather than renumbered, following 007's precedent.

- [X] T047 [US3] Test in `orchestrator/src/console/index.test.ts` that `reveille status` and `reveille plane status` cannot be mistaken for one another — a service being up must never read as its target being up, including in the case that makes it matter: **agent up, game stopped** (FR-024). Found by analysis with **zero coverage**, and it guards the feature's central naming decision
- [X] T048 [P] Test in `orchestrator/src/console/index.test.ts` that the console registers no scheduled work, spawns no poller of its own, and offers no daemon or `--watch` mode (FR-020). Previously reachable only through the manual `quickstart.md` §9 check

---

## Dependencies

```text
T001 ─────────────────────────────► everything (Constitution V gate)
T002 ─────────────────────────────► Phase 4 (measured flags)

Phase 2 (T005–T016) ──────────────► Phase 3, Phase 4, Phase 5
   T005 → T006 → T007
   T010 → T011,  T012 → T013,  T014 → T015

Phase 3 (US1) ── independent of Phase 4 and Phase 5 once Phase 2 lands
Phase 4 (US2) ── needs T002 + Phase 2 only; independent of US1 and US3
Phase 5 (US3) ── needs Phase 2 only; T037 reads plane state, so it also needs T024

Phase 6 ──────────────────────────► after all stories
Phase 7 (T047, T048) ─────────────► appended by analysis; T047 needs T021 + T032,
                                     T048 needs T014. Both before T045/T046.
```

**Story independence**: US1, US2, and US3 touch different files once Phase 2 exists, and each is separately demonstrable. The single cross-story edge is T037, which needs the service discovery from T024 to answer "is that target's agent running".

**That edge was raised by analysis and resolved by decision (2026-08-10): all three stories are built in one pass.** T037 → T024 is therefore a **build-order** fact, not a delivery constraint — it says only that T024 lands before T037, which the phase order already gives. The stories keep their priorities because they still decide *what is written first* and *what a partial state would be worth*, but no release stops between them, so nothing was moved between stories to preserve an independence that will not be exercised.

## Parallel opportunities

- **Setup**: T003, T004 together (T001 first, T002 anytime before Phase 4)
- **Foundational**: the four test tasks T007, T009, T011, T013, T015 each parallel their implementation
- **US1**: T019, T022, T023 together
- **US2**: T025, T027, T029, T031, T034 together
- **US3**: T036, T038, T039 together
- **Polish**: T042, T043, T044 together

## Implementation strategy

**All three stories are implemented in one pass** (decided 2026-08-10). The priorities still govern **order of work**, not release boundaries: US1 first because it is the capability that does not exist in any form today, US2 next because it removes the daily irritation and closes the silent-failure gap the windows were accidentally covering, US3 last because it hardens a property rather than adding a capability.

**US1 remains the natural fallback scope** if the pass has to stop early — Phase 1 + Phase 2 + Phase 3 is a coherent thing to have, with the four windows still there. It is a fallback, not the plan.

Two things are not negotiable regardless of how far the increment goes: T001 before any code, and T002 before any of Phase 4.


---

## Phase 8: Convergence (2026-08-10)

Appended by `/speckit-converge`. **No requirement is unimplemented and no constitution
principle is violated** — every gap here is the same shape: a path that is unit-tested and
structurally verified, but never exercised against the live target. Each needs a real game
server or a visible change to what is playing, which is why it stopped at the automated edge.

- [ ] T049 Run `reveille start satisfactory` against the real server and watch it through to "is up" — the foreground watch, the 202→running transition, and the report are unit-tested but have never run end to end (T046, quickstart §2, FR-018, SC-001) (partial)
- [ ] T050 Interrupt a live `reveille start` with Ctrl-C and confirm the launch was unaffected and the console said so — currently asserted against the source only, never exercised (T046, quickstart §2, FR-019) (partial)
- [ ] T051 Issue each media verb live — `pause`, `play`, `forward`, `back`, `next`, `previous` — and compare the first line with what Discord shows for the same command. Not run during implementation because VLC was mid-episode and every one of these is a visible change to what is playing (T046, quickstart §3, FR-021, SC-004) (partial)
- [ ] T052 Optionally exercise the `TENANTS` conflict guards against the real `orchestrator/.env` — same name at two different addresses, then the same address — restoring afterwards (quickstart §8, FR-013, FR-014) (partial)
