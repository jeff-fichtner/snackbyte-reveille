/**
 * `reveille` — the local operator console (008).
 *
 * **Not a component** (DECISIONS 025). All three component kinds run when nobody is
 * watching; this is a one-shot process started by a human standing right there, and it
 * exits. The rule that keeps that true is enforced throughout this file: no state between
 * invocations, no background poller, no watcher that survives the terminal, nothing
 * scheduled. `reveille start` blocks in the **foreground** and always terminates.
 *
 * Two namespaces, one word apart: **bare verbs act on targets**, `plane` verbs act on
 * the control plane's own processes. The bare half is derived from `buildCommandGroups`, so it
 * cannot offer a command Discord lacks or describe one differently.
 *
 * Talks **straight to the agents**. The orchestrator is never in the path — it has no
 * inbound port, and putting it there would break the property that most justifies a local
 * console: this keeps working when Discord or the bot is down.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { AgentClient } from '../agent-client.ts';
import { parseTenants, requiredPositiveInt, type ControlledServer } from '../config.ts';
import {
  buildCommandGroups,
  describeCommandList,
  runAddress,
  runPause,
  runResume,
  runSeek,
  runStart,
  runStatus,
  runStep,
  runStop,
  titleCase,
  NO_MEDIA_TARGET,
  DEFAULT_SEEK_SECONDS,
  type CommandOutcome,
  type ServerStatus,
} from '../commands.ts';
import { buildTargetMap, resolveMediaTarget, type ConsoleTarget } from './targets.ts';
import { buildConsoleCommands, parseArgv, type Invocation, type PlaneVerb } from './surface.ts';
import { printReply, printUsage, renderReply } from './render.ts';
import { discoverServices, findServiceProcesses, planeDown, planeStatus, planeUp, type PlaneService, type ServiceOutcome } from './plane.ts';
import { logPath, mergedTail, previousLogPath } from './logs.ts';

/**
 * Exit codes (`contracts/console-surface.md` §5).
 *
 * `1` is deliberately **unused**: Node exits `1` on an unhandled crash, so leaving it free
 * means a crash can never be mistaken for a meaningful outcome. `64` is `EX_USAGE` from
 * `sysexits.h` — misuse of the command is distinct from any outcome the system reported.
 *
 * `REFUSED` and `UNREACHABLE` must never collapse together: a caller may sensibly retry an
 * unreachable agent and must never retry a refusal.
 */
export const EXIT = {
  OK: 0,
  /** Reached the target; the command did not take effect. Retrying will not change that. */
  REFUSED: 2,
  /** The agent did not answer at all. A retry is reasonable. */
  UNREACHABLE: 3,
  /** The command was misused. Nothing was contacted. */
  USAGE: 64,
} as const;

/** The repository root, a fixed offset from this module — no parent-walking, no marker file. */
export function repoRootFrom(moduleUrl: string): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), '..', '..', '..');
}

/**
 * Which exit code an outcome deserves.
 *
 * Keyed off what actually happened rather than the tone alone, so the retry semantics in the
 * contract are real: transport failure is `UNREACHABLE`, and anything the target reached but
 * did not do is `REFUSED`.
 */
export function exitCodeFor(outcome: CommandOutcome): number {
  if (outcome.result !== undefined && !outcome.result.reached) return EXIT.UNREACHABLE;
  // A fold reports each target independently; the command itself succeeded in reporting.
  if (outcome.statuses !== undefined) return EXIT.OK;
  return outcome.reply.tone === 'ok' || outcome.reply.tone === 'progress' ? EXIT.OK : EXIT.REFUSED;
}

/** Everything one invocation needs, built fresh and dropped when the process exits. */
interface Console {
  readonly repoRoot: string;
  readonly targets: Map<string, ConsoleTarget>;
  readonly agents: Map<string, AgentClient>;
  readonly ports: Map<string, number>;
  readonly servers: ControlledServer[];
  readonly media: ConsoleTarget | undefined;
  readonly watchMs: number;
}

