# Feature Specification: Four more media controls, all context-free

**Feature Branch**: `005-more-media-commands`

**Created**: 2026-08-04

**Status**: Draft

**Input**: User description: "Four more media controls for VLC, all context-free: next item, previous item, seek forward, seek backward — the last two taking an optional number of seconds that defaults to 30. They carry no knowledge of what is loaded, never inspect the playlist, and never verify the outcome; `/next` on a single-item playlist does whatever the player does, and that is the operator's problem. This expands the control *surface* without giving Reveille any awareness of content, which narrows — deliberately — the 003 rule that banned all movement through content. Built on top of 004's per-guild tenancy."

## Overview

Reveille can currently pause the media player, resume it, and report whether it is playing —
and nothing else. An operator
running a watch party has to walk to the machine for the two things that come up most:
someone talked over a line and it needs replaying, and the episode finished and the next
one should start.

This feature adds four more controls — **next item**, **previous item**, **seek forward**,
and **seek backward** — issuable from the same channel as pause and play.

The organizing principle, and the thing that makes this a small feature rather than a large
one, is that all four are **context-free**. They carry no knowledge of what is loaded: they
do not read the playlist, do not name an item, and do not verify afterwards that they did
what was hoped. They are relative instructions: *step*, *step back*, *forward this many
seconds*, *back this many seconds*. Asking for the next item when only one is loaded does
whatever the player does — that is the operator's problem, not the control plane's.

**Context-free means no knowledge of *content*, not no knowledge of *state*.** Reveille may
know the player is playing, paused, or stopped — it already reports exactly that in
`/status` — and may decline a control when the player is in no state to act on it, exactly as
pause and resume already do. There is no intention of overriding the machine when the machine
is not in a state to be overridden. What Reveille must never know is *what* is loaded, and
what it must never do is claim an outcome it did not confirm.

That distinction is what this feature buys and what it must not spend. It grows the control
**surface** while adding **zero content awareness**. Reveille still cannot tell you what is
playing, still cannot show you a library, and still cannot choose a show. Choosing what
plays remains the operator's job, done outside Discord.

## Amends 003

003's **FR-004** reads: *"The system MUST act only on the content already loaded in the
player. It MUST NOT select, open, browse, list, search, or change what is playing, and MUST
NOT expose any file, library, or playlist surface."*

Stepping to the next item **changes what is playing**, so this feature genuinely amends that
requirement rather than extending it. The line moves from **no movement through content** to
**no knowledge of content**:

| | 003 | 005 |
|---|---|---|
| Select, open, browse, list, search an item | Forbidden | **Still forbidden** |
| Expose a file, library, or playlist surface | Forbidden | **Still forbidden** |
| Name or display what is loaded | Forbidden | **Still forbidden** |
| Step blindly to the adjacent item | Forbidden | **Permitted** |
| Move position within the loaded item | Forbidden | **Permitted** |
| Change volume | Forbidden | **Still forbidden** |
| Stop, or terminate the player | Forbidden | **Still forbidden** |

Everything 003 banned to keep Reveille *ignorant* of content stays banned. Only the ban on
*blind relative movement* is lifted. Per Constitution V this amendment MUST be recorded in
`DECISIONS.md`, with what it was chosen over, before implementation begins.

003's other guarantees are untouched: content is still never streamed, recorded, or relayed
(003 FR-011), the player process is still never terminated, and the feature still adds no
network exposure.

## Clarifications

### Session 2026-08-04

- Q: With nothing loaded, should the four controls issue blind or refuse like pause/play do? → A: **Refuse, consistent with pause/play — they are the same tier.** The principle is not "there is no check"; it is that there is no *intention* of having any say over the machine when the machine is not in a state to handle it. Knowing that state is legitimate — `/status` already reports it. Non-verification applies to the **outcome**, never to the state.
- Q: Should the four controls sit on the agent's command mutex with pause/play? → A: **Yes — serialize with the other acting verbs.** `/status` stays off the mutex as today.
- Q: How should a zero or negative seek amount behave? → A: **Passed through exactly as given** — the thinnest possible handling (Constitution III), no clamping, no magnitude conversion, no validation. A negative amount therefore seeks the opposite way; that is accepted.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Replay the line everybody missed (Priority: P1) 🎯 MVP

