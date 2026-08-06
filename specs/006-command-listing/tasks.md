---
description: "Task list for 006-command-listing"
---

# Tasks: A command that lists the commands you can run

**Input**: Design documents from `/specs/006-command-listing/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/command-surface.md](contracts/command-surface.md), [quickstart.md](quickstart.md)

**Tests**: Required, and one of them is the feature. FR-008 demands the listing agree with the
registered surface **by construction**, and the only way to hold that is a test that derives both
sides and compares them. It is a correctness proof, not coverage.

**Organization**: Grouped by user story. US1 (ask what you can do) is the MVP.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1, US2, US3
- Exact file paths are in every task

## Path Conventions

Monorepo (`contract/`, `agent/`, `orchestrator/`, `site/`). **This feature touches only
`orchestrator/` and `site/`.** `contract/` and `agent/` are deliberately not opened — `/help`
contacts no agent, so the seam stays at v4 exactly as 005 left it (FR-017, SC-009).

**There is no Setup phase.** No configuration, no dependency, no scaffolding, and — unlike every
prior feature — **no M0** (nothing is measured; `/help` contacts nothing) and **no `DECISIONS.md`
entry** (Constitution V compels one for a seam change, a chosen candidate, or a closed deferred
question; this is none). An empty phase is not written just to have one.

---

## Phase 1: Foundational (Blocking Prerequisites)

**Purpose**: Make the command surface a value that can be *read* rather than only registered. **⚠️ Blocks every story.**

- [X] T001 Refactor `buildCommands` into **`buildCommandGroups(servers)`** in `orchestrator/src/commands.ts` — the single source, returning ordered, labelled groups (`{ label, commands }`): the game group, the media group, and the group for commands belonging to no target kind (`/status`, later `/help`). `buildCommands` becomes a **thin derivation** — flatten the groups and `toJSON()` — so registration is byte-identical in behaviour. **A group is constructed only when it has contents**, reusing the existing `games.length > 0` / `media` branches, so an empty group cannot exist and therefore cannot render (FR-022). **This must come first**: recovering the grouping downstream would require a name→group lookup table, which is a second copy of the knowledge and exactly what FR-008 forbids (research §2).
- [X] T002 [P] Guard the refactor in `orchestrator/src/commands.test.ts` — assert `buildCommands` still returns **exactly** what it did before for a game+media tenant, a media-only tenant, and a game-only tenant (same command names, same order, same options/subcommands). This is a pure regression fence: the existing 004/005 scoping tests must also still pass untouched.

**Checkpoint**: The command surface is now a readable, grouped value. Registration is unchanged.

---

## Phase 2: User Story 1 - Ask what you can do (Priority: P1) 🎯 MVP

**Goal**: `/help` replies with every command available in this guild, one line per runnable form, grouped, visible only to the asker.

**Independent Test**: In a configured guild, issue `/help` and confirm the reply lists every command that guild has, each with a description, grouped by kind — and that any line can be copied and run as-is.

### Implementation for User Story 1

- [X] T003 [US1] Register **`/help`** in `buildCommandGroups` in `orchestrator/src/commands.ts` — bare, **no arguments** (FR-001), in the group that belongs to no target kind, beside `/status`, and **unconditionally for every tenant** (every tenant has at least one target, so it always applies). Its own description must read as the listing will show it, since the listing quotes it verbatim.
- [X] T004 [US1] Add the **runnable-form renderer** to `orchestrator/src/commands.ts` — turn one command into its entries per [data-model.md](data-model.md): a command with **subcommands** yields **one entry per subcommand** (`/start palworld`) using the **subcommand's own** description; a command with **options** yields one entry with the option appended (`[name]` optional, `<name>` required); a bare command yields one. **Descriptions are copied verbatim and never authored here** (FR-008, contracts rule 3).
- [X] T005 [US1] Add **`describeCommandList(groups)`** to `orchestrator/src/commands.ts` — render the grouped entries into a `Reply` using the existing tone/embed shape. Group headings come from the group labels; **an empty group renders nothing** (there are none to render, by T001). No target state, no readiness, no agent (FR-014, FR-015).
- [X] T006 [US1] Handle `/help` in `orchestrator/src/index.ts` **before the existing `await interaction.deferReply()`** — reply **immediately and ephemerally** so only the asker sees it (FR-005). A deferred reply cannot become ephemeral afterwards, and `/help` needs no defer because it does no I/O (research §4). It must sit **inside the resolved-tenant path** and be built from `rt.tenant.servers`, so 004's isolation is inherited structurally. **The branch must reply or fail within itself** — the outer `catch` calls `editReply`, which assumes a prior defer.
- [X] T007 [P] [US1] **The bijection test** in `orchestrator/src/commands.test.ts` — for a given tenant configuration, derive the set of **registered runnable forms** (from `buildCommands`, expanding subcommands) and the set of **listing entries**, and assert they are **equal**. Derived-to-derived: **no fixture of expected description text may appear** — a fixture is a third copy and drifts exactly as the code would (contracts, "How this contract is enforced"). Also assert: `/start` yields one entry **per game target** rather than one entry; `[seconds]` renders as optional with its default visible; **`/help` appears in its own listing** (FR-004); and the listing renders with **no `AgentClient` in play at all** (SC-007). Also assert **no entry describes content** — nothing matching item, file, playlist, position, or duration (FR-013, SC-006), which FR-008 makes true but nothing yet checks; and that **nothing self-issues** — no handler path contains a timer, interval, retry, or scheduled call, so every listing is a direct human request (FR-016). Model both on the equivalent assertions 005 added to this same file.

**Checkpoint**: `/help` works end to end. **The MVP.**

---

## Phase 3: User Story 2 - The list is about MY guild (Priority: P2)

**Goal**: The listing shows this guild's commands and nothing about any other guild.

**Independent Test**: Build the listing for a media-only tenant and a game-only tenant; confirm each contains exactly its own commands and names no other tenant's target.

- [X] T008 [P] [US2] Scoping tests in `orchestrator/src/commands.test.ts` — a **media-less** tenant's listing contains **0** media commands and **no empty "Games"/"Media" heading**; a **game-less** tenant's contains **0** game commands; two tenants with different targets produce listings that name **none** of the other's targets (FR-010, FR-011, SC-004, SC-005). Extend the existing 004/005 scoping tests rather than adding a parallel set. Assert the listing is built from a tenant-scoped server list, never a global one. Also record why **US2/AC4 needs no separate work**: tenant resolution happens in `interactionCreate` *before* `handle()` is called, so `/help` is unreachable from an unconfigured guild wherever it sits inside `handle` — inherited from 004 FR-006, not re-implemented. Worth asserting if it is cheap, because the guarantee depends on that ordering surviving future edits.

**Checkpoint**: The listing inherits 004's isolation, proven rather than assumed.

---

## Phase 4: User Story 3 - The list cannot go stale (Priority: P3)

**Goal**: Changing the command surface changes the listing, with no description text edited.

**Independent Test**: Add a target to a tenant fixture and confirm its commands appear in the listing; change a registered description and confirm the listing follows — both with no listing-side edit.

- [X] T009 [P] [US3] Drift-resistance tests in `orchestrator/src/commands.test.ts` — adding a target to a tenant makes its commands appear in the listing and removing it makes them disappear, **with no description text edited anywhere** (FR-009, SC-003); and a description taken from the registered command is the one the listing shows, asserted by reading it from `buildCommands` rather than from a literal. This is the test that would have caught 005's stale `vlc.ts` header.

**Checkpoint**: Drift is structurally impossible, and a test says so.

---

## T013 status — what was verified automatically, and what is left

**Done automatically:**

| Quickstart | Result |
|---|---|
| §1 unit gate | ✅ **127 tests**, typecheck + lint clean |
| §2 **drift walkthrough** | ✅ Changed `/pause`'s registered description to "Hold the show." — the listing followed with **zero other edits**, and all 127 tests still passed, proving no test hardcodes the literal. Reverted. |
| §4 scoping | ✅ media-only and game-only tenants each list only their own commands, with no empty group |
| §6 availability ≠ readiness | ✅ the listing renders with no `AgentClient` in existence |
| §8 regression | ✅ `git diff main..HEAD -- contract/ agent/` is **empty**; no env var, port, or config change |
| §9 homepage | ✅ describes `/help`, claims no capability the system lacks |
| **Live registration** | ✅ `/help` registered in **both** guilds (7→8, 10→11), bare with no options. The tightened `seconds` description propagated to Discord's picker too — one copy, both surfaces. |

**Left for a human** — genuinely irreducible:

- **§3** — issue `/help` in a guild and read it: is it scannable, does the grouping help, can you copy a line and run it?
- **§5** — the **ephemeral** check. Whether *other people* can see a message is not observable from the process that sent it; someone else has to confirm they see nothing.
- **§7** — the content-leak audit as a judgement rather than a regex.

The orchestrator is running (`reveille#6131`), so `/help` is ready to try.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [X] T010 [P] Update `site/index.html` per the v1.2.0 homepage rule (**FR-021, SC-010**) — describe `/help` as what it is: a list of the commands available *in that server*. Describe **no** capability the system lacks; in particular do not imply it reports target state, which is `/status`. Land the minimal honest change.
- [X] T011 [P] Update `CLAUDE.md` — add `/help` to the command surface described in "What this is", and note that it is the first command that contacts **no agent**, so it neither defers nor depends on anything being reachable.
- [X] T012 Run `npm run check:all` and confirm green — typecheck, lint, and the full `node:test` suite including the bijection.
- [ ] T013 Run the full [quickstart.md](quickstart.md) — the unit gate (§1), the **drift-resistance walkthrough** (§2), US1 in a real guild (§3), scoping across two guilds (§4), the **ephemeral check with someone else watching** (§5), availability-not-readiness with a target switched off (§6), the content-leak audit (§7), regression incl. **`git diff` on `contract/` and `agent/` being empty** (§8), and the homepage (§9). Human-in-the-loop for §5 and the wording judgements.

