/**
 * The `/start` and `/stop` handlers.
 *
 * Every message is written for two people who know the system. Plain and honest
 * beats polished (spec Assumptions) — in particular, nothing here may claim the
 * server is up, because the agent does not know that (FR-004).
 */
import type { ChatInputCommandInteraction } from 'discord.js';
import type { AgentClient, AgentResult } from './agent-client.ts';

/**
 * Turn an agent result into what the channel sees.
 *
 * Pure, so the wording of every branch is testable without Discord.
 *
 * **Keys off the HTTP status, not just `state`.** `starting` arrives as both a 202
 * ("I just launched it") and a 409 ("someone already did"), and reporting
 * action-taken as already-in-that-state — or the reverse — is exactly what FR-004
 * forbids.
 */
export function describeStart(result: AgentResult): string {
  if (!result.reached) {
    // FR-009: could not reach the host, which is NOT the same as the command
    // failing on the host. Host off, asleep, or agent not running — the system
    // cannot tell these apart and does not pretend to.
    return `Could not reach the host. It may be off, asleep, or not running the agent.\n> ${result.reason}`;
  }

  const { status, body } = result;

  if (status === 202) {
    return (
      'Starting the server. Launch issued without error — try joining in a minute or so.\n' +
      '> That means launched, not verified. If it died on startup you will find out by failing to join.'
    );
  }
  if (status === 409 && body.state === 'running') {
    return 'Already running — nothing was launched.';
  }
  if (status === 409 && body.state === 'starting') {
    return 'A start is already in progress — nothing was launched. Give it a moment.';
  }
  return `Could not start the server.\n> ${body.message ?? `Agent returned HTTP ${status}.`}`;
}

/** Turn an agent result for `/stop` into what the channel sees. */
export function describeStop(result: AgentResult): string {
  if (!result.reached) {
    return `Could not reach the host. It may be off, asleep, or not running the agent.\n> ${result.reason}`;
  }

  const { status, body } = result;

  if (status === 200) {
    return 'Stopped. The world was saved before the server exited.';
  }
  if (status === 409 && body.state === 'stopped') {
    return 'Already stopped — nothing was done.';
  }
  if (status === 409 && body.state === 'starting') {
    // FR-017: refused, and the launching process is left alone. Never queued —
    // an unattended shutdown nobody asked for is forbidden (FR-010).
    return 'A start is in progress, so the stop was refused. Try again once it is up.';
  }
  // FR-006: could not stop safely, so the server is STILL RUNNING. Saying so
  // matters more than the failure itself.
  return `Could not stop safely, so the server is still running.\n> ${body.message ?? `Agent returned HTTP ${status}.`}`;
}

export async function handleStart(
  interaction: ChatInputCommandInteraction,
  agent: AgentClient,
): Promise<void> {
  await interaction.editReply(describeStart(await agent.start()));
}

export async function handleStop(
  interaction: ChatInputCommandInteraction,
  agent: AgentClient,
): Promise<void> {
  await interaction.editReply(describeStop(await agent.stop()));
}
