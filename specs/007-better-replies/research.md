# Phase 0 — Research: replies that serve the reader

Every decision the plan rests on, with what it was chosen over. The spec carries **no**
`NEEDS CLARIFICATION` markers and five clarifications are recorded (2026-08-08), so this phase
resolves *design* choices — except for one genuine unknown, which is why an M0 returns.

---

## 1. Thread C needs an M0. The existing records do not cover it

**Decision**: A measurement task (**M0**) runs before any Thread C code, against a real VLC,
recorded in `m0-vlc-metadata.md`. Thread A and Thread B need none.

> **RESOLVED 2026-08-09** — [`m0-vlc-metadata.md`](m0-vlc-metadata.md). **VLC does not synthesise a
> title**: on an untagged file the `title` key is absent from `meta` entirely, so FR-009's fallback
> has **two live branches** and the design below stands unchanged. Two silent traps were caught that
> reading alone would not have surfaced: `information.title` is an integer *index* (measured `0`),
> and the **entire `information` block disappears** when nothing is loaded, so a naive field path
> throws rather than returning nothing. US2 is unblocked.

**Rationale**: This was checked rather than assumed, and the check failed. `m0-vlc.md` §3 and §5
measured `state`, and — for the **nothing-loaded** case only — `length: 0` and `currentplid: -1`.
`m0-vlc-controls.md` measured the stepping and seek commands. **Neither measured the fields
Thread C is built on for a loaded item**: where a title lives, where a filename lives, what
`time` and `length` report while playing, or their units.

Writing `information.category.meta.title` from memory of VLC would be exactly the "observed, not
assumed" rule this repo keeps an M0 phase for — and 005 already proved the cost of assuming: a
bare `val=30` was *assumed* relative and measured **absolute**, a silent and plausible-looking
wrong behaviour that only measurement caught.

**The measurement that could change the design**, and the reason this is not a formality:

> **Does VLC synthesise a `title` from the filename when a file carries no title tag?**

If it does, FR-009's fallback is **unobservable** — the "no title, use the filename" branch never
fires because there is always a title, and what the reader sees is a filename *presented as a
title*. The clarified rule would be satisfied by accident and unimplementable as written. If it
does not, the fallback chain is real and needs both branches. **The plan cannot pick the shape
until this is measured**, which is precisely what an M0 is for.

**Measured for a loaded item, a tagged file, an untagged file, and a stream**: the exact field
path of title and filename; whether title is synthesised; `time` / `length` presence, type and
unit; what a stream reports for `length`; and what the meta block looks like when nothing is
loaded. `quickstart.md` §1 states the pass condition.

**Alternatives considered**: *Trust the VLC HTTP docs.* Rejected — 005's absolute-seek finding
came from measurement contradicting the obvious reading. *Build defensively against every shape.*
Rejected: it produces untestable branches for shapes that do not occur, and hides the synthesised-
title question rather than answering it.

---

## 2. Diagnostics leave by a different door than replies

**Decision**: `AgentResponse.message` stops reaching any reply. Every call site that today renders
`body.message ?? \`Agent returned HTTP ${status}\`` instead writes that text to the operator's log
and returns orchestrator-authored wording chosen by the **status code**, not by the agent's text.

**Rationale**: FR-005 and FR-006 are one change, not two — the same string simply changes
destination. The current shape has the agent's text as the *primary* and our text as the
*fallback*, which is what puts "VLC web interface returned HTTP 401" in a channel; inverting that
is not enough, because the fallback is `Agent returned HTTP 404` and violates FR-001 on its own.
**Both sides of the `??` are the bug.**

The mapping is small because the seam is small: `409` is a refusal, `500` is the target failing,
`400` is the member's argument, anything else is a fault. Nine call sites collapse onto one helper
that takes a status and a command's own vocabulary.

**Consequence accepted**: the operator loses the convenience of seeing the agent's message in
Discord and must read the log. That is the point of the requirement — FR-006 keeps it available,
just not in front of members.

**Alternatives considered**: *Sanitise the agent's message with a regex.* Rejected — it keeps a
second author of member-visible text and fails open on any phrasing the pattern misses. *Return a
machine-readable reason code across the seam.* Rejected as over-building: the status code is
already that code, and a new field would need a seam change Constitution III does not justify.

---

## 3. The unbounded count meets the mutex — the plan's one real conflict

**Decision**: The agent loops the step command inside its single mutex hold (FR-019), passes the
count through unclamped (FR-016), and bounds **nothing by count**. The operator's exposure is
recorded here and in `DECISIONS.md` rather than silently fixed.

