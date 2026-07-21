# Decision log

> **Permanent** — append-only, and **the only document here that survives.**
> Everything else in this folder is consumed, burned down, or shrunk to nothing.
> What isn't captured here is lost, including the reasoning behind it.

Short entries. The point is that settled choices don't get relitigated mid-build,
and that **candidates get promoted here with the reason they won** — not silently
absorbed into code.

**Write the entry before deleting the document that motivated it.** That ordering
is the whole mechanism; reverse it and the record has decisions with no rationale.

## What belongs here

- A candidate being **chosen** (runtime, contract format, repo layout, project name).
- A **deferred question being closed** — see [03-deferred.md](03-deferred.md).
- Any change to **the seam**, which is an architecture change by definition.

## What doesn't

Implementation details that don't close a question. If it isn't resolving
something the architecture left open, it belongs in code and comments.

## Format

```
## NNN · <title>
**Date:** YYYY-MM-DD · **Status:** accepted | superseded by NNN
**Closes:** <question> / candidate: <name> / —

**Context.** What forced the decision now.
**Decision.** What was chosen.
**Why it won.** Including what it was chosen *over*.
**Consequences.** What this now makes easy, and what it makes expensive.
```

---

## 001 · The system is generic over targets, not just games
**Date:** 2026-07-20 · **Status:** accepted
**Closes:** candidate: what the system is generic *over*

**Context.** Every draft generalized carefully over *games* — Palworld is an
adapter, add Minecraft later — and never generalized over *targets*. Each assumed
one PC forever, and treated the halves of the system sharing a box as a temporary
awkwardness that the Wake-on-LAN phase would eventually resolve. That framing made
the entire architecture contingent on a milestone the plan itself marked optional,
which in turn made "why not just write one program?" unanswerable.

**Decision.** The system is generic over **two** axes, and the target axis is the
load-bearing one:

- **Target-agnostic.** One orchestrator; **one agent per controlled server.** The
  Palworld server on the gaming PC is the first entry in a list, not the whole
  world.
- **Game-agnostic.** One adapter per game behind a fixed interface. Palworld is
  the first adapter, and the only Palworld-aware code in the system.

**Why it won.** It matches the actual direction of the thing — *"something that
starts `<insert computer>`"* — and it survives Wake-on-LAN never shipping. Chosen
over the implicit one-machine framing, which could only justify splitting the
system by appealing to a phase that might never arrive.

**The unit is the server, not the machine.** An earlier version of this entry said
one agent per *machine*. That was wrong: all four verbs — `start`, `stop`,
`status`, `players` — are scoped to a game server, and nothing the agent owns is
machine-level. Machine-scoping would have forced a resource identifier into the
contract (`/servers/{id}/start`) the first time one box ran two games, and a
contract change is the one thing this architecture must never pay for.

**Machines exist only in orchestrator config**, never in the contract. The
orchestrator knows which servers share a box; the agent never learns machines
exist. That grouping is unused until Wake-on-LAN, which is exactly what needs it.

**Consequences.** Co-location stops being a compromise and becomes simply what
N=1 looks like. Two games on one PC is two agents on two ports — additive, no
contract change. Wake-on-LAN demotes from organizing principle to one example of
a thing you can do to a machine in the list.

---

## 002 · The seam is a network contract, always
**Date:** 2026-07-20 · **Status:** accepted
**Closes:** candidate: in-process versus network split

**Context.** At the first milestone the agent is roughly `spawn(gameServer)`.
Wrapping that in an HTTP server and writing a client for it is about thirty lines
of ceremony around two lines of work, and with only two call sites the split could
honestly be retrofitted in an afternoon. Whether to bother was never actually
asked by any draft — it was assumed.

**Decision.** The orchestrator talks to actuators over a network API. Never
in-process, never a localhost shortcut, including while both run on the same
machine. Direction is **orchestrator → actuator**; actuators never initiate.

**Why it won.** Under 001 there is one agent per controlled server and exactly one
orchestrator, so they are separate processes *by definition* — the network call is
the only shape the system can have, not insurance against a maybe-milestone.
Chosen over a single program with internal module boundaries, which was genuinely
cheaper for the minimum and becomes wrong the moment there is a second server.

**Consequences.** Relocating the orchestrator is a deploy-target change with zero
contract changes. Adding a server — another game, or another machine — is
deploying another agent and adding an address. Costs about thirty lines and one
port number now. **An agent's URL is its identity**: no server or machine
identifier ever enters the contract.

---

## 003 · One repository, one package per component
**Date:** 2026-07-20 · **Status:** accepted
**Closes:** candidate: repo layout

**Context.** The `snackbyte-*` convention is repo-per-thing, which pulled toward
several repos; a draft had marked monorepo "settled" without knowing that
convention existed. Repo topology also turned out to be **reversible** — given
002, splitting one repo into several is moving a directory, and merging back is
easier still. Neither touches logic.