---

## Dependencies & Execution Order

### Phase dependencies

- **Foundational (Phase 1)**: no dependencies. **T001 blocks everything** — nothing can read the command surface until it is a value. T002 guards T001 and should land with it.
- **US1 (Phase 2)**: depends on T001. Order within: T003 (register `/help`) → T004 (renderer) → T005 (describe) → T006 (routing). T007 tests all four.
- **US2 (Phase 3)**: depends on T005 existing to produce a listing. Pure verification.
- **US3 (Phase 4)**: depends on T005 likewise. Pure verification.
- **Polish (Phase 5)**: after the stories. T012 before T013.

### Within a story

- Register → render an entry → render the list → route it → test it.
- T007, T008 and T009 all extend `orchestrator/src/commands.test.ts`; they are marked `[P]` because they are independent in content, but they touch **one file**, so sequence the edits.

### The one hard rule

**T001 before T004.** If the renderer is written first, the only way to group is a name→group
lookup table — and that table is the second copy of the knowledge this entire feature exists to
eliminate. Getting this order wrong produces something that passes its tests on the day it is
written and silently mis-files the first command 007 adds.

---

## Implementation Strategy

### MVP: User Story 1 only

1. Phase 1 (make the surface readable) → 2. Phase 2 (US1: `/help`).
3. **STOP and validate** — issue `/help` in a real guild, copy a line, run it.

