# Research: One console for the operator

**Feature**: 008-local-console · **Date**: 2026-08-10

Nine decisions. Two of them (§1, §4) are placement calls that the constitution decides for
us once the question is asked precisely; one (§5) is a measurement that must happen before
any code is written.

---

## 1. Where the console lives

**Decision.** Inside the **orchestrator workspace**, at `orchestrator/src/console/`, as a
second entry point. **No new package.**

**Rationale.** The constitution says "one independently deployable package per component"
and "a package is created when its component is actually built — never in advance." The
whole argument of this feature is that the console **is not a component** (spec, *Why this
is not a fourth kind of component*). Giving it a package would assert the opposite in the
repository layout while the spec denies it in prose — and the layout is the version people
believe.

Living inside the workspace also keeps the seam guard honest. `eslint.config.js` blocks
`**/../orchestrator/*` and `**/../agent/*` relative imports. A console outside the
workspace would need either an eslint exemption or a deep import through the package name
— both are holes in a rule whose entire purpose is that there be no holes. Inside the
workspace, `import { describeStart } from '../commands.ts'` is an ordinary intra-package
import and the guard is untouched.

**Alternatives rejected.**
- *A fourth workspace, `console/`.* Asserts componenthood; needs a new `exports` block on
  the orchestrator or an eslint exemption to reach the code it exists to reuse.
- *A node program under `scripts/`.* Same import problem, plus it sits outside `typecheck`
  and `test`, which is how it would rot.

**Consequence, accepted.** The console pulls `discord.js` in transitively, because
`buildCommandGroups` returns `SlashCommandBuilder`s. It is already a dependency of this
workspace, so nothing new is installed and the agent's zero-dependency rule is untouched.

## 2. How the surface is shared — behaviour, not just text

**Decision.** Extract the pure core of each command handler into a
`runX(...) → { reply, serverName }` function in `commands.ts`. Discord's `handleX` becomes
*defer → run → `sendReply`*; the console becomes *run → print → exit code*. Both surfaces
call the same core.

**Rationale.** 006 made `buildCommandGroups` the single source for *what the commands are*.
The thing that can still drift is *what a command does* — which verb it sends, which
argument it defaults, how it treats a sign. Sharing only `describeX` shares the **words**
and leaves the **behaviour** duplicated ten times.

This is a refactor of working code, which Constitution III normally discourages. It is
justified because the duplication it removes is exactly what SC-004 promises not to have,
and because the alternative writes the same ten sequences twice — once in US1 and again
when US3 makes them consistent. Doing it as foundational work writes them once.

**Alternative rejected.** *The console calls `AgentClient` + `describeX` directly,
duplicating three lines per command.* Genuinely crude-and-acceptable for one or two
commands; at ten it is a second implementation of the routing rules, and 005 already shipped
a drift bug of precisely this shape.

## 3. What the operator sees underneath the sentence — already built

**Decision.** Use `Reply.diagnostic`. Add nothing.

**Rationale.** 007 split every reply into the member-visible `text` and an operator-only
`diagnostic` carrying the status code, the errno, and the target's own error text — then
deliberately never rendered it, because `toEmbed` reads only `text` and `footnote` and
Discord is the wrong audience for it. FR-021 asks for exactly that field on exactly that
audience. **008 is the surface 007's diagnostic was built for**; the plumbing already exists
and has tests.

The console therefore prints `reply.text`, then `reply.diagnostic` when present, then the
agent URL it spoke to. `renderDetail` (title · position) is already folded into `text` by
the reply functions, so observation comes along for free.

## 4. The plane's service list is derived, not tabled

**Decision.** Discover services from the filesystem: every `agent/.env.*` file is one agent
service, and `orchestrator/.env` is the orchestrator service. Each agent's port comes from
its **own** `AGENT_PORT`.

