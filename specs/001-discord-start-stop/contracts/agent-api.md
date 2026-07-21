# Contract: the seam

**Feature**: `001-discord-start-stop` · **Version**: 1 (M1) · **Date**: 2026-07-21

The line between the orchestrator and the agent. Hand-written, two verbs — per
[DECISIONS 002](../../../initial-architecture/DECISIONS.md), a contract this small
cannot drift, so mechanical enforcement is deferred until presence enters it.

## Shape

- **Transport**: HTTP/1.1, JSON bodies
- **Direction**: orchestrator → agent, always. **The agent never initiates.**
- **Identity**: the agent's base URL *is* its identity. **No server id, machine
  id, or discriminator appears anywhere in a path or body.** A second controlled
  server is a second agent at a second address, not a parameter here
- **Auth**: none. Valid *only* while the agent binds `127.0.0.1`. This expires
  the moment the orchestrator relocates
- **State**: none. Every response is derived by asking the game server now

## `POST /start`

Launch the game server.

**Request**: no body.

**Responses**

| Status | `state` | Meaning |
|---|---|---|
| `202` | `starting` | Launch issued. **Does not mean the server is up or joinable** |
| `409` | `running` | Already running — nothing was launched (FR-008) |
| `409` | `starting` | A start is already in progress — nothing was launched (FR-008) |
| `500` | `error` | The launch call itself failed |

```json
{ "state": "starting" }
{ "state": "running",  "message": "Server is already running." }
{ "state": "starting", "message": "A start is already in progress." }
{ "state": "error",    "message": "Failed to launch: <reason>" }
```

## `POST /stop`

Save the world, then shut the server down.

**Request**: no body.

**Responses**

| Status | `state` | Meaning |
|---|---|---|
| `200` | `stopped` | World saved **and** shutdown issued |
| `409` | `stopped` | Already stopped — nothing was done |
| `409` | `starting` | A start is in progress. Refused (FR-017) |
| `500` | `error` | Could not stop safely. **Server is still running** |

```json
{ "state": "stopped" }
{ "state": "stopped",  "message": "Server is already stopped." }
{ "state": "starting", "message": "A start is in progress. Try again shortly." }
{ "state": "error",    "message": "Could not save the world; server left running." }
```

## Required behaviour

These are contract obligations, not implementation notes. An agent that violates
them is non-conforming regardless of what it returns.

1. **`stop` MUST save before shutting down**, and MUST verify the save succeeded
   before issuing the shutdown.
2. **A `stop` that cannot save MUST leave the server running** and return `500`.
   It MUST NOT proceed to shutdown, and MUST NOT terminate the process by any
   other means. Specifically: **`POST /v1/api/stop` (Palworld's force-stop) and
   OS-level process termination MUST NOT appear in any code path reachable from
   this endpoint.** (FR-006, Constitution IV)
3. **`stop` MUST return within a bounded time** rather than waiting indefinitely
   on a save that is not completing. Exceeding the bound is a `500` with the
   server left running. (FR-007)
4. **`start` MUST NOT launch a second instance** when one is already running or
   starting. (FR-008)
5. **The agent MUST NOT retain state between requests.** `running`, `starting`,
   and `stopped` are derived by asking the game server at request time. (FR-012)
6. **The agent MUST bind to loopback only.** (FR-013)

## Shared types

Lives in `contract/src/index.ts`, imported by both sides. One file.

```typescript
export type ServerState = 'starting' | 'running' | 'stopped' | 'error';

export interface AgentResponse {
  state: ServerState;
  message?: string;
}
```

## Deliberately absent

Recorded so their absence reads as a decision: no `status` or `players` verb
(deferred until auto-stop), no authentication (see above), no request ids, no
retry or idempotency semantics, no versioning in the path, no push channel — the
agent never initiates.
