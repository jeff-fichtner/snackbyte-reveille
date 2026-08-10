/**
 * The `/start` and `/stop` handlers.
 *
 * Every message is written for two people who know the system. Plain and honest
 * beats polished (spec Assumptions) — in particular, nothing here may claim the
 * server is up, because the agent does not know that (FR-004).
 *
 * Replies are embeds so the outcome reads at a glance from its colour bar. The
 * wording is still the whole substance; the colour only repeats what the text
 * already says, and no branch relies on it to be understood.
 */
import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { AgentResponse } from '@reveille/contract';
import type { AgentClient, AgentResult } from './agent-client.ts';
import type { ControlledServer } from './config.ts';

/**
 * How far `/forward` and `/back` move when the member gives no amount (FR-004).
 *
 * **This is the only place the default exists.** It is a product decision, not
 * configuration — the agent has no default at all and rejects a missing `seconds` with a
 * 400, because a member omitting an argument is a documented choice while the orchestrator
 * omitting the parameter would be a bug (DECISIONS 023).
 */
export const DEFAULT_SEEK_SECONDS = 30;

/**
 * How many items `/next` and `/previous` move when the member gives no count (007 FR-015).
 *
 * **The only place this default exists**, exactly like {@link DEFAULT_SEEK_SECONDS}: the
 * agent has none and answers 400 on a missing `count`, because a member omitting an
 * argument is a documented choice while the orchestrator omitting it would be a bug.
 */
export const DEFAULT_STEP_COUNT = 1;

/**
 * Build ONE tenant's slash-command set from ITS targets (004 — scoped per guild). A
 * guild registers, and therefore only ever sees, its own targets (FR-003): a target it
 * does not own cannot even be picked. Game verbs get a subcommand per game target;
 * `/pause`·`/play` are bare (one media target, SC-001); `/status` always.
 *
 * Partitioned by kind (003, analyze F1): a media target must NOT surface as `/start vlc`.
 * `setDefaultMemberPermissions` is deliberately NOT set — any member of the (private,
 * trusted) guild may issue any command (FR-001); trust is the guild, now per tenant.
 */
/**
 * One labelled bundle of commands that act on one kind of target (006).
 *
 * A group is only ever *constructed* when it has contents, so an empty group cannot
 * exist and therefore cannot be rendered — the guarantee lives here, not in whatever
 * displays it (FR-022).
 */
export interface CommandGroup {
  readonly label: string;
  readonly commands: readonly SlashCommandBuilder[];
}

/**
 * **The single source: the one function that decides what a guild can run.**
 *
 * Registration and `/help` are both pure derivations of this (006, contracts
 * `command-surface.md`). That is not tidiness — it is the whole of FR-007/FR-008. If the
 * listing were a second *description* of these commands rather than a second *view* of
 * them, the two could disagree, and this repo has already shipped that exact bug: 005's
 * `agent/src/vlc.ts` declared "no seek" in its own header after seek was implemented in
 * it, four lines away, and drifted anyway.
 *
 * The grouping therefore has to be decided **here**, while the kind is known. Recovering
 * it downstream would mean a name→group lookup table, which is the second copy all over
 * again — it would silently mis-file the first command the next feature adds.
 */
export function buildCommandGroups(servers: readonly ControlledServer[]): CommandGroup[] {
  const games = servers.filter((s) => s.kind === 'game');
  const media = servers.find((s) => s.kind === 'media');
  const groups: CommandGroup[] = [];

  if (games.length > 0) {
    const start = new SlashCommandBuilder().setName('start').setDescription('Start a game server.');
    const stop = new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Save the world and stop a game server.');
    const address = new SlashCommandBuilder()
      .setName('address')
      .setDescription('Show where players connect for a server.');
    for (const s of games) {
      start.addSubcommand((sub) => sub.setName(s.name).setDescription(`Start the ${s.name} server.`));
      stop.addSubcommand((sub) =>
        sub.setName(s.name).setDescription(`Save the world and stop the ${s.name} server.`),
      );
      address.addSubcommand((sub) =>
        sub.setName(s.name).setDescription(`Show the address for the ${s.name} server.`),
      );
    }
    groups.push({ label: 'Games', commands: [start, stop, address] });
  }

  if (media) {
    const mediaCmds: SlashCommandBuilder[] = [
      new SlashCommandBuilder().setName('pause').setDescription('Pause the show.'),
      new SlashCommandBuilder().setName('play').setDescription('Resume the show.'),
      // Blind stepping (005). Bare and argument-free — a step needs to know nothing, and
      // the description must not imply Reveille can see what is queued (FR-002).
    ];

    // The two stepping commands, each with ONE optional count — the same shape the seek
    // pair already has (007 FR-015). NO `setMinValue`/`setMaxValue`: FR-016 forbids
    // bounding the count, and reaching for them is the obvious instinct, which is why
    // `commands.test.ts` asserts their absence for these too. A negative is meaningful
    // (it reverses direction, FR-017), so a minimum would break the feature outright.
    for (const [name, blurb] of [
      ['next', 'Skip to the next thing.'],
      ['previous', 'Go back to the previous thing.'],
    ] as const) {
      const cmd = new SlashCommandBuilder().setName(name).setDescription(blurb);
      cmd.addIntegerOption((o) =>
        o
          .setName('count')
          .setDescription(`How many to move (default ${DEFAULT_STEP_COUNT}; negative goes the other way).`)
          .setRequired(false),
      );
      mediaCmds.push(cmd);
    }

    // The two seek commands, bare like pause/play, each with ONE optional amount so the
    // common case is argument-free (FR-001). Built in two steps rather than chained:
    // `addIntegerOption` narrows the builder's type, and the array holds SlashCommandBuilder.
    //
    // NO `setMinValue`/`setMaxValue`, deliberately. 005 FR-005 forbids bounding the amount,
    // and reaching for those two methods is the obvious instinct — which is exactly why
    // `commands.test.ts` asserts their absence. A description must not name content either
    // (FR-002): these say what they do, never what is playing.
    for (const [name, verb] of [['forward', 'forward'], ['back', 'back']] as const) {
      const cmd = new SlashCommandBuilder()
        .setName(name)
        .setDescription(`Jump ${verb} in the show.`);
      cmd.addIntegerOption((o) =>
        o
          .setName('seconds')
          // Deliberately does not repeat the verb: the command's own description already
          // says which way it jumps, and `/help` shows the two together (006). Tightening
          // it here fixes the Discord picker and the listing at once — which is the point
          // of there being one copy.
          .setDescription(`How many seconds (default ${DEFAULT_SEEK_SECONDS}).`)
          .setRequired(false),
      );
      mediaCmds.push(cmd);
    }

    groups.push({ label: 'Media', commands: mediaCmds });
  }

  // Commands that belong to no target kind. Always present: every tenant has at least one
  // target, so these always apply.
  groups.push({
    label: 'Everything',
    commands: [
      new SlashCommandBuilder().setName('status').setDescription('See what’s running right now.'),
      // `/help` takes no arguments (006 FR-001) — asking what you can do must not itself
      // require knowing something. This description is what the listing shows, verbatim:
      // there is no second copy of it anywhere.
      new SlashCommandBuilder()
        .setName('help')
        .setDescription('List the commands you can run here.'),
    ],
  });

  return groups;
}

