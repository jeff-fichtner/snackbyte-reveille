# Decide now

> **The document.** Everything here is expensive or impossible to reverse.
> Everything *not* here is deliberately unanswered — see
> [03-deferred.md](03-deferred.md).

The test this page has to pass:

> **You build [the minimum](02-the-minimum.md), play for a year, then add
> auto-stop, a second game, another machine, and Wake-on-LAN — and never edit a
> file you wrote in the first week.**

Six decisions. Each is in [DECISIONS.md](DECISIONS.md) with full reasoning; this
page is the working summary and the *why it can't wait*.

---

# 1 · Three components, each welded to something · `001` `007` `008`

**The foundation. Everything else on this page follows from it.**

| Component | Welded to | Count | Lives | Exists |
|---|---|---|---|---|
| **Orchestrator** | nothing | exactly 1 | anywhere always-on | **now** |
| **Agent** | a game server process | 1 per server | with its server, always | **now** |
| **Emitter** | a broadcast domain | 1 per LAN | anywhere on that LAN | **later** |

The orchestrator decides *when*. Actuators — agents and emitters — do *how*, each
one deployed where the thing it acts on physically is.

Ask **"what is it welded to?"** and every placement question answers itself.

### The three rules that fall out

**The orchestrator relocates; actuators multiply.** Growth means more agents and
more emitters, never pieces of one splitting off. The orchestrator is the only
component that ever changes address, and it stays exactly one thing.

**The agent never leaves its server.** A process that actuates something on a
machine must be on that machine — otherwise it needs remote process control there,
which means software on that box, which is an agent. Both halves are pinned for
the same reason: the HTTP server must answer at the address identifying the
server, and the game adapter must be where the process is.

**The unit is the server, not the machine.** All four verbs — `start`, `stop`,
`status`, `players` — are server-scoped, and nothing the agent owns is
machine-level. Two games on one PC is **two agents on two ports**, not one agent
that routes. Machine-scoping would have forced `/servers/{id}/start` into the
contract the first time you ran Minecraft alongside Palworld, and a contract
change is the one thing you must never pay for.

Machines therefore live in **orchestrator config, never in the contract.** The
orchestrator knows which servers share a box; the agent never learns machines
exist. That grouping sits unused until Wake-on-LAN, which is precisely what needs
it.

### The second axis: games

One adapter per game, behind the same four verbs. Palworld is the first adapter,
and the **only** Palworld-aware code in the system:

```
orchestrator ──HTTP──► agent ──► adapter ──► Palworld server
   (generic)                   (game-specific)   (the thing)
```

Adding Minecraft swaps the adapter and gets its own agent on its own port.
Nothing to the left of that arrow changes.

### How this expands, in full

| Change | What happens |
|---|---|
| **Start** — PC always on | Orchestrator + agent, both on the PC. **No emitter** |
| **Add an always-on box** (same LAN) | Orchestrator **moves** there; emitter **appears** there. Agent **stays on the PC.** The PC may now sleep |
| **Add Minecraft on the PC** | Second agent, second port. Nothing else changes |
| **Add a machine on the same LAN** | Agent on that machine. **No new emitter** — add its MAC to config |
| **Add a machine on a different LAN** | Agent on that machine, **plus** an emitter on that LAN |

The trap this table exists to prevent: **the agent does not follow the
orchestrator** to the always-on box. It is welded to the game server, which never
left the PC.

### What it does *not* commit you to

Building for two of anything. N=1 for as long as you like. It commits you to not
writing `theOnlyPC` anywhere.

**The emitter does not exist yet and shouldn't** — nothing sleeps at M1, so there
is nothing to wake. Knowing about it is **not a licence to prepare for it**: no
placeholder module, no reserved directory. An earlier draft reserved an empty
`power/` folder so the WoL phase would be "fill this in." That looks like
foresight and isn't. What makes the emitter cheap later is the seam holding its
shape, not a folder sitting there looking ready.

---

# 2 · The seam is a network call, always · `002`

Orchestrator → actuator, over HTTP, including while both run on the same box.
Never in-process. Actuators never call out.

