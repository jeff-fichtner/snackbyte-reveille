# M0 — Satisfactory dedicated server, observed

**Measured on watson, 2026-08-02.** The real server (`FactoryServer.exe`), claimed
and exercised over its own loopback HTTPS API — no game client involved. These are the
facts `satisfactory.ts` (T011) is written against; where they refine an earlier
assumption, that is called out.

## The API

- **Endpoint**: `POST https://127.0.0.1:7777/api/v1`, JSON body
  `{"function": "...", "data": {...}}`, **self-signed TLS** (`node:https` with
  `rejectUnauthorized:false`, loopback-scoped). `7777/TCP` = API, `7777/UDP` = game
  (confirmed — research R7 holds).
- **Auth** (one-time claim, then password login):
  1. `PasswordlessLogin` `{"MinimumPrivilegeLevel":"InitialAdmin"}` — works **only while
     unclaimed**; returns an InitialAdmin token.
  2. `ClaimServer` `{"ServerName","AdminPassword"}` (Bearer InitialAdmin) — claims once,
     returns an Administrator token.
  3. `PasswordLogin` `{"MinimumPrivilegeLevel":"Administrator","Password"}` — the path
     the adapter uses every boot. Returns an Administrator token.
  - The token is **stable per privilege**, not a rotating session id: base64 of
    `{"pl":"Administrator"}` + a signature. Fetch once per process, reuse.
- **Verbs used**: `HealthCheck` (unauth), `QueryServerState`, `SaveGame`, `Shutdown`,
  `CreateNewGame`.

## State — refines `data-model.md`

`data-model.md` said *"QueryServerState answers ⇒ running."* **Measured: too coarse.**
The API answers ~10s after launch on a **claimed but session-less** server, with
`serverGameState.isGameRunning:false` and a live tick rate. "The API answers" is not
"a world is up."

Corrected mapping for `getState()`:

| State | Signal |
|---|---|
| `stopped` | no `FactoryServer-Win64-Shipping` process |
| `starting` | that process exists, **and** QueryServerState is unreachable **or** `isGameRunning:false` |
| `running` | QueryServerState reachable **and** `serverGameState.isGameRunning === true` |

**Process-match gotcha (important):** the dedicated server is
`FactoryServer-Win64-Shipping.exe`; the **game client** is
`FactoryGameSteam-Win64-Shipping.exe`. Both match a loose `Factory…Win64-Shipping`.
The `starting`/`stopped` check MUST anchor on **`FactoryServer`** specifically, or a
running game client false-positives as "the server is up." (Observed live: the client
was open during M0 and would have fooled a loose match.)

## Timing

- HTTPS API first answers **~10s** after `FactoryServer.exe` launch (empty, unclaimed).
- After `CreateNewGame`, `isGameRunning` is **true immediately** on the next query
  (world already ~16s of game-time in) — a fresh empty world loads fast.

## Save & stop — the guarantee

- `SaveGame {"SaveName":"X"}` writes
  `%LOCALAPPDATA%\FactoryGame\Saved\SaveGames\server\X.sav` (the **`server\`**
  subfolder — dedicated-server saves are segregated from singleplayer). Empty response
  body = success.
- Verified **save-before-shutdown**: `X.sav` timestamp lands, *then* `Shutdown` is
  issued. `Shutdown` is graceful; the process exits in **~5s**; the API goes silent.
- This is the SC-002 analogue for Satisfactory and the shape `stop()` implements:
  `SaveGame` → verify the file advanced → `Shutdown`. No force path.

## `CreateNewGame` shape (for completeness)

`NewGameData` deserialization is strict and reveals missing keys one at a time. Minimum
that succeeds: `{"MapName":"", "SessionName":"…", "StartingLocation":"", "bSkipOnboarding":true}`
(note the Unreal `b` prefix on the bool). The adapter does not create games — this was
only to obtain a running world to test save/stop.

## Deployment notes (for when US1 lands)

- **Auto-load a session so `start()` reaches `running` on its own** — set
  `autoLoadSessionName` to the claimed session (currently `Reveille-M0`), mirroring
  Palworld's spawn-and-the-world-comes-up. Without it a booted server sits at
  `isGameRunning:false` forever.
- The **admin password** set at claim lives in `agent/.env` (`GAME=satisfactory`
  deployment), loopback-only, **never committed** — same handling as
  `PALWORLD_ADMIN_PASSWORD`. It is currently held outside the repo.
- The server is **already claimed** on watson; M0 does not need repeating.
