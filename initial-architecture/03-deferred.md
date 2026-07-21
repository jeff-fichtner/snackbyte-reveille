# Deferred

> **Living** — this list should shrink. When something closes, it leaves here and
> the answer lands in [DECISIONS.md](DECISIONS.md) with its reasoning.

Everything considered and consciously **not** built. Listed so their absence reads
as a decision rather than an oversight — and so nothing here gets rediscovered
from scratch in six months.

Nothing on this page blocks [the minimum](02-the-minimum.md).

---

## Answered for free by playing (M0)

Running the server by hand for a week measures these. Guessing at them now would
be inventing requirements.

| Question | What it settles |
|---|---|
| How long is a typical session? | Whether a restart scheduler is ever needed |
| How often do people drop and reconnect? | How long a grace timer should be |
| How long does a cold start really take? | What the human sees while waiting |
| What does RCON actually return? | The shape of the presence verb |
| How much RAM does the server hold after a long session? | Whether the leak actually crowds the game client on the host |

---

## Deferred until it annoys you

### Auto-stop when the last player leaves
The eventual want, not the launch bar. Needs presence tracking, a grace timer, and
a real state machine in the orchestrator — none of which the minimum has.

The subtlety worth remembering: presence is an **identity** problem, not a count.
"Noah left, you're still on" is a different decision from "one player left," and a
count cannot tell them apart. So the verb returns *who*, and presence is tracked
centrally in the orchestrator — never by a Discord client deciding locally.

Also: a player who drops to fix their wifi trips the same "last player left" path
as one who's done for the night. The grace timer exists for exactly that, and
sizing it wrong turns a 30-second reconnect into a full restart ceremony.

### Durable orchestrator state
Once there's a state machine, it has to survive its own restart without orphaning
a running game server. What's persisted, where, and how it reconciles with reality
on startup — all open. Nothing to persist yet.

### Push versus poll
Does the orchestrator poll for presence, or does the agent push events? Decides
the contract's shape. *Lean:* poll, while the machine is always on. Revisit if a
machine is ever allowed to sleep — polling a box that's *allowed* to be
unreachable is a different problem.

Note this is the one place the "actuators never call out" rule could bend. If it
ever does, that's a **change to the seam** and belongs in
[DECISIONS.md](DECISIONS.md), not in an implementation.

### Contract format
Hand-written is correct for two verbs; two verbs cannot drift. Once presence
enters the contract, mechanical enforcement — generated client, shared schema —
stops being ceremony and starts being the thing that keeps both sides honest.
**Trigger: when the contract grows past M1.**

### Ownership of recovery
If the game server crashes, who restarts it — the OS service manager, the agent,
or the orchestrator reacting to status? All three are defensible; **any two
running at once will fight, and the fight will look like flapping.** Entangled
with how the agent supervises the process at all (managed service versus child
process), because whoever supervises is implicitly deciding restart policy.
Related and unanswered: what happens to the world if the agent dies while the game
server is still running.

### "Unreachable" is ambiguous
Nothing distinguishes *the agent isn't answering because the machine is off*
(normal) from *because something broke* (not). Harmless while the PC is always on.
Becomes central the moment a machine is allowed to sleep, since the resting state
of a healthy system is then an unreachable agent.

### Trust on the seam
The agent exposes remote process control on a LAN and nothing authenticates the
orchestrator. Separately: which Discord users may issue commands. Binding to the
LAN is the M1 answer. **Trigger: before the agent is reachable from anywhere you
don't control.**

### The experience of a slow start
Between the command and a joinable server sits a process launch and a world load —
plausibly a minute of silence. What the human sees during that window is the part
either of you will actually judge the system by. M0 measures how long it is.

### Installation and updates
Nothing covers how the game server gets installed, patched, or recovered. Steam
updates can and do break running servers, and the premise here is that nobody is
watching the box.

### Starting the agent and orchestrator automatically
Both are started by hand today. After a reboot Discord goes quiet until someone
runs them, which the spec already anticipates: *"getting it to start automatically
is an operational concern, not a requirement of this feature"* (spec Assumptions).

**When it happens:** the first time the server is wanted and nobody is at the
machine to start the processes — which is the same complaint the whole project
exists to answer, so it will be obvious. Two scheduled tasks, roughly.

