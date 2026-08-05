# CLAUDE.md

Operational context for this repository. **Architecture is not here** — that lives
in [`initial-architecture/`](initial-architecture/), and
[`DECISIONS.md`](initial-architecture/DECISIONS.md) is the authority for what was
chosen and why. The rules those decisions must not violate are in
[`.specify/memory/constitution.md`](.specify/memory/constitution.md).

## What this is

An on-demand control plane for **controllable targets on a host** — game servers
first, and since 003 anything else a host can toggle. Discord slash commands
`/start`, `/stop`, `/status`, `/address` control **two** dedicated game servers —
Palworld and Satisfactory, each named as a subcommand — and `/pause`, `/play`,
`/next`, `/previous`, `/forward [seconds]`, `/back [seconds]` control **one** media
player, VLC (bare commands: there is one media target). A human decides when; that is
the whole policy. A second game was a new *row*, not a new kind (DECISIONS 002). VLC
was a new *kind* — a second adapter kind (`media`) alongside `game`, with its own
verbs — but still one agent at one more address (DECISIONS 017). 005 added four more
media commands without adding a kind, a component, or a dependency.

**Six media commands, five seam verbs.** `/forward` and `/back` are one operation over
a signed magnitude and share `POST /seek`; the orchestrator negates for `/back`. That
is why `/back -30` seeks *forward* — the amount is passed through exactly as given, and
the reply says so rather than hiding it (FR-005).

## Layout

```
contract/       the seam — request/response types, zero dependencies
agent/          1 per controlled target (game or media) · WINDOWS · loopback only
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
npm run start:vlc          -w @reveille/agent   # needs agent/.env.vlc (media)
npm start                  -w @reveille/orchestrator   # needs orchestrator/.env
```

On `watson`, start/stop the whole control plane (orchestrator + every agent) at once:

```powershell
./scripts/reveille.ps1 start | stop | restart | status
```

It manages only those node processes — never the game servers or VLC themselves,
which are controlled from Discord.

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
genuinely irreversible decision here (Constitution I). It has **eight** verbs:
`POST /start`, `POST /stop`, `GET /status` (games; `/status` added 002), and
`POST /pause`, `POST /play` (media; added 003), `POST /next`, `POST /previous`,
`POST /seek?seconds=<signed int>` (media; added 005 — seam v4, additive, every
earlier field and verb unchanged). No target id ever enters a path, query, or body —
an agent's URL *is* its identity. An agent answers only its kind's verbs (a `/start`
to a media agent is a 404), and the orchestrator never sends the wrong ones.

**`seconds` is the seam's only parameter, and the rule that admits it is narrow.**
Every verb before 005 was a bare POST; nothing had ever crossed in a request. The
rule: **a parameter of the *operation* may cross; a name for *which target* may not**
(DECISIONS 023). `seconds` says how far, never which player. This does **not** license
a `target`/`name`/`id`/`kind` parameter — that stays an architecture change. The
30-second default lives **only** in the orchestrator; the agent has none and answers
`400` on a missing or non-integer value, because a member omitting an argument is a
documented choice while the orchestrator omitting it would be a bug.

**Only an adapter file may know its target.** `agent/src/palworld.ts` and
`agent/src/satisfactory.ts` implement `GameAdapter`; `agent/src/vlc.ts` implements
`MediaAdapter` (both in `agent/src/adapter.ts`, each tagged `kind: 'game' | 'media'`).
`createAdapter` selects one by the `TARGET` config; the server dispatches an
adapter's verbs by its `kind`. **Nothing else branches on which target it is**
(FR-025) — the HTTP layer, config loader, serializer, and orchestrator are all
adapter-agnostic. A new target of an existing kind is a new adapter plus one
`AGENTS` entry; a new *kind* is a new adapter interface plus a `case`.

