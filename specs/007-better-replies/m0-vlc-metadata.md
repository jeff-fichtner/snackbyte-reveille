# M0 — VLC metadata fields (007)

**Measured 2026-08-09** against the real VLC on `watson` (`127.0.0.1:8080`, web interface already
running), driven with `curl` against `/requests/status.json`. Every value below was **observed**,
not read from documentation.

Prior records cover `state` and the empty case only
([003 §3, §5](../003-media-control/m0-vlc.md)) and the stepping/seek commands
([005](../005-more-media-commands/m0-vlc-controls.md)). Nothing had measured the fields Thread C is
built on. This record closes that gap and **gates US2**.

**Method note.** These measurements were driven **by the operator** (direct `curl` to the web
interface), including `in_play` and `pl_stop` — commands the *adapter* is forbidden to contain.
That is the mechanism-not-policy line 007 restates: the ban is on what Reveille's code may do, not
on what a human may do to their own player while measuring it.

---

## 1. The field paths

```
information.category.meta.title      <- the name, when the file carries one
information.category.meta.filename   <- always present while something is loaded
```

`meta` sits alongside a `Stream 0…N` key per track inside `information.category`.

**Observed on a tagged file:**

| Field | Value |
|---|---|
| `meta.title` | `The Marvelous Mrs  Maisel (2017) - S03E05` |
| `meta.filename` | `The Marvelous Mrs. Maisel (2017) - S03E05 - It's Comedy or Cabbage (1080p AMZN WEB-DL x265 Ghost).mkv` |

The two **differ materially**, which is what makes FR-009's preference load-bearing: the title is
the clean form, the filename carries the release string. Note the title is itself imperfect
(a doubled space where the source had a dot). **We display what the player reports and do not
clean it** — inventing a tidier name would be exactly the fabrication FR-009 and SC-005 forbid.

---

## 2. The gating question — **VLC does NOT synthesise a title**

> **Does VLC fall back to the filename for a file with no title tag?** → **No.**

Measured on an untagged release file. The `meta` block came back as:

```
BPS, DURATION, NUMBER_OF_BYTES, NUMBER_OF_FRAMES,
_STATISTICS_TAGS, _STATISTICS_WRITING_APP, _STATISTICS_WRITING_DATE_UTC,
filename
```

`title` is **absent from the key set entirely** — not empty, not null-as-a-string, not the
filename. `filename` is present and is the release name.

**Consequence for the design**: FR-009's chain has **two live branches**, exactly as specified —
title where there is one, filename where there is not. The clarification stands unchanged and
`T013`/`T016` implement it as written. Had VLC synthesised, the filename branch would have been
unreachable and the requirement unimplementable as worded.

---

## 3. Two traps, both silent

**Trap 1 — `information.title` is an integer, not a name.** Alongside `category` there is a
top-level `information.title`, and it measured **`0`**. It is the DVD/Blu-ray *title index*. Code
reaching for the obvious-looking `information.title` gets a number, and `0` would render as a
plausible-looking name rather than failing. Same shape as 005's absolute-seek bug: wrong quietly,
not loudly.

**Trap 2 — when nothing is loaded, the whole `information` block disappears.** Not just
`meta.title`; the entire `information` object is absent:

| Field | Stopped |
|---|---|
| `state` | `stopped` |
| `time` | `0` |
| `length` | `0` |
| `position` | `0` |
| `currentplid` | `-1` |
| `information` | **absent** |

A path like `body.information.category.meta.title` **throws** on a stopped player. The adapter must
guard the block, not just the field. The upside: **no stale name persists** — the quickstart's
"nothing loaded must not show a stale name" check passes by construction.

---

## 4. Position and duration

Both are **top-level integers in whole seconds**.

| Observation | `time` | `length` |
|---|---|---|
| Tagged file, mid-play | `1531` (25:31) | `3426` (57:06) |
| Untagged file, just loaded | `0` | `2492` (41:32) |
| Stopped | `0` | `0` |

`position` is a float 0–1 and is redundant with `time`/`length`; the reply uses the timestamps
(spec Assumptions), so `position` is not read.

