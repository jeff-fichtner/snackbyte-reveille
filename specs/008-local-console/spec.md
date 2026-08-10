# Feature Specification: One console for the operator

**Feature Branch**: `008-local-console`

**Created**: 2026-08-10

**Status**: Draft

**Input**: User description: "One local `reveille` command on the host — a console for the single operator, alongside (never replacing) Discord. Two jobs: command the targets locally, straight at the agents over the existing seam; and manage the control-plane processes without leaving four PowerShell windows on the desktop. The verb collision is the first decision — bare verbs act on targets, process verbs go behind `plane`. The target map comes from `TENANTS`, unioned across tenants. The command surface is a third derivation of `buildCommandGroups`, so it cannot drift from Discord. It is not a fourth kind of component, and the rule that keeps that true is that it must never outlive the human who ran it."

## Overview

Reveille has two audiences and only one of them has an interface.

**Discord is the multi-person surface** — members of a guild ask for a game or nudge the show.
That surface is finished and this feature does not touch it.

**The operator layer is one person on one machine**, and their interface today is
[`scripts/reveille.ps1`](../../scripts/reveille.ps1). It does one of the two jobs an operator
needs, and does it in a way that litters: `start` spawns **four separate PowerShell windows**,
one per service, each held open by `-NoExit`. The other job it cannot do at all — to start a game
server *from the machine the game server runs on*, the operator opens Discord and types a slash
command that travels to Discord's servers and back.

This feature gives that one person **one local command** that does both:

- **Command the targets** — the same verbs Discord offers, issued straight at the agents.
- **Manage the control plane** — the same processes the script manages, with no windows and
  with their output kept rather than lost.

It adds no capability to Discord, no verb to the seam, and no component to the architecture.

## The two objects, and why the naming decides everything

The word `start` already means something here, and the ask is for it to mean something else.

| Typed today | Object | Typed after this feature | Object |
|---|---|---|---|
| `reveille start` | the **control plane** (four node processes) | `reveille plane up` | the control plane |
| — | — | `reveille start satisfactory` | the **game server** |
| `reveille status` | are the agents running? | `reveille plane status` | are the agents running? |
| — | — | `reveille status` | are the targets running? |

`status` is the sharper trap, because the interesting case is the one where the two answers
**differ**: agent up, game stopped. A single word that could mean either is a word that will be
misread exactly when it matters.

The resolution: **bare verbs act on targets, process verbs live under `plane`.** Targets get the
bare names because they are typed daily and because they must mirror Discord one-for-one. The
process verbs become `up`/`down` rather than `plane start`/`plane stop`, so the collision is gone
at the level of the *word* rather than resolved by counting arguments.

The old script's verbs change meaning. That break costs nothing: one person holds those habits,
and nothing else in the repository invokes the script.

## Why this is not a fourth kind of component

Constitution II names exactly three kinds of component and the acceptance test makes a fourth an
architecture change. The uncomfortable reading is real and is stated here rather than skipped: the
console is welded to nothing and it talks to agents over the seam, which is the orchestrator's own
definition — and there is supposed to be exactly one orchestrator.

**It is not a component.** All three kinds run *when nobody is watching* — that is what makes
weldedness matter at all. This is a one-shot process that exits, started by a human standing right
there. The honest comparison is `curl` aimed at an agent with the target names filled in and the
response rendered. Delete it and nothing degrades; no other component knows it exists.

**The rule that keeps that true is load-bearing and is a requirement, not a note: the console must
never outlive the human who ran it.** No state carried between invocations, no background poller,
no scheduled work, no watcher that survives the terminal. The moment it acquires one it *is* a
second unattended thing that can start and stop targets — the "ownership of recovery" fight already
recorded in [`03-deferred.md`](../../initial-architecture/03-deferred.md), where any two owners
running at once fight and the fight looks like flapping.

`plane up` does leave processes running after the terminal closes, and that is not a contradiction:
those processes are the orchestrator and agents, existing components with their own mandate. The
console is a **launcher** there, not a controller. Launching a component is not becoming one.

Per Constitution V this MUST be recorded in `DECISIONS.md` before implementation. The
fourth-component trigger does not formally fire under this reading, but a second client of the seam
is a candidate being chosen, and the never-outlive-the-human rule has nowhere else to live.

