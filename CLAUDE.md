# CLAUDE.md

Operational context for this repository. **Architecture is not here** — that lives
in [`initial-architecture/`](initial-architecture/), and
[`DECISIONS.md`](initial-architecture/DECISIONS.md) is the authority for what was
chosen and why. The rules those decisions must not violate are in
[`.specify/memory/constitution.md`](.specify/memory/constitution.md).

## What this is

An on-demand control plane for self-hosted game servers. Discord slash commands
`/start`, `/stop`, `/status`, and `/address` control **two** dedicated servers —
Palworld and Satisfactory — each named as a subcommand. A human decides when; that
is the whole policy. A second game was a new *row*, not a new kind: one more agent
at one more address in configuration (DECISIONS 002).

## Layout

```
contract/       the seam — request/response types, zero dependencies
agent/          1 per controlled server · WINDOWS · loopback only
orchestrator/   exactly 1 · owns the Discord gateway
site/           the landing page (static, no build step)
specs/          Spec Kit features
```

## Commands

```bash
npm install          # workspaces: contract, agent, orchestrator
npm run check:all    # typecheck + lint + test — the gate
npm run typecheck    # tsc, every workspace
npm test             # node:test

npm run start:palworld     -w @reveille/agent   # needs agent/.env.palworld
npm run start:satisfactory -w @reveille/agent   # needs agent/.env.satisfactory
npm start                  -w @reveille/orchestrator   # needs orchestrator/.env
```

On `watson`, start/stop the whole control plane (orchestrator + both agents) at once:

```powershell
./scripts/reveille.ps1 start | stop | restart | status
```

It manages only those three node processes — never the game servers, which are
started and stopped from Discord.

**There is no build step.** Node 24 runs TypeScript directly by stripping types, so
`tsc` is a type checker that never emits. `erasableSyntaxOnly` is on, which means a
passing typecheck also guarantees the code *runs* — it rejects enums, namespaces,
and parameter properties, none of which stripping can handle.

## Rules that are not style preferences

**The agent binds `127.0.0.1` and the address is a constant, not configuration.**
Making it a setting would let a stray edit publish remote process control from a
home machine. Widening it is a code change that must arrive *together with*
authentication — the whole no-auth trade is only valid while the caller is on the
same box (FR-013, spec Assumptions).

**The orchestrator and agent talk over HTTP, always**, even sharing a machine.
Never import across those packages; eslint blocks it. The seam is the one
genuinely irreversible decision here (Constitution I). It has **three** verbs:
`POST /start`, `POST /stop`, and `GET /status` (added in 002, additive). No server
id ever enters a path or body — an agent's URL *is* its identity.

**Only an adapter file may know its game.** `agent/src/palworld.ts` and
`agent/src/satisfactory.ts` each implement `GameAdapter` (`agent/src/adapter.ts`);
`createAdapter` selects one by the `GAME` config. **Nothing else branches on which
game it is** (FR-025) — the HTTP layer, config loader, serializer, and orchestrator
are all adapter-agnostic. A third game is a third adapter plus one `AGENTS` entry.

