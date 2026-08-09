# Tasks: Replies that serve the reader

**Feature**: `007-better-replies` | **Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)
**Gate**: `npm run check:all` — green at **129 tests** today, and must be green at **every** step.

**39 tasks.** T038 and T039 were appended by the analysis review loop and sit at the end of their own
phases rather than in numeric order — the two coverage holes it found (**SC-002**, and **007 FR-013 /
SC-014**) were real, and renumbering 25 tasks to hide that would churn more than it clarifies.

**Story ↔ thread mapping — the numbering does not line up, so read this once:**

| Story | Priority | Thread | What it delivers |
|---|---|---|---|
| **US1** | P1 (MVP) | **A** | The reply tells me what happened, not how it works |
| **US2** | P2 | **C** | The reply says what is playing and where |
| **US3** | P3 | **B** | Stepping takes a count |

**Two orderings are forced, not preferred** (plan.md, "Implementation order"):

- **T001 comes first, before any code.** Constitution V requires the decision recorded *before* the
  reasoning is changed.
- **US1 (Thread A) precedes US2 and US3.** Thread A rewrites the nine reply call sites that the
  other two then extend; doing it second would mean rewriting the same sites twice.

US2 and US3 are independent of **each other** and may run in parallel — but **US2 is gated on M0**
(T002) and US3 is not.

---

## Phase 1: Setup

