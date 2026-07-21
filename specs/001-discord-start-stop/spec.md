# Feature Specification: Start and stop the game server from Discord

**Feature Branch**: `main` (no branch hook registered; spec directory is `001-discord-start-stop`)

**Created**: 2026-07-20

**Status**: Draft

**Input**: User description: "Either of two people can turn the Palworld dedicated game server on or off from Discord, from any device. Two slash commands: /start and /stop. No authentication or authorization of any kind. No auto-stop, no presence tracking, no grace timers, no scheduling, no wake-on-LAN. A human decides when to start and when to stop; that is the whole policy. The server runs on an always-on Windows gaming PC. Stopping must be graceful — the world save must survive every stop, and a stop that cannot save must fail and report rather than kill the process. Success is: either person types /start on their phone and joins the server about ninety seconds later, and types /stop when done."

## Clarifications

### Session 2026-07-21

- Q: What should happen when a stop arrives while the server is still starting? → A: Refuse it — report "still starting, try again in a moment" and do nothing.
- Q: How does the system know a start actually succeeded? → A: It doesn't verify. Spawn and report; success means the launch call didn't error. Extreme happy path is the explicit posture for this milestone.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start the server from Discord (Priority: P1)

Either player, from any device, types a command in Discord and the game server
comes up. They wait, join, and play. Nobody touches the host machine.

**Why this priority**: This is the entire point of the feature. Without it the
players are physically tied to the PC, and one of them does not have access to it
at all. It is also viable alone — a server that can be started remotely but must
be stopped at the machine is already a working system, because the host is
always on and an idle server costs only electricity.

**Independent Test**: With the game server not running, issue the start command
from a phone. The server becomes joinable and both players can connect. Fully
testable without any stop capability existing.

**Acceptance Scenarios**:

1. **Given** the game server is not running, **When** a player issues the start command, **Then** the system acknowledges immediately, launches the server, and reports started once the launch call returns without error.
2. **Given** the game server is already running, **When** a player issues the start command, **Then** the system reports that it is already running and does not launch a second copy.
3. **Given** the host machine cannot be reached, **When** a player issues the start command, **Then** the system reports that it could not reach the host rather than failing silently or appearing to succeed.

---

### User Story 2 - Stop the server from Discord, without losing the world (Priority: P2)

When they are done playing, either player issues a stop command. The world is
saved and the server shuts down. Nobody has to remember to do it at the machine,
and nobody has to trust that "stopped" meant "saved".

**Why this priority**: Second because a human can always stop the server at the
machine, so P1 alone is usable. But it is what makes "not running 24/7" real
without anyone walking over to the PC, and it carries the feature's single
hardest guarantee — that stopping never costs progress.

**Independent Test**: With the server running and a world in a known state, issue
the stop command. Confirm the process has exited and that restarting brings back
the world including everything that happened right before the stop.

**Acceptance Scenarios**:

1. **Given** the server is running, **When** a player issues the stop command, **Then** the world is saved, the process exits, and the system confirms it stopped.
2. **Given** the server is running and the save cannot be completed, **When** a player issues the stop command, **Then** the server is left running and the system reports that it could not stop safely.
3. **Given** the server is not running, **When** a player issues the stop command, **Then** the system reports that it is already stopped and does nothing.
4. **Given** the server is still starting, **When** a player issues the stop command, **Then** the system refuses, reports that a start is in progress, and leaves the launching process untouched.
5. **Given** a player is connected, **When** the other player issues the stop command, **Then** the stop proceeds — the system has no knowledge of who is connected.

---

### Edge Cases

- **The start command is issued twice in quick succession**, or while the server is still coming up. The second must not launch a second copy or corrupt the first.
- **The game server fails to launch** — bad configuration, missing files, port in use. **Accepted and not handled.** The launch call succeeds, the process dies moments later, and the system reports "started". The player discovers it by failing to connect. Detecting this is deliberately deferred (see Assumptions); the cost of being wrong is one confused attempt to join, and the two players can look at the machine.
- **The host machine is off, asleep, or the controlling software is not running.** Indistinguishable from each other at this stage; all report as "cannot reach the host".
- **A stop is issued while the server is still starting up.** Refused — see FR-017. The player is told a start is in progress and retries once it is up.
- **The save step hangs** rather than failing outright. A stop that never returns is as bad as one that loses data, so there must be a bound on how long it waits.
- **Both players issue commands at the same time.** The outcome must be one of the two commands winning cleanly, never a half-executed pair.
- **Someone outside the Discord server discovers the host's public address.** They must find nothing actionable there beyond the game itself — no control interface, no admin console.
- **The operator is tempted to forward a second port** to make something work. This must never be the fix, and the design must not create a situation where it appears to be.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Any member of the Discord server MUST be able to issue the start and stop commands. There is no authentication, authorization, allow-list, or role check of any kind.
- **FR-002**: Both commands MUST be usable from any device with Discord, including a phone, with no access to the host machine.
- **FR-003**: The system MUST acknowledge every command promptly, before the requested action has finished, so the player knows the request was received.
- **FR-004**: The system MUST report the outcome of every command — started, stopped, already in that state, or failed with the reason. "Started" reports only that the launch was issued without error; the system MUST NOT claim to know that the server stayed up or became joinable.
- **FR-005**: A stop MUST save the world before the process exits.
- **FR-006**: A stop that cannot guarantee the save MUST leave the server running and report the failure. The system MUST NOT force-terminate the process to satisfy a stop request.
- **FR-007**: A stop request MUST fail within a bounded time rather than waiting indefinitely for a save that is not completing.
- **FR-008**: Issuing start while the server is running or starting MUST NOT launch a second instance.
- **FR-009**: The system MUST distinguish "the host could not be reached" from "the command failed on the host", and say which.
- **FR-010**: The system MUST NOT stop the server on its own for any reason. Every stop is the result of a human command.
- **FR-011**: The system MUST NOT track, store, or act on which players are connected.
- **FR-012**: The system MUST NOT retain any state that outlives a restart of its own components. Everything it reports is derived from asking the host at the time of the request.
- **FR-017**: A stop issued while the server is still starting MUST be refused, reporting that a start is in progress and to retry shortly. The system MUST NOT terminate a launching process, and MUST NOT queue the stop for later execution — an unattended shutdown that a player did not directly command is forbidden by FR-010.

