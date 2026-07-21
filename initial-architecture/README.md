# Initial architecture

On-demand control plane for self-hosted game servers. Lets a small group start and
stop a dedicated game server (Palworld first) from Discord, on a machine that
would otherwise sit idle.

---

## The shape of it, in one paragraph

**Three components, each welded to something.** An **agent** is welded to a game
server process — same machine as that process, always, because a thing that
actuates a machine has to be on it. An **emitter** is welded to a network, and
wakes sleeping machines on it. The **orchestrator** is welded to nothing: it
decides *when*, runs wherever is always on, and is the only component that
relocates. Actuators multiply instead of moving. Everything talks over a network
API — always, even while sharing a box, because these are separate processes by
definition rather than by phase.

Today that's one orchestrator and one agent, both on the gaming PC, and no emitter
at all. That's what N=1 looks like, not a compromise.

---

## Read in this order

| | | |
|---|---|---|
| 1 | [00-problem.md](00-problem.md) | **The only document that states requirements.** Everything else serves it. |
| 2 | [01-decide-now.md](01-decide-now.md) | **The document.** Six choices that are expensive or impossible to reverse. |
| 3 | [02-the-minimum.md](02-the-minimum.md) | Exactly what gets built to start playing. Nothing else. |
| 4 | [03-deferred.md](03-deferred.md) | Everything consciously **not** built, and why. |
| — | [DECISIONS.md](DECISIONS.md) | Append-only. **The only permanent document here.** |

Four pages plus the log. If you read only one, read `01`.

## Lifecycles

- **`00`–`03` are consumed.** `01` empties as its contents graduate to
  `DECISIONS.md`; `02` burns down as milestones complete; `03` shrinks as
  questions close. Argue with all of them freely.
- **`DECISIONS.md` is permanent and append-only.** It is the only survivor.

> **Write the DECISIONS entry before deleting whatever motivated it.** These pages
> hold reasoning; the log holds conclusions. Delete in the wrong order and you're
> left with choices nobody can explain — which is exactly how a settled decision
> gets relitigated eighteen months later.

## The test everything here has to pass

> **Build the minimum, play for a year, then add auto-stop, a second game, another
> machine, and Wake-on-LAN — and never edit a file you wrote in the first week.**

Its sharper form: **if adding a capability needs a new *kind* of thing rather than
a new *row*, something was drawn wrong.** The three components above are the
complete set; the system never gains a fourth.

If something in `01` isn't required by that test, it belongs in `03`. If something
in `03` turns out to be required by it, that's a mistake worth a post-mortem.

## Where things stand

Nothing is built. There is no git repository yet — **worth fixing before the first
line of code.**

The next step is **M0**: install the Palworld server and go play, with zero code,
because it doubles as the measurement phase that answers several deferred
questions for free. Then **M1** builds the orchestrator and one agent, both on the
always-on gaming PC.

## A note on this folder's history

These pages replaced a larger set that argued with its own earlier drafts in
public. The corrections that mattered are now decisions in
[DECISIONS.md](DECISIONS.md) with their reasoning; the arguments themselves are
gone. Two are worth knowing about because they were confidently wrong for a long
time:

- The architecture was organized around **Wake-on-LAN**, a milestone the plan
  itself marked optional. It's now organized around **three components welded to
  the things they act on**, which is true whether or not WoL ever ships — and
  which demoted WoL to one deployment of one of those components.
- *"This should fold into the owner's existing Discord bot"* was recorded as a
  requirement for several drafts. **It was never asked for** — an inference from an
  offhand mention that then propagated everywhere.
