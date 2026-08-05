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
 * Build ONE tenant's slash-command set from ITS targets (004 — scoped per guild). A
 * guild registers, and therefore only ever sees, its own targets (FR-003): a target it
 * does not own cannot even be picked. Game verbs get a subcommand per game target;
 * `/pause`·`/play` are bare (one media target, SC-001); `/status` always.
 *
 * Partitioned by kind (003, analyze F1): a media target must NOT surface as `/start vlc`.
 * `setDefaultMemberPermissions` is deliberately NOT set — any member of the (private,
 * trusted) guild may issue any command (FR-001); trust is the guild, now per tenant.
 */
export function buildCommands(servers: readonly ControlledServer[]) {
  const games = servers.filter((s) => s.kind === 'game');
  const media = servers.find((s) => s.kind === 'media');
  const cmds: SlashCommandBuilder[] = [];

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
    cmds.push(start, stop, address);
  }

  if (media) {
    cmds.push(new SlashCommandBuilder().setName('pause').setDescription('Pause the show.'));
    cmds.push(new SlashCommandBuilder().setName('play').setDescription('Resume the show.'));

    // The two seek commands, bare like pause/play, each with ONE optional amount so the
    // common case is argument-free (FR-001). Built in two steps rather than chained:
    // `addIntegerOption` narrows the builder's type, and `cmds` holds SlashCommandBuilder.
    //
    // NO `setMinValue`/`setMaxValue`, deliberately. FR-005 forbids bounding the amount, and
    // reaching for those two methods is the obvious instinct — which is exactly why
    // `commands.test.ts` asserts their absence. A description must not name content either
    // (FR-002): these say what they do, never what is playing.
    // Blind stepping (005). Bare and argument-free — a step needs to know nothing, and
    // the description must not imply Reveille can see what is queued (FR-002).
    cmds.push(new SlashCommandBuilder().setName('next').setDescription('Skip to the next thing.'));
    cmds.push(
      new SlashCommandBuilder().setName('previous').setDescription('Go back to the previous thing.'),
    );

    for (const [name, verb] of [['forward', 'forward'], ['back', 'back']] as const) {
      const cmd = new SlashCommandBuilder()
        .setName(name)
        .setDescription(`Jump ${verb} in the show.`);
      cmd.addIntegerOption((o) =>
        o
          .setName('seconds')
          .setDescription(`How many seconds to jump ${verb} (default ${DEFAULT_SEEK_SECONDS}).`)
          .setRequired(false),
      );
      cmds.push(cmd);
    }
  }

  cmds.push(
    new SlashCommandBuilder().setName('status').setDescription('Show the state of every target.'),
  );

  return cmds.map((c) => c.toJSON());
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
}

/** The host is unreachable, which is NOT the command failing on the host (FR-009). */
function unreachable(reason: string): Reply {
  return {
    tone: 'failed',
    text: 'Could not reach the host. It may be off, asleep, or not running the agent.',
    footnote: reason,
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
      text: 'Starting the server — launch issued. I’ll post again when it’s up.',
      footnote: 'That means launched, not verified. If it does not come up, the follow-up will say it could not be confirmed.',
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
    text: 'Could not start the server.',
    footnote: body.message ?? `Agent returned HTTP ${status}.`,
  };
}

/** Turn an agent result for `/stop` into what the channel sees. */
export function describeStop(result: AgentResult): Reply {
  if (!result.reached) return unreachable(result.reason);

  const { status, body } = result;

  if (status === 200) {
    return { tone: 'ok', text: 'Stopped. The world was saved before the server exited.' };
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
    footnote: body.message ?? `Agent returned HTTP ${status}.`,
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
    return `${label} — ${STATE_WORD[result.body.state] ?? result.body.state}`;
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
      text: 'Could not work out the current address.',
      footnote: result.error,
    };
  }
  return {
    tone: 'ok',
    text: `Connect to \`${result.ip}:${port}\``,
    // Honest about what this is and is not: it is where the host is right now, and
    // it only works if the port is forwarded there and no VPN is masking the IP.
    footnote:
      'This is the host’s current public address. It changes when the machine moves, and only works with the game port forwarded and no VPN active.',
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
  if (status === 200) return { tone: 'ok', text: body.message ?? 'Paused.' };
  if (status === 409) return { tone: 'refused', text: 'Nothing is playing — nothing to pause.' };
  return {
    tone: 'failed',
    text: 'Could not pause the player.',
    footnote: body.message ?? `Agent returned HTTP ${status}.`,
  };
}

