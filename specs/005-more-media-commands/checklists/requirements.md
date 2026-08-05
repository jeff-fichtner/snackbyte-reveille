# Specification Quality Checklist: Four more media controls, all context-free

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-04
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

**Validation run 1 — one issue found and fixed.**

- *No implementation details* initially failed on **FR-011**, which prescribed the
  enforcement mechanism ("enforced against the adapter's source") rather than the outcome.
  Rewritten to require "an automated check that fails if a forbidden capability reappears",
  which keeps the guarantee testable without naming the technique. Re-checked: passes.

**Deliberate architectural vocabulary, reviewed and kept.** The spec names the
orchestrator↔agent contract (FR-014, FR-015), the loopback interface (FR-017), and
`DECISIONS.md` (FR-010). These are not incidental leaks — they are the invariants the
project constitution makes binding on every feature (Principle I; Principle V), and they
appear the same way in the 003 and 004 specs. Removing them would drop guarantees this
feature is required to uphold. The concrete player is named only in the verbatim user
description, matching 003.

**One assumption is explicitly flagged for review** rather than raised as a
[NEEDS CLARIFICATION] marker, because a reasonable default exists: a **zero or negative seek
amount** is passed through rather than rejected. This follows from the context-free
principle, but a negative backward seek arguably means forward, which a member may not
expect. Called out in Assumptions and in Edge Cases so `/speckit-clarify` can put it to the
operator.

**Validation run 2 — corrected against 004's implementation, not just its spec.** The first
draft recorded the bare-command / multiple-media-target ambiguity as an unresolved
pre-existing risk carried forward. That is wrong: 004's implementation
(`orchestrator/src/config.ts`, commit `d7824b1`) **fails loud at startup** when a tenant has
more than one media target, for exactly this reason. The configuration the bare form cannot
disambiguate cannot exist. Corrected in the Edge Cases, Assumptions, and Out of Scope
sections, and FR-013 now requires that invariant to keep holding, since these four controls
depend on it.

**Lesson recorded**: 004 was mid-implementation at this branch's point, so its spec understated
what shipped. Cross-artifact checks against 004 should read the committed code, not only
`specs/004-tenant-isolation/spec.md`.

**Validation run 3 — after `/speckit-clarify`. 16/16 → 16/16, no state changes.** Three
clarifications were integrated and one of them rewrote a core requirement:

- **FR-003 was wrong, not merely imprecise.** It banned checking *beforehand* whether a control
  was possible. The clarified principle is that context-free means no knowledge of **content**,
  not of **state** — Reveille may read playback state (it already publishes it via `/status`)
  and decline when the player is in no state to act, because it has no *intention* of
  overriding a machine that cannot act. Non-verification now applies strictly to the
  **outcome**. FR-003, FR-006, the Overview, one Edge Case, one acceptance scenario, SC-003 and
  the Key Entities wording were all brought into line; no "blind"/"no pre-check" language
  remains.
- **FR-021 added**: the four controls serialize with the existing acting verbs; the read-only
  status verb stays outside that serialization.
- The zero/negative seek assumption moved from "flagged for review" to a decided assumption
  with its rejected alternatives recorded, so *No [NEEDS CLARIFICATION] markers remain* and
  *Dependencies and assumptions identified* both still pass.

Requirement count is now 21 FRs and 8 SCs.