**Rationale.** `reveille.ps1` hardcodes a four-row table naming each env file, entry script,
and port. That port is the **third** copy of a fact already written in `agent/.env.<t>`
(`AGENT_PORT`) and in `TENANTS` (inside the agent URL). Three copies of a number that must
agree is the drift this repository keeps legislating against, and the table also has to be
edited by hand every time a target is added — which the rest of the system does not require.

Deriving instead means a fourth target is managed the moment its env file exists, with no
table to update, and the port has exactly one source.

**This does not violate FR-015.** That requirement forbids building the **target map** —
which targets exist and where they are addressable — from the agents' env files, because
that map needs `kind` and `publicPort` which those files do not carry. The **service list**
is a different question: which *processes* run on this host. The two are deliberately
sourced differently, and the split is clean:

| Question | Source |
|---|---|
| Which targets can I command, and at what address? | `TENANTS` (FR-011) |
| Which processes make up the control plane on this box? | `agent/.env.*` + `orchestrator/.env` |

FR-025 is where they meet: a target's URL from `TENANTS` yields a port, and the service list
says whether a Reveille agent is running on it.

**Alternative rejected.** *Keep the hardcoded table.* Simplest to write, and wrong for the
same reason the feature exists — it is a second copy of a fact that already has a home.

## 5. The Windows spawn flags — MEASURED, not assumed

**Decision.** `spawn(process.execPath, [...], { detached: true, windowsHide: true, stdio:
['ignore', fd, fd] })` then `.unref()` is the **candidate**, and it must be verified on
`watson` before it is written into the launcher. This is an M0 task and it blocks the US2
implementation.

**Why it cannot be assumed.** `detached: true` and `windowsHide: true` set *different and
potentially conflicting* Windows process-creation flags — `DETACHED_PROCESS` /
`CREATE_NEW_CONSOLE` versus `CREATE_NO_WINDOW`. Their interaction decides whether a window
flashes, whether none appears, or whether the child dies with its parent. This repository's
M0 discipline exists for exactly this class of question: Palworld's API timing, Satisfactory's
`isGameRunning`, VLC's absolute-seek behaviour, and 007's `information.title` integer were all
things that looked obvious and measured differently.

**Protocol — four observations, recorded in `m0-windows-spawn.md`:**

1. Spawn one agent with the candidate flags. **No console window appears** (visual, plus no
   new `conhost.exe` associated with the child).
2. The agent answers `GET /status` on its port — it is genuinely serving, not merely alive.
3. Close the launching terminal. The agent **keeps running** and still answers.
4. The redirected log file **contains the agent's startup output**, and keeps growing.

**Recorded fallback if the combination misbehaves:** drop `detached` and keep
`windowsHide`, then verify survival separately — a child of an exited parent is not
automatically killed on Windows, so `detached` may prove unnecessary rather than wrong. If
*that* fails too, the fallback is a tiny launcher stub whose own window is hidden. Both are
worse; neither is needed unless measurement says so.

## 6. Readiness — what "actually serving" means per service kind

**Decision.** Per kind, with a bound:

- **Agent** — `GET /status` on its own `AGENT_PORT` returns HTTP 200. Not "the port is
  bound", which a half-initialised process can satisfy.
- **Orchestrator** — its log contains `orchestrator connected as …`, the line
  `index.ts` already writes on `clientReady`.

**Rationale.** FR-034 requires verifying the service is *serving*. The agent has an obvious
probe. The orchestrator has no inbound port at all — that is the property 008 protects — so
there is nothing to probe, and inventing one would be the exact mistake this feature avoids.
But it already announces itself on stdout, and as of this feature **stdout is a file we
control**. The readiness signal was always there; redirecting the output is what makes it
readable.

A failed start is therefore also self-explaining: the fail-loud config error is in the same
file, immediately above where the ready line would have been.

**Bound.** Readiness waiting is bounded per service; on expiry the service is reported
failed with its log named. Satisfactory's agent starts as fast as any other — the ~10s
figure in `CLAUDE.md` is the *game's* API, not the agent's — so a few seconds is ample. The
exact value is a task-level detail, not a new configuration variable.