Somebody talks over a line. A member types the seek-backward command in the channel and the
show jumps back half a minute. Nobody gets up. If half a minute was not enough, they say how
many seconds they want instead.

**Why this priority**: This is the highest-frequency reason anyone reaches for the remote
during a watch party, and it delivers standalone value with the playlist controls absent
entirely. The two seek controls are also the only ones of the four that carry an argument, so
building them first settles the input shape before anything else depends on it.

**Independent Test**: With something playing, issue seek-backward with no argument and
confirm the playback position moves back by the default amount; issue it with an explicit
number and confirm it moves by that amount; confirm the same for seek-forward. The position
is observed **at the player itself**, not through Reveille — the system never reports it
(FR-002). Delivers the replay capability with next/previous unbuilt.

**Acceptance Scenarios**:

1. **Given** something is playing, **When** a member issues seek-backward with no amount, **Then** the position moves back by the default amount and the channel is told what was issued.
2. **Given** something is playing, **When** a member issues seek-forward with an explicit amount, **Then** the position moves forward by exactly that amount — not a rounded, clamped, or capped one.
3. **Given** the position is 10 seconds into an item, **When** a member seeks back further than that, **Then** the control is issued anyway and whatever the player does is reported honestly — no refusal is invented and no amount is silently reduced (FR-005).
4. **Given** the player cannot be reached, **When** a member issues either seek control, **Then** the reply says the player could not be reached and never reports a playback position or state (FR-006).

---

### User Story 2 - Move to the next thing (Priority: P2)

The episode ends. A member types the next-item command and the player moves on to whatever
is next in what the operator queued up. Someone wants the previous one back; they type the
previous-item command.

**Why this priority**: Real value, and the natural companion to US1 — but it depends on the
operator having queued more than one thing, so it is useful less often than replaying a
line. It carries no argument, so it is purely additive once US1's plumbing exists.

**Independent Test**: With a multi-item playlist loaded and playing, issue next-item and
confirm the player advances; issue previous-item and confirm it goes back. Then issue
next-item at the end of the playlist and confirm the reply is honest about what was issued
rather than claiming a specific result.

**Acceptance Scenarios**:

1. **Given** a playlist with more than one item is playing, **When** a member issues next-item, **Then** the player advances and the reply reports the control was issued without naming the item (FR-002).
2. **Given** the same playlist, **When** a member issues previous-item, **Then** the player goes back one item.
3. **Given** only one item is loaded, or the last item is playing, **When** a member issues next-item, **Then** the control is still issued — the player is playing, so it is in a state to act — and whatever the player then does is neither inspected nor claimed (FR-003).
4. **Given** any of the four controls has just run, **When** the member reads the reply, **Then** it never names, lists, or describes the item, file, or playlist (FR-002).

---

### User Story 3 - A guild gets only the controls it should (Priority: P3)

A guild configured with a media target sees the four new controls and they act on that
guild's player. A guild configured with only game servers never sees them at all. Neither
guild can reach the other's player.

**Why this priority**: The isolation guarantee itself is 004's, not this feature's — but the
four new commands are four new ways to reach a target, so each must inherit it. It is
verification of an existing guarantee over new surface rather than new capability, which is
why it sits below the controls themselves.

**Independent Test**: Configure one guild with a media target and one with only games.
Confirm the four controls appear only in the first and act only on its player; confirm they
are absent from the second and that no input in the second reaches the first's player.

**Acceptance Scenarios**:

1. **Given** a guild whose target set contains no media target, **When** a member opens the command picker, **Then** none of the four controls is offered (004 FR-003).
2. **Given** two guilds each with their own media target, **When** a member of one issues any of the four, **Then** only that guild's player is affected and the other's is never touched (004 FR-002).
3. **Given** an interaction from a guild not in the configuration, **When** any of the four arrives, **Then** nothing is acted on (004 FR-006).

---

### Edge Cases

- **Nothing is loaded, or the player is stopped.** The control is **refused honestly**, exactly
  as pause and resume already are (003 FR-008) — all six media commands behave alike here.
  Reading the state to decide that is legitimate; it is knowledge of *state*, not of *content*,
  and it is not outcome verification (FR-006a).
