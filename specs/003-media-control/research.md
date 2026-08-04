# Research: Pause and resume the show from Discord

**Feature**: `003-media-control` · **Date**: 2026-08-03

Phase 0 decisions. VLC-specific facts are grounded in VLC's documented HTTP interface
and are **confirmed against a real install in M0** (quickstart) before `vlc.ts` is
trusted — the same bar the game adapters had.

## R1 — Media is a second adapter *kind*, with its own verbs

**Decision.** Add a `MediaAdapter` interface — `getState()`, `pause()`, `resume()` —
beside the existing `GameAdapter` (`getState`/`start`/`stop`). `createAdapter` selects a
game adapter or a media adapter by config. The agent's server exposes an adapter's
mutating verbs plus the common `GET /status`.

**Rationale.** Playback control is a genuinely different shape from a process lifecycle:
`start` spawns and `stop` saves-then-shuts-down, whereas `pause`/`resume` toggle a
running player and risk no durable state. Forcing media onto `/start`//`/stop` was
rejected in the spec (the game-flavoured replies and the "stop = pause" mismatch read
badly). A distinct interface with distinct verbs is honest and keeps each adapter's
surface minimal.

**Alternatives considered.** (a) Reuse `GameAdapter` and map start→resume, stop→pause —
rejected: semantic mismatch and game-specific reply wording. (b) A separate `media-agent`
package — rejected: implies a new component kind (Principle II) and duplicates the
server/config scaffold; the media agent is the *same* component kind as a game agent.

## R2 — VLC over its built-in HTTP web interface (loopback, Basic auth)

**Decision.** `vlc.ts` drives VLC through its **web interface** at
`http://127.0.0.1:<port>/requests/status.json`, with HTTP **Basic auth** (empty
username, the configured password) over **plain HTTP on loopback** — so native `fetch`
reaches it and the agent keeps **zero runtime dependencies** (no `node:https`, unlike
Satisfactory's self-signed TLS).

- **pause** → `GET …/status.json?command=pl_forcepause` (explicit pause, not the
  `pl_pause` toggle — predictable).
- **resume** → `GET …/status.json?command=pl_forceresume`.
- **getState** → `GET …/status.json`, read the `state` field: `playing` | `paused` |
  `stopped`.

**Rationale.** The web interface is VLC's supported programmatic control, needs no extra
software, and enables the whole feature with a one-time checkbox + password. The explicit
`pl_forcepause`/`pl_forceresume` commands make `/pause` and `/play` deterministic rather
than a toggle whose effect depends on current state.

**Alternatives considered.** VLC's RC/`--extraintf` telnet interface (more fiddly, less
documented for status); OS media-key simulation (fragile, focus-dependent); MPV/Kodi
(heavier setup, and the user asked for VLC). All rejected against "minimal setup, reliable
control."

**M0 confirms** (before `vlc.ts` is written): the exact command names and status `state`
values on this VLC build; the port (default `8080`); that Basic auth is empty-user +
password; that the interface binds loopback; and how `stopped` vs "nothing loaded"
present. Recorded in `m0-vlc.md`.

## R3 — `/status` folds every controlled target into one view (clarified)

**Decision.** The orchestrator's `/status` queries **every** configured target — game
agents and the media agent — via `GET /status`, and renders each in its own vocabulary
(games: `running`/`starting`/`stopped`; media: `playing`/`paused`/`stopped`), with
`unreachable` shown for any whose agent does not answer.

**Rationale.** The clarification chose one "what's happening on watson?" view over a
separate media-status command. Both agent kinds already answer the same `GET /status`
verb; only the state vocabulary differs, so folding is natural and reuses the existing
command. Extending it is additive — how games report is unchanged (FR-013).

**Alternatives considered.** A separate `/nowplaying` (rejected in clarify: splits the
view, adds a command); dropping media status (rejected: loses the "check without acting"
convenience).

## R4 — `AGENTS` gains a per-target `kind`; media has no public port

**Decision.** Each `AGENTS` entry gains `kind: "game" | "media"`. Game entries keep their
`publicPort` (for `/address`); a media entry has none (nothing to forward — control is
loopback and the video is local). Commands dispatch by kind: `/start`/`/stop`/`/address`
act on game targets, `/pause`/`/play` on media targets, `/status` on all.

**Rationale.** One config listing **all** controlled targets matches the widened framing
("control plane for targets on a host"). `kind` is the minimal discriminant the
orchestrator needs to know which verbs and which report apply; the name still lives only
here and on the Discord surface, never in the contract (Principle I).

## R5 — The contract extension is additive (media verbs + media state)

**Decision.** `contract/src/index.ts` gains `MediaState = 'playing' | 'paused' |
'stopped'`; `AgentResponse.state` widens to `ServerState | MediaState`. The seam gains
`POST /pause` and `POST /play`. Every v2 verb, field, and behaviour is unchanged.

**Rationale.** A media agent answering `GET /status` returns a media state; the
orchestrator renders whatever state string a target reports, so the client stays
target-agnostic. Additive so a 001/002 conformance check still passes.

## R6 — No network exposure is introduced

**Decision.** The feature adds no inbound port, no forward, and no firewall rule. VLC's
web interface is enabled loopback-only; the agent binds `127.0.0.1` as every agent does;
control rides Discord → orchestrator → media agent → VLC over loopback.

**Rationale.** Only *control* is remote; the video plays on the host's own output and is
never streamed. This is the load-bearing simplification over the game servers, whose game
ports had to be forwarded and whose admin APIs had to be firewalled. Here there is nothing
to expose. Verified from outside during quickstart (no new open port).

## R7 — The scope-widening is a recorded decision

**Decision.** Reveille widens from "an on-demand control plane for self-hosted game
servers" to "an on-demand control plane for controllable targets on a host." Media is a
new **row** under a widened "agent" (Principle II), not a new component kind. Recorded in
`DECISIONS.md`, with a candidate MINOR constitution amendment broadening Principle II and
the opening line.

**Rationale.** The constitution's acceptance test forbids a fourth component kind; the
honest classification of a host-local actuator called over the seam is "an agent." The
widening is the architecture-worthy part and must be written before it is treated as
settled (Principle V) — which is exactly why it is here and not assumed in code.
