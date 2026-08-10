# Quickstart: One console for the operator

**Feature**: 008-local-console · **Date**: 2026-08-10

How to prove this feature works, on `watson`, against real targets. Runs in about fifteen
minutes plus one game start.

Each section names the requirements it validates. §1 is a **prerequisite** — it is the M0
measurement, and the rest of US2 is not implementable until it has been recorded.

---

## 0. Prerequisites

- `orchestrator/.env` present with a valid `TENANTS` and `FOLLOWUP_TIMEOUT_MS`.
- `agent/.env.palworld`, `.env.satisfactory`, `.env.vlc` present.
- `npm run check:all` green.
- Nothing from the control plane currently running (`reveille plane status` to confirm, or
  close the old windows).

## 1. M0 — the spawn flags (prerequisite, blocks US2)

Measured, not assumed: `detached` and `windowsHide` set different Windows process-creation
flags and their interaction is the whole question (`research.md` §5). Record the result in
`m0-windows-spawn.md` before writing the launcher.

Spawn one agent with the candidate flags, then check all four:

| # | Observation | Expected |
|---|---|---|
| 1 | Any console window appear? | **No** — none, not even a flash |
| 2 | `curl http://127.0.0.1:8300/status` | HTTP 200 — genuinely serving, not just alive |
| 3 | Close the launching terminal, re-check `/status` | Still 200 — it survived |
| 4 | `logs/palworld-agent.log` | Contains the agent's startup output, and grows |

If any fails, record what happened and take the fallback in `research.md` §5 rather than
inventing a new one.

## 2. The console commands a target with the orchestrator stopped

**Validates US1 · FR-008, FR-009, FR-018, FR-019, SC-001, SC-005**

```bash
reveille plane down                 # everything off, including the orchestrator
reveille status                     # still answers — targets, not processes
reveille start satisfactory         # blocks, watching
```

Expected: `status` reports each target without the orchestrator running at all. `start`
issues the launch, watches in the **foreground**, and reports the server running when the
agent observes it — then exits with `0`.

Then prove the interrupt rule: run `reveille start palworld` and press **Ctrl-C** while it is
still starting. The console must say the launch was issued and is unaffected, and exit. Check
with `reveille status` a minute later — Palworld should still be coming up or up. Nothing was
cancelled, and no watcher was left behind.

## 3. The reply says what a member sees, plus what an operator needs

**Validates US3 · FR-021, FR-023, SC-004**

```bash
reveille pause                      # with VLC playing
reveille pause                      # again
reveille forward 90
```

Each prints the member's sentence, then the diagnostic beneath it, then which agent answered.
The first line must be **word-for-word** what Discord shows for the same command — run
`/pause` in Discord and compare. The extra lines are the operator's and appear only here.

Then close VLC entirely and run `reveille status`. The VLC line must read unreachable **and**
say whether the vlc agent process is running — the FR-025 addition. Confirm both halves by
stopping the agent too (`reveille plane down vlc-agent`) and re-running: the same target line
must now distinguish the two situations.

## 4. Help cannot disagree with Discord

**Validates US3 · FR-004, FR-005, FR-006, SC-004**

```bash
reveille help
reveille                            # identical output
```

Compare against `/help` in Discord, line by line. Every form and every description must
match. To prove it is a derivation rather than a copy, temporarily change one command's
description in `buildCommandGroups`, re-run both, and confirm **both** changed. Revert.

## 5. No windows, and the output survives

**Validates US2 · FR-026, FR-027, FR-028, FR-031, SC-002, SC-003**

```bash
reveille plane up
```

Expected: four services start, **no window appears**, and each is confirmed serving before
the command reports success. Then:

- Close the launching terminal, open a new one, `reveille plane status` — all four still up.
- `reveille plane logs` — merged, followable output from all four.
- `reveille plane restart orchestrator` — only that one restarts; the three agents keep
  running and their logs keep their current generation.
