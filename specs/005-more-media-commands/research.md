# Phase 0 — Research: four context-free media controls

Every unknown the plan depends on, resolved or explicitly deferred to measurement. The
spec carries no `NEEDS CLARIFICATION` markers — three judgment calls were settled in the
Clarifications session (2026-08-04) and are treated as inputs here, not re-opened.

One unknown genuinely cannot be resolved by reasoning: **VLC's exact relative-seek syntax**.
It is deferred to M0 by design (FR-019), not left dangling — §1 states precisely what must be
measured and what the adapter may not assume until it is.

---

## 1. VLC's relative seek — MEASURE, DO NOT ASSUME (the one open unknown)

**Decision**: The exact spelling of a relative seek is **deferred to an M0 measurement task**
that must complete **before** `vlc.ts` is touched, and be recorded in
[`m0-vlc-controls.md`](m0-vlc-controls.md). The adapter is written against the recorded
observation, never against documentation.

**Rationale**: This is the highest-risk unknown in the feature, and it is risky in a
specifically nasty way — **the wrong syntax does not fail, it silently does the wrong thing.**

VLC's `seek` command takes a `val` parameter, and the *sign prefix* is what distinguishes
relative from absolute movement. A bare `val=30` is widely understood to mean **seek to
0:30**, while `val=+30` and `val=-30` mean **±30 seconds from here**. If that is right and we
send the bare form, `/forward 30` would jump the show to the 30-second mark instead of forward
half a minute — a plausible-looking command that quietly does something else entirely. That is
exactly the class of failure the fail-loud rule exists to prevent, and exactly why every target
since 001 has had an M0.

There is a second trap stacked on the first: **`+` is not literal in a query string.** In
`application/x-www-form-urlencoded` serialisation, `+` decodes to a space, so a naive
`?command=seek&val=+30` may arrive at VLC as `val= 30`. The correct wire form percent-encodes
it (`val=%2B30`). Whether VLC's parser is strict about this, tolerant of it, or happier with an
unprefixed positive is a question about a real HTTP server, not a question about a standard —
so it gets measured.

**What M0 must record** (each observed on a real install, with the request and the response):

1. The exact `command=` name and parameter for a relative seek, and the **precise wire
   encoding** that works — including how `+` must be encoded.
2. That a positive relative seek moves **forward from the current position** and a negative one
   **backward from it** — confirmed by reading the position before and after, at the player.
3. What a bare/unsigned `val` does, so the absolute form is *identified* and can be **banned**
   by name in `vlc.test.ts` (§5).
4. `pl_next` / `pl_previous`: the exact command names, and what each does at a playlist
   boundary (advance / wrap / nothing) and on a single-item playlist. **Observed and recorded
   only** — never depended on, and never reported to a member (FR-003).
5. What the four controls do while the player is **paused** rather than playing, and what
   `status.json` reports afterwards.
6. What each returns when **nothing is loaded** (`state: "stopped"`) — expected to be a silent
   no-op, mirroring 003 M0 §5, which is why the agent reads state first and refuses.
7. Whether a seek far beyond the item's length is clamped by VLC, wraps, or ends the item —
   recorded so the reply's honesty is accurate, **not** so the system can compensate (FR-005
   forbids compensating).

**How M0 must be driven — without disturbing the operator's player.** Launch a *separate*
headless VLC on a **different HTTP port** with its own password and a scratch clip, exactly as
003 M0 did, rather than issuing commands to whatever is currently loaded:

```
vlc.exe --intf dummy --extraintf http --http-host 127.0.0.1 --http-port <scratch port> \
        --http-password <scratch password> --loop <a long clip>
```

003's M0 used a 3-second clip; that is too short here — seeking needs an item long enough that
±30 seconds is observable, so use a clip of at least a couple of minutes.

**Alternatives considered**:

- *Take the syntax from VLC's documentation or a forum answer.* Rejected. This is the exact
  practice M0 exists to replace, and CLAUDE.md states the rule directly: behaviour an adapter
  depends on is observed, not assumed. Two prior targets produced surprises that documentation
  would not have caught (Satisfactory reporting `isGameRunning:false` while reachable; VLC's
  toggle-vs-force distinction).
