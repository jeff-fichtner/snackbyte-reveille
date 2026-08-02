---
description: "Recursively review an artifact (spec, cross-artifact analysis, or code), fix the unambiguous issues, surface the judgment calls, and hand off"
argument-hint: "Optional target: spec (default) | analysis | code"
---

# Review Loop — the engine's review stage (spec | analysis | code)

One recursive-review pattern with **three targets** — the review stage of Constitution VII
(work → self-review → self-test → handoff). The recursion is identical for every target; only
*what is read*, *where the critique comes from*, and *what "fixable" means* differ:

- **`spec`** (default) — runs as the `after_specify` hook: review the just-written `spec.md`.
- **`analysis`** — runs as the `after_analyze` hook: apply the findings of the just-completed
  `/speckit-analyze` report to `spec.md` / `plan.md` / `tasks.md`. (This target is the former
  `analyze-autofix` extension: analyze itself is read-only; this is its write half.)
- **`code`** — invoked by `/speckit-engine-verify`: review the implemented **code + tests** for
  the active feature.

## Resolve the target

Read the target from the argument (`$ARGUMENTS`): `code` or `analysis` select those targets;
anything else (including empty) defaults to `spec`. When fired as a hook with no argument, the
dispatching moment implies it: `after_specify` → `spec`; `after_analyze` → `analysis`.

## The loop (same for all targets)

1. **Review** — obtain the critique for the target:
   - **spec**: review `spec.md` for internal consistency, vague/placeholder language, missing
     acceptance criteria, terminology drift, constitution alignment.
   - **analysis**: on the first pass, take the findings table from the just-completed
     `/speckit-analyze` run (do not redo work that was just done); on later passes, re-run the
     cross-artifact analysis to recompute findings.
   - **code**: review correctness against the spec/plan/tasks, obvious bugs, dead or
     contradictory code, missing/mismatched tests for the tasks just implemented, violations of
     the constitution (e.g. deterministic logic that belongs in a tested `scripts/bash/*.sh`),
     and anything the feature's `tasks.md` required but the code does not do.
2. **Fix** every issue that has a **single obvious correct resolution** — regardless of severity
   label — by editing the relevant artifact(s) (spec, plan, tasks, or code/tests).
3. **Repeat** from step 1 on the updated artifact(s).
4. **Terminate** when a pass finds no new unambiguous fixes, OR when the only remaining issues
   need a product/user decision (spec, analysis) or a judgment call the human must make (code) —
   then surface those. Always terminate (bounded passes); never loop indefinitely. Never decide
   a product question by picking an option.

## Handoff (all targets — the Constitution VII shape)

End every run by presenting, in the flow:
- what was reviewed (target + artifacts);
- **Fixed automatically** — each fix applied, one line each;
- what was re-checked after fixing (the pass that came back clean);
- **Needs your attention** — only the judgment calls, with just enough context to decide.

For `analysis`, note that the lifecycle advances to `ready` at this event's tracker sync — the
human gate that follows is approving the design by running `/speckit-implement`.

## Contract for the `code` target (used by `/speckit-engine-verify`)

- Return a clear **pass/needs-attention** signal: *pass* = nothing fixable remains and no
  attention-needing findings; *needs-attention* = at least one unresolved finding that requires
  the human. `/speckit-engine-verify` treats *needs-attention* as a stop (does not advance to
  `in-review`).
- Never advance any tracker state itself — that is the verify command's job.
- Never modify repo artifacts based on tracker state (Constitution I).
