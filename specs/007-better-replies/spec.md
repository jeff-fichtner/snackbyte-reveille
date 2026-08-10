# Feature Specification: Replies that serve the reader

**Feature Branch**: `007-better-replies`

**Created**: 2026-08-08

**Status**: Draft

**Input**: User description: "Replies that serve the reader, not the system. Three threads: (A) the replies stop explaining the system — the orchestrator writes every word a member reads and an agent's message is a diagnostic, never displayed; (B) `/next` and `/previous` take a count, same rules as the seconds argument; (C) the replies carry what the player already tells us — both titles and position/duration. The principle underneath is mechanism-not-policy and level-triggered-not-edge-triggered: the rule was always about persistence and opinions, never about observation, and the existing text overshoots it."

## Overview

Reveille's replies currently explain **how Reveille works** to people who only want to know **what
happened**. A member who asks for an address is taught about port forwarding; one whose command
fails is shown `ECONNREFUSED`; one who asks what is running is told about "targets".

At the same time the replies withhold things the reader would obviously want. `/next` says
*"Skipping to the next thing"* when the player could say what it moved to. `/forward` says
*"Jumping forward 30s"* without saying where that landed.

Both halves are the same mistake pointed in opposite directions: **the replies are written from the
system's point of view.** This feature rewrites them from the reader's, adds a count to the two
stepping commands so they behave like the seek pair already does, and — because it is the same
sentence being rewritten — surfaces what the player already reports.

## The principle, restated

This feature exists partly because the principle got written down more broadly than it was meant.

**Reveille is mechanism, not policy.** It supplies the ability to act; the operator supplies every
decision about *what* to act on. **And it is level-triggered, not edge-triggered**: each call
observes current reality, acts, and forgets. No command tracks transitions, remembers what it saw,
or depends on what another command did.

That is what "no knowledge of content" (DECISIONS 022) was always protecting: a rule about
**persistence and opinions**, never about **observation**.

**The existing text overshoots it, in two places.**

- **005's FR-002** forbids the system to *"read, inspect, store, name, list, or display"* what is
  loaded. Only **store** belongs to the principle — alongside the separate rule that the code never
  **chooses** content. 006's FR-013 and SC-006 inherited this, and tests now enforce it.
- **005's FR-003** forbids checking *"that the intended effect occurred"*. Read literally that also
  blocks this feature, because reporting what is playing **after** a step means looking at the
  player once the command has run. The distinction the principle actually draws is between
  **observing and reporting** — which is honest — and **asserting causation** or retrying until a
  desired state is reached, which is having an opinion. The first is permitted; the second stays
  forbidden (FR-010).

| | Status after this feature |
|---|---|
| **Storing** anything about content between calls — cache, memo, "last seen" | **Forbidden** (unchanged) |
| **Choosing** content — naming, opening, enqueuing, clearing, jumping to an item | **Forbidden** (unchanged) |
| One command **depending on** another's leftovers | **Forbidden** (unchanged) |
| **Observing** what the player reports, telling the member, and forgetting it | **Permitted** — the correction |

Per Constitution V this MUST be recorded in `DECISIONS.md` before implementation: a recorded
decision is being changed.

## Clarifications

### Session 2026-08-08