## Clarifications

### Session 2026-08-10

- Q: When `reveille status` finds a target unreachable, should it also report whether that target's agent process is running? → A: **Yes, on unreachable only.** A reachable target reads exactly as Discord reports it; an unreachable one additionally says whether its agent is up, which separates "the player is closed" from "the agent is not running". The divergence from Discord exists only in the failure case, where the local vantage point is the only thing that can answer it.
- Q: After `plane up` launches the services, should it verify they actually came up? → A: **Yes — verify each service is serving**, and name any that failed with a pointer to its log. Every environment variable in this system is required and throws at boot, so a misconfigured service exits within a second. That failure was survivable only because it was visible in the window the launcher spawned; once the windows are gone, reporting "started" for an already-dead process would be exactly the silent wrong behaviour the fail-loud config rule exists to prevent. Removing the window is what creates the obligation to check.
- Q: What bounds the foreground wait of `reveille start <game>`? → A: **The orchestrator's existing follow-up timeout**, reused rather than duplicated. It is the same product decision — how long a start is allowed to take before we stop claiming to know — so the two surfaces cannot disagree, and no second required variable is introduced on the machine where friction matters most. An impatient operator already has Ctrl-C, which by FR-019 does not cancel the launch.
- Q: What exit-code taxonomy should the console use? → A: **Four classes** — success, refused by the target, agent unreachable, usage error. These are the branches the reply logic already makes (a 200/202 outcome, a 409 refusal, a transport failure, an unknown name), so the codes render a distinction that exists rather than inventing a parallel one. The distinction that earns its keep is refused vs unreachable: a script may sensibly retry an unreachable agent and must not retry a refusal.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Command a target from the machine it runs on (Priority: P1) 🎯 MVP

The operator is sitting at `watson`. They want the Satisfactory server up. Today that means
opening Discord and issuing a slash command that leaves the building and comes back. They type
`reveille start satisfactory` instead, watch it come up in the terminal, and get on with their day.

**Why this priority**: this is the capability that does not exist in any form today, and it is the
half that keeps working when Discord or the bot is down — which is precisely when a local control
path earns its place. It is a complete, useful console on its own, with the window cleanup still
pending.

**Independent Test**: with the orchestrator process stopped, run each target command from a shell
on the host and confirm the target responds exactly as it does from Discord.

**Acceptance Scenarios**:

1. **Given** the Satisfactory agent is running and its server is stopped, **When** the operator
   runs `reveille start satisfactory`, **Then** the launch is issued, the console watches in the
   foreground, and it reports the server running once the agent observes it.
2. **Given** the orchestrator is not running at all, **When** the operator runs any target command,
   **Then** it behaves identically — the orchestrator is not in the path.
3. **Given** a media target is configured, **When** the operator runs `reveille forward`, **Then**
   it moves by the same default amount Discord's `/forward` uses, and reports the direction
   actually taken.
4. **Given** a start is in progress and the operator interrupts the console mid-watch, **When** the
   process exits, **Then** the launch is unaffected and the console has said so before exiting.
5. **Given** an agent is not running, **When** the operator commands its target, **Then** the
   console reports the agent unreachable and names the command that would start it.

---

### User Story 2 - A control plane that leaves no windows and keeps its output (Priority: P2)

The operator runs `reveille plane up`. Four services start. The desktop looks exactly as it did
before. When the orchestrator dies at 3am, its final output is still there to read in the morning.

**Why this priority**: it removes a daily irritation and closes a real gap — today a service's
output exists only inside a window nobody is watching, and vanishes when that window is closed.
Valuable on its own, but the console has to exist first.

**Independent Test**: run `plane up` and confirm no console window appears, all four services are
listening/connected, the log files fill, and the services survive closing the launching terminal.

**Acceptance Scenarios**:

1. **Given** nothing is running, **When** the operator runs `reveille plane up`, **Then** all four
   services start, **no window is created for any of them**, each writes to its own log, and the
   command confirms each one is actually serving before it reports success.
2. **Given** one service is misconfigured and exits at boot, **When** `reveille plane up` runs,
   **Then** that service is reported as **failed** — never as started — naming its log, while the
   others are reported up.