- *Write the adapter with a guess and correct it during E2E.* Rejected. A silent wrong
  behaviour that looks plausible is precisely what survives a casual E2E — someone sees the
  video jump and calls it working.
- *Probe the operator's running VLC.* Rejected. It would move whatever is currently loaded.
  A scratch instance on its own port is free and side-effect-free.

---

## 2. Three seam verbs, not four

**Decision**: `POST /next`, `POST /previous`, and `POST /seek?seconds=<signed integer>`.
Forward and back are the same verb with opposite signs; the orchestrator negates for `/back`.

**Rationale**: Forward and back are not two operations — they are one operation over a signed
magnitude, which is also how the player itself models it (a single `seek` with a signed value,
per §1). Minting two verbs for one operation would put a distinction in the seam that exists
only in the Discord vocabulary, and the seam is the one thing here that is expensive to change
(Constitution I). Next and previous, by contrast, genuinely *are* two commands at the player
with no shared parameter, so they stay two verbs.

This also makes the negative-amount clarification fall out for free rather than needing a rule:
`/back 30` sends `-30`, and `/back -30` sends `+30`, which seeks forward — the accepted
consequence recorded in the spec's Assumptions, arrived at with **zero** branching code.

**Alternatives considered**:

- *Four verbs (`/forward`, `/back`, `/next`, `/previous`), each parameterless or with an
  unsigned amount.* Rejected: more seam surface for no expressive gain, and it would need a
  magnitude conversion the spec explicitly rules out as *not* the thinnest handling.
- *Two verbs (`/step?direction=…` and `/seek?seconds=…`).* Rejected: `direction=next|previous`
  is a discriminator that buys nothing — the two map to two distinct player commands anyway, so
  collapsing them just adds a branch inside the adapter to undo the collapse.
- *One verb (`/control?op=…&seconds=…`).* Rejected outright: a general-purpose command channel
  is precisely the shape that makes future content control a one-parameter change away, and the
  narrow-verbs design is what keeps the bans enforceable.

---

## 3. The amount crosses as a query parameter, not a request body

**Decision**: `POST /seek?seconds=<signed integer>`. The agent parses it with the platform's
own `URL`/`URLSearchParams`. A missing, blank, or non-integer `seconds` is a **400**, named —
never a silent default.

**Rationale**: Three reasons, in order of weight.

1. **It is the minimum** (Constitution III). The agent already computes its route as
   `(req.url ?? '').split('?')[0]`, so a query string is *already* tolerated and discarded —
   reading it is a few lines. A JSON body would introduce the agent's first request-body
   reader: stream buffering, `Content-Length` handling, a parse with malformed-input handling,
   and a size guard. That is real machinery to carry one integer.
2. **It adds no dependency**, keeping the agent's zero-runtime-deps rule intact without a
   `DECISIONS.md` entry for a parser.
3. **It keeps `AgentResponse` and the contract package untouched** — the addition is verbs and
   one operation parameter, so `contract/src/index.ts` does not change at all.

**On the default**: the **30-second default lives in the Discord layer only** (FR-004), where
the member omits the argument. By the time the seam is reached the amount is always explicit.
The agent therefore has no default to apply and must **fail loud** if `seconds` is absent —
giving the required value a silent fallback in the agent is the exact anti-pattern the
no-fallback-config rule forbids, and it would convert a caller bug into a mystery half-minute
jump. Note the asymmetry is deliberate: a member omitting an argument is a *choice with a
documented meaning*; the orchestrator omitting the parameter is a *bug*.

**Alternatives considered**:

- *JSON body `{"seconds": 30}`.* Rejected on cost, above. It is the more conventional REST
  shape, and that is its only advantage here.
- *Path segment (`POST /seek/30`).* Rejected: it reads like an identifier in a path, which is
  the shape Constitution I trains everyone to distrust, and it would need sign handling in a
  path segment.
- *A header.* Rejected: headers are for transport metadata, not operation parameters.

---

## 4. Refuse on `stopped` only — the same tier as pause and play

