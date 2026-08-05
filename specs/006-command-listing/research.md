# Phase 0 — Research: a command that lists the commands you can run

Every decision the plan rests on, with what it was chosen over. The spec carries **no**
`NEEDS CLARIFICATION` markers and both open questions were settled in the Clarifications session
(2026-08-05), so this phase resolves *design* choices rather than unknowns.

**There is nothing to measure.** Unlike every prior feature, no M0 is required: `/help` contacts
no target, so there is no external behaviour to observe. Every fact it renders is already in the
process.

---

## 1. The listing derives from the command surface — the decision the feature exists for

**Decision**: The listing is rendered from the value `buildCommands` already produces for
registration. There is no second description of any command anywhere.

**Rationale**: FR-007 requires the listing to agree exactly with what a guild can run, and FR-008
requires that to hold *by construction*. Those are one requirement if the listing is a second
**view** of the registration value, and two requirements permanently at risk of diverging if it
is a second **description**.

The failure mode is not hypothetical, and it is worth being concrete because it is the entire
motivation. In 005, `agent/src/vlc.ts` carried a header stating the file contained "no seek". It
was true when written. Seek was then implemented *in that file*, and the header stayed wrong until
a review caught it — comment and code sat four lines apart and still drifted. Distance is not what
causes drift; **being a separate copy** is. A help text listing `/forward — jump forward` is the
same construction and will fail the same way.

**Alternatives considered**:

- *A hand-written help string, or a table of `{command, description}` in a constant.* Rejected.
  This is the obvious implementation and it is precisely the bug. It would pass its own tests on
  the day it was written.
- *Reading the commands back from Discord's API at request time.* Rejected: it makes a read-only
  local question depend on the network (violating FR-015), adds a failure mode and a latency
  budget, and buys nothing — the registered set was computed here in the first place.
- *Deriving from the registration payload after `toJSON()`.* Rejected on its own, but only
  narrowly — see §2. The JSON is faithful for names and descriptions; it is the **grouping** it
  cannot carry.

---

## 2. Grouping must happen inside the builder, not after it

**Decision**: Introduce `buildCommandGroups(servers)` as the single source, returning ordered
groups each holding its commands. `buildCommands` becomes a thin derivation of it — flatten and
`toJSON()` — so registration is unchanged in behaviour and the listing gets the grouping for free.

**Rationale**: FR-022 requires grouping by target kind. The current `buildCommands` knows the kind
while it is building — it branches on `games.length > 0` and `media` — but returns a flat array,
so the knowledge is discarded at the boundary.

Recovering it downstream means writing something like
`{ start: 'Games', pause: 'Media', status: 'Everything', … }`. That table is **a second copy of
the knowledge**, and it fails exactly as FR-008 predicts: add a media command and forget the
table entry, and the listing silently files it under the wrong heading — or omits it. It would
also have to be kept in step with 005's six media commands and whatever 007 adds.

Moving grouping up one level costs a type and a flatten, and makes the wrong version
*unrepresentable*: a command cannot exist in the registration array without having come from a
group, because the array is derived from the groups.

**Empty groups**: a group with no commands is omitted rather than rendered with a heading and
nothing under it (FR-022). This falls out naturally — the media group is only constructed when the
tenant has a media target, exactly as the current `if (media)` branch already decides.

**Alternatives considered**:

- *A name→group lookup table.* Rejected, above. More code, and it reintroduces drift.
- *Tagging each `SlashCommandBuilder` with a group property.* Rejected: it means attaching data to
  a discord.js object that discord.js does not model, which survives only by convention and
  disappears through `toJSON()`.
- *No grouping — one flat list.* A legitimate simpler option, and it was offered. Rejected by the
  clarification: with ~14 entries spanning two vocabularies, a flat list is materially harder to
  scan, and the grouping is free once §2's refactor exists.

---

## 3. One entry per runnable form

**Decision**: Each entry is a command exactly as a member would type it. A command carrying
subcommands contributes **one entry per subcommand**, using that subcommand's own description; a
bare command contributes one entry using its own.

**Rationale**: Settled by clarification. The game verbs register as subcommands per target, so
`/start` is not runnable but `/start palworld` is. Listing `/start` alone would describe the
*shape* of the surface rather than what a member can do — and the per-subcommand descriptions
already exist and already name the target, so this reading is also the one that requires no new
text (FR-008) and satisfies FR-012 for free.

**Consequence accepted**: the listing grows with the number of game targets rather than staying a
fixed length. That is the honest cost of every line being directly runnable, and it is bounded by
what an operator actually configured.

**Alternatives considered**: *`/start <palworld|satisfactory>`* (compact, but describes shape and
needs a synthesised placeholder string) and *`/start` alone* (shortest, but leaves a member unable
to act on what they just read).

---

## 4. `/help` answers without deferring — which is why it must be handled early

**Decision**: `/help` replies **immediately and ephemerally**, and is handled in `index.ts`
**before** the existing `await interaction.deferReply()`.

**Rationale**: This is the one place the implementation order is forced by a requirement rather
than by taste.

`index.ts` currently defers unconditionally at line 118, before the command switch. Discord's
deferral fixes the reply's visibility at defer time — a publicly-deferred reply cannot become
ephemeral afterwards — so FR-005 (visible only to the asker) cannot be satisfied downstream of
that line.

The reason this is a clean fix rather than an awkward one is FR-015: `/help` contacts no agent, so
it has no reason to defer at all. Deferral exists because a `/start` can take far longer than
Discord's ~3s window; a pure in-memory render cannot. **The requirement that it touch no network
is what earns it the immediate reply**, and the two requirements support each other rather than
competing.

**One consequence to handle**: `handle`'s `catch` block calls `interaction.editReply`, which
assumes a prior defer. An early `/help` return that throws *before* replying would hit a catch that
cannot answer. The handler must therefore reply or fail within its own branch rather than relying
on the outer catch.

**Alternatives considered**:

- *Defer ephemerally when the command is `/help`.* Works, but it inspects the command name before
  the dispatch switch in order to configure the defer — the same branch, in a worse place, plus a
  pointless round trip.
- *Reply publicly and skip FR-005.* Rejected by clarification: a full listing in a shared channel
  is noise for everyone who did not ask.

---

## 5. `/help` lists itself, and is always available

**Decision**: `/help` is registered for every tenant unconditionally, alongside `/status`, and
appears in its own listing.

**Rationale**: FR-004 requires it, and the reason is practical: a member who runs `/help` and does
not see it listed has been shown an incomplete list, which undermines the one promise the feature
makes. Registering it unconditionally mirrors `/status`, which is already pushed outside the
kind-partitioned branches — every tenant has at least one target, so both commands always apply.

It falls in the group that belongs to no target kind, together with `/status`.

---

## 6. Nothing is measured, and nothing is configured

**Decision**: No M0 task, no new environment variable, no new dependency, no seam change.

**Rationale**: Recorded explicitly because every previous feature in this repo needed at least one
of them, and their absence here is a property worth asserting rather than assuming. `/help` reads
a value that already exists in memory and renders it. There is no target to observe, nothing to
configure, and nothing to negotiate across the seam — which is why `contract/` and `agent/` are
not opened at all (FR-017, SC-009), and why the quickstart can verify most of this feature without
Discord.