/**
 * The Discord registration payload — a **thin derivation** of {@link buildCommandGroups}.
 *
 * It flattens and serialises; it decides nothing. Anything that changes what a guild can
 * run belongs in the builder above, so that registration and `/help` cannot drift apart.
 */
export function buildCommands(servers: readonly ControlledServer[]) {
  return buildCommandGroups(servers)
    .flatMap((g) => g.commands)
    .map((c) => c.toJSON());
}

/** One line of `/help`: what a member types, and what it does (006). */
export interface CommandEntry {
  /** Exactly what a member types — `/start palworld`, `/forward [seconds]`, `/pause`. */
  readonly form: string;
  /** Taken **verbatim** from the registered command or subcommand. Never authored here. */
  readonly description: string;
}

/** Discord's option type tags. Only the ones this system can encounter are named. */
const SUBCOMMAND_OPTION = 1;
const SUBCOMMAND_GROUP_OPTION = 2;

/**
 * Turn one registered command into its **runnable forms** (006 FR-002).
 *
 * A command carrying subcommands is not itself runnable — `/start` does nothing, while
 * `/start palworld` does — so it yields one entry per subcommand, using that
 * subcommand's own description, which already names the target (FR-012 falls out of this
 * rather than needing its own code).
 *
 * **No description is written here.** Every one is copied from the registered command.
 * That is the whole contract: structure may be added around a description (a heading, an
 * argument suffix) but never the description itself, so there is no second copy to drift.
 */
export function toCommandEntries(command: SlashCommandBuilder): CommandEntry[] {
  const json = command.toJSON() as {
    name: string;
    description: string;
    options?: { type: number; name: string; description: string; required?: boolean }[];
  };
  const options = json.options ?? [];

  // A nested `/cmd group sub` would otherwise fall through to the argument branch below
  // and render as `[group]` — plausible-looking and wrong, which is the one failure this
  // feature exists to prevent. Nothing registers a group today, so rather than build
  // rendering for a shape that does not exist (Constitution III), fail loudly the moment
  // one appears (006 T015).
  if (options.some((o) => o.type === SUBCOMMAND_GROUP_OPTION)) {
    throw new Error(
      `/${json.name} uses a subcommand group, which the command listing cannot render. ` +
        `Teach toCommandEntries to expand groups before registering one.`,
    );
  }

  const subcommands = options.filter((o) => o.type === SUBCOMMAND_OPTION);
  if (subcommands.length > 0) {
    return subcommands.map((sub) => ({
      form: `/${json.name} ${sub.name}`,
      description: sub.description,
    }));
  }

  // Not a subcommand group: any options are arguments on the command itself. `<name>` is
  // required, `[name]` optional — the convention every CLI help text uses.
  const args = options
    .map((o) => (o.required === true ? `<${o.name}>` : `[${o.name}]`))
    .join(' ');

  // FR-003 wants the argument's default stated, and the registered option description
  // already carries it — so it is appended verbatim rather than re-derived. Extracting
  // "30" out of that sentence would mean parsing prose into a fact, which is authoring by
  // another name and would drift the moment the wording changed.
  const argHelp = options.map((o) => o.description).join(' ');
  const description = argHelp ? `${json.description} ${argHelp}` : json.description;

  return [{ form: args ? `/${json.name} ${args}` : `/${json.name}`, description }];
}

