# Implementation Plan: Four more media controls, all context-free

**Branch**: `005-more-media-commands` | **Date**: 2026-08-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-more-media-commands/spec.md`

## Summary

Four bare Discord commands — `/next`, `/previous`, `/forward [seconds]`, `/back [seconds]` —
join 003's `/pause` and `/play` on the media target. They are **context-free**: they never
read, name, or display *what* is loaded, and never verify that they achieved anything. They
may read **playback state** to refuse honestly when nothing is loaded, exactly as pause and
resume already do.

The technical approach in one line: **three new seam verbs, no new contract types, no new
component, and the seam's first operation parameter.**

Three shapes drive everything below.

1. **Three verbs, not four.** `POST /next` and `POST /previous` map 1:1 onto VLC's own
   `pl_next`/`pl_previous`. Forward and back are the *same* operation with opposite signs, so
   they share `POST /seek?seconds=<signed>`. The Discord layer negates for `/back`. Four
   commands, three verbs — the minimum that expresses the feature (Constitution III).
2. **A query parameter, not a request body.** The seam has never carried a request body; every
   verb to date is a bare `POST`. A query parameter costs ~3 lines in the agent (which already
   splits the query off `req.url`); a JSON body costs stream buffering, parsing, and malformed-
   body handling. This is the first data ever to cross the seam in a request, which makes it a
   genuine seam event — recorded in `DECISIONS.md` before implementation.
3. **The ban list narrows; it does not disappear.** `agent/src/vlc.test.ts` asserts the content
   bans against adapter *source*. Three entries move from forbidden to required (`pl_next`,
   `pl_previous`, `command=seek`); every other ban stays, and this feature **adds** one — a
   bare, unsigned `val=` is an *absolute* seek, which **FR-011 now bans outright**. The check
   ends up stricter in the dimension that matters.

The single highest-risk unknown is VLC's exact relative-seek syntax, which **must be measured
against a real install before the adapter is written** (FR-019) — the same M0 gate every
target has had since 001. It is a task, not an assumption; see [research.md](research.md) §1.

## Technical Context

**Language/Version**: TypeScript on Node 24, run directly via type stripping. No build step;
`tsc` type-checks and never emits, with `erasableSyntaxOnly` on.

**Primary Dependencies**: **Agent — none** (zero runtime dependencies is a standing rule;
these controls use the same native `fetch` and `node:http` already present, and add nothing).
**Orchestrator** — `discord.js`, already present. **Contract** — none, and unchanged.

**Storage**: N/A. No state is retained anywhere; every state is derived by asking the player
now (003 FR-012). The seek amount is transient, per interaction.

**Testing**: `node:test`, tests beside their source as `*.test.ts`. Adapter bans are asserted
against source text, not behaviour. Real-install measurement (M0) precedes the adapter.

**Target Platform**: Agent on **Windows** (`watson`), loopback-bound. Orchestrator on generic
Linux semantics. VLC's web interface on `127.0.0.1:8080`, plain HTTP.

**Project Type**: Multi-package monorepo — `contract` / `agent` / `orchestrator` / `site`.

**Performance Goals**: Acknowledge within a few seconds (FR-007). Discord's interaction ACK
window is ~3s and is already handled by the existing `deferReply()`; a loopback control round
trip is milliseconds, well inside the adapter's existing 2s probe timeout.

**Constraints**: **No new network exposure** (FR-017) — the control path stays loopback end to
end, so no port, forward, or firewall rule changes. **Additive only** (FR-014) — every existing
field, verb, and behaviour byte-for-byte unchanged. **No target id in the contract** (FR-015,
Constitution I). **No bounds on the seek amount** (FR-005) — explicitly *not* using discord.js's
`setMinValue`/`setMaxValue`.

**Scale/Scope**: **Five** media seam verbs where there were two, surfaced as **six** Discord
commands — `/forward` and `/back` share `POST /seek`, and that 6-to-5 asymmetry is the design
point the whole feature turns on. The read-only `/status` is unchanged and counted in neither.
One adapter file, one agent router, one
orchestrator command module, plus the homepage. Roughly a dozen files touched; no new package,
no new component.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Why |
|---|---|---|
| **I. The Seam Is Inviolable** | **PASS** | The orchestrator still reaches the agent only over HTTP; direction is still orchestrator → agent; the agent still never initiates. The additions are new paths on the existing seam. **The seek amount is scrutinised explicitly**: Constitution I bans a *server identifier, machine identifier, or routing discriminator* — something naming **which target**. `seconds` names **how far**, is a parameter *of the operation*, and would be meaningless as a routing key. The agent's URL remains its sole identity, and the spec settles this in FR-015. Nothing in a path or body says which player is being addressed. |
| **II. Components Are Welded** | **PASS** | No new component, and no new *kind* of component. Same one agent welded to the same one media target on the same host. The target's verb count grows; nothing splits off or relocates. By the acceptance test, this is a **column on an existing row** — not a new kind. |
| **III. Build The Minimum** | **PASS** | Three verbs rather than four (direction is a sign, not a verb). A query parameter rather than body-parsing machinery. **No** clamping, range validation, magnitude conversion, or boundary checks — the spec makes the absence of that code a *requirement* (FR-005), so the minimum is also the specified behaviour. No abstraction is introduced for a second media player that does not exist. |
| **IV. A Stop That Cannot Be Graceful Is Not A Stop** | **PASS — untouched** | Media has no `stop` verb and gains none. `pl_stop` and OS-level termination stay banned and stay asserted against source. No path added here can reach either. |
| **V. Record The Decision Before Deleting The Reasoning** | **PASS — with two required entries** | This feature both **amends a recorded requirement** (003 FR-004) and **changes the seam**. Two `DECISIONS.md` entries are required **before implementation begins**: the ban narrowing (FR-010, mandatory in the spec) and the seam's new verbs plus its first operation parameter. Both are tasks in `tasks.md`, ordered ahead of the code they justify. |
| **Development Workflow — homepage** | **PASS — planned** | Constitution v1.2.0 requires the public homepage to be a *planned* task when user-facing behaviour changes. Four new commands qualify. FR-020 makes it a requirement; it becomes a task in `tasks.md`, done during implement, not retrofitted. |
| **Additional Constraints — secrets** | **PASS** | No new credential. `VLC_PASSWORD` already exists and is already required-with-no-fallback. Nothing new is committed. |
| **Additional Constraints — agent has zero runtime deps** | **PASS** | The seek amount is parsed from the query string with the platform's own `URL`/`URLSearchParams`. No dependency is added, so no `DECISIONS.md` entry is needed on that count. |

**Result: no violations.** Complexity Tracking is empty.

**Post-Phase-1 re-check**: re-evaluated after the contract and data model below were written —
still no violations. The design added no type to the contract package, no field to
`AgentResponse`, no component, and no dependency. The one thing worth re-stating after design:
the contract *document* moves to v4 while `contract/src/index.ts` does **not change at all**,
because the additions are verbs and one operation parameter, not types.

## Project Structure

### Documentation (this feature)

```text
specs/005-more-media-commands/
├── spec.md                  # Feature specification (exists)
├── plan.md                  # This file
├── research.md              # Phase 0 output — decisions + what M0 must measure
├── data-model.md            # Phase 1 output — the transient entities
├── quickstart.md            # Phase 1 output — how to validate it end to end
├── contracts/
│   └── agent-api.md         # Phase 1 output — the seam at v4 (additive)
├── m0-vlc-controls.md       # Written during implement by the M0 task (FR-019)
├── checklists/
│   └── requirements.md      # Spec quality checklist (exists, 16/16)
└── tasks.md                 # /speckit-tasks output — NOT created here
```

### Source Code (repository root)

```text
contract/
└── src/index.ts             # UNCHANGED — no new type; v4 is verbs, not types

