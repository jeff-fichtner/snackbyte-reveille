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
    return {
      tone: 'progress',
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

/** Render a reply as the embed Discord shows. */
export function toEmbed(reply: Reply): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(TONE_COLOR[reply.tone]).setDescription(reply.text);
  if (reply.footnote !== undefined) embed.setFooter({ text: reply.footnote });
  return embed;
}

export async function handleStart(
  interaction: ChatInputCommandInteraction,
  agent: AgentClient,
): Promise<void> {
  await interaction.editReply({ embeds: [toEmbed(describeStart(await agent.start()))] });
}

export async function handleStop(
  interaction: ChatInputCommandInteraction,
  agent: AgentClient,
): Promise<void> {
  await interaction.editReply({ embeds: [toEmbed(describeStop(await agent.stop()))] });
}