**Never force-stop (games).** OS-level process termination and any game-specific
*force* stop (Palworld's `POST /v1/api/stop`) must not appear in a path reachable
from `/stop`. A stop that cannot be graceful is not a stop — it fails and leaves the
server running (Constitution IV). Each adapter's source is tested for this and for
save-before-shutdown: `palworld.test.ts` **and** `satisfactory.test.ts`. Media has
no `/stop`; `vlc.test.ts` bans OS kill **and** every content command.

**The media ban is "no *knowledge* of content", not "no *movement* through it" (005,
DECISIONS 022).** 003's rule was "Reveille toggles playback, never chooses what
plays"; 005 narrowed it. **Permitted**: blind relative movement — `pl_next`,
`pl_previous`, and a *relative* `seek`, none of which needs to know what is loaded.
**Still forbidden**: anything that does — `pl_jump` (a *nominated* item, the sharpest
contrast with `pl_next`), `pl_play`, `in_play`, `in_enqueue`, `pl_empty`,
`pl_delete`, plus volume, `pl_stop`, and OS kill. **Newly forbidden**: an *absolute*
seek. M0 measured a bare `val=30` seeking *to* 0:30 instead of forward 30s — silent
and plausible-looking — so the adapter always sends an explicit sign (`%2B` or `-`)
and `vlc.test.ts` bans the unsigned form (FR-011). The check ends up stricter than
003's, not looser.

**`/status` is read-only and must not sit on the command mutex.** The agent
serializes the acting verbs (`/start`·`/stop`, or `/pause`·`/play` for media —
check-then-act, FR-008), but `/status` is a pure read that US3 polls — serializing
it would stall a poll behind an in-flight command. It runs concurrently, and folds
every target (games and media) into one reply, each in its own vocabulary.

**The agent keeps zero runtime dependencies.** `node:http`, `node:https` (for
Satisfactory's self-signed loopback TLS, which `fetch` cannot be told to accept),
native `fetch` (VLC's web interface is plain HTTP on loopback, so it needs no TLS
module), and `--env-file` instead of dotenv. Adding one needs a `DECISIONS.md` entry.

**Each Discord guild is a tenant, scoped to its own targets (004).** The orchestrator
holds a `guildId → Tenant` map (`TENANTS`); a command registers per guild from only that
tenant's targets, and routes only within the tenant its guild selects — one guild can
never see or reach another's target. **Isolation is structural**: a handler is only ever
handed its resolved tenant's maps, never a global one, so there is nothing to forget to
filter. One orchestrator serves every tenant (Constitution II); **no tenant/target id
enters the seam** (Constitution I) — the agent is untouched, which is what keeps off-box
an additive future spec. Never route a command against anything but its own tenant's maps.

**No fallback config.** Every environment variable is required and throws at boot
naming itself. A missing/unknown `TARGET` would control the wrong target; an empty or
malformed `TENANTS` (a duplicate guild, a tenant with no targets, the legacy `AGENTS`/
`DISCORD_GUILD_ID` shape) leaves the orchestrator mis-scoped or with nothing to command;
a missing/unknown `kind` would register the wrong verbs; a blank admin/VLC password is an
open control interface; a missing stop bound silently removes a data-loss guarantee.

## Configuration

The env files are gitignored — **the repository is public**. Copy from the
`.env.example` beside each; every value is documented there. One agent runs **per
target**, each with its own env file, named symmetrically so none is the "default":
**`agent/.env.palworld`**, **`agent/.env.satisfactory`**, **`agent/.env.vlc`** (each
sets a different `TARGET` and `AGENT_PORT`, launched by `npm run start:<target>`).
The orchestrator has one **`orchestrator/.env`**.

- **Agent:** `TARGET` (`palworld` | `satisfactory` | `vlc`) selects the adapter and
  therefore which target-specific values are required. Only that target's block is
  consulted — games read a game block + `STOP_TIMEOUT_MS`; `vlc` reads `VLC_BASE_URL`
  + `VLC_PASSWORD` and no stop bound.
- **Orchestrator:** `TENANTS` is a JSON array of `{guildId, name?, agents:[…]}` — **one
  entry per Discord guild**, each `agents` list the per-target shape (`{name, url, kind,
  publicPort?}`). Since 004 the orchestrator is **multi-tenant**: a guild sees and controls
  **only its own** `agents`, never another guild's (isolation, keyed by `guildId`). One
  bot serves every tenant. `TENANTS` replaces 001's flat `AGENTS` **and** the 003 stopgap's
  `DISCORD_GUILD_ID` comma-list — both are rejected loudly at boot (migration is deliberate,
  DECISIONS 021). A target may be **shared** across guilds or **exclusive** to one. Plus
  `FOLLOWUP_TIMEOUT_MS` (the US3 bound).

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

VLC is the media target (003). It runs at `C:\Program Files\VideoLAN\VLC\vlc.exe`,
and the **operator opens the show and presses play as usual** — Discord only toggles
playback of whatever is loaded. One-time setup: enable VLC's Web interface and set a
password in Preferences. The web interface binds **`127.0.0.1:8080`** (plain HTTP,
Basic auth = empty user + the password), and the media agent is on **`8302/TCP`**,
loopback-bound. **Media adds NO network exposure** — the video is local and the
control path is loopback end to end, so there is nothing to forward and **no firewall
rule** (unlike the games' `0.0.0.0` admin APIs). M0 is in
[`specs/003-media-control/m0-vlc.md`](specs/003-media-control/m0-vlc.md).

None of these start at boot — the orchestrator and every agent are launched by hand.
That is deferred deliberately, with a trigger, in
[`03-deferred.md`](initial-architecture/03-deferred.md).

## Testing

`node:test`, no framework. Tests sit beside their source as `*.test.ts`.

Anything touching a controlled target is verified against a **real** install rather
than mocks — that is the whole reason M0 exists as a prerequisite, once per target.
Behaviour each adapter depends on (process names, API timing, command names) was
observed, not assumed. Palworld: the REST API answers ~3s after launch on an empty
world, and it autosaves every 30 seconds while a player is connected (why the
save-durability test in `quickstart.md` §4 only means anything if you beat that
clock). Satisfactory: the HTTPS API answers ~10s after launch but reports
`isGameRunning:false` until the world loads, so `running` keys on `isGameRunning`,
not mere reachability — record in `specs/002-second-game-server/m0-satisfactory.md`.
VLC: `status.json`'s `state` is exactly `playing`/`paused`/`stopped`; pause/resume
are the **force** commands (`pl_forcepause`/`pl_forceresume`, idempotent — the toggle
would flip wrong on a stale read); nothing loaded reads `stopped` — record in
`specs/003-media-control/m0-vlc.md`.

## Releases

Every push to `main` or `dev` is tagged by
`jeff-fichtner/snackbyte-release-flow-action@v1`, driven by `environments.json`.
Root `package.json` supplies MAJOR.MINOR; the action derives the patch. **Do not
remove `environments.json`** — a missing manifest fails silently as "not a release
branch" and nothing is ever tagged (DECISIONS 011).
