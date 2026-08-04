# Quickstart: pause and resume the show

**Feature**: `003-media-control` · **Date**: 2026-08-03

How to prove the media control works — and, the SC-007 guarantee, that adding it changed
nothing about the game servers. Validation only; implementation belongs in `tasks.md`.

## Prerequisites

**M0 for VLC, before any adapter code is trusted** — the same bar the game APIs had.
Only the operator can enable the interface.

1. **VLC installed** on `watson`.
2. **Web interface enabled + password set** (the one-time operator setup, ~2–5 min):
   VLC → Tools → Preferences → *Show settings: All* → Interface → Main interfaces →
   check **Web**; then Interface → Main interfaces → Lua → **Lua HTTP → Password**. Restart
   VLC. (The whole feature's setup cost is this.)
3. **Observed, not assumed** (feeds `vlc.ts`): the control endpoint and port (default
   `http://127.0.0.1:8080/requests/status.json`); that Basic auth is **empty username +
   the password**; the exact `command=` names for pause/resume (`pl_forcepause` /
   `pl_forceresume`); the `state` values (`playing` / `paused` / `stopped`); and how
   *nothing loaded* presents. Record in `m0-vlc.md`.
4. **No exposure step** — unlike the games, there is nothing to forward or firewall. The
   web interface binds loopback; confirm it is not reachable off-box (it should not be).

**Config:**

```
# agent beside VLC — kind=media, VLC web-interface URL + password (its own env file)
# orchestrator — AGENTS gains { name: "vlc", url: <agent>, kind: "media" } (no publicPort)
```

## Run

```bash
# Windows — the media agent alongside the game agents
node --env-file=agent/.env.vlc agent/src/index.ts     # answers on its loopback port

# WSL2 — the one orchestrator, now knowing the media target too
cd orchestrator && npm start                          # registers /pause /play; /status folds media in
```

Or bring the whole control plane up at once: `./scripts/reveille.ps1 start`.

## Validation

### 1. The media agent alone, before Discord — VLC over `curl`

With a video **playing** in VLC:

```bash
curl -s http://127.0.0.1:<port>/status           # {"state":"playing"}
curl -i -X POST http://127.0.0.1:<port>/pause    # 200 {"state":"paused"} — VLC visibly pauses
curl -i -X POST http://127.0.0.1:<port>/pause    # 200 {"state":"paused"} — no-op, already paused
curl -i -X POST http://127.0.0.1:<port>/play     # 200 {"state":"playing"} — resumes from the same spot
```

With **nothing loaded** in VLC:

```bash
curl -i -X POST http://127.0.0.1:<port>/pause    # 409 stopped — refused honestly (FR-008)
curl -s http://127.0.0.1:<port>/status           # {"state":"stopped"}
```

### 2. From Discord

| Step | Expected |
|---|---|
| a show is playing, then `/pause` | it pauses on the host within ~2s; the reply says paused (SC-002) |
| `/play` | it resumes from where it stopped; the reply says playing |
| `/pause` again while paused | reply says already paused — a no-op, not an error (FR-007) |
| the girlfriend (in the guild) sends `/pause` from her phone | works identically — no auth, two taps (SC-001) |
| the media agent is stopped, then `/pause` | "could not reach the player" — distinct from a playback state (FR-009) |

### 3. The folded `/status`

| Step | Expected |
|---|---|
| a game running, the show paused, then `/status` | both listed — the game as *running*, the player as *paused*, each in its own vocabulary (US2) |
| VLC closed, then `/status` | the player listed *unreachable*; the game servers still report normally |

### 4. No exposure (SC-004)

From **outside** the network, confirm the feature opened nothing: no new port answers
because of media control (the web interface and the agent are loopback-only). The game
ports are exactly as 002 left them.

### 5. The guarantee that must still hold — the games are unchanged (SC-007)

Re-run 002's quickstart against Palworld and Satisfactory: every start/stop/status/
address behaves exactly as before, and the game agents never answer the media verbs.
Adding media control must not have touched any of it.

## Not validated here

Deliberately, per the happy-path posture inherited from 001/002: a player that crashes
mid-command (surfaced as *unreachable* on the next read), seeking/volume/playlist (out of
scope), and a second media player (proven by *description* — one more `AGENTS` row plus an
agent deploy — not by building it).
