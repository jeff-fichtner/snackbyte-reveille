---
description: "Task list for 005-more-media-commands"
---

# Tasks: Four more media controls, all context-free

**Input**: Design documents from `/specs/005-more-media-commands/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/agent-api.md](contracts/agent-api.md), [quickstart.md](quickstart.md)

**Tests**: Unit tests are **required**, not optional, for one reason the spec makes explicit:
FR-011 demands the content bans stay enforced by "an automated check that fails if a forbidden
capability reappears — never left to human review." `agent/src/vlc.test.ts` is that check, and
this feature **moves the line it draws**, so the test file changes in lockstep with the adapter.
The remaining tests follow the house convention (tests beside source, `node:test`).

**Organization**: Grouped by user story. US1 (seek) is the MVP and settles the input shape.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1, US2, US3
- Exact file paths are in every task

## Path Conventions

Monorepo (`contract/`, `agent/`, `orchestrator/`, `site/`). **`contract/src/index.ts` is
deliberately not opened** — seam v4 adds verbs and one operation parameter, not types
(contracts/agent-api.md). No new package, no new dependency, no new environment variable.

---

## Phase 1: Setup — record the decisions BEFORE the code

**Purpose**: Constitution V, and FR-010 makes the first one mandatory *before implementation
begins*. This is why Setup is not empty and why these are not Polish tasks: 005 **amends a
recorded requirement** and **changes the seam**, and the reasoning has to be written down while
it is still the reason, not reconstructed afterwards.

> Note the deliberate departure from 004, which recorded its decision in Polish. 004 introduced
> a row; 005 rewrites a rule and touches the seam, and FR-010 says "before".

- [X] T001 Append **`DECISIONS.md` 022 — the media ban narrows to "no knowledge of content"** in `initial-architecture/DECISIONS.md`. State that 003 FR-004 moves from *no movement through content* to *no knowledge of content*; that `pl_next`/`pl_previous`/relative `seek` become permitted **because they are blind relative operations**; and that naming, browsing, listing, selecting, enqueuing, jumping to an item, volume, stop, and OS termination all stay forbidden. Record what it was chosen **over**: the narrower "position within an item is fair game, playlist stepping is not", rejected because it draws the line at *movement* rather than at *knowledge* and would permit seeking while forbidding `pl_next` for no principled reason. Required by **FR-010** before any code.
- [X] T002 Append **`DECISIONS.md` 023 — the seam gains three media verbs and its first operation parameter (contract v4, additive)** in `initial-architecture/DECISIONS.md`. Record `POST /next`, `POST /previous`, `POST /seek?seconds=<signed int>`; that **no data had ever crossed the seam in a request** before this (every prior verb is a bare POST); and the rule that keeps Constitution I intact — **a parameter of the *operation* may cross; a name for *which target* may not** (`seconds` says how far, never which player). State what it was chosen over: a JSON request body (rejected — stream buffering, parsing, and malformed-input handling to carry one integer), and four verbs instead of three (rejected — forward/back are one operation over a signed magnitude). Note explicitly that this precedent does **not** license a `target`/`name`/`id`/`kind` parameter.

**Checkpoint**: The amendment and the seam change are on the record. Code may now be written.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Measure the player before writing anything that talks to it. **⚠️ Blocks US1 and US2.**

- [X] T003 **M0 for the four controls** — observe against a **real** VLC and record in `specs/005-more-media-commands/m0-vlc-controls.md`. Drive a **scratch headless instance on its own HTTP port** with its own password and a **multi-minute** clip (003's 3-second clip is useless for observing a ±30 s seek) — **never the operator's live player**: `vlc.exe --intf dummy --extraintf http --http-host 127.0.0.1 --http-port <scratch> --http-password <scratch> --loop <clip>`. Record, with the request and response for each: (1) the exact relative-seek command and parameter, **and the precise wire encoding that works — including how `+` must be encoded**, since `+` decodes to a space in a query string; (2) that a positive value moves **forward from the current position** and a negative one **backward**, confirmed by reading position before/after at the player; (3) **what a bare/unsigned `val` does**, so the absolute form is identified by name for the ban in T004; (4) `pl_next`/`pl_previous` exact names, and behaviour at a playlist boundary and on a single-item playlist (recorded only, never depended on); (5) behaviour when **paused** rather than playing; (6) behaviour when **nothing is loaded** (`state: "stopped"`); (7) whether an over-long seek clamps, wraps, or ends the item (recorded so replies are honest — **not** so the code compensates; FR-005 forbids compensating). **Gates T004, T006 and T015 exactly as 003's T009 gated T010** — T004 needs the absolute-seek form named before it can ban it, and T006/T015 are the two tasks that speak to the player. T005/T014 are signature-only and need no measurement (FR-019).

**Checkpoint**: VLC's real behaviour is written down. The adapter can be written against observation, not documentation.

---

## Phase 3: User Story 1 - Replay the line everybody missed (Priority: P1) 🎯 MVP

**Goal**: `/forward [seconds]` and `/back [seconds]` move the position relative to now, default 30, unbounded.

**Independent Test**: With something playing, `/back` moves back 30 s; `/back 90` moves back exactly 90 s; `/forward 45` moves forward exactly 45 s. Position is read **at the player** — the system never reports it. Delivers the replay capability with next/previous entirely unbuilt.

### Implementation for User Story 1

- [X] T004 [US1] **Redraw the ban list for seek** in `agent/src/vlc.test.ts` — remove `/[?&]command=seek/` from the forbidden list and **assert it is now required** to appear; **add a new ban on the absolute-seek form** identified by T003 (an unsigned/bare `val=`), which **FR-011 requires** — movement through an item is relative only. Every other ban stays exactly as-is: `pl_play`, `in_play`, `in_enqueue`, `pl_empty`, `pl_delete`, `pl_jump`, `pl_stop`, `command=volume`, `pl_pause`, and all four OS-kill patterns. Write this **first**: the required-seek assertion fails until T006 lands, which is the point (FR-011).
- [X] T005 [US1] Extend `MediaAdapter` in `agent/src/adapter.ts` with **`seek(seconds: number): Promise<void>`** — signature only, no VLC in it (only an adapter file may know its target, 003 FR-025). Document that the value is signed, relative, and unbounded.
- [X] T006 [US1] Implement **`seek`** in `agent/src/vlc.ts` using the exact command, sign convention, and **wire encoding recorded in T003's M0** — not from documentation. Reuse the existing `vlcFetch`; add no dependency and no new host literal (the base URL still comes from config). Update the file's header comment: the "no seek" ban it currently states is superseded by DECISIONS 022, narrowed to no *knowledge* of content.
- [X] T007 [US1] Add **`POST /seek`** to the media branch of `route()` in `agent/src/server.ts`. Parse `seconds` from the query with the platform's own `URL`/`URLSearchParams` (zero deps); **missing, blank, or non-integer → `400` naming `seconds`** — the agent has **no default**, because the 30 lives only in the orchestrator and a silent fallback here would turn a caller bug into a mystery jump. Then the same shape as `/pause`: read state → `stopped` → `409`; otherwise issue → `200`; failure → `500`. It lands inside `serialize()` automatically by being in `route()` (FR-021) — verify, do not re-implement.
- [X] T008 [P] [US1] Unit-test `/seek` in `agent/src/server.test.ts` — `400` on missing/blank/non-integer `seconds` (**and that no default is applied**); `409` when `stopped`; `200` when `playing` **and** when `paused`; `500` on adapter failure; a **game** agent 404s `/seek` (FR-016); a negative value reaches the adapter **unchanged** (no magnitude conversion); a huge value is **not** clamped (FR-005); and that `/seek` runs **on the command mutex** while `GET /status` still answers concurrently (FR-021), mirroring the existing check-then-act race test.
- [X] T009 [US1] Add **`seek(seconds: number)`** to `orchestrator/src/agent-client.ts` — `POST /seek?seconds=<signed>`, encoding the value safely. No other method changes.
- [X] T010 [US1] Add **`/forward` and `/back`** to `buildCommands` in `orchestrator/src/commands.ts` — bare commands, registered only when the tenant has a media target (beside `/pause`·`/play`), each with **one optional integer option `seconds`** and **deliberately NO `setMinValue`/`setMaxValue`** (FR-005). Add a `describeSeek` producing replies that state **what was issued** and claim **no outcome or position** (FR-003, FR-002), with `409` → the honest nothing-loaded refusal in the **same terms** as `describePause`, and unreachable reading as unreachable. Add the handler(s), applying the **default of 30** and **negating for `/back`**.
- [X] T011 [US1] Route `forward` and `back` in `orchestrator/src/index.ts` — **inside the resolved-tenant path**, guarded on `rt.mediaTarget` exactly as `pause`/`play` are, so isolation is inherited structurally rather than re-implemented.
- [X] T012 [P] [US1] Unit-test the seek surface in `orchestrator/src/commands.test.ts` — **the `seconds` option carries neither `setMinValue` nor `setMaxValue`** (FR-005, SC-004 — the single likeliest thing a well-meaning future edit will "fix"); omitted argument → 30; `/back n` sends `-n` and `/back -n` sends `+n`; every branch produces a non-empty reply (SC-004 wording); **no reply, and no command description, names an item, file, playlist, position, or duration** (FR-002, SC-002); the `409` refusal reads in the same terms as pause's; and **nothing self-issues** — no handler path contains a timer, interval, retry, scheduled call, or presence hook, so every control is a direct human command (FR-008).

**Checkpoint**: `/forward` and `/back` work end to end with next/previous unbuilt. **The MVP.**

---

## Phase 4: User Story 2 - Move to the next thing (Priority: P2)

**Goal**: `/next` and `/previous` step blindly to the adjacent playlist item.

**Independent Test**: With a multi-item playlist playing, `/next` advances and `/previous` goes back. `/next` on the last item is still issued, and the reply claims no specific result and names no item.

### Implementation for User Story 2

- [X] T013 [US2] **Lift the stepping bans** in `agent/src/vlc.test.ts` — remove `/pl_next\b/` and `/pl_previous\b/` from the forbidden list and **assert both are now required**. **`pl_jump` stays banned**, and that contrast is the whole point of the narrowed line: stepping to the *adjacent* item needs no knowledge; jumping to a *nominated* one does. Everything else stays banned.
- [X] T014 [US2] Extend `MediaAdapter` in `agent/src/adapter.ts` with **`next()`** and **`previous()`** — signatures only, no VLC in them.
- [X] T015 [US2] Implement **`next`** and **`previous`** in `agent/src/vlc.ts` using the exact command names recorded in T003's M0. Neither may inspect the playlist, count items, or check whether an adjacent item exists (FR-002).
- [X] T016 [US2] Add **`POST /next`** and **`POST /previous`** to the media branch of `route()` in `agent/src/server.ts` — no parameters; read state → `stopped` → `409`; otherwise issue → `200`; failure → `500`. Same tier and wording as `/pause`.
- [X] T017 [P] [US2] Unit-test both verbs in `agent/src/server.test.ts` — `409` when `stopped`; `200` when `playing` **and** when `paused`; `500` on adapter failure; a **game** agent 404s both (FR-016); **no request body or query is read** (they take no parameters); and both run **on the command mutex** while `GET /status` still answers concurrently (FR-021).
- [X] T018 [US2] Add **`next()`** and **`previous()`** to `orchestrator/src/agent-client.ts`; add **`/next` and `/previous`** bare commands to `buildCommands`, plus describers and handlers, in `orchestrator/src/commands.ts`; and route both **inside the resolved-tenant path** in `orchestrator/src/index.ts`, guarded on `rt.mediaTarget`.
- [X] T019 [P] [US2] Unit-test the stepping surface in `orchestrator/src/commands.test.ts` — the reply reports the control was **issued** and **never names the item** (FR-002, SC-002); at a playlist boundary **no special-cased message is invented** and no result is claimed (FR-003, US2 AC3); the `409` refusal matches pause's terms; every branch replies non-empty; and **nothing self-issues** — no timer, retry, or automatic advance in any handler path (FR-008).

**Checkpoint**: All four controls work. Six media commands, all refusing identically when nothing is loaded.

---

## Phase 5: User Story 3 - A guild gets only the controls it should (Priority: P3)

**Goal**: The four controls appear and act only within a guild that has its own media target.

**Independent Test**: A guild with a media target is offered all four and reaches only its own player; a guild with only games is offered none of them; neither reaches the other's.

**Note**: This story adds **no new mechanism**. 004 made isolation structural — `buildCommands` receives one tenant's targets and `index.ts` resolves the tenant before dispatch — so US3 is *verification that the new commands were wired inside that path*, which T011 and T018 already require. These tasks prove it.

### Implementation for User Story 3

- [X] T020 [US3] Unit-test scoping in `orchestrator/src/commands.test.ts` — `buildCommands` for a **media-less** tenant offers **none** of `/next`, `/previous`, `/forward`, `/back` (004 FR-003, SC-005); a media-only tenant gets all four **plus** `/pause`/`/play`/`/status` and **no** game verbs; extend the existing 004 scoping tests rather than adding a parallel set.
- [X] T021 [US3] Unit-test isolation in `orchestrator/src/commands.test.ts` — a control issued in one tenant reaches **only** that tenant's media target, and another tenant's target is **unknown**, never routed (004 FR-002). Assert the four new handlers take a tenant-scoped `agents` map, never a global one — the property that makes isolation structural.

**Checkpoint**: The new surface inherits 004's isolation, proven rather than assumed.

---

## T026 status — what was verified automatically, and what is left

**Done automatically**, against a **real** agent talking to a **real** VLC (two scratch
headless instances on their own ports; the operator's player was never touched):

| Quickstart | Result |
|---|---|
| §1 unit gate | ✅ 114 tests, typecheck + lint clean |
| §2 loopback probes | ✅ `/seek?seconds=30` moved VLC **time 30 → 60**; `-30` moved **60 → 30**; `/next` stepped **plid 5 → 4**; `/previous` **4 → 5** |
| §2 caller-bug cases | ✅ missing / blank / `abc` / `1.5` each **400**, naming `seconds`, never defaulted |
| §2 read-only status | ✅ `{"state":"playing"}` |
| §5 refusal parity | ✅ all six media verbs **409 / `stopped`** against an empty player |
| §8 kinds never cross | ✅ a media agent **404**s `/start` and `/stop`; a game agent 404s all three new verbs (unit) |
| §8 contract untouched | ✅ `contract/src/index.ts` unchanged |
| §9 homepage | ✅ describes the four controls; scanned for and free of any capability the system lacks |

**Left for a human** — irreducible, needs a live Discord guild and eyes on a player:

- §3/§4 issuing the commands **from Discord** and watching the show move.
- §6 opening the **command picker in two guilds** to confirm scoping visually.
- §7 judging **reply wording** for content leakage in context.

One thing to know when running §5 from Discord: `/play`'s refusal reads *"Nothing is
loaded — nothing to resume."* while the other five read *"Nothing is playing — nothing
to …"*. That wording is **003's** and FR-018 forbids changing it; the refusals match in
tier, status and shape, which is what SC-003 asks for.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T022 [P] Update `agent/src/vlc.test.ts`'s file header and the ban-list comment to state the **new** boundary — permitted: blind relative movement (`pl_next`, `pl_previous`, relative `seek`); forbidden: anything naming, selecting, listing, or jumping to content, plus absolute seek, volume, stop, and OS termination — citing DECISIONS 022. The comment must not still claim "Reveille toggles playback" as the whole rule.
- [X] T023 [P] Update `CLAUDE.md` — the media target now answers **five** verbs (`/pause`, `/play`, `/next`, `/previous`, `/seek`) plus `/status`; the seam is **v4** and carries its **first operation parameter** (`seconds`, with the operation-vs-identifier rule); the `vlc.test.ts` ban is now *no knowledge of content* rather than *no movement through content*; and note that `contract/src/index.ts` is unchanged.
- [X] T024 [P] Update `site/index.html` per the v1.2.0 homepage rule (**FR-020, SC-008**) — describe the four new controls, and describe **no** capability the system does not have: it must not imply Reveille can choose, browse, search, or show what plays. Land the minimal honest change; do not invent user-facing behaviour 005 does not add.
- [X] T025 Run `npm run check:all` and confirm green — typecheck, lint, and the full `node:test` suite, including the redrawn ban list and the no-bounds assertion.
- [ ] T026 Run the full [quickstart.md](quickstart.md) — the unit gate (§1), the **direct loopback probes** including the `400`-on-missing-`seconds` cases (§2), US1 seek incl. unbounded and negative pass-through (§3), US2 stepping and the boundary case (§4), the **six-command refusal parity** with nothing loaded (§5), US3 scoping in two guilds (§6), the **content-leak audit** across every reply and command description (§7), the regression checks incl. **`contract/src/index.ts` unchanged** and a game agent 404ing the three new verbs (§8), and the homepage (§9). Also confirm in §8 that **no content is streamed, recorded, or relayed** — only control instructions travel (FR-012), which holds because this feature adds no content-transport surface. Promptness (FR-007, SC-001) is inherited from the existing `deferReply()` and is observed here rather than separately built. Human-in-the-loop for the visual and wording checks.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies. **T001 and T002 must both land before any code** (FR-010, Constitution V). They are parallel with each other.
- **Foundational (Phase 2)**: T003 (M0) **blocks T004, T006 and T015** — T006 and T015 are the two tasks that speak to the player, and T004 cannot ban the absolute-seek form until M0 has named it.
- **US1 (Phase 3)**: depends on Setup + T003. Order within: T004 (redraw the ban) → T005 (interface) → T006 (adapter) → T007 (agent route) → T009 (client) → T010 (commands) → T011 (routing). T008 and T012 test what precedes them.
- **US2 (Phase 4)**: depends on Setup + T003. Independent of US1 in behaviour, but touches the **same files**, so run it after US1 rather than concurrently.
- **US3 (Phase 5)**: depends on T011 and T018 having wired the commands inside the tenant-resolved path. Pure verification.
- **Polish (Phase 6)**: after the stories. T025 before T026.

### Within a story

- Ban list → interface → adapter → agent route → client → commands → routing → tests.
- T004 and T013 are written **before** the adapter work they govern and are **expected to fail** until it lands (FR-011's check, driving the implementation).

### Parallel opportunities

- T008 ‖ T012 once their code lands (`server.test.ts` vs. `commands.test.ts`); T017 ‖ T019 likewise.
- T022 ‖ T023 ‖ T024 (test comment vs. `CLAUDE.md` vs. `site/`).

**Not parallel, despite being adjacent**: T001 and T002 both append to `DECISIONS.md`, and T020
and T021 both extend `orchestrator/src/commands.test.ts`. Same file means sequential — neither
pair carries `[P]`, because a marker that has to be qualified with "coordinate the edit" is not
a parallel marker.

### The one hard gate

**T003 (M0) before T004, T006 and T015.** Writing either adapter method from documentation is the
failure mode this project has an M0 step to prevent, and here it fails *silently*: a bare
`val=30` seeks to 0:30 instead of forward 30 s, which looks plausible enough to survive a
casual test.

---

## Implementation Strategy

### MVP: User Story 1 only

1. Phase 1 (record the decisions) → 2. Phase 2 (M0) → 3. Phase 3 (US1: seek).
4. **STOP and validate** — `/back`, `/back 90`, `/forward 45`, `/forward`, plus `/back 6000`
   from 10 seconds in to prove nothing clamps.

That is the highest-frequency reason anyone reaches for the remote during a watch party,
delivered with next/previous entirely unbuilt.

### Incremental delivery

- Setup + Foundational → the decisions are recorded and VLC's real behaviour is written down.
- **+ US1 → MVP: replay the line.**
- + US2 → the playlist steps; six media commands now refuse identically when nothing is loaded.
- + US3 → the new surface is proven to inherit 004's isolation.
- + Polish → the ban list's new boundary is documented, `CLAUDE.md` and the homepage are honest, gate green, quickstart run.

---

## Notes

- **The contract package is not opened.** Seam v4 adds verbs and one query parameter; `contract/src/index.ts` is byte-for-byte unchanged (asserted in quickstart §8).
- **The ban list gets stricter, not looser.** Three patterns are lifted and one is added — the absolute-seek form. The relative/absolute boundary is the only boundary this feature creates, so it is the one that must be machine-enforced.
- **The 30-second default lives in exactly one place** (the orchestrator). The agent fails loud on a missing `seconds` — a member omitting an argument is a documented choice; the orchestrator omitting the parameter is a bug.
- **No new configuration.** No environment variable, no `.env.example` change, no new network exposure — the control path is loopback end to end, so there is nothing to forward and no firewall rule (FR-017).
- **`paused` is not a refusal.** Only `stopped` is. The item is loaded, so the player can act; what it does next is its business and is never claimed.

---

## Phase 7: Convergence

Appended by `/speckit-converge`. One gap between stated intent and the code as built.

- [ ] T027 Stop `POST /seek` silently altering a large `seconds` per FR-004 (contradicts) — `agent/src/server.ts` `handleSeek` validates the amount with `/^-?\d+$/` and then round-trips it through `Number`, so a value beyond `Number.MAX_SAFE_INTEGER` is silently changed (`9007199254740993` → the adapter emits `val=%2B9007199254740992`) and a value at or above 1e21 is emitted in exponential notation (`val=%2B1e+21`), which is malformed. FR-004 requires an explicitly supplied amount be "honored **exactly as given**". Fix by failing loud on an unrepresentable value (add a `Number.isSafeInteger` check → **400** naming `seconds`) or by carrying the validated digit string through to the adapter without a lossy `Number` round-trip. **This is not a bound in FR-005's sense** — FR-005 forbids clamping the seek *distance* against the item; refusing an integer the transport cannot represent is fail-loud on unrepresentable input, which the no-silent-wrong-behaviour rule requires. Unreachable via Discord (integer options are capped at ±2^53) but directly reachable at the seam, which `quickstart.md` §2 probes with `curl`. Cover it in `agent/src/server.test.ts` beside the existing 400 cases.
