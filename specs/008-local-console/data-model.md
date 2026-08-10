# Data Model: One console for the operator

**Feature**: 008-local-console · **Date**: 2026-08-10

**Every entity here is transient, and that is the design rather than a consequence of it.**
FR-016 forbids state between invocations; the console is one-shot. Each entity below is built
from what is on disk or on the wire at the moment it is needed, used, and dropped when the
process exits. If a future change gives any of them a file, a cache, or a "last seen", the
console has become a second orchestrator and Constitution II applies.

The one thing written to disk — a log file — is deliberately **not** state the console reads
back to make decisions. It is output for a human.

---

## Console invocation

One run of the command by a human. The root entity; everything else hangs off it.

| Field | Type | Notes |
|---|---|---|
| `verb` | parsed command | A target verb, or a `plane` verb. Never ambiguous — FR-003. |
| `targetName` | string, optional | Present only for verbs that name one. Resolved against the target map. |
| `args` | signed integers | `seconds` / `count`, passed through exactly as given (005/007 rules inherited). |
| `serviceName` | string, optional | Present only for `plane` verbs naming one service — FR-007. |
| `exitCode` | 0 · 2 · 3 · 64 | The single outcome value. `1` is never used, so a crash is distinguishable. |

**Lifecycle.** Constructed from `argv`, lives for one process, leaves nothing. It has no id
because nothing ever refers to a previous one.

**Rules.**
- A target verb missing a required name resolves to a usage error, never a guess (FR-003).
- A verb of the wrong kind for its target is refused before anything is contacted.
- The invocation ends when its work ends; it may not schedule, detach, or persist (FR-020).

## Target map

Which targets can be commanded, and where. Built fresh per invocation.

| Field | Type | Notes |
|---|---|---|
| `name` | string | The routing key and what the operator types. Same name Discord shows. |
| `baseUrl` | string | The agent's address — **its identity** (Constitution I). |
| `kind` | `game` \| `media` | Selects which verbs apply. |
| `publicPort` | number, games only | For `address`. Absent for media, which forwards nothing. |

**Source.** `TENANTS` from `orchestrator/.env`, parsed by the orchestrator's own
`parseTenants` (FR-011). Read directly from the file; the orchestrator process is never
contacted, which is what lets every target command work while it is stopped (FR-009).

**Derivation — the union.** The console has no guild, so it unions every tenant's targets
(FR-012). This is not an isolation break: 004's boundary is guild↔guild, and the host
operator with loopback access to every agent sits outside it.

**Validation.**
- Same `name`, **same** `baseUrl` across tenants → unions to one entry. The documented
  shared-target case.
- Same `name`, **different** `baseUrl` across tenants → **refuse the whole invocation**,
  naming both tenants (FR-013). Choosing either would command the wrong machine.
- Malformed or missing `TENANTS` → throw naming the variable (FR-014). No fallback map.

**Never** built from `agent/.env.*` (FR-015) — those files carry neither `kind` nor
`publicPort`, so a map built from them would have to re-derive which verbs apply to which
target, which is the lookup table this codebase forbids.

## Plane service

One long-lived Reveille process on this host. **A different question from a target** — see
`research.md` §4.

| Field | Type | Notes |
|---|---|---|
| `label` | string | `palworld-agent`, `orchestrator`, … Display and log filename. |
| `envFile` | path | `agent/.env.<target>` or `orchestrator/.env`. Half of the identity match. |
| `entryScript` | path | `agent/src/index.ts` or `orchestrator/src/index.ts`. The other half. |
| `port` | number, agents only | From that agent's own `AGENT_PORT` — the single source. |
| `logPath` | path | `logs/<label>.log`. |

**Source.** Discovered from the filesystem: each `agent/.env.*` is one agent service,
`orchestrator/.env` is the orchestrator. No hardcoded table, so a fourth target is managed
the moment its env file exists.

**States** — derived per read, never stored:

| State | Meaning |
|---|---|
| `up` | Serving. An agent answers `GET /status` 200; the orchestrator has written its connected line. |
| `down` | No matching process. |
| `failed` | Launched, then did not become ready within the bound. Reported with its log named (FR-034). |

**Identity rule (FR-032).** A process is Reveille's only if its command line runs **this**
entry script with **this** env file. Never a recorded process id alone — a reboot or a reused
id would otherwise point the kill at a stranger.

**Guarantee (FR-033).** A plane service is never a controlled target. Stopping one changes no
game server and no media player.

## Log generation

A service's output for one run.

| Field | Type | Notes |
|---|---|---|
| `current` | path | `logs/<label>.log` — the run happening now. |
| `previous` | path, optional | `logs/<label>.log.1` — the run before it. Absent on first ever run. |

**Lifecycle.** On `plane up`, an existing `current` is renamed to `previous`, replacing any
older one, and a fresh `current` begins. **At most two exist** (FR-028).

**Why exactly one generation.** Truncating instead would destroy the crash log in the very
situation the operator is restarting *because of* a crash; keeping many would accumulate
without bound. One is the smallest number that survives the case that matters.

**Not state.** The console never reads a log to decide anything — with one bounded exception
that is a live read, not a memory: `plane up` watches the orchestrator's current log for its
connected line to determine readiness (`research.md` §6). It draws no conclusion from a
previous run.

## Reply

What a command produces. **Reused unchanged from the orchestrator** — no new type.

| Field | Source | Console rendering |
|---|---|---|
| `tone` | `describeX` | Chooses emphasis only; the text carries the meaning. |
| `text` | `describeX` | Printed as-is — the same sentence a member would read. |
| `footnote` | `describeX` | Printed when present. |
| `diagnostic` | `describeX` | **Printed** — status code, errno, target error text. |

`diagnostic` is the entity that makes this feature cheap. 007 added it as operator-only detail
and never rendered it, because `toEmbed` reads only `text` and `footnote` and Discord is the
wrong audience. The console is the right one, so FR-021 is satisfied by *displaying a field
that already exists* rather than by adding one.
