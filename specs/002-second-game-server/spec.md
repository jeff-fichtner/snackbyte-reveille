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

### Edge Cases

- **A player names a server that does not exist.** The system must reject it and say what the valid names are, rather than silently doing nothing or acting on a default.
- **The two servers behave differently on the same command.** One may refuse while the other succeeds. Each command targets exactly one server, so this cannot arise within a single command, and status must report each independently rather than collapsing to one verdict.
- **Both servers are started in quick succession.** They are independent and must not interfere; starting one must never delay, block, or affect the other's outcome.
- **A game's control interface responds but the game is not actually serving.** Same posture as 001: reporting "started" claims only that the launch was issued.
- **Two commands naming the same server arrive at once.** Must resolve to one clean winner, exactly as for a single server today.
- **A server is added to configuration but its host is not running an agent.** Must appear in the list of valid names and report unreachable, not vanish from the interface.
- **The operator adds a third server.** Must require no change to the seam and no new component type — configuration plus a deployment.

## Requirements *(mandatory)*

### Functional Requirements

**Carried forward from 001, unchanged, and applying to every controlled server:**

- **FR-001**: Any member of the Discord server MUST be able to issue every command. No authentication, authorization, allow-list, or role check of any kind.
- **FR-002**: Every command MUST be usable from any device with Discord, with no access to any host machine.
- **FR-003**: The system MUST acknowledge every command promptly, before the requested action has finished.
- **FR-004**: The system MUST report the outcome of every command, and MUST NOT claim to know that a server stayed up or became joinable.
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

## Assumptions

- **The two servers run on the same machine at this milestone.** Nothing in the design may depend on that; it is where they happen to be, and each is reached at its own address regardless.
- **Each controlled server has its own agent.** An agent is welded to one game server process, so two servers means two agents at two addresses, not one agent that switches.
- **The set of controlled servers is operator configuration, not a runtime concern.** Servers are added by editing configuration and deploying, and the system does not discover them.
- **Which save or session a server loads is out of scope.** That is manual operator work on the game server, documented separately.
- **Status reports what can be observed at the moment of asking**, and nothing is remembered between requests — the same posture as every other command.
- **Satisfactory's control interface is reached over loopback with a self-signed certificate**, which the adapter must accept for that host only. This is an implementation consequence of the game's design, not a relaxation of FR-013 or FR-014.
- **"Started" continues to mean the launch was issued without error.** No server's adapter verifies that the process survived or became joinable.
- **The Discord server remains private and trusted**, which is what continues to make "no authorization" acceptable across any number of controlled servers.
- **The naming of servers is for humans**, and does not enter the contract. Renaming a server is a configuration change with no effect on any component boundary.