- Q: Should the replies carry titles, position/duration, or both? → A: **Both.** Titles name what is playing; position and duration say how far in. The disclosure consequence — filenames appearing in a shared channel — is accepted deliberately.
- Q: How much should the orchestrator decide before contacting an agent? → A: **Every product decision** — defaults, sign handling, which verb to use, and all wording. The agent receives an already-decided instruction.
- Q: A tagged file reports a real title; an untagged one reports only its filename. Which does the reply show? → A: **The title when there is one, the filename when there is not, and nothing when there is neither.** Some name beats no name for an untagged library.
- Q: How should the all-targets status reply lay out now that media targets carry a title and position? → A: **One line per target, detail inline.** It preserves what that reply is for — a glance across everything — and leaves game targets exactly as they read today.
- Q: Does that make the agent a passive executor of whatever the orchestrator defines? → A: **No, and the distinction is load-bearing.** The division is: **the orchestrator decides *when* and *with what*; the agent decides *whether* and *how*; the contract fixes *what can be asked at all*.** The agent keeps three things: whether it *can* act (it reads state and refuses — nothing loaded is a refusal, and a target of the wrong kind does not answer at all); *how* the action is performed for its particular target (only the adapter knows which player it is); and the **guarantees that must not be negotiable** — a stop saves first, a process is never killed, and malformed input is refused at the door. Those are not the orchestrator's to relax, which is why some of them have **no verb at all** rather than a verb the orchestrator is trusted not to call.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The reply tells me what happened, not how it works (Priority: P1) 🎯 MVP

A member runs a command. Something goes wrong, or nothing does. Either way the reply says what
happened in words that mean something to them, and never mentions a component, protocol, or
internal noun they have no reason to know exists.

**Why this priority**: It is the largest and most visible half of the feature, it touches every
command including the game ones, and it delivers standalone value with the other two threads
absent. It also establishes the rule the other threads' new text must follow.

**Independent Test**: Trigger each failure and no-op branch of every command and read the replies.
No reply contains a status code, an errno, or the words *agent*, *target*, or *host*. Delivers
readable replies with the count and the player detail unbuilt.

**Acceptance Scenarios**:

1. **Given** a machine that cannot be reached, **When** a member runs any command against it, **Then** the reply says the machine could not be reached and suggests trying again — and names no component, protocol, or error code.
2. **Given** a command that fails on the host, **When** the reply is shown, **Then** it states what did not happen in the member's terms, and the underlying diagnostic appears **only** in the operator's log.
3. **Given** `/address`, **When** the reply is shown, **Then** it gives the address and says it can change — and does not explain port forwarding, VPNs, or how the address was determined.
4. **Given** any command description in the picker, **When** a member reads it, **Then** it describes what the command does for them, using no internal vocabulary.

---

### User Story 2 - The reply says what is playing and where (Priority: P2)

A member pauses the show and the reply names what was paused. They jump back thirty seconds and
the reply says where that landed. They ask for status and see what is playing and how far in.

**Why this priority**: Real, frequently-wanted value, and the reason the reader reaches for these
commands at all. It rates below US1 because a reply that reads badly is worse than one that is
merely sparse, and because US1 sets the voice this text has to match.

**Independent Test**: With something playing, run each media command and confirm the reply names
the item and states the position where each naturally applies. With a stream or an untitled file,
confirm the reply simply omits what is unavailable rather than inventing or erroring.

**Acceptance Scenarios**:

1. **Given** something is playing, **When** a member runs `/status`, **Then** the reply says what is playing and how far into it the player is.
2. **Given** something is playing, **When** a member steps to another item, **Then** the reply says what is playing now — observed, not asserted to be the step's result.
3. **Given** something is playing, **When** a member seeks, **Then** the reply says where the position now is.
4. **Given** an item with no title (a stream, an untitled file), **When** any of the above runs, **Then** the reply omits the missing part and still reads as a complete sentence.
5. **Given** two identical commands in succession, **When** both replies are read, **Then** each reflects a fresh observation — nothing is remembered or compared between them.

---

### User Story 3 - Stepping takes a count (Priority: P3)

A member three episodes ahead of where they meant to be types the previous-item command with a
`3` instead of running it three times.

**Why this priority**: A genuine convenience and the smallest of the three, entirely additive to
commands that already work. It is also the only thread that touches the seam, so isolating it last
keeps the other two free of that risk.

**Independent Test**: With a multi-item playlist, step with an explicit count and confirm the
player moves that many items; step with a negative count and confirm it moves the other way and
the reply says so.