**Decision**: Each of the three verbs reads state first. `stopped` → **409**, refused honestly.
`playing` or `paused` → issue the command → **200**. Unreachable/failed → **500**.

**Rationale**: The spec's clarification settled the principle — *context-free means no
knowledge of content, not no knowledge of state* — and FR-006(a) pins the tier: refuse "in the
same terms and at the same tier as pause and resume already are." Those two refuse on exactly
one condition, `state === 'stopped'`, so these three do too. SC-003 then holds by construction:
with nothing loaded, all **six** media commands refuse identically.

`paused` is deliberately **not** a refusal. The item is loaded, so the player is in a state to
act; whether stepping or seeking while paused leaves it paused is the player's business,
observed in M0 (§1 item 5) and never claimed in a reply.

Note what this does *not* license: the state read is a **`MediaState`** — `playing`/`paused`/
`stopped`. It carries no item, file, playlist, position, or duration. Reading it is knowledge
of *whether*, never of *what* (FR-002), and it is not outcome verification because it happens
**before** the command, not after (FR-003).

**Alternatives considered**:

- *Issue blind, never refuse.* Rejected by the clarification. It was the original reading of
  "context-free" and was explicitly overturned: there is no intention of overriding the machine
  when the machine is not in a state to be overridden.
- *Refuse on `paused` too.* Rejected: it would make these three stricter than pause/play, which
  breaks the "same tier" requirement and would need knowledge the system is not entitled to in
  order to justify.
- *Read state after the command to report what happened.* Rejected — that is outcome
  verification, banned by FR-003.

---

## 5. The ban list narrows in one dimension and tightens in another

**Decision**: `agent/src/vlc.test.ts` keeps asserting the content bans against adapter source.
Three patterns move from **forbidden** to **required**; every other ban stays; and one **new**
ban is added.

| Pattern | 003 | 005 | Why |
|---|---|---|---|
| `pl_next`, `pl_previous` | forbidden | **required** | Blind relative stepping — permitted by the narrowed FR-004 |
| `command=seek` | forbidden | **required** | Blind relative position change — permitted |
| **an unsigned/absolute `val=`** | *(not covered)* | **FORBIDDEN — new** | Absolute seek is scrubbing to a timestamp; banned by **FR-011**, and Out of Scope |
| `pl_play`, `in_play`, `in_enqueue`, `pl_empty`, `pl_delete`, `pl_jump` | forbidden | **still forbidden** | Each names or selects a specific item — knowledge of content |
| `pl_stop` | forbidden | **still forbidden** | Stop is a lifecycle verb, out of scope, and Constitution IV territory |
| `command=volume` | forbidden | **still forbidden** | Untouched by this feature |
| `process.kill`, `.kill(`, `taskkill`, `Stop-Process` | forbidden | **still forbidden** | Constitution IV; never in a reachable path |
| `pl_pause` (the toggle) | forbidden | **still forbidden** | Force variants only, idempotence depends on it (003 M0 §4) |

**Rationale**: FR-011 requires the narrowed ban to stay enforced by "an automated check that
fails if a forbidden capability reappears — never left to human review." Deleting the three
lifted lines and stopping there would quietly weaken the check, because the *replacement* line
between permitted and forbidden — relative versus absolute — would be unasserted. Adding the
absolute-seek ban is what keeps the file an honest statement of the new boundary. The exact
pattern to ban is written **after** M0 identifies the absolute form by observation (§1 item 3).

`pl_jump` staying banned is the sharpest illustration of where the new line sits: **stepping to
the adjacent item is permitted; jumping to a nominated one is not.** One requires knowing
nothing, the other requires knowing what is in the playlist.

**Alternatives considered**:

- *Delete the three lifted patterns and change nothing else.* Rejected: leaves the
  relative/absolute boundary unenforced, which is the only boundary this feature creates.
- *Drop source-level assertions in favour of behavioural tests.* Rejected: the bans are about
  capabilities that must never *exist* in the file, not about what a code path currently does.
  A behavioural test cannot prove absence.

---

## 6. On the command mutex, with `/status` still off it

