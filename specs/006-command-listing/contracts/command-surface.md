# Contract: the command surface (internal — the single source)

**Feature**: `006-command-listing` · **Date**: 2026-08-05

**The orchestrator↔agent seam is not touched by this feature.** It stays at **v4** exactly as 005
left it: eight verbs, one operation parameter, `contract/src/index.ts` unchanged. `/help` contacts
no agent at all, so there is nothing to add and nothing to version (FR-017, SC-009).

The contract this feature *does* introduce is **internal to the orchestrator**, and it is the one
FR-007 and FR-008 rest on. It is written down here because it is an invariant that a future change
could silently break while every existing test still passes.

## The contract

> **There is exactly one function that decides what a guild can run.**
> Registration and the listing are both **pure derivations** of its result.
> Neither may add, omit, reorder, rename, or re-describe a command.

```
                    buildCommandGroups(tenant.servers)
                          │  the single source
            ┌─────────────┴─────────────┐
            ▼                           ▼
    flatten + toJSON()            render entries
            │                           │
   registered with Discord      shown to the member
```

## What each side may do

| | Registration | Listing |
|---|---|---|
| Read the groups | ✅ | ✅ |
| Flatten to a flat command array | ✅ | ✅ |
| Use a command's **own** name and description | ✅ | ✅ |
| Use a **subcommand's** own name and description | ✅ | ✅ |
| **Author description text** | ❌ | ❌ |
| **Add a command the other does not have** | ❌ | ❌ |
| **Filter a command the other keeps** | ❌ | ❌ |
| **Map a name to a group by lookup** | ❌ | ❌ |
| **Contact an agent or read target state** | ❌ | ❌ |

## Rules

1. **Group membership is decided once, at construction.** A command belongs to the group that
   built it. It is never recovered afterwards from its name, prefix, or shape — a lookup table
   is a second copy of the knowledge and is precisely what FR-008 forbids.
2. **An empty group does not exist.** A group is constructed only when a tenant has the kind of
   target that populates it, so there is no empty group to suppress at render time (FR-022).
3. **Descriptions are verbatim.** The listing may add structure around a description — a heading,
   an argument suffix — but never the description itself. If a description reads badly in the
   listing, the fix is to change the **registered** description, which changes both sides at once.
4. **Every registered runnable form appears exactly once, and nothing else appears.** The listing
   is a bijection with the registered surface (see [data-model.md](../data-model.md)), not an
   approximation of it.
5. **Tenancy is inherited, never re-implemented.** Both derivations take one tenant's targets as
   input. A guild's listing cannot contain another guild's commands because that guild's targets
   were never passed in — the same structural property 004 established for routing (FR-010,
   FR-011).
6. **The listing is a pure function of the tenant's targets.** No I/O, no clock, no target state.
   The same configuration renders the same listing whether every target is running or every one
   is switched off (FR-014, FR-015, SC-007).

## How this contract is enforced

Not by review. The bijection in rule 4 is checkable from one tenant configuration without Discord
and without an agent: derive both sides and compare. The check needs **no fixture of expected
description text** — and must not have one, because a fixture would be a third copy with the same
drift problem the feature exists to remove.

## What would breach it

Written out because these are the plausible future edits, and each looks harmless in isolation:

- Adding a constant like `{ start: 'Games', pause: 'Media' }` to recover grouping.
- Giving the listing "friendlier" wording than the registered description.
- Filtering a command out of the listing "because it is obvious" — the listing would then omit
  something the guild can run.
- Adding a command to the listing that is registered conditionally elsewhere.
- Reading target state to grey out or annotate an entry, which would put this command back on the
  network and make it depend on reachability.
