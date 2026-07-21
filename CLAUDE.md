# CLAUDE.md

Operational context for this repository. **Architecture is not here** — that lives
in [`initial-architecture/`](initial-architecture/), and
[`DECISIONS.md`](initial-architecture/DECISIONS.md) is the authority for what was
chosen and why. The rules those decisions must not violate are in
[`.specify/memory/constitution.md`](.specify/memory/constitution.md).

## What this is

An on-demand control plane for self-hosted game servers. Two Discord slash
commands start and stop a Palworld dedicated server. A human decides when; that is
the whole policy.

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

npm start -w @reveille/agent          # needs agent/.env
npm start -w @reveille/orchestrator   # needs orchestrator/.env
```

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
genuinely irreversible decision here (Constitution I).

**`agent/src/palworld.ts` is the only file that may know this is Palworld.**

**Never force-stop.** `POST /v1/api/stop` and any OS-level process termination must
not appear in a path reachable from `/stop`. A stop that cannot be graceful is not
a stop — it fails and leaves the server running (Constitution IV). A test enforces
this against the adapter's source, and also that the save is issued *before* the
shutdown.

**The agent keeps zero runtime dependencies.** `node:http`, native `fetch`, and
`--env-file` instead of dotenv. Adding one needs a `DECISIONS.md` entry.

**No fallback config.** Every environment variable is required and throws at boot
naming itself. A blank Palworld admin password is an open admin interface; a
missing stop bound silently removes a data-loss guarantee.

## Configuration

`agent/.env` and `orchestrator/.env`, both gitignored — **the repository is
public**. Copy from the `.env.example` beside each; every value is documented
there.

Two different passwords, easily confused:

- **`PALWORLD_ADMIN_PASSWORD`** — the REST API the agent uses over loopback. Never
  leaves the machine.
- **`ServerPassword`** in `PalWorldSettings.ini` — what players type to join. Set
  because Palworld has no unlisted option (DECISIONS 012).

## Local setup on `watson`

Palworld lives at `C:\steamcmd\steamapps\common\PalServer`. Its live config is
generated on first run at `Pal\Saved\Config\WindowsServer\PalWorldSettings.ini` —
editing `DefaultPalWorldSettings.ini` at the root does nothing, as that file itself
warns.

Ports: **`8211/UDP`** is the game and the only forwarded one. **`8212/TCP`** is the
Palworld admin REST API, which binds `0.0.0.0` with no bind-address setting and is
blocked from the network by a firewall rule named
`Reveille - block Palworld REST API (8212) from network`. **`8300/TCP`** is the
agent, loopback-bound and therefore unreachable by construction.

Neither process starts at boot; both are launched by hand. That is deferred
deliberately, with a trigger, in
[`03-deferred.md`](initial-architecture/03-deferred.md).

## Testing

`node:test`, no framework. Tests sit beside their source as `*.test.ts`.

Anything touching the game server is verified against a **real** Palworld install
rather than mocks — that is the whole reason M0 exists as a prerequisite. Behaviour
the adapter depends on (process names, REST timing) was observed, not assumed.
Useful measured facts: the REST API answers ~3s after launch on an empty world, and
Palworld autosaves every 30 seconds while a player is connected, which is why the
save-durability test in `quickstart.md` §4 only means anything if you beat that
clock.

## Releases

Every push to `main` or `dev` is tagged by
`jeff-fichtner/snackbyte-release-flow-action@v1`, driven by `environments.json`.
Root `package.json` supplies MAJOR.MINOR; the action derives the patch. **Do not
remove `environments.json`** — a missing manifest fails silently as "not a release
branch" and nothing is ever tagged (DECISIONS 011).
