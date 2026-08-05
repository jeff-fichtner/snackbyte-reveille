# Contract: the seam (v4 — three more media verbs, and its first operation parameter)

**Feature**: `005-more-media-commands` · **Version**: 4 (M5) · **Date**: 2026-08-04

The line between the orchestrator and an agent. v1 (001) had two verbs; v2 (002) added
`status`; v3 (003) added `pause`/`play` and a media state vocabulary; **v4 adds three media
verbs — `next`, `previous`, and `seek` — and, for the first time, a parameter on a request.**

The additions are purely **additive**: every v1/v2/v3 field, verb, and behaviour is unchanged,
and a v1/v2/v3 conformance check still passes (FR-014).

**`contract/src/index.ts` does not change.** v4 adds verbs and one operation parameter, not
types. `ServerState`, `MediaState`, and `AgentResponse` are byte-for-byte what v3 defined.

## Shape (unchanged from v3)

- **Transport**: HTTP/1.1, JSON bodies.
- **Direction**: orchestrator → agent, always. **The agent never initiates.**
- **Identity**: the agent's base URL *is* its identity. **No target id, machine id, or
  discriminator appears in a path, query, or body.**
- **Auth**: none. Valid *only* while the agent binds `127.0.0.1`.
- **State**: none retained. Every response is derived by asking the target now.
- **Adapter-agnostic**: an agent controls exactly one target of one kind; which target, and
  whether it is a game or a media player, is the agent's config — invisible here.

## The parameter rule — NEW in v4, and the line it must not cross

v4 is the first version in which a request carries data. That makes the boundary worth stating
precisely, because it is the boundary a future change is most likely to erode.

> **A parameter of the *operation* may cross the seam. A name for *which target* may not.**

`seconds` says **how far to move**. It is meaningless as a routing key, cannot select a target,
and would be nonsense in a `/status` request. Constitution I bans a *server identifier, machine
identifier, or routing discriminator* — something answering "**which** one" — and `seconds`
answers "**how much**".

What this precedent explicitly does **not** license: a `target`, `name`, `id`, `host`, or
`kind` parameter, in any position, ever. Those remain an architecture change requiring a
`DECISIONS.md` entry and, realistically, a different design (Constitution I).

Recorded in `DECISIONS.md` 023 before implementation.

## Shared types (`contract/src/index.ts`) — UNCHANGED from v3

```typescript
export type ServerState = 'starting' | 'running' | 'stopped' | 'error';   // v1, unchanged
export type MediaState  = 'playing' | 'paused' | 'stopped';               // v3, unchanged

export interface AgentResponse {
  state: ServerState | MediaState;   // unchanged
  message?: string;                  // unchanged
}
```

## Game verbs — unchanged from v3

`POST /start`, `POST /stop`, `GET /status` behave exactly as v2/v3 for a **game** agent
(save-before-stop, never force-stop, no double-spawn, `/status` off the command mutex). A game
agent does not answer any media verb, including the three new ones — a `/next` to a game agent
is a **404** (FR-016).

## `GET /status` — unchanged from v3

Read-only, off the command mutex, pollable. A game agent returns a `ServerState`; a media agent
returns a `MediaState`. Unaffected by this feature.

## `POST /pause`, `POST /play` — unchanged from v3

Behaviour, statuses, and wording are exactly v3 (FR-018).

---

## `POST /next` — NEW (media agents only)

Step blindly to the next playlist item. Issues the player's next-item command; **does not**
read, name, or report what is loaded, and **does not** check whether a next item exists.

**Parameters**: none.

**Responses**

| Status | `state` | Meaning |
|---|---|---|
| `200` | `playing` \| `paused` | The command was issued. **Not** a claim that the item changed. |
| `409` | `stopped` | Nothing is loaded — refused honestly (FR-006a) |
| `500` | `error` | The player could not be told to step |

## `POST /previous` — NEW (media agents only)

Mirror of `/next`, stepping to the previous item. Same parameters, same responses.

## `POST /seek?seconds=<signed integer>` — NEW (media agents only)

Move the position **relative to where it is now**, by the given number of seconds. Positive is
forward, negative is backward.

**Parameters**

| Name | In | Type | Required | Notes |
|---|---|---|---|---|
| `seconds` | query | signed integer | **yes** | Relative. **Unbounded** — never clamped, capped, or range-checked by the agent (FR-005). |

**`seconds` is required at this layer and has no default.** The 30-second default belongs to
the Discord surface, where a *member* may omit the argument; by the time a request reaches the
seam the amount is always explicit. An absent, blank, or non-integer value is a caller bug and
is rejected loudly rather than defaulted.

**Unbounded is not the same as unrepresentable.** The agent applies no range check to the seek
*distance* (FR-005) — but a value beyond ±2^53−1 cannot survive as a JS number, so it is
rejected with a `400` rather than silently altered on the wire. That is the
no-silent-wrong-behaviour rule rather than a cap: nothing inside the representable range is
touched, and 2^53 seconds is roughly 285 million years.

**Responses**

| Status | `state` | Meaning |
|---|---|---|
| `200` | `playing` \| `paused` | The seek was issued. **Not** a claim about where it landed. |
| `400` | `error` | `seconds` missing, blank, not an integer, or **larger than can be represented exactly** (beyond ±2^53−1) — named in `message` |
| `409` | `stopped` | Nothing is loaded — refused honestly (FR-006a) |
| `500` | `error` | The player could not be told to seek |

**Relative, never absolute.** The agent must issue the player's *relative* seek. An absolute
seek — "go to 0:30" — is **forbidden by FR-011**, and the exact absolute form is identified
during M0 and **banned by name** in `vlc.test.ts`. This distinction is the single most important
thing M0 pins down: the two forms differ by a sign prefix and the wrong one fails silently by
doing something plausible.

---

## Rules (extends v3)

1. **The seam's verbs are the whole surface.** A game agent speaks `start`/`stop`/`status`; a
   media agent speaks `pause`/`play`/`next`/`previous`/`seek`/`status`. **No verb selects,
   names, browses, enqueues, or removes content**, and there is still no volume verb, no
   absolute-position verb, and no media `stop`.
2. **No identifier leaks in.** The three additions introduce no path parameter, body field, or
   header naming the target or its kind. The one query parameter is an operation parameter,
   governed by the rule above. Verified by the same no-discriminator check the contract has
   carried since v1.
3. **Every acting media verb reads state, then acts — never the reverse.** `stopped` is a `409`
   for all five. A read *before* deciding is a precondition; a read *after* acting to see
   whether it worked is outcome verification and is forbidden (FR-003).
4. **A `200` means issued, not achieved.** No media verb's response asserts that the item
   changed or that the position landed anywhere. `state` is what the player reports, never a
   claim about the effect of the command.
5. **Nothing in a response describes content.** No item, file, playlist entry, index, title,
   position, or duration appears in any field, in any status (FR-002).
6. **The three new verbs are acting verbs and are serialized** with `pause`/`play` on the
   agent's command mutex. `GET /status` remains outside it (FR-021).
7. **v1/v2/v3 behaviour is byte-for-byte unchanged.** Game agents are untouched; `pause`,
   `play`, and `status` behave exactly as before (FR-018). The additions only add.