**`length: 0` means "no total", not "a zero-length item"** — it is what the stopped case reports,
and it is the value to treat as absent. This also covers the live-stream case defensively; see §6.

---

## 5. `pl_next` cost — grounding the mutex exposure

Three consecutive calls over loopback:

| Run | Time |
|---|---|
| 1 | 21.8 ms |
| 2 | 21.9 ms |
| 3 | 21.5 ms |

**~22 ms per step**, tight variance.

> **§5 measured the wrong thing, and §5a corrects it (2026-08-10).** 22 ms is how long VLC
> takes to *answer* `pl_next`, not how long it takes to *switch items*. The `count` design
> was priced on the request latency and needed the switch latency. See below.

### 5a. Switch latency — and why three rapid steps advance ONE item

Measured by issuing `pl_next` and polling `currentplid` until it changed:

| Trial | Switch |
|---|---|
| 1 | 275 ms |
| 2 | 182 ms |
| 3 | 189 ms |

**~180–275 ms — roughly 10× the request latency.**

**The consequence is a real defect, observed live.** A step issued while the previous one is
still loading is **silently dropped**. Three `pl_next` calls fired ~22 ms apart advanced the
playlist by **one item**, and *every one of them returned `200`*. This is the same trap 005
recorded from the other direction — VLC answers `200` for commands it does not act on — so a
loop that trusts the status code both **under-steps** and then **reports the item it just
left**, because the post-step read also wins the race.

**Therefore a multi-item step must confirm each switch landed before issuing the next.** That
is not retrying toward a desired state (DECISIONS 024 forbids that): the command is issued
exactly once per step, and the wait only declines to charge ahead of the player. Where a step
cannot land, the wait bounds out and the loop moves on without concluding why.

**Re-price the mutex exposure with this number, not §5's.** At ~200 ms per confirmed step, a
count of 1,000,000 holds the agent's command mutex for roughly **55 hours**, not the ~6
`research.md` §3 originally derived from 22 ms.

---

## 6. Not measured — the live stream

**A live stream was not measured.** No stream source was to hand, and the remaining questions did
not justify disrupting the operator's playback further.

What this leaves unverified: that a stream reports a `length` of `0` (or omits it) rather than a
misleading figure. **Mitigation**: §4 establishes that `length: 0` already occurs and must be
treated as *absent*, so the elapsed-only branch is exercised by the stopped case and by any item
whose length is unavailable. Rendering is therefore correct either way; what is unverified is only
*which* representation a stream picks.

**If it matters later**, point VLC at any HTTP stream and re-read §4's table. `quickstart.md` §6
keeps the stream row as a manual check.

---

## 7. Bonus fields — available, deliberately unused

The `meta` block also carried `showName`, `seasonNumber`, `episodeNumber`, plus `DURATION`, `BPS`
and mkvmerge statistics.

**Not used.** The spec asks for a name and a position; episode decomposition is richer than
anything 007 requires, and using it would grow the reply's vocabulary without a requirement asking
for it (Constitution III). Recorded only so a future feature does not have to re-measure.

---

## 8. Incidental observation — `pl_stop` did not stop on the first try

While the playlist was advancing from earlier `pl_next` calls, a `pl_stop` returned `200` and the
player kept playing a *subsequent* item; a second `pl_stop` stopped it. Recorded for completeness
only — `pl_stop` is **banned in the adapter** and 007 does not add it. It is another instance of
VLC returning `200` for a command that did not do what the name implies (005 §"200 for unrecognized
commands"), which is why no reply may claim an outcome it has not observed (FR-010).

---

## Consequences for the implementation

- **T013** reads `information.category.meta.title` then `.filename`, and **guards the whole
  `information` block** — both branches are live and the block vanishes when stopped.
- **Never read `information.title`** — it is an index.
- **Treat `length: 0` as absent**, not as a zero duration.
- Whole seconds, so no unit conversion; `m:ss` / `h:mm:ss` formatting only.
- `research.md` §3's step cost corrected from ~10 ms to the measured **22 ms**.
