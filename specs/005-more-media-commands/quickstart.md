# Quickstart — validating the four context-free media controls

How to prove this feature works end to end, and how to prove it did **not** acquire the
capabilities it is forbidden to have. Run top to bottom; §1–§2 are automatable and must be
green before anything below is attempted.

Contracts and entities are not restated here — see [contracts/agent-api.md](contracts/agent-api.md)
and [data-model.md](data-model.md).

## Prerequisites

1. **M0 is done and recorded** in [`m0-vlc-controls.md`](m0-vlc-controls.md). The adapter is
   written against those observations (FR-019). **Nothing below is meaningful until it is** —
   in particular, the relative-seek syntax must be an observation, not a guess.
2. **Both `DECISIONS.md` entries are appended** — 022 (the ban narrowing) and 023 (the seam's
   new verbs and first operation parameter). Required *before* implementation (FR-010,
   Constitution V).
3. **Env files exist** and are unchanged by this feature: `agent/.env.vlc`,
   `orchestrator/.env`. No new variable is introduced.
4. **VLC is running** with its web interface enabled, and the operator has loaded a
   **playlist of at least three items, each a couple of minutes long**. Short clips make a
   ±30-second seek unobservable and let items end mid-test.
5. **A second guild** configured in `TENANTS` with **no** media target, for §6.

## 1. The unit gate

```bash
npm run check:all
```

Typecheck, lint, and the full `node:test` suite must pass. This is where most of the feature
is actually proven — in particular:

- **The narrowed ban list** (`agent/src/vlc.test.ts`): `pl_next`, `pl_previous`, and
  `command=seek` are now **required** to appear in the adapter; `pl_play`, `in_play`,
  `in_enqueue`, `pl_empty`, `pl_delete`, `pl_jump`, `pl_stop`, `command=volume`, the absolute
  seek form, and every OS-kill pattern must **not**.
- **No bounds are set** (`orchestrator/src/commands.test.ts`): the `seconds` option carries
  neither `setMinValue` nor `setMaxValue` (FR-005, SC-004).
- **The kinds never cross** (`agent/src/server.test.ts`): a game agent 404s `/next`,
  `/previous`, `/seek`.
- **Refusal parity**: all five acting media verbs return `409` on `stopped`.

## 2. The agent, directly over loopback

Prove the seam before involving Discord. The agent is on `127.0.0.1:8302`.

```bash
# With something playing:
curl -s -X POST 127.0.0.1:8302/next
curl -s -X POST 127.0.0.1:8302/previous
curl -s -X POST "127.0.0.1:8302/seek?seconds=-30"
curl -s -X POST "127.0.0.1:8302/seek?seconds=30"
```

**Expected**: `200` with `{"state":"playing"}` (or `paused`), and the player visibly moves.

```bash
# The caller-bug cases — must fail loud, never default:
curl -s -o /dev/null -w '%{http_code}\n' -X POST 127.0.0.1:8302/seek
curl -s -o /dev/null -w '%{http_code}\n' -X POST "127.0.0.1:8302/seek?seconds=abc"
```

**Expected**: `400` both times, with `message` naming `seconds`. **A `200` here is a defect** —
it would mean the agent invented a default for a required value.

```bash
# Read-only status is unaffected and stays off the mutex:
curl -s 127.0.0.1:8302/status
```

## 3. US1 — Replay the line everybody missed (P1, MVP)

With something **playing**, in a guild that has a media target:

| Step | Command | Expected |
|---|---|---|
| 1 | `/back` | Position moves back **30 s**. Reply states what was issued. |
| 2 | `/back 90` | Position moves back **exactly 90 s** — not rounded or capped. |
| 3 | `/forward 45` | Position moves forward **exactly 45 s**. |
| 4 | `/forward` | Position moves forward **30 s**. |

**Position is read at the player**, never from Reveille — the system does not report it
(FR-002). Acceptance: US1 scenarios 1–2, SC-004.

