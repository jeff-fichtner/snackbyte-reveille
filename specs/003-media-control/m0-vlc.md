# M0 — VLC media control (observed, not assumed)

The prerequisite dry run for the VLC media adapter, mirroring the Palworld/Satisfactory
M0s. Everything below was **observed against a real VLC** on `watson`
(`C:\Program Files\VideoLAN\VLC\vlc.exe`, build dated 2025-12-31), driven headless over
loopback. No behaviour here is taken from documentation — the adapter (T010) is written
against these measurements.

## How it was driven

VLC was launched headless (no GUI window), HTTP interface only, bound to loopback, with a
password set on the command line — the automatable stand-in for the operator's one-time
"enable Web Interface + set a password in Preferences" step:

```
vlc.exe --intf dummy --extraintf http --http-host 127.0.0.1 --http-port 8080 \
        --http-password reveille-m0 --loop <a short silent .wav>
```

The `--loop` keeps a 3-second clip playing indefinitely so `state` stays `playing` for
observation (without it the clip ends and VLC falls to `stopped`). A second instance was
launched with **no** media file to observe the nothing-loaded case.

## What was observed

### 1. Endpoint, port, and binding

- The status endpoint is **`GET /requests/status.json`** on the HTTP interface's port,
  default **`8080`**. Commands are issued to the **same** endpoint with a `?command=` query
  parameter (the response is the post-command status).
- `netstat` confirmed the socket binds **loopback only**:
  ```
  TCP    127.0.0.1:8080    0.0.0.0:0    LISTENING    <pid>
  ```
  It is `127.0.0.1`, not `0.0.0.0` — nothing on the LAN can reach it. This is the whole
  reason the feature needs **no** firewall rule or forwarded port (unlike the game agents'
  8212/7777 admin APIs, which bind `0.0.0.0` and must be firewalled). The control path is
  loopback the whole way: orchestrator → media agent → VLC.

### 2. Authentication

- **HTTP Basic auth, empty username + the configured password.** `curl -u ":reveille-m0"`.
- A request with **no** credentials returns **`401`**. So a wrong/blank `VLC_PASSWORD`
  fails loudly at the transport, not silently — which is why config treats it as required
  and fails loud at boot.

### 3. State values (`status.json` → `.state`)

| VLC `state` | Meaning                          | Our `MediaState` |
|-------------|----------------------------------|------------------|
| `playing`   | an item is loaded and advancing  | `playing`        |
| `paused`    | an item is loaded, held          | `paused`         |
| `stopped`   | nothing playing                  | `stopped`        |

The mapping is 1:1 — VLC's three strings are exactly the contract's three `MediaState`
values, so `getState` is a direct pass-through with no invented states.

### 4. Commands (issued as `?command=…` on the status endpoint)

| Action | Command name     | Observed effect on `.state` |
|--------|------------------|-----------------------------|
| pause  | `pl_forcepause`  | `playing` → `paused`        |
| resume | `pl_forceresume` | `paused` → `playing`        |

`pl_forcepause`/`pl_forceresume` (the **force** variants) are unconditional — unlike
`pl_pause`, which *toggles* and would flip the wrong way if our idea of the state is stale.
Forcing the target state is idempotent, which is what the agent's already-in-state no-op
guard relies on.

### 5. Nothing loaded

- With no media, `status.json` reports **`"state":"stopped"`**, **`"length":0`**, and
  **`"currentplid":-1`**. `state:"stopped"` alone is the signal the adapter keys on.
- A `pl_forcepause` sent while nothing is loaded is a **silent no-op** — the response still
  reports `stopped`, no error. VLC will not fabricate a paused state out of nothing. This is
  why the agent reads state *first* and returns a `409` ("Nothing is playing.") rather than
  forwarding a command that would quietly do nothing and mislead the player.

## Consequences for the implementation

- **T010 `agent/src/vlc.ts`** talks plain HTTP to `http://127.0.0.1:8080` with native
  `fetch` and a Basic auth header (empty user + `VLC_PASSWORD`). Plain HTTP on loopback —
  **no `node:https`** (that was only for Satisfactory's self-signed TLS), so the agent keeps
  its zero-runtime-deps rule. `getState` maps `.state` straight across; `pause`/`resume`
  issue the two `pl_force*` commands. Nothing else — no playlist, seek, volume, or content
  selection appears (FR-004, FR-011).
- The agent's `/pause`/`/play` handlers read state first: `stopped` → `409`; already in the
  target state → `200` no-op; otherwise issue the force command → `200`.
- **No network-exposure task** (no firewall rule, no forward) — item 1 proves the surface
  never leaves the box.
