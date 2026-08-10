# Feature Specification: A command that lists the commands you can run

**Feature Branch**: `006-command-listing`

**Created**: 2026-08-05

**Status**: Draft

**Input**: User description: "A command that lists the commands you can actually run, with a one-line description of each. Like `/status`, but for the command surface instead of target state. The listing must be INCAPABLE of disagreeing with reality — not hand-maintained help text, but a rendering of what was actually registered for that guild. Tenancy is the point: 'what you have access to' means this guild's surface. Read-only, contacts no agent, no seam change, no new configuration."

## Overview

Reveille answers "what is happening" with `/status`. It has no answer to **"what can I do here?"**

A member who joins a guild has to be told the commands by someone else, or guess. That gets worse
the more targets a guild has and the more commands each kind of target brings — the media player
alone went from two commands to six in 005.

This feature adds one command that replies with **every command available in that guild**, each
with a one-line description of what it does.

**The organizing principle is that the listing cannot lie.** It is not help text that happens to
describe the commands; it is a rendering of the command surface that was actually made available
to that guild. If a command is available here it appears; if it is not, it cannot appear. A
description that drifts from what the command really does is the failure this feature exists to
prevent, and the requirement is that drift be **structurally impossible**, not merely discouraged.

That requirement is not theoretical. This repository has already shipped that exact class of bug:
`agent/src/vlc.ts` carried a header declaring the file contained "no seek" — written when that was
true, still there after seek was implemented in it, and caught only by a later review. Prose kept
beside the thing it describes drifts from it. The only reliable fix is to stop keeping a second copy.

**Tenancy is the point, not an afterthought.** 004 made each guild a tenant scoped to its own
targets; 005's four media commands inherited that. Until now the guarantee has been enforced
silently — a member simply never sees another guild's commands. This command makes it **legible**:
the answer to "what can I do here" comes from the same per-guild surface that enforcement uses, so
it states the guarantee out loud rather than describing it a second time.

## Clarifications

### Session 2026-08-05

- Q: The game verbs are registered as subcommands per target, so `/start` alone is not runnable while `/start palworld` is. How should the listing render them? → A: **One line per runnable form.** The listing shows what a member can actually type, using each subcommand's own description — which already names the target — rather than the parent command's generic one.
- Q: How should the listing be ordered? → A: **Grouped by target kind** — game commands together, media commands together, and the commands that belong to neither last. The grouping derives from the `kind` already in configuration, so it adds no separately-maintained concept.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ask what you can do (Priority: P1) 🎯 MVP

Somebody new to the guild wants to control something and does not know what is available. They
type one command and get back a readable list: every command they can run here, each with a line
saying what it does. Nobody else has to explain it.

**Why this priority**: It is the entire feature. Everything else is a property of *this* list
being correct, so there is no version of the feature without it.

**Independent Test**: In a configured guild, issue the command and confirm the reply lists every
command that guild has, each with a description. Delivers the whole user-visible value with the
scoping and staleness guarantees untested.

**Acceptance Scenarios**:

1. **Given** a guild with game and media targets, **When** a member issues the listing command, **Then** the reply lists every runnable form available in that guild — `/start palworld` and `/start satisfactory` as separate entries, not a single `/start` — each with a one-line description, grouped by the kind of target it acts on.
2. **Given** a command that takes an optional amount, **When** it appears in the listing, **Then** the entry says the argument is optional and states the default that applies when it is omitted.
3. **Given** the listing command itself, **When** a member reads the reply, **Then** the listing command appears in its own list — a list that omits itself is incomplete.
4. **Given** any member of a configured guild, **When** they issue it, **Then** they receive the reply promptly and nothing is changed.
5. **Given** a member issues the listing in a shared channel, **When** the reply arrives, **Then** only that member can see it — nobody else in the channel is shown the listing.

---

### User Story 2 - The list is about MY guild (Priority: P2)

A member in a guild that has only a media player sees only the media commands. A member in a guild
that has only game servers never sees a media command. Neither learns anything about the other
guild's targets.

**Why this priority**: The isolation guarantee is 004's, not this feature's — but a listing is a
new way to *describe* the surface, and describing it wrongly would reveal what enforcement is
careful to hide. It rates below US1 because it protects an existing guarantee over new surface
rather than adding capability.

**Independent Test**: Configure one guild with only a media target and one with only game targets.
Confirm each listing contains exactly that guild's commands, and that neither reply names a target
its guild does not own.

**Acceptance Scenarios**:

1. **Given** a guild with no media target, **When** a member issues the listing, **Then** no media command appears in it.
2. **Given** a guild with no game target, **When** a member issues the listing, **Then** no game command appears in it.
3. **Given** two guilds with different targets, **When** a member of one issues the listing, **Then** the reply names none of the other guild's targets and reveals nothing about them.
4. **Given** an interaction from a guild that is not configured, **When** the listing command arrives, **Then** nothing is answered, exactly as for every other command (004 FR-006).

---