**Unbounded (US1 scenario 3, FR-005)**: with the item ~10 s in, issue `/back 6000`. The control
is **issued anyway**; no refusal is invented and no amount is silently reduced. Whatever VLC
does is what happens, and the reply claims no result.

**Negative pass-through (Clarifications)**: `/back -30` seeks **forward**. This is the accepted
consequence of the thinnest handling, not a bug.

**Unreachable (US1 scenario 4)**: close VLC, leave the agent running, issue `/forward`. The
reply must say the **player could not be reached** and must **never** report a playback
position or state.

## 4. US2 — Move to the next thing (P2)

With a **multi-item playlist** playing:

| Step | Command | Expected |
|---|---|---|
| 1 | `/next` | The player advances. Reply reports the control was **issued**, and **does not name the item**. |
| 2 | `/previous` | The player goes back one item. |
| 3 | `/next` on the **last** item | Still issued. Reply claims no specific result; no boundary message is invented. |

Acceptance: US2 scenarios 1–3. Step 3 is the one that catches an implementation that peeked at
the playlist to be helpful — any reply that knows it was at the end is a **failure** (FR-002).

## 5. Nothing loaded — all six refuse identically (SC-003)

Stop the player (nothing loaded, `status` reads `stopped`), then issue **all six**:

```
/pause   /play   /next   /previous   /forward   /back
```

**Expected**: six honest refusals **in the same terms and at the same tier**. Not six different
messages, not a silent success, not a pretended action. This is the clarified principle made
observable — Reveille has no say over the machine when the machine is in no state to act.

## 6. US3 — A guild gets only the controls it should (P3)

| Step | Where | Expected |
|---|---|---|
| 1 | Guild **with** a media target, open the command picker | `/next`, `/previous`, `/forward`, `/back` are all offered |
| 2 | Guild with **no** media target, open the picker | **None of the four appears** (004 FR-003) |
| 3 | Two guilds each with their own media target | A control in one affects **only** that guild's player; the other is never touched (004 FR-002) |

Acceptance: US3 scenarios 1–3, SC-005. Isolation is inherited structurally from 004 — a handler
only ever sees its resolved tenant's maps — so this validates that the new commands were wired
**inside** that path, not beside it.

## 7. The content-leak audit (SC-002)

Read **every** reply, prompt, and command description the four controls can produce — including
the command descriptions in Discord's picker, which are user-facing text and are easy to
forget. Count the ones naming, listing, or describing an item, file, or playlist entry.

**The count must be 0.** Playback state (playing / paused / stopped) is **not** content and may
appear (FR-002).

## 8. Regression — nothing that existed changed (SC-006, SC-007)

| Check | Expected |
|---|---|
| `/start`, `/stop`, `/address` on each game | Behave exactly as before |
| `/status` | Folds every target in; media still in its own vocabulary |
| `/pause`, `/play` | Behave exactly as 003 |
| A game agent receiving `/next`, `/previous`, `/seek` | **404** (FR-016) |
| `contract/src/index.ts` | **Unchanged** — v4 added verbs, not types |
| Network exposure | **No** new port, forward, or firewall rule (FR-017) |

## 9. The homepage (SC-008, FR-020)

[`site/index.html`](../../site/index.html) describes the four new controls, and describes **no
capability the system does not have** — in particular it must not imply Reveille can choose,
browse, or show what plays.

---

## What cannot be automated

Everything above except §1–§2 needs a real Discord guild and a human watching a real player.
The irreducible slice is:

- **Seeing that the video actually moved** by the right amount — the system is forbidden from
  reporting position, so confirming it *is* the human's job by construction.
- **Reading the command picker** in two guilds to confirm scoping (§6 steps 1–2).
- **Judging reply wording** for content leakage (§7).

Everything else — the ban list, the refusal parity, the kind separation, the missing-parameter
rejection, the absence of bounds — is asserted in `npm run check:all` and by the direct
loopback probes in §2, and must be green before a human is asked to look at anything.