**Acceptance Scenarios**:

1. **Given** a multi-item playlist, **When** a member steps with no count, **Then** the player moves one item, exactly as today.
2. **Given** a multi-item playlist, **When** a member steps forward with a count of 3, **Then** the player moves three items and the reply says how many and which way.
3. **Given** a member supplies a **negative** count, **When** the command runs, **Then** the player moves the **opposite** way and the reply states the direction it actually went.
4. **Given** a count that is not a whole number, or too large to be handled exactly, **When** the command is sent, **Then** it is refused with a message naming the argument — never silently adjusted.

---

### Edge Cases

- **Nothing is loaded.** The media commands refuse as they do today, and the refusal names no item because there is none. Unchanged by this feature.
- **A file with no title but a filename.** The filename is shown. It is the only name that exists, and some name serves the reader better than none.
- **A stream with neither title nor filename.** The reply omits the name rather than showing a placeholder or an empty pair of quotes.
- **A very long name.** The filename fallback is where long names come from — a release filename can exceed a phone's line width unaided, and the status reply puts it inline. It is shortened for display, visibly, so a reader can tell they are seeing part of a name rather than the whole of a strange one.
- **A live stream with no duration.** Position is reported without a total, rather than showing a nonsense total.
- **A count of zero.** Passed through as given, exactly as a seek of zero is: the thinnest handling, no special case.
- **A very large count occupies the target until an operator intervenes.** Accepted
  deliberately, and recorded rather than fixed (`research.md` §3a). The acting commands for
  that one player queue and never run; `/status` keeps answering; nothing crashes and no
  other target is affected; recovery is restarting the agent. This is a consequence of
  "unbounded" (FR-016) meeting "indivisible" (FR-019), and both stand.
- **A very large count.** Not clamped. The player does what it does, and the reply claims no result — the same posture as an over-long seek.
- **The player becomes unreachable between acting and reporting.** The reply says the command was sent and that the player could not be asked about the result. It never guesses.

## Requirements *(mandatory)*

### Functional Requirements

#### The replies serve the reader

- **FR-001**: No reply, footnote, or command description shown to a member may contain a **status code, error code, or errno**.
- **FR-002**: No reply, footnote, or command description may name an **internal component or concept** — the agent, the seam, a target, a host, or a port.
- **FR-003**: A reply MUST state **what happened or did not happen**, not the mechanism by which the system works. Where the reader can do something about it, the reply MUST say what.
- **FR-004**: The system MUST NOT list **causes the reader cannot act on**. Where several causes are indistinguishable to the reader, the reply says the outcome once.
- **FR-005**: **The orchestrator MUST author every word a member reads.** Text originating at a target's controller MUST NOT be displayed. This governs **presentation and product decisions only** — it MUST NOT be read as making the controller a passive executor: it keeps deciding whether it can act, how the action is performed for its target, and the guarantees that are not the orchestrator's to relax (FR-007, and Constitution IV's graceful-stop rule).
- **FR-006**: Diagnostic detail MUST still be **available to the operator** — recorded where they can find it, never shown in the channel.
- **FR-007**: Existing guarantees the replies already carry MUST survive rewording: a start never claims the server is up; a failed stop still says the server is **still running**; a refusal still reads as a refusal and not a failure.

#### The replies carry what the player reports

- **FR-008**: Where a media command acts on or reports the player, the reply MUST include **what is playing** and **how far into it** the player is, when the player supplies them.
- **FR-008a**: The all-targets status reply MUST remain **one line per target**, with any additional detail carried inline on that line. A target of one kind MUST NOT change how a target of another kind reads — a reader who only runs game targets MUST see exactly what they see today.
- **FR-009**: The name shown MUST be the player's **title** where it supplies one, its **filename** where it does not, and **nothing at all** where it supplies neither. Where a duration or position is unavailable, the reply MUST **omit that part** and remain a complete, readable sentence. It MUST NOT substitute a placeholder or a guess.
- **FR-009a**: A name long enough to harm readability MUST be **shortened for display**, in a way that is visibly a shortening rather than passed off as the whole name. This matters because the filename fallback is where long names come from — a release filename can exceed a phone's line width on its own.
- **FR-010**: Reported detail MUST be an **observation, not a claim**: the reply MUST NOT assert that a command caused what is now observed.
- **FR-011**: The system MUST NOT **store** anything it observes about content — no cache, no memo, no "last seen". Every reply reflects a fresh observation.
- **FR-012**: The system MUST NOT **choose** content — it may not name, open, enqueue, clear, remove, or jump to an item. Selecting what plays remains the operator's job.
- **FR-013**: No command may **depend on** another command's prior effect or leftovers. (A command's *own* deferred continuation — the existing start follow-up, which reports later on the launch it issued — is not a dependency on another command and is unaffected.)
- **FR-014**: FR-011 and FR-012 MUST stay enforced by an **automated check that fails if a forbidden capability reappears**, never by review.