**Never force-stop.** OS-level process termination and any game-specific *force*
stop (Palworld's `POST /v1/api/stop`) must not appear in a path reachable from
`/stop`. A stop that cannot be graceful is not a stop — it fails and leaves the
server running (Constitution IV). Each adapter's source is tested for this and for
save-before-shutdown: `palworld.test.ts` **and** `satisfactory.test.ts`.

**`/status` is read-only and must not sit on the command mutex.** The agent
serializes `/start` and `/stop` (check-then-act, FR-008), but `/status` is a pure
read that US3 polls — serializing it would stall a poll behind an in-flight stop and
contend with real commands. It runs concurrently.

**The agent keeps zero runtime dependencies.** `node:http`, `node:https` (for
Satisfactory's self-signed loopback TLS, which `fetch` cannot be told to accept),
native `fetch`, and `--env-file` instead of dotenv. Adding one needs a
`DECISIONS.md` entry.

**No fallback config.** Every environment variable is required and throws at boot
naming itself. A missing/unknown `GAME` would control the wrong server; an empty
`AGENTS` map leaves the orchestrator with nothing to command; a blank admin password
is an open admin interface; a missing stop bound silently removes a data-loss
guarantee.

## Configuration

The env files are gitignored — **the repository is public**. Copy from the
`.env.example` beside each; every value is documented there. One agent runs **per
game**, each with its own env file, named symmetrically so neither game is the
"default": **`agent/.env.palworld`** and **`agent/.env.satisfactory`** (each sets a
different `GAME` and `AGENT_PORT`, launched by `npm run start:<game>`). The
orchestrator has one **`orchestrator/.env`**.

- **Agent:** `GAME` (`palworld` | `satisfactory`) selects the adapter and therefore
  which game-specific values are required. Only that game's block is consulted.
- **Orchestrator:** `AGENTS` is a JSON array of `{name, url, publicPort}` — one entry
  per server, replacing 001's single `AGENT_BASE_URL`. Plus `FOLLOWUP_TIMEOUT_MS`
  (the US3 bound).

Passwords, easily confused:

- **`PALWORLD_ADMIN_PASSWORD`** / **`SATISFACTORY_ADMIN_PASSWORD`** — the control API
  each agent uses over loopback. Never leaves the machine.
- **`ServerPassword`** in `PalWorldSettings.ini` — what players type to join Palworld.
  Set because Palworld has no unlisted option (DECISIONS 012). Satisfactory has no
  join password set (its API is loopback-only regardless).

## Local setup on `watson`

Palworld lives at `C:\steamcmd\steamapps\common\PalServer`. Its live config is
generated on first run at `Pal\Saved\Config\WindowsServer\PalWorldSettings.ini` —
editing `DefaultPalWorldSettings.ini` at the root does nothing, as that file itself
warns.

Palworld ports: **`8211/UDP`** is the game and the only forwarded one. **`8212/TCP`**
is the Palworld admin REST API, which binds `0.0.0.0` with no bind-address setting
and is blocked from the network by a firewall rule named
`Reveille - block Palworld REST API (8212) from network`. **`8300/TCP`** is the
agent, loopback-bound and therefore unreachable by construction.

Satisfactory lives at `C:\steamcmd\steamapps\common\SatisfactoryDedicatedServer`
(`FactoryServer.exe` is the launcher, `FactoryServer-Win64-Shipping.exe` the child —
**not** `FactoryGameSteam…`, which is the game client). It was **claimed over its
own HTTPS API**, no game client needed (`PasswordlessLogin` → `ClaimServer`), and its
`autoLoadSessionName` is set to `Reveille-M0` so a bare launch brings the world up on
its own — mirroring Palworld's spawn-and-it-comes-up. The trap: **`7777`** is the
game over **UDP** (forward it) and the admin HTTPS API over **TCP** (loopback/LAN
only, never forward — T022 adds a firewall rule blocking `7777/TCP` from the LAN,
mirroring the Palworld 8212 rule). The agent is on **`8301/TCP`**, loopback-bound.
Everything measured during M0 is in
[`specs/002-second-game-server/m0-satisfactory.md`](specs/002-second-game-server/m0-satisfactory.md).

None of these start at boot — the orchestrator and both agents are launched by hand.
That is deferred deliberately, with a trigger, in
[`03-deferred.md`](initial-architecture/03-deferred.md).

## Testing

`node:test`, no framework. Tests sit beside their source as `*.test.ts`.

Anything touching a game server is verified against a **real** install rather than
mocks — that is the whole reason M0 exists as a prerequisite, once per game.
Behaviour each adapter depends on (process names, API timing) was observed, not
assumed. Palworld: the REST API answers ~3s after launch on an empty world, and it
autosaves every 30 seconds while a player is connected (why the save-durability test
in `quickstart.md` §4 only means anything if you beat that clock). Satisfactory: the
HTTPS API answers ~10s after launch but reports `isGameRunning:false` until the world
loads, so `running` keys on `isGameRunning`, not mere reachability — the full M0
record is in `specs/002-second-game-server/m0-satisfactory.md`.

## Releases

Every push to `main` or `dev` is tagged by
`jeff-fichtner/snackbyte-release-flow-action@v1`, driven by `environments.json`.
Root `package.json` supplies MAJOR.MINOR; the action derives the patch. **Do not
remove `environments.json`** — a missing manifest fails silently as "not a release
branch" and nothing is ever tagged (DECISIONS 011).
