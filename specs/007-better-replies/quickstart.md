# Quickstart — validating 007

How to prove the replies serve the reader, that stepping takes a count, and that observation did
not become memory. Run top to bottom.

Contracts and entities are not restated here — see [contracts/seam-v5.md](contracts/seam-v5.md)
and [data-model.md](data-model.md).

## Prerequisites

1. **M0 is done** (§1) — Thread C cannot start before it. This is a real gate, not a formality.
2. The `DECISIONS.md` entry exists (FR-020) — it is required *before* implementation.
3. For §5 onward: a real VLC with the web interface enabled, at least three playlist items, at
   least one **tagged** file and one **untagged** file, and the orchestrator running.

## 1. M0 — measure before building (the Thread C gate)

Against a **real** VLC, record in `m0-vlc-metadata.md`. `m0-vlc.md` covers only `state` and the
empty case; none of the below is measured anywhere yet.

| Question | Why it matters |
|---|---|
| Exact field path of the **title** | The whole thread reads it |
| Exact field path of the **filename** | FR-009's fallback |
| **Is `title` synthesised from the filename when a file has no tag?** | **Decides whether the fallback has two live branches or one.** If VLC always supplies a title, the "no title" branch is unreachable and the design changes |
| `time` / `length` — present? type? unit? | Position rendering |
| A **live stream** — what does `length` report? | The elapsed-only branch |
| **Nothing loaded** — what does the meta block look like? | Must not render a stale name |
| Cost of one `pl_next` over loopback | Grounds the mutex-hold estimate in `research.md` §3 |

**Pass condition**: every row answered by observation, with the raw response recorded. An
assumption written as a measurement is the one failure mode this section exists to prevent — 005's
absolute-seek finding is the precedent.

## 2. The unit gate

```bash
npm run check:all
```

Typecheck, lint, and the full `node:test` suite. What must be in there:

- **No internals in member-visible text** (SC-001) — a scan over every reply, footnote and command
  description for status codes, errnos, and component names. This is a *derived* check, not a list
  of expected strings.
- **Diagnostics still reach the operator** (SC-003) — every failure branch that replies also logs.
- **The count** — N steps issue exactly N commands, for positive, negative and zero N, with no
  clamping (SC-008); a missing/non-integer/unsafe count is a `400` naming the argument.
- **Indivisibility** (SC-009) — a multi-step holds the mutex throughout, and `/status` still answers
  during it.
- **Nothing is stored** (SC-006) — drive a sequence against a stub whose reported detail **changes
  between calls**, and assert every reply reflects the *current* observation. A test that only
  greps for a cache would pass a system that had one.
- **Selection is still impossible** (SC-007) — the rewritten source ban: `pl_jump`, `pl_play`,
  `in_play`, `in_enqueue`, `pl_empty`, `pl_delete`, volume, `pl_stop`, OS kill, and the unsigned
  absolute seek. **Observation must not be banned.**
- **Game-only renders identically** (SC-016) — the strongest regression check here.
- **Long names shortened, visibly** (SC-017).

## 3. The corrected documents (SC-015)

The requirement text this feature corrects must actually be corrected — **re-read it, do not
assume**:

| Where | What must no longer forbid observation |
|---|---|
| 005 FR-002 | the ban on "read, inspect, store, name, list, or display" |
| 005 FR-003 | the ban on checking "that the intended effect occurred" |
| 006 FR-013 / SC-006 | the inherited content-leak ban |
| `DECISIONS.md` 022 | "no knowledge of content", written as blindness |
| `agent/src/vlc.ts` header | its own restatement of the rule |
| `CLAUDE.md` | the media-ban paragraph |
| `vlc.test.ts`, `commands.test.ts` | **the assertions that enforce the overshoot** |

A requirement corrected in prose but still enforced by a green test is **not corrected**.

## 4. Thread A — the replies (US1)

Trigger each failure branch and read what arrives. For every one:

| Check | Expected |
|---|---|
| Status codes, errnos, component names | **None** |
| Mechanism (port forwarding, VPN, "the agent") | **None** |
| Causes you cannot act on | **None** |
| `/address` | The address and what to do with it — not how it works |
| `/start` | Still does **not** claim the server is up (FR-007) |
| Failed `/stop` | Still says the server is **still running** (FR-007, Constitution IV) |
| A refusal | Still reads as a refusal, not a failure |
| The operator's log | Has the detail the reply no longer shows |

Kill an agent and run each of its commands — the reply must say what happened and what to do, and
name nothing internal.

## 5. Thread B — the count (US3)

| Run | Expected |
|---|---|
| `/next` | Moves 1 |
| `/next 3` | Moves 3 |
| `/next -3` | Moves **back** 3, and the reply **says back** (FR-017) |
| `/previous -2` | Moves **forward** 2, and says so |
| `/next 0` | Passed through; no special case |
| `/next 1.5` | Refused, naming the argument |
| A large count, then another command | The second waits; `/status` still answers |

`/help` must show the new option **without any help text having been edited** — it derives from the
command surface (006). If you had to write a description twice, that is the bug 006 removed.

## 6. Thread C — the detail (US2)

| Situation | Expected |
|---|---|
| Tagged file playing | Title and `elapsed / total` |
| **Untagged file** | The filename (per M0 §1's synthesis finding) |
| Neither available | Name omitted — no placeholder, no empty quotes |
| Live stream | Elapsed, **no** total |
| Nothing loaded | No name, no position — and no *stale* name |
| Very long filename | Visibly shortened |
| `/status` with games + media | **One line per target**, detail inline (FR-008a) |
| `/status` with games only | **Byte-identical to before this feature** (FR-008a, SC-016) |

Then the honesty check: `/next`, and confirm the reply **reports** what is playing without claiming
the command caused it (FR-010).

## 7. Statelessness, by hand (SC-006, SC-014)

Run `/status`, then change what is playing **outside Discord**, then run `/status` again. The second
reply reflects the new reality with no trace of the first. Then run the media commands in different
orders and confirm no reply depends on what ran before it.

## 8. The homepage (SC-013, FR-026)

[`site/index.html`](../../site/index.html) says *"Reveille never sees **what** is loaded"*. That
becomes **false**. It must describe the new behaviour and the count, and carry no claim the system
contradicts.

## 9. Regression (SC-010, SC-011, SC-012)

| Check | Expected |
|---|---|
| Every pre-existing command | Behaves identically |
| Game lifecycle, per-guild scoping, `/help` | Unchanged |
| Contract | Every v4 field and verb unchanged; no target identifier |
| A v4 agent against a v5 orchestrator | Still works — omitted fields render as absent |
| New env vars, ports, firewall rules | **None** |
| Agent runtime dependencies | Still **zero** |

---

## What cannot be automated

- **Judging the replies read well** (§4) — that they serve a reader, not a maintainer. The scans
  catch internals mechanically, and T038 checks each reply names *something actionable*; whether the
  remaining sentence is *good* is the human half of **SC-002**.
- **The M0 measurements** (§1) — they require a real VLC with real media.
- **Seeing the disclosure** (§6) — that a real title in a real channel is acceptable in practice is
  a product judgement, and the one part awkward to reverse.

Everything else — the internals scan, diagnostics routing, count behaviour, indivisibility,
statelessness against a changing stub, the selection ban, game-only identity, and name
shortening — is in `npm run check:all` and must be green before a human is asked to look.