/** How an outcome reads at a glance. Maps to the brand palette, nothing more. */
export type Tone = 'progress' | 'ok' | 'refused' | 'failed';

/** Brand palette, same values the landing page uses. */
const TONE_COLOR: Record<Tone, number> = {
  progress: 0xe8a13a,
  ok: 0x39d39f,
  refused: 0xff6b6b,
  failed: 0xff6b6b,
};

export interface Reply {
  readonly tone: Tone;
  readonly text: string;
  /** Small print. Renders as the embed footer — a caveat, never the substance. */
  readonly footnote?: string;
  /**
   * Technical detail for the OPERATOR. **Never rendered** — `toEmbed` reads only `text`
   * and `footnote`, so this cannot reach a member by construction rather than by care
   * (007 FR-005, FR-006). It is where a status code, an errno, or a target's own error
   * text goes now that none of those may appear in a reply.
   */
  readonly diagnostic?: string;
}

/**
 * The operator's version of a failure the member is told about in their own terms.
 *
 * Both halves of the old `body.message ?? ` + "Agent returned HTTP " + `status` were the
 * bug: the target's text leaked its internals into the channel, and the fallback leaked
 * ours. Neither is a reply any more — together they are this string, and it is logged.
 */
function agentDiagnostic(status: number, body: AgentResponse): string {
  return body.message !== undefined
    ? `agent HTTP ${status}: ${body.message}`
    : `agent HTTP ${status}`;
}

/**
 * The longest name shown before it is shortened (007 FR-009a).
 *
 * The filename fallback is where long names come from: a release filename routinely runs
 * past a phone's line width on its own, and the all-targets reply puts it inline
 * (FR-008a). 60 is a judgement, not a measurement — the requirement is only that a long
 * name must not break the layout, and that a shortened one must LOOK shortened.
 */
const MAX_NAME = 60;