**Decision**: All three new verbs are **acting** verbs and run inside the agent's existing
`serialize()`. `GET /status` stays outside it, unchanged.

**Rationale**: Settled by clarification and stated in FR-021. The existing structure already
delivers this with no new code: `createAgentServer` special-cases `GET /status` ahead of the
POST guard and routes everything else through `serialize()`, so the new cases are serialized
**by virtue of being in `route()`**. The rationale differs slightly from the games' — these are
not check-then-act races over spawning a process — but the outcome is required regardless: two
seeks racing the player is exactly the interleaving nobody can reason about.

**Alternatives considered**:

- *Run them off the mutex since they are "fire and forget".* Rejected by clarification, and it
  would be wrong anyway — each reads state before acting (§4), which is a check-then-act.
- *A separate media-only mutex.* Rejected: an agent controls exactly one target, so there is
  one thing to serialize and a second mutex would guard nothing.

---

## 7. Discord surface: four bare commands, one optional unbounded integer

**Decision**: Four bare commands registered only when the tenant has a media target.
`/forward` and `/back` each take **one optional integer option** named `seconds`, with **no
`setMinValue` / `setMaxValue`**. Omitted → 30, applied in the orchestrator.

**Rationale**: FR-001 requires the fewest possible steps — a bare command with at most one
optional argument — matching how `/pause` and `/play` already register. Bare is safe *by
construction* rather than by luck: 004 fails loud at boot when a tenant has more than one media
target, so the ambiguity a bare command cannot resolve is a configuration that cannot exist
(FR-013).

**Leaving the bounds off is an active requirement, not an omission.** discord.js offers
`setMinValue`/`setMaxValue` and reaching for them is the obvious instinct; FR-005 forbids it,
and SC-004 measures it. This deserves its own assertion in `commands.test.ts`, because it is
the single likeliest thing for a well-meaning future edit to "fix".

Scoping needs no new mechanism: `buildCommands` already receives one tenant's targets and
`index.ts` already resolves the tenant before dispatch, so US3's isolation is inherited
structurally (004 FR-002/FR-003) rather than re-implemented. The new commands must, however, be
handled inside that resolved-tenant path and guarded on `rt.mediaTarget` exactly as
`/pause`/`/play` are.

**Alternatives considered**:

- *Group the four under a parent (`/media forward 30`).* Rejected in the spec's Assumptions:
  costs a step on every use to solve a problem the configuration model already prevents.
- *A `seconds` option on a single `/seek` command with negative values for back.* Rejected:
  makes the common case require an argument and pushes sign arithmetic onto the member.
- *String option parsed for a leading sign.* Rejected: Discord's integer option already
  validates integer-ness for free, and a string would need a parse-and-reject branch.

---

## 8. Two `DECISIONS.md` entries, before any code

**Decision**: Append **022** (the ban narrowing) and **023** (the seam's new verbs and its
first operation parameter), both **before** implementation begins. The next free number is 022;
021 is the multi-tenant entry.

**Rationale**: Two independent triggers under Constitution V, and the spec makes the first
mandatory in its own right (FR-010).

- **022** records that 003 FR-004 moved from *no movement through content* to *no knowledge of
  content*, and what that was chosen over — the rejected alternative being the narrower
  "position within an item is fair game, playlist stepping is not," which was considered and
  discarded during specification because it draws the line at *movement* rather than at
  *knowledge*, and would have permitted seeking while forbidding `pl_next` for no principled
  reason. Without this entry the repo would carry a test file whose bans contradict a recorded
  requirement, with nothing explaining which won.
- **023** records the seam change. It is a genuine architectural first: **no data has ever
  crossed the seam in a request** — every verb to date is a bare `POST`. The entry must state
  why `seconds` is not an identifier under Constitution I (a parameter *of the operation*, not
  a name for *which target*), so the precedent cannot later be stretched into "and therefore a
  target name is fine too."

**Alternatives considered**: *One combined entry.* Rejected — they have different scopes and
different futures. A later reader asking "when did the seam start carrying parameters?" should
not have to find it inside an entry about media content policy.
