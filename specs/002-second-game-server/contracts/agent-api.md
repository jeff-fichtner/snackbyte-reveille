# Contract: the seam (v2 — status added)

**Feature**: `002-second-game-server` · **Version**: 2 (M2) · **Date**: 2026-08-02

The line between the orchestrator and an agent. v1 (001) had two verbs; v2 adds a
third — **status** — and nothing else. The addition is the only contract change in
this feature, and it is purely additive: every v1 field and behaviour is unchanged
(SC-009).

## Shape (unchanged from v1)

- **Transport**: HTTP/1.1, JSON bodies.
- **Direction**: orchestrator → agent, always. **The agent never initiates.**
- **Identity**: the agent's base URL *is* its identity. **No server id, machine id,
  or discriminator appears anywhere in a path or body.** A second controlled server
  is a second agent at a second address in the orchestrator's config — never a
  parameter here. This is what makes "add a server" cost no contract change (FR-024).
- **Auth**: none. Valid *only* while the agent binds `127.0.0.1`.
- **State**: none retained. Every response is derived by asking the game now (FR-012).
- **Adapter-agnostic**: the same three verbs serve every game. Which game an agent
  controls is invisible here — it is the agent's `GAME` config, behind the seam.

## Shared types (`contract/src/index.ts`)

Unchanged from v1 — no new type, no new field:

```typescript
export type ServerState = 'starting' | 'running' | 'stopped' | 'error';

export interface AgentResponse {
  state: ServerState;
  message?: string;
}
```

## `POST /start` — unchanged from v1

Launch the game server. Same responses: `202 starting`, `409 running`,
`409 starting`, `500 error`. The launch is issued; it is not a claim the server is up
(FR-004). What *is* new is downstream, in the orchestrator: a 202 now begins a
post-launch follow-up (US3) — but the agent's contract is identical.

## `POST /stop` — unchanged from v1

Save the world, verify, then shut down. Same responses: `200 stopped`,
`409 stopped`, `409 starting`, `500 error` (server left running). Force-stop paths
remain forbidden in any adapter reachable from here (Constitution IV).

## `GET /status` — NEW

Report the server's current state. **Read-only** — changes nothing (FR-022, SC-005).

**Request**: no body. GET, because it is a pure query.

**Responses**

| Status | `state` | Meaning |
|---|---|---|
| `200` | `running` | the game's control API answers |
| `200` | `starting` | process exists, API not answering yet |
| `200` | `stopped` | no process, API not answering |

```json
{ "state": "running" }
{ "state": "starting" }
{ "state": "stopped" }
```

`status` never returns `error` as a *state* — `error` is an operation outcome, and a
read that fails to reach the game is a transport failure the orchestrator classifies
as **the host is unreachable** (FR-009, FR-026), distinct from any server state. The
agent does not report who is connected, ever (FR-011).

## Rules (extends v1)

1. **The three verbs are the whole seam.** No `players` verb (deferred, FR-011
   forbids its data anyway). No server selector — an agent controls exactly one
   server, named only in the orchestrator's config.
2. **`status` is idempotent and side-effect-free.** Two calls in a row change
   nothing; it may be polled (US3) without consequence.
3. **`start`/`stop` behaviour is byte-for-byte v1.** A 001 conformance check must
   still pass against any agent (SC-009).
4. **No identifier leaks in.** Adding `status` did not add a path parameter, a body
   field, or a header naming the server or its game. Verified by the same
   no-discriminator test the contract has carried since v1.
