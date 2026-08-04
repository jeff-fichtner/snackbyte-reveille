# Feature Specification: Pause and resume the show from Discord

**Feature Branch**: `003-media-control`

**Created**: 2026-08-03

**Status**: Draft

**Input**: User description: "A really simple start/stop (pause/resume) control for an already-running video player (VLC) from Discord — so when one person steps out, the other (or the one who left) can pause and resume the show from their phone. No file browsing, no library; the operator opens the show themselves and Discord only toggles playback. Controlled over a loopback control interface, same orchestrator↔agent pattern as the game servers, no network exposure."

## Overview

Reveille already turns game servers on and off from Discord. This adds the first
**non-game** target: pause and resume a video that is **already playing** on the host.
Two people watch a show together on the home machine; when one runs to the store, the
other — or the one who left, remotely — can pause it and pick it back up from Discord,
without a keyboard or getting up.

It is deliberately the smallest possible thing. The operator still opens the player and
the show exactly as they do today. Discord never chooses, opens, browses, or lists
content — it only toggles playback of whatever is already loaded. Unlike the game
servers, the video plays **locally** and only the *control* is remote, so the feature
adds **no network exposure at all** — no forwarded port, no firewall rule.

This widens what Reveille is: from "an on-demand control plane for self-hosted game
servers" to "an on-demand control plane for controllable targets on a host." Playback
control (pause/resume) is genuinely a different shape from a process lifecycle
(start = spawn, stop = save-and-shutdown), so it gets its own verbs and its own adapter
— while reusing the whole orchestrator↔agent seam, the deployment model, and the
no-auth-because-loopback trade.

## Clarifications

### Session 2026-08-03

- Q: `/status` already exists and reports the game servers — how should the media
  player's playback state be shown? → A: **Fold it into the existing `/status`.** One
  command reports every controlled target on the host — each game server in its state
  (running/starting/stopped/unreachable) and the media player in its state
  (playing/paused/stopped/unreachable). Media gets **no** separate status command;
  `/status` becomes "what's happening on watson," across games and media alike.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pause and resume the show (Priority: P1) 🎯 MVP

The show is playing on the home machine. One person steps away. From Discord — on a
phone — either person pauses it, and later resumes it, without touching the machine.

**Why this priority**: This is the entire feature. Everything else is a convenience on
top of being able to pause and pick a show back up remotely.

**Independent Test**: With a video playing on the host, sending the pause command from
Discord visibly pauses it within a couple of seconds; sending the resume command
resumes it from the same spot. No content was chosen or changed by Discord.

**Acceptance Scenarios**:

1. **Given** a video is playing, **When** any guild member sends the pause command, **Then** the video pauses on the host and the reply confirms it is paused.
2. **Given** the video is paused, **When** any guild member sends the resume command, **Then** the video resumes from where it stopped and the reply confirms it is playing.
3. **Given** the video is already paused, **When** someone sends the pause command again, **Then** the reply says it was already paused — a harmless no-op, not an error.
4. **Given** the girlfriend is at home and the operator is at the store, **When** either sends a command, **Then** both work identically — any member of the private guild may control playback, with no role or auth step.

---

### User Story 2 - See it in /status (Priority: P2)

The media player's playback state shows up in the **same `/status`** that already
reports the game servers — so one command answers "what's happening on watson?" across
everything: which games are up, and whether the show is playing, paused, or off.

**Why this priority**: Useful, but the pause/resume pair delivers the value on its own;
seeing the state in `/status` is a convenience that avoids a "did that work?" guess and
gives one place to look. It folds into the existing command rather than adding a new one.

**Independent Test**: With the player in each of its states (playing, paused, nothing
loaded, player closed), `/status` lists the media player with that state — alongside the
game servers, each in its own vocabulary — and shows "unreachable" distinctly when the
player or its agent cannot be reached.

**Acceptance Scenarios**:

1. **Given** a video is playing, **When** a member runs `/status`, **Then** the media player is listed as *playing*, alongside the game servers.
2. **Given** the video is paused, **When** a member runs `/status`, **Then** the media player is listed as *paused*.
3. **Given** nothing is loaded, **When** a member runs `/status`, **Then** the media player is listed as *stopped* (nothing playing).
4. **Given** the player (or its agent) is not running, **When** a member runs `/status`, **Then** the media player is listed as *unreachable* — distinct from paused or stopped — and the game servers still report normally.

---

### Edge Cases

- **Nothing is loaded / the player is closed.** Pause and resume are refused honestly
  ("nothing is playing") rather than pretending to act; status reports stopped or
  unreachable as appropriate.
- **The player or its agent can't be reached.** Every command reports "could not reach
  it" — a transport fact, never confused with a playback state (the same distinction
  the game commands draw between unreachable and a host-side outcome).
- **Already in the target state.** Pause when already paused, or resume when already
  playing, is a reported no-op — nothing changed, and that is stated, not an error.
- **Two people command at once** (one home, one at the store). Playback control is not a
  check-then-act with anything at stake — there is no save to lose and no process to
  double-spawn — so concurrent commands simply resolve to one final state; last command
  wins, and the reply reflects the state after it.
- **The command is issued from outside the trusted guild.** Ignored, exactly as the game
  commands are — only the one configured private guild may control anything.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Any member of the private, trusted Discord guild MUST be able to **pause**
  the currently-playing video from Discord, with no role check and no authentication
  step — trust comes from the guild being private, the same posture as the game
  commands.
- **FR-002**: Any member MUST be able to **resume** (play) a paused video from Discord,
  which continues from where it was paused.
