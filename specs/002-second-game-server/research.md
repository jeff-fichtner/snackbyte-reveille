# Research: A second controlled game server

Phase 0. Every decision here is game-agnostic except R6/R7 (Satisfactory), and even
those reduce the game-specific surface to one adapter file. Where a fact about
Satisfactory's runtime is load-bearing, it is marked **M0-verified** — grounded by
observation against the real install, never trusted from docs (the discipline that
caught Palworld's deprecated-RCON docs, DECISIONS 009).

---

## R1 — The GameAdapter interface

**Decision.** Extract the shape `palworld.ts` already implements into an explicit
interface `agent/src/adapter.ts`:

```
GameAdapter {
  getState(): Promise<'running' | 'starting' | 'stopped'>   // never 'error' — that is an outcome
  start(): void                                             // spawn; do not wait, do not verify
  stop(): Promise<void>                                     // save → verify → shutdown; throw on failure
}
```

**Rationale.** A second adapter now exists, so the interface is real rather than
speculative — Principle III is satisfied *because* Satisfactory forces it, not in
anticipation of it. `agent/src/index.ts` already talks to `palworld.ts` through
exactly these three calls; formalizing them changes no behaviour, only makes the
contract a type the compiler checks both adapters against.

**Alternatives considered.**
- *Leave it implicit, duplicate the pattern.* Rejected: two adapters with no shared
  type drift silently; the constitution's "only the adapter knows its game" rule is
  easier to violate without a boundary.
- *A base class.* Rejected: `erasableSyntaxOnly` forbids parameter properties and the
  runtime strips types; an interface plus two plain modules is the erasable choice.

**Consequence.** `getState` returning only three states (not `error`) is the
contract both adapters honour; the HTTP layer maps failures to `error`, not the
adapter. This is already how `palworld.ts` behaves (DECISIONS 010).

---

## R2 — Adapter selection by configuration

**Decision.** One agent binary, one adapter active per deployment, chosen by a
required `GAME` config value (`palworld` | `satisfactory`). `agent/src/index.ts`
loads the named adapter at boot; nothing else branches on the game.

**Rationale.** DECISIONS 001: a second game is a second *deployment* of the agent,
not new structure. Config-selection is what makes "one binary, deployed twice" real
without the orchestrator or the seam learning which game is where.

**Alternatives considered.**
- *A separate binary per game.* Rejected: duplicates the HTTP server, config loader,
  and serialization for no gain; the game-specific surface is one file, not a program.
- *Auto-detect the game.* Rejected — a silent guess, and the constitution forbids
  fallback config. `GAME` is required and fails loud at boot naming itself.

---

## R3 — The orchestrator holds many agents by name

**Decision.** `orchestrator/src/config.ts` grows from one `AGENT_BASE_URL` to a map
of **name → base URL** (`AGENTS`). Each Discord command is a subcommand naming the
server (`/start palworld`, `/start satisfactory`); the handler routes to that name's
agent. `/status` names none and queries all.

**Rationale.** The server's name is a human label that lives **only** in orchestrator
config and the Discord surface — never in the contract (Constitution I, FR-018–FR-021).
A subcommand rather than an option because "server" is what Discord calls a guild
(the `/start palworld` prototype already on `main` established this), and Discord
requires a subcommand to be chosen — enforcing "no default target" (FR-019) at the
protocol, not in code. An unknown name is impossible to submit through the picker and
is rejected server-side for raw API calls (FR-020).

**Alternatives considered.**
- *A required string option.* Rejected: `server:` collides with Discord's word for a
  guild, and a free-text option lets an unknown name reach the handler.
- *Separate commands per server* (`/start-palworld`). Rejected: the list bloats
  linearly and loses the picker; the temporary single-subcommand form on `main` is
  replaced here by the config-driven list, which is why it was built ahead of trigger.

**Consequence.** Adding a third server is one row in `AGENTS` and one subcommand
choice, both derived from config at registration time — no contract change (FR-024,
SC-008). The commands are registered from the config map, replacing the hardcoded
`palworld` subcommand currently on `main`.

---

## R4 — The status verb

**Decision.** Add a third verb to the seam: `GET /status` on the agent, returning the
current `ServerState` (`running` | `starting` | `stopped`), derived per request. The
orchestrator's `/status` command queries every configured agent and reports each
independently, including unreachable (FR-023, FR-026).

**Rationale.** DECISIONS 001 anticipated four verbs (start, stop, status, players);
status is the read-only one. It is additive to the contract and carries no server id —
the agent answers about *its* server. Both US2 (a player asks) and US3 (the
orchestrator polls after a launch) consume it, so it is written once.

**Alternatives considered.**
- *Reuse `/start`'s 409 to infer state.* Rejected: `/status` must change nothing
  (FR-022, SC-005); a start attempt is not read-only.
- *Track connected players in status.* Forbidden by FR-011 — status reports server
  state only, never who or how many are connected. The `players` verb DECISIONS 001
  named stays out of scope.

---

## R5 — The post-launch follow-up (US3)

**Decision.** After a `/start` returns 202, the orchestrator polls the agent's
`/status` until it reads `running` or a bound elapses, then posts a **new message**
in the same channel: "it's up" or "could not confirm within N". A refused start
(nothing launched) produces no follow-up. A pending wait is held only in memory and
is abandoned on restart (FR-032).

**Rationale.** This is the first behaviour that watches rather than answers, and it
amends FR-004: the system may now claim a server is up — but *only* after observing
it via status, never at launch. A new message rather than an edit because an edit
does not notify, and the point is to reach a player who walked away (FR-028). A
timeout reports "could not confirm", never "failed" — the server may simply be slow
(FR-029). Polling because no game server notifies anything; the same reason state is
always derived by asking.

**Alternatives considered.**
- *Edit the original reply in place.* Rejected: silent, defeats the purpose (FR-028).
- *Persist the pending wait so it survives a restart.* Rejected: violates FR-012, and
  a claim reconstructed from stale state is worse than no claim (FR-032).
- *A fixed sleep then one check.* Rejected: world size moves the ready time (Palworld
  answered in ~3s empty; a large save is slower) — polling to a bound adapts; a fixed
  guess is wrong at both ends.

**Consequence.** The `progress` (amber) reply tone, left unreachable in code on
`main`, comes back here: `/start`'s immediate reply reads *in progress* (FR-027), and
the follow-up resolves it to up/failed-to-confirm.

---

## R6 — Satisfactory speaks its HTTPS API, over node:https

**Decision (M0-verified).** `satisfactory.ts` drives the official Dedicated Server
HTTPS API: a single endpoint `https://127.0.0.1:7777/api/v1`, POST
`{"function": "<Name>", "data": {...}}`, `Content-Type: application/json`. The shape
mirrors `palworld.ts`:

- **auth**: `PasswordLogin` with the admin password returns a **Bearer token**; the
  token authorizes subsequent calls (unlike Palworld's per-request Basic auth).
- **getState**: `QueryServerState` answering ⇒ `running`; process exists but the API
  is not answering ⇒ `starting`; neither ⇒ `stopped` — the same two-signal derivation
  as Palworld (DECISIONS 010), process-existence for the `starting`/`stopped` split.
- **stop**: `SaveGame` → verify the response → `Shutdown`. No force path exists to
  call, and none may be added (Constitution IV) — the same source-level ban test that
  guards `palworld.ts` extends to this file.

**TLS.** The API is **always** TLS-wrapped and **self-signed by default**. The
adapter uses **`node:https`** (built-in, keeps the agent's zero-dependency rule) with
`rejectUnauthorized: false` scoped to the loopback call — native `fetch` cannot skip
verification without adding an `undici` dispatcher dependency, so this one adapter
uses `node:https` where `palworld.ts` uses `fetch`.

**Rationale.** Structurally identical to the Palworld adapter — ask an API for state,
save, verify, shut down — which is the whole proof that the game-agnostic axis is
real. The mechanical differences (token vs Basic auth, one function-dispatch endpoint
vs REST paths, TLS vs plain HTTP) are confined to `satisfactory.ts`.

**M0 — what must be observed before implementing this file**, not trusted from docs:
the exact `PasswordLogin`/`QueryServerState`/`SaveGame`/`Shutdown` request/response
shapes and token lifetime; how long after launch the API begins answering (Palworld's
~3s is not a given here); the child process name(s) for the `starting`/`stopped`
split; and whether a save can be confirmed distinctly from a shutdown. The server
must be **claimed** from the game client first (admin password set, a session
created) — a manual step only the operator can do.

Sources: [Satisfactory Wiki — HTTPS API](https://satisfactory.wiki.gg/wiki/Dedicated_servers/HTTPS_API),
[DJWoodZ — HTTPS API client](https://github.com/DJWoodZ/satisfactory-dedicated-server-https-api-client).

---

## R7 — Satisfactory's exposure: one port number, two protocols

**Decision (M0-verified).** Forward **`7777/UDP` only** — the game. The HTTPS API is
**`7777/TCP`** on the same port number, and like Palworld's 8212 it must never be
reachable off-box (FR-014, FR-015). The agent reaches it over loopback; a firewall
rule blocks `7777/TCP` from the network, mirroring the
`Reveille - block Palworld REST API` rule.

**Rationale.** A game and its admin API sharing a port *number* on different protocols
is a trap: forwarding "7777" without specifying UDP would publish the admin API.
FR-015's "exactly one inbound path per server — the game port" holds only if the
forward is UDP-scoped.

**M0 verification:** confirm the API is TCP 7777 and the game is UDP 7777 on this
build, and that the API binds a loopback-reachable address the agent can hit while a
firewall rule keeps `7777/TCP` off the LAN.

---

## What does NOT change (the point of the feature)

The contract's existing types (`ServerState`, `AgentResponse`) are untouched; only a
status verb is added. No server or machine identifier enters the seam. The
orchestrator relocates; agents multiply. Three component kinds, still. Every 001
guarantee — save-before-exit, never force-stop, never self-stop, no auth, no
persisted state, loopback-only — carries to the second server unchanged (SC-009).