/** `m:ss`, widening to `h:mm:ss` only once an item actually runs past an hour. */
function clock(totalSeconds: number): string {
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/**
 * What a target observed, as a member reads it — ` · Name · 12:04 / 44:31`.
 *
 * **Omission is the rule, never substitution** (FR-009, SC-005): a part the target did not
 * report simply is not there. No placeholder, no "Unknown", no zero standing in for a
 * duration nobody knows. Absent detail therefore renders as the empty string, which is
 * exactly what a game target and a pre-007 agent both produce — so those read identically
 * to before this feature (SC-016).
 *
 * The elapsed-only case is deliberate: a live stream reports how far in it is but has no
 * total, and "12:04" alone is honest where "12:04 / 0:00" would be invented.
 */
export function renderDetail(body: AgentResponse): string {
  const parts: string[] = [];

  if (body.title !== undefined && body.title.trim() !== '') {
    const name = body.title.trim();
    // Truncation must be VISIBLE (FR-009a): a silently clipped name reads as the whole of
    // a strange one, which is a quieter version of inventing detail.
    parts.push(name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name);
  }

  const { elapsedSeconds, totalSeconds } = body;
  if (elapsedSeconds !== undefined) {
    // A total with no elapsed says nothing useful ("of 44:31"), so it is not rendered
    // alone — position is anchored on the elapsed reading or omitted entirely.
    parts.push(totalSeconds !== undefined ? `${clock(elapsedSeconds)} / ${clock(totalSeconds)}` : clock(elapsedSeconds));
  }

  return parts.length > 0 ? ` · ${parts.join(' · ')}` : '';
}

/** The host is unreachable, which is NOT the command failing on the host (FR-009). */
function unreachable(reason: string): Reply {
  return {
    tone: 'failed',
    // One outcome, and something the reader can actually do. The old wording listed
    // three causes ("off, asleep, or not running the agent") that a member can neither
    // tell apart nor act on — FR-004 — and forwarded the raw transport reason, which is
    // an errno, not a sentence (FR-001).
    text: 'That machine isn’t responding right now. Try again in a minute, or ask whoever runs it to check on it.',
    diagnostic: `unreachable: ${reason}`,
  };
}

/**
 * Turn an agent result into what the channel sees.
 *
 * Pure, so the wording and tone of every branch is testable without Discord.
 *
 * **Keys off the HTTP status, not just `state`.** `starting` arrives as both a 202
 * ("I just launched it") and a 409 ("someone already did"), and reporting
 * action-taken as already-in-that-state — or the reverse — is exactly what FR-004
 * forbids.
 */
export function describeStart(result: AgentResult): Reply {
  if (!result.reached) return unreachable(result.reason);

  const { status, body } = result;

  if (status === 202) {
    // Amber, and it PROMISES a follow-up — which US3 now delivers. The launch was
    // issued; the server is not up yet, and this reply says so and pends. It still
    // makes no claim about *when* (FR-004): the follow-up watches and reports either
    // "it's up" or "could not confirm", so this message never has to guess.
    return {
      tone: 'progress',
      // Still makes no claim that the server is up (FR-007) — but says so as an outcome
      // the reader can act on ("wait, I'll tell you") rather than by explaining that a
      // launch is not a verification.
      text: 'Starting it up. I’ll post again when it’s ready to join — give it a minute.',
    };
  }
  if (status === 409 && body.state === 'running') {
    return { tone: 'refused', text: 'Already running — nothing was launched.' };
  }
  if (status === 409 && body.state === 'starting') {
    return {
      tone: 'refused',
      text: 'A start is already in progress — nothing was launched. Give it a moment.',
    };
  }
  return {
    tone: 'failed',
    text: 'Couldn’t start it. Try again, and if it keeps failing ask whoever runs it to look.',
    diagnostic: agentDiagnostic(status, body),
  };
}

/**
 * The FIRST of `/stop`'s two messages — what is being attempted, posted before the agent
 * is asked.
 *
 * `/stop` now waits for the server to actually exit, so it has the same shape `/start`
 * has had since US3: say what is happening, then post again with the outcome. Without
 * this the member would watch a spinner for ten seconds with no idea whether the command
 * even landed (SC-004).
 *
 * It states an INTENT and never an outcome. The save has not happened when this is
 * posted, so nothing here may read as though it had — that is the second message's job,
 * including when it has to say the save failed and the server is still up.
 */
export function describeStopping(): Reply {
  return {
    tone: 'progress',
    text: 'Saving the world and shutting it down. I’ll post again when it’s all the way down.',
  };
}

/** Turn an agent result for `/stop` into what the channel sees. */
export function describeStop(result: AgentResult): Reply {
  if (!result.reached) return unreachable(result.reason);

  const { status, body } = result;

  if (status === 200) {
    // Now genuinely verified rather than asserted: the agent watched the process leave
    // before answering, so "exited" is something it observed.
    return { tone: 'ok', text: 'Stopped. The world was saved before the server exited.' };
  }
  if (status === 202) {
    // Saved, shutdown accepted, still winding down. NOT a failure and it must not read as
    // one — FR-007's rule for start, applied to stop: the world is safe and the server is
    // on its way down, which is a different thing from the 500 below where it is still up
    // with progress at risk. Amber, like the start it mirrors.
    return {
      tone: 'progress',
      text: 'The world is saved and it’s shutting down — it just hadn’t finished going down yet. Give it a moment; `/status` will show when it’s clear.',
      diagnostic: agentDiagnostic(status, body),
    };
  }
  if (status === 409 && body.state === 'stopped') {
    return { tone: 'refused', text: 'Already stopped — nothing was done.' };
  }
  if (status === 409 && body.state === 'starting') {
    // FR-017: refused, and the launching process is left alone. Never queued —
    // an unattended shutdown nobody asked for is forbidden (FR-010).
    return {
      tone: 'refused',
      text: 'A start is in progress, so the stop was refused. Try again once it is up.',
    };
  }
  // FR-006: could not stop safely, so the server is STILL RUNNING. Saying so
  // matters more than the failure itself, so it stays in the text rather than
  // the footnote.
  return {
    tone: 'failed',
    text: 'Could not stop safely, so the server is still running.',
    diagnostic: agentDiagnostic(status, body),
  };
}

/**
 * How a target's name renders for a human — `satisfactory` → `Satisfactory`.
 *
 * Display only: internal names stay lowercase everywhere (routing keys, config, the
 * Discord subcommand rules), and this is the ONE place they become human-facing. An
 * acronym a plain title-case would mangle (`vlc` → `Vlc`) is spelled out here, so the
 * status and replies read `VLC` while the target is still `vlc` under the hood.
 */
const DISPLAY_NAME: Record<string, string> = { vlc: 'VLC' };
export function titleCase(name: string): string {
  return DISPLAY_NAME[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

/** One server's answer to `/status`: its name, and what its agent said (or didn't). */
export interface ServerStatus {
  readonly name: string;
  readonly result: AgentResult;
}

/**
 * How each derived state reads in a status list — games in their vocabulary,
 * the media player in its (003). `/status` folds every target in; each is rendered
 * in its own words. Never mentions players (FR-011).
 */
const STATE_WORD: Record<string, string> = {
  running: 'running',
  starting: 'starting',
  stopped: 'stopped',
  error: 'error',
  playing: 'playing',
  paused: 'paused',
};

/**
 * Summarise every server's state in one read-only reply (US2). Each server is
 * reported independently — one whose agent cannot be reached shows `unreachable`
 * (a transport fact, not a fifth state) while the others report normally (FR-023,
 * FR-026). Says nothing about who or how many are connected (FR-011); changes
 * nothing (SC-005).
 */
export function describeStatus(statuses: readonly ServerStatus[]): Reply {
  const lines = statuses.map(({ name, result }) => {
    const label = `**${titleCase(name)}**`;
    // `unreachable` is a transport fact, never a state (Key Entities, FR-009). We show
    // it whenever we could not read a clean state — EITHER the agent did not answer, OR
    // it answered but could not derive its target's state. The latter is the real,
    // common media case: when VLC is closed the agent's /status returns 500 `error`
    // because the player itself is unreachable (FR-003 folds "the player could not be
    // reached" into unreachable). Rendering that 500 as `error` would both leak a
    // game-only word into media and contradict AC4. A game agent's /status never
    // errors — its getState derives a state and never throws — so games are unchanged
    // (FR-013): this branch only ever fires for a media target with its player closed.
    if (!result.reached || result.status !== 200) return `${label} — unreachable`;
    // ONE LINE PER TARGET, detail inline (FR-008a). A game target reports none of the
    // observation fields, so `renderDetail` returns '' and its line is byte-identical to
    // what it produced before this feature — which is SC-016, held structurally.
    return `${label} — ${STATE_WORD[result.body.state] ?? result.body.state}${renderDetail(result.body)}`;
  });
  return { tone: 'ok', text: lines.join('\n') };
}

/**
 * Render a reply as the embed Discord shows. When a server is named, it becomes
 * the title — so the reply says which server it acted on (FR-018), the other half
 * of naming the target (the player named it by picking the subcommand).
 */
export function toEmbed(reply: Reply, serverName?: string): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(TONE_COLOR[reply.tone]).setDescription(reply.text);
  if (serverName !== undefined) embed.setTitle(titleCase(serverName));
  if (reply.footnote !== undefined) embed.setFooter({ text: reply.footnote });
  return embed;
}

/**
 * Send a reply, and record its operator half.
 *
 * Every member-visible reply leaves through here, which is what makes 007 SC-003
 * structural rather than a habit: a branch cannot answer a member and forget to log,
 * because answering *is* logging. `toEmbed` stays pure — the wording of every branch is
 * still testable without Discord — and this is the only impure step.
 */
export async function sendReply(
  interaction: ChatInputCommandInteraction,
  reply: Reply,
  serverName?: string,
): Promise<void> {
  logDiagnostic(interaction.commandName, reply);
  await interaction.editReply({ embeds: [toEmbed(reply, serverName)] });
}

/**
 * Record a reply's operator half (007 T041).
 *
 * Extracted so the guarantee is actually true. `sendReply` claimed every member-visible
 * reply left through it — and the start follow-up posts with `followUp`, not `editReply`,
 * so it never did. The two send paths cannot share one function, but they can share this,
 * which is the part the guarantee was ever about.
 */
export function logDiagnostic(commandName: string, reply: Reply): void {
  if (reply.diagnostic !== undefined) {
    process.stderr.write(`/${commandName}: ${reply.diagnostic}\n`);
  }
}

/**
 * What a member is told when their guild has no media target (007 T042).
 *
 * Lives here, beside every other member-visible string, so the internals scan sees it — it
 * used to be a bare literal in the dispatch and was therefore outside the scanned set.
 * Worded as an outcome with something to do: the old text stated our configuration model
 * ("is configured"), offered no next step, and said "server" where it meant the Discord
 * guild — colliding with *game* server, the one noun this system most needs unambiguous.
 */
export const NO_MEDIA_TARGET =
  'There’s no media player set up here, so there’s nothing for this to control. Ask whoever runs this if you think there should be.';

/** A name that is not a configured server. Refused, with the valid list (FR-020). */
export function unknownServer(name: string, valid: readonly string[]): Reply {
  return {
    tone: 'refused',
    text: `Unknown server \`${name}\`. Try: ${valid.map((v) => `\`${v}\``).join(', ')}.`,
  };
}

/**
 * Resolve which agent a named command targets. Pure and testable: a known name
 * returns exactly that server's agent and no other (FR-021 — one server's command
 * cannot touch another); an unknown name returns the refusal, never a wrong agent.
 */
export function routeToAgent(
  serverName: string,
  agents: ReadonlyMap<string, AgentClient>,
): { readonly agent: AgentClient } | { readonly reply: Reply } {
  const agent = agents.get(serverName);
  if (agent === undefined) return { reply: unknownServer(serverName, [...agents.keys()]) };
  return { agent };
}

/**
 * Turn a public-address lookup into what the channel sees.
 *
 * Pure and testable. The orchestrator does not know which game this is — it is
 * handed a port from config and a looked-up IP, and formats the connect string.
 */
export function describeAddress(result: { ip: string } | { error: string }, port: number): Reply {
  if ('error' in result) {
    return {
      tone: 'failed',
      text: 'Couldn’t work out the address right now. Try again in a moment.',
      diagnostic: `address lookup: ${result.error}`,
    };
  }
  return {
    tone: 'ok',
    text: `Connect to \`${result.ip}:${port}\``,
    // What the reader does with it, not the plumbing that makes it work. Port
    // forwarding and VPNs are the operator's concern; a member can only copy the
    // address and try (FR-003, FR-004).
    footnote: 'Paste this into the game to join. It can change, so check here again if it stops working.',
  };
}

