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
player, VLC (bare commands: there is one media target). `/status` reports every target's
state and `/help` lists the commands that work in the asking guild. A human decides when;
that is the whole policy. A second game was a new *row*, not a new kind (DECISIONS 002). VLC
was a new *kind* — a second adapter kind (`media`) alongside `game`, with its own
verbs — but still one agent at one more address (DECISIONS 017). 005 added four more
media commands without adding a kind, a component, or a dependency.

**Six media commands, five seam verbs — and two pairs that are one operation each.**
`/forward` and `/back` share `POST /seek`; `/next` and `/previous` share the stepping
pair. Both take a **signed magnitude**, and in both the orchestrator reads the sign and
the agent receives only a positive number: `/back` negates the amount, and a negative
count swaps *which verb* is sent. That is why `/back -30` seeks *forward* and `/next -3`
steps *back* — the value is passed through exactly as given, and the reply states the
direction actually taken rather than the one the command name implies (005 FR-005,
007 FR-017).

**`/help` lists what the asking guild can run, and cannot go stale (006).** It is the
first command that contacts **no agent at all** — so it never defers, is answered before
`deferReply()` in `index.ts` (a deferred reply can't become ephemeral), and reads the same
whether every target is running or switched off. It describes *availability*, never
readiness; `/status` answers readiness. Crucially it is a second **view** of the command
surface, not a second **description** of it: `buildCommandGroups` is the single source and
both registration and the listing are pure derivations of it, so a command cannot be listed
that isn't registered, or described differently. **Never add a name→group lookup table or
hand-written help text** — that is the second copy the feature exists to remove, and 005
already shipped that bug once (`vlc.ts` declared "no seek" after seek was implemented in it).

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

On `watson`, the operator's interface is **one local command**, `reveille` (008). It does
two jobs, and the split between them is the feature's central decision:

```powershell
# TARGETS — bare verbs, mirroring the Discord commands one-for-one
reveille start satisfactory        # the game server
reveille stop palworld             # the game server
reveille status                    # every target's state
reveille pause | play | next [n] | previous [n] | forward [s] | back [s]
reveille address <game>
reveille help                      # and bare `reveille` — the same listing

# THE CONTROL PLANE — Reveille's own node processes, behind `plane`
reveille plane up | down | restart | status | logs [service]
```

**Bare verbs act on targets; process verbs live under `plane`.** `up`/`down` rather than
`plane start`/`plane stop`, so the collision is gone at the level of the *word* rather than
resolved by counting arguments. A bare `reveille start` or `reveille stop` **fails and names
both objects** — it never guesses. `status` is the sharper trap and gets the same care: the
plane report says whose processes it is describing, because the interesting case is the one
where the two answers differ (agent up, game stopped).

`plane` manages only those node processes — **never** the game servers or VLC themselves,
which are controlled from Discord or by the target verbs above. Services are **discovered**
from `agent/.env.*` plus `orchestrator/.env`, so a fourth target is managed the moment its
env file exists; each agent's port comes from its own `AGENT_PORT` and nowhere else.

**`plane up` spawns windowless and verifies.** No console window is created for any service
(measured — `specs/008-local-console/m0-windows-spawn.md`), output goes to `logs/<service>.log`
keeping **at most one** prior generation, and each service is confirmed *serving* before
success is reported. That last part is not politeness: every env var here is required and
throws at boot, so a misconfigured service dies in a second — a failure that used to be
visible in the window the launcher spawned. **Removing the window is what creates the
obligation to check.**

The console **talks straight to the agents**; the orchestrator is never in the path, so every
target command still works while the bot is down. It is deliberately **not a component**
(DECISIONS 025) and **must never outlive the human who ran it** — no state between runs, no
background poller, no daemon, no `--watch`. `reveille start` watches in the *foreground*,
bounded by the orchestrator's own `FOLLOWUP_TIMEOUT_MS`, and Ctrl-C stops the watching but
never the launch.

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
`POST /seek?seconds=<signed int>`, `POST /next?count=<positive int>`,
`POST /previous?count=<positive int>` (media; seek added 005 — seam v4; `count` and three
optional **response** fields added 007 — seam v5. Both additive: every earlier field and
verb unchanged, and a v4 agent still works). The v5 response fields — `title`,
`elapsedSeconds`, `totalSeconds` — are what a media target *observed*, all optional; a
game agent sets none, and an agent that omits them is indistinguishable from a target with
nothing to report. No target id ever enters a path, query, or body —
an agent's URL *is* its identity. An agent answers only its kind's verbs (a `/start`
to a media agent is a 404), and the orchestrator never sends the wrong ones.

**`seconds` and `count` are the seam's only request parameters, and the rule that
admits them is narrow.** Every verb before 005 was a bare POST; nothing had ever crossed
in a request. The rule: **a parameter of the *operation* may cross; a name for *which
target* may not** (DECISIONS 023, confirmed by 024). `seconds` says how far, `count` says
how many — never *which* player and never *which item*. A step of three is the same blind
step three times: it nominates nothing. This does **not** license
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

**The media ban is about *persistence and opinions*, not *observation* (007, DECISIONS
024).** The rule has moved twice: 005 went from "no movement through content" to "no
knowledge of content" (DECISIONS 022); 007 corrects that phrasing, because only *store*
ever belonged to it. Reveille is **mechanism, not policy** and **level-triggered, not
edge-triggered** — each call observes current reality, acts, and forgets.
**Permitted**: blind relative movement (`pl_next`, `pl_previous`, a *relative* `seek`), and
— since 007 — **observing** what the player reports in the response already fetched (title,
position, duration), telling the member, and discarding it. **Still forbidden**: *choosing*
content — `pl_jump` (a *nominated* item, the sharpest contrast with `pl_next`), `pl_play`,
`in_play`, `in_enqueue`, `pl_empty`, `pl_delete` — plus volume, `pl_stop`, OS kill, and an
*absolute* seek (M0 measured a bare `val=30` seeking *to* 0:30 instead of forward 30s, so
the adapter always sends an explicit sign). **Also still forbidden**: *storing* anything
observed between calls — no cache, no memo, no "last seen" — and any command depending on
another's leftovers. `vlc.test.ts` enforces the selection ban against source and the
statelessness ban behaviourally.

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
