# Data Model: Pause and resume the show from Discord

**There is still no persisted data.** Playback state is derived per request by asking
VLC now; configuration is read at boot. Nothing outlives a process (consistent with the
whole system).

---

## Controlled target (configuration, orchestrator-side)

The set of targets the system can act on — now spanning two **kinds**. Exists only in
orchestrator config (`AGENTS`) and the Discord surface, never in the contract.

| Field | What it is | Notes |
|---|---|---|
| name | the human label (`palworld`, `satisfactory`, `vlc`) | Discord subcommand + config only |
| baseUrl | where the orchestrator reaches that target's agent | an agent's URL is its identity (Principle I) |
| kind | `game` \| `media` | the minimal discriminant: which verbs and which report apply |
| publicPort | the port players connect to | **game only**; a media target has none (nothing to forward) |

**Invariant.** Adding the media player is one `AGENTS` entry (`kind: "media"`) plus
deploying its agent — a row, not a new kind. The name is not an identity in the contract.

---

## Media adapter (interface, agent-side)

The one boundary that knows VLC. Exactly one adapter is active per agent deployment,
chosen by config; a media deployment selects this one.

```
MediaAdapter
  getState() -> Promise<MediaState>     // playing | paused | stopped  (never error)
  pause()    -> Promise<void>           // force-pause the current item
  resume()   -> Promise<void>           // force-resume from where it paused
```

| Implementation | Target | Talks over |
|---|---|---|
| `vlc.ts` | VLC | plain-HTTP web interface, Basic auth, `fetch` (loopback) |

Beside the existing `GameAdapter` (`getState`/`start`/`stop`). **Invariant:** no code
outside the active adapter branches on the target — the server dispatches verbs by
adapter kind, everything else holds an adapter and never asks what it is.

---

## Playback state (derived, never stored)

Asked of VLC at the moment of the request; nothing remembered between calls.

| State | How it is derived |
|---|---|
| `playing` | VLC's web interface reports `state: playing` |
| `paused` | reports `state: paused` |
| `stopped` | reports `state: stopped` (nothing loaded / not playing) |

`unreachable` is layered on top by the orchestrator when the media agent (or VLC) cannot
be reached — a transport fact, **not** a fourth playback state (mirrors the game agents'
unreachable). There is no `error` playback state.

```
playing ──pause──► paused ──resume──► playing
(stopped is entered/left by the operator loading or ending a show — never by Reveille)
```

Pause while `paused`, or resume while `playing`, is a **no-op**, reported as such. Pause
or resume while `stopped` is refused honestly (nothing to act on).

---

## Contract types (`contract/src/index.ts`) — additive

```typescript
export type ServerState = 'starting' | 'running' | 'stopped' | 'error';   // unchanged
export type MediaState  = 'playing' | 'paused' | 'stopped';               // NEW

export interface AgentResponse {
  state: ServerState | MediaState;   // widened; a target answers in its own vocabulary
  message?: string;
}
```

A media agent answering `GET /status` returns a `MediaState`; the orchestrator renders
whatever state string a target reports, so its status client stays target-agnostic.

---

## The folded `/status` (derived, per interaction)

`/status` queries **every** configured target and lists each with its own state:

| Target kind | Reported states | Verbs it accepts |
|---|---|---|
| game | running / starting / stopped / unreachable | `/start`, `/stop`, `/address` |
| media | playing / paused / stopped / unreachable | `/pause`, `/play` |

One command, every target, each in its own vocabulary — "what's happening on watson?"
Independent per target: a media command never affects a game and vice versa.

---

## Command (transient, per interaction)

| Command | Kind it targets | Reads/writes |
|---|---|---|
| `/pause` | media | force-pauses the one media player |
| `/play` | media | force-resumes it |
| `/status` | all | reads every target's state, changes nothing |

A single media player needs no target argument (SC-001, "two taps"); a second player
would name its target the way the game commands do.
