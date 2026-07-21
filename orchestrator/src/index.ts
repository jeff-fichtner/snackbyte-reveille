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
import { loadConfig } from './config.ts';
import { AgentClient } from './agent-client.ts';
import { handleStart, handleStop } from './commands.ts';

const config = loadConfig();
const agent = new AgentClient(config.agentBaseUrl);

/**
 * The two verbs. `setDefaultMemberPermissions` is deliberately NOT set: any member
 * of the Discord server may issue either command, with no role check of any kind
 * (FR-001). Trust comes from the server being private, not from a permission gate.
 */
const commands = [
  new SlashCommandBuilder().setName('start').setDescription('Start the game server.'),
  new SlashCommandBuilder().setName('stop').setDescription('Save the world and stop the server.'),
].map((c) => c.toJSON());

export async function registerCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(config.discordBotToken);
  await rest.put(
    Routes.applicationGuildCommands(config.discordApplicationId, config.discordGuildId),
    { body: commands },
  );
}

// No intents: slash commands arrive as interactions over the gateway, and this bot
// never reads message content or tracks presence (FR-011).
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('clientReady', () => {
  process.stdout.write(`orchestrator connected as ${client.user?.tag ?? 'unknown'}\n`);
});

client.on('interactionCreate', (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // FR-001's "any member of the Discord server" means THIS server. The whole
  // justification for having no authorization is that the guild is private and
  // trusted (spec Assumptions) — so exactly one guild may command exactly one
  // game server. Commands are registered guild-scoped, which already achieves
  // that; this makes it explicit rather than incidental, because the bot can sit
  // in other servers (a test guild, say) and a stray registration there would
  // otherwise create a second live control surface for the same host.
  if (interaction.guildId !== config.discordGuildId) {
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
    switch (interaction.commandName) {
      case 'start':
        return await handleStart(interaction, agent);
      case 'stop':
        return await handleStop(interaction, agent);
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