- **FR-003**: The media player's **current playback state** — *playing*, *paused*,
  *stopped* (nothing loaded / not playing), or *unreachable* (the player or its agent
  could not be reached) — MUST appear in the **existing `/status`** command, listed
  alongside the game servers (each controlled target in its own state vocabulary). There
  is no separate media-status command; extending `/status` is **additive** — how the game
  servers report is unchanged (FR-013).
- **FR-004**: The system MUST act **only on the content already loaded** in the player.
  It MUST NOT select, open, browse, list, search, or change what is playing, and MUST
  NOT expose any file, library, or playlist surface. Choosing the show is the operator's
  job, done outside Discord.
- **FR-005**: Every command MUST **acknowledge promptly** (within a few seconds) with a
  clear outcome — paused, resumed, the current state, or why it could not act — so a
  member is never left guessing whether it worked.
- **FR-006**: The system MUST **never change playback on its own**. Every pause or resume
  is a direct human command; there are no timers, no auto-pause, no presence tracking.
- **FR-007**: A command that asks for a state the player is already in (pause while
  paused, resume while playing) MUST be reported as a **no-op** — nothing changed — not
  as a failure.
- **FR-008**: When nothing is loaded or the player is not playing anything, pause and
  resume MUST be **refused honestly** ("nothing is playing") rather than reported as
  done.
- **FR-009**: "Could not reach the player" MUST be reported as **distinct** from any
  playback state — a member must never be told a show is paused when the machine or the
  player was simply unreachable.
- **FR-010**: The feature MUST add **no network exposure**. The control interface it uses
  MUST be reachable only over the host's loopback interface, never the network; the
  feature introduces no inbound port, no port forward, and no firewall change.
- **FR-011**: The system MUST **not stream, record, or relay** the video or audio
  anywhere. Only playback-control instructions travel; the content stays on the host and
  plays on the host's own output.
- **FR-012**: Any credential the control interface requires (e.g. a control password)
  MUST be **required configuration** that fails loudly at startup when missing or blank —
  no default, no silent fallback — consistent with the rest of the system.
- **FR-013**: Adding media control MUST **not change any existing game-server behavior**.
  The `/start`, `/stop`, and `/status` game commands and their guarantees (save-before-
  stop, never force-stop, no double-spawn) are unaffected.
- **FR-014**: Media control MUST **not introduce a target identifier into the
  orchestrator↔agent contract**. An agent's address remains its identity; the media
  player is one more agent at one more address in configuration, never a parameter in
  the seam.
- **FR-015**: The command to control the single configured player MUST be issuable in
  **the fewest possible steps** (a bare command with no required arguments), so it can be
  sent from a phone in seconds. If a second player is ever configured, the commands name
  their target the way the game commands do — but a single player needs no target
  argument.

### Key Entities

- **Media target** (configuration, orchestrator-side): the one player the system
  controls — a name and where its agent answers. Lives only in orchestrator config and
  the Discord surface, never in the contract. A second player is one more entry plus its
  agent (out of scope now).
- **Playback state** (derived per request, never stored): *playing*, *paused*, or
  *stopped*, asked of the player at the moment of the command. *Unreachable* is a
  transport fact layered on top, not a fourth playback state.
- **Command** (transient, per interaction): pause and resume, each a single Discord
  action on the one configured player. Playback state is read through the **shared
  `/status`** (folded in — not a media-specific command).

## Success Criteria *(mandatory)*

- **SC-001**: A guild member can pause the show from a phone in **two taps** — open the
  command and send it, with no argument to fill in.
- **SC-002**: A pause or resume takes visible effect on the host within **~2 seconds** of
  the command.
- **SC-003**: `/status` reflects the **real** media player state in every case (playing,
  paused, stopped), and lists it as *unreachable* — never a playback state — when the
  player or its agent cannot be reached.
- **SC-004**: The feature adds **zero inbound network exposure**: an external port scan of
  the host shows no new open port as a result of it.
- **SC-005**: The one-time operator setup (enable the player's local control interface and
  set its password) takes **under ~5 minutes** and never has to be repeated per show;
  after it, using the feature is just "open the show, press play, and control from
  Discord."
- **SC-006**: **Every** command yields a clear reply; no command leaves a member unsure
  whether it worked (matching the game commands' "never leave a player guessing").
- **SC-007**: All existing game-server behavior is **unchanged** — every 001/002 command
  still behaves exactly as before.

## Assumptions

- **The operator picks and starts the show**, in the player, outside Discord — exactly as
  today. Discord's role begins and ends with pause / resume / status of what is already
  loaded (FR-004).
- **The player exposes a local, loopback-only control interface** that a small agent on
  the host can drive (for VLC, its built-in web/HTTP interface, enabled once with a
  password). The specific mechanism is a planning detail; the spec assumes such a
  loopback control interface exists and is enabled during setup.
- **One media player for this feature** (one VLC on `watson`). Multiple simultaneous
  players, seeking/scrubbing, volume, and playlist management are explicitly out of
  scope; a second player, if ever wanted, is a second agent and a config entry, not a new
  kind of thing.
- **The private Discord guild is trusted**; any member may control playback with no auth,
  the same trade the game commands make — valid only because control never leaves the
  host over an authenticated boundary (it rides the existing Discord→orchestrator→agent
  path to a loopback interface).
- **The video is watched on the host's own screen/output.** No one watches remotely; only
  the control is remote, which is why there is nothing to stream and no exposure to add
  (FR-010, FR-011).
- **Reuses the existing orchestrator** (the one Discord bot) and the agent deployment
  model (a loopback-bound agent on the host, launched like the game agents).
- **This is the first non-game target Reveille controls.** The scope-widening from "game
  servers" to "controllable targets on a host," and the choice to give playback its own
  verbs and adapter rather than forcing it onto `/start` / `/stop`, is a decision this
  feature records (`DECISIONS.md`, Constitution V).