### User Story 3 - The list cannot go stale (Priority: P3)

A target is added to a guild, or removed. The next time anyone asks, the listing reflects it — and
nobody edited a description to make that happen.

**Why this priority**: It is the durability of US1's promise rather than the promise itself, so the
feature is useful the day it ships without it. But it is the reason this is worth building rather
than pinning a message in the channel, so it is not optional.

**Independent Test**: Add a target to a guild's configuration and restart; confirm the new commands
appear in the listing with no edit to any description text. Remove it; confirm they disappear the
same way.

**Acceptance Scenarios**:

1. **Given** a guild whose configuration gains a target, **When** a member issues the listing afterwards, **Then** that target's commands appear, with no description text having been edited.
2. **Given** a guild whose configuration loses a target, **When** a member issues the listing afterwards, **Then** that target's commands are gone.
3. **Given** any guild, **When** the listing is compared to what that guild can actually run, **Then** the two agree exactly — nothing listed that cannot be run, nothing runnable that is missing.

---

### Edge Cases

- **A guild with a single target.** The listing is simply short, and only the one group that has entries appears — no empty headings (FR-022). There is no special-cased "you only have one thing" message; fewer commands is not a different case.
- **A guild with many game targets.** Each game verb contributes one entry per target, so the listing grows with the number of targets rather than staying fixed. That is the cost of every entry being directly runnable (FR-002), and it is accepted: the count is bounded by the targets an operator actually configured.
- **A target's agent is unreachable, or the target itself is switched off.** The listing is **unaffected**. It describes what a member may *ask for*, not whether it would succeed right now — that is `/status`'s job, and conflating them would make this command depend on the network for no benefit.
- **The listing command issued from a guild that is not a configured tenant.** Ignored, exactly as every other command is; an unconfigured guild gets no answer at all.
- **A command whose argument behaves surprisingly.** The seek commands accept a negative amount, which reverses their direction (005 FR-005). The listing states each command's argument and default; it does not enumerate every edge of every command's behaviour. A listing that grew a paragraph per command would stop being a listing.

## Requirements *(mandatory)*

### Functional Requirements

#### The listing

- **FR-001**: The system MUST offer a single command that replies with the commands available in the guild it was issued from. Any member of a configured guild MUST be able to issue it, and it MUST take **no arguments** — asking what you can do cannot itself require knowing something.
- **FR-002**: Each entry MUST be a **runnable form** — the command exactly as a member would type it, including the target where a command names one (`/start palworld`, not `/start`) — together with a **one-line description** of what that form does. Where a command is offered per target, each target MUST get its own entry, using that form's own description rather than the parent command's generic one.
- **FR-003**: Where a command takes an argument, its entry MUST name the argument, say **whether it is optional**, and — when it is optional — state the **default** applied if it is omitted. (Every argument in the system is optional today; the requirement is written so that a future required one is described correctly rather than mislabelled.)
- **FR-004**: The listing MUST include **itself**.
- **FR-005**: The reply MUST be visible **only to the member who asked**. A listing posted for everyone is noise for everyone who did not ask.
- **FR-006**: The system MUST reply **promptly** (within a few seconds).
- **FR-022**: Entries MUST be **grouped by the kind of target** they act on — game commands together, media commands together, and commands belonging to neither (such as the status and listing commands) last. A group with no entries MUST NOT appear at all, so a guild with one kind of target sees one group and no empty heading. The grouping MUST derive from the target kind already present in configuration, introducing no separately-maintained categorisation (FR-008).

#### It cannot lie

- **FR-007**: The listing MUST agree **exactly** with the set of commands available in that guild: nothing appears that the member cannot run, and nothing the member can run is missing.
- **FR-008**: FR-007 MUST hold **by construction, not by maintenance**. The listing MUST be produced from the same definition of a guild's command surface that the system uses to make those commands available in the first place, so that a second, separately-maintained description of the commands does not exist and therefore cannot drift. Adding, removing, or renaming a command MUST change the listing with **no edit to any description text**.
- **FR-009**: The listing MUST reflect a change to a guild's targets without any code change — configuration alone (004 FR-005).

#### Scoping, and what it must not say

- **FR-010**: The listing MUST be scoped to the guild it was issued from: only that guild's commands, exactly as registration and routing already are (004 FR-002, FR-003).
- **FR-011**: The listing MUST NOT reveal anything about another guild — not its targets, their names, their addresses, nor how many exist.
- **FR-012**: The listing MUST name a guild's **own targets** where a command names one — this follows from FR-002, since a game command's runnable form includes its target. Naming a target is not naming content, and `/status` already does it (003).
- **FR-013**: The listing MUST NOT describe **content** — no item, file, playlist entry, position, or duration — preserving the media bans unchanged (003 FR-004 as narrowed by 005, DECISIONS 022).

#### Fitting the existing system