**Rationale, and the conflict**: FR-016 forbids clamping. FR-019 requires the multi-step to be
indivisible, which means the agent's command mutex is held for the whole loop. Those two are fine
at `/next 5` and pathological at `/next 1000000`: at the **~200 ms per confirmed step measured** in
`m0-vlc-metadata.md` §5a, a million steps holds the mutex for roughly **55 hours**, during which
every `/pause`, `/play` and `/next` on that player blocks. `/status` is unaffected — it deliberately
does not sit on the mutex. (This paragraph has been wrong twice, and the second time matters. It first estimated
~10 ms; M0 §5 measured 22 ms and it was corrected. But 22 ms is the *request* latency —
what §5 actually measured — and the design needed the *switch* latency, which §5a later
measured at ~200 ms. **The exposure is roughly 9× what this section claimed when the
unbounded-count trade-off was accepted**, and a step that cannot land costs its full 2 s
bound. **The correction does not change the decision, and it was a mistake to suggest it
might** — settled 2026-08-10. The trade-off never rested on the number. It rested on: this
requires deliberately typing an absurd count, it affects one target, `/status` keeps
answering, and recovery is restarting the agent. All four hold at 55 hours exactly as they
held at 6. A time bound would have to invent a number *and* report a partial step — new
reply vocabulary and state about an in-flight operation — to guard an input nobody
produces. That is more machinery than the risk. **No bound. The fallback is withdrawn, not
deferred.**)

