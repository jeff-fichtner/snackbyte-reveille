# Data Model: A second controlled game server

**There is still no persisted data.** FR-012 forbids state that outlives a process;
FR-032 makes even the follow-up's pending wait explicitly in-memory-only. Everything
below is either configuration (read at boot) or derived per request (never stored).

---

## Controlled server (configuration, orchestrator-side)

The set of servers the system can act on. Exists **only** in orchestrator config and
the Discord surface — never in the contract.

| Field | What it is | Where it lives |
|---|---|---|
| name | the human label players type (`palworld`, `satisfactory`) | orchestrator config `AGENTS` + the Discord subcommand |
| base URL | where the orchestrator reaches that server's agent | orchestrator config `AGENTS` |
| game public port | the port players connect to, per server, reported by `/address` | orchestrator config |

**Invariant:** the name is not an identity in the contract. Renaming a server is a
config edit with no effect on any component boundary (spec Assumptions). Adding a
server is one row here plus deploying its agent (FR-024).

---

## Game adapter (interface, agent-side)

The one boundary that knows a specific game. Exactly one is active per agent
deployment, chosen by the `GAME` config value.

```
GameAdapter
  getState() -> Promise<ServerState\{'error'}>   // running | starting | stopped
  start()    -> void                             // spawn detached; do not wait or verify
  stop()     -> Promise<void>                    // save, verify, shutdown; throw if not graceful
```

| Implementation | Game | Talks over |
|---|---|---|
| `palworld.ts` | Palworld | plain-HTTP REST, Basic auth (`fetch`) |
| `satisfactory.ts` | Satisfactory | HTTPS function-dispatch, Bearer token (`node:https`, self-signed) |

**Invariant:** no code outside the active adapter branches on which game it is
(FR-025). The HTTP layer, config loader, serialization, and orchestrator are all
adapter-agnostic.

---

## Server state (derived, never stored)

Unchanged from 001, and identical across both adapters — the two-signal derivation
(DECISIONS 010):

| State | How it is derived |
|---|---|
| `running` | the game's control API answers |
| `starting` | the game process exists, but its API is not answering yet |
| `stopped` | no game process, API not answering |
| `error` | an operation outcome — **never** a derived state |

```
stopped ──start──► starting ──(API comes up)──► running
running ──stop───► (save, verify, shutdown) ──► stopped
```

Per server, independently. One server's state is unaffected by commands to another
(FR-021, SC-003). `/status` reports each server's derived state, and `unreachable`
for any whose agent cannot be reached (FR-023, FR-026) — a transport fact, not a
fifth state.

---

## Pending follow-up (in-memory only, US3)

Created when a `/start` launches a server; discharged when the follow-up posts.

| Field | What it is |
|---|---|
| which server | the name, so the follow-up message identifies it (FR-031) |
| channel / interaction handle | where to post the follow-up (FR-028) |
| deadline | when to give up and report "could not confirm" (FR-029) |

**Invariant:** never persisted. If the orchestrator restarts mid-wait, the pending
follow-up is gone and none is posted for that start (FR-032) — consistent with
FR-012, and preferable to a claim made from state that outlived a restart.

---

## Command (transient, per interaction)

| Command | Names a server? | Reads/writes | Follow-up? |
|---|---|---|---|
| `/start <server>` | yes (subcommand) | launches one | yes, if it launched |
| `/stop <server>` | yes (subcommand) | saves+stops one | no |
| `/status` | no — reports all | reads only, changes nothing | no |

Every command that acts on a server names it in both directions: the player picks it,
and the reply says which server it acted on (FR-018). No command assumes a default
(FR-019); an unknown name is refused with the valid list (FR-020).