- Check `logs/` — `orchestrator.log` is fresh and `orchestrator.log.1` holds the previous
  run. Restart once more and confirm there is still no `.log.2`.

Then the confusion check (**FR-024**), in the state where it actually matters. With the plane
up but **every game server stopped**:

```bash
reveille plane status                # all four services UP
reveille status                      # every game target stopped
```

Both are correct and they disagree. Read them side by side: nothing in either output may let
"the agent is up" be mistaken for "the game is up". Each must name the object it is talking
about. This is the pairing the whole verb split exists to keep straight, so separating the
commands is not enough if their answers still read alike.

## 6. A failed start is reported as failed

**Validates US2 · FR-034, SC-010** — the requirement that exists because the windows are gone.

```bash
reveille plane down
# temporarily blank VLC_PASSWORD in agent/.env.vlc
reveille plane up
```

Expected: the vlc agent is reported **failed**, not started, naming `logs/vlc-agent.log`;
the other three are reported up; the exit code is non-zero. The log contains the fail-loud
error naming `VLC_PASSWORD`. Restore the password and re-run — all four up, exit `0`.

This is the scenario that was previously survivable only because the failure was visible in
the window the launcher spawned.

## 7. `plane down` never touches a target

**Validates US2 · FR-032, FR-033, SC-008** — the Constitution IV guard.

With **Palworld running and a player connected**, and VLC playing:

```bash
reveille plane down
```

Expected: every Reveille process stops; the Palworld server keeps running and the player
stays connected; VLC keeps playing. Confirm by rejoining the game and looking at VLC — not by
reading the console's own output.

Also start an unrelated `node` process (`node -e "setInterval(()=>{},1e3)"`) and confirm
`plane down` leaves it alone.

## 8. Refusals, ambiguity, and exit codes

**Validates FR-003, FR-013, FR-022, SC-007** — check `$LASTEXITCODE` after each.

| Command | Expected | Code |
|---|---|---|
| `reveille start satisfactory` (already running) | refusal, nothing launched | `2` |
| `reveille pause` (vlc agent down) | unreachable | `3` |
| `reveille stop` | fails naming **both** the target and the plane | `64` |
| `reveille start nosuchgame` | refused, lists valid names, contacts nothing | `64` |
| `reveille start vlc` | refused — wrong kind for that verb | `64` |
| `reveille status` (all healthy) | every target reported | `0` |

Then the config guards: point two tenants' `palworld` at **different** URLs in `TENANTS` and
confirm any command refuses naming both tenants (FR-013). Point them at the **same** URL and
confirm it unions to one entry. Blank `TENANTS` entirely and confirm the failure names the
variable (FR-014). Restore.

## 9. The console leaves nothing behind

**Validates FR-016, FR-017, FR-020, SC-006**

After exercising everything above:

- No file the console wrote other than `logs/*` — no state file, no cache, no manifest.
- `Get-Process node` shows only the four plane services; no console process survives.
- Nothing scheduled: `Get-ScheduledTask | ? TaskName -like '*reveille*'` returns nothing.

And the secrets guard: run every command with output captured and confirm **no** value from
`orchestrator/.env` appears — in particular `DISCORD_BOT_TOKEN` (`research.md` §9).

## 10. The old script is gone

**Validates FR-036**

`scripts/reveille.ps1` no longer exists; `scripts/reveille.cmd` launches the console; `CLAUDE.md`
describes the new verbs. There is no second way to manage the plane.

---

## Manual slice

Everything above is automatable except the observations that are irreducibly human:

- **"No window appears"** (§1, §5) — a visual confirmation. Process-list checks can support
  it but cannot replace it.
- **The player stays connected** (§7) — needs someone in the game.
- **VLC keeps playing** (§7) — a glance at the screen.
- **The help text matches Discord's** (§4) — needs a Discord client; the derivation itself is
  unit-testable, the visual comparison is not.
