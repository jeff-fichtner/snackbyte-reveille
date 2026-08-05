# Contracts: tenant isolation (004)

Two contracts matter for this feature, and the important one is that the **first does not
change**.

## 1. The orchestrator↔agent seam — UNCHANGED (SC-005)

This feature adds **nothing** to the seam. The request/response types in `contract/` stay
exactly as 003 left them (seam v3):

- Verbs: `POST /start`, `POST /stop`, `GET /status` (games); `POST /pause`, `POST /play` (media).
- Body: `AgentResponse { state: ServerState | MediaState; message? }`.
- **No tenant identifier and no target identifier appears in any path or body.** An agent's
  address is its identity (Constitution I). An agent still answers only its own verbs at its own
  address and never learns it belongs to a tenant (FR-008).

**Conformance (SC-005):** a 001–003 seam check still passes unchanged. This is the measurable form
of "the seam stays clean", and it is what makes a future off-box target additive — that target is a
different `baseUrl` (plus the authentication of a separate, deferred spec) inside a tenant's list,
with no change here.

## 2. The orchestrator configuration — the shape that changes: `TENANTS`

The one new/changed contract is the orchestrator's own configuration input. It replaces 001's
flat `AGENTS` and 003's stopgap `DISCORD_GUILD_ID` comma-list.

### Shape

`TENANTS` — a JSON array, one entry per tenant (guild):

```jsonc
[
  {
    "guildId": "1412143249229090930",     // Discord guild id — routing key + isolation boundary
    "name": "playboy lounge",             // optional label (logs/errors); not used for routing
    "agents": [                            // this tenant's targets — the 003 per-target shape
      { "name": "palworld",     "url": "http://127.0.0.1:8300", "kind": "game",  "publicPort": 8211 },
      { "name": "satisfactory", "url": "http://127.0.0.1:8301", "kind": "game",  "publicPort": 7777 },
      { "name": "vlc",          "url": "http://127.0.0.1:8302", "kind": "media" }
    ]
  },
  {
    "guildId": "1527396812154212523",
    "name": "snackbyte dev",
    "agents": [
      { "name": "vlc", "url": "http://127.0.0.1:8302", "kind": "media" }   // shared target: same url as above
    ]
  }
]
```

### Rules (all fail loud at startup — FR-010; the orchestrator names the problem and refuses)

| # | Rule |
|---|------|
| C1 | `TENANTS` present, non-blank, parses as a **non-empty** JSON array. |
| C2 | Each tenant has a non-blank `guildId`, **unique** across tenants. |
| C3 | Each tenant's `agents` is a **non-empty** array. |
| C4 | Each agent entry obeys the **existing 003 target rules**: `name` matches `[a-z0-9_-]{1,32}`; `kind` ∈ {`game`,`media`}; a `game` requires a positive-integer `publicPort`; a `media` MUST NOT have `publicPort`; `url` non-blank (trailing slash normalised). |
| C5 | `name` is **unique within a tenant**; it MAY repeat across tenants (per-tenant naming). |
| C6 | A `url` (target address) MAY appear under more than one tenant (shared) or exactly one (exclusive) — both valid (FR-014). |
| C7 | **Migration:** a legacy `AGENTS` value, or a `DISCORD_GUILD_ID` used for target routing, present → refuse to start with a message pointing at `TENANTS` (FR-011). Never silently reinterpreted. |

### Behaviour derived from this contract

- Commands register **per guild**, built from **only that tenant's** `agents` (FR-003) — a guild's
  picker shows only its own targets.
- An interaction from a guild **not** in `TENANTS` is ignored (FR-006).
- An interaction from a configured guild routes **only within that tenant's** targets (FR-002); one
  guild can never reach another's target.
- `/status` folds **only** the issuing guild's targets (FR-012).

The other orchestrator variables — `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`,
`FOLLOWUP_TIMEOUT_MS` — are unchanged and still required/fail-loud.
