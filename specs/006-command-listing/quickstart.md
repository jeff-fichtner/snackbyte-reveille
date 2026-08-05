# Quickstart — validating the command listing

How to prove `/help` works, and how to prove it cannot drift. Run top to bottom.

**Most of this feature is verifiable without Discord and without an agent** — a property no
previous feature had. `/help` is a pure function of a tenant's targets (contracts §6), so §1 and
§2 cover the substance. Only the visual and wording checks need a human.

Contracts and entities are not restated here — see [contracts/command-surface.md](contracts/command-surface.md)
and [data-model.md](data-model.md).

## Prerequisites

1. **No M0.** Nothing is measured; `/help` contacts no target.
2. **No configuration change.** The existing `orchestrator/.env` is untouched — if you had to
   edit it, something has gone wrong (FR-018).
3. For §3 onward: the orchestrator running, and **two guilds** — one with a media target, one
   without — to see scoping with your own eyes.

## 1. The unit gate

```bash
npm run check:all
```

Typecheck, lint, and the full `node:test` suite. This is where the feature's central guarantee
lives, so it is worth naming what must be in there:

- **The bijection** (contracts rule 4) — for a given tenant configuration, the set of runnable
  forms derived for registration and the set of entries in the listing are **equal**. Not "the
  listing contains the expected strings" — *equal to the registered set*, computed both ways.
- **No fixture of description text.** If a test asserts `'Pause the show.'` appears, that test is
  a third copy and will drift exactly as the code would have. The test must compare derived to
  derived.
- **Grouping and empty groups** — a media-only tenant produces one target group, not two with one
  empty (FR-022).
- **Runnable forms** — `/start` contributes one entry per game target, not one entry.
- **`/help` lists itself** (FR-004).
- **No agent contact** — the listing renders with no `AgentClient` in play at all (SC-007).

## 2. Drift resistance — the test that matters most

This is the feature's whole reason for existing, and it is checkable mechanically.

**Change a registered description in `orchestrator/src/commands.ts`** — for example, make
`/pause`'s read `Hold the show.` — then re-derive the listing:

```bash
npm test
```

**Expected**: the listing now says `Hold the show.` **with no other file edited.** If any test
fails because a second copy of the old text exists somewhere, that copy is the bug — delete it,
do not update it.

Then **add a target** to a tenant in a test fixture and re-derive: its commands appear in the
listing, again with no description text edited (FR-008, SC-003). **Revert both changes.**

## 3. US1 — Ask what you can do

In a guild with game and media targets, issue `/help`.

| Check | Expected |
|---|---|
| Every command the guild has | Present, one line each |
| Game verbs | **One entry per target** — `/start palworld` *and* `/start satisfactory`, not a lone `/start` |
| Seek commands | `[seconds]` shown as optional, with the default stated |
| `/help` itself | Listed (FR-004) |
| Grouping | Games together, media together, the rest last |
| Copy any line and run it | It works — every entry is a complete runnable form (SC-012) |
| Speed | Answers immediately, with **no "thinking" state** — it does not defer |

## 4. US2 — The list is about MY guild

| Where | Expected |
|---|---|
| Guild with **no media target** | **0** media commands; no empty "Media" heading |
| Guild with **no game target** | **0** game commands; no empty "Games" heading |
| Either guild | Names **none** of the other guild's targets (SC-005) |

## 5. FR-005 — Only the asker sees it

Issue `/help` in a channel with other people in it. **Only you see the reply.** Ask someone else
to confirm they see nothing.

## 6. SC-007 — Availability, not readiness

Switch a target off, or stop its agent, and issue `/help` again. **The listing is byte-identical.**
It describes what you may *ask for*, not what would succeed — that is `/status`'s job, and the two
must not blur. Then confirm `/status` *does* show the target as unreachable, proving the split.

## 7. The content-leak audit (SC-006)

Read the whole listing. Count references to any **item, file, playlist entry, position, or
duration**. **The count must be 0.** Target names are fine and expected (FR-012); *content* is
never named. This inherits 003/005's media bans unchanged.

## 8. Regression (SC-008, SC-009)

| Check | Expected |
|---|---|
| Every pre-existing command | Behaves identically |
| `git diff` on `contract/` and `agent/` | **Empty** — neither was opened |
| New env vars, ports, firewall rules | **None** (SC-011) |
| Registration itself | Unchanged — the same commands register as before, since `buildCommands` is now derived from the groups rather than replaced |

That last row is the one to check deliberately: the refactor in §2 of [research.md](research.md)
changes how the registration array is *built*, so confirm the guilds still register exactly what
they did before — the live Discord API listing is the cheapest way to see it.

## 9. The homepage (SC-010, FR-021)

[`site/index.html`](../../site/index.html) mentions the new command and describes no capability the
system does not have.

---

## What cannot be automated

Only three things, and each is genuinely human:

- **Seeing that the reply is ephemeral** (§5) — whether *other people* can see a message is not
  observable from the process that sent it.
- **Judging the listing reads well** (§3) — that it is scannable and the grouping helps.
- **The content-leak audit** (§7) as a judgement rather than a regex.

Everything else — the bijection, grouping, empty groups, runnable forms, self-inclusion,
independence from target state, and the seam being untouched — is in `npm run check:all` and must
be green before a human is asked to look at anything.
