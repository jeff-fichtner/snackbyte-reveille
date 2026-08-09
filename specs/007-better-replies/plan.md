# Implementation Plan: Replies that serve the reader

**Branch**: `007-better-replies` | **Date**: 2026-08-08 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/007-better-replies/spec.md`

## Summary

Three threads that all land in the same reply-writing code, so they ship as one feature.

**A — the replies stop explaining the system.** The orchestrator becomes the sole author of every
member-visible word. An agent's `message` changes destination: it is a **diagnostic**, logged for
the operator, never rendered. Nine call sites collapse onto one helper that picks wording from the
**status code** and the command's own vocabulary.

**B — stepping takes a count.** `/next` and `/previous` gain an optional integer. The orchestrator
resolves the default, reads the sign, and picks the verb; the agent receives a positive magnitude
and loops the step inside its single mutex hold, so a multi-step is one indivisible operation.

**C — the replies carry what the player already reports.** Title and position come back on the same
response the adapter already fetches to derive state, as **optional** seam fields a game agent never
sets.

**The technical approach in one line**: the seam grows only in the safe direction (optional response
fields plus one operation parameter), the orchestrator gains a renderer and a wording helper, and the
agent gains a loop and one more validated argument.

**The plan's one real gate**: Thread C rests on VLC fields **nobody has measured**. An M0 runs first
— see `research.md` §1.

## Technical Context

**Language/Version**: TypeScript on Node 24 (type-stripping; `erasableSyntaxOnly` — a passing
typecheck guarantees the code runs)
**Primary Dependencies**: orchestrator — discord.js. Agent — **zero runtime dependencies**, and this
feature adds none
**Storage**: N/A, and emphatically so — FR-011 forbids storing anything observed
**Testing**: `node:test`, tests beside their source as `*.test.ts`; gate is `npm run check:all`
(currently green at 129 tests)
**Target Platform**: agent on Windows (`watson`), loopback-bound; orchestrator anywhere
**Project Type**: npm workspaces — `contract`, `agent`, `orchestrator`, plus static `site/`
**Performance Goals**: unchanged. `/status` must keep answering during a long multi-step (it does not
sit on the command mutex)
**Constraints**: no new configuration, no new network exposure, no new dependency, no target
identifier in the seam
**Scale/Scope**: 3 threads · 28 FR · 17 SC · 3 user stories · ~6 source files plus documents

**Unknowns**: one, and it is genuine — the VLC metadata field shapes, and specifically **whether VLC
synthesises a title from the filename for an untagged file**. That answer decides whether FR-009's
fallback has two live branches or one. Resolved by M0 before Thread C begins (`research.md` §1).

## Constitution Check

*Gates evaluated against `.specify/memory/constitution.md`.*

| Principle | Verdict | Basis |
|---|---|---|
| **I. The Seam Is Inviolable** | **PASS** | Additive only. Optional *response* fields plus a `count` query parameter. No target identifier in any path, query, or body. `count` is admitted by DECISIONS 023's existing rule — a parameter of the *operation*, never a name for *which target*. Every v4 field and verb unchanged; a v4 agent still works. |
| **II. Components Are Welded; Only The Orchestrator Relocates** | **PASS** | No component added, moved, or split. One orchestrator, one agent per target, HTTP between them as always. |
| **III. Build The Minimum; Defer By Default** | **PASS** | Rejected a `GET /now` verb (§4), a reason-code field (§2), and a time bound on stepping (§3) as over-building. The embed-length guard stays out of scope and was re-checked, not assumed (§9). |
| **IV. A Stop That Cannot Be Graceful Is Not A Stop** | **PASS — and explicitly guarded** | Thread A's "the orchestrator authors every word" is a rule about **text**, not about authority. FR-005 says so in the spec, `contracts/seam-v5.md` repeats it, and the quickstart tests it: a failed stop must still say the server is **still running**. The controller keeps whether it can act, how, and the guarantees that are not the orchestrator's to relax. No force-stop path is created. |
| **V. Record The Decision Before Deleting The Reasoning** | **PASS — and this is a required task** | DECISIONS 022 said "no knowledge of content" and was written as blindness. The clarified principle (statelessness and mechanism-not-policy) **must** be recorded **before** implementation (FR-020, T001). Correcting the reasoning without recording it is precisely what this principle forbids. |

**Additional constraints**: agent keeps zero runtime dependencies ✅ · only an adapter file knows its
target ✅ (the loop and field reads live in `vlc.ts`; nothing above it branches on which target it is)
· no fallback config ✅ (nothing new to configure) · homepage updated as a planned task ✅ (T-final,
Development Workflow).

**Violations requiring justification**: none.

**Post-design re-evaluation**: unchanged. The design added no component, no dependency, no
configuration, and no verb. The one thing it *did* add — an unbounded count held under a mutex — is
a deliberate, recorded exposure rather than a constitution violation; see `research.md` §3 and the
Complexity Tracking note below.

## Project Structure

### Documentation (this feature)

```
specs/007-better-replies/
├── spec.md                    # 28 FR · 17 SC · 3 user stories
├── plan.md                    # this file
├── research.md                # Phase 0 — 9 decisions, incl. the M0 gate and the mutex conflict
├── data-model.md              # Phase 1 — every entity transient, deliberately
├── contracts/
│   └── seam-v5.md             # Phase 1 — additive contract
├── quickstart.md              # Phase 1 — validation, M0 first
├── m0-vlc-metadata.md         # WRITTEN BY M0 — does not exist yet, and gates Thread C
└── checklists/requirements.md # 16/16
```

### Source code (repository root)

```
contract/src/index.ts          # + three optional response fields (seam v5)