- **The end or the beginning of the playlist.** The player is playing, so the control **is**
  issued; whether it advances, wraps, or does nothing is the player's business and is never
  checked or claimed. No boundary check, no special-cased message — that would require knowing
  the playlist (FR-002).
- **A seek that would land past the end or before the start of the item.** Issued as given.
  No clamping and no range validation (FR-005).
- **A seek amount of zero, or a negative one.** Passed through as given rather than rejected
  — consistent with issuing controls blind. See Assumptions; this is the least-certain of the
  context-free readings and is flagged for review.
- **The player cannot be reached.** Reported as unreachable and clearly distinct from any
  playback state, exactly as 003 established — a member is never told the show moved when the
  machine was simply unreachable.
- **The controls arrive at a game target.** They are not part of a game target's verbs. A
  game agent does not answer them, and the orchestrator never sends them to one.
- **A guild has more than one media target.** Cannot happen: 004 **rejects that configuration
  at startup**, naming the problem, precisely because the bare media commands cannot name a
  second target. The four new controls inherit that guarantee rather than working around it —
  and each one is a further reason it must keep holding (FR-013).

## Requirements *(mandatory)*

### Functional Requirements

#### The controls

- **FR-001**: The system MUST offer four media controls in addition to pause and resume:
  **next item**, **previous item**, **seek forward**, and **seek backward**. Any member of a
  guild configured with a media target MUST be able to issue any of them. Each MUST be
  issuable in **the fewest possible steps** — a bare command carrying no target argument and
  at most **one optional** argument (the seek amount) — so it can be sent from a phone in
  seconds, exactly as pause and resume are (003 FR-015).
- **FR-002**: All four MUST be **context-free**: the system MUST NOT read, inspect, store,
  name, list, or display **what** is loaded — not the item, not the file, not the playlist,
  not the position within an item, not its duration. No reply, prompt, or command description
  these controls produce may reveal what is playing. The player's **playback state**
  (playing / paused / stopped) is not content and MAY still be reported, exactly as `/status`
  already does — the ban is on knowing *what*, never on knowing *whether*.
> **CORRECTED by 007 (DECISIONS 024).** This requirement overshot the principle it was
> protecting. Only **store** belongs to it — the rest of the list (`read, inspect, name,
> list, display`) banned *observation*, which was never what "no knowledge of content"
> meant. The principle is **persistence and opinions**: nothing is remembered between
> calls, and the code never *chooses* content. Observing what the player reports in a
> response already fetched, telling the member, and forgetting it is **permitted** since
> 007. Selecting content remains forbidden, unchanged.
- **FR-003**: The system MUST NOT verify the **outcome** of a control. It MUST NOT check that
  the intended effect occurred, and a reply MUST NOT assert an outcome the system did not
  confirm — that the player advanced to a different item, or that the position landed anywhere
  in particular. Reading the player's **playback state** is explicitly **not** verification and
  is permitted (FR-006); the ban is on claiming a result.
> **CORRECTED by 007 (DECISIONS 024).** Read literally this also forbade *reporting* what
> is playing after a step — looking at all, rather than claiming. The line the principle
> draws is between **observing and reporting** (honest) and **asserting causation or
> retrying toward a desired state** (an opinion). A reply may now say what the player
> reports; it still may not claim the command caused it, and nothing retries until reality
> matches an intent.
- **FR-004**: The seek controls MUST accept an **optional amount in seconds**, defaulting to
  **30** when omitted. An explicitly supplied amount MUST be honored exactly as given.
- **FR-005**: The seek amount MUST NOT be bounded. The system MUST NOT clamp it, validate it
  against a range, cap it, or check whether the resulting position falls within the item.
- **FR-006**: The system MUST answer honestly when it does not act, in two distinct cases:
  - **(a) The player is in no state to act.** When nothing is loaded or nothing is playing, the
    control MUST be **refused honestly** — in the same terms and at the same tier as pause and
    resume already are (003 FR-008). Reveille has no intention of having any say over the
    machine when the machine is not in a state to handle it. Reading that state to decide is
    legitimate: playback state is not content, and is not outcome verification (FR-003).
  - **(b) The control could not be delivered.** When the player is unreachable or rejects the
    instruction, that MUST be reported **distinctly from any playback state** — a member must
    never be told the show moved when the player was simply unreachable.
