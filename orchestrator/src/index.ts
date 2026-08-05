/**
 * The orchestrator — exactly one, welded to nothing.
 *
 * Owns the Discord gateway. The bot dials OUT to Discord, so nothing inbound is
 * ever needed: no port forward, no tunnel, no hostname (DECISIONS 006).
 *
 * Do NOT set an Interactions Endpoint URL in the Discord developer portal. Doing
 * so switches delivery to HTTP POSTs at a public URL and forfeits that property.
 */
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { loadConfig, type GameServer } from './config.ts';
import { AgentClient } from './agent-client.ts';
import {
  handleStart,
  handleStop,
  handleAddress,
  handleStatus,
  handlePause,
  handleResume,
} from './commands.ts';
import { armFollowup, shouldFollowUp } from './followup.ts';

const config = loadConfig();

// One agent client and one public port per controlled server, keyed by name. The
// name is the routing key here and on the Discord surface only — never in the
// contract (Constitution I). Adding a server is one more `AGENTS` entry, no code.
const agents = new Map(config.servers.map((s) => [s.name, new AgentClient(s.baseUrl)]));
// `/address` needs a public port — game targets only (a media target has none).
const ports = new Map(
  config.servers.filter((s): s is GameServer => s.kind === 'game').map((s) => [s.name, s.publicPort]),
);
// The single media target, if configured — `/pause`/`/play` act on it (bare, SC-001).
const mediaTarget = config.servers.find((s) => s.kind === 'media');

/**
 * The three verbs, each with one subcommand PER CONFIGURED SERVER, built from
 * config. `setDefaultMemberPermissions` is deliberately NOT set: any member of the
 * Discord server may issue any command, with no role check (FR-001). Trust comes
 * from the guild being private, not from a permission gate.
 *
 * A subcommand rather than an option because "server" is what Discord calls a
 * guild, so `/start server:palworld` reads as the wrong thing entirely — and
 * Discord requires a subcommand to be chosen, which enforces "never assume a
 * default target" (FR-019) at the protocol rather than in our code. An unknown
 * name cannot even be submitted through the picker.
 */
function buildCommands() {
  // Registration is PARTITIONED by kind (analyze F1): the game verbs get a subcommand
  // per game target only — a media target must NOT surface as `/start vlc` and route a
  // start to an agent that has no `/start`.
  const games = config.servers.filter((s) => s.kind === 'game');
  const cmds: SlashCommandBuilder[] = [];

  if (games.length > 0) {
    const start = new SlashCommandBuilder().setName('start').setDescription('Start a game server.');
    const stop = new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Save the world and stop a game server.');
    // `/address` names a server too: two servers share the public IP but differ in
    // game port, so there is no single address to report.
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

  // `/pause` and `/play` are BARE (no subcommand): there is one media target, so it can
  // be controlled in two taps (SC-001, FR-015). Registered only when one is configured.
  if (mediaTarget) {
    cmds.push(new SlashCommandBuilder().setName('pause').setDescription('Pause the show.'));
    cmds.push(new SlashCommandBuilder().setName('play').setDescription('Resume the show.'));
  }

  // `/status` names NO target — it reports them all, games and media alike.
  cmds.push(new SlashCommandBuilder().setName('status').setDescription('Show the state of every target.'));

  return cmds.map((c) => c.toJSON());
}

const commands = buildCommands();

export async function registerCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(config.discordBotToken);
  // Register the identical command set to each configured guild, so every one of them
  // shows the same commands (the stopgap: two private guilds, one bot).
  for (const guildId of config.discordGuildIds) {
    await rest.put(
      Routes.applicationGuildCommands(config.discordApplicationId, guildId),
      { body: commands },
    );
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

  // FR-001's "any member of the Discord server" means a CONFIGURED server. The whole
  // justification for having no authorization is that those guilds are private and
  // trusted (spec Assumptions). The bot can sit in other servers (a stray one, a test
  // guild), and a command arriving from any guild NOT in the configured set is ignored
  // — otherwise it would be a live control surface for the same host. (Stopgap: the
  // set is normally one guild; here it is two, pending the per-tenant spec.)
  if (interaction.guildId === null || !config.discordGuildIds.includes(interaction.guildId)) {
    process.stdout.write(
      `ignored /${interaction.commandName} from unconfigured guild ${interaction.guildId ?? 'DM'}\n`,
    );
    return;
  }

  void handle(interaction);
});

async function handle(interaction: ChatInputCommandInteraction): Promise<void> {
  // Defer FIRST, before touching the agent. Discord gives ~3 seconds to
  // acknowledge and a start takes far longer than that (SC-004).
  await interaction.deferReply();

  try {
    // `/status` names no target — it reports them all, and has no subcommand.
    if (interaction.commandName === 'status') {
      return await handleStatus(interaction, agents);
    }

    // `/pause` and `/play` name no target either — bare commands acting on the one
    // configured media player (SC-001). No subcommand to read.
    if (interaction.commandName === 'pause' || interaction.commandName === 'play') {
      if (mediaTarget === undefined) {
        await interaction.editReply('No media player is configured.');
        return;
      }
      return interaction.commandName === 'pause'
        ? await handlePause(interaction, agents, mediaTarget.name)
        : await handleResume(interaction, agents, mediaTarget.name);
    }

    // The acting game verbs each name their server as the subcommand (FR-018/019);
    // Discord guarantees one was chosen, since each is nothing but subcommands.
    const server = interaction.options.getSubcommand();
    switch (interaction.commandName) {
      case 'start': {
        const result = await handleStart(interaction, agents, server);
        // Only an actual launch (202) is watched; a refusal or unreachable host
        // arms nothing (FR-030). Fire-and-forget — the reply already went out.
        if (shouldFollowUp(result)) {
          const agent = agents.get(server);
          if (agent) armFollowup(interaction, server, agent, config.followupTimeoutMs);
        }
        return;
      }
      case 'stop':
        return await handleStop(interaction, agents, server);
      case 'address':
        return await handleAddress(interaction, ports, server);
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
