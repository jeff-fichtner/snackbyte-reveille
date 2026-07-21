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
  void handle(interaction);
});

async function handle(interaction: ChatInputCommandInteraction): Promise<void> {
  // Defer FIRST, before touching the agent. Discord gives ~3 seconds to
  // acknowledge and a start takes far longer than that (SC-004).
  await interaction.deferReply();

  // Handlers land in US1 (T018) and US2 (T021).
  const { commandName } = interaction;
  void agent;
  await interaction.editReply(`\`/${commandName}\` is not implemented yet.`);
}

await registerCommands();
await client.login(config.discordBotToken);
