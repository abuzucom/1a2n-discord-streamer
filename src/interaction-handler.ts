import { PermissionFlagsBits, type Interaction } from 'discord.js';
import { commands } from './commands.js';
import type { VoiceManager } from './voice-manager.js';

const commandMap = new Map(commands.map((command) => [command.data.name, command]));

export async function handleInteraction(
  interaction: Interaction,
  voiceManager: VoiceManager,
  guildId: string,
): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.guildId !== guildId) {
      await interaction.reply({
        content: 'This bot is not configured for this server.',
        ephemeral: true,
      });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: 'You need the Manage Server permission to control this bot.',
        ephemeral: true,
      });
      return;
    }

    const command = commandMap.get(interaction.commandName);
    if (!command) {
      await interaction.reply({
        content: 'This command is unavailable. Ask an administrator to restart the bot.',
        ephemeral: true,
      });
      return;
    }

    await command.execute(interaction, voiceManager);
  } catch (error) {
    console.error(`Error handling interaction ${interaction.commandName}:`, error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('Something went wrong executing that command.');
      } else {
        await interaction.reply({
          content: 'Something went wrong executing that command.',
          ephemeral: true,
        });
      }
    } catch {
      // The interaction may have expired.
    }
  }
}