- **FR-014**: The command MUST be **read-only** and MUST change nothing.
- **FR-015**: The command MUST NOT contact any target or its agent. It describes the command surface, not target state, so it MUST NOT depend on anything being reachable and MUST NOT be affected by anything being unreachable.
- **FR-016**: The system MUST NEVER issue this command on its own — no timers, no automatic posting. Every listing is a direct human request.
- **FR-017**: There MUST be **no change to the orchestrator↔agent contract**. No new verb, no new field, and the agent MUST NOT be opened (Constitution I).
- **FR-018**: The feature MUST add **no new configuration** — no environment variable, and no new field in an existing one.
- **FR-019**: The feature MUST add **no network exposure** — no new port, forward, or firewall change.
- **FR-020**: Existing behaviour MUST be unchanged. Every command that exists today MUST behave exactly as it does now.
- **FR-021**: The public homepage MUST be updated to reflect the new command, as a planned deliverable of this feature (Constitution, Development Workflow).

### Key Entities

- **Command entry** (transient, per interaction): one command available in the asking guild, with its one-line description and, where it takes one, its optional argument and default. Derived at request time from that guild's command surface; never stored.
- **Guild command surface** (existing, unchanged): the set of commands a tenant's targets produce. This feature **reads** it, and adds one command to it. It introduces no new concept.

## Success Criteria *(mandatory)*

- **SC-001**: A member can discover every command available to them in **one command with no arguments**, receiving the reply within a few seconds, **100%** of the time.
- **SC-002**: **Exact agreement** — across every configured guild, the number of commands listed that the guild cannot run is **0**, and the number it can run that are missing from the listing is **0**.
- **SC-003**: **Zero maintenance drift** — adding or removing a target changes the listing correctly with **0** edits to description text.
- **SC-004**: A guild with no media target is shown **0** media commands; a guild with no game target is shown **0** game commands.
- **SC-005**: **Zero cross-guild leakage** — the number of references to another guild's targets, across every listing, is **0**.
> **CORRECTED by 007 (DECISIONS 024).** This inherited 005's overshoot. It stands for the
> **listing** — `/help` describes *availability*, and naming content there would still be
> wrong — but it must not be read as forbidding a *reply* from reporting what the player
> says is loaded. That is permitted since 007.
- **SC-006**: **Zero content leakage** — the number of item, file, playlist, position, or duration references in any listing is **0**.
- **SC-007**: The listing is produced with **0** requests to any agent, and is identical whether targets are running, stopped, or unreachable.
- **SC-008**: **Zero regressions** — every command that existed before this feature behaves identically, verified by the existing checks continuing to pass unchanged.
- **SC-009**: The seam is untouched — **0** changes to the contract and **0** to the agent.
- **SC-010**: The public homepage describes the new command, and describes no capability the system does not have.
- **SC-011**: **The feature adds nothing and does nothing unasked** — **0** new environment variables or configuration fields, **0** new ports, forwards, or firewall rules, and **0** listings produced that no member requested.
- **SC-012**: **Every entry is directly usable** — a member can copy any line from the listing, type it, and have it run: **0** entries that are not a complete runnable form. A guild with N game targets shows N entries per game verb, and **0** empty groups appear.

## Assumptions

- **The command is named `/help`.** Chosen over `/commands` because it is the word people try first, and over anything longer because every command in this system is bare and single-word. `/commands` is the closest alternative and would serve equally well; the name is the only thing separating them.
- **The reply is ephemeral** (visible only to the asker). Chosen over a public reply because a full listing posted to a shared channel is noise for everyone who did not ask. The information is not sensitive — any member can get the same listing by asking — so this is a courtesy, not a control.
- **Discord's own command picker already shows these commands, and this is still worth building.** Typing `/` lists them with their descriptions, scoped to the guild. This command earns its place by being a durable, readable message rather than a transient overlay — legible on a phone, quotable, pinnable — and by holding what a per-command picker description cannot. It is not a replacement for the picker and does not try to be.
- **One line per entry, not a manual.** The listing says what each entry does, not how it behaves at every edge. Members learn the edges from the commands' own honest replies, which 003 and 005 already require. (Per *entry*, not per command — a command offered per target contributes one entry each, per FR-002.)
- **The listing describes availability, never readiness.** That a command is listed means a member may ask for it, not that it would succeed right now. `/status` answers readiness; keeping the two apart is what lets this command touch the network not at all.
- **The guild remains the trust boundary.** Any member of a configured guild may issue it; there are no roles or per-user permissions, exactly as for every command since 001.

## Out of Scope

- **Any change to what the commands do.** This feature describes the surface; it does not alter it.
- **Per-command detailed help** (`/help forward`), examples, or usage walkthroughs. If one-line descriptions prove insufficient, that is a separate feature with evidence behind it.
- **Reporting target state or readiness** — that is `/status`, and duplicating it here would put this command back on the network.
- **Describing commands the guild does not have**, including as a "you could also configure…" hint. A listing of what you cannot do is not what was asked for, and it would leak the shape of other tenants.
- **Any change to the seam, the agent, the contract, or configuration.**
