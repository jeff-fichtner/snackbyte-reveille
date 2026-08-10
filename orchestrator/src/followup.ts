/**
 * US3 — after a launch, watch a server until it is actually up, then post a NEW
 * message saying so (or that it could not be confirmed). The first behaviour that
 * *watches* rather than answers.
 *
 * Held entirely in memory. There is no registry, no persistence: a follow-up is a
 * local async in `armFollowup`. If the orchestrator restarts mid-wait, the watch is
 * simply gone and nothing is posted for that start (FR-032) — preferable to a claim
 * made from state that outlived a restart.
 */
import type { ChatInputCommandInteraction } from 'discord.js';
import type { AgentClient, AgentResult } from './agent-client.ts';
import { logDiagnostic, toEmbed, titleCase, type Reply } from './commands.ts';

/** How often to re-check the server while waiting. An internal cadence, not config. */
const POLL_INTERVAL_MS = 3_000;

/** Injected so the state machine is testable without real time (FR-029). */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const REAL_CLOCK: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Whether a `/start` result warrants a follow-up: only an actual launch — a 202 —
 * does. A refusal (409) or an unreachable host launched nothing, so it arms nothing
 * (FR-030); an unknown server name returns `undefined` and likewise arms nothing.
 */
export function shouldFollowUp(result: AgentResult | undefined): boolean {
  return result !== undefined && result.reached && result.status === 202;
}

/**
 * Poll `status` until it reports `running`, or until `timeoutMs` elapses. Returns
 * whether the server was confirmed up. Pure given its dependencies — clock and
 * status source are injected — so the whole loop is testable without a real server
 * or real time. "Up" means the control API reports `running` (the clarified US3
 * meaning), never a separate joinability probe.
 */
export async function watchUntilUp(
  status: () => Promise<AgentResult>,
  timeoutMs: number,
  clock: Clock = REAL_CLOCK,
  pollMs: number = POLL_INTERVAL_MS,
): Promise<boolean> {
  const deadline = clock.now() + timeoutMs;
  for (;;) {
    const result = await status();
    if (result.reached && result.body.state === 'running') return true;
    if (clock.now() >= deadline) return false;
    await clock.sleep(pollMs);
  }
}

/**
 * The follow-up message. Confirmed → it's up; timed out → "could not confirm",
 * NEVER "failed" (FR-029) — the server may simply be slow, and a launch that was
 * issued is not a launch that failed. Always names its server (FR-031).
 */
export function describeFollowup(serverName: string, confirmed: boolean): Reply {
  const name = titleCase(serverName);
  if (confirmed) {
    return { tone: 'ok', text: `${name} is up — try joining.` };
  }
  return {
    tone: 'progress',
    text: `Couldn’t confirm ${name} came up in time. It may still be starting — check with \`/status\`.`,
  };
}

/**
 * Arm the follow-up for a just-launched server: watch, then post a NEW message in
 * the same channel (FR-028). Fire-and-forget — the caller does not await it, so the
 * immediate reply is unaffected. A failure to post is logged, never thrown: a
 * broken follow-up must not take down the bot.
 */
export function armFollowup(
  interaction: ChatInputCommandInteraction,
  serverName: string,
  agent: AgentClient,
  timeoutMs: number,
  clock: Clock = REAL_CLOCK,
): void {
  void (async () => {
    try {
      const confirmed = await watchUntilUp(() => agent.status(), timeoutMs, clock);
      const reply = describeFollowup(serverName, confirmed);
      // Posts with `followUp`, not `editReply`, so it cannot go through `sendReply` — but
      // it MUST still record its operator half, or SC-003 would hold for every reply
      // except this one (007 T041).
      logDiagnostic(interaction.commandName, reply);
      await interaction.followUp({ embeds: [toEmbed(reply, serverName)] });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`follow-up for ${serverName} could not be posted: ${message}\n`);
    }
  })();
}