- [ ] T001 Record the clarified principle in `DECISIONS.md` — statelessness and mechanism-not-policy, superseding what 022 was taken to mean. Name what stays forbidden (storing anything about content between calls; choosing content; one command depending on another's leftovers) and what becomes permitted (observing what the target reports, telling the member, forgetting it). **Nothing else starts before this** (FR-020, Constitution V).

- [x] T002 Run M0 and write `specs/007-better-replies/m0-vlc-metadata.md` against a **real** VLC, recording raw responses. Must answer: exact field path of the **title**; exact field path of the **filename**; **whether VLC synthesises a title from the filename for an untagged file**; `time`/`length` presence, type and unit; what a **live stream** reports for `length`; what the meta block looks like with **nothing loaded**; and the measured cost of one `pl_next` over loopback. **Gates US2 only** — US1 and US3 do not wait on it (research.md §1). **DONE 2026-08-09** — see `m0-vlc-metadata.md`.

> **T002 is done, and it answered the gating question: VLC does NOT synthesise a title.** On an
> untagged file the `title` key is **absent from `meta` entirely**, so FR-009's fallback has **two
> live branches** and US2's shape is unchanged. It also caught two silent traps — `information.title`
> is an integer *index* (measured `0`), and the **whole `information` block disappears** when nothing
> is loaded. Both are now pinned in T013. See `m0-vlc-metadata.md`.

---

## Phase 2: Foundational (blocks all stories)

- [ ] T003 Extend `AgentResponse` in `contract/src/index.ts` with three **optional** fields — `title?: string`, `elapsedSeconds?: number`, `totalSeconds?: number` — documenting that a game agent sets none, that absent means *not reported* (never zero, never a guess), that they are an observation and not a claim, and that no target identifier may ever join them. Every existing field and verb unchanged (seam v5, FR-022, FR-023, Constitution I).

- [ ] T004 Add a test to `contract/src/index.test.ts` (or the workspace's existing contract test) asserting the v4 shape still type-checks against v5 — a response with **none** of the new fields is valid, proving an older agent still works (SC-011).

---

## Phase 3: User Story 1 — the reply tells me what happened (P1, Thread A) 🎯 MVP

**Goal**: The orchestrator authors every member-visible word. Diagnostics go to the operator's log.

**Independent test**: Trigger every failure branch of every command. No reply contains a status code,
errno, or internal component name; each says what happened and what to do; the operator's log still
has the detail. Delivers value alone — no other story required.

- [ ] T005 [US1] Add the wording helper to `orchestrator/src/commands.ts`: given a status code and the command's own vocabulary, return member-facing text. Map `409` → refusal, `500` → the target failed, `400` → the member's argument, anything else → a fault. **Both sides of the current `body.message ?? \`Agent returned HTTP ${status}\`` are the bug** — neither the agent's text nor the code may reach a reply (FR-001, FR-005, research.md §2).

- [ ] T006 [US1] Replace every `body.message ?? …` footnote in `orchestrator/src/commands.ts` with the T005 helper, and log the agent's `message` as a diagnostic instead of rendering it (FR-005, FR-006). Nine call sites — start, stop, pause, play, seek, next, previous, and the two shared failure paths.

- [ ] T007 [US1] Stop `orchestrator/src/agent-client.ts` forwarding the raw transport reason (`ECONNREFUSED`) into `unreachable()`. The reason becomes a diagnostic; the reply says the host could not be reached and what the reader can do (FR-001, FR-004).

- [ ] T008 [US1] Rewrite the remaining member-visible text in `orchestrator/src/commands.ts`: `/address`'s port-forwarding and VPN footnote → what the address is for; `/start`'s "launched, not verified" → an outcome in the reader's terms; `unreachable()`'s "may be off, asleep, or not running the agent" → the outcome once, with no cause the reader cannot act on; `/status`'s "Show the state of every target" → the reader's nouns (FR-002, FR-003, FR-004).

- [ ] T009 [US1] Route diagnostics to the operator's log in `orchestrator/src/index.ts` so every failure branch that replies also records the technical detail (FR-006, SC-003).

- [ ] T010 [P] [US1] Add the **internals scan** to `orchestrator/src/commands.test.ts`: derive every reply, footnote and command description the code can produce, and assert **none** contains a status code, errno, or internal component name. A derived scan, not a list of expected strings (SC-001).

- [ ] T011 [P] [US1] Add a test asserting every failure branch that produces a member-visible reply **also** writes a diagnostic (SC-003).

- [ ] T012 [P] [US1] Add regression tests pinning the guarantees that must survive rewording: a start never claims the server is up; a **failed stop still says the server is still running**; a refusal still reads as a refusal and not a failure (FR-007, **Constitution IV**).

- [ ] T038 [P] [US1] Add the **usability** check to `orchestrator/src/commands.test.ts`: for **every** failure branch of every command, assert the reply is non-empty and names something the reader can **do** — not merely that it avoids internals. T010 proves nothing leaks; this proves something useful is left (SC-002). The judgement half — whether the sentence actually reads well — stays manual in `quickstart.md` §4.

**Checkpoint**: `npm run check:all` green. US1 is independently shippable.

---

## Phase 4: User Story 2 — what is playing and where (P2, Thread C)

**Goal**: Replies carry the title and position the player already reports.

**Independent test**: With a tagged file, an untagged file, a stream, and nothing loaded, each media
reply shows exactly what the player supplied and omits what it did not. `/status` stays one line per
target. **Blocked on T002.**

- [ ] T013 [US2] Read the metadata fields in `agent/src/vlc.ts` from the status response **already fetched** to derive state — no second request. Use the measured paths `information.category.meta.title` then `.filename`, and apply the fallback there so one name crosses the seam. **Guard the whole `information` block** — it is absent when nothing is loaded, so a naive path throws. **Never read `information.title`** — it is an integer index, measured `0`. Only this file knows the target (FR-025, `m0-vlc-metadata.md` §1–§3).

- [ ] T014 [US2] Populate the optional response fields in `agent/src/server.ts` for media verbs, leaving game responses untouched (FR-022).

- [ ] T015 [US2] **Correct the overshoot where it is enforced**: rewrite the ban in `agent/src/vlc.test.ts` to assert what the principle actually forbids — content **selection** (`pl_jump`, `pl_play`, `in_play`, `in_enqueue`, `pl_empty`, `pl_delete`), volume, `pl_stop`, OS kill, and the unsigned absolute seek — while **permitting observation**. Update `agent/src/vlc.ts`'s file header to match (FR-021, FR-014, SC-007, research.md §7).

- [ ] T016 [US2] Add the title and position renderer to `orchestrator/src/commands.ts`: `m:ss`, extending to `h:mm:ss` past an hour; `elapsed / total`, elapsed alone when there is no total, omitted when neither — and **treat `length: 0` as absent**, not as a zero-length item (`m0-vlc-metadata.md` §4); name shortened with a **visible** ellipsis past a fixed budget. Never invent a placeholder (FR-008, FR-009, FR-009a).

- [ ] T017 [US2] Surface the detail in the media replies — `/pause` and `/play` name what they acted on, `/next` and `/previous` report what is playing now, `/forward` and `/back` report where the cursor is. Worded as an **observation, never a claim that the command caused it** (FR-008, FR-010).

- [ ] T018 [US2] Fold the detail into the all-targets reply **inline, one line per target**, leaving the game branch structurally untouched (FR-008a).

- [ ] T019 [US2] **Correct the inherited overshoot** in `orchestrator/src/commands.test.ts`: rewrite 006's content-leak assertion so it bans content *selection* and *storage*, not observation (FR-021, FR-014).

- [ ] T020 [P] [US2] Add the **statelessness** test: drive a sequence of commands against a stub whose reported detail **changes between calls**, and assert every reply reflects the **current** observation with no trace of a previous one. **This cannot be a grep** — a source scan would pass a system that had a cache (SC-006, FR-011, FR-014).

- [ ] T021 [P] [US2] Add the **game-only identity** test: a tenant of game targets alone renders the all-targets reply **identically to before this feature**. The strongest regression check here (SC-016).

- [ ] T022 [P] [US2] Add rendering tests for every availability combination — title+position, title only, position only, neither, no total (stream), nothing loaded — plus a **long name shortened visibly** (SC-004, SC-005, SC-017).

- [ ] T023 [US2] Correct the requirement text that forbids what the system now does: **005 FR-002**, **005 FR-003**, **006 FR-013/SC-006**, `DECISIONS.md` 022, and `CLAUDE.md`'s media-ban paragraph. Re-read each rather than assuming (FR-021, SC-015).

- [ ] T039 [P] [US2] Add the **command-independence** test: for any pair of commands, running one first changes nothing about what the other does or reports, beyond what the player itself now is (**007** FR-013, SC-014). **Distinct from T020**, which tests that nothing observed is *retained*; this tests that no command *depends on* another's leftovers. **Respect FR-013's carve-out**: a command's own deferred continuation — the existing start follow-up — is not a cross-command dependency and must keep working.

**Checkpoint**: `npm run check:all` green. No document forbids what the system does.

---

## Phase 5: User Story 3 — stepping takes a count (P3, Thread B)

**Goal**: `/next` and `/previous` take an optional count; a negative reverses direction.

**Independent test**: `/next 3` moves three, `/next -3` moves back three **and says back**, `/next 1.5`
is refused naming the argument, and a long step never interleaves with another command. Independent
of US2; **not** gated on M0.

- [ ] T024 [US3] Widen `MediaAdapter.next` and `previous` in `agent/src/adapter.ts` to take a positive count, documenting that the count is a magnitude and the direction lives in which method is called (FR-015).

- [ ] T025 [US3] Loop the step command `count` times in `agent/src/vlc.ts`. No playlist read, no item named, no check that a next item exists — a blind step, N times (FR-012).

- [ ] T026 [US3] Validate `count` in `agent/src/server.ts` and reject a missing, non-integer, non-finite, or non-safe-integer value with a **400 naming the argument** — the same fail-loud shape `seconds` already has, and for the same reason (FR-018, FR-015).

- [ ] T027 [US3] Run the loop **inside the single mutex hold** so a multi-step is indivisible, and confirm `GET /status` still does **not** sit on the mutex and keeps answering throughout (FR-019).

- [ ] T028 [US3] Add the optional integer option to `/next` and `/previous` in `orchestrator/src/commands.ts` via `buildCommandGroups`. Resolve the default (1), read the sign, choose the verb, send the magnitude. **Do not write help text** — `/help` derives from the command surface (006's single-source rule). (FR-015)

- [ ] T029 [US3] State the **direction actually taken** in the reply, not the one the command name implies, so `/next -3` reads as having moved back (FR-017).

- [ ] T030 [P] [US3] Add count tests: N steps issue **exactly** N commands for positive, negative and zero N, with **no clamping** at any magnitude (SC-008, FR-016).

- [ ] T031 [P] [US3] Add the indivisibility test: a multi-step holds the mutex throughout and no other command acts on the player midway, while `/status` still answers (SC-009).

- [ ] T032 [P] [US3] Add a test that `/help` lists the new option **with no help text edited anywhere** — proving it derived (006 FR-008).

**Checkpoint**: `npm run check:all` green. All three stories complete.

---

## Phase 6: Polish & cross-cutting

- [ ] T033 Verify the seam stayed additive: every v4 field and verb unchanged, no target identifier in any path, query or body, and a v4 agent still works against a v5 orchestrator (SC-011, SC-010, Constitution I).

- [ ] T034 Verify **no new configuration**, no new port, no new firewall rule, and that the agent still has **zero runtime dependencies** (FR-024, SC-012, SC-010).

- [ ] T035 Update `site/index.html` — it currently claims *"Reveille never sees **what** is loaded"*, which becomes **false**. Describe the new behaviour and the count, and leave no claim the system contradicts. **Last**, when the behaviour it describes is real (FR-026, SC-013, Development Workflow).

- [ ] T036 Update `CLAUDE.md`'s command summary and seam description for the count and the v5 response fields.

- [ ] T037 Run `quickstart.md` end to end and record the result, including the manual slice (§4 reads-well judgement, §6 disclosure judgement).

---

## Dependencies

```
T001 (DECISIONS)  ──> everything
T002 (M0)         ──> US2 only  ──┐
T003, T004        ──> US1, US2, US3
                                  │
US1 (T005–T012, T038) ──> US2 (T013–T023, T039) ◄┘
                       └─> US3 (T024–T032)

US2 ⟂ US3   (independent of each other — may run in parallel)
All stories ──> Phase 6
```

**Why US1 blocks the others**: it rewrites the nine reply call sites US2 and US3 extend. Running it
second means rewriting the same code twice.

## Parallel opportunities

- **T010, T011, T012, T038** — four US1 test concerns, independent.
- **T020, T021, T022, T039** — four US2 test concerns, independent.
- **T030, T031, T032** — three US3 test concerns, independent.
- **US2 and US3 whole phases**, once US1 is done and T002 has landed for US2.
- **T002 (M0) runs alongside US1** — it gates only US2, so it should be started early and must not
  serialise Thread A.

## Implementation strategy

**MVP = US1 alone.** Thread A is shippable by itself: the replies stop leaking internals and start
serving the reader, with no seam change visible to a member. It carries the feature's central value.

**Then US3** (smaller, ungated) **or US2** (larger, gated on M0) depending on whether M0 has landed.

**The correction tasks are not paperwork.** T015, T019 and T023 land *with* their thread because a
requirement corrected in prose but still enforced by a green test is not corrected — the test fails
the moment the feature works.
