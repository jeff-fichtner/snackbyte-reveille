# Data Model: Start and stop the game server from Discord

**Feature**: `001-discord-start-stop` · **Date**: 2026-07-21

**There is no persisted data in this feature.** FR-012 forbids any state that
outlives a process, so there are no tables, files, schemas, or migrations. What
follows are the transient shapes that exist only for the life of a request.

## Entities

### Game server (external, not owned)

The Palworld dedicated server process on `watson`. It is the thing acted upon;
the system stores nothing about it and owns none of its data.

| Attribute | How it is known |
|---|---|
| Running or not | Asked at request time — `GET /v1/api/info` answers ⇒ running |
| World save | Owned entirely by the game server. The system never reads or writes it |
| Launch path, admin password, ports | Configuration on the agent, not data |

**The world save is the one thing in the system that must never be lost**, and
the system's only interaction with it is asking the game server to write it
before shutting down.

### Server state (derived, never stored)

A value computed per request, never held between them.

| State | How it is derived |
|---|---|
| `running` | REST API answers |
| `starting` | REST API silent, but a `PalServer.exe` **or** `PalServer-Win64-Shipping-Cmd.exe` process exists |
| `stopped` | REST API silent and neither process exists |
| `error` | An operation failed |

**Transitions** — the only two the system can cause:

```
stopped ──/start──► starting ──(game server finishes loading)──► running
running ──/stop───► (save, verify, shutdown) ──► stopped
```

Neither transition is tracked, awaited, or persisted. `starting → running`
happens on its own; the system never observes it and never reports it.

**Refused, not transitions**: `/start` while `running` or `starting` (FR-008),
`/stop` while `stopped` or `starting` (FR-017). Each returns the current state
and changes nothing.

### Command (transient)

A `/start` or `/stop` from Discord. Exists for the duration of the interaction
and is not recorded.

| Attribute | Notes |
|---|---|
| Verb | `start` or `stop` |
| Origin channel | Where the outcome is reported |
| Outcome | Mapped from the agent's response |

**Deliberately not captured**: who issued it (no authorization — FR-001), when,
or what happened. There is no audit trail, no history, and no metrics. If that
becomes necessary, it is a new feature, not a field here.

## Validation rules

There is no user-supplied input to validate — both commands take no arguments.
The only rules that matter are ordering constraints, and they live in
[contracts/agent-api.md](contracts/agent-api.md): save before shutdown, verify
before proceeding, never force.

## Configuration (not data)

Values the agent needs, supplied by environment and excluded from version control.

| Key | Purpose |
|---|---|
| Agent listen port | Loopback bind (FR-013) |
| `PalServer.exe` path | What to spawn |
| Palworld REST base URL | Loopback, port 8212 |
| Palworld admin password | Basic auth for the REST API. **Secret** |
| Discord bot token | Orchestrator only. **Secret** |
| Agent base URL | Orchestrator's one pointer at the agent — its identity |

Secrets live in `.env`, which `.gitignore` already excludes. Per the constitution
the repository is public and MUST NOT contain credentials.