**It carries a decision with it.** `plan.md` says the orchestrator runs under WSL2;
in practice it has only ever been run as native Windows node, which works because
it is `discord.js` plus `fetch` and touches nothing platform-specific. Whichever
way that lands, it should land when autostart is built — the two are coupled,
since WSL2 needs the distro up before the process. Native for both is the cheaper
answer and costs nothing later: the seam is HTTP regardless, so relocating the
orchestrator to its own always-on box stays a config change either way.

Not deferred, and already true: the agent must never take the game server down
with it. `start()` spawns detached and unrefs the child, so restarting or killing
the agent leaves Palworld running.

### A restart scheduler
Palworld's memory leak is real — a world clean at ~4GB can reach 15GB+ by the next
day, and more RAM doesn't fix it. The standard remedy is a restart every 6–12
hours. **But that advice was written for servers that run 24/7, and this one
doesn't** — it stops when you stop playing, which already resets the leak. If your
sessions are shorter than the leak's runway, a scheduled restart is a policy that
can only ever interrupt live players for no benefit. **M0's session-length data
decides whether this exists at all.**

One local wrinkle: the host runs the game client too, so the leak competes for the
same 32GB rather than having a dedicated box to itself. That raises the value of
*stopping* the server promptly — which `/stop` already does — without changing the
argument against a *scheduled* restart.

If it does turn out to be needed, it is *policy*: it lives in the orchestrator and
issues `stop`/`start` through the seam. Never a local timer on the game machine.

---

## Deferred, possibly forever

### Wake-on-LAN
The interesting one, and the least urgent. Worth doing only if the electricity,
noise, or heat of an always-on PC actually bothers you.

**No longer load-bearing.** The architecture is justified by controlling *servers
across targets* ([001](DECISIONS.md)) and by the three-component shape
([008](DECISIONS.md)) — not by this milestone. WoL is one example of something you
can do to a machine, rather than the reason the design exists. It became optional
the moment that framing landed.

**Deferred as a deployment, not as an idea.** The emitter's shape is already
fixed; what's deferred is building and deploying one. Nothing is reserved for it
in the meantime.

When it happens: the orchestrator moves to an always-on box **on the same LAN**
(WoL is a layer-2 broadcast — cloud cannot do it, which is also why
`snackbyte-discord` can never host this), and an **emitter** appears there. The
emitter is a third component, peer to the agent, welded to a broadcast domain
rather than to a process — see [decision 008](DECISIONS.md). One per LAN, not one
per machine: the packet carries the target's MAC, so a single emitter wakes
anything in its network.

**The agent doesn't change. The contract doesn't change. The agent doesn't move**
— it stays welded to the game server on the PC while the orchestrator relocates
without it.

**Wake-on-LAN runs below the operating system, and that is why it works.** A magic
packet is a UDP broadcast carrying the target's MAC address repeated 16 times. The
target's *network card* stays powered while the machine is off and watches for
exactly that pattern, then signals the motherboard to power on. No OS, no service,
no agent — nothing on that machine is running. It is firmware, enabled once in
BIOS/UEFI, and about ten lines on the sending side with no privileges required.

So the emitter has **no access to the target machine at all**, which is the exact
opposite of the agent. The agent has full reach and only works while the machine
is awake; WoL has zero reach, works only while it is asleep, and can do precisely
one thing.

**Wake and sleep are not inverses, and do not have the same owner.** There is no
"sleep packet" — putting a machine to sleep needs code running *on* it, which is
what you don't have once it is asleep.

- **Wake** → the orchestrator fires a packet. Nothing on the PC. Free.
- **Sleep** → **the OS does it. Settled: we don't write this.** Windows already
  sleeps on idle; it's an existing setting, not something to build. The
  orchestrator's only job is to *notice* — an unreachable agent on a known-idle
  machine means asleep.

That also means **no machine-scoped agent is ever needed.** Sleep was the only
machine-level action in sight, and the OS owns it — so everything the *agent* does
stays server-scoped, exactly as the contract assumes.

The emitter is not a counterexample. It is scoped to a **network**, not a machine,
and it acts on machines that have no software running at all. That is why it is a
separate component rather than a widened agent.

This is consistent with the split rather than an exception to it: stock OS
behaviour isn't a violation. The constraint is narrower — **whatever decides,
policy has to find out.** A box that sleeps while the orchestrator believes it is
awake is a problem because the orchestrator didn't learn, not because the OS
decided.

One trap that remains: **wake is unverifiable.** Nothing acknowledges a magic
packet, so waking needs a deadline, a retry budget, and a failure path that tells
the human what happened.

