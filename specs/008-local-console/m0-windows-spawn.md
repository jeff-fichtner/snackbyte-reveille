# M0: Windows spawn flags for a windowless, surviving service

**Feature**: 008-local-console · **Task**: T002 · **Measured**: 2026-08-10 on `watson`
(Windows 11 Pro 10.0.26200, Node v24.18.0)

**Result: the candidate flag combination works exactly as `research.md` §5 hoped. All four
observations pass. No fallback needed.**

This gates every US2 implementation task. `detached` and `windowsHide` set *different and
potentially conflicting* Windows process-creation flags — `DETACHED_PROCESS` /
`CREATE_NEW_CONSOLE` versus `CREATE_NO_WINDOW` — so their interaction had to be measured
rather than assumed.

## The measured combination

```js
spawn(process.execPath, ['--env-file=<envFile>', '<entryScript>'], {
  cwd: repoRoot,
  detached: true,      // survive the launching process
  windowsHide: true,   // no console window
  stdio: ['ignore', fd, fd],   // fd from fs.openSync(logPath, 'a')
});
child.unref();
```

## Method

Measured against a **real agent**, not a stub — the M0 rule. The live control plane was
running at the time (all three agents plus the orchestrator), so rather than disturb it the
probe used a copy of `agent/.env.vlc` with `AGENT_PORT=8399`, removed afterwards.

The spawning script called `process.exit(0)` **immediately** after `unref()`. Anything still
alive afterwards is therefore orphaned by construction — that is observation 3, rather than a
claim about it.

## Observations

| # | Question | Method | Result |
|---|---|---|---|
| 1 | Does a console window appear? | `MainWindowHandle` / `MainWindowTitle` on the child, plus a `conhost.exe` count before and after | **No window.** `MainWindowHandle=0`, empty title, and **`conhost` delta = 0** — not merely hidden, no console host was created at all |
| 2 | Is it genuinely *serving*, not just alive? | `GET http://127.0.0.1:8399/status` | **HTTP 200** with a well-formed response body |
| 3 | Does it survive the launching process? | Read the child's `ParentProcessId`, then look that parent up | **Survived.** Parent `7136` **GONE**; child `48364` alive and holding its port |
| 4 | Does the redirected log fill? | Read the log file after startup | **Yes** — `agent listening on http://127.0.0.1:8399` |

### 1 — the window

The `conhost.exe` count is the load-bearing part. A count unchanged at 33 across the spawn
means Windows created **no console host**, which is stronger than a window that exists and is
hidden: there is nothing to flash, nothing to focus, and nothing to restore. `MainWindowHandle=0`
alone would not have distinguished those two cases.

### 2 — serving

The probe was a media agent and its `/status` returned `200` with `state`, `title`,
`elapsedSeconds`, and `totalSeconds` populated. Content redacted here deliberately: **this
repository is public**, and the body named what was actually playing on the machine.

Incidental confirmation: the 007 seam-v5 observation fields are live and populated on a real
agent, which is not something 008 needed to assume but is good to have seen.

### 3 — survival

The parent had already exited before the check ran, and the child was still listening. This
is the property `plane up` depends on: `reveille` is one-shot and exits, and the services it
launches must not go with it.

### 4 — the log

The agent's startup line landed in the redirected file. This is what makes FR-034's readiness
check possible for the orchestrator, which has no port to probe but *does* write
`orchestrator connected as …` on `clientReady` — the readiness signal was always there;
redirecting stdout is what makes it readable.

## Consequences for implementation

- **T028 uses the flags above unchanged.** The `research.md` §5 fallbacks (drop `detached`;
  or a hidden launcher stub) are **not needed** and should not be built.
- Readiness probing differs by kind exactly as `research.md` §6 planned: agents answer
  `GET /status`; the orchestrator is detected by its log line.
- `stdio: ['ignore', fd, fd]` with a single append-mode descriptor for both stdout and stderr
  interleaves them into one file, which is what `plane logs` wants.

## Not measured

- **The visual confirmation remains manual.** "No `conhost` was created" is strong evidence
  and is the best an automated check can do; a human still has to look at the screen once
  (`quickstart.md`, manual slice).
- **Behaviour on a machine with no interactive session** (a service or scheduled task) — out
  of scope by decision, since that path is explicitly deferred with its own coupled decision.

## Cleanup performed

The probe agent was stopped, `agent/.env.m0probe` deleted, and the live control plane
verified untouched afterwards: `8300`, `8301`, `8302` still listening and the orchestrator
still alive.