**Decision.** One repository, `snackbyte-reveille`, with one independently
deployable package per component plus the contract between them. Today that is
`contract/`, `agent/`, `orchestrator/`. An `emitter/` package is added **when an
emitter is actually built** (008) — not reserved in advance.

**Why it won.** The convention is about *systems*, and Reveille is one system.
Keeping the contract in one place removes the only real drift risk, and one deploy
story beats several kept in step by hand. Chosen over a repo per component, whose
main argument — "use `snackbyte-base` as designed" — died with 004.

**Consequences.** Package count tracks component count, so the layout stays
legible as actuators multiply. The agent is one program deployed once per
controlled server; the orchestrator is one program deployed once. If a split is
ever wanted, 002 makes it cheap.

---

## 004 · `snackbyte-base` is not the template for this
**Date:** 2026-07-20 · **Status:** accepted
**Closes:** candidate: project scaffold

**Context.** The obvious move was to spin Reveille out of the existing template.

**Decision.** Don't. Start from an empty repository and copy conventions by hand.

**Why it won.** Three independent disqualifications: `snackbyte-base` is a
Vite + React web app template with no headless-service mode (server mode keeps the
frontend); it deploys to Google Cloud Run, where **no** Reveille component can
live — actuators must be physically present, and Cloud Run can never emit a
Wake-on-LAN packet; and the Cloud Run deploy spine is the bulk of what the
template provides. What remains useful is the TypeScript toolchain, which is ten
minutes of copying.

**Consequences.** No scaffold, but also no fighting one. Toolchain conventions
(`tsconfig`, ESLint, npm scripts, `CLAUDE.md` layout) are lifted from
`snackbyte-base` deliberately rather than inherited accidentally.

---

## 005 · TypeScript/Node for every package
**Date:** 2026-07-20 · **Status:** accepted
**Closes:** candidate: agent runtime · candidate: orchestrator runtime

**Context.** Drafts assumed C#/.NET for the agent and Node for the orchestrator,
and never argued for the split. The C# argument rested on driver-level hardware
access, which was cut from scope — the argument that selected the language no
longer applied to the program that remained.

**Decision.** TypeScript on Node, every package.

**Why it won.** The agent's work is launching a process and speaking RCON over
TCP; neither needs Windows-native reach. Every other `snackbyte-*` service is
TypeScript/Node. One stack means one toolchain, one set of conventions, and a
shared contract type with no cross-language marshalling. Chosen over the
two-language split, which was inherited rather than decided.

**Consequences.** The agent still *runs* on Windows and is still tested there —
that pin is about the deploy target, not the language.

---

## 006 · Reveille runs its own Discord bot
**Date:** 2026-07-20 · **Status:** accepted
**Closes:** the "fold into the existing bot" premise

**Context.** Drafts recorded "this should eventually be part of the owner's
existing Discord bot" as a requirement. It never was — an inference from an
offhand mention, which then propagated through every packaging discussion.
`snackbyte-discord` is existing always-on Discord infrastructure that Reveille
*may reuse*, not a system it must merge into.

**Decision.** Reveille hosts its own Discord bot for commands. Reuse of
`snackbyte-discord` is limited to Reveille posting to it as an inbound webhook
source, and is optional and deferred.

**Why it won.** Direction decides it, and that hub's own `ARCHITECTURE.md` settles
the direction: it *"calls out to Discord's API and webhooks exclusively"* and
*"does not integrate with arbitrary external services."* It also runs on Cloud
Run and cannot reach a home LAN. Meanwhile a Discord bot dials *out* to Discord's
gateway, so Reveille's own bot needs no port forward and no tunnel — strictly less
infrastructure than relaying commands through a cloud service.

**Consequences.** Not duplication: the hub stays good at announcements (adding an
inbound source there is near-zero effort by its own design), and the command path
stays local. The hub can never be Reveille's always-on host regardless.

---

## 007 · The agent is welded to what it controls; only the orchestrator relocates
**Date:** 2026-07-20 · **Status:** accepted
**Closes:** candidate: which components relocate

**Context.** With co-location framed as temporary, it was never clear which parts
of the system were fused now and would separate later. The natural guess — that
the agent would eventually sit on a different device from the thing it controls —
is backwards, and left unstated it would have justified all kinds of premature
indirection.

**Decision.** The agent and the process it controls are permanently on the same
machine. Neither the agent nor any part of it ever relocates. **The orchestrator
is the only component that relocates; actuators multiply instead.**

**Why it won.** It is definitional rather than chosen: a process that actuates
something on a machine must be on that machine. An agent controlling a remote
server would need remote process control there — which means software on that box,
which is an agent. Both halves of the agent are pinned for the same reason: the
HTTP server must answer at the address identifying the server, and the game
adapter must be where the process is.