**Why it can't wait:** this is the only genuinely irreversible thing on the page.
Every other decision here can be walked back over a weekend. Collapse this one and
you unpick every call site later.

**What it costs now:** about thirty lines and a port number.

**The rule that keeps it honest:** an agent's **URL is its identity.** No server or
machine ID in the contract, ever — you address a thing by talking to it. Adding
the second one is a config line, not a contract change.

**The acceptance test for the whole architecture:**

> **If adding a capability requires a new *kind* of thing rather than a new *row*,
> something was drawn wrong.**

A second game is a row. A second machine is a row. Wake-on-LAN is a column on the
machine row (a MAC address) plus deploying the emitter. **The three kinds in
decision 1 are the complete set** — the system never gains a fourth.

---

# 3 · One repo, `snackbyte-reveille` · `003`

```
snackbyte-reveille/
├── contract/         # the seam, defined once. one file at first.
├── agent/            # 1 per controlled server · runs on Windows
└── orchestrator/     # exactly 1 · runs on Linux
                      # emitter/ arrives only when something is allowed to sleep
```

Two packages plus the contract. The emitter is a **fourth package when it exists**
and is not created before then — see the anti-preparation note in decision 1.

**Why it can't wait:** less than it seems. Given decision 2, splitting this into
several repos later is moving a directory. It's on this page because you asked for
it to be right, and the answer is *"one"* — but it is the softest item here.

---

# 4 · TypeScript/Node, every package · `005`

Not C#/.NET for the agent. That was inherited from a draft that wanted
driver-level hardware access, which is out of scope.

**Why it can't wait:** language is a rewrite, not a refactor. And a shared contract
*type* across packages only exists if they speak the same language — which is most
of what makes decision 2 cheap.

---

# 5 · Not `snackbyte-base` · `004`

It's a Vite + React app template targeting Cloud Run. Reveille has no web UI, and
none of its components can run on Cloud Run — actuators must be physically present,
and Cloud Run can never emit a WoL packet. Copy the `tsconfig`, ESLint config, and
npm scripts by hand; leave the deploy spine.

**Why it can't wait:** cheap now, miserable later. Scaffolding gets load-bearing
fast — a `Dockerfile` and a `cloudbuild.yaml` you never wanted are hard to remove
once CI depends on them.

---

# 6 · Reveille runs its own Discord bot · `006`

`snackbyte-discord` is not merged into and does not relay commands. It stays
available as an announcement target, later, if wanted.

**Why it can't wait:** it decides whether the orchestrator owns a gateway
connection, which shapes what the orchestrator *is*. It's also the decision most
likely to be relitigated from vague memory, so it's written down.

---

## The one behavioural rule that belongs on this page

**`stop` means *stop gracefully*.** Save, then exit. An adapter that cannot
guarantee that must **fail the call rather than kill the process.**

It's here rather than in [02-the-minimum.md](02-the-minimum.md) because it's a
*contract* obligation, not an implementation detail: every future adapter inherits
it. Palworld satisfies it free via RCON, which is exactly why it's worth stating
now — the next game may not, and discovering the obligation while writing the
second adapter is discovering it too late.

It exists because this system's job is shutting servers down with nobody watching.
Availability is disposable here; the world save isn't.

---

## What this page deliberately does not decide

Listed so their absence reads as a choice rather than an oversight. All of it is
additive, none is on the critical path to playing, and every item is in
[03-deferred.md](03-deferred.md) with its reason and trigger.

| | |
|---|---|
| Contract **format** | One hand-written file for two verbs. Codegen decides itself once presence lands. |
| Push versus poll | Nothing to push yet. |
| Auto-stop, presence, grace timers | A human typing `/stop` is a valid policy that happens to run on a human. |
| Durable state | The orchestrator holds nothing worth persisting yet. |
| Auth on the seam | Bind to the LAN and move on. |
| **The emitter** | Deferred as a *deployment*, not as an idea — decision 1 already fixes its shape. |
| Process supervision | Decided by what M0 teaches about how the server actually dies. |
| A second game | The adapter boundary exists so this stays cheap. Don't pay for it now. |