function build(repoRoot: string, env: NodeJS.ProcessEnv): Console {
  const targets = buildTargetMap(env);
  const servers: ControlledServer[] = [...targets.values()].map((t) => {
    if (t.kind !== 'game') return { name: t.name, baseUrl: t.baseUrl, kind: 'media' };
    if (t.publicPort === undefined) {
      // `?? 0` here would be a silent default of the exact shape this repository forbids:
      // a game with no public port would answer `address` with `…:0` and the mistake would
      // surface later, as a connect string nobody can use. `parseTenants` already rejects
      // that shape, so this cannot fire — which is precisely why it must throw rather than
      // paper over the case, if it ever does.
      throw new Error(
        `Target ${JSON.stringify(t.name)} is a game but has no public port. ` +
          `TENANTS should have rejected this — do not run the console against a hand-edited map.`,
      );
    }
    return { name: t.name, baseUrl: t.baseUrl, kind: 'game', publicPort: t.publicPort };
  });

  return {
    repoRoot,
    targets,
    agents: new Map([...targets.values()].map((t) => [t.name, new AgentClient(t.baseUrl)])),
    ports: new Map(
      [...targets.values()]
        .filter((t) => t.publicPort !== undefined)
        .map((t) => [t.name, t.publicPort as number]),
    ),
    servers,
    media: resolveMediaTarget(targets),
    // The SAME bound Discord's follow-up uses — one product decision, not two. An impatient
    // operator has Ctrl-C, which does not cancel the launch (FR-019).
    watchMs: requiredPositiveInt('FOLLOWUP_TIMEOUT_MS', env),
  };
}

/** Run one target verb through the shared cores. Decides nothing itself. */
async function runTarget(
  ctx: Console,
  verb: string,
  targetName: string | undefined,
  amount: number | undefined,
): Promise<CommandOutcome | { usage: string }> {
  if (verb === 'status') return runStatus(ctx.agents);
  if (verb === 'address' && targetName !== undefined) return runAddress(ctx.ports, targetName);
  if (targetName !== undefined) {
    switch (verb) {
      case 'start':
        return runStart(ctx.agents, targetName);
      case 'stop':
        return runStop(ctx.agents, targetName);
      default:
        return { usage: `\`reveille ${verb}\` does not take a target.` };
    }
  }

  // Bare media verbs act on the tenant's one media player.
  if (ctx.media === undefined) return { usage: NO_MEDIA_TARGET };
  const name = ctx.media.name;
  switch (verb) {
    case 'pause':
      return runPause(ctx.agents, name);
    case 'play':
      return runResume(ctx.agents, name);
    case 'next':
    case 'previous':
      return runStep(ctx.agents, name, verb, amount);
    case 'forward':
      return runSeek(ctx.agents, name, amount ?? DEFAULT_SEEK_SECONDS);
    case 'back':
      // `/back` negates, so `back -30` seeks FORWARD — the amount passes through exactly as
      // given and the reply states the direction actually taken (005 FR-005).
      return runSeek(ctx.agents, name, -(amount ?? DEFAULT_SEEK_SECONDS));
    default:
      return { usage: `\`reveille ${verb}\` is not something this host can do.` };
  }
}

/**
 * Watch a just-issued start until the target is running, or the bound expires (FR-018).
 *
 * **Foreground, always terminating, never detached.** This is the same watching Discord's
 * follow-up does, with the opposite lifetime: the member walked away, the operator is here.
 * Ctrl-C ends the watching and, by FR-019, not the launch.
 */