**Consequences.** The agent **multiplies rather than moves** — growth means more
agents, never pieces of one. The fusion that does dissolve is orchestrator and
agent sharing a box, which ends when the orchestrator relocates to something
always-on. When a machine sleeps, its agent dies alongside its game server; that
is the resting state, not a failure. Swapping Palworld's adapter for another
game's is a different *deployment*, not a component detaching.

---

## 008 · Three components, each welded to something
**Date:** 2026-07-20 · **Status:** accepted
**Closes:** candidate: where the Wake-on-LAN emitter lives

**Context.** The WoL emitter looked like a module inside the orchestrator, which
implied the orchestrator would eventually *split* — since an emitter must sit
inside the broadcast domain it wakes, and one orchestrator cannot be inside
several networks at once. Multiple LANs make that undeniable: WoL cannot cross a
router, so each broadcast domain needs its own emitter.

**Decision.** The emitter is not part of the orchestrator and never was. It is a
**third component**, peer to the agent. The system has exactly three kinds of
thing, each defined by what it is welded to:

| Component | Welded to | Count | Deployed |
|---|---|---|---|
| **Orchestrator** | nothing | exactly 1 | anywhere always-on |
| **Agent** | a game server process | 1 per server | with its server |
| **Emitter** | a broadcast domain | 1 per LAN | anywhere on that LAN |

**Why it won.** An emitter matches the agent's job description exactly — a small
actuator deployed where the thing physically is, called by the orchestrator over
the network. Housing it inside the orchestrator while there is one LAN is a
co-location convenience, identical in kind to the orchestrator and agent sharing
the PC at M1. Chosen over "emitter as orchestrator module", which was only
coherent while exactly one network existed.

**Consequences.** The orchestrator still never splits — it stays one thing that
decides *when*, and only ever relocates. Actuators multiply. Growth remains **more
rows, never new kinds**: a second game is an agent, a second machine is an agent
plus a MAC in config, a second network is an emitter.

An emitter cannot ride along with the agent on a sleeping machine, because that
agent is asleep too — the waker must be a different always-on host on that LAN.

**This is the last new kind of thing the system gains.** Note also that **sleep**
is not the emitter's job: WoL can only wake, and the OS puts machines to sleep on
idle using a setting that already exists. Nothing is written for it.

---

## 009 · The Palworld adapter speaks the REST API, not RCON
**Date:** 2026-07-21 · **Status:** accepted
**Closes:** candidate: which Palworld interface serves the four verbs

**Context.** Earlier drafts recorded RCON and the REST API as interchangeable
candidates — *"which interface serves which call is a candidate-level detail."*
Planning feature `001-discord-start-stop` forced the choice, because `stop` must
save the world and verify the save before shutting down, and that ordering has to
be expressed against one of them.

**Decision.** The adapter uses the **REST API**: `POST /v1/api/save`, verify, then
`POST /v1/api/shutdown`, with Basic auth over loopback. RCON is **disabled
outright** on the server rather than merely left unused.

**`POST /v1/api/stop` is forbidden.** It is Palworld's *force* stop and is
precisely the "kill the process to satisfy the call" that Principle IV rejects.
It is banned by name in the feature's contract, alongside OS-level process
termination.

**Why it won.** **Pocketpair has officially deprecated RCON and it is scheduled
to stop working in a future update.** The adapter is the only Palworld-aware code
in the system, so building it on a dying interface would mean rewriting the one
game-specific file for no gain. Both interfaces expose equivalent save and
shutdown operations, so nothing is given up. Chosen over RCON, which every
community guide still recommends — the guides predate the deprecation.

RCON is disabled rather than firewalled because an admin interface that exists
but is unused is only a liability.

**Consequences.** The server requires `RESTAPIEnabled=True` and a **real**
`AdminPassword` — Basic auth depends on it, and a blank admin password is an open
admin interface on the LAN. Neither the REST API nor RCON may ever be
internet-reachable; Palworld's own documentation states these APIs *"are not
designed to be exposed directly to the Internet."*

It also gives "is the server running?" a better answer than process inspection:
`PalServer.exe` is a launcher that spawns a child, so the launcher's presence
proves nothing. The REST API answering does. That satisfies the no-persisted-state
rule for free and defines "still starting" as *launched, but the API is not
answering yet*.

