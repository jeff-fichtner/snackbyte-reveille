# Specification Quality Checklist: One console for the operator

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-10
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

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`

### Validation record — 2026-08-10

**Iteration 1** found three issues, all fixed before this checklist was marked complete:

1. **Implementation detail in the requirements.** The first draft named the spawn flags
   (`detached`, `windowsHide`, `unref()`) and the shared function `buildCommandGroups` inside
   FR-005 and FR-026. Both are *how*. Rewritten as outcomes — "MUST NOT create a visible console
   window" and "derived from the same single source Discord registration is derived from" — which
   are also what a test can actually assert. The named symbols now live only in the prose sections,
   where they are context rather than requirement.
2. **An unmeasurable success criterion.** "The desktop is not cluttered" replaced with SC-002's
   counted outcome (zero windows, down from four).
3. **An unbounded requirement.** The original log requirement said output "must be retained",
   which has no end state. Replaced by FR-028's exactly-one-prior-generation rule, which is both
   bounded and testable.

**Deliberate judgment calls**, recorded so they are not re-litigated as omissions:

- **`reveille status` also reporting agent-process state (FR-025)** is an addition beyond a
  straight mirror of Discord's `/status`. Justified because it is the one question only the local
  vantage point can answer, and an "unreachable" line that cannot say whether the agent is running
  wastes the whole advantage of being local. Flagged for `/speckit-clarify` to confirm.
- **Reusing the orchestrator's follow-up timeout as the watch bound** (Assumptions) rather than
  introducing a second setting. Same product decision, one knob.
- **The homepage is deliberately unchanged**, with the reasoning recorded in Assumptions rather
  than left silent, because the Constitution makes the site a spec deliverable and a silent
  omission would be indistinguishable from forgetting.

### Clarify record — 2026-08-10

Re-validated after `/speckit-clarify`: **16/16 → 16/16**, no item changed state. Four questions
asked and integrated; the spec grew from 35 to 36 requirements and 9 to 10 success criteria.

Two of the three judgment calls flagged above are now **settled decisions rather than open
questions**, and the notes above should be read as history:

- **FR-025 confirmed** — the agent-process report fires on unreachable only; a reachable target
  reads exactly as Discord reports it.
- **The watch bound confirmed** as the orchestrator's existing follow-up timeout. It moved out of
  Assumptions and into FR-018, because a decided thing does not belong in an assumptions list.
- **The exit-code taxonomy confirmed** at four classes, with refused and unreachable required to
  differ — a caller may retry the second and must never retry the first.

One requirement was **added** rather than confirmed: **FR-034**, `plane up` must verify each
service is actually serving and name any failure with its log. This came out of the coverage scan,
not the review loop. Removing the windows is what creates the obligation — a service that throws on
a missing env var currently fails visibly in the window it was spawned in, and would otherwise fail
silently once that window is gone. SC-010 pins it.