async function watchUntilRunning(ctx: Console, name: string): Promise<number> {
  const agent = ctx.agents.get(name);
  if (agent === undefined) return EXIT.USAGE;

  const deadline = Date.now() + ctx.watchMs;
  let interrupted = false;
  const onInterrupt = (): void => {
    interrupted = true;
  };
  process.once('SIGINT', onInterrupt);

  try {
    while (Date.now() < deadline && !interrupted) {
      const result = await agent.status();
      if (result.reached && result.status === 200 && result.body.state === 'running') {
        process.stdout.write(`${titleCase(name)} is up.\n`);
        return EXIT.OK;
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
  } finally {
    process.off('SIGINT', onInterrupt);
  }

  if (interrupted) {
    // The launch already happened; only the watching stopped. Saying so is the whole point —
    // an operator who thinks they cancelled it will go looking for a server that is coming up.
    process.stdout.write('Stopped watching. The launch was already issued and is unaffected.\n');
    return EXIT.OK;
  }
  process.stdout.write(`Could not confirm ${titleCase(name)} came up within the bound. Try \`reveille status\`.\n`);
  return EXIT.REFUSED;
}

/**
 * The FR-025 addition: when a target is unreachable, say whether its **agent process** is
 * running. The one question only the local vantage point can answer — an "unreachable" line
 * that cannot distinguish "the player is closed" from "the agent is not running" wastes the
 * whole advantage of being local. A reachable target reads exactly as Discord reports it.
 */
export function buildAgentNotes(
  statuses: readonly ServerStatus[] | undefined,
  targets: ReadonlyMap<string, ConsoleTarget>,
  services: readonly PlaneService[],
  running: ReadonlyMap<string, readonly unknown[]>,
): string[] {
  // A reachable target reads exactly as Discord reports it — this fires only on the failure.
  const unreachable = (statuses ?? []).filter((s) => !s.result.reached || s.result.status !== 200);

  return unreachable.map((s) => {
    const target = targets.get(s.name);
    const port = target === undefined ? undefined : Number(new URL(target.baseUrl).port);
    const service = services.find((sv) => sv.port === port);
    if (service === undefined) return `  ${titleCase(s.name)}: no agent process is configured on this host`;
    return (running.get(service.label) ?? []).length > 0
      ? `  ${titleCase(s.name)}: its agent (${service.label}) IS running — the target itself is not answering`
      : `  ${titleCase(s.name)}: its agent (${service.label}) is NOT running — \`reveille plane up ${service.label}\``;
  });
}

async function agentProcessNotes(ctx: Console, outcome: CommandOutcome): Promise<string[]> {
  if ((outcome.statuses ?? []).every((s) => s.result.reached && s.result.status === 200)) return [];
  const services = discoverServices(ctx.repoRoot);
  return buildAgentNotes(outcome.statuses, ctx.targets, services, await findServiceProcesses(services));
}

/** How a plane outcome reads. Worded so a service being up is never read as a target being up (FR-024). */
function renderPlane(verb: PlaneVerb, outcomes: readonly ServiceOutcome[]): string {
  const lines = outcomes.map((o) => {
    const detail = o.detail === undefined ? '' : `  ${o.detail}`;
    return `  ${o.label.padEnd(20)} ${o.state.padEnd(8)}${detail}`;
  });
  // The heading is load-bearing: it answers whether the control plane's own processes are
  // running, which is a different question from "is the game running" and must never be
  // mistaken for it. The printed wording stays "Reveille" — it is read by the operator.
  return [`Reveille processes (not the game servers or the player) — plane ${verb}:`, ...lines].join('\n');
}

function selectServices(all: readonly PlaneService[], name: string | undefined): PlaneService[] | string {
  if (name === undefined) return [...all];
  const one = all.find((s) => s.label === name);
  return one === undefined
    ? `Unknown service \`${name}\`. Try: ${all.map((s) => `\`${s.label}\``).join(', ')}.`
    : [one];
}

async function runPlane(ctx: Console, verb: PlaneVerb, name: string | undefined): Promise<number> {
  const all = discoverServices(ctx.repoRoot);
  const selected = selectServices(all, name);
  if (typeof selected === 'string') {
    printUsage(selected);
    return EXIT.USAGE;
  }

  if (verb === 'logs') {
    // The merged view is what replaces the four windows; the paths follow it so a longer
    // look with another tool is one copy-paste away.
    process.stdout.write(`${mergedTail(ctx.repoRoot, selected.map((s) => s.label))}\n`);
    process.stdout.write('\nfiles:\n');
    for (const service of selected) {
      process.stdout.write(`  ${logPath(ctx.repoRoot, service.label)}\n`);
      process.stdout.write(`  ${previousLogPath(ctx.repoRoot, service.label)}  (previous run)\n`);
    }
    return EXIT.OK;
  }

  let outcomes: ServiceOutcome[];
  if (verb === 'status') {
    outcomes = await planeStatus(selected);
  } else if (verb === 'down') {
    outcomes = await planeDown(selected);
  } else if (verb === 'up') {
    outcomes = await planeUp(selected, ctx.repoRoot);
  } else {
    await planeDown(selected);
    await new Promise((r) => setTimeout(r, 1_000));
    outcomes = await planeUp(selected, ctx.repoRoot);
  }

  process.stdout.write(`${renderPlane(verb, outcomes)}\n`);
  // The worst service decides the code, so a script cannot read "mostly up" as success.
  // `foreign` counts: the plane is not in the state that was asked for — a port is being
  // served by something this console neither started nor can stop — and exiting 0 on that
  // is the same silent success the state exists to expose.
  return outcomes.some((o) => o.state === 'failed' || o.state === 'foreign') ? EXIT.REFUSED : EXIT.OK;
}

/** Dispatch one invocation. Returns the exit code; never calls `process.exit` itself. */
export async function dispatch(ctx: Console, invocation: Invocation): Promise<number> {
  if (invocation.kind === 'usage') {
    printUsage(invocation.message);
    return EXIT.USAGE;
  }

  if (invocation.kind === 'help') {
    // Contacts nothing — the same listing Discord's `/help` renders, from the same groups.
    process.stdout.write(`${renderReply(describeCommandList(buildCommandGroups(ctx.servers)))}\n`);
    return EXIT.OK;
  }

  if (invocation.kind === 'plane') return runPlane(ctx, invocation.verb, invocation.service);

  const outcome = await runTarget(ctx, invocation.verb, invocation.targetName, invocation.amount);
  if ('usage' in outcome) {
    printUsage(outcome.usage);
    return EXIT.USAGE;
  }

  const target = outcome.serverName === undefined ? undefined : ctx.targets.get(outcome.serverName);
  printReply(outcome.reply, {
    serverName: outcome.serverName,
    agentUrl: target?.baseUrl,
  });

  // FR-025 — the local-only half of a status read.
  for (const note of await agentProcessNotes(ctx, outcome)) process.stdout.write(`${note}\n`);

  // A launch that actually happened is watched in the foreground until it is up (FR-018).
  if (invocation.verb === 'start' && outcome.result?.reached === true && outcome.result.status === 202) {
    return watchUntilRunning(ctx, invocation.targetName as string);
  }

  return exitCodeFor(outcome);
}

/** The entry point. Everything above is testable without it. */
export async function main(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  const repoRoot = repoRootFrom(import.meta.url);
  // A bare `reveille` and `reveille help` must work even before the surface is known, but
  // both need the target set to render, so configuration is read first and fails loud.
  const ctx = build(repoRoot, env);
  const commands = buildConsoleCommands(ctx.servers);
  return dispatch(ctx, parseArgv(argv, commands));
}

// Run only when invoked directly, so the tests can import the pieces above. Compared as
// resolved paths rather than by filename, which would also fire for any other index.ts.
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exitCode = await main(process.argv.slice(2), process.env);
  } catch (error: unknown) {
    // Configuration failures land here and must name themselves — never a stack trace with
    // the environment in it (the repository is public and the bot token is in scope).
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = EXIT.USAGE;
  }
}

export { parseTenants };
