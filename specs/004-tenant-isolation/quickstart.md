# Quickstart: prove each guild controls only its own targets

**Feature**: `004-tenant-isolation` · **Date**: 2026-08-04

How to prove tenant isolation works — and that the seam did **not** change (SC-005), so a future
off-box target stays additive. Validation only; implementation belongs in `tasks.md`.

## Prerequisites

- The orchestrator built from this branch, one bot, in **both** test guilds.
- `orchestrator/.env` uses the new **`TENANTS`** shape (see
  [contracts/config-schema.md](contracts/config-schema.md)); the old `AGENTS` /
  `DISCORD_GUILD_ID` routing config removed.
- Two guilds configured with a **deliberate mix** — one target exclusive to each, one shared:

  ```
  Guild A (playboy lounge):  palworld (game), vlc (media)
  Guild B (snackbyte dev):   satisfactory (game), vlc (media)   # vlc shared with A
  ```
  Targets stay loopback-local on `watson` (no off-box, no auth — FR-013). Agents unchanged.

## Validation

### 1. Isolation — a guild sees and reaches only its own targets (US1, SC-001)

| In guild | Expect |
|---|---|
| A opens the picker | `/start palworld`, `/pause`/`/play` (vlc), `/status` — **no** `satisfactory` |
| B opens the picker | `/start satisfactory`, `/pause`/`/play` (vlc), `/status` — **no** `palworld` |
| A runs `/start palworld` | palworld starts; B's targets untouched |
| A tries to reach `satisfactory` | impossible — it is not in A's picker and not in A's routing map (FR-002/FR-003) |

Isolation is structural: from A, guild B's `satisfactory` cannot be named, routed to, or seen.

### 2. Shared vs. exclusive targets (FR-014)

| Step | Expect |
|---|---|
| `/pause` in A, then `/pause` in B | both pause the **same** VLC — a shared target works from either guild |
| `/start palworld` in B | not possible — `palworld` is exclusive to A, absent from B |

### 3. Add a tenant by configuration alone (US2, SC-002)

Add a third guild + its target set to `TENANTS`, restart, and confirm its commands appear in that
guild and route to its targets — **no code edited**, and guilds A and B unchanged. Remove it,
restart, and confirm that guild is no longer served while A and B still are.

### 4. Scoped `/status` (FR-012, SC-003 for the read path)

| Step | Expect |
|---|---|
| `/status` in A | folds **only** A's targets (palworld + vlc), each in its own vocabulary — never satisfactory, and no hint it exists |
| `/status` in B | folds only B's targets (satisfactory + vlc) |
| VLC closed, `/status` in A | vlc shows *unreachable*; A's other targets still report (as 003) |

### 5. Unconfigured guild is ignored (FR-006, SC-003)

From a guild **not** in `TENANTS` (add the bot to a throwaway guild), send any command → **no**
action on any target; the orchestrator logs that it ignored an unconfigured guild.

### 6. Fail-loud configuration (FR-010, FR-011, SC-006)

Each of these MUST make the orchestrator refuse to start, naming the problem — never boot into a
mis-scoped state:

- a duplicate `guildId` across two tenants;
- a tenant with an empty `agents` array;
- an agent entry that breaks the 003 rules (bad `name`, unknown `kind`, a game with no
  `publicPort`, a media with a `publicPort`);
- the **legacy** shape present (`AGENTS`, or `DISCORD_GUILD_ID` used for routing) → a migration
  message pointing at `TENANTS`.

### 7. The seam did NOT change (SC-005) — the readiness check

- `git diff` on `contract/` and `agent/` for this feature is **empty** — neither package is opened.
- The 001–003 contract shape is intact: `AgentResponse { state, message? }`, verbs unchanged, **no
  tenant/target id** in any path or body.
- An agent, run standalone, behaves exactly as in 003 — it never receives or needs a tenant id.

This is what keeps a future off-box target additive: it becomes a different `url` (plus a separate
spec's authentication) inside a tenant's list, with nothing here to redo.

## Not validated here

Deliberately out of scope (spec): agent **authentication** and **off-box** target addressing (a
separate future spec — this feature only keeps the seam ready); a **federated** one-orchestrator-
per-tenant model; **per-user roles** within a guild; a **cross-tenant/global** operator view.
