# Reveille

**On-demand control plane for self-hosted game servers.** Start and stop a
dedicated game server from Discord, on a machine that would otherwise sit idle —
built so that machine can later sleep and be woken on demand, with no rewrite.

Palworld is the first target. Nothing is Palworld-specific except one adapter.

> *Reveille — the bugle call that wakes the troops.*

---

## Three components, each welded to something

| Component | Welded to | Count | Runs |
|---|---|---|---|
| **Orchestrator** | nothing | exactly 1 | wherever is always-on. Decides *when* |
| **Agent** | a game server process | 1 per server | on that server's machine. Knows *how* |
| **Emitter** | a network | 1 per LAN | anywhere on it. Wakes sleeping machines |

Ask *"what is it welded to?"* and every placement question answers itself. The
orchestrator is the only component that ever relocates; actuators multiply
instead. They talk over a network API — always, even while sharing a box, because
they are separate processes by definition rather than by phase.

Growth is **more rows, never new kinds**: a second game is an agent, a second
machine is an agent plus a MAC address in config, a second network is an emitter.

## Status

**Nothing is built.** The architecture is settled; the code isn't started.

Next up is **M0** — install the Palworld dedicated server and go play, with zero
Reveille code. It doubles as the measurement phase: session length, reconnect
frequency, cold-start duration, and memory growth all decide things that would
otherwise be guessed at.

Then **M1** — `contract/`, `agent/`, `orchestrator/`, and `/start` from a phone.

## Documentation

Start with [`initial-architecture/`](initial-architecture/). If you read one page,
read [`01-decide-now.md`](initial-architecture/01-decide-now.md) — the six choices
that are expensive or impossible to reverse.

| | |
|---|---|
| [00-problem.md](initial-architecture/00-problem.md) | The only document that states requirements |
| [01-decide-now.md](initial-architecture/01-decide-now.md) | Six irreversible decisions |
| [02-the-minimum.md](initial-architecture/02-the-minimum.md) | Exactly what gets built to start playing |
| [03-deferred.md](initial-architecture/03-deferred.md) | Everything consciously **not** built, and why |
| [DECISIONS.md](initial-architecture/DECISIONS.md) | Append-only log. The only permanent document |

## Stack

TypeScript on Node 24, one package per component, one repository. Spec-driven via
[Spec Kit](https://spec-kit.org).

## The test the design has to pass

> Build the minimum, play for a year, then add auto-stop, a second game, another
> machine, and Wake-on-LAN — and never edit a file written in the first week.

Its sharper form: **if adding a capability needs a new *kind* of thing rather than
a new *row*, something was drawn wrong.**

## License

MIT