3. **Given** the plane is up, **When** the operator closes the terminal they launched it from,
   **Then** every service keeps running.
4. **Given** a service wrote a log during its previous run, **When** `plane up` runs again,
   **Then** the previous log is preserved as one prior generation and a fresh log begins.
5. **Given** the plane is up, **When** the operator runs `reveille plane logs`, **Then** they see
   the services' output together in one followable view.
6. **Given** some services are already up, **When** `plane up` runs, **Then** those are skipped
   rather than launched a second time.
7. **Given** game servers and the media player are running, **When** the operator runs
   `reveille plane down`, **Then** every Reveille process stops and **no controlled target is
   touched**.
8. **Given** the plane is up and only the orchestrator has died, **When** the operator names that
   one service — `reveille plane restart orchestrator` — **Then** only that service is restarted
   and the three agents are left running.

---

### User Story 3 - A local surface that cannot disagree with Discord (Priority: P3)

The operator forgets whether the seek argument is seconds or minutes. They type `reveille help`
and get exactly the commands Discord offers, described in exactly the same words — because it is
the same list, rendered twice.

**Why this priority**: the drift it prevents is real and this repository has already shipped it
once. But the console is useful before the listing is polished, so it follows the two capabilities.

**Independent Test**: add a command to the shared source and confirm it appears in both Discord's
registration and `reveille help` without a second list being edited.

**Acceptance Scenarios**:

1. **Given** a tenant's configured targets, **When** the operator runs `reveille help`, **Then**
   every listed command and description matches what Discord registers, word for word.
2. **Given** a command exists in Discord, **When** the listing is rendered, **Then** it cannot be
   absent locally; and no command can be listed locally that Discord does not have.
3. **Given** any target command runs, **When** it reports, **Then** it prints both the sentence a
   member would read and the fact underneath it — the observed state, the outcome, and which agent
   answered.
4. **Given** a command is refused, unreachable, or misused, **When** the process exits, **Then**
   the exit code distinguishes those cases from success.

---

### Edge Cases

- **`reveille start` or `reveille stop` with no target named** — ambiguous between the plane and a
  game. It MUST fail, naming both things it could have meant, and act on neither.
- **A target name that is not configured** — refused, listing the valid names; nothing is contacted.
- **A verb aimed at the wrong kind of target** — `reveille start vlc`, or a media verb naming a
  game. Refused locally exactly as Discord makes it unpickable, and nothing is contacted. The
  console partitions verbs by kind for the same reason the registration does.
- **The same target name under two tenants pointing at different addresses** — refused before
  anything is contacted, naming both tenants. Picking either would command the wrong machine.
- **The same target name under two tenants pointing at the same address** — unions cleanly to one
  entry; this is the documented shared-target case.
- **A media verb with no media target configured** — refused in the same terms Discord uses.
- **`orchestrator/.env` missing, or `TENANTS` absent or malformed** — fails loud naming the
  variable, exactly as the orchestrator does at boot. No fallback map.
- **`plane logs` before any log exists** — says so; does not create empty files or fail obscurely.
- **A prior rotated log already exists** — it is the one generation that gets replaced.
- **`plane down` when nothing is running** — says so; exits without error.
- **A non-Reveille node process on the machine** — can never be matched by `plane down`.
- **`reveille` with no arguments** — renders the same listing as `reveille help`.

## Requirements *(mandatory)*

### Functional Requirements

**The command surface**

- **FR-001**: Bare verbs MUST act on controlled targets, mirroring the Discord commands one-for-one
  in name and argument shape.
- **FR-002**: Control-plane verbs MUST live under `plane`: `up`, `down`, `restart`, `status`, `logs`.
- **FR-003**: A target verb that requires a target name but is given none MUST fail, contact
  nothing, and name the targets it could have acted on. Where that bare verb is *also* a
  control-plane verb — `start`, `stop` — the failure MUST additionally name both objects it could
  have meant, since an operator with the old habits will type exactly those. It MUST NOT guess in
  either case.
- **FR-004**: `reveille help` and `reveille` with no arguments MUST render the same command listing.
- **FR-005**: The listing MUST be derived from the same single source that Discord registration is
  derived from. No command name or description may be authored locally.