### A second controlled server — another game, or another machine
The point of [decision 001](DECISIONS.md), and free when it comes: **deploy
another agent, add an address.** Identical in both cases, because the agent's unit
is the server rather than the machine — Minecraft alongside Palworld on the same
PC is the same operation as a server on a different box.

Don't build for it now beyond never hardcoding the one PC. The orchestrator's
notion of *which servers share a machine* stays absent until Wake-on-LAN needs it.

The **only** case that needs more than an agent is a machine on a *different
network* that's allowed to sleep — that needs an emitter on that network too.
Same LAN, the existing emitter already reaches it.

### A second game
The adapter boundary exists so this stays cheap *later*. Don't pay for it now by
building an abstraction against a single implementation.

**Wanted eventually:** Satisfactory, Raft, Minecraft. Checked 2026-07-21; they are
not equivalent, and the order matters.

- **Satisfactory — do this one first.** Official dedicated server on SteamCMD with
  an **official HTTPS API** on loopback (`https://127.0.0.1:7777/api/v1`) covering
  server state, save management and shutdown. Structurally the same adapter as
  Palworld: ask an API for state, save, verify, then shut down. It is the row this
  architecture was drawn for, and it proves the game-agnostic axis without
  simultaneously inventing a new control mechanism. One wrinkle: the API is always
  TLS-wrapped, self-signed by default, so the adapter needs to skip verification on
  loopback — doable with built-in Node, no dependency.
- **Minecraft — second.** Official server, and **RCON** (`enable-rcon` in
  `server.properties`) gives `save-all` and `stop` over a network protocol, so it
  avoids the stdin/process-handle trap entirely. RCON reachability doubles as the
  "is it up" signal the way the Palworld REST API does. It is a binary protocol
  rather than HTTP, so the agent hand-rolls a small client — which is the useful
  stretch: it proves an adapter need not speak HTTP. Note the irony against
  DECISIONS 009, which rejected RCON *for Palworld* because Pocketpair deprecated
  it; for Minecraft it is the stable, standard path.
- **Raft — last, and the least certain.** There is no official dedicated server.
  RDS (Raft Dedicated Server) is community software from RaftModding, and
  self-hosting it is gated behind a paid patron tier. Community server software
  tracking a game it does not control is the most likely of the three to break on
  a game update, and the most likely to be console-driven.

**The precondition is not "we like the game", it is "the game has a dedicated
server process on a machine we control."** That is what an agent is welded to. A
game with peer-hosted co-op has no such process — the host *is* somebody's game
client, which starts when they press play and dies when they quit. There is
nothing to start, nothing to stop gracefully, and no world on our box to save. The
right answer there is not a fourth kind of component that reaches into a player's
client; it is to wait.

**Subnautica 2 — deferred on exactly that.** Early Access from 2026-05-14 is
peer-hosted co-op: no standalone server binary, no server AppID on SteamCMD, no
address to connect to. Official dedicated-server support is on the Early Access
roadmap with no date, and that Early Access is expected to run two to three years.
**Trigger:** Unknown Worlds ship a dedicated server binary. On that day it is a
row — another agent on another port — and nothing here changes.

**What the second adapter will actually cost** is not the row, it is discovering
what the interface assumed. Palworld gave two things away free: a REST API you can
ask for state at any moment, and a control channel that needs no handle on the
process. An adapter driven by a console on stdin has neither — `running` stops
being derivable, and holding stdin collides with spawning detached (which exists
so restarting the agent never kills the game server) and with the contract's
no-state-between-requests rule. That is the real work, and the second adapter is
where it should be paid, not now.

### Announcements via `snackbyte-discord`
Reveille could post to that hub as an inbound webhook source — adding one is
near-zero effort by its own design — so "server up" and "world saved, stopped"
land in a channel without Reveille building routing. Purely additive, any time.

The reverse direction doesn't exist: that hub *"calls out to Discord's API and
webhooks exclusively"* and *"does not integrate with arbitrary external
services,"* and it couldn't reach a home LAN from Cloud Run anyway. See
[decision 006](DECISIONS.md).

### Hardware control
Sensors, fan curves, undervolt. Nobody asked for it. If it's ever wanted it comes
back as a **stated problem** in [00-problem.md](00-problem.md) first, before it
appears in any design. An earlier draft grew it anyway, on the reasoning that it
shares a lifecycle with game control — but what it shares is a *machine*, which is
the weakest possible justification for sharing a program.
