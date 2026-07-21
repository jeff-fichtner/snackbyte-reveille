# Phase 0 Research: Start and stop the game server from Discord

**Feature**: `001-discord-start-stop` · **Date**: 2026-07-21

Only unknowns that block design are researched here. Runtime, repo shape, and the
seam are already settled in `initial-architecture/DECISIONS.md` and are not
revisited.

---

## R1 — How the game server is stopped gracefully

**Decision: the Palworld REST API. `POST /v1/api/save`, then `POST /v1/api/shutdown`.**

**Rationale.** [FR-005/FR-006](spec.md) require a stop to save first and to fail
rather than kill. The REST API exposes exactly the two operations needed, in the
required order, and each returns a status the agent can check before proceeding.

**Alternatives considered:**

- **RCON (`Save`, then `Shutdown {seconds} {message}`).** Functionally equivalent
  and what every guide still recommends. **Rejected: Pocketpair has officially
  deprecated RCON and it is scheduled to stop working in a future update.**
  Building the first adapter on a deprecated interface would mean rewriting the
  only Palworld-specific code in the system for no gain.
- **`POST /v1/api/stop`.** This is *force* stop. **Rejected outright — it is
  precisely the "kill the process to satisfy the call" that FR-006 and
  Constitution Principle IV forbid.** It must not appear anywhere in the agent.
- **Terminating the OS process.** Same objection, worse.

**Consequences.** The agent needs the REST API enabled and an `AdminPassword`
set. Stop becomes two sequential calls, and a failed `save` MUST abort before
`shutdown` is attempted — that ordering is the whole guarantee.

> **Recorded as [DECISIONS 009](../../initial-architecture/DECISIONS.md)**, per
> Constitution Principle V — a chosen candidate reaches the permanent log with
> what it beat, before this disposable artifact is discarded.

---

## R2 — How the game server is launched

**Decision: spawn `PalServer.exe` with the standard performance flags, and treat
the launch call returning without error as success.**

```
PalServer.exe -useperfthreads -NoAsyncLoadingThread -UseMultithreadForDS
```

Installed via SteamCMD, app id **2394010**, anonymous login. Default game port
**8211/UDP**.

**Rationale.** Matches the documented launch path, and "spawn and report" is the
clarified posture ([Clarifications 2026-07-21](spec.md)).

**Open risk carried into implementation, not resolved here:** `PalServer.exe` is
a launcher that spawns `PalServer-Win64-Shipping-Cmd.exe` as a child. The
launcher may exit while the real server keeps running, so **process identity is
not a reliable "is it up?" signal.** This does not affect start (which doesn't
verify) but it does affect how "already running" is determined for FR-008.
Resolved in R3 rather than by process inspection.

---

## R3 — How "already running" is determined

**Decision: ask the REST API. If `GET /v1/api/info` answers, the server is up.**

**Rationale.** Avoids the launcher/child process ambiguity in R2 entirely, and
FR-012 forbids remembering anything between requests — so state must be derived
by asking, at the moment of the request. The REST API only answers once the
server is actually serving, which is a stronger signal than a live process.

**Alternatives considered:**

- **Track the spawned PID.** Rejected: violates FR-012, and the launcher's PID is
  the wrong one anyway.
- **Check the game port.** Rejected: more work than an HTTP call already needed.
- **Check for a server process.** Rejected as an "is it up?" signal, for the R2
  reason — the launcher exits and process identity lies. **Accepted for one
  narrower job:** telling `starting` apart from `stopped`, which the REST API
  alone cannot do.

**Consequence — "still starting" for FR-017 needs a second signal.** A silent
REST API is ambiguous: it means *starting* or *stopped*, and nothing in the HTTP
response separates them. State is therefore derived from two questions asked at
request time — does `GET /v1/api/info` answer, and does a `PalServer.exe` **or**
`PalServer-Win64-Shipping-Cmd.exe` process exist:

| REST answers | Either process exists | State |
|---|---|---|
| yes | — | `running` |
| no | yes | `starting` |
| no | no | `stopped` |

Both names are checked because each covers the other's blind spot: the launcher
exists from the instant `spawn` returns, closing the window before the child
appears; the child covers the R2 case where the launcher exits early while the
server keeps running. Nothing is remembered between requests, so FR-012 holds.

**This is a check-then-act, so it MUST be serialized.** Two concurrent `/start`s
could both read `stopped` before either spawns. The agent serializes command
handling in-process so the second re-reads state after the first has spawned and
is refused. That is mutual exclusion within a request, not retained state — and
it is separately required by the spec's concurrent-command edge case.

---

## R4 — Libraries

| Need | Decision | Rationale |
|---|---|---|
| Discord bot | **discord.js** | The de-facto Node library; slash commands and deferred replies are first-class, which SC-004's 3-second acknowledgement needs |
| Agent HTTP server | **`node:http`** | Two endpoints. A framework earns nothing here, and Principle III says don't pay for it |
| HTTP client | **native `fetch`** | Built into Node 24. No dependency |
| Palworld REST calls | **native `fetch` + Basic auth** | Small enough that a client library is not worth a dependency |
| Tests | **`node:test` + `node:assert`** | Built in. Zero dependencies, no config |

**Alternatives considered:** Express for the agent (rejected — a dependency to
route two paths); a Palworld API wrapper package (rejected — an unvetted
dependency in the security-sensitive path, wrapping four calls we make once).

---

## R5 — Exposure

**Decision:**

| Interface | Binds to | Internet-reachable |
|---|---|---|
| Game port 8211/UDP | all interfaces | **Yes — the only one.** Forwarded so Noah can play |
| Agent HTTP | `127.0.0.1` | No |
| Palworld REST API 8212 | `127.0.0.1` | No |
| RCON 25575 | disabled entirely | No |

**Rationale.** Satisfies FR-013/014/015. Palworld's own documentation states the
admin APIs *"are not designed to be exposed directly to the Internet, as
publishing directly to the Internet may result in unauthorized manipulation of
the server"* — so this is the vendor's position, not a preference.

RCON is disabled rather than merely firewalled: it is deprecated (R1), unused by
this design, and an admin interface that exists but is unused is only a liability.

**`AdminPassword` MUST be set to a real value.** The REST API's Basic auth
depends on it, and an empty admin password on a running server is an open admin
interface on the LAN.

**Consequence:** because the agent binds to loopback, the orchestrator MUST run
on the same host at this milestone. That is already true and already recorded as
the assumption that expires when the orchestrator relocates.

---

## Resolved

No `NEEDS CLARIFICATION` markers remain in Technical Context.

## Sources

- [Palworld Server Guide — REST API](https://docs.palworldgame.com/api/rest-api/palwold-rest-api/)
- [Palworld Server Guide — Commands](https://docs.palworldgame.com/settings-and-operation/commands/)
- [Palworld Server Guide — Deploy dedicated server](https://docs.palworldgame.com/getting-started/deploy-dedicated-server/)
- [Palworld Server Guide — Configure the server](https://docs.palworldgame.com/settings-and-operation/arguments/)