agent/src/
├── vlc.ts                     # + read the metadata fields; + loop the step N times
├── server.ts                  # + validate `count` (fail-loud 400); loop inside the mutex hold
├── adapter.ts                 # MediaAdapter.next/previous take a count
└── vlc.test.ts                # REWRITE the overshoot ban -> selection + storage

orchestrator/src/
├── commands.ts                # Thread A wording helper; the renderer; count option on next/previous
├── agent-client.ts            # stop forwarding the raw transport reason
├── index.ts                   # diagnostics to the operator's log
└── commands.test.ts           # REWRITE the inherited content-leak assertion

site/index.html                # correct "Reveille never sees what is loaded" (FR-026)
DECISIONS.md                   # the clarified principle (FR-020) — BEFORE implementation
CLAUDE.md                      # the media-ban paragraph
```

**Structure decision**: unchanged from 001 — npm workspaces with the seam between `agent` and
`orchestrator`. No new package, no new module boundary. The work is concentrated in
`orchestrator/src/commands.ts`, which is why three user-facing threads ship as one feature rather
than three.

## Implementation order (forced, not preferred)

1. **T001 — `DECISIONS.md`.** Constitution V requires the record *before* the change. Nothing else
   starts first.
2. **M0.** Thread C is blocked on it. Threads A and B are not.
3. **Thread A**, then **B**, then **C** — A rewrites the call sites B and C then extend, so doing it
   first avoids rewriting the same nine sites twice. B and C are independent of each other.
4. **The corrections** (005/006 text, `vlc.ts` header, `CLAUDE.md`, and the tests that enforce the
   overshoot) land **with** the thread that needs them — a green test enforcing a corrected
   requirement is the failure mode `research.md` §7 describes.
5. **Homepage** last, when the behaviour it describes is real.

## Complexity Tracking

One item, recorded rather than resolved.

| Item | Why it is accepted | Why the simpler option was rejected |
|---|---|---|
| An **unbounded** step count held under the command mutex (FR-016 × FR-019) | `/next 1000000` blocks that player's other commands for hours. Bounded blast radius: one target, one operator, self-inflicted, visible rather than silent, ended by restarting the agent. `/status` keeps answering throughout. | Clamping is the exact opinion this feature exists to remove, and any cap invents a number nothing measures. A **time** bound is the better fallback if it ever bites — rejected for now only because reporting a partial step introduces new reply vocabulary and in-flight state. See `research.md` §3. |

## Phase status

- [x] Phase 0 — research complete (`research.md`)
- [x] Phase 1 — design complete (`data-model.md`, `contracts/seam-v5.md`, `quickstart.md`)
- [ ] Phase 2 — tasks (`/speckit-tasks`)
- [ ] M0 — **not started**; gates Thread C