#### Stepping takes a count

- **FR-015**: The two stepping commands — **next item** and **previous item** — MUST accept an **optional count**, defaulting to **1**. The seek pair already takes an amount and is unchanged by this thread.
- **FR-016**: The count MUST NOT be bounded — not clamped, capped, or range-checked.
- **FR-017**: A **negative** count MUST move the opposite way, and the reply MUST state the direction actually taken rather than the one the command name implies.
- **FR-018**: A count that is missing, not a whole number, or too large to handle exactly MUST be **refused with a message naming the argument** — never silently adjusted.
- **FR-019**: A multi-item step MUST be **one indivisible operation**: no other command may act on the player midway through it.

#### Fitting the existing system

- **FR-020**: The clarified principle MUST be recorded in `DECISIONS.md`, superseding what 022 was taken to mean, **before** implementation begins (Constitution V).
- **FR-021**: Requirement text that overshot the principle MUST be corrected where it lives, so no document forbids what the system now does. This covers **both** overshoots named above — the ban on *reading and displaying* content, and the ban on *looking after acting* — wherever each is stated or enforced.
- **FR-022**: The addition MUST be **additive to the orchestrator↔agent contract**: every existing field and verb unchanged, and a target that supplies no detail MUST still work.
- **FR-023**: **No target identifier may enter the contract** (Constitution I).
- **FR-024**: The feature MUST add **no new configuration** and **no new network exposure**.
- **FR-025**: Behaviour not named here MUST be unchanged — the game lifecycle guarantees, per-guild scoping, and the command listing all behave exactly as they do today.
- **FR-026**: The public homepage MUST be updated, both for the new behaviour and to correct the claim that the system never sees what is loaded (Constitution, Development Workflow).

### Key Entities

- **Reply** (transient, per interaction): what a member reads — an outcome in their terms, optionally the item and position observed at the time. Authored by the orchestrator; discarded after sending.
- **Diagnostic** (transient): the technical detail behind a failure. Recorded for the operator, **never** part of a reply.
- **Observed detail** (transient): the title, position and duration a player reports when asked. Read, used once, never stored.
- **Step count** (transient): how many items to move, defaulting to 1. Signed — the sign is the direction. Unbounded and unvalidated beyond being a whole number.

## Success Criteria *(mandatory)*

