<!--
SYNC IMPACT REPORT
Version change: 1.1.0 → 1.2.0
Rationale (1.2.0, 2026-08-04): MINOR — new standing guidance, no principle changed.
Development Workflow now requires the public homepage (site/) to be a planned task
in a spec's tasks.md when that spec changes user-facing behaviour, done during
/speckit-implement rather than retrofitted after close. Recorded in DECISIONS 020.
Amended section: Development Workflow. No template changes required.

Version change: 1.0.0 → 1.1.0
Rationale (1.1.0, 2026-08-04): MINOR amendment — materially widened scope, no
principle removed or redefined. The opening line and Principle II broaden "game
server process" to "controllable target on a host" so the agent can be welded to a
non-game target (a media player, 003). The seam, the weld, and every placement
rule are unchanged; only the set of admissible targets grew. Recorded in
DECISIONS 017. Amended sections: opening line, Principle II (definition +
rationale). No template changes required (the Constitution Check gate is generic).

Version change: (none) → 1.0.0
Rationale: Initial ratification. Template placeholders replaced with concrete
principles derived from initial-architecture/DECISIONS.md (001–008) and
01-decide-now.md, which predate this constitution and remain the authority for
architectural reasoning.

Principles defined (all new):
  I.   The Seam Is Inviolable
  II.  Components Are Welded; Only The Orchestrator Relocates
  III. Build The Minimum; Defer By Default
  IV.  A Stop That Cannot Be Graceful Is Not A Stop
  V.   Record The Decision Before Deleting The Reasoning

Added sections:
  Additional Constraints (stack, repo shape, secrets)
  Development Workflow (Spec Kit flow, the acceptance test, when to amend)
  Governance

Removed sections: none (initial version)

Templates requiring updates:
  ✅ .specify/templates/plan-template.md   — Constitution Check gate reviewed, generic, no edit needed
  ✅ .specify/templates/spec-template.md   — no constitution-driven mandatory sections added
  ✅ .specify/templates/tasks-template.md  — no new principle-driven task categories
  ✅ README.md                             — already states the acceptance test; consistent
  ✅ .claude/skills/speckit-*/SKILL.md     — no agent-specific references requiring genericization

Deferred placeholders: none
-->

# Reveille Constitution

Reveille is an on-demand control plane for controllable targets on a host — game
servers first, and any other target a host can start, stop, or toggle (a media
player was the second, 003). This constitution governs how it is built. It does not restate the architecture —
[`initial-architecture/DECISIONS.md`](../../initial-architecture/DECISIONS.md) is
the authority for *what* was decided and *why*. This document states the rules
that decisions must not violate.

## Core Principles

### I. The Seam Is Inviolable

The orchestrator MUST talk to actuators over a network API — never in-process,
never a localhost shortcut — including while both run on the same machine.
Direction is orchestrator → actuator; actuators MUST NOT initiate.

An actuator's URL is its identity. No server identifier, machine identifier, or
routing discriminator may enter the contract; a new target is a new address in
configuration.

*Rationale:* the seam is the only genuinely irreversible decision in the system
(DECISIONS 002). Everything else can be walked back over a weekend; collapsing
this one means unpicking every call site. It costs about thirty lines to honor
now and grows more expensive in exact proportion to how long it is deferred.

### II. Components Are Welded; Only The Orchestrator Relocates

The system has exactly three kinds of component, each defined by what it is
welded to: the **orchestrator** (welded to nothing, exactly one), the **agent**
(welded to a controllable target on a host, one per target), and the **emitter**
(welded to a broadcast domain, one per LAN).

A target is whatever a host can control: a game server process, a media player,
whatever comes next. An agent may control it however that target is reached — a
spawned process, a local HTTP interface — but it is still one agent welded to one
target on one host. The *kind* of target (game, media, …) selects the agent's
verbs; it never changes what an agent is or where it lives.

Actuators MUST NOT be separated from what they are welded to. Growth MUST take
the form of more instances, never pieces of one component splitting off.

*Rationale:* a process that actuates something on a machine has to be on that
machine (DECISIONS 007, 008). This is definitional, not preference, and it is
what makes every placement question answerable by asking "what is it welded to?"
Widening "game server process" to "controllable target on a host" (003) did not
touch that logic — it only admitted targets that are not games (DECISIONS 017).

### III. Build The Minimum; Defer By Default