/** Turn a media agent's `/play` (resume) result into what the channel sees (003). */
export function describeResume(result: AgentResult): Reply {
  if (!result.reached) return unreachable(result.reason);
  const { status, body } = result;
  if (status === 200) return { tone: 'ok', text: body.message ?? 'Playing.' };
  if (status === 409) return { tone: 'refused', text: 'Nothing is loaded — nothing to resume.' };
  return {
    tone: 'failed',
    text: 'Could not resume the player.',
    footnote: body.message ?? `Agent returned HTTP ${status}.`,
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
    return { tone: 'ok', text: `Jumping ${direction} ${magnitude}s.` };
  }
  // Same tier and same terms as pause's refusal — all six media commands read alike
  // when nothing is loaded (SC-003).
  if (status === 409) return { tone: 'refused', text: 'Nothing is playing — nothing to jump.' };
  return {
    tone: 'failed',
    text: 'Could not jump the player.',
    footnote: body.message ?? `Agent returned HTTP ${status}.`,
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
export function describeStep(result: AgentResult, step: 'next' | 'previous'): Reply {
  if (!result.reached) return unreachable(result.reason);
  const { status, body } = result;
  const word = step === 'next' ? 'next' : 'previous';

  if (status === 200) return { tone: 'ok', text: `Skipping to the ${word} thing.` };
  if (status === 409) return { tone: 'refused', text: 'Nothing is playing — nothing to skip.' };
  return {
    tone: 'failed',
    text: `Could not skip to the ${word} thing.`,
    footnote: body.message ?? `Agent returned HTTP ${status}.`,
  };
}

/**
 * `/status` — every server's state at once, read-only (US2). Queries all agents in
 * parallel; each server is independent, so one unreachable agent does not stop the
 * others being reported. Names no single server — it reports them all.
 */
export async function handleStatus(
  interaction: ChatInputCommandInteraction,
  agents: ReadonlyMap<string, AgentClient>,
): Promise<void> {
  const statuses = await Promise.all(
    [...agents.entries()].map(
      async ([name, agent]): Promise<ServerStatus> => ({ name, result: await agent.status() }),
    ),
  );
  await interaction.editReply({ embeds: [toEmbed(describeStatus(statuses))] });
}

export async function handleStart(
  interaction: ChatInputCommandInteraction,
  agents: ReadonlyMap<string, AgentClient>,
  serverName: string,
): Promise<AgentResult | undefined> {
  const routed = routeToAgent(serverName, agents);
  if ('reply' in routed) {
    await interaction.editReply({ embeds: [toEmbed(routed.reply, serverName)] });
    return undefined; // an unknown name launched nothing — no follow-up (FR-030)
  }
  const result = await routed.agent.start();
  await interaction.editReply({ embeds: [toEmbed(describeStart(result), serverName)] });
  // The caller arms a follow-up only on a 202 (an actual launch), never on a
  // refusal or an unreachable host (FR-030).
  return result;
}

export async function handleStop(
  interaction: ChatInputCommandInteraction,
  agents: ReadonlyMap<string, AgentClient>,
  serverName: string,
): Promise<void> {
  const routed = routeToAgent(serverName, agents);
  if ('reply' in routed) {
    await interaction.editReply({ embeds: [toEmbed(routed.reply, serverName)] });
    return;
  }
  await interaction.editReply({
    embeds: [toEmbed(describeStop(await routed.agent.stop()), serverName)],
  });
}

/**
 * `/address <server>` — where players connect for that one server. It names a
 * server because two servers share the public IP but differ in game port (the
 * multi-server config; the single-port `/address` from `main` is reconciled here).
 */
export async function handleAddress(
  interaction: ChatInputCommandInteraction,
  ports: ReadonlyMap<string, number>,
  serverName: string,
): Promise<void> {
  const port = ports.get(serverName);
  if (port === undefined) {
    await interaction.editReply({
      embeds: [toEmbed(unknownServer(serverName, [...ports.keys()]), serverName)],
    });
    return;
  }
  await interaction.editReply({
    embeds: [toEmbed(describeAddress(await lookupPublicIp(), port), serverName)],
  });
}

/**
 * `/pause` — pause the one media player (003). A bare command (no subcommand), so it
 * is handed the media target's name from config. Names the target in the reply title.
 */
export async function handlePause(
  interaction: ChatInputCommandInteraction,
  agents: ReadonlyMap<string, AgentClient>,
  serverName: string,
): Promise<void> {
  const routed = routeToAgent(serverName, agents);
  if ('reply' in routed) {
    await interaction.editReply({ embeds: [toEmbed(routed.reply, serverName)] });
    return;
  }
  await interaction.editReply({
    embeds: [toEmbed(describePause(await routed.agent.pause()), serverName)],
  });
}

/**
 * `/forward [seconds]` and `/back [seconds]` — move the position relative to now (005).
 *
 * Bare commands, so the target comes from config exactly as `/pause` does. `seconds` is
 * already **signed** by the caller: the sign carries the direction, which is why one
 * handler serves both commands and no branch here decides which way to go.
 */
export async function handleSeek(
  interaction: ChatInputCommandInteraction,
  agents: ReadonlyMap<string, AgentClient>,
  serverName: string,
  seconds: number,
): Promise<void> {
  const routed = routeToAgent(serverName, agents);
  if ('reply' in routed) {
    await interaction.editReply({ embeds: [toEmbed(routed.reply, serverName)] });
    return;
  }
  await interaction.editReply({
    embeds: [toEmbed(describeSeek(await routed.agent.seek(seconds), seconds), serverName)],
  });
}

/** `/next` and `/previous` — step blindly through this tenant's media playlist (005). */
export async function handleStep(
  interaction: ChatInputCommandInteraction,
  agents: ReadonlyMap<string, AgentClient>,
  serverName: string,
  step: 'next' | 'previous',
): Promise<void> {
  const routed = routeToAgent(serverName, agents);
  if ('reply' in routed) {
    await interaction.editReply({ embeds: [toEmbed(routed.reply, serverName)] });
    return;
  }
  const result = await (step === 'next' ? routed.agent.next() : routed.agent.previous());
  await interaction.editReply({ embeds: [toEmbed(describeStep(result, step), serverName)] });
}

/** `/play` — resume the one media player (003). */
export async function handleResume(
  interaction: ChatInputCommandInteraction,
  agents: ReadonlyMap<string, AgentClient>,
  serverName: string,
): Promise<void> {
  const routed = routeToAgent(serverName, agents);
  if ('reply' in routed) {
    await interaction.editReply({ embeds: [toEmbed(routed.reply, serverName)] });
    return;
  }
  await interaction.editReply({
    embeds: [toEmbed(describeResume(await routed.agent.play()), serverName)],
  });
}