agent/                       # Windows, loopback only, zero runtime deps
├── src/adapter.ts           # MediaAdapter gains next / previous / seek
├── src/vlc.ts               # THE only VLC-aware file — three commands added
├── src/vlc.test.ts          # Ban list NARROWED (3 lifted) and WIDENED (absolute seek banned)
├── src/server.ts            # Media switch gains 3 cases; all on the command mutex
├── src/server.test.ts       # New verbs: refuse on stopped, act otherwise, kinds never cross
└── src/config.ts            # UNCHANGED — no new configuration

orchestrator/
├── src/agent-client.ts      # next() / previous() / seek(seconds)
├── src/commands.ts          # 4 command builders + describers + handlers
├── src/commands.test.ts     # Scoping, wording, no-content-leak, no bounds set
└── src/index.ts             # Route the 4 names within the resolved tenant

site/
└── index.html               # The public homepage — four new controls (FR-020)

initial-architecture/
└── DECISIONS.md             # Two appended entries, BEFORE the code (Constitution V)
```

**Structure Decision**: No structural change. This feature is **a column on the existing media
row** — it adds verbs to a target kind that already exists, in the files that already own that
kind. The layout above is the current repository, not a new arrangement.

The one placement rule that governs every line of it: **only an adapter file may know its
target.** `vlc.ts` is the sole file that learns what `pl_next` is or how a relative seek is
spelled. `adapter.ts` gains three method *signatures* with no VLC in them; `server.ts`
dispatches by `kind` and never by which target; the orchestrator speaks only the seam. Nothing
outside `vlc.ts` branches on the target being VLC (003 FR-025).

## Complexity Tracking

> No Constitution Check violations. This section is intentionally empty.
