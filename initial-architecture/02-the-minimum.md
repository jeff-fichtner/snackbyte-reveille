# The minimum

> **Living** — burned down as it completes. If this looks the same in six months,
> nothing happened.

Everything needed to play Palworld with Noah, started from Discord, and nothing
else. Two milestones. The second one is the only one with code in it.

**Two of the three components, on the always-on gaming PC:** an orchestrator and
one agent. No emitter — nothing sleeps yet, so there is nothing to wake.

The constraint that shapes every line below:

> **Build the least possible thing that gets you playing. Honor
> [the six decisions](01-decide-now.md) while doing it. Everything else earns its
> way in by annoying you first.**

---

## M0 · Play this weekend · **zero Reveille code**

Install the Palworld dedicated server on the PC. Configure the world, set a
password, sort out networking. Start it by double-clicking. Noah joins.

**You are now playing.** Everything after this is convenience.

This isn't a shortcut around the architecture, it's a prerequisite for it:

- **You cannot write an adapter for a thing you've never run.** M0 is where you
  learn what `stop` actually does, what RCON actually returns, and how long a cold
  start actually takes.
- **It's the measurement phase.** It answers, for free, several questions that
  would otherwise be guessed — see [03-deferred.md](03-deferred.md).

**Watch memory while you do it.** The host (`watson`, Ryzen 7 7700X / 32GB /
RTX 4060 Ti) runs the dedicated server *and* your game client, so the two share
31GB usable. That's comfortable at boot — server ~8GB, client ~8GB, Windows ~4GB
— but the memory leak in [03-deferred.md](03-deferred.md) hits harder here than on
a dedicated host, because a remote box would get all 32GB to itself.

The practical shape: leave the server up overnight, sit down the next day, and the
leak has eaten the headroom your client needs. The fix is `/stop` — which is what
M1 builds — and the cost of forgetting is a 90-second restart. An annoyance, not a
hazard, and exactly the kind that would later justify auto-stop on its own merits.

**Exit criteria:** two people have played a session. You know the start command,
the shutdown behaviour, roughly how long you play, and how much RAM the server
holds after a long one.

---

## M1 · Start it from Discord · **the first real code**

The smallest thing that satisfies *"either of us, from any device."*

### What gets built

| Package | Contents |
|---|---|
| **`contract/`** | One file. Two verbs: `start`, `stop`. Hand-written types, shared by both sides. |
| **`agent/`** | An HTTP server on the PC. `POST /start`, `POST /stop`. Launches and gracefully stops the Palworld process. Holds no state. |
| **`orchestrator/`** | A Discord bot. `/start` and `/stop` slash commands. Calls the agent over HTTP. Holds no state. |

That's the whole build — a few hundred lines across the three.

**Build them in this order**, because it front-loads the risk:

1. **`contract/`** — two request/response types. Ten minutes.
2. **`agent/`** — **all the risk lives here.** Does the Palworld server launch
   headlessly? Does RCON connect? Does save-and-shutdown do what the docs claim?
   None of that involves Discord, and you test it with `curl`:
   ```
   curl -X POST localhost:7777/start   →  Palworld comes up
   curl -X POST localhost:7777/stop    →  world saves, process exits
   ```
   When that works, nothing left can surprise you.
3. **`orchestrator/`** — Discord bot, two slash commands, one HTTP call each.
   Mostly registration boilerplate, near-zero logic, wired to something already
   proven.

Writing the agent while M0's lessons are fresh is cheaper than writing it from
notes.

### The four things you must not compromise

Everything else in M1 can be crude — hardcode it, poll it, keep it in memory.
Crude is reversible; these four are not:

1. **Two processes, talking over HTTP.** Even though they're on one machine.
2. **The agent's URL is its identity.** A config value, not a constant. No server
   or machine ID in the contract — one agent controls one server, and you address
   it by talking to it. Running Minecraft later is a *second agent on a second
   port*, not a routing change.
3. **`stop` saves first, or fails.** Never kill the process to satisfy the call.
4. **The orchestrator runs on Linux** — WSL2 on the same PC is fine and is the
   point: orchestrator-on-Linux calling agent-on-Windows is a real cross-OS
   network call, the same *shape* as controlling a second machine later, with both
   ends on one desk. Every local run tests the actual integration instead of a
   mock.

### Deliberately not built

State machine · persistence · presence tracking · grace timers · auto-stop ·
scheduler · Wake-on-LAN · health checks · code generation · retries · auth beyond
binding to the LAN.

### Where the human is the policy

There is no auto-stop, and that's correct rather than a gap. Either of you turns
it on; either of you turns it off. If you forget, or stop it while the other was
about to play, or leave it up overnight — *oh well.* Nothing is lost that matters.

**A human deciding to stop the server is a valid policy.** It just happens to run
on a human. Replacing that human is [deferred](03-deferred.md), and it's worth
doing only once the chore has actually annoyed you.

**Exit criteria:** either person types `/start` on their phone and joins ninety
seconds later.

---

## How you'll know the architecture held

Not at M1 — at whatever comes after it. The bet is:

- Adding **auto-stop** touches only the orchestrator, plus two new verbs.
- Adding a **second game or machine** is deploying another agent and adding an
  address. Identical operation either way.
- Adding **Wake-on-LAN** deploys the emitter and moves the orchestrator. The agent
  doesn't change, doesn't move, and the contract doesn't change.

Every one of those is **a new row, never a new kind of thing.** If any turns out
to require editing something written in the first week, the boundaries were drawn
wrong — and the post-mortem belongs in [DECISIONS.md](DECISIONS.md).
