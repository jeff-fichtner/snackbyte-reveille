# Implementation Plan: Pause and resume the show from Discord

**Branch**: `003-media-control` | **Date**: 2026-08-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-media-control/spec.md`

## Summary

Add the first **non-game** controllable target: pause and resume an already-playing
video (VLC) from Discord, with playback state folded into the existing `/status`. A
media agent on the host drives VLC through its built-in HTTP web interface over
loopback — the same orchestrator→agent-over-HTTP, loopback-only seam the game agents
use, with an agent's URL still its identity and no target id in the contract. It adds
two media verbs to the seam (`POST /pause`, `POST /play`) and a media state vocabulary
(`playing` / `paused` / `stopped`), both **additive** — every game behaviour is
untouched. The video plays locally and only control is remote, so it introduces **no
network exposure**: no forwarded port, no firewall rule.

The technical approach: **extend the agent (adapter-by-config, from 002) to a second
adapter *kind***. A game adapter exposes `start`/`stop`; a media adapter exposes
`pause`/`resume`; both expose `getState`. The one agent binary deploys as a game agent
or a media agent by config. The orchestrator gains `/pause` and `/play` commands routed
to the media target, extends its `AGENTS` config with a per-target `kind`, and folds
every target — games and media alike — into one `/status` view.

## Technical Context

**Language/Version**: TypeScript on Node 24 (strips types; no build step; `erasableSyntaxOnly`). Unchanged from 001/002.

**Primary Dependencies**: none new. The agent keeps **zero runtime dependencies** — VLC's web interface is plain HTTP over loopback, so native `fetch` reaches it (no `node:https` needed, unlike Satisfactory). `discord.js` on the orchestrator, unchanged.

**Storage**: none. No persisted state (playback state is derived per request; config is read at boot).

**Testing**: `node:test`, tests beside source. Pure logic (config, command routing, status rendering, the media-state mapping) unit-tested; anything touching VLC validated against a **real** VLC install (M0 + quickstart), never mocked.

**Target Platform**: the agent runs on Windows (`watson`), tested there; the orchestrator against generic Linux (WSL2 today). Unchanged.

**Project Type**: monorepo, one package per component — `contract/`, `agent/`, `orchestrator/`. **No new package** (see Structure Decision).

**Performance Goals**: a pause/resume takes visible effect within **~2s** (SC-002); a command acknowledges within Discord's ~3s window (deferred reply, as today).

**Constraints**: loopback-only control interface (FR-010); no network exposure introduced; no content selection/browsing (FR-004); no streaming (FR-011); fail-loud config (FR-012); games unchanged (FR-013).

**Scale/Scope**: one media player (one VLC on `watson`). A second player is a second agent + one `AGENTS` entry (out of scope now).

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 — still passes.*

- **I. The Seam Is Inviolable** — ✅ with a recorded change. The media agent is reached
  over the network API (loopback HTTP), orchestrator→agent, never in-process; its URL is
  its identity and **no target id enters the contract**. It adds two verbs (`POST /pause`,
  `POST /play`) and a media state vocabulary — a **change to the seam**, so it is recorded
  in `DECISIONS.md` (Principle V) and is purely **additive**: every v2 field, verb, and
  behaviour is unchanged (games still speak `/start`/`/stop`/`/status`).
- **II. Components Are Welded; Only The Orchestrator Relocates** — ✅ as a **row, not a
  new kind**. The media agent is an **agent**: a small actuator on the host, called by the
  orchestrator over the seam, welded to the process it controls (here VLC instead of a
  game server). It is not a fourth kind of component. What widens is the *definition* of
  what an agent is welded to — "a game server process" → "a controllable process/target"
  — and the agent's verbs. That widening is the architecture-worthy part and is recorded
  in `DECISIONS.md`; it is also flagged as a candidate **constitution amendment** (a MINOR
  bump broadening Principle II's wording and the opening line, "control plane for game
  servers"). See Complexity Tracking.
- **III. Build The Minimum; Defer By Default** — ✅. Pause / resume / status only; no
  seek, volume, playlist, file browsing, or second player (all explicit non-goals). VLC's
  own web interface is reused rather than anything built. The scope-widening is driven by
  an actual, stated need, not speculation.
- **IV. A Stop That Cannot Be Graceful Is Not A Stop** — ✅ vacuously. Principle IV exists
  to protect **world data**; media playback has no durable state to lose — pausing or
  resuming a video risks nothing. There is no media "stop" that could trade data for
  convenience, so the durability obligation is satisfied by there being nothing at stake.
  (The game adapters' save-before-stop guarantee is untouched.)
- **V. Record The Decision Before Deleting The Reasoning** — ✅. Planned `DECISIONS.md`
  entries: the scope-widening (game servers → controllable targets), media as a second
  adapter kind with its own verbs, the additive seam extension (media verbs + media
  state), and VLC-over-its-HTTP-interface. Written before the widening is treated as
  settled anywhere else.

**Result: PASS.** One item — widening Principle II's "agent" definition — is justified in
Complexity Tracking rather than simplified away, because the alternative (a fourth
component kind, a "media actuator") is exactly what the acceptance test forbids.

## Project Structure

### Documentation (this feature)

```text
specs/003-media-control/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (agent-api.md v3)
└── tasks.md             # /speckit-tasks (not this command)
```

### Source Code (repository root)

```text
contract/src/index.ts        # + MediaState ('playing'|'paused'|'stopped'); AgentResponse.state widened. Additive.

