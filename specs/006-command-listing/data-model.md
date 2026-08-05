# Phase 1 — Data model: a command that lists the commands you can run

**Nothing here is stored, and nothing here is new information.** Every entity is a *view* of the
command surface the orchestrator already computes for registration. That is the point: a value
that is derived cannot disagree with its source.

## Entities

### 1. Command group (the new single source)

An ordered, named bundle of commands that act on one kind of target. **This is the value
registration and the listing both derive from** — not a listing concept that registration happens
to be compatible with.

| Field | Type | Notes |
|---|---|---|
| label | text | The heading a member sees — "Games", "Media", or the one for commands belonging to no kind |
| commands | command builders | The commands this kind contributes, in construction order |

**Groups are only constructed when they have contents.** The media group exists only when the
tenant has a media target, exactly as today's `if (media)` branch already decides — so an empty
group cannot be rendered because it cannot exist (FR-022).

**Ordering** is the construction order: targets first (games, then media), then the commands
belonging to no target kind. It is deliberate, not incidental — a member scanning for "how do I
control the thing I came here for" reads the target groups first.

### 2. Command entry (transient, per interaction)

One line of the listing: a **runnable form** and its description.

| Field | Type | Notes |
|---|---|---|
| form | text | Exactly what a member types — `/start palworld`, `/forward [seconds]`, `/pause` |
| description | text | Taken verbatim from the command or subcommand it came from. **Never authored here.** |

**Derivation is total** — every command produces at least one entry, by one of two rules:

| Shape of the registered command | Entries produced |
|---|---|
| Has subcommands (`/start` → `palworld`, `satisfactory`) | **One per subcommand**, `"/parent sub"`, using the **subcommand's** description |
| Has options (`/forward` → `seconds`) | **One**, with the option appended — `[name]` when optional, `<name>` when required |
| Bare (`/pause`, `/status`, `/help`) | **One**, using its own description |

The subcommand rule is why FR-012 needs no separate work: a game command's runnable form contains
its target because the *registered* form does.

### 3. Guild command surface (existing, unchanged)

The set of commands a tenant's targets produce. This feature **reads** it and adds one command
(`/help`) to it. It introduces no new concept and changes no existing one.

## The invariant this whole model exists to hold

> **Every entry in the listing corresponds to exactly one registered runnable form, and every
> registered runnable form corresponds to exactly one entry.**

A bijection, not an agreement to be maintained. It holds because both sides are computed from one
value by pure functions — there is no writing-down step where they could diverge.

The testable consequence, and the shape the tests should take: for any tenant configuration,
*derive the registered set, derive the listing, and compare*. No fixture of expected description
text is needed, and none should be written — a fixture would be a third copy, and the next person
to change a description would have to remember it.

## What is deliberately absent

Each of these is a thing a reasonable implementer would otherwise add:

- **No description text of its own.** Not one string describing an existing command. Every
  description is the registered one, verbatim.
- **No name→group table.** The group is known at construction; it is never recovered by lookup.
- **No target state.** Nothing about running, stopped, paused, or reachable — that is `/status`.
  The listing is identical whether every target is up or every target is off (SC-007).
- **No per-command detail beyond one line.** No usage text, examples, or edge-case notes.
- **No storage, cache, or memoisation.** Rendering is cheap and per-interaction; caching would
  introduce a staleness window in the one feature whose purpose is not being stale.
- **No configuration.** Nothing about the listing is tunable.
