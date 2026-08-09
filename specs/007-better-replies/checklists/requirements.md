# Specification Quality Checklist: Replies that serve the reader

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-08
**Feature**: [spec.md](../spec.md)

## Content Quality

- [X] No implementation details (languages, frameworks, APIs)
- [X] Focused on user value and business needs
- [X] Written for non-technical stakeholders
- [X] All mandatory sections completed

## Requirement Completeness

- [X] No [NEEDS CLARIFICATION] markers remain
- [X] Requirements are testable and unambiguous
- [X] Success criteria are measurable
- [X] Success criteria are technology-agnostic (no implementation details)
- [X] All acceptance scenarios are defined
- [X] Edge cases are identified
- [X] Scope is clearly bounded
- [X] Dependencies and assumptions identified

## Feature Readiness

- [X] All functional requirements have clear acceptance criteria
- [X] User scenarios cover primary flows
- [X] Feature meets measurable outcomes defined in Success Criteria
- [X] No implementation details leak into specification

## Notes

**28 functional requirements · 17 success criteria · 3 user stories.**

**Clarification session (2026-08-08) — 2 questions, and the interesting part is what they did together.**

Asked and answered: (1) the name shown is the **title where there is one, the filename where there is
not, nothing where there is neither**; (2) the all-targets reply stays **one line per target, detail
inline**.

Neither answer is remarkable alone. **Together they are the pairing most likely to break the layout** —
falling back to filenames is exactly where long names come from, and inline is exactly where a long name
does damage. Nothing in either question surfaced that, so it was recorded rather than left to be
discovered during implementation: **FR-009a** (long names shortened, visibly) and **SC-017** (no name
breaks the layout). **FR-008a** and **SC-016** pin the layout itself and add the regression guarantee
that a game-only configuration reads *identically* to today — a media target must not change how a game
target looks.

Three edge cases replaced one: the previous single "stream or untitled file" case assumed title-or-
nothing, which the fallback answer invalidated. It now splits into *filename present*, *neither present*,
and *name too long*.

**A disclosure trade-off got stronger and was re-recorded, not left as written.** The spec already
accepted "a filename appearing in a shared channel" — but as an *edge* case. With the fallback, an
untagged library shows a filename on *every* reply, which is the normal case and often says more than a
title would. The Assumptions entry now states that, and notes the narrower option was offered and
declined, so a later reader sees a decision rather than an oversight.

**Position format was assumed, not asked** — elapsed against total, elapsed alone where there is no
total. Recorded in Assumptions with its reasoning, because a question with an obvious convention behind
it is not worth one of five slots.

**Review loop — four further fixes, one of them substantive.**

- **A second overshoot was missed.** The spec identified 005 FR-002 (the ban on *reading and
  displaying* content) but not **005 FR-003**, which forbids checking *"that the intended effect
  occurred"*. Read literally that also blocks this feature, because reporting what is playing
  **after** a step means looking at the player once the command has run. The principle's real line
  is between **observing and reporting** (honest) and **asserting causation or retrying toward a
  desired state** (an opinion). Both overshoots are now named, and FR-021 explicitly covers both.
  Missing this would have left the feature contradicting a requirement nobody had corrected.
- **FR-013 could have been read as outlawing the start follow-up.** "No command may depend on
  another command's prior effect" — a reader could take the US3 follow-up for a violation. It is a
  command's *own* deferred continuation, not a dependency on another command. Carve-out added so a
  future implementer does not "fix" working behaviour.
- **FR-013 had no acceptance scenario or success criterion** → **SC-014** added.
- **FR-021 had none either** → **SC-015** added, and deliberately worded to require *re-reading* the
  corrected requirements rather than assuming they were corrected.

**Traceability re-checked**: every FR now maps to at least one acceptance scenario or success
criterion, except **FR-020** (record the decision in `DECISIONS.md` before implementation), which is
a process gate carried by the task list rather than an outcome — the same shape 005's FR-010 had.

**Validation run 1 — one fix applied.**

- **FR-015 named no commands.** It required "the stepping commands" to take a count without ever
  saying which they are, leaving a reader unable to tell what US3 changes. Now names next-item and
  previous-item explicitly, and states that the seek pair is unchanged by that thread.

**A deliberate quality result worth recording**: a scan for implementation detail returned **zero
hits** — no player product name, no protocol, no command internals, no wire format. This spec
describes *what a reader receives* throughout, which is unusual for a feature whose whole subject
is the wording of replies. The commands themselves are named in the narrative (Overview, user
stories) because a command name is user-facing behaviour rather than an implementation choice.

**Two things this spec does that are not typical, both on purpose:**

- **It corrects earlier requirement text rather than only adding new text.** FR-021 exists because
  005 FR-002 and 006 FR-013/SC-006 forbid what this feature does. Leaving them would mean shipping a
  system whose own specs contradict it, and tests currently *enforce* the overshoot.
- **It records a disclosure consequence as a chosen trade-off** (titles appearing in a shared
  channel) rather than burying it. That belongs in the spec because it is a product decision, not an
  implementation detail — and because it is the one part that is awkward to reverse after people
  have seen it.

**On the orchestrator/controller division.** FR-005 was tightened during drafting after a direct
question: it governs *presentation and product decisions only*, and explicitly does **not** make a
target's controller a passive executor. The controller keeps deciding whether it can act, how the
action is performed for its target, and the guarantees that are not the orchestrator's to relax.
Getting that wrong would have quietly undermined Constitution IV.
