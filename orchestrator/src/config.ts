/**
 * Orchestrator configuration, read from the environment at startup.
 *
 * Every value is required and none has a fallback. A missing or blank value throws
 * here, at boot, naming the variable. `DISCORD_BOT_TOKEN` is a credential and the
 * repository is public.
 */

export function required(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy orchestrator/.env.example to orchestrator/.env and fill it in — there is no default.`,
    );
  }
  return raw.trim();
}

export interface OrchestratorConfig {
  readonly discordBotToken: string;
  readonly discordApplicationId: string;
  readonly discordGuildId: string;
  /**
   * The agent's base URL — which IS the agent's identity (Constitution I). Always
   * configuration, never a constant, so a second controlled server is a second
   * address rather than a change to the contract.
   */
  readonly agentBaseUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OrchestratorConfig {
  return {
    discordBotToken: required('DISCORD_BOT_TOKEN', env),
    discordApplicationId: required('DISCORD_APPLICATION_ID', env),
    discordGuildId: required('DISCORD_GUILD_ID', env),
    agentBaseUrl: required('AGENT_BASE_URL', env).replace(/\/+$/, ''),
  };
}