Work MUST be the least thing that satisfies the stated requirement. Anything not
required by the current milestone belongs in
[`03-deferred.md`](../../initial-architecture/03-deferred.md) with a reason and a
trigger, not in the build.

Crude implementations are acceptable and expected — hardcode it, poll it, keep it
in memory. Crude is reversible; wrong boundaries are not. The only things that
may not be crude are Principles I and II.

Knowing about a future capability is NOT licence to prepare for it. Placeholder
modules, reserved directories, and abstractions built against a single
implementation are prohibited.

*Rationale:* the expensive mistake is building the fully-designed system before
playing a single session. Deferred items earn their way in by causing an actual
annoyance, which is better evidence than any guess made now.

### IV. A Stop That Cannot Be Graceful Is Not A Stop

`stop` MUST mean save-then-exit. An adapter that cannot guarantee a graceful stop
MUST fail the call rather than kill the process. This is a contract obligation
inherited by every future adapter, not an implementation detail of the first one.

Availability is disposable; durability is not. The system MUST NOT trade world
data for uptime, responsiveness, or convenience.

*Rationale:* this system's entire job is shutting servers down unattended with
nobody watching — it manufactures the exact conditions that lose worlds. Losing a
session's progress is a categorically worse outcome than any amount of downtime.

### V. Record The Decision Before Deleting The Reasoning

Any change to the seam, any candidate being chosen, and any deferred question
being closed MUST be recorded in `DECISIONS.md` — with what it was chosen *over*
— **before** the document that motivated it is deleted or rewritten.

`DECISIONS.md` is append-only. A candidate MUST NOT be defended as though it were
settled.

*Rationale:* working documents hold reasoning; the log holds conclusions. Delete
in the wrong order and the project is left with choices nobody can explain, which
is exactly how a settled decision gets relitigated eighteen months later.

## Additional Constraints

**Stack.** TypeScript on Node 24, every package. One repository, one
independently deployable package per component, plus the contract between them.
A package is created when its component is actually built — never in advance.

**Secrets.** No credentials, tokens, connection strings, MAC addresses, or
runtime identifiers may be committed. The repository is public. Configuration
that names *where* something lives is acceptable; configuration that grants
*access* to it is not, and belongs in `.env`.

**The agent runs on Windows** and is tested there — that pin is about the deploy
target, not the language. The orchestrator is developed against generic Linux
regardless of where it currently runs.

## Development Workflow

Features follow the Spec Kit flow: `/speckit-specify` → `/speckit-plan` →
`/speckit-tasks` → `/speckit-implement`. Lifecycle state mirrors to ClickUp via
the `clickup` extension; the repository remains the source of truth and the sync
is one-way.

**The public homepage is a spec deliverable, not an afterthought.** When a spec
changes what the system does for a user — a new command, a new target, a changed
guarantee — updating the landing page in [`site/`](../../site/) MUST be a task in
that spec's `tasks.md`, planned during `/speckit-plan`/`/speckit-tasks` and done
during `/speckit-implement` alongside the code. The page is public and states what
Reveille is and does; a spec that ships while the homepage still describes the old
behaviour is not finished.

**The acceptance test every change is measured against:**

> If adding a capability requires a new *kind* of thing rather than a new *row*,
> something was drawn wrong.

A second game is a row. A second machine is a row. Wake-on-LAN is a column plus
one deployment. Any proposed change that introduces a fourth kind of component
MUST be treated as an architecture change and MUST produce a `DECISIONS.md` entry
before implementation begins.

## Governance

This constitution supersedes other practice. Where it conflicts with a plan, a
task list, or a convenience, the constitution wins.

**Amendments** require a `DECISIONS.md` entry stating what changed and what it was
chosen over, plus a version bump here and propagation to any dependent template.

**Versioning** follows semantic versioning: MAJOR for backward-incompatible
principle removals or redefinitions, MINOR for a new principle or materially
expanded guidance, PATCH for clarifications and wording.

**Compliance.** Every plan MUST pass the Constitution Check gate before tasks are
generated. Violations MUST be justified explicitly in the plan's Complexity
Tracking section or the approach MUST be simplified. An unjustifiable violation
of Principle I or II is not a complexity trade-off — it is a defect.

**Version**: 1.2.0 | **Ratified**: 2026-07-20 | **Last Amended**: 2026-08-04
