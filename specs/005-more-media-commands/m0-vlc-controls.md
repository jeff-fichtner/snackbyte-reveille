# M0 — the four context-free media controls (observed, not assumed)

The prerequisite dry run for 005, mirroring the Palworld / Satisfactory / VLC M0s before it.
Everything below was **observed against a real VLC** on `watson`
(`C:\Program Files\VideoLAN\VLC\vlc.exe`), driven headless over loopback on **2026-08-04**. No
behaviour here is taken from documentation — `agent/src/vlc.ts` (T006, T015) is written against
these measurements.

This M0 covers only what 005 adds. 003's measurements (endpoint, auth, the three `state` values,
the force pause/resume commands) still hold and are not repeated except where re-confirmed.

## How it was driven

Two **scratch** instances, each on its own HTTP port with its own password — never the
operator's live player, which must not be moved by a measurement run:

```
# A: three items, so pl_next/pl_previous have a real playlist to step through
vlc.exe --intf dummy --extraintf http --http-host 127.0.0.1 --http-port 8099 \
        --http-password <scratch> m0-item-1.wav m0-item-2.wav m0-item-3.wav

# B: no media at all, for the nothing-loaded case
vlc.exe --intf dummy --extraintf http --http-host 127.0.0.1 --http-port 8100 \
        --http-password <scratch-empty>
```

The media is three generated **4-minute** silent WAVs (8 kHz mono 16-bit, written by a
zero-dependency Node script). 003's M0 used a 3-second clip; that is useless here — a ±30 s seek
needs an item long enough for the movement to be observable, and long enough that items do not
end mid-measurement. No `--loop` was set, so playlist-boundary behaviour is VLC's own.

Deltas in §2–§5 were measured **while paused**, so a reported change is the seek alone and not
seek-plus-playback-drift. §7 repeats the key cases while playing.

## What was observed

### 1. Endpoint and auth — unchanged from 003, re-confirmed

- Commands are issued to **`GET /requests/status.json?command=…`**, the same endpoint as the
  status read; the response is the post-command status.
- **Basic auth, empty username + password.** A request with no credentials returns **`401`**.
- The interface came up **immediately** (first probe succeeded, ~0 s).

### 2. Relative seek — THE critical measurement

`command=seek&val=<value>`. **The sign prefix is what makes the seek relative.**

| `val` sent | Time before | Time after | Effect |
|---|---|---|---|
| `%2B30` | 7 | 37 | **relative +30 s** |
| `-30` | 37 | 7 | **relative −30 s** |
| `%2B30` (repeat) | 7 | 37 | **relative +30 s** — repeatable |

### 3. The ABSOLUTE form — identified so it can be banned by name

**A bare, unsigned `val` is an ABSOLUTE seek.** Confirmed twice, in both directions:

| `val` sent | Time before | Time after | Effect |
|---|---|---|---|
| `30` | 37 | **30** | absolute — jumped *back* to 0:30 |
| `90` | 30 | **90** | absolute — jumped *forward* to 1:30 |

This is exactly the silent failure the plan predicted, now measured. Had the adapter sent a bare
`val=30` for "forward 30 seconds", it would have jumped the show **to** the 30-second mark — an
action plausible enough to survive a casual test. `vlc.test.ts` therefore bans the unsigned form
by name (T004); **FR-011** mandates that ban.

### 4. A raw `+` in the query string

| `val` sent | Time before | Time after | Effect |
|---|---|---|---|
| `+30` (raw `+`, **not** percent-encoded) | 90 | 120 | relative +30 s — it *did* work |

VLC tolerated the unencoded `+` here. **The adapter must still send `%2B`.** A raw `+` in a query
string is form-encoded whitespace by spec; that this particular server is lenient is a property of
VLC's parser, not a guarantee, and relying on it would make the single most safety-critical
character in the request depend on undocumented leniency. Explicit encoding costs nothing.

### 5. No clamping, no wrap, no error — the amount is honoured literally

| `val` sent | Time before | Time after | Note |
|---|---|---|---|
| `%2B99999` | 120 | **100119** | far beyond the item's 240 s length; **not clamped**, item did not end or advance |
| `60` (reset, absolute) | 100119 | 60 | — |
| `-99999` | 60 | **−99939** | **negative time accepted and reported** |