- **SC-001**: **Zero** replies, footnotes, or command descriptions contain a status code, an error code, or an internal component name.
- **SC-002**: For every failure branch of every command, a member can say what happened and what to do next, using only the reply.
- **SC-003**: **100%** of failures that produce a member-visible reply also leave the technical detail available to the operator.
- **SC-004**: Every reply that reports on the player names what is playing and how far in, in **100%** of cases where the player supplies them, and omits **only** what is unavailable.
- **SC-005**: **Zero** invented detail: no placeholder title, no fabricated duration, no asserted outcome.
- **SC-006**: **Zero** retained content: across any sequence of commands, nothing observed about content is carried into a later reply.
- **SC-007**: **Zero** content-selection capability: the number of ways to name, open, enqueue, clear, remove, or jump to an item remains **0**.
- **SC-008**: Stepping with a count of N moves exactly N items, for every N tried including negatives, with **0** clamping observed.
- **SC-009**: A multi-item step is never interleaved with another command acting on the same player.
- **SC-010**: **Zero regressions**: every guarantee that existed before this feature holds afterwards, verified by the existing checks continuing to pass.
- **SC-011**: The contract remains free of target identifiers, and every pre-existing field and verb is unchanged.
- **SC-012**: **Zero** new configuration values and **zero** new network exposure.
- **SC-013**: The public homepage describes the new behaviour and contains no claim the system contradicts.
- **SC-014**: **Zero commands depend on another**: for any pair of commands, running one first changes nothing about what the other does or reports, beyond what the player itself now is.
- **SC-015**: **Zero documents forbid what the system does**: across every requirement document in the repository, the number of requirements contradicting this feature's permitted behaviour is **0** — measured by re-reading the requirements this feature corrects, not by assuming.
- **SC-016**: The all-targets reply is **one line per target**, for every combination of target kinds an operator can configure, and a configuration of game targets alone produces a reply **identical** to the one it produces today.
- **SC-017**: **Zero unbounded names**: no name reaches a reader at a length that breaks the one-line-per-target layout, and every shortened name is recognisable as shortened.

## Assumptions

- **Position renders as elapsed against total** (`12:04 / 44:31`), dropping to elapsed alone where the player reports no total, as a live stream does. Assumed rather than asked: it is the convention every player already uses, and a percentage answers "how far in" less usefully than a timestamp a reader can act on. Hours appear only when the item runs past an hour, so the common case stays short enough to sit inline.
- **Both titles and position are reported.** Chosen over position alone. Position is useful and discloses nothing; titles are what a reader actually asks for. Dialling back to position alone would be a small change per reply if it proves unwelcome.
- **Falling back to the filename makes disclosure the normal case, not an edge case.** Where a library is untagged, *every* reply shows a filename — including whatever the file is named, which is often more than a title would say. This is accepted deliberately as the price of the feature being useful on a real library rather than only a well-tagged one, and it is recorded here because it is the part that is awkward to reverse once people have seen it. The narrower alternative — show the title or nothing — was offered and declined.
- **The orchestrator decides everything before contacting a target.** Defaults, sign handling, which verb to use, and all wording. The agent receives an already-decided instruction.
- **The agent still refuses malformed input.** This is not duplicated processing: the seam is a real boundary, and a component that trusts its caller is how a bad value silently becomes wrong behaviour. It has already prevented one destructive case.
- **Diagnostics go to the operator's log**, which is where operational detail already goes, rather than to a new surface.
- **The reply is one line where it can be.** These are read on a phone mid-show; detail that does not help the reader act is not detail worth adding.
- **The guild remains the trust boundary.** Any member of a configured guild may issue any command, and now sees what is playing. There are no per-user permissions, exactly as since 001.
- **Nothing here changes what the commands do** — only what they say and how many items a step covers.

## Out of Scope

- **Choosing what plays** — no picker, browser, library, search, or playlist view. Still the opposite feature.
- **Volume, stop, and chapter navigation.**
- **Seeking to an absolute timestamp.** Position is *reported*; it still cannot be *set* directly.
- **Remembering anything** — no history, no "what was playing", no resume-where-you-left-off. Each call observes and forgets.
- **Per-user permissions or hiding titles from particular members.** The guild is the boundary; if a title should not be visible, it should not be playing on a guild-controlled player.
- **Localisation or configurable wording.**
- **Authentication and off-box addressing** — unchanged, still a separate future capability.
