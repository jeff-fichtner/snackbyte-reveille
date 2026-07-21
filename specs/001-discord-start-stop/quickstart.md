# Quickstart: validating start/stop from Discord

**Feature**: `001-discord-start-stop` · **Date**: 2026-07-21

How to prove the feature works end to end. Validation only — implementation
belongs in `tasks.md`.

## Prerequisites

**On `watson` (Windows), before any Reveille code runs:**

1. **Palworld dedicated server installed** via SteamCMD:
   ```
   steamcmd +login anonymous +app_update 2394010 validate +quit
   ```
2. **Server started once by hand** and joined by both players. This is M0 and is
   a hard prerequisite — the adapter is written against observed behaviour.
3. **`PalWorldSettings.ini` configured:**
   ```ini
   RESTAPIEnabled=True
   RESTAPIPort=8212
   AdminPassword="<a real password, not blank>"
   RCONEnabled=False
   ```
   `AdminPassword` is required — REST Basic auth depends on it, and a blank admin
   password is an open admin interface. RCON is off: deprecated and unused.
4. **Firewall/router**: forward **8211/UDP only**. Ports 8212 and the agent's
   port MUST NOT be reachable from outside the LAN (FR-015).
5. **Discord application** created with a bot token and the bot invited to the
   server with the `applications.commands` scope.

**Toolchain**: Node 24, and the orchestrator running under WSL2.

## Setup

```bash
# from repo root
npm install

cp agent/.env.example agent/.env
cp orchestrator/.env.example orchestrator/.env
# fill both in — real values, never committed
```

## Run

```bash
# Windows terminal — the agent lives with the game server
cd agent && npm start

# WSL2 terminal — the orchestrator is developed against generic Linux
cd orchestrator && npm start
```

## Validation

### 1. The agent alone, before Discord is involved

This is where the risk is. Prove it with `curl` — no bot required.

**Order matters.** The server spends ~90 seconds in `starting` before the REST API
answers, and the refusals differ on either side of that edge. Do not skip the wait.

```bash
curl -i -X POST http://127.0.0.1:<agentPort>/start
# expect 202 {"state":"starting"}

# --- immediately, while it is still loading ---
curl -i -X POST http://127.0.0.1:<agentPort>/start
# expect 409 {"state":"starting", ...}  <- FR-008, refused during startup
curl -i -X POST http://127.0.0.1:<agentPort>/stop
# expect 409 {"state":"starting", ...}  <- FR-017, launching process untouched

# --- wait for the starting -> running edge; poll until this returns 200 ---
# curl -su "admin:<AdminPassword>" http://127.0.0.1:8212/v1/api/info

curl -i -X POST http://127.0.0.1:<agentPort>/start
# expect 409 {"state":"running", ...}   <- FR-008, no second instance

curl -i -X POST http://127.0.0.1:<agentPort>/stop
# expect 200 {"state":"stopped"}        <- after save + shutdown

curl -i -X POST http://127.0.0.1:<agentPort>/stop
# expect 409 {"state":"stopped", ...}
```

When these six pass, the hard part is done. Note that `starting` and `running`
are both valid refusals of `/start` — which one you get depends only on whether
the REST API has come up yet.

### 2. Exposure — do this before anyone plays

```bash
# from the LAN, NOT the host: both MUST refuse
curl --max-time 3 http://<watson-lan-ip>:<agentPort>/start
curl --max-time 3 http://<watson-lan-ip>:8212/v1/api/info
```

Then check the **public** address from outside the network: only **8211/UDP**
may answer (SC-007). If the agent port or 8212 is reachable, stop and fix it
before continuing — the agent is remote process control.

### 3. End to end, from a phone

| Step | Expected |
|---|---|
| Type `/start` in Discord | Acknowledged in under 3 seconds (SC-004) |
| Wait, then join | Connected and playing within 2 minutes (SC-001) |
| Have the other player type `/stop` | Stop proceeds; the connected player is dropped — by design (FR-011) |
| Restart and rejoin | **World contains everything from just before the stop** (SC-002) |

### 4. The guarantee that matters most

SC-002 is zero-tolerance, so test it deliberately rather than hoping.

**Beat the autosave, or the test proves nothing.** Palworld autosaves every 30
seconds while a player is connected (`AutoSaveSpan=30`). Join, wander about, stop,
and the world comes back — whether or not `/stop` saved anything at all. A broken
`stop()` passes that test identically; so would pulling the power. What this system
adds is the final sub-30-second window, which is exactly the slice SC-002 names.
So make the change and stop **within a few seconds of it**, before the next
autosave fires.

Conversely, a save written well after the last periodic one, seconds after a stop
was issued, is the signal that `stop()` did the work.

1. Join, do something unmistakable — build a structure, move a long way.
2. `/stop` immediately, without waiting.
3. `/start`, rejoin.
4. **The change is still there.** If it isn't, the save/verify ordering is wrong
   and the feature is broken regardless of what Discord reported.

### 5. Refusals

| Do this | Expect |
|---|---|
| `/stop` while starting | Refused — "a start is in progress" (FR-017) |
| `/start` twice quickly | Second is refused reporting `starting`; **one** server process (FR-008) |
| `/start` again once it is up | Refused reporting `running`; still **one** server process (FR-008) |
| Stop the agent, then `/start` | Orchestrator reports it could not reach the host (FR-009) |

## Not validated here

Deliberately, per the spec's happy-path posture: a server that dies right after
launching (reported as started — you find out by failing to join), and Discord
being unavailable.

Two commands arriving simultaneously **is** handled — T013a serializes command
handling so they resolve to one clean winner — but it is not exercised here.
Reproducing the interleaving by hand is unreliable, and the guarantee is
structural rather than observable.
