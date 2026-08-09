# Contract — orchestrator ↔ agent, seam v5

**Additive to v4.** Every v4 verb, path, field and status keeps its exact meaning. A v4 agent
works against a v5 orchestrator unchanged, and a v5 agent answers a v4 orchestrator unchanged.
Constitution I governs this file: **no target identifier may appear in any path, query, or body.**

## What changed

Two things, both narrow:

1. **`AgentResponse` gains three optional observation fields** — set by a media agent that has
   something to report, never set by a game agent.
2. **`POST /next` and `POST /previous` gain a required `count` query parameter** — a magnitude,
   always positive; direction lives in *which verb was chosen*, exactly as it did before.

Nothing else moves. `POST /start`, `POST /stop`, `GET /status`, `POST /pause`, `POST /play`,
`POST /seek` are untouched.

## The verbs (v5 — eight, unchanged in number)

| Verb | Kind | Parameter | Notes |
|---|---|---|---|
| `POST /start` | game | — | unchanged |
| `POST /stop` | game | — | unchanged |
| `GET /status` | both | — | unchanged; response may now carry observation fields |
| `POST /pause` | media | — | unchanged; response may now carry observation fields |
| `POST /play` | media | — | unchanged; response may now carry observation fields |
| `POST /seek` | media | `seconds=<signed int>` | unchanged (v4) |
| `POST /next` | media | **`count=<positive int>`** | **new parameter** |
| `POST /previous` | media | **`count=<positive int>`** | **new parameter** |

An agent answers only its kind's verbs; a `/start` to a media agent is still a 404.

## `count` — why it is admitted

DECISIONS 023 draws the line: **a parameter of the operation may cross the seam; a name for which
target may not.** `count` says *how far*, never *which player* and never *which item*. A step of
three is the same blind step, three times: it nominates nothing, reads no playlist, and knows
nothing about what is loaded. It is the direct analogue of `seconds`.

This does **not** license a `target`, `name`, `id`, `kind`, or item identifier. Those remain
architecture changes.

**Always positive.** The orchestrator owns the sign (FR-005): it resolves the default, reads the
sign, chooses `/next` or `/previous`, and sends the magnitude. `/next -3` reaches the agent as
`POST /previous?count=3`.

**The agent still validates it** (FR-018). Missing, non-integer, non-finite, or outside the safe
integer range → **`400`** naming the argument. This mirrors `seconds` and for the same reason: a
boundary declining to trust its caller is not duplicated processing, and a silent default would be
destructive — M0 measured `val=abc` seeking to the very start.

**Unbounded** (FR-016). Not clamped, capped, or range-checked. See `research.md` §3 for the mutex
exposure this accepts deliberately.

**Indivisible** (FR-019). The agent loops the step inside its single command-mutex hold: one
request, one serialised operation, never N round trips racing. `GET /status` is unaffected — it
does not sit on the mutex and must keep answering during a long step.

## `AgentResponse` (v5)

```ts
export interface AgentResponse {
  state: ServerState | MediaState;   // unchanged
  message?: string;                  // unchanged in shape — see the note below
  title?: string;                    // NEW — what the target observed is loaded
  elapsedSeconds?: number;           // NEW — how far in, right now
  totalSeconds?: number;             // NEW — how long, when the target knows
}
```

### Rules for the new fields

- **Optional in the strongest sense.** A game agent sets none of them. A media agent sets only what
  the player actually reported. Absent means *not available*, never *zero* and never *unknown-so-
  guess*. An older agent that omits all three is indistinguishable from a target with nothing to
  report, and both render correctly — that is what makes this additive in fact, not just in name.
- **`title`** is whatever names the item: the player's title where it has one, its filename where it
  does not, absent where neither exists (FR-009). **The agent does not truncate** — shortening is a
  presentation decision and belongs to the orchestrator (FR-005, FR-009a).
- **`elapsedSeconds` / `totalSeconds`** are whole seconds. `totalSeconds` is absent for a live
  stream. Either may be absent independently.
- **Observation, never a claim** (FR-010). These describe what the target reported *at the moment it
  was asked*. They do not assert that the command caused the state, and the orchestrator must not
  word them as though it did.
- **Never stored** (FR-011). Read from the response, rendered once, discarded. No cache, no memo, no
  "last seen" — on either side of the seam.
- **No identifier** (FR-023). These say what was observed, never which agent observed it. The
  agent's URL remains its identity.

### `message` changes destination, not shape

`message` stays exactly as it is on the wire. What changes is what the orchestrator does with it:
it is a **diagnostic**, recorded for the operator and **never rendered to a member** (FR-005,
FR-006). Agents may keep writing it and need no change.

Consequently **`message` must not be used to carry display content** — that is what the three new
fields are for. Overloading it as both diagnostic and reply text is how internals reached the
channel in the first place.

## Status codes (unchanged)

| Code | Meaning |
|---|---|
| `200` | done, or already in the requested state |
| `202` | launch issued, not verified (game start) |
| `400` | the caller's argument was malformed — names the argument |
| `404` | verb not offered by this agent's kind |
| `409` | refused: the target cannot do this now |
| `500` | the target itself failed |

The orchestrator chooses member-visible wording from **this code**, never from `message`.

## What did not change, and must not

- No target identifier in any path, query, or body (Constitution I).
- No new verb, no removed verb, no renamed field.
- No request body anywhere — every verb is still a bare POST or a query parameter.
- No authentication, no new port, no new binding: the agent still binds `127.0.0.1` only.
- Game verbs, states, and guarantees are untouched — including the graceful-stop rule
  (Constitution IV), which no part of this contract relaxes.