/**
 * Ask the internet what this machine’s public IP is.
 *
 * Two independent echo services, so one being down does not break `/address`.
 * Returns the raw egress IP — which, while the orchestrator and agent share a
 * machine, is also the game server’s address. When the orchestrator relocates
 * (deferred), the address players need is the AGENT’s location, and this must
 * move to the agent side. Marked here so that seam is not forgotten.
 */
export async function lookupPublicIp(): Promise<{ ip: string } | { error: string }> {
  const services = ['https://api.ipify.org', 'https://icanhazip.com'];
  for (const url of services) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4_000) });
      if (!res.ok) continue;
      const ip = (await res.text()).trim();
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return { ip };
    } catch {
      // Try the next service.
    }
  }
  return { error: 'No IP-lookup service responded.' };
}

/**
 * Turn a media agent's `/pause` result into what the channel sees (003). A 200 is
 * done — "Paused.", or the agent's no-op note ("Already paused.", FR-007); a 409 is
 * the honest refusal when nothing is playing (FR-008); unreachable reads as such,
 * never a playback state (FR-009). Pure and testable.
 */
export function describePause(result: AgentResult): Reply {
  if (!result.reached) return unreachable(result.reason);
  const { status, body } = result;
  // The agent's no-op note used to author this line. The orchestrator says it now; the
  // already-in-state case reads the same either way, and nothing of the target's leaks.
  // Observed at the moment it was asked, and reported as such — the wording never claims
  // the command produced it (FR-010).
  if (status === 200) return { tone: 'ok', text: `Paused.${renderDetail(body)}` };
  if (status === 409) return { tone: 'refused', text: 'Nothing is playing — nothing to pause.' };
  return {
    tone: 'failed',
    text: 'Couldn’t pause it. Try again in a moment.',
    diagnostic: agentDiagnostic(status, body),
  };
}

