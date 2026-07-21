# Problem

*The only document that states requirements. Everything else exists to serve
what's on this page — if a decision elsewhere can't be traced back to here, it's
decoration.*

---

## Who and what

Two people — the owner and Noah — want to play Palworld together on a dedicated
server hosted on a gaming PC at home.

**Two is the starting roster, not the design target.** Nothing assumes a headcount
of two; the system serves a small private group of **N** players.

## Constraints

- The world should **not** run 24/7. Up only when someone's playing.
- **Either** person, from **any** device, should be able to bring it up — through
  Discord.
- **Early on, stopping is a human's job, and that is not a compromise.** Either
  person turns it on; either person turns it off. If we forget, or stop it while
  the other was about to play, or leave it up overnight — *oh well.* The
  constraint above is already satisfied by two people who can both reach a stop
  button from anywhere.
- **The world save must survive every stop this system causes.** This system's job
  is shutting servers down unattended, with nobody watching — it manufactures the
  exact conditions that lose worlds. Every stop it issues must be graceful, and a
  stop it cannot perform gracefully is a stop it must refuse and report.
- The host is a gaming PC that is rarely used for work and almost always sits
  idle. Keeping it always on is fine for now.

## Direction

Not requirements yet, but the shape the system grows into. Recorded here because
they're the reason the architecture is split the way it is.

- **This generalizes over targets.** The Palworld server on the gaming PC is the
  first controlled thing, not the only one. The natural progression is *something
  that starts `<insert computer>`* — which is what makes Wake-on-LAN interesting,
  and what justifies the architecture even if WoL never ships.

  The unit is the **server**, not the machine: one actuator per controlled server,
  wherever that server runs. A second game on the same PC and a server on a
  different box are the same operation.
- **This generalizes over games.** Palworld is the first target. Nothing should be
  Palworld-specific except the adapter that talks to its server process.
- **Stopping on its own** — when the last player logs off — is the eventual want.
  A convenience that removes a small chore, worth building once the chore has
  annoyed us.
- **Existing Discord infrastructure may be reused.**
  `jeff-fichtner/snackbyte-discord` already runs always-on and routes webhooks to
  channels. Reveille might post to it for announcements rather than rebuilding
  that. **An option, not a requirement** — nothing here asks the two systems to
  merge.

## What is *not* asked for

Recorded explicitly, because earlier drafts grew some of it anyway.

- **Hardware control** — sensors, fan curves, undervolt. If it's ever wanted, it
  comes back *here* first, as a stated problem, before it appears in any design.
- **Multi-tenant, multi-world, or public hosting.** One world, one private group.
  The roster grows; the tenancy doesn't.
- **Uptime guarantees.** Nobody gets paged. The worst realistic *availability*
  failure is "we play something else tonight."

  **Availability is disposable; durability is not.** The two are easy to conflate
  and they pull in opposite directions — a system relaxed about being down must
  not be equally relaxed about shutting down.

## The success condition

**Two people play Palworld together, from anywhere, without touching the PC.**

It's met the first time either person types `/start` on a phone and joins.
[02-the-minimum.md](02-the-minimum.md) is the shortest path to exactly that.