> **Amended by [010](#010--still-starting-needs-a-second-signal-amends-009).** The
> closing claim above is wrong: a silent REST API cannot distinguish `starting`
> from `stopped`. See 010.

---

## 010 · "Still starting" needs a second signal (amends 009)
**Date:** 2026-07-21 · **Status:** accepted
**Closes:** how `starting` is told apart from `stopped`

**Context.** 009 closed with the claim that the REST API alone defines "still
starting" — *launched, but the API is not answering yet* — and that no further
machinery was required. FR-017 (refuse a stop mid-launch) was added later, by the
2026-07-21 clarification session, and is the first requirement to actually depend
on that claim. It does not hold.

A silent REST API is **ambiguous**: it means `starting` *or* `stopped`, and
nothing in the HTTP response separates them. "Launched" is not observable from an
interface that is not answering. The consequence was concrete and bad — the
`/start` guard would read a silent API as `stopped` and launch a **second**
`PalServer.exe` during the ~90-second startup window, which is exactly what
FR-008 forbids and a plausible route to the world corruption Principle IV exists
to prevent.

**Decision.** State is derived from **two** questions asked at request time:
does `GET /v1/api/info` answer, and does a `PalServer.exe` **or**
`PalServer-Win64-Shipping-Cmd.exe` process exist.

| REST answers | Either process exists | State |
|---|---|---|
| yes | — | `running` |
| no | yes | `starting` |
| no | no | `stopped` |

Because this is a check-then-act, the agent **serializes command handling** so
two concurrent requests cannot both read `stopped` before either spawns.

**Why it won.** It is the smallest thing that makes FR-008 and FR-017 true, and
it preserves everything 009 got right. 009 was correct that process identity is a
bad *"is it up?"* signal — the launcher exits while the child runs — so the REST
API remains the sole authority on `running`. Process existence is used only for
the narrower job the REST API cannot do: separating `starting` from `stopped`.
Both process names are checked because each covers the other's blind spot — the
launcher exists from the instant `spawn` returns, closing the window before the
child appears; the child covers the launcher exiting early.

Chosen over remembering that a start was issued, which 009 already rejected and
which the agent's contract forbids between requests. Serialization is not that:
it is mutual exclusion *within* a request, and nothing survives the response, so
FR-012 holds.

**Consequences.** `getState()` replaces `isRunning()`; a boolean cannot carry
three states. `/start` now has two distinct refusals — `409 running` and
`409 starting` — which means `starting` appears as both a 202 and a 409, so the
orchestrator must key on HTTP status rather than `state` alone. The agent gains a
process lookup, which is the first OS-level call outside `spawn` and is
Windows-specific; it lives in `palworld.ts` with the rest of the platform
knowledge. The concurrent-command edge case, previously listed as not validated,
is now actually handled.

---

## 011 · The release flow is consumed, not built
**Date:** 2026-07-21 · **Status:** accepted
**Closes:** candidate: how this repo versions and releases

**Context.** Versioning had been sitting in `001-discord-start-stop` as a task,
which was the wrong home: it is repository infrastructure, not part of starting
and stopping a game server. It is set up outright instead, so every commit from
here on is versioned, and it is removed from that feature's task list.

**Decision.** Consume `jeff-fichtner/snackbyte-release-flow-action`, pinned at
`@v1`, with `version-strategy: build-id`, per that action's `CONSUMING.md`. It is
adopted as an existing snackbyte-wide convention, not designed here.

**Why it won.** The reasoning lives in the action's own repository and it is
already the standard across snackbyte repos; re-deriving it per feature would be
the duplication the convention exists to prevent. Chosen over deferring it to
[03-deferred.md](03-deferred.md) until a second machine made version drift real —
rejected because consuming a pinned, externally-maintained action is close to
zero marginal work, while retrofitting release infrastructure onto a repo that
has started shipping is not.

This is a **knowing, bounded deviation from Principle III**, which says a future
capability is not licence to prepare for it. Nothing in this milestone reads a
version number: the quickstart runs both processes from source with `npm start`,
and there is no packaging step, artifact registry, or install path. The deviation
is accepted because the cost is a pinned reference rather than built machinery,
and because Principle III's target is *bespoke* speculative structure, not
adopting an existing org standard.

**Consequences.** This repo inherits the action's versioning semantics and is
coupled to its `@v1` contract — a breaking change there is a change here. Version
numbers will exist before anything consumes them, which is accepted and expected
to stay true until the orchestrator relocates and two machines can drift out of
sync. If that coupling ever costs more than it saves, the entry to supersede is
this one.

`environments.json` lists **`main` and `dev`** even though `dev` does not exist
yet — an unlisted branch simply resolves to `is-env=false`, so the row costs
nothing until the branch appears and means staging works the day it does. The
workflow carries an empty deploy slot gated on `is-env`; adding a target is an
edit to that one step.

**The manifest is required and its absence fails quietly.** `resolve-env.sh`
defaults the manifest *path*, never its contents, and `require()` on a missing
file is caught by the same branch as "this isn't a release branch" — yielding
`is-env=false`, "nothing to do", and a green exit 0. A repo that forgets the file
silently never releases. That is a defect in the action, not here; recorded so the
next repo does not lose an afternoon to it.
