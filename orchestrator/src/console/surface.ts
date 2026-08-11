/**
 * What the console can be asked to do, and how a command line becomes one of those asks.
 *
 * **The target half of this surface is derived, never authored** (008 FR-005, FR-006).
 * Every verb, every target name, and every argument comes from `buildCommandGroups` — the
 * same value Discord registration is built from (006). Nothing here writes a command name
 * or a description, so the console cannot offer a command Discord lacks, omit one it has,
 * or describe one differently.
 *
 * The `plane` half **is** authored here, because it mirrors nothing: those verbs act on
 * the control plane's own processes, which Discord has no concept of.
 */
import { buildCommandGroups, NO_MEDIA_TARGET } from '../commands.ts';
import type { ControlledServer } from '../config.ts';

/** One runnable target command, read off the registered builder. */
export interface ConsoleCommand {
  readonly name: string;
  readonly description: string;
  /** Subcommand names — the targets this verb must be given. Empty for a bare verb. */
  readonly targets: readonly string[];
  /** The single optional integer argument, where the command has one. */
  readonly option: { readonly name: string; readonly description: string } | undefined;
}

/** Discord's option type tags. Only the ones this system can encounter are named. */
const SUBCOMMAND_OPTION = 1;
const INTEGER_OPTION = 4;

interface RawOption {
  type: number;
  name: string;
  description: string;
  required?: boolean;
}

/** The `plane` verbs. Authored, because no Discord command corresponds to them. */
export const PLANE_VERBS = ['up', 'down', 'restart', 'status', 'logs'] as const;
export type PlaneVerb = (typeof PLANE_VERBS)[number];

function isPlaneVerb(value: string): value is PlaneVerb {
  return (PLANE_VERBS as readonly string[]).includes(value);
}

/**
 * The target commands available for this set of targets, keyed by verb.
 *
 * A pure re-reading of `buildCommandGroups`: it flattens and re-shapes, and decides nothing.
 */
export function buildConsoleCommands(
  servers: readonly ControlledServer[],
): Map<string, ConsoleCommand> {
  const commands = new Map<string, ConsoleCommand>();

  for (const group of buildCommandGroups(servers)) {
    for (const builder of group.commands) {
      const json = builder.toJSON() as { name: string; description: string; options?: RawOption[] };
      const options = json.options ?? [];
      const integer = options.find((o) => o.type === INTEGER_OPTION);

      commands.set(json.name, {
        name: json.name,
        description: json.description,
        targets: options.filter((o) => o.type === SUBCOMMAND_OPTION).map((o) => o.name),
        option:
          integer === undefined
            ? undefined
            : { name: integer.name, description: integer.description },
      });
    }
  }

  return commands;
}

/**
 * The media verbs, **derived rather than listed**.
 *
 * Needed so that `reveille pause` on a host with no media target can be refused in the
 * member's own terms instead of as an unknown word. Writing the list out would be the
 * second copy this whole feature exists to avoid — so instead the surface is built once
 * more against a synthetic media target, and the verbs that appear are the media verbs.
 * Add a media command to `buildCommandGroups` and it lands here for free.
 */
export function mediaVerbNames(): Set<string> {
  const synthetic: ControlledServer = {
    name: 'probe',
    baseUrl: 'http://127.0.0.1:1',
    kind: 'media',
  };
  const withMedia = buildCommandGroups([synthetic]);
  const group = withMedia.find((g) => g.label === 'Media');
  return new Set((group?.commands ?? []).map((c) => c.toJSON().name));
}

/** What a command line turned out to mean. */
export type Invocation =
  | {
      readonly kind: 'target';
      readonly verb: string;
      /** The target named, for a verb that takes one. */
      readonly targetName: string | undefined;
      /** The signed integer argument, when given. */
      readonly amount: number | undefined;
    }
  | { readonly kind: 'plane'; readonly verb: PlaneVerb; readonly service: string | undefined }
  | { readonly kind: 'help' }
  /** Misuse. Never acts on anything; the caller exits with the usage code. */
  | { readonly kind: 'usage'; readonly message: string };

const usage = (message: string): Invocation => ({ kind: 'usage', message });

/**
 * The two verbs that mean one thing bare and another under `plane` — the collision this
 * feature's naming decision exists to resolve. When one arrives without its target, the
 * failure must name **both** objects, because an operator with the old script's habits
 * will type exactly these (FR-003).
 */
const COLLIDING: Record<string, PlaneVerb> = { start: 'up', stop: 'down' };

