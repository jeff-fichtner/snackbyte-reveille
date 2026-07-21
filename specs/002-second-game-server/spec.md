# Feature Specification: A second controlled game server

**Feature Branch**: `main` (no branch hook registered; spec directory is `002-second-game-server`)

**Created**: 2026-07-21

**Status**: Draft

**Input**: User description: "Control a second game server — a Satisfactory dedicated server — from the same Discord bot that already controls Palworld, so either player can start and stop either game from any device. Today `/start` and `/stop` act on the single Palworld server. With two servers the commands must name which one. Constraints that carry over unchanged from 001 and must not be weakened: a stop saves before it exits and fails rather than force-killing; the system never stops a server on its own; 'started' means the launch was issued without error; no authentication or authorization of any kind; no state that outlives a restart; each agent binds loopback only. Architecturally this must be a new row, not a new kind of thing — the contract does not change, an agent's base URL is its identity, and a second controlled server is a second agent at a second address in configuration. The agent today hardcodes the Palworld adapter; it needs the adapter selected by configuration so one binary can be deployed twice. Satisfactory's dedicated server exposes an official HTTPS API on loopback covering server state, save management and shutdown, structurally the same shape the Palworld adapter already uses. Success is: either player types the start command naming Satisfactory, from a phone, and joins that server; types the stop command and the world is saved and the server exits; and doing so does not change how Palworld behaves in any way. Adding a third game later must remain the same shape of work. Also wanted: a status slash command."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start and stop a named server (Priority: P1)

Two game servers now exist. A player types the start command, chooses which
server, and that one comes up — the other is untouched. When they are done they
stop that server and the world is saved.

**Why this priority**: This is the feature. Without naming a target, a second
server cannot be reached at all, and the existing commands become ambiguous the
moment a second agent exists. It is also viable alone — status is a convenience,
whereas this is the capability.

**Independent Test**: With both servers stopped, issue start naming Satisfactory
from a phone; that server becomes joinable and Palworld remains stopped. Fully
testable without status existing.

**Acceptance Scenarios**:

1. **Given** both servers are stopped, **When** a player issues start naming Satisfactory, **Then** the Satisfactory server launches, Palworld remains stopped, and the reply names which server it acted on.
2. **Given** the Satisfactory server is running, **When** a player issues stop naming Satisfactory, **Then** the world is saved, that server exits, and Palworld is unaffected.
3. **Given** the Satisfactory server is running, **When** a player issues start naming Palworld, **Then** Palworld launches and Satisfactory keeps running — the two are independent.
4. **Given** a player issues a command, **When** they do not name a server, **Then** the system does not guess; it either presents the choice or refuses with the list of valid names.
5. **Given** one server's host cannot be reached, **When** a player issues a command naming it, **Then** the failure is reported for that server only and says nothing about the other.

---

### User Story 2 - Ask what is running (Priority: P2)

A player wants to know whether a server is up before walking away from their
desk, or wants to check without changing anything.

**Why this priority**: Second because every state it reports is already
obtainable by attempting a command — a start on a running server already answers
"is it up". It removes a class of pointless start attempts rather than enabling
anything new, and it is the first read-only command in the system.

**Independent Test**: With Palworld running and Satisfactory stopped, issue
status and confirm it reports each server's state correctly, without changing
either.

**Acceptance Scenarios**:

1. **Given** one server is running and one is stopped, **When** a player issues status, **Then** both are reported with their current state and neither is altered.
2. **Given** a server is mid-launch, **When** a player issues status, **Then** it is reported as starting, distinctly from running and from stopped.
3. **Given** a server's host cannot be reached, **When** a player issues status, **Then** that server is reported as unreachable and the others still report normally.
4. **Given** any server is running with players connected, **When** a player issues status, **Then** the reply says nothing about who or how many are connected.

---

---

### User Story 3 - Told when it is actually up (Priority: P3)

A player starts a server and walks away. Rather than guessing, or coming back to
check, the system tells them when it is genuinely ready to join — and tells them
if it never got there.

**Why this priority**: Third because start and stop are usable without it, and
because it is the first behaviour that *watches* rather than answers. It removes
the whole class of "is it up yet?" checking, and it closes the honesty gap left by
001: today a server that dies on launch is reported as started and nobody is ever
told otherwise.

**Independent Test**: With a server stopped, issue start and do nothing else.
Confirm a later message reports it became joinable, without another command being
issued. Testable with only one server, and with status not existing.

**Acceptance Scenarios**:

1. **Given** a player issues start and it launches, **When** the server becomes reachable, **Then** a follow-up message in the same channel reports it is up.
2. **Given** a player issues start and it launches, **When** the server has not become reachable within the bound, **Then** a follow-up reports that it could not be confirmed, and does **not** assert that it failed.
3. **Given** a start that was refused because the server was already running or starting, **When** the command completes, **Then** no follow-up is posted, because nothing was launched.
4. **Given** a start that launched, **When** the immediate reply is read, **Then** it reads as in progress rather than as complete.
5. **Given** two servers, **When** one is started, **Then** the follow-up names which server it concerns.

---

### Edge Cases

- **A player names a server that does not exist.** The system must reject it and say what the valid names are, rather than silently doing nothing or acting on a default.
- **The two servers behave differently on the same command.** One may refuse while the other succeeds. Each command targets exactly one server, so this cannot arise within a single command, and status must report each independently rather than collapsing to one verdict.
- **Both servers are started in quick succession.** They are independent and must not interfere; starting one must never delay, block, or affect the other's outcome.
- **A game's control interface responds but the game is not actually serving.** Same posture as 001: reporting "started" claims only that the launch was issued.
- **Two commands naming the same server arrive at once.** Must resolve to one clean winner, exactly as for a single server today.
- **A server is added to configuration but its host is not running an agent.** Must appear in the list of valid names and report unreachable, not vanish from the interface.
- **The operator adds a third server.** Must require no change to the seam and no new component type — configuration plus a deployment.
- **A launched server never becomes reachable.** The wait must end and say so honestly. "Could not confirm" is the truthful report; "it failed" is a claim the system cannot support, since the server may simply be slow.
- **The system restarts while waiting on a launch.** The wait is lost and no follow-up arrives. That is the honest consequence of holding no durable state, and is preferable to reporting from state that survived a restart and may be stale.
- **A player issues start twice and the second is refused.** Exactly one follow-up must arrive — for the launch that actually happened, not for the refusal.
- **A server is stopped by a player while its start is still being waited on.** The follow-up must not claim the server is up on the strength of an observation that has since been invalidated.

## Requirements *(mandatory)*

### Functional Requirements

**Carried forward from 001, unchanged, and applying to every controlled server:**

- **FR-001**: Any member of the Discord server MUST be able to issue every command. No authentication, authorization, allow-list, or role check of any kind.
- **FR-002**: Every command MUST be usable from any device with Discord, with no access to any host machine.
- **FR-003**: The system MUST acknowledge every command promptly, before the requested action has finished.
- **FR-004**: The system MUST report the outcome of every command. It MUST NOT claim a server is up or joinable **unless it has observed that to be true**. **Amended from 001**, which forbade the claim outright because the system had no way to know. FR-027 to FR-031 give it one; the prohibition still binds everywhere that observation has not happened, and in particular still binds the immediate reply to a start.
- **FR-005**: A stop MUST save the world before the process exits.
- **FR-006**: A stop that cannot guarantee the save MUST leave the server running and report the failure. The system MUST NOT force-terminate a process to satisfy a stop request.
- **FR-007**: A stop MUST fail within a bounded time rather than waiting indefinitely.
- **FR-008**: Issuing start against a server that is running or starting MUST NOT launch a second instance of it.
- **FR-009**: The system MUST distinguish "the host could not be reached" from "the command failed on the host".
- **FR-010**: The system MUST NOT stop any server on its own for any reason.
- **FR-011**: The system MUST NOT track, store, or act on which players are connected to any server. **This explicitly governs status: it reports server state only, never a player list or count.**
- **FR-012**: The system MUST NOT retain state that outlives a restart of its own components.
- **FR-013**: Every agent's control interface MUST NOT be reachable from the public internet, and MUST bind only to the local machine while its caller runs on that machine.
- **FR-014**: Every game server's administrative interfaces MUST NOT be reachable from the public internet, and MUST NOT be left on default or empty credentials.
- **FR-015**: Only the ports players connect through may be reachable from the internet. Each controlled server adds exactly one, and no control interface, admin console, or management API may be opened.
- **FR-016**: The system MUST NOT require the operator to disable a firewall, use a DMZ, or remove existing protection.
- **FR-017**: A stop issued while a server is still starting MUST be refused, reporting that a start is in progress, and MUST NOT terminate the launching process or queue the stop.

**New in this feature:**

- **FR-018**: Every command that acts on a server MUST identify which server it acted on, both in what the player issues and in what the system reports back.
- **FR-019**: The system MUST NOT act on a default server when a command does not name one. It MUST either present the choice or refuse, listing the valid names.
- **FR-020**: A command naming an unknown server MUST be refused with the list of valid names, and MUST NOT act on any server.
- **FR-021**: Commands against one server MUST have no effect on any other server, including its state, its availability, and the outcome reported for it.
- **FR-022**: Players MUST be able to ask for the current state of the controlled servers without changing any of them.
- **FR-023**: Status MUST report each server independently, including that a server is unreachable, and MUST NOT collapse several servers into a single verdict.
- **FR-024**: Adding a further controlled server MUST require only configuration and a deployment — no change to the contract between components, and no new kind of component.
- **FR-025**: Knowledge of which game a server runs MUST remain confined to that game's adapter. No other part of the system may branch on which game it is.
- **FR-026**: A server whose host is unreachable MUST still appear as a valid name and be reported as unreachable, rather than being omitted.