/** Turn a media agent's `/play` (resume) result into what the channel sees (003). */
export function describeResume(result: AgentResult): Reply {
  if (!result.reached) return unreachable(result.reason);
  const { status, body } = result;
  if (status === 200) return { tone: 'ok', text: `Playing.${renderDetail(body)}` };
  if (status === 409) return { tone: 'refused', text: 'Nothing is loaded — nothing to resume.' };
  return {
    tone: 'failed',
    text: 'Couldn’t start it playing again. Try again in a moment.',
    diagnostic: agentDiagnostic(status, body),
  };
}

/**
 * Turn a media agent's `/seek` result into what the channel sees (005).
 *
 * **States what was issued, never what was achieved** (FR-003). M0 §5 measured VLC
 * accepting absurd positions literally, §7 measured a step resuming a paused player, and
 * §6 measured a `200` coming back for a command VLC does not even recognise — so there is
 * nothing here the reply could honestly claim beyond "this was sent".
 *
 * The direction is read from the **sign**, which is what makes `/back -30` say *forward*:
 * the amount was passed through exactly as given, and the reply is honest about the
 * consequence rather than hiding it. Names no item, file, position, or duration (FR-002).
 */
export function describeSeek(result: AgentResult, seconds: number): Reply {
  if (!result.reached) return unreachable(result.reason);
  const { status, body } = result;
  const direction = seconds < 0 ? 'back' : 'forward';
  const magnitude = Math.abs(seconds);

  if (status === 200) {
    return { tone: 'ok', text: `Jumping ${direction} ${magnitude}s.${renderDetail(body)}` };
  }
  // Same tier and same terms as pause's refusal — all six media commands read alike
  // when nothing is loaded (SC-003).
  if (status === 409) return { tone: 'refused', text: 'Nothing is playing — nothing to jump.' };
  return {
    tone: 'failed',
    text: 'Couldn’t jump. Try again in a moment.',
    diagnostic: agentDiagnostic(status, body),
  };
}

/**
 * Turn a media agent's `/next` or `/previous` result into what the channel sees (005).
 *
 * **Never names the item** — not the one left, not the one arrived at (FR-002) — and
 * **claims no result**. There is deliberately no special message for the end of the
 * playlist: knowing you were at the end would require reading the playlist, and M0 §8
 * measured VLC wrapping there anyway. "Issued" is the whole truth available.
 */
export function describeStep(result: AgentResult, step: 'next' | 'previous', count = 1): Reply {
  if (!result.reached) return unreachable(result.reason);
  const { status, body } = result;
  // The direction ACTUALLY taken, not the one the command name implies (007 FR-017).
  // `/next -3` reaches here as a `previous` of 3, and says "back" — the same honesty
  // `/back -30` already owed the member when it seeked forward.
  const word = step === 'next' ? 'next' : 'previous';
  const many = Math.abs(count) !== 1;

  if (status === 200) {
    return {
      tone: 'ok',
      text:
        (many
          ? `Skipping ${Math.abs(count)} ${step === 'next' ? 'ahead' : 'back'}.`
          : `Skipping to the ${word} thing.`) + renderDetail(body),
    };
  }
  if (status === 409) return { tone: 'refused', text: 'Nothing is playing — nothing to skip.' };
  return {
    tone: 'failed',
    text: `Couldn’t skip to the ${word} thing. Try again in a moment.`,
    diagnostic: agentDiagnostic(status, body),
  };
}

/**
 * `/help` — render one tenant's command surface as a readable listing (006).
 *
 * **A second view of the registered commands, never a second description of them.** Every
 * line comes from {@link buildCommandGroups}, the same value registration is built from,
 * so the listing cannot show a command the guild lacks, omit one it has, or describe any
 * of them differently (FR-007, FR-008).
 *
 * Groups render in construction order and are never empty — a tenant without a kind of
 * target produces no group for it, rather than a heading with nothing under it (FR-022).
 *
 * Contacts nothing. This is the only command that reads no state at all: it says what a
 * member may *ask for*, never whether it would succeed, which is `/status`'s job
 * (FR-014, FR-015). The same tenant renders the same listing whether every target is
 * running or every one is switched off.
 */
export function describeCommandList(groups: readonly CommandGroup[]): Reply {
  const sections = groups.map((group) => {
    const entries = group.commands.flatMap(toCommandEntries);
    const width = Math.max(...entries.map((e) => e.form.length));
    const lines = entries.map((e) => `\`${e.form.padEnd(width)}\`  ${e.description}`);
    return `**${group.label}**\n${lines.join('\n')}`;
  });

  return { tone: 'ok', text: sections.join('\n\n') };
}

