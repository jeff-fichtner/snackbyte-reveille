# Contract: the console surface

**Feature**: 008-local-console · **Date**: 2026-08-10

The console's interface to its one human. **This is not a network contract** — the seam
(`contract/src/index.ts`) is untouched by this feature, at v5, with the same eight verbs.
What follows is the command surface, its outputs, and its exit codes.

The governing rule: **the target half of this surface is a derivation, not a declaration.**
It is generated from `buildCommandGroups`, the same value Discord registration is built from.
Nothing below may be hand-written into the console — if a row here disagrees with what
`buildCommandGroups` produces, this document is wrong and the code is right.

---

## 1. Two namespaces, one word apart

| | Object | Form |
|---|---|---|
| **Target verbs** | the controlled thing — a game server, the media player | bare: `reveille <verb> [target] [args]` |
| **Plane verbs** | the Reveille processes on this host | prefixed: `reveille plane <verb> [service]` |

Bare verbs go to targets because they are typed daily and must mirror Discord one-for-one.
`up`/`down` are used rather than `plane start`/`plane stop` so the collision with the target
verbs is gone at the level of the **word**, not resolved by counting arguments.

## 2. Target commands — derived, never authored

Generated from `buildCommandGroups(union of every tenant's targets)`. Present only when the
tenant set contains a target of the matching kind, exactly as Discord registration is.

| Form | Derived from | Notes |
|---|---|---|
| `reveille start <game>` | `start` + its subcommands | Watches in the foreground until running or the bound expires. |
| `reveille stop <game>` | `stop` + its subcommands | The agent's graceful stop. No force path exists to reach. |
| `reveille address <game>` | `address` + its subcommands | Public IP lookup + that target's `publicPort`. |
| `reveille pause` | `pause` | Bare — one media target. |
| `reveille play` | `play` | Bare. |
| `reveille next [count]` | `next` | Signed; a negative swaps direction (005/007). |
| `reveille previous [count]` | `previous` | Signed. |
| `reveille forward [seconds]` | `forward` | Defaults to `DEFAULT_SEEK_SECONDS`. |
| `reveille back [seconds]` | `back` | Negates, so `back -30` seeks forward. |
| `reveille status` | `status` | Every target in the union. |
| `reveille help` | `help` | The listing. Contacts nothing. |

**Invariants.**
- A command absent from `buildCommandGroups` MUST NOT be runnable (FR-006).
- A command present there MUST be runnable, without a second list being edited (SC-004).
- Descriptions in `reveille help` are copied verbatim; none is authored here (FR-005).
- Argument shapes match Discord's — no console-only flag is added to a mirrored command.
- `reveille` with no arguments renders the same listing as `reveille help` (FR-004).

**Argument semantics are inherited, not restated.** Signed magnitudes, the 30-second default,
the direction-from-sign rule, and the unbounded count are 005/007 behaviour reached through
the shared `runX` cores. The console applies no clamp, no bound, and no conversion of its own.

## 3. Plane commands — authored here, because they mirror nothing

| Form | Effect |
|---|---|
| `reveille plane up [service]` | Start services that are down; **verify each is serving**; report per service. |
| `reveille plane down [service]` | Stop Reveille's own processes. Touches no controlled target. |
| `reveille plane restart [service]` | `down` then `up`, scoped the same way. |
| `reveille plane status [service]` | Up/down per service, worded so it cannot be mistaken for target state. |
| `reveille plane logs [service]` | Merged, followable view of the services' output. |

Omitting `service` means all services (FR-007).

## 4. Output shape

Every target command prints, in order:

```
<reply.text>                  the sentence a member would read
<reply.footnote>              when present
<reply.diagnostic>            when present — status code, errno, target error text
via <agent base URL>          which agent answered
```

The first two lines are exactly what Discord shows. The last two are the operator's, and are
what makes this a tool rather than a second chat client. `diagnostic` already exists on
`Reply` (007) and is never rendered by `toEmbed`, so displaying it here changes nothing a
member sees.

**`status` output** carries one addition over Discord's (FR-025): an **unreachable** target
also reports whether its agent process is running. A reachable target reads identically to
Discord's line.

**`status` and `plane status` must not be confusable (FR-024).** They answer different
questions about different objects, and the case that matters is the one where their answers
**differ** — agent up, game stopped. Each must name its object in its own output, so a service
being up can never be read as its target being up. This is the output-shape half of the
namespace split in §1: separating the *verbs* is not enough if the *answers* still look alike.

**Forbidden in all output.** The console MUST NOT print its environment, echo configuration,
or include `process.env` in a diagnostic. It loads `orchestrator/.env`, so `DISCORD_BOT_TOKEN`
is in memory and the repository is public.

## 5. Exit codes

| Code | Meaning | Retry? |
|---|---|---|
| `0` | Success — acted, or already in the asked-for state | — |
| `2` | Refused by the target — already running, nothing loaded | **Never.** The answer will not change. |
| `3` | Agent unreachable — no answer over the seam | Reasonable. |
| `64` | Usage error — unknown target, missing name, bad argument, ambiguous verb | No; fix the command. |

`1` is deliberately **unused**, so an unhandled crash (which Node exits `1` for) is never
mistaken for a meaningful outcome.

`2` and `3` MUST NOT be merged (clarification, 2026-08-10): a caller may reasonably retry an
unreachable agent and must never retry a refusal. These four map onto branches the reply
functions already make — a 200/202 outcome, a 409 refusal, a transport failure, an unknown
name — so the codes render an existing distinction rather than inventing a parallel one.

For `plane up`, the code reflects the **worst** service outcome: `0` only if every requested
service is serving.

## 6. Lifetime — the contract that keeps this from being a component

Binding on every command:

- **Terminates.** No command waits without bound; `reveille start` is bounded by
  `FOLLOWUP_TIMEOUT_MS`, so an exit code always arrives (FR-018).
- **Leaves nothing of its own.** No state file, no memo, no cache, no background process
  (FR-016, FR-017). The services `plane up` launches are pre-existing components, not the
  console's children in any ownership sense.
- **Interruptible without consequence.** Ctrl-C during a watch stops the watching, never the
  launch, and the console says so before exiting (FR-019).
- **Never scheduled.** No daemon mode, no `--watch`, no polling on any schedule of its own
  (FR-020).

A future change that violates any of these has made a second unattended thing able to start
and stop targets, which is the "ownership of recovery" fight recorded in `03-deferred.md`.
That change is an architecture change and needs its own `DECISIONS.md` entry.
