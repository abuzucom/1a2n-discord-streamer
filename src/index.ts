import 'dotenv/config';
import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import { VoiceManager } from './voice-manager.js';
import { commands } from './commands.js';
import { handleInteraction } from './interaction-handler.js';

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const AUDIO_INPUT = process.env.AUDIO_INPUT;

if (!TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN in environment. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
if (!GUILD_ID) {
  console.error('Missing GUILD_ID in environment. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
if (!AUDIO_INPUT) {
  console.error('Missing AUDIO_INPUT in environment. See README for how to find your virtual audio device name.');
  process.exit(1);
}

export const voiceManager = new VoiceManager(AUDIO_INPUT);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.once('ready', async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  const rest = new REST().setToken(TOKEN);
  const commandData = commands.map((command) => command.data.toJSON());

  try {
    console.log(`Registering ${commandData.length} slash commands for guild ${GUILD_ID}...`);
    await rest.put(Routes.applicationGuildCommands(readyClient.user.id, GUILD_ID), {
      body: commandData,
    });
    console.log('Commands registered.');
  } catch (err) {
    console.error('Failed to register commands:', err);
    console.error('Bot is connected, but slash commands may be unavailable or outdated.');
    return;
  }

  console.log('Bot is ready. Use /join to get started.');
});

client.on('interactionCreate', async (interaction) => {
  await handleInteraction(interaction, voiceManager, GUILD_ID);
});

client.on('warn', (msg) => console.warn('[discord.js warn]', msg));
client.on('error', (err) => console.error('[discord.js error]', err));

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`Received ${signal}, shutting down...`);
  try {
    await voiceManager.leaveAll();
  } catch (error) {
    console.error('Failed to clean up every voice session:', error);
  } finally {
    client.destroy();
  }
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  await client.login(TOKEN);
} catch (error) {
  console.error('Failed to log in to Discord:', error);
  process.exitCode = 1;
}
