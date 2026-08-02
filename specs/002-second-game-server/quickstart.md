# Quickstart: validating two controlled servers

**Feature**: `002-second-game-server` · **Date**: 2026-08-02

How to prove the second server works and — the harder guarantee — that adding it
changed nothing about the first (SC-009). Validation only; implementation belongs in
`tasks.md`.

## Prerequisites

**M0 for Satisfactory, before any adapter code is trusted** — the same bar Palworld
had. Only the operator can do the claim step.

1. **Satisfactory dedicated server installed** (done — SteamCMD app `1690800` at
   `C:\steamcmd\steamapps\common\SatisfactoryDedicatedServer`).
2. **Claimed from the game client**: set the admin password, name the server, create
   or load a session. The HTTPS API is inert until the server is claimed.
3. **Observed, not assumed** (feeds `satisfactory.ts`): the `PasswordLogin` →
   token → `QueryServerState` / `SaveGame` / `Shutdown` request/response shapes; how
   long after launch the API answers; the child process name(s) for the
   `starting`/`stopped` split; that `7777/TCP` is the API and `7777/UDP` is the game.
4. **Firewall**: a rule blocking `7777/TCP` from the LAN, mirroring the Palworld 8212
   rule. Forward **`7777/UDP` only** if hosting.
5. **Palworld M0** already satisfied (001).

**Config for both servers:**

```
# agent beside Palworld — GAME=palworld, its port + admin password (001's agent/.env)
# agent beside Satisfactory — GAME=satisfactory, its API port + admin password
# orchestrator — AGENTS maps: palworld=<url>, satisfactory=<url>; a game public port each
```

## Run

```bash
# Windows — one agent per server, each with GAME set
cd agent && GAME=palworld     npm start   # answers on its loopback port
cd agent && GAME=satisfactory npm start   # answers on its loopback port

# WSL2 — one orchestrator, knowing both agents
cd orchestrator && npm start              # registers /start /stop /status with both subcommands
```

## Validation

### 1. The agents alone, before Discord — each adapter over `curl`

For **each** server's agent (this is where the risk is; the Satisfactory one is new):

```bash
curl -s http://127.0.0.1:<port>/status         # {"state":"stopped"}
curl -i -X POST http://127.0.0.1:<port>/start  # 202 {"state":"starting"}
# poll until running:
curl -s http://127.0.0.1:<port>/status         # eventually {"state":"running"}
curl -i -X POST http://127.0.0.1:<port>/start  # 409 running — no second instance (FR-008)
curl -i -X POST http://127.0.0.1:<port>/stop   # 200 stopped — after save + shutdown
curl -s http://127.0.0.1:<port>/status         # {"state":"stopped"}
```

When both agents pass this identically, the `GameAdapter` interface holds — the same
three verbs, two games.

### 2. Named commands from Discord

| Step | Expected |
|---|---|
| `/start satisfactory` | Satisfactory launches; reply names it; Palworld untouched (AC US1/1, SC-003) |
| `/start palworld` | Palworld launches; Satisfactory keeps running — independent (AC US1/3) |
| `/stop satisfactory` | its world saved, it exits; Palworld unaffected (AC US1/2) |
| a command with no subcommand | rejected by Discord — no default assumed (FR-019) |

### 3. Status — read-only, per server

| Step | Expected |
|---|---|
| one running, one stopped, then `/status` | each reported with its own state; neither altered (SC-005) |
| a server mid-launch | reported `starting`, distinct from running/stopped |
| an agent stopped, then `/status` | that server reported **unreachable**; the others report normally (FR-023, FR-026) |
| any server with players connected | reply says nothing about who or how many (FR-011) |

### 4. Told when it is up (US3)

1. `/start satisfactory`, then put the phone away.
2. The immediate reply reads **in progress**, not done (FR-027).
3. A **follow-up message** arrives when the server is reachable — "it's up", naming
   the server (FR-028, FR-031). Confirmed by joining.
4. Repeat against a server that will not come up (bad config): the follow-up reports
   **could not confirm** within the bound — never "it failed" (FR-029).
5. A refused `/start` (already running) posts **no** follow-up (FR-030).

### 5. The guarantee that must still hold — 001 is unchanged (SC-009)

Re-run 001's own quickstart against the Palworld server: every start/stop/refusal
behaves exactly as before, and — the zero-tolerance one — `/stop` still saves the
world before exit (SC-002). Adding Satisfactory must not have touched any of it.

## Not validated here

Deliberately, per the happy-path posture inherited from 001: a server that dies right
after launching (now surfaced by US3's "could not confirm" rather than silence), and
a third game (proven by *description* — one `AGENTS` row + one agent deploy, no
contract change — SC-008, not by building it).