- **FR-006**: The console MUST NOT offer a target command Discord lacks, omit one Discord has, or
  describe one differently. This governs the **command surface** — which commands exist, their
  arguments, and their descriptions. It does not constrain what a command *reports* when it runs,
  which FR-021 and FR-025 deliberately widen beyond what a member sees.
- **FR-007**: `plane` verbs MAY name a single service and MUST default to all services when none is
  named.

**Routing**

- **FR-008**: Target commands MUST be issued directly to the agent. The orchestrator MUST NOT be in
  the path, and no inbound port may be added to it.
- **FR-009**: Every target command MUST work while the orchestrator is not running.
- **FR-010**: The seam MUST be unchanged — no new verb, no new request parameter, and no target
  identifier in any path, query, or body.

**The target map**

- **FR-011**: The target map MUST be read from the same tenant configuration the orchestrator reads
  — the only place a target's name, address, kind, and public port exist together — and MUST be read
  directly, without contacting the orchestrator, so that FR-009 holds.
- **FR-012**: The console MUST union the targets of every tenant, since it has no guild.
- **FR-013**: If one name maps to different addresses across tenants, the console MUST refuse to run
  and name both tenants. If it maps to the same address, the entries MUST union to one.
- **FR-014**: Missing or malformed configuration MUST fail loud naming the variable. There is no
  fallback map and no built-in default address.
- **FR-015**: The console MUST NOT build a target map from the agents' own configuration files —
  that would be a second, lossy copy and would re-derive which verbs apply to which kind.

**Lifetime — the rule that keeps this from being a component**

- **FR-016**: The console MUST NOT persist any state between invocations.
- **FR-017**: The console MUST NOT leave any process of its own running after it exits. Services
  started by `plane up` are not its own.
- **FR-018**: `reveille start <game>` MUST watch in the foreground until the target is observed
  running or the bound expires, then exit. The bound MUST be the orchestrator's existing follow-up
  timeout — the same value, not a second setting — and MUST NOT be unbounded, so the command
  always terminates with a usable exit code. It MUST NOT detach a watcher.
- **FR-019**: Interrupting a watch MUST NOT cancel the launch already issued, and the console MUST
  state that before exiting.
- **FR-020**: The console MUST NOT schedule, daemonise, or poll on any schedule of its own.

**What the operator is told**

- **FR-021**: Every target command MUST print both the sentence a Discord member would read and the
  fact beneath it — the state observed, the outcome, and which agent answered.
- **FR-022**: Exit codes MUST distinguish exactly four outcomes: success, a refusal by the target,
  an unreachable agent, and a usage error. Refusal and unreachability MUST NOT share a code — a
  caller may sensibly retry the second and must never retry the first. These four are the branches
  the reply logic already makes; the codes render that distinction rather than adding one.
- **FR-023**: The console MUST NOT claim an outcome the agent did not report.
- **FR-024**: `plane status` and `status` MUST be worded so that a process being up is never
  mistaken for a target being up.
- **FR-025**: When a target is unreachable, the console MUST also report whether that target's agent
  process is running — the one question only the local vantage point can answer. A target that
  *is* reachable MUST read exactly as Discord reports it; this addition appears in the failure
  case only.

**The control plane**

- **FR-026**: `plane up` MUST NOT create a visible console window for any service.
- **FR-027**: Each service's standard output and error MUST be written to its own log file.
- **FR-028**: On `plane up`, an existing log MUST be kept as **at most one** prior generation before
  a fresh log begins. Output MUST NOT be discarded on restart, and generations MUST NOT accumulate
  without bound.
- **FR-029**: `plane logs` MUST present the services' output in one merged, followable view.
- **FR-030**: `plane up` MUST be idempotent — a service already running is skipped, never launched
  twice.
- **FR-031**: Services started by `plane up` MUST survive the terminal that launched them.
- **FR-032**: `plane down` MUST stop only Reveille's own processes, identified by what they are
  running — their entry script and configuration file. It MUST remain incapable of stopping an
  unrelated process even after a machine restart or a reused process id, which rules out acting on
  a previously recorded identifier alone.