/**
 * What running one command produced, with **no surface attached** (008 T005).
 *
 * This is the seam between *doing the thing* and *telling someone about it*. Discord's
 * handlers render it as an embed; the local console prints it and picks an exit code. Two
 * surfaces, one set of decisions — which verb is sent, which default is applied, how a sign
 * is read — so they cannot answer the same command differently (008 SC-004).
 *
 * Sharing only `describeX` would share the **wording** and leave the **behaviour**
 * duplicated once per surface, which is the drift 005 already shipped once.
 *
 * Every field is present-but-possibly-undefined rather than optional: `exactOptionalPropertyTypes`
 * makes an omitted-vs-undefined distinction that buys nothing here and costs a conditional
 * at every construction site.
 */
export interface CommandOutcome {
  readonly reply: Reply;
  /** The target acted on, when the command named one. Becomes the embed title. */
  readonly serverName: string | undefined;
  /**
   * The raw agent result, when one was obtained. Only `/start` needs it — the follow-up
   * arms on a 202 and on nothing else (FR-030) — but it is uniform so no caller has to
   * know which commands carry it.
   */
  readonly result: AgentResult | undefined;
  /**
   * The per-target readings behind a status fold, for a surface that can say more about
   * them. The console uses it to answer the one question only the local vantage point can
   * (008 FR-025): when a target is unreachable, is its *agent process* even running?
   * Discord ignores it — it has no way to know, and the member has nothing to do with it.
   */
  readonly statuses: readonly ServerStatus[] | undefined;
}

/** Every server's state at once, read-only (US2). Names no single server — it reports them all. */
export async function runStatus(agents: ReadonlyMap<string, AgentClient>): Promise<CommandOutcome> {
  // Queried in parallel; each server is independent, so one unreachable agent does not stop
  // the others being reported.
  const statuses = await Promise.all(
    [...agents.entries()].map(
      async ([name, agent]): Promise<ServerStatus> => ({ name, result: await agent.status() }),
    ),
  );
  return { reply: describeStatus(statuses), serverName: undefined, result: undefined, statuses };
}

export async function runStart(
  agents: ReadonlyMap<string, AgentClient>,
  serverName: string,
): Promise<CommandOutcome> {
  const routed = routeToAgent(serverName, agents);
  // An unknown name launched nothing, so it carries no result and arms no follow-up (FR-030).
  if ('reply' in routed) return { reply: routed.reply, serverName, result: undefined, statuses: undefined };
  const result = await routed.agent.start();
  return { reply: describeStart(result), serverName, result, statuses: undefined };
}

export async function runStop(
  agents: ReadonlyMap<string, AgentClient>,
  serverName: string,
): Promise<CommandOutcome> {
  const routed = routeToAgent(serverName, agents);
  if ('reply' in routed) return { reply: routed.reply, serverName, result: undefined, statuses: undefined };
  const result = await routed.agent.stop();
  return { reply: describeStop(result), serverName, result, statuses: undefined };
}

/**
 * Where players connect for one server. It names a server because two servers share the
 * public IP but differ in game port.
 */
export async function runAddress(
  ports: ReadonlyMap<string, number>,
  serverName: string,
): Promise<CommandOutcome> {
  const port = ports.get(serverName);
  if (port === undefined) {
    return { reply: unknownServer(serverName, [...ports.keys()]), serverName, result: undefined, statuses: undefined };
  }
  // No agent is contacted — the address comes from config plus an internet lookup.
  return { reply: describeAddress(await lookupPublicIp(), port), serverName, result: undefined, statuses: undefined };
}

/** Pause the one media player (003). Bare — the target's name comes from config. */
export async function runPause(
  agents: ReadonlyMap<string, AgentClient>,
  serverName: string,
): Promise<CommandOutcome> {
  const routed = routeToAgent(serverName, agents);
  if ('reply' in routed) return { reply: routed.reply, serverName, result: undefined, statuses: undefined };
  const result = await routed.agent.pause();
  return { reply: describePause(result), serverName, result, statuses: undefined };
}

/** Resume the one media player (003). */
export async function runResume(
  agents: ReadonlyMap<string, AgentClient>,
  serverName: string,
): Promise<CommandOutcome> {
  const routed = routeToAgent(serverName, agents);
  if ('reply' in routed) return { reply: routed.reply, serverName, result: undefined, statuses: undefined };
  const result = await routed.agent.play();
  return { reply: describeResume(result), serverName, result, statuses: undefined };
}

/**
 * Move the position relative to now (005). `seconds` is already **signed** by the caller:
 * the sign carries the direction, which is why one function serves both `/forward` and
 * `/back` and no branch here decides which way to go.
 */
export async function runSeek(
  agents: ReadonlyMap<string, AgentClient>,
  serverName: string,
  seconds: number,
): Promise<CommandOutcome> {
  const routed = routeToAgent(serverName, agents);
  if ('reply' in routed) return { reply: routed.reply, serverName, result: undefined, statuses: undefined };
  const result = await routed.agent.seek(seconds);
  return { reply: describeSeek(result, seconds), serverName, result, statuses: undefined };
}