agent/src/
├── adapter.ts               # + MediaAdapter interface (getState/pause/resume); createAdapter selects game OR media by config
├── config.ts                # + a media target (a third GAME/kind value, or a TARGET discriminant); fail-loud
├── vlc.ts                   # NEW · the only VLC-aware file · pause/resume/getState over VLC's HTTP web interface (loopback, Basic auth)
├── server.ts                # routes /pause /play for a media adapter, /start /stop for a game adapter; /status for both (off the mutex)
└── vlc.test.ts              # NEW · source-level guarantees for the media adapter (loopback-only, no content selection)

orchestrator/src/
├── config.ts                # AGENTS entries gain a `kind` (game|media); media has no publicPort
├── index.ts                 # register /pause /play; dispatch; /status queries every target
├── commands.ts              # describePause/describeResume; describeStatus folds media in (its own vocabulary)
└── *.test.ts                # routing + rendering for the media verbs and the folded status

scripts/reveille.ps1         # + the media agent in the control-plane start/stop set
```

**Structure Decision**: **No new package.** The media agent is the same *component kind*
as the game agent (Principle II), so it lives in the existing `agent/` package as a
second adapter kind, selected by config — the adapter-by-config pattern from 002 extended
from "which game" to "game vs media." `contract/` gains the media state and verbs
additively; `orchestrator/` gains the media commands and the folded status. A separate
`media-agent/` package was rejected: it would imply media is a distinct component,
contradicting "a row, not a new kind," and duplicate the agent's server/config scaffold.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| Widen Principle II's "agent" definition (game server → any controllable target on the host) | The feature controls VLC, which is not a game server; the media agent is nonetheless the same component shape (host-local actuator called over the seam) | Treating media as a **fourth component kind** ("media actuator") is precisely what the constitution's acceptance test forbids ("a new kind rather than a new row → drawn wrong"). Forcing playback onto `/start`//`/stop` was rejected in the spec: pause/resume is not a process lifecycle and the game-flavoured replies ("world saved") fit badly. So the honest, minimal move is to widen the existing kind by one row and record it. |
| Two adapter *kinds* in one agent (game verbs vs media verbs) | Game and media targets genuinely have different mutating verbs (`start`/`stop` vs `pause`/`resume`) | One universal verb set would either force media onto start/stop (rejected) or bloat the game agent with playback semantics it never uses. A per-adapter verb set, dispatched in the server, is the least thing that fits both; `/status` stays common to both. |
