# Phase 1 — Data model: four context-free media controls

**Nothing here is stored.** Every entity below is transient — derived per interaction and
discarded. There is no database, no cache, and no file. That is not an omission to fix later;
it is the property that makes "context-free" checkable, because a system that remembers nothing
about content cannot leak what it does not hold (FR-002, inherited from 003 FR-012).

## Entities

### 1. Media control (transient, per interaction)

One of four relative instructions a member issues. Carries no reference to content and never
claims a result.

| Field | Type | Notes |
|---|---|---|
| verb | `next` \| `previous` \| `forward` \| `back` | The Discord vocabulary. Four commands. |
| seconds | `integer` (optional) | Present only for `forward` / `back`. Absent → 30. |

**Lifecycle**: born when the interaction arrives, dead when the reply is edited. Never
persisted, never queued, never replayed. No timer or background process may create one —
every instance originates in a direct human command (FR-008).

**Collapses to three seam verbs.** `forward` and `back` are the same operation over a signed
magnitude; the sign is applied at the orchestrator, and only the signed value crosses the seam:

| Discord command | Seam verb | `seconds` sent |
|---|---|---|
| `/next` | `POST /next` | — |
| `/previous` | `POST /previous` | — |
| `/forward` *(no argument)* | `POST /seek` | `+30` |
| `/forward n` | `POST /seek` | `+n` |
| `/back` *(no argument)* | `POST /seek` | `-30` |
| `/back n` | `POST /seek` | `-n` |

### 2. Seek amount (transient)

A number of seconds accompanying a seek. **The only data that has ever crossed the seam in a
request.**

| Property | Value |
|---|---|
| Type | Signed integer, seconds |
| Default | `30`, applied **in the orchestrator only** when the member omits it |
| Bounds | **None.** Not clamped, capped, range-checked, or validated against item length (FR-005) |
| Zero / negative | Passed through exactly as given (Clarifications 2026-08-04) |
| Direction | Carried by the **sign**, not by the verb |

**The default lives in exactly one place.** The member may omit the argument — that is a choice
with a documented meaning, so the orchestrator supplies 30. The orchestrator may **not** omit
the parameter — that would be a bug, so the agent rejects a missing or non-integer `seconds`
with a **400** naming it, rather than defaulting. Giving a required value a silent fallback at
the agent is the exact pattern that converts "the caller forgot" into a mysterious half-minute
jump.

**`/back n` negates.** So `/back 30` sends `-30`, and `/back -30` sends `+30` and seeks
**forward** — the accepted consequence of pass-through, reached with no branching code.

### 3. Media target (unchanged from 003 / 004)

A controllable media player, identified by its agent's base URL, belonging to one or more
tenants' target sets.

**Nothing about it changes here except the number of verbs it answers** — two becomes five
(`/pause`, `/play`, `/next`, `/previous`, `/seek`), plus the read-only `/status` it already
shared with games. No new field, no new configuration, no new environment variable.

The **at-most-one-media-target-per-tenant** invariant (004, enforced by failing loud at boot)
is what makes all six commands unambiguous while bare. These four **depend** on it and must not
weaken it (FR-013).

## State

### Playback state — read, never remembered

`MediaState` = `playing` | `paused` | `stopped`, derived by asking the player at the moment of
the request. It is **knowledge of *whether*, never of *what***: it carries no item, file,
playlist entry, position, or duration, which is exactly why reading it is permitted while
reading content is not (FR-002).

The four controls **do not transition** it in any way the system models or asserts. What the
player is doing after a `next` is the player's business (FR-003).

### The decision every acting verb makes

Identical for all five media verbs — the two from 003 and the three new ones. This uniformity
*is* SC-003:

| State read **before** acting | Outcome | HTTP |
|---|---|---|
| `stopped` | Refused honestly — nothing is loaded | `409` |
| `playing` | Command issued | `200` |
| `paused` | Command issued (the item is loaded, so the player can act) | `200` |
| *could not read / command failed* | Reported as a failure, distinct from any playback state | `500` |

Read **before**, never after. A read before deciding is a precondition; a read after acting to
see whether it worked would be outcome verification, which FR-003 forbids.

`/pause` and `/play` additionally report an already-in-target-state **no-op** as a `200` with a
message. The three new verbs have no such case — there is no "already next".

## What is deliberately absent

Listed because their absence is a requirement, not an oversight — each is a thing a reasonable
implementer would otherwise add:

- **No playlist model.** No item, index, count, title, path, or "is there a next one".
- **No position or duration.** Not read, not stored, not reported — not even to decide whether
  a seek is sensible.
- **No bounds or validation on the amount** beyond "is an integer".
- **No outcome record.** Nothing compares before and after.
- **No queue, retry, or scheduling.** A control that cannot be delivered is reported, not
  retried — and never deferred to a moment nobody asked for.
- **No new configuration.** No environment variable, no default file, no tuning knob.
