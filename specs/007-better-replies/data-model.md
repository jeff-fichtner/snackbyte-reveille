# Data model — 007

**Every entity here is transient.** That is not incidental: FR-011 forbids storing anything
observed about content, and SC-006 measures it. There is no table, no cache, no field that
outlives the interaction that created it. If a later change introduces a place to *put* one of
these, that change has broken the feature's central guarantee.

## Observed detail

What a target reported when it was asked, at the moment it was asked.

| Field | Type | Optional | Meaning |
|---|---|---|---|
| `title` | string | yes | What names the item — the player's title, else its filename, else absent |
| `elapsedSeconds` | integer | yes | How far in, right now |
| `totalSeconds` | integer | yes | How long, when the target knows |

**Rules**

- Every field is independently optional. Absent means *the target did not report it*; it never
  means zero, and it is never filled by a guess or a placeholder (FR-009, SC-005).
- A game target reports none of these. A stopped media target reports none. A live stream reports
  a title and an elapsed, and no total.
- **Lifetime**: created when a response is parsed, consumed once by the renderer, discarded with
  the reply. It is never assigned to anything that survives the handler (FR-011).
- **It is an observation, not a claim** (FR-010). Nothing about it asserts that the command
  produced what it describes.

**Validation**: the exact source field names and types are **not yet known** — see `research.md`
§1. M0 measures them, including whether a title is synthesised from the filename when a file has
no tag, which decides whether the fallback below has two live branches or one.

## Display name

The presentation of `title`, derived at render time.

- **Derivation**: `title` if present, otherwise nothing is shown. (The title/filename fallback
  happens at the *target*, so by the time it crosses the seam it is already the one name to show —
  see `contracts/seam-v5.md`.)
- **Shortened when long** (FR-009a): beyond a fixed character budget it is truncated with a visible
  ellipsis. A shortened name must never read as the whole of a strange one (SC-017).
- **Never invented**: no placeholder, no "Unknown", no empty quotes.

## Position

The presentation of `elapsedSeconds` and `totalSeconds`.

| Available | Renders as |
|---|---|
| both | `12:04 / 44:31` |
| elapsed only | `12:04` |
| neither | omitted entirely |

- `m:ss` below an hour, `h:mm:ss` at or above one.
- A total without an elapsed is not rendered — "of 44:31" alone says nothing useful.

## Step count

How many items to move. Lives only for the duration of one command.

| Property | Value |
|---|---|
| Type | integer |
| Default | `1` (resolved by the orchestrator, FR-005) |
| Sign | the direction — negative reverses (FR-017). **Signed only as the member types it**; the orchestrator converts the sign to a verb choice, so what crosses the seam is always a positive magnitude (`contracts/seam-v5.md`) |
| Bounds | **none** — never clamped, capped, or range-checked (FR-016) |
| Rejected | missing, non-integer, non-finite, outside safe-integer range → `400` naming it (FR-018) |

**Across the seam it is a magnitude, always positive** — the orchestrator converts sign to verb
choice. See `contracts/seam-v5.md`.

## Reply

What a member reads. Authored entirely by the orchestrator (FR-005).

| Part | Source |
|---|---|
| Outcome | The orchestrator's own wording, chosen by status code and command |
| Detail | Display name and position, where the target supplied them. In the all-targets reply this stays **inline on the target's own single line**, and a game target reads exactly as it does today (FR-008a) |
| Direction | For a step, the way it *actually* went, not the way the command name implies |

- Contains **no** status code, error code, errno, or internal component name (FR-001, FR-002).
- States what happened, not the mechanism (FR-003), and lists no cause the reader cannot act on
  (FR-004).
- Preserves the guarantees the old wording carried (FR-007): a start never claims the server is up;
  a failed stop still says the server is still running; a refusal still reads as a refusal.
- Discarded after sending.

## Diagnostic

The technical detail behind a failure — a status code, a transport reason, an agent's `message`.

- **Recorded for the operator, never rendered to a member** (FR-005, FR-006, SC-003).
- Destination: the orchestrator's log (stderr), which is what the operator already reads.
- Transient: written once, never accumulated in the process.

## What is deliberately absent

Recorded because their absence *is* the design:

- **No playlist, item list, index, or item identifier** — anywhere, in any form (FR-012, SC-007).
- **No history, "last seen", or resume point** — nothing survives an interaction (FR-011, SC-006).
- **No cross-command state** — no command reads anything another command left (FR-013, SC-014).
  A command's own deferred follow-up is not this and is unaffected.