/** Step blindly through this tenant's media playlist (005). */
export async function runStep(
  agents: ReadonlyMap<string, AgentClient>,
  serverName: string,
  step: 'next' | 'previous',
  count: number = DEFAULT_STEP_COUNT,
): Promise<CommandOutcome> {
  const routed = routeToAgent(serverName, agents);
  if ('reply' in routed) return { reply: routed.reply, serverName, result: undefined, statuses: undefined };
  // The sign becomes a choice of VERB, and only a magnitude crosses the seam (FR-005,
  // contracts/seam-v5.md). A zero has no direction to reverse, so it stays as asked.
  const reversed = count < 0;
  const direction: 'next' | 'previous' = reversed
    ? (step === 'next' ? 'previous' : 'next')
    : step;
  const magnitude = Math.abs(count);
  const result = await (direction === 'next'
    ? routed.agent.next(magnitude)
    : routed.agent.previous(magnitude));
  return { reply: describeStep(result, direction, magnitude), serverName, result, statuses: undefined };
}

// ── The Discord surface ───────────────────────────────────────────────────────
// Each handler is now *run → send*, and decides nothing. Anything that changes what a
// command DOES belongs in the `run*` core above, so the console cannot diverge from it.

/**
 * `/status` — every server's state at once, read-only (US2).
 */
export async function handleStatus(
  interaction: ChatInputCommandInteraction,
  agents: ReadonlyMap<string, AgentClient>,
): Promise<void> {
  const { reply, serverName } = await runStatus(agents);
  await sendReply(interaction, reply, serverName);
}

export async function handleStart(
  interaction: ChatInputCommandInteraction,
  agents: ReadonlyMap<string, AgentClient>,
  serverName: string,
): Promise<AgentResult | undefined> {
  const outcome = await runStart(agents, serverName);
  await sendReply(interaction, outcome.reply, outcome.serverName);
  // The caller arms a follow-up only on a 202 (an actual launch), never on a
  // refusal or an unreachable host (FR-030).
  return outcome.result;
}

/**
 * `/stop <server>` — TWO messages, the shape `/start` already had.
 *
 * The agent now waits for the process to actually exit before answering, so this call can
 * take a handful of seconds. Saying what is happening first, then posting the outcome,
 * keeps the member from watching a bare spinner wondering whether the command landed.
 *
 * **The routing check comes first, deliberately.** An unknown server name contacts no
 * agent, so announcing a shutdown before resolving it would narrate an action that never
 * happens. Only a command that really is about to stop something gets the first message.
 *
 * `runStop` is left alone — the console (008) shares it and wants the single final
 * outcome, not a Discord conversation.
 */
export async function handleStop(
  interaction: ChatInputCommandInteraction,
  agents: ReadonlyMap<string, AgentClient>,
  serverName: string,
): Promise<void> {
  const routed = routeToAgent(serverName, agents);
  if ('reply' in routed) {
    await sendReply(interaction, routed.reply, serverName);
    return;
  }

  await sendReply(interaction, describeStopping(), serverName);

  const reply = describeStop(await routed.agent.stop());
  // Posts with `followUp`, not `editReply`, so it cannot go through `sendReply` — but it
  // MUST still record its operator half, exactly as the start follow-up does (007 T041).
  logDiagnostic(interaction.commandName, reply);
  await interaction.followUp({ embeds: [toEmbed(reply, serverName)] });
}

/** `/address <server>` — where players connect for that one server. */
export async function handleAddress(
  interaction: ChatInputCommandInteraction,
  ports: ReadonlyMap<string, number>,
  serverName: string,
): Promise<void> {
  const outcome = await runAddress(ports, serverName);
  await sendReply(interaction, outcome.reply, outcome.serverName);
}

/** `/pause` — pause the one media player (003). */
export async function handlePause(
  interaction: ChatInputCommandInteraction,
  agents: ReadonlyMap<string, AgentClient>,
  serverName: string,
): Promise<void> {
  const outcome = await runPause(agents, serverName);
  await sendReply(interaction, outcome.reply, outcome.serverName);
}

/** `/forward [seconds]` and `/back [seconds]` — move the position relative to now (005). */
export async function handleSeek(
  interaction: ChatInputCommandInteraction,
  agents: ReadonlyMap<string, AgentClient>,
  serverName: string,
  seconds: number,
): Promise<void> {
  const outcome = await runSeek(agents, serverName, seconds);
  await sendReply(interaction, outcome.reply, outcome.serverName);
}

/** `/next` and `/previous` — step blindly through this tenant's media playlist (005). */
export async function handleStep(
  interaction: ChatInputCommandInteraction,
  agents: ReadonlyMap<string, AgentClient>,
  serverName: string,
  step: 'next' | 'previous',
  count: number = DEFAULT_STEP_COUNT,
): Promise<void> {
  const outcome = await runStep(agents, serverName, step, count);
  await sendReply(interaction, outcome.reply, outcome.serverName);
}

/** `/play` — resume the one media player (003). */
export async function handleResume(
  interaction: ChatInputCommandInteraction,
  agents: ReadonlyMap<string, AgentClient>,
  serverName: string,
): Promise<void> {
  const outcome = await runResume(agents, serverName);
  await sendReply(interaction, outcome.reply, outcome.serverName);
}