- **FR-033**: `plane down` MUST NOT stop, pause, or otherwise change any controlled target.
- **FR-034**: `plane up` MUST verify that each service it launched is actually **serving** before
  reporting success, and MUST report the outcome per service. A service that failed MUST be named
  as failed — never as started — with a pointer to its own log, where the fail-loud configuration
  error already is. Removing the window is what creates this obligation: the launcher is now the
  only thing positioned to notice.

**Record and replace**

- **FR-035**: A `DECISIONS.md` entry MUST be written before implementation, recording the console as
  a second client of the seam, why it is not a fourth component, and the never-outlive-the-human
  rule.
- **FR-036**: The existing PowerShell script and its shim MUST be replaced, not left alongside as a
  second way to manage the plane, and the operational documentation MUST be updated to match.

### Key Entities

- **Console invocation**: one run of the command by a human. Has no memory of any previous run and
  leaves nothing behind.
- **Target map**: the union of every tenant's targets — name, address, kind, public port. Built
  fresh per invocation from the orchestrator's configuration; never cached.
- **Plane service**: one long-lived Reveille process — the orchestrator, or one agent. Has a label,
  a configuration file, an entry script, an optional listening port, and a log file.
- **Log generation**: a service's output for one run. At most two exist at a time — the current one
  and the one before it; on a service's first ever run, only the current one.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The operator can start any game server from the host in a single command without
  opening Discord.
- **SC-002**: Bringing the control plane up leaves **zero** windows on the desktop, down from four.
- **SC-003**: After any service exits unexpectedly, its final output is still readable afterwards —
  no output is lost with the terminal.
- **SC-004**: Every target command available in Discord is available locally under the same name
  with the same description, and a command added later appears in both without a second list being
  edited.
- **SC-005**: With the orchestrator stopped, 100% of target commands still work.
- **SC-006**: No process started by a target command outlives the invocation.
- **SC-007**: An ambiguous, unknown, or unusable command contacts nothing and exits non-zero.
- **SC-008**: Bringing the control plane down changes the state of zero controlled targets.
- **SC-009**: An operator diagnosing a dead target can tell, from one command, whether the target is
  down or its agent is.
- **SC-010**: A service that fails to start is never reported as started, and the operator is
  pointed at the reason without having to go looking for it.

## Assumptions

- **One operator, on the host.** The console is run by a human in a shell on the machine the agents
  run on. It is not a remote tool and inherits the same-box trust the agents already assume; it adds
  no authentication because it crosses no new boundary.
- **The agents' addresses in `TENANTS` are reachable from the host.** True today — everything is
  loopback on one machine — and the console does not assume it beyond what the configuration says.
- **Log files live under the repository and are not committed.**
- **The default seek amount, the sign handling, and every reply's wording are already decided** by
  005/007 and are inherited unchanged. This feature adds a second renderer, not a second policy.
- **The command shim stays**, so `reveille` remains runnable as a bare word from any shell and any
  directory.
- **The public homepage does not change.** The Constitution requires the site to be updated when a
  spec changes what the system does *for a user*; this feature changes nothing on the Discord
  surface and adds an operator-only tool on one machine. That is a deliberate finding, not an
  oversight.

## Out of Scope

- **Windows services, NSSM, or Task Scheduler.** They would remove the windows too and close the
  deferred autostart item in one move — but that item carries a coupled decision `03-deferred.md`
  says must be settled *when autostart is built*, and running as a service changes the session the
  agents run in, and therefore the session the **game servers** are spawned into. Headless dedicated
  servers very likely do not care; "very likely" plus Constitution IV is not shippable untested.
  Hiding a window is a spawn flag. Changing the session is a behaviour change to the thing that
  holds the worlds.
- **Automatic startup at boot.** Unchanged and still deferred, with its trigger intact.
- **Any terminal UI or web console.** A one-shot command is the minimum that answers the annoyance.
- **Any `--watch`, daemon, or background mode.** Forbidden by FR-016–FR-020, not merely deferred.
- **Off-box operation.** The console is local, like the agents it talks to. Widening that is the
  same change — arriving with authentication — that widening the agent's bind address would be.
- **Any change to the Discord surface**, the seam, or the agent.