- **FR-007**: Every control MUST acknowledge promptly (within a few seconds) with a clear
  statement of what was issued, so a member is never left guessing whether it went through.
- **FR-008**: The system MUST NEVER issue any of these controls on its own. Every one is a
  direct human command — no timers, no automatic advance, no presence tracking.

#### What stays forbidden

- **FR-009**: This feature amends **003 FR-004**, narrowing it from *no movement through
  content* to *no knowledge of content*. Blind relative movement — stepping to the adjacent
  item, moving position within the loaded item — becomes permitted. Everything that would
  give the system knowledge of, or a way to choose, content stays forbidden: selecting or
  opening a named item, enqueuing, clearing or removing playlist entries, jumping to a
  specific item, and exposing any file, library, or playlist surface.
- **FR-010**: The amendment in FR-009 MUST be recorded in `DECISIONS.md` — stating what it
  was chosen over — **before** implementation begins (Constitution V).
- **FR-011**: The bans this feature does **not** touch MUST remain in force: no volume
  control, no stop, and no OS-level termination of the player. The feature additionally
  introduces **one new ban**: the system MUST NOT seek to an **absolute** position. Movement
  through an item MUST be **relative only** — this is precisely the boundary FR-009's narrowing
  creates, and the only one this feature adds. These three, the new absolute-seek ban, and the
  narrowed content ban of FR-009, MUST stay enforced by an **automated check that fails if a
  forbidden capability reappears** — never left to human review.
- **FR-012**: The system MUST still not stream, record, or relay content anywhere (003
  FR-011). Only control instructions travel.

#### Fitting the existing system

- **FR-013**: The four controls MUST be scoped per guild exactly as pause and resume are: a
  guild sees them only if its own target set contains a media target, they act only on that
  guild's targets, and no input in one guild may reach another's (004 FR-001, FR-002,
  FR-003). The existing **at-most-one-media-target-per-tenant** invariant — enforced by
  failing loud at startup, and what makes a bare media command unambiguous — MUST continue to
  hold. These four controls **depend** on it and MUST NOT weaken it.
- **FR-014**: The addition MUST be **additive to the orchestrator↔agent contract** — every
  field and verb that exists today MUST be unchanged, so an agent built before this feature
  is unaffected in everything it already answers.
- **FR-015**: **No target identifier may enter the contract** (Constitution I). An agent's
  address remains its identity. A seek amount is a parameter *of the operation* and may
  legitimately cross the seam; a name or id identifying *which target* may not.
- **FR-016**: A game target MUST NOT answer these controls, and the system MUST NOT send them
  to one — each kind of target answers only its own verbs, exactly as established when media
  was introduced.
- **FR-017**: The feature MUST add **no network exposure** — no new inbound port, no port
  forward, no firewall change. The control path stays on the host's loopback interface.
- **FR-018**: Existing behaviour MUST be unchanged. Start, stop, status, address, pause and
  resume, and their guarantees, MUST behave exactly as they do today.
- **FR-019**: The player's real behaviour for each of these controls — the exact instruction,
  what it does at a playlist boundary, and how a relative position change is expressed — MUST
  be **observed against a real install** and recorded, not taken from documentation, before
  it is depended on. This mirrors the measurement step every previous target required.
- **FR-020**: The public homepage MUST be updated to reflect the four new controls, as a
  planned deliverable of this feature rather than a retrofit (Constitution, Development
  Workflow).
- **FR-021**: The four controls are **acting** verbs and MUST be **serialized with the existing
  acting verbs** — only one may act on a target at a time, so two controls can never race the
  player. The read-only status verb MUST remain **outside** that serialization, as today, so a
  poll is never stalled behind an in-flight control.

### Key Entities

- **Media control** (transient, per interaction): one of four relative instructions — next item,
  previous item, seek forward, seek backward. Carries no reference to content and never claims a
  result. Two of the four carry an amount; none carries an identifier.
- **Seek amount** (transient): a number of seconds accompanying a seek control. Defaults to 30
  when the member omits it. Unbounded and unvalidated.
- **Media target** (unchanged from 003/004): a controllable media player, identified by its
  agent's address, belonging to one or more guilds' target sets. Nothing about it changes here
  except the number of verbs it answers.

## Success Criteria *(mandatory)*