That is the whole user-visible feature; US2 and US3 prove properties of it rather than adding to it.

### Incremental delivery

- Foundational → the command surface is a value, registration unchanged.
- **+ US1 → MVP: `/help` answers.**
- + US2 → scoping proven.
- + US3 → drift proven impossible.
- + Polish → homepage and `CLAUDE.md` honest, gate green, quickstart run.

---

## Notes

- **The seam gains nothing.** `contract/` and `agent/` are not opened; `/help` is the first command that contacts no agent at all (asserted by T013 §8).
- **No description is written twice.** Every string the listing shows is the registered one, verbatim. A test that hardcodes expected text defeats the feature.
- **No M0, no `DECISIONS.md` entry, no configuration, no dependency, no new component.**
- **Empty groups cannot render** because they are never constructed — the guarantee lives in T001, not in the renderer.

---

## Phase 6: Convergence

Appended by `/speckit-converge`. Two gaps between stated intent and the code as built.

- [X] T014 Wrap the `/help` branch in its own error handling in `orchestrator/src/index.ts` per tasks T006, FR-006, SC-001 (partial) — the branch sits **before** the `try {`, and `handle()` is invoked as `void handle(...)`, so anything it throws (realistically `interaction.reply()` on a transient failure) becomes an **unhandled promise rejection**: under Node 24's default that terminates the orchestrator, and the member is left with "the application did not respond". T006 required the branch to "reply or fail within itself" and it currently does neither. Give it a `try/catch` that answers with a failure reply, so the one command that cannot use the outer handler still cannot leave a member guessing (SC-001). Note `await interaction.deferReply()` on the following line has the same exposure and pre-dates this feature — closing both together is the tidier fix, but only the `/help` branch is 006's gap.
- [X] T015 Make a subcommand **group** fail loudly rather than render nonsense in `orchestrator/src/commands.ts` per FR-002, contracts rule 4 (partial) — `toCommandEntries` treats any option that is not type 1 as an argument, so a Discord subcommand group (type 2, `/cmd group sub`) would render as `[group]`: a plausible-looking, silently wrong entry. Unreachable today because this system registers only subcommands (type 1) and integers (type 4), which is why it is LOW — but silent-wrong-output is the exact failure class this feature exists to prevent, and the guard is one branch. Either expand groups properly or throw naming the unsupported shape.