VLC neither clamps, rejects, wraps, nor advances the playlist. This is what makes FR-005's
"unbounded, no validation" both implementable and honest: the system does its best and reports
nothing about where it landed.

### 6. Malformed and missing values — the reason the agent must validate

| Sent | Result |
|---|---|
| `command=seek&val=abc` | **time 47 → 0** — a non-numeric value is parsed as `0` and applied as an **absolute seek to the start** |
| `command=seek` (no `val`) | silent no-op, HTTP `200` |
| `command=seek&val=` (empty) | silent no-op, HTTP `200` |
| `command=not_a_real_command` | **HTTP `200`**, nothing changed |

Two consequences, both load-bearing:

- **A non-integer amount is not ignored — it jumps the player to the start.** The agent must
  reject a missing, blank, or non-integer `seconds` with a **`400`** and never forward it (T007).
  A silent default here would be actively destructive, not merely wrong.
- **VLC returns `200` for a command it does not recognise.** The agent therefore *cannot* learn
  from the HTTP status whether a command did anything — which is precisely why a `200` from the
  seam means *issued*, never *achieved* (FR-003).

### 7. Playlist stepping — `pl_next` / `pl_previous`

Both step the playlist and return `200`. Observed on the three-item playlist (VLC assigned
`currentplid` in **descending** order — 5, 4, 3 — an internal artifact nothing depends on).

- **`pl_next` while PAUSED resumes playback**: state went `paused` → `playing`. Stepping does not
  preserve the paused state. A reply must therefore claim nothing about the resulting state.
- While playing, both step normally and reset `time` to 0 for the new item.

### 8. The playlist boundary

| Action | Before | After |
|---|---|---|
| `pl_next` at the **last** item | `plid=3` (item 3) | **`plid=5` (item 1)** — it **wrapped**, and kept playing |
| `pl_previous` from there | `plid=5` | `plid=3` — wrapped back |

VLC wraps at both ends even with no `--loop` set. **Recorded, never depended on and never
reported**: what the player does at a boundary is the player's business (FR-003), and checking for
it would require knowing the playlist (FR-002).

### 9. Nothing loaded (instance B)

Baseline with no media: **`state: "stopped"`, `length: 0`, `currentplid: -1`** — identical to
003 M0 §5.

| Command sent with nothing loaded | Result |
|---|---|
| `pl_next` | silent no-op, `200`, still `stopped` |
| `pl_previous` | silent no-op, `200`, still `stopped` |
| `seek&val=%2B30` | silent no-op, `200`, still `stopped` |
| `pl_forcepause` (003 baseline, re-confirmed) | silent no-op, `200`, still `stopped` |

**All four new controls no-op silently when nothing is loaded, and report `200` while doing so.**
Forwarding one blind would produce a success reply for an action that did not happen — which is
why the agent reads state *first* and returns `409` (FR-006a), exactly as `pause`/`play` already
do. This is the measurement that makes the refusal parity of SC-003 a requirement rather than a
preference.

## Consequences for the implementation

- **T006 `seek`**: issue `command=seek&val=` with an **explicit sign always** — `%2B` for
  positive, `-` for negative. **Never a bare number**: that is an absolute seek (§3).
- **T004 ban**: the forbidden pattern is a `val=` whose value starts with a digit (unsigned).
  The adapter may only ever emit a signed value. Mandated by FR-011.
- **T007 `POST /seek`**: reject missing / blank / non-integer `seconds` with **`400`** naming the
  parameter. §6 shows a bad value silently jumps the player to 0 — the destructive case a silent
  default would cause.
- **T007 / T016 state gate**: read state first; `stopped` → **`409`**. §9 shows every one of the
  four no-ops silently otherwise.
- **T015 `next` / `previous`**: `pl_next` / `pl_previous`, no parameters, no playlist inspection.
- **Replies claim nothing.** §5 (absurd positions accepted), §7 (paused becomes playing), §8
  (boundary wraps) and §6 (unknown commands return `200`) each independently prove the agent
  cannot know what a control achieved. A `200` means *issued*.
- **No new network exposure**: both scratch instances bound loopback, as 003 measured. Nothing to
  forward, no firewall rule.