## 7. Exit codes

**Decision.** `0` success · `2` refused by the target · `3` agent unreachable · `64` usage
error.

**Rationale.** Four classes as clarified. `64` is `EX_USAGE` from `sysexits.h`, the
long-standing convention for "you typed it wrong", which keeps misuse distinct from any
outcome the system reported. `2` and `3` are the two the clarification says must never
share: a caller may reasonably retry an unreachable agent and must never retry a refusal.

`1` is deliberately **unused** so that an unhandled crash — which Node exits `1` for — is
never mistaken for a meaningful outcome.

## 8. Finding Reveille's own processes for `plane down`

**Decision.** Enumerate processes and match on **entry script + env file**, exactly as
`reveille.ps1` does today. Node has no built-in process enumeration, so the console runs a
single PowerShell `Get-CimInstance Win32_Process` query and parses its JSON.

**Rationale.** FR-032 requires that `plane down` remain incapable of stopping an unrelated
process after a reboot or a reused process id. Command-line matching is the property itself
rather than a proxy for it: "node running *this* entry script with *this* env file" cannot
accidentally be someone's editor.

Shelling out to PowerShell is mildly ugly and is chosen anyway: it adds **no dependency**,
it is the same query the current script makes, and the console is a Windows operator tool
already. Matching gets *simpler* than today's, because dropping the `powershell.exe` wrapper
means only `node.exe` can match.

**Amended during implementation: the paths must be ABSOLUTE.** The first cut launched services
with repo-relative paths, so a command line read `--env-file=agent/.env.palworld
agent/src/index.ts` — **identical in every checkout of this repository.** A second clone on
the same machine would therefore match, and `plane down` in one would stop the other's agents.
This was not hypothetical: it fired within minutes, when a throwaway probe in a temp directory
was matched as though it were the real Palworld agent. Services are now launched and matched
by absolute path, so the repository root is part of a service's identity. Comparison is
case- and separator-insensitive, because Windows reports neither consistently.

**Alternatives rejected.**
- *A PID file.* Forbidden alone by FR-032. A PID plus command-line verification would be
  legal but needs the same enumeration anyway, so it buys nothing.
- *A dependency such as `ps-list`.* A runtime dependency for one query, in a repository that
  requires a `DECISIONS.md` entry to add one.
- *Matching the relative form as well, for backwards compatibility.* It would permanently
  reintroduce the cross-checkout hazard to solve a one-time migration. Services started by
  the old script were stopped and relaunched through the console instead.

## 9. How the console gets its configuration

**Decision.** The `reveille.cmd` shim launches node with
`--env-file=<root>/orchestrator/.env`, and the console calls the **existing**
`parseTenants(process.env)` and `requiredPositiveInt('FOLLOWUP_TIMEOUT_MS')` from
`config.ts` — not `loadConfig()`.

**Rationale.** `--env-file` is how every process in this repository reads configuration, and
it inherits fail-loud for free: node errors if the file is missing, and `parseTenants` throws
naming the variable if it is malformed (FR-014). No parsing code is written, and the console
cannot disagree with the orchestrator about what `TENANTS` means because it is the same
function.

`loadConfig()` is avoided deliberately: it also requires `DISCORD_BOT_TOKEN` and
`DISCORD_APPLICATION_ID`, which the console never uses. Demanding a credential to run a
local status command would be wrong on its own, and the narrower call documents what the
console actually depends on.

**Security note, load-bearing.** The console's `process.env` therefore contains
`DISCORD_BOT_TOKEN`. The repository is public and the constitution forbids committing
credentials. The console MUST NOT print its environment, echo unknown configuration, or
include `process.env` in any diagnostic — a debug dump in an operator tool is the most
plausible way that token ever reaches a screenshot. This becomes a task and a test.

The shim passes the repository root explicitly from `%~dp0`, so `reveille` works from any
directory without walking parents looking for a marker file.