The spec's "very large count" edge case anticipated the *player's* behaviour ("not clamped, the
player does what it does") but not **mutex starvation**, which is a property of our own agent.

**Why pass it through anyway**: clamping is exactly the opinion the feature exists to remove, and
a cap would have to invent a number nothing measures. The blast radius is bounded and benign — one
target, one operator, self-inflicted, ended by restarting the agent — and it is *visible* rather
than silent, because every blocked command sits there unanswered. Choosing a magic cap to avoid an
operator's own typo would trade a loud, recoverable, self-caused stall for a permanent invented
policy in the code. That is the wrong trade for a system whose whole thesis is mechanism-not-policy.

**Alternatives considered**: *Cap the count (e.g. 100).* Rejected — invents policy, violates FR-016,
and the number is unmeasurable. *Bound by elapsed time instead of count.* Genuinely tempting — it
bounds the harm without capping the count, and it is honest about what it protects. Rejected for
**this** feature because a partial step would then need to be reported ("moved 340 of 1000000"),
which is state about an in-flight operation and new reply vocabulary; recorded as the option to
take first if the exposure ever bites. *Release the mutex between steps.* Rejected: it is exactly
what FR-019 forbids, and would let a `/pause` land mid-sequence.

---

## 4. The seam grows by response fields only (v5, additive)

**Decision**: `AgentResponse` gains optional fields carrying what the target observed. No verb, no
request field, and no path changes. Every existing field keeps its meaning.

**Rationale**: FR-022 and Constitution I. The detail travels the direction that is safe — **back**
from the agent. A game agent never sets the new fields, an older agent that omits them is
indistinguishable from a target with nothing to report, and both render correctly because FR-009
already requires omitting what is absent. That is what makes this additive in fact and not just in
name.

**No target identifier is involved** (FR-023). The new fields describe *what this agent observed*,
never *which agent it is* — the agent's URL remains its identity. This does not touch DECISIONS
023's operation-parameter rule either, because nothing new crosses in a **request**: the step count
does (see §5), and it is a parameter of the operation exactly as `seconds` is.

**Alternatives considered**: *A separate `GET /now` verb.* Rejected — a second round trip for data
the status response already carries, and a new verb where an optional field suffices (Constitution
III). *Reuse `message` for the title.* Rejected outright: `message` becomes a diagnostic in §2, and
overloading one field as both diagnostic and display content is how the leak happened in the first
place.

---

## 5. The count crosses as a signed magnitude, decided by the orchestrator

**Decision**: `/next` and `/previous` take an optional integer option. The orchestrator resolves
the default (1), applies the sign, picks **which verb** to send, and sends a positive magnitude.
The agent's verb is `POST /next?count=<positive int>` and `POST /previous?count=<positive int>`.

**Rationale**: This mirrors seek exactly — `/back 30` and `/forward 30` are one operation over a
signed magnitude — and it puts the sign logic in the one place FR-005 says decisions live. `/next -3`
becomes `POST /previous?count=3`, and the reply says it moved **back** three (FR-017).

`count` is admitted by DECISIONS 023's rule unchanged: **a parameter of the operation may cross; a
name for which target may not.** `count` says how far, never which player, never which item — a
step of three is still blind, still nominates nothing, and is exactly three of the step that was
already permitted. It does **not** license an item id.

**The agent still validates** (FR-018), rejecting a missing, non-integer, or non-safe-integer count
with a 400 that names the argument — the same fail-loud shape `seconds` already has, and the same
reason: a boundary declining to trust its caller is not duplicated processing, and a silent default
would be destructive here exactly as `val=abc` seeking to the start was.

**Alternatives considered**: *Send the signed count and let the agent pick direction.* Rejected —
it moves a decision into the agent, against FR-005, for no gain. *A single `POST /step?count=<signed>`
replacing both verbs.* Cleaner in isolation, rejected because collapsing two existing verbs is a
breaking seam change where an additive parameter suffices.

---

## 6. Rendering: one line per target, and the shortening rule

**Decision**: A shared renderer produces `name · elapsed / total` fragments from the observed
detail, and the all-targets reply keeps one line per target with the fragment inline (FR-008a).
Time renders `m:ss`, extending to `h:mm:ss` only past an hour. A name longer than a fixed budget is
truncated with an explicit ellipsis (FR-009a).

**Rationale**: SC-016 requires a game-only configuration to render **identically to today**, which
is a regression guarantee, not a style note — it is satisfied structurally by leaving the game
branch untouched and appending only where a media target supplies detail. The shortening exists
because the clarified fallback makes filenames the *normal* case for an untagged library, and a
release filename exceeds a phone's line width unaided; the ellipsis is required so a shortened name
is never mistaken for the whole of a strange one.

**Alternatives considered**: *Two lines for media.* Rejected by clarification. *Percentage instead
of a timestamp.* Rejected — answers "how far in" less usefully than a figure the reader can act on.
*Truncate silently.* Rejected by FR-009a: an invisible truncation is invented detail.

---

## 7. Correcting the overshoot where it is enforced, not only where it is written

**Decision**: FR-021 is satisfied by editing 005 FR-002, 005 FR-003, 006 FR-013/SC-006, DECISIONS
022, `agent/src/vlc.ts`'s header, `CLAUDE.md`'s media-ban paragraph, and **the tests that enforce
them** — `vlc.test.ts` and `commands.test.ts`.

**Rationale**: A requirement corrected in prose but still enforced by a green test is not
corrected; the test would fail the moment the feature works, and the honest reading of that failure
is that the document was never updated. The rewritten assertions must ban what the principle
actually forbids — content **selection** (`pl_jump`, `pl_play`, `in_play`, `in_enqueue`, `pl_empty`,
`pl_delete`), volume, `pl_stop`, OS kill, the unsigned absolute seek — and **storage** between
calls, while permitting observation.

**The storage ban needs a new kind of check** (FR-014). The selection ban is a source scan for
forbidden command names and stays that. "Nothing is stored" cannot be proved by grepping for a
word; it is asserted behaviourally — drive a sequence of commands against a stub whose reported
detail changes between calls, and assert every reply reflects the **current** observation, never a
previous one. That is a real test of the principle rather than a spelling check.

**Alternatives considered**: *Delete the offending assertions.* Rejected — it removes the guarantee
instead of correcting it, and SC-007 still requires selection to be impossible. *Leave 005/006
untouched and note the conflict.* Rejected by SC-015: shipping a system its own specs forbid is the
defect this thread exists to fix.

---

## 8. Nothing is configured, and nothing is exposed

**Decision**: No new environment variable, no new port, no new firewall rule, no new dependency.

**Rationale**: Recorded because FR-024 and SC-012 assert it. Thread C reads fields already present
in a response already fetched over a loopback connection that already exists; Thread B adds a query
parameter to an existing verb; Thread A only changes which side authors a string. The agent keeps
zero runtime dependencies. The one deliberate exception to "nothing new" is documentation the
constitution requires: a `DECISIONS.md` entry (FR-020) and the homepage correction (FR-026).

---

## 9. Out of scope, confirmed against the code

**The command-listing embed length guard stays out.** `describeCommandList` has no bound, and
around 22 game targets would exceed Discord's 4096-character limit. This was surfaced before and
checked again here rather than assumed: Thread C adds **no** entries to `/help` and does not
lengthen its descriptions beyond the count option's own text, so it does not make the exposure
materially worse. It remains a product call, unrelated to this feature.
