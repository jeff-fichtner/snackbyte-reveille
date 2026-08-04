# Contract: the seam (v3 — media verbs added)

**Feature**: `003-media-control` · **Version**: 3 (M3) · **Date**: 2026-08-03

The line between the orchestrator and an agent. v1 (001) had two verbs; v2 (002) added
`status`; v3 adds **two media verbs** for a media agent — `pause` and `play` — and a
media state vocabulary. The additions are the only contract change, and they are purely
**additive**: every v1/v2 field, verb, and behaviour is unchanged (a 001/002 conformance
check still passes).

## Shape (unchanged from v2)

- **Transport**: HTTP/1.1, JSON bodies.
- **Direction**: orchestrator → agent, always. **The agent never initiates.**
- **Identity**: the agent's base URL *is* its identity. **No target id, machine id, or
  discriminator appears in a path or body.** The media player is a second agent at a
  second address in the orchestrator's config (`kind: "media"`) — never a parameter here.
- **Auth**: none. Valid *only* while the agent binds `127.0.0.1`.
- **State**: none retained. Every response is derived by asking the target now.
- **Adapter-agnostic**: an agent controls exactly one target of one kind; which target,
  and whether it is a game or a media player, is the agent's config — invisible here.

## Shared types (`contract/src/index.ts`) — additive

```typescript
export type ServerState = 'starting' | 'running' | 'stopped' | 'error';   // v1, unchanged
export type MediaState  = 'playing' | 'paused' | 'stopped';               // v3, NEW

export interface AgentResponse {
  state: ServerState | MediaState;   // widened; a target answers in its own vocabulary
  message?: string;
}
```

## Game verbs — unchanged from v2

`POST /start`, `POST /stop`, `GET /status` behave exactly as v2 for a **game** agent
(save-before-stop, never force-stop, no double-spawn, `/status` off the command mutex). A
game agent does not answer the media verbs.

## `GET /status` — now answered by both kinds

Report the target's current state. **Read-only.** A game agent returns a `ServerState`; a
**media** agent returns a `MediaState`:

| Kind | `state` values |
|---|---|
| game | `running` \| `starting` \| `stopped` |
| media | `playing` \| `paused` \| `stopped` |

`status` never returns `error` as a *state*; a read that cannot reach the target is a
transport failure the orchestrator classifies as **unreachable**, distinct from any
state (FR-009). It is off the command mutex and pollable, unchanged from v2.

## `POST /pause` — NEW (media agents only)

Force-pause the currently-playing item.

**Responses**

| Status | `state` | Meaning |
|---|---|---|
| `200` | `paused` | paused now, or already paused (a reported no-op) |
| `409` | `stopped` | nothing is playing — refused honestly (FR-008) |
| `500` | `error` | the player could not be told to pause |

## `POST /play` — NEW (media agents only)

Force-resume the paused item.

**Responses**

| Status | `state` | Meaning |
|---|---|---|
| `200` | `playing` | resumed now, or already playing (a reported no-op) |
| `409` | `stopped` | nothing is loaded to resume — refused honestly |
| `500` | `error` | the player could not be told to resume |

## Rules (extends v2)

1. **The seam's verbs are the whole surface.** A game agent speaks
   `start`/`stop`/`status`; a media agent speaks `pause`/`play`/`status`. No verb selects
   or browses content (FR-004); there is no seek, volume, or playlist verb.
2. **No identifier leaks in.** Adding the media verbs added no path parameter, body field,
   or header naming the target or its kind. Verified by the same no-discriminator test the
   contract has carried since v1.
3. **`pause`/`play` are idempotent and honest.** Already-in-state is a `200` no-op;
   nothing-loaded is a `409` refusal, never a pretended success.
4. **v1/v2 behaviour is byte-for-byte unchanged.** The game agents are untouched
   (FR-013); the additions only add.
