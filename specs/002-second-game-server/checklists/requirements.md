# Specification Quality Checklist: A second controlled game server

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-21
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

Three validation iterations were needed. What changed:

1. **Named products leaked into requirements.** The first draft had FR-025 saying
   "only `palworld.ts` may know it is Palworld" and success criteria naming
   Satisfactory's HTTPS API. Both are implementation. FR-025 now states the
   property — game knowledge stays confined to that game's adapter — without
   naming a file or a game. Satisfactory survives only in the Input, the user
   scenarios (where it is the concrete thing a player types), and one Assumption
   where the self-signed certificate is a real constraint on scope rather than a
   technique.

2. **"The commands must name which one" was untestable as written.** It described
   a mechanism, not an outcome, and left open whether a default was acceptable.
   Split into FR-018 (commands identify their target, both directions), FR-019 (no
   default — present the choice or refuse) and FR-020 (unknown name refused with
   the valid list). Each is now independently checkable.

3. **The carried-forward requirements were initially referenced rather than
   restated** ("FR-001 through FR-017 from 001 still apply"). That fails
   "testable and unambiguous" for anyone reading this spec alone, and it hid a
   real interaction: FR-011 forbids tracking connected players, which directly
   governs what status may report. They are now restated in full, with FR-011
   carrying an explicit note about status.

**Deliberately not marked as clarifications.** Three points were judged to have
sound defaults rather than needing the user:

- *How a player names the server* — argument, subcommand, or separate commands per
  server. FR-018 to FR-020 constrain the behaviour without fixing the mechanism,
  which is a planning decision.
- *Whether status reports one server or all* — resolved to all (FR-023), since
  reporting one would need a target argument and duplicate the ambiguity FR-019
  exists to prevent.
- *Whether the servers must be on one machine* — assumed same machine today,
  explicitly assumed-not-depended-upon, consistent with the architecture's
  position that only the orchestrator relocates.