> FR-017 sits above FR-013–FR-016 rather than after them: it was added by the
> 2026-07-21 clarification session and belongs with the behavioural requirements,
> while FR-013–FR-016 were already grouped under Exposure. The numbers are kept
> as issued — they are referenced across `tasks.md`, `quickstart.md`, and the
> contract, and renumbering would break those references for no gain.

#### Exposure — what "no security" does and does not mean

"No authorization" applies to *who may issue commands*, not to *what is reachable
from the internet*. The control interface is remote process control on a home
machine; the following are requirements, not hardening extras.

- **FR-013**: The control interface MUST NOT be reachable from the public internet. It MUST bind only to the local machine at this stage, since the component calling it runs on that same machine.
- **FR-014**: The game server's administrative interfaces (remote console and any management API) MUST NOT be reachable from the public internet, and MUST NOT be left on default or empty credentials even when bound locally.
- **FR-015**: Exactly one inbound path from the internet is permitted: the port players connect to in order to play. Any other inbound exposure — control interface, admin console, management API, remote desktop — MUST NOT be opened for this feature.
- **FR-016**: The system MUST NOT require the operator to disable a firewall, place the host in a router DMZ, or otherwise remove existing protection in order to work.

### Key Entities

- **Game server**: the Palworld dedicated server process on the host machine. It is the thing acted upon; it is either running or not, and it owns the world save.
- **Command**: a start or stop request from a player, with an outcome that must be reported back to the channel it came from.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Either player can start the server from a phone and be connected and playing within 2 minutes of issuing the command, without touching the host machine.
- **SC-002**: 100% of stops issued through the system preserve the world, including progress made in the minutes immediately before the stop. Zero tolerance — a single lost session is a failure of the feature.
- **SC-003**: Neither player needs physical access, remote desktop, or any other channel to the host for routine starting and stopping.
- **SC-004**: Every command receives an acknowledgement within 3 seconds and a final outcome message. No command ever leaves the player guessing whether *the command* was received and acted on — which is distinct from whether the game server subsequently stayed up, something the system does not claim to know.
- **SC-005**: A second player joining the project needs no setup, credentials, or permission grant beyond being in the Discord server.
- **SC-006**: The system never stops the server that a player did not ask to stop — zero unattended shutdowns.
- **SC-007**: A port scan of the host's public address shows exactly one open port attributable to this feature — the one players connect through. The control interface and admin consoles are not reachable from outside the home network.

## Assumptions

- **Reporting "started" means the launch call did not error — nothing more.** The system does not wait, does not confirm the process survived, and does not check whether the world loaded or the server is joinable. A server that dies immediately after launching is reported as started.

  **This is a deliberate happy-path posture for this milestone, not an oversight.** It is the cheapest thing that works, and the cost of being wrong is one failed attempt to join on a machine both players can look at. Verification — waiting to confirm the process is alive, polling for joinability, or asking the server itself — is the obvious next increment once it actually annoys someone.
- **Stopping while someone is connected is allowed and unremarkable.** The system has no knowledge of connected players by design, so it cannot warn and will not try. The two players coordinate socially.
- **The host machine is always on** for this feature. Waking a sleeping machine is explicitly out of scope.
- **A single game server on a single host.** One world, one process. Multiple servers, multiple machines, and other games are out of scope here, though the design must not preclude them.
- **The Discord server is private and trusted.** This is what makes "no authorization" acceptable: the only people who can issue commands are the people already invited, and the worst outcome of misuse is that a game server stops.
- **Trust is inherited from the network boundary, not from the control interface.** The control interface has no authentication of its own — it doesn't need any while it is only reachable from the machine it runs on. That trade is only valid while FR-013 holds. **The moment the calling component moves to another machine, this assumption expires and authentication becomes a prerequisite, not an enhancement.**
- **Players connecting from outside the home network requires one forwarded port**, which is inherent to self-hosting a game server and is the only exposure being accepted. Everything else stays inside the network.
- **Failure messages are for two people who know the system**, not for a general audience. Plain and honest beats polished.
- **The controlling software is running on the host** whenever the machine is on. Getting it to start automatically is an operational concern, not a requirement of this feature.
