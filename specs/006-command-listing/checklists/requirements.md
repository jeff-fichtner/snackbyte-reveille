# Specification Quality Checklist: A command that lists the commands you can run

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-05
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

**Review loop — three further fixes (traceability).** A sweep of every requirement against the
acceptance scenarios and success criteria found **four requirements with nothing testing them**:

- **FR-005** (the reply is visible only to the asker) had no scenario at all → added **US1 AC5**.
- **FR-016** (never self-issues), **FR-018** (no new configuration) and **FR-019** (no new network
  exposure) had no success criterion → added **SC-011**, covering the "adds nothing and does
  nothing unasked" set with countable zeroes.
- **US2 AC4** now cites **004 FR-006** rather than gesturing at "every other command".

All three 004 citations used in this spec were checked against 004's own text before being
trusted: FR-002 (isolation), FR-003 (the command surface a guild sees), FR-005 (tenancy by
configuration), FR-006 (unconfigured guild ignored). All correct.

**Clarification session 2026-08-05 — two answers integrated, 16/16 still passing.**

- **Entry granularity was undefined.** The game verbs register as subcommands per target, so a
  derived listing had to choose between `/start` and `/start palworld` and the spec never said.
  Resolved to **one line per runnable form** → FR-002 rewritten, US1 AC1 made concrete, SC-012
  added ("every entry is directly usable").
- **Ordering was undefined.** Resolved to **grouped by target kind**, deriving from the `kind`
  already in configuration so no separate categorisation is maintained → **FR-022** added,
  including that an empty group must not render.
- A second edge case was added for a guild with many game targets, where the listing grows per
  target — the accepted cost of every entry being runnable.

**FR-012 is no longer an untested `MAY`.** The clarification made it a `MUST`: because every entry
is a runnable form, and a game command's runnable form contains its target, the listing necessarily
names a guild's own targets. It is now covered by US1 AC1 and SC-012, and still sits cleanly
between FR-011 (never another guild's targets) and FR-013 (never content).

**No `DECISIONS.md` entry is required.** Constitution V compels one for a seam change, a candidate
being chosen, or a deferred question being closed. This feature does none of those — the seam and
the agent are untouched (FR-017) — and the spec does not imply otherwise.

**Validation run 1 — one fix applied.**

- **FR-003 assumed every argument is optional.** It required each entry to "say the argument is
  optional and state the default". That is true of the system today — `/forward` and `/back` carry
  the only argument there is, and it is optional — but the requirement would have mislabelled a
  future required argument as optional. Rewritten to name the argument, say *whether* it is
  optional, and give the default only when one applies.

**Two soft spots accepted deliberately, both with precedent:**

- **FR-006 "promptly (within a few seconds)"** is loose on its own, but it is the same phrasing
  005 FR-007 uses and SC-001 pins it to a measurable outcome.
- **FR-012 is a MAY, not a MUST**, so it is a permission rather than a testable obligation. It
  exists to resolve the boundary between FR-011 (no other guild's targets) and FR-013 (no
  content) by stating that a guild's *own* target name is neither — which is the ambiguity a
  reader would otherwise hit.

**On FR-008 and the implementation-detail line.** FR-008 requires the listing be produced from the
same definition of the command surface used to make commands available, so no second description
exists to drift. That names an *outcome* (there is no second copy) rather than a mechanism, and
without it FR-007 would be untestable — "must not drift" cannot be verified, whereas "there is no
separately-maintained copy" can. Same shape as 005 FR-011, which requires the content bans be
"enforced by an automated check" without prescribing the check.

**Scope check.** Zero [NEEDS CLARIFICATION] markers were needed: every open question in the input
had a defensible default, and each is recorded in Assumptions with what it was chosen over — the
command name (`/help` over `/commands`), reply visibility (ephemeral over public), and depth
(one line per command over a manual).