/**
 * Turn `process.argv.slice(2)` into an invocation.
 *
 * Never guesses. A command that could mean two things fails and says so; a command that
 * names nothing acts on nothing.
 */
export function parseArgv(argv: readonly string[], commands: ReadonlyMap<string, ConsoleCommand>): Invocation {
  const [verb, ...rest] = argv;

  // No arguments renders the listing, exactly as `help` does (FR-004).
  if (verb === undefined || verb === 'help') return { kind: 'help' };

  if (verb === 'plane') return parsePlane(rest);

  const command = commands.get(verb);
  if (command === undefined) return unknownVerb(verb, commands);

  return command.targets.length > 0
    ? parseTargeted(command, rest)
    : parseBare(command, rest);
}

/** `plane up | down | restart | status | logs [service]`. */
function parsePlane(rest: readonly string[]): Invocation {
  const [verb, service, ...extra] = rest;

  if (verb === undefined) {
    return usage(`\`reveille plane\` needs a verb: ${PLANE_VERBS.map((v) => `\`${v}\``).join(', ')}.`);
  }
  if (!isPlaneVerb(verb)) {
    return usage(
      `Unknown plane verb \`${verb}\`. Try: ${PLANE_VERBS.map((v) => `\`${v}\``).join(', ')}.`,
    );
  }
  if (extra.length > 0) {
    return usage(`\`reveille plane ${verb}\` takes at most one service name.`);
  }
  return { kind: 'plane', verb, service };
}

/** A verb that names a target: `start <game>`, `stop <game>`, `address <game>`. */
function parseTargeted(command: ConsoleCommand, rest: readonly string[]): Invocation {
  const [targetName, ...extra] = rest;
  const valid = command.targets.map((t) => `\`${t}\``).join(', ');

  if (targetName === undefined) {
    const plane = COLLIDING[command.name];
    // Both objects, because both are plausible and acting on the wrong one is the whole
    // hazard the `plane` namespace exists to remove.
    const both =
      plane === undefined
        ? ''
        : ` Did you mean \`reveille plane ${plane}\`, which acts on Reveille's own processes instead?`;
    return usage(`\`reveille ${command.name}\` needs a target: ${valid}.${both}`);
  }
  if (!command.targets.includes(targetName)) {
    // Covers the wrong-kind case for free: a media target is not among a game verb's
    // subcommands, so `reveille start vlc` lands here rather than reaching an agent.
    return usage(`\`${targetName}\` is not something \`reveille ${command.name}\` can act on. Try: ${valid}.`);
  }
  if (extra.length > 0) {
    return usage(`\`reveille ${command.name} ${targetName}\` takes no further arguments.`);
  }
  return { kind: 'target', verb: command.name, targetName, amount: undefined };
}

/** A bare verb, optionally carrying one signed integer: `forward 90`, `next -3`, `pause`. */
function parseBare(command: ConsoleCommand, rest: readonly string[]): Invocation {
  const [raw, ...extra] = rest;

  if (raw === undefined) {
    return { kind: 'target', verb: command.name, targetName: undefined, amount: undefined };
  }
  if (command.option === undefined) {
    return usage(`\`reveille ${command.name}\` takes no arguments.`);
  }
  if (extra.length > 0) {
    return usage(`\`reveille ${command.name}\` takes at most one \`${command.option.name}\`.`);
  }

  // Integer only, and the sign is meaningful — a negative reverses direction (005/007), so
  // it must survive parsing rather than be rejected as nonsense.
  //
  // The blank guard is not pedantry: `Number('')` is `0`, so an empty argument would
  // otherwise become a real, silent "move by zero" instead of the misuse it is.
  const amount = raw.trim() === '' ? Number.NaN : Number(raw);
  if (!Number.isInteger(amount)) {
    return usage(
      `\`${raw}\` is not a whole number. \`reveille ${command.name}\` takes \`${command.option.name}\`: ${command.option.description}`,
    );
  }
  return { kind: 'target', verb: command.name, targetName: undefined, amount };
}

/**
 * A verb this host does not offer.
 *
 * A media verb on a host with no media target is refused **in the member's own words**
 * rather than as an unknown token — the same sentence Discord gives, because it is the same
 * situation and there is only one wording of it.
 */
function unknownVerb(verb: string, commands: ReadonlyMap<string, ConsoleCommand>): Invocation {
  if (mediaVerbNames().has(verb)) return usage(NO_MEDIA_TARGET);

  const known = [...commands.keys(), 'plane'].map((v) => `\`${v}\``).join(', ');
  return usage(`Unknown command \`${verb}\`. Try: ${known}.`);
}