**Telling the player when it is up:**

- **FR-027**: The immediate reply to a start that launched MUST read as *in progress*, not as complete. It still MUST NOT claim the server is up (FR-004).
- **FR-028**: Once the system has determined whether a launched server became reachable, it MUST post that outcome as a **new message in the same channel** as the command, not as a silent edit — a player who walked away must be notified.
- **FR-029**: The wait MUST be bounded. On exceeding the bound the system MUST report that it **could not confirm** the server came up, and MUST NOT assert that the launch failed — it does not know that.
- **FR-030**: A follow-up MUST be posted only where something was actually launched. A refused start, which launched nothing, MUST NOT produce one.
- **FR-031**: A follow-up MUST identify which server it concerns, and MUST NOT require the player to have kept the original reply in view to make sense of it.
- **FR-032**: A pending wait MUST NOT be persisted or resumed. If the system restarts mid-wait, no follow-up is posted for that start — consistent with FR-012, and preferable to a claim made from state the system cannot trust.

### Key Entities

- **Controlled server**: a game server the system can start and stop. It has a name players use to refer to it, an address the orchestrator reaches it at, and a state. Its name exists only in the orchestrator's configuration and in the Discord surface — never in the contract between components.
- **Game adapter**: the one place that knows how a particular game is launched, saved, and shut down. Exactly one is active per agent, chosen by that agent's configuration.
- **Command**: a start, stop, or status request from a player. Start and stop name exactly one server; status names none and reports all.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Either player can start either server from a phone and be connected and playing on it within 2 minutes of issuing the command, without touching any host machine.
- **SC-002**: 100% of stops issued through the system preserve that server's world, including progress made in the minutes immediately before the stop. Zero tolerance.
- **SC-003**: Issuing any command against one server leaves every other server's state unchanged, in 100% of cases.
- **SC-004**: Every command receives an acknowledgement within 3 seconds and a final outcome message naming the server it acted on.
- **SC-005**: A player can determine the state of every controlled server with a single command, without changing any of them.
- **SC-006**: The system never stops a server that a player did not ask to stop — zero unattended shutdowns, across all servers.
- **SC-007**: A port scan of the host's public address shows exactly one open port per controlled server — the port players connect through. No control interface or admin console is reachable from outside the home network.
- **SC-008**: Adding a third controlled server requires no change to the contract between components and introduces no new component type — demonstrated by describing the exact steps without writing code.
- **SC-009**: Behaviour of the existing Palworld server is unchanged by this feature — every 001 acceptance scenario still passes.
- **SC-010**: A player who issues start and then puts their phone away learns whether the server became joinable without issuing another command, in 100% of launches.
- **SC-011**: The system never states that a server is up without having observed it, and never states that a launch failed when it only failed to confirm — checked against both the success and timeout paths.

## Assumptions

- **The two servers run on the same machine at this milestone.** Nothing in the design may depend on that; it is where they happen to be, and each is reached at its own address regardless.
- **Each controlled server has its own agent.** An agent is welded to one game server process, so two servers means two agents at two addresses, not one agent that switches.
- **The set of controlled servers is operator configuration, not a runtime concern.** Servers are added by editing configuration and deploying, and the system does not discover them.
- **Which save or session a server loads is out of scope.** That is manual operator work on the game server, documented separately.
- **Status reports what can be observed at the moment of asking**, and nothing is remembered between requests — the same posture as every other command.
- **Satisfactory's control interface is reached over loopback with a self-signed certificate**, which the adapter must accept for that host only. This is an implementation consequence of the game's design, not a relaxation of FR-013 or FR-014.
- **The immediate reply to a start still means only that the launch was issued.** No adapter verifies anything at launch time. What changes is that the system now *follows up* — the claim that a server is up is made later, by the orchestrator, on the strength of an observation, and never at launch.
- **Waiting is done by asking repeatedly, not by being told.** No game server notifies anything, so the system polls until it sees the server reachable or gives up. Nothing about that wait is remembered if the system restarts.
- **A follow-up is a new message rather than an edit**, because a silent edit does not notify, and the entire point is to reach a player who walked away.
- **The Discord server remains private and trusted**, which is what continues to make "no authorization" acceptable across any number of controlled servers.
- **The naming of servers is for humans**, and does not enter the contract. Renaming a server is a configuration change with no effect on any component boundary.