- **SC-001**: A member can issue all four controls from the channel and receives a clear
  acknowledgement within a few seconds, **100%** of the time the player is reachable.
- **SC-002**: **Zero** content leakage: across every reply, prompt, and command description
  the four controls can produce, the number that name, list, or describe an item, file, or
  playlist entry is **0**.
- **SC-003**: **Zero** invented outcomes and **zero** inconsistent refusals. With nothing
  loaded, all **six** media commands — the two existing and the four new — refuse in the same
  terms. In every condition where the player *is* playing but the control may not achieve
  anything (next-item at the end of the playlist, previous-item at the start, a seek amount
  that would land outside the item), the control still issues and the reply claims no result.
- **SC-004**: Seek amounts are exact: omitting the amount moves 30 seconds, and every
  explicitly supplied amount — including values far larger than the item's length — is applied
  as given, with **no** clamping or rejection observed at the player.
- **SC-005**: A guild with no media target is offered **0** of the four controls; a guild with
  one reaches **100%** of its own media targets and **0%** of any other guild's.
- **SC-006**: **Zero regressions**: every command that existed before this feature behaves
  identically afterwards, verified by the existing checks continuing to pass unchanged.
- **SC-007**: The contract remains free of target identifiers and every pre-existing verb and
  field is unchanged — verified by the seam conformance check that has held since 001.
- **SC-008**: The public homepage describes the four new controls, and describes no capability
  the system does not have.

## Assumptions

- **Seek takes explicit seconds with a default of 30, and is unbounded.** Chosen over a fixed
  30-second jump with no argument, and over a unit-times-multiplier form (`3` meaning three
  ten-second steps). Explicit seconds needs no mental arithmetic, and the default keeps the
  common case argument-free. Not bounding it is the same buyers-beware posture as the rest of
  the feature: the system does its best and reports honestly.
- **A zero or negative seek amount is passed through exactly as given** (Clarifications
  2026-08-04). This is the **thinnest possible** handling — no clamping, no magnitude
  conversion, no validation branch, no message — and Constitution III makes the minimum the
  default. The accepted consequence: a negative amount seeks the opposite way, so seek-backward
  with a negative amount goes forward. Chosen over taking the amount's magnitude (one extra
  operation, so that direction came only from which control was used) and over refusing
  non-positive amounts (a validation branch, which is the most code of the three).
- **The media commands stay bare** — no target named on the command — and this is **safe by
  construction**, not an unresolved risk. 003 assumed a single media target; 004 turned that
  assumption into an enforced invariant by **failing loud at startup** when a tenant is
  configured with more than one media target, for exactly this reason. So the ambiguity the
  bare form cannot resolve is a configuration that cannot exist. Chosen over grouping the four
  under parent commands, which would cost a step on every use to solve a problem the
  configuration model already prevents. If a tenant is ever genuinely to hold two players,
  that invariant is what must change first, and 003 FR-015 already names the fix ("the
  commands name their target the way the game commands do") — a different feature.
- **004 is the context, though it is mid-implementation.** This feature is specified against
  the per-guild target map, not 003's shared-target stopgap, and assumes 004 lands first.
- **The guild remains the trust boundary.** Any member of a configured guild may issue any of
  the four; there are no roles or per-user permissions, exactly as for every command since 001.
- **The operator still chooses what plays**, outside Discord, and queues whatever the playlist
  controls step through. Reveille never populates it.
- **Whatever the player does at a boundary is the player's behaviour**, not a guarantee of
  this feature. It is observed and recorded (FR-019) so the system's replies are honest about
  what it does and does not know — it is not specified, constrained, or corrected here.

## Out of Scope

- **Choosing what plays.** No file picker, folder browser, library, search, or playlist view.
  A "pick from a folder" capability is a plausible **future** feature and would be a genuine
  expansion of what Reveille knows about content — the opposite of this one, and specified
  separately if it is ever wanted.
- **Volume control**, **stop**, and **chapter navigation**.
- **Seeking to an absolute timestamp** or any scrubbing surface — relative movement only.
- **Letting a guild hold more than one media target.** The configuration is rejected at
  startup today and stays rejected; naming a target on a media command is a separate feature
  (see Assumptions).
- **Per-user roles or permissions** within a guild.
- **Authentication and off-box target addressing** — unchanged from 004, still a separate
  future capability.
