# Review Loop Extension

The engine's **review stage** (Constitution VII: work → self-review → self-test → handoff).
One recursive loop, three targets:

| Target | When | Reviews |
|---|---|---|
| `spec` (default) | `after_specify` hook | the just-written `spec.md` |
| `analysis` | `after_analyze` hook | applies `/speckit-analyze`'s cross-artifact findings to `spec.md`/`plan.md`/`tasks.md` |
| `code` | invoked by `/speckit-engine-verify` | implemented code + tests for the active feature |

> Lineage: merged 2026-07-26 from two extensions — `specify-review-loop` (spec/code) and
> `analyze-autofix` (the write half of the read-only `/speckit-analyze`). They shared one
> algorithm and differed only in bindings.

## Loop behavior

- Each pass: review → apply all single-obvious-fix changes → decide whether to loop again.
- **Terminates** when a pass produces no new unambiguous fixes, or the only remaining findings
  need a user decision. Bounded to a small number of passes so it always terminates.
- **Auto-fixes** any issue with one obvious correct resolution (terminology, placeholders,
  structure, exact duplicates) regardless of severity.
- **Surfaces** anything requiring judgment (conflicting requirements, vague targets that are
  product decisions, MUST conflicts that change scope). Never decides a product question.
- **Hands off** in the Constitution VII shape: what was reviewed, Fixed automatically, what was
  re-checked, Needs your attention.

## Commands

| Command | Description |
|---------|-------------|
| `speckit.review-loop.run` | Recursively review-and-fix the target (`spec` \| `analysis` \| `code`) until clean or blocked on the user, then hand off. |

## Hook wiring

Registered in `.specify/extensions.yml` as a **required** hook at two events:

- `after_specify`, priority 5 — target `spec`; runs **first** at the event, before the ClickUp
  provision (10) / sync (15) and the chained `/speckit-clarify` (20).
- `after_analyze`, priority 10 — target `analysis`; runs **before** the ClickUp sync (15) that
  records the `analyzed` marker, so `ready` certifies the post-fix artifacts.

The `code` target is not hook-wired: `/speckit-engine-verify` invokes it directly as step 1 of
certification and consumes its **pass/needs-attention** contract.

## Disable

Remove (or set `enabled: false` on) the `review-loop` entries in `.specify/extensions.yml`.
