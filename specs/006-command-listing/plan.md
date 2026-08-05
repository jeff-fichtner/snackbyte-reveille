# Implementation Plan: A command that lists the commands you can run

**Branch**: `006-command-listing` | **Date**: 2026-08-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-command-listing/spec.md`

## Summary

`/help` replies with every command available in the asking guild, one line per **runnable form**,
**grouped by target kind**, visible only to the asker.

The whole feature is one idea: **the listing is a second view of the command surface, not a second
description of it.** `buildCommands` already computes exactly what a guild can run — that is what
gets registered with Discord. If the listing renders that same value, FR-007 (the listing agrees
exactly with what the guild can run) holds because there is nothing for it to disagree *with*.

Two things in the current code stand between that idea and the implementation, and both are the
substance of this plan.

1. **`buildCommands` throws the grouping away.** It builds a flat `cmds` array through
   kind-partitioned branches and returns `cmds.map(c => c.toJSON())`. By the time the value
   escapes, *which kind produced which command* is gone. Recovering it downstream would mean a
   lookup table mapping command names to groups — **a second copy of the knowledge, which is
   exactly what FR-008 forbids**. So the fix belongs upstream: build a grouped structure and
   derive the flat registration array from it. One construction, two views.
2. **`index.ts` defers before it dispatches.** Line 118 is `await interaction.deferReply()`,
   before the command switch. A deferred reply cannot later become ephemeral, so FR-005 needs
   `/help` handled *before* that line. That is not a workaround: `/help` contacts nothing
   (FR-015), so it can answer inside Discord's ~3s window with no defer at all. The requirement
   that it touch no network is what makes the immediate reply possible.

**No M0.** Nothing new is measured — no target is contacted, and every fact the listing renders
already exists in the process.

## Technical Context

**Language/Version**: TypeScript on Node 24, run directly via type stripping. No build step;
`tsc` type-checks and never emits, with `erasableSyntaxOnly` on.

**Primary Dependencies**: `discord.js`, already present. **Nothing is added.** The agent and
contract packages are not opened at all.

**Storage**: N/A. The listing is derived per interaction and never stored.

**Testing**: `node:test`, tests beside their source. The central guarantee (FR-008) is testable
without Discord: registration and the listing are both pure functions of one tenant's target
list, so a test can assert the two agree by construction.

**Target Platform**: Orchestrator only. The agent is untouched, so nothing here is Windows-bound.

**Performance Goals**: Reply inside Discord's ~3s acknowledgement window **without deferring** —
achievable because the work is a pure in-memory render with zero I/O.

**Constraints**: **No seam change** (FR-017) — `contract/` and `agent/` are not opened. **No new
configuration** (FR-018), **no new network exposure** (FR-019), **no new dependency**. The listing
must contain no separately-maintained description text (FR-008).

**Scale/Scope**: One orchestrator module gains a grouped builder and a renderer; `index.ts` gains
one early-return branch. Roughly four files touched plus the homepage. No new package, no new
component, no new kind.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Why |
|---|---|---|
| **I. The Seam Is Inviolable** | **PASS — untouched** | The feature adds no verb, no field, and no request. `contract/` and `agent/` are not opened (FR-017). `/help` is the first command that contacts **no agent at all**, which moves *away* from the seam rather than toward it. |
| **II. Components Are Welded** | **PASS** | No new component and no new kind. This is a command on the existing orchestrator, which is welded to nothing and already owns the Discord surface. |
| **III. Build The Minimum** | **PASS** | The one structural change — grouping *inside* `buildCommands` rather than reconstructing it after — is not gold-plating. The alternative is a name→group lookup table, which is *more* code **and** violates FR-008. Here the minimum and the requirement point the same way. Nothing is abstracted for a second consumer that does not exist. |
| **IV. A Stop That Cannot Be Graceful** | **PASS — N/A** | Nothing is started or stopped. No target is contacted. |
| **V. Record The Decision** | **PASS — no entry required** | Constitution V compels an entry for a seam change, a candidate being chosen, or a deferred question being closed. This is none of the three. Recording one anyway would dilute a log meant to hold conclusions, not activity. |
| **Development Workflow — homepage** | **PASS — planned** | A new command is exactly the trigger the v1.2.0 rule names. FR-021 makes it a requirement, and it becomes a task in `tasks.md`. |
| **Additional Constraints — secrets** | **PASS** | No credential is read, rendered, or added. The listing holds command names and descriptions only. |
| **Additional Constraints — agent has zero runtime deps** | **PASS — N/A** | The agent is not opened. The orchestrator adds no dependency either. |

**Result: no violations.** Complexity Tracking is empty.

**Post-Phase-1 re-check**: re-evaluated after the contract and data model below — still no
violations. Worth restating after design: the grouped-builder refactor **reduces** duplication
rather than adding structure, because it removes the possibility of a second description existing.

## Project Structure

### Documentation (this feature)

```text
specs/006-command-listing/
├── spec.md                     # Feature specification (exists)
├── plan.md                     # This file
├── research.md                 # Phase 0 — the decisions and what they were chosen over
├── data-model.md               # Phase 1 — the transient entities and the render rules
├── quickstart.md               # Phase 1 — how to validate it
├── contracts/
│   └── command-surface.md      # Phase 1 — the single-source contract FR-008 rests on
├── checklists/requirements.md  # Spec quality checklist (exists, 16/16)
└── tasks.md                    # /speckit-tasks output — NOT created here
```

### Source Code (repository root)

```text
contract/
└── src/index.ts             # UNCHANGED — not opened

agent/
└── src/**                   # UNCHANGED — not opened; /help contacts no agent

orchestrator/
├── src/commands.ts          # buildCommandGroups (the single source) + the listing renderer
├── src/commands.test.ts     # the agreement test, grouping, runnable forms, no-leak
└── src/index.ts             # /help answered BEFORE deferReply, inside the resolved tenant

site/
└── index.html               # The public homepage — the new command (FR-021)
```

**Structure Decision**: No structural change. Everything lives in the orchestrator module that
already owns the Discord surface, because that is where the command surface is defined and the
feature's entire point is not to define it a second time somewhere else.

The placement rule governing this feature is narrower than usual and worth stating plainly:
**there must be exactly one function that decides what a guild can run.** Registration calls it;
the listing calls it. Any code that reconstructs, mirrors, or annotates that answer elsewhere —
however small — reintroduces the drift this feature exists to eliminate.

## Complexity Tracking

> No Constitution Check violations. This section is intentionally empty.
