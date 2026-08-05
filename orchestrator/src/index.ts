/**
 * The orchestrator — exactly one, welded to nothing.
 *
 * Owns the Discord gateway. The bot dials OUT to Discord, so nothing inbound is
 * ever needed: no port forward, no tunnel, no hostname (DECISIONS 006).
 *
 * Since 004 it is multi-tenant: each configured guild is a tenant scoped to its own
 * targets, and a command is routed ONLY within the tenant its guild selects. One
 * orchestrator holds every tenant (Constitution II) — the bot does not multiply. No
 * tenant or target id enters the seam (Constitution I); tenancy is enforced here.
 *
 * Do NOT set an Interactions Endpoint URL in the Discord developer portal. Doing
 * so switches delivery to HTTP POSTs at a public URL and forfeits that property.
 */
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { loadConfig, type GameServer, type ControlledServer, type Tenant } from './config.ts';
import { AgentClient } from './agent-client.ts';
import {
  buildCommands,
  handleStart,
  handleStop,
  handleAddress,
  handleStatus,
  handlePause,
  handleResume,
  handleSeek,
  DEFAULT_SEEK_SECONDS,
} from './commands.ts';
import { armFollowup, shouldFollowUp } from './followup.ts';

const config = loadConfig();

/**
 * Per-tenant runtime: one guild's own agent clients, public ports, and media target.
 * A command is only ever handed the maps of the tenant its guild selects, so a target
 * outside that tenant is not in scope to reach or reveal — isolation is **structural**
 * (FR-002), not a filter that could be forgotten.
 */
interface TenantRuntime {
  readonly tenant: Tenant;
  readonly agents: Map<string, AgentClient>;
  readonly ports: Map<string, number>;
  readonly mediaTarget: ControlledServer | undefined;
}

function buildRuntime(tenant: Tenant): TenantRuntime {
  return {
    tenant,
    // The name is the routing key here and on the Discord surface only — never in the
    // contract (Constitution I). An agent's URL is its identity.
    agents: new Map(tenant.servers.map((s) => [s.name, new AgentClient(s.baseUrl)])),
    // `/address` needs a public port — game targets only (a media target has none).
    ports: new Map(
      tenant.servers
        .filter((s): s is GameServer => s.kind === 'game')
        .map((s) => [s.name, s.publicPort]),
    ),
    // The tenant's single media target, if any — `/pause`/`/play` act on it (bare, SC-001).
    mediaTarget: tenant.servers.find((s) => s.kind === 'media'),
  };
}

// Guild id → its runtime. The interaction's guild is the routing key; a guild absent
// here is not a configured tenant and is ignored (FR-006). Adding a tenant is one more
// `TENANTS` entry — no code (FR-005).
const runtimes = new Map<string, TenantRuntime>(
  [...config.tenants.values()].map((t) => [t.guildId, buildRuntime(t)]),
);

export async function registerCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(config.discordBotToken);
  // Register EACH guild's commands, built from ONLY that tenant's targets (FR-003).
  // A guild's picker therefore shows its own targets and no other tenant's — a target
  // it does not own cannot even be submitted.
  for (const rt of runtimes.values()) {
    await rest.put(Routes.applicationGuildCommands(config.discordApplicationId, rt.tenant.guildId), {
      body: buildCommands(rt.tenant.servers),
    });
  }
}

// No intents: slash commands arrive as interactions over the gateway, and this bot
// never reads message content or tracks presence (FR-011).
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', () => {
  process.stdout.write(`orchestrator connected as ${client.user?.tag ?? 'unknown'}\n`);
});

client.on('interactionCreate', (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // Only a CONFIGURED guild (a tenant) may command anything (FR-001, FR-006). An
  // interaction from any other guild the bot also sits in is ignored — otherwise it
  // would be a live control surface for a host it should not touch. Resolving the
  // tenant here is what scopes everything downstream to that guild's targets.
  const runtime = interaction.guildId === null ? undefined : runtimes.get(interaction.guildId);
  if (runtime === undefined) {
    process.stdout.write(
      `ignored /${interaction.commandName} from unconfigured guild ${interaction.guildId ?? 'DM'}\n`,
    );
    return;
  }

  void handle(interaction, runtime);
});

async function handle(interaction: ChatInputCommandInteraction, rt: TenantRuntime): Promise<void> {
  // Defer FIRST, before touching the agent. Discord gives ~3 seconds to
  // acknowledge and a start takes far longer than that (SC-004).
  await interaction.deferReply();

  try {
    // EVERY handler operates on THIS tenant's maps only. A name is resolved within the
    // tenant, so one guild's command can never reach another guild's target (FR-002),
    // and `/status` folds only this tenant's targets (FR-012).
    if (interaction.commandName === 'status') {
      return await handleStatus(interaction, rt.agents);
    }

    // `/pause` and `/play` name no target — bare commands acting on this tenant's one
    // media player (SC-001). Registered only when the tenant has one.
    if (interaction.commandName === 'pause' || interaction.commandName === 'play') {
      if (rt.mediaTarget === undefined) {
        await interaction.editReply('No media player is configured for this server.');
        return;
      }
      return interaction.commandName === 'pause'
        ? await handlePause(interaction, rt.agents, rt.mediaTarget.name)
        : await handleResume(interaction, rt.agents, rt.mediaTarget.name);
    }

    // `/forward [seconds]` and `/back [seconds]` (005) — bare like pause/play, inside the
    // same resolved-tenant path, so isolation is inherited structurally rather than
    // re-implemented (004 FR-002/FR-003).
    if (interaction.commandName === 'forward' || interaction.commandName === 'back') {
      if (rt.mediaTarget === undefined) {
        await interaction.editReply('No media player is configured for this server.');
        return;
      }
      // The ONLY place the 30s default is applied. The amount is then passed through
      // exactly as given — no clamping, no magnitude conversion (FR-005): `/back` simply
      // negates, so `/back -30` sends +30 and seeks forward, as specified.
      const requested = interaction.options.getInteger('seconds') ?? DEFAULT_SEEK_SECONDS;
      const seconds = interaction.commandName === 'back' ? -requested : requested;
      return await handleSeek(interaction, rt.agents, rt.mediaTarget.name, seconds);
    }

    // The acting game verbs each name their server as the subcommand (FR-018/019);
    // Discord guarantees one was chosen, and it can only be one of THIS tenant's
    // targets, since that is all this guild had registered.
    const server = interaction.options.getSubcommand();
    switch (interaction.commandName) {
      case 'start': {
        const result = await handleStart(interaction, rt.agents, server);
        // Only an actual launch (202) is watched; a refusal or unreachable host arms
        // nothing (FR-030). The follow-up watches THIS tenant's agent.
        if (shouldFollowUp(result)) {
          const agent = rt.agents.get(server);
          if (agent) armFollowup(interaction, server, agent, config.followupTimeoutMs);
        }
        return;
      }
      case 'stop':
        return await handleStop(interaction, rt.agents, server);
      case 'address':
        return await handleAddress(interaction, rt.ports, server);
      default:
        await interaction.editReply(`Unknown command \`/${interaction.commandName}\`.`);
        return;
    }
  } catch (error: unknown) {
    // A command must never leave the player guessing whether it was received and
    // acted on (SC-004), so even an unexpected failure gets a reply.
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`/${interaction.commandName} failed: ${message}\n`);
    await interaction.editReply(`Something went wrong handling that.\n> ${message}`);
  }
}

await registerCommands();
await client.login(config.discordBotToken);
