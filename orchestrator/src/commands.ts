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
import { EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { AgentClient, AgentResult } from './agent-client.ts';

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
    // Deliberately promises no duration. The system does not know when the server
    // becomes joinable and must not imply it does (FR-004) — and the real figure
    // varies with world size anyway (~3s empty, longer once there is a world).
    // `ok` means the COMMAND succeeded, not that the server is up — the honesty
    // lives in the text and footnote, which say exactly that. Green rather than
    // amber because this reply is final: nothing further will arrive.
    return {
      tone: 'ok',
      text: 'Starting the server. Launch issued without error — give it a moment, then join.',
      footnote: 'That means launched, not verified. If it died on startup you will find out by failing to join.',
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

/** `satisfactory` → `Satisfactory`, for the embed title that names the target. */
function titleCase(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
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

export async function handleStart(
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
    embeds: [toEmbed(describeStart(await routed.agent.start()), serverName)],
  });
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
