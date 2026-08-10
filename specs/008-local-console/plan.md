# Implementation Plan: One console for the operator

**Branch**: `008-local-console` | **Date**: 2026-08-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/008-local-console/spec.md`

## Summary

One local command, `reveille`, giving the single operator on `watson` what Discord gives a
guild — plus the process management the current PowerShell script does badly. Bare verbs act
on **targets** (`reveille start satisfactory`), issued straight at the agents over the
existing seam; `plane` verbs act on the **control-plane processes** (`reveille plane up`),
now spawned without console windows and with their output written to rotating logs.

The technical shape follows from two observations. First, **the console is not a component**,
so it gets no package — it is a second entry point inside the orchestrator workspace, which
is also the only placement that leaves the eslint seam guard without a hole. Second, **007
already built the operator channel**: `Reply.diagnostic` carries the status code, errno, and
target error text, and was deliberately never rendered because Discord is the wrong audience.
This feature is the audience it was built for, so FR-021 needs no new plumbing.

Nothing about the seam changes: same eight verbs, same direction, no target identifier in any
path. The only code touched outside the console is a mechanical extraction of each handler's
pure core so both surfaces share **behaviour**, not merely wording.

## Technical Context

**Language/Version**: TypeScript on Node 24, run directly via type stripping. No build step;
`erasableSyntaxOnly` is on, so a passing `tsc` also guarantees the code runs.

**Primary Dependencies**: None added. The console lives in the orchestrator workspace and
transitively uses `discord.js` (already present) because `buildCommandGroups` returns
`SlashCommandBuilder`s. The agent's zero-runtime-dependency rule is untouched — no agent code
is modified at all.

**Storage**: None, deliberately. The console persists nothing between invocations (FR-016).
The only files written are per-service logs under `logs/`, gitignored, kept to at most one
prior generation (FR-028).

**Testing**: `node:test`, tests beside their source as `*.test.ts`, no framework. Plus one
**M0 measurement** on real Windows (`m0-windows-spawn.md`) that gates the US2 implementation.

**Target Platform**: Windows 11 on `watson`, run from a terminal by a human. The console is
the second Windows-pinned surface after the agent — it enumerates processes and spawns
detached children, both OS-specific.

**Project Type**: Single-repo workspaces; this feature adds a console entry point to an
existing workspace and deletes a PowerShell script.

**Performance Goals**: None meaningful. The one bound that matters is user-facing: a target
command returns as fast as its agent answers, and `plane up` reports within a few seconds of
each service becoming ready. `reveille start <game>` blocks for as long as the start takes,
bounded by `FOLLOWUP_TIMEOUT_MS`.

**Constraints**: The console must never outlive the human who ran it (FR-016–FR-020) — this
is the constraint that keeps it from being a second orchestrator, and it is the one most
likely to be eroded by a well-meaning later change. It must also never print its own
environment: it loads `orchestrator/.env`, so `DISCORD_BOT_TOKEN` is in its process
environment and the repository is public.

**Scale/Scope**: One host, one operator, four services, three targets, ten target commands.

## Constitution Check

*GATE: evaluated before Phase 0, re-evaluated after Phase 1 design. Both passes recorded.*

### I. The Seam Is Inviolable — **PASS**

The console talks to agents over HTTP, in the orchestrator→actuator direction, and never
imports agent code. The contract is **not modified**: no new verb, no new request parameter,
no response field, and no target identifier in any path, query, or body (FR-010). A target
name resolves to a URL locally, exactly as the orchestrator resolves a Discord subcommand.

The one thing that *looks* like a crossing is `plane up` launching agent processes. It is
not: the agent's entry script is a **string passed to the OS**, not an import — the same
thing `reveille.ps1` does today. `eslint`'s `no-restricted-imports` remains in force and
unmodified, and §1 of `research.md` chose the console's placement specifically so no
exemption is needed.

### II. Components Are Welded; Only The Orchestrator Relocates — **PASS, with the argument recorded**

This is the principle the feature must answer, and the spec answers it in its own section:
all three component kinds run *when nobody is watching*, which is what makes weldedness
meaningful; the console is a one-shot process started by a present human and exits. It
receives **no package**, which keeps the repository layout consistent with that claim.

The claim is only true while it is enforced, so it is enforced as requirements rather than
prose: FR-016 (no state between invocations), FR-017 (no process of its own outlives it),
FR-018 (foreground watch, never detached), FR-019, FR-020 (no schedule, daemon, or poller).
Per Constitution V and FR-035, **`DECISIONS.md` 025 must be written before any code** —
recording the console as a second client of the seam, why it is not a fourth component, and
the never-outlive-the-human rule.

### III. Build The Minimum; Defer By Default — **PASS**

Deferred and stated in the spec's Out of Scope: Windows services / Task Scheduler, boot
autostart, any TUI or web console, any `--watch` or daemon mode, off-box operation. The
autostart item keeps its existing trigger and its coupled native-vs-WSL2 decision intact.

One item needs justifying rather than asserting: the `runX` extraction (§2) refactors working
code. See **Complexity Tracking**.

### IV. A Stop That Cannot Be Graceful Is Not A Stop — **PASS**

The console adds **no new stop path**. `reveille stop <game>` is the agent's existing
graceful stop reached over the seam; the console cannot force, kill, or bypass it, because
the seam offers nothing else.

The new risk this feature introduces is `plane down`, which *does* terminate processes. It is
bounded by FR-032 (matches Reveille's own processes by entry script and env file, never a
recorded id alone) and FR-033 (must not stop, pause, or change any controlled target). A
console that could reach a game server's process would be the violation; a test must pin
that it cannot.

### V. Record The Decision Before Deleting The Reasoning — **PASS**

FR-035 makes the `DECISIONS.md` entry a prerequisite of implementation, not a write-up after
it. FR-036 replaces `scripts/reveille.ps1` — the reasoning that script encodes (which
processes are Reveille's, why matching is by command line) moves into the console and into
the decision entry before the script is deleted.

### Additional Constraints

- **Stack** — no new package, because no new component (§1). No new dependency.
- **Secrets** — the console loads `orchestrator/.env` and therefore holds `DISCORD_BOT_TOKEN`
  in memory. It MUST NOT print its environment or include it in any diagnostic. This is a
  task with a test, not a note (§9).
- **Windows** — the agent's Windows pin now extends to the console. The spawn flags are
  measured, not assumed (§5).

**Gate result (pre-Phase 0): PASS on all five principles.** One justified complexity, below.

### Re-evaluation after Phase 1 design — **PASS, unchanged**

The design produced no new violations, and two of the gates got *stronger* evidence than the
first pass could offer:

- **Principle I** — Phase 1 confirmed the seam needs nothing. `contract/` and `agent/` appear
  in no artifact as modified, and `contracts/console-surface.md` is explicitly not a network
  contract. The console reuses `AgentClient` as-is; the eight verbs and their shapes are
  untouched.
- **Principle II** — the "not a component" claim is now enforced in three places rather than
  asserted in one: FR-016–FR-020 in the spec, §6 of the surface contract, and `data-model.md`,
  where every entity is transient by construction and the one written artefact (a log) is
  explicitly not read back to make decisions. `DECISIONS.md` 025 remains a prerequisite of
  implementation, not a write-up after it.
- **Principle III** — the design *reduced* scope in one place rather than growing it:
  `research.md` §4 removes the hardcoded four-row service table instead of porting it, so the
  agent port stops having three copies. The one complexity below is unchanged.
- **Principle IV** — strengthened. `quickstart.md` §7 turns "must not touch a target" into a
  live check with a player connected, and adds an unrelated `node` process as a negative
  control.
- **Principle V** — unchanged; FR-035 gates implementation.

**One item surfaced by the design that was not visible at spec time**, and it is a constraint
rather than a violation: because the console reads `orchestrator/.env` to get `TENANTS`, it
holds `DISCORD_BOT_TOKEN` in its process environment. The repository is public. The console
must never print its environment or fold it into a diagnostic, and that becomes a task with a
test rather than a note (`research.md` §9, surface contract §4, `quickstart.md` §9).

## Project Structure

### Documentation (this feature)

```text
specs/008-local-console/
├── plan.md                      # This file
├── spec.md                      # 36 FRs, 10 SCs, 4 clarifications
├── research.md                  # 9 decisions
├── data-model.md                # Phase 1 — every entity transient
├── quickstart.md                # Phase 1 — validation guide
├── contracts/
│   └── console-surface.md       # Phase 1 — the command surface + exit codes
├── m0-windows-spawn.md          # The measurement (created by the M0 task)
├── checklists/requirements.md
└── tasks.md                     # /speckit-tasks output — not created here
```

### Source Code (repository root)

```text
orchestrator/
├── src/
│   ├── console/                 # NEW — the console. Not a component; not a package.
│   │   ├── index.ts             #   entry: argv → verb → render → exit code
│   │   ├── surface.ts           #   argv parsing derived from buildCommandGroups
│   │   ├── render.ts            #   Reply → terminal (text, then diagnostic, then agent URL)
│   │   ├── targets.ts           #   TENANTS union across tenants + conflict detection
│   │   ├── plane.ts             #   service discovery, spawn, readiness, down, status
│   │   ├── logs.ts              #   one-generation rotation + merged follow
│   │   └── *.test.ts
│   ├── commands.ts              # MODIFIED — extract runX cores; handleX become thin
│   ├── agent-client.ts          # unchanged
│   ├── config.ts                # unchanged (console calls parseTenants directly)
│   └── index.ts                 # MODIFIED — handlers delegate to the runX cores
├── package.json                 # MODIFIED — a script for the console entry
agent/                           # UNTOUCHED
contract/                        # UNTOUCHED — the seam does not change
scripts/
├── reveille.cmd                 # MODIFIED — shim now launches the node console
└── reveille.ps1                 # DELETED (FR-036)
logs/                            # NEW, gitignored — <service>.log and <service>.log.1
```

**Structure Decision.** The console is a directory inside the orchestrator workspace rather
than a new workspace, because a package would assert componenthood that the spec spends a
section denying, and because every alternative placement needs either an eslint exemption or
a deep import to reach the code it exists to reuse (`research.md` §1). `agent/` and
`contract/` are not modified at all — the strongest available evidence that the seam is
untouched.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Refactoring the ten `handleX` functions into pure `runX` cores (Constitution III discourages reworking working code) | SC-004 promises the two surfaces cannot disagree. Sharing only `describeX` shares the **wording** while leaving the **behaviour** — which verb is sent, which default is applied, how a sign is read — duplicated in a second place. | Letting the console call `AgentClient` + `describeX` directly is genuinely crude-and-acceptable at one or two commands. At ten it is a second implementation of the routing rules, and 005 shipped a drift bug of exactly this shape. It also writes the sequences twice: once for US1, again when US3 makes them consistent. |
