import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type VoiceChannel,
} from 'discord.js';
import type { VoiceManager } from './voice-manager.js';

export interface SlashCommand {
  data: Pick<SlashCommandBuilder, 'name' | 'toJSON'>;
  execute: (interaction: ChatInputCommandInteraction, manager: VoiceManager) => Promise<void>;
}

const operatorPermission = PermissionFlagsBits.ManageGuild;

export const commands: SlashCommand[] = [
  {
    data: new SlashCommandBuilder()
      .setName('join')
      .setDescription('Join a voice channel to prepare for streaming.')
      .setDefaultMemberPermissions(operatorPermission)
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('The voice channel to join.')
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(true),
      ),
    async execute(interaction, manager) {
      const channel = interaction.options.getChannel('channel', true) as VoiceChannel;
      await interaction.deferReply();

      try {
        await manager.join(channel);
        await interaction.editReply(
          `Joined **${channel.name}**. Use \`/startstream\` to begin broadcasting.`,
        );
      } catch (error) {
        console.error('[commands] Join failed:', error);
        await interaction.editReply('Failed to join the voice channel. Check the bot logs.');
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('leave')
      .setDescription('Leave the voice channel and stop streaming.')
      .setDefaultMemberPermissions(operatorPermission),
    async execute(interaction, manager) {
      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.reply('This command can only be used in a server.');
        return;
      }

      await interaction.deferReply();
      if (!manager.getSession(guildId)) {
        await interaction.editReply('Bot is not in a voice channel.');
        return;
      }

      await manager.leave(guildId);
      await interaction.editReply('Left the voice channel.');
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('startstream')
      .setDescription('Start streaming audio from Traktor to the voice channel.')
      .setDefaultMemberPermissions(operatorPermission),
    async execute(interaction, manager) {
      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.reply('This command can only be used in a server.');
        return;
      }

      await interaction.deferReply();
      try {
        await manager.startStream(guildId);
        await interaction.editReply('Stream started. Your DJ audio is now live.');
      } catch (error) {
        console.error('[commands] Stream start failed:', error);
        await interaction.editReply('Failed to start the stream. Check the bot logs.');
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('stopstream')
      .setDescription('Stop streaming audio but stay in the voice channel.')
      .setDefaultMemberPermissions(operatorPermission),
    async execute(interaction, manager) {
      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.reply('This command can only be used in a server.');
        return;
      }

      await interaction.deferReply();
      try {
        await manager.stopStream(guildId);
        await interaction.editReply('Stream stopped. Use `/startstream` to resume.');
      } catch (error) {
        console.error('[commands] Stream stop failed:', error);
        await interaction.editReply('Failed to stop the stream. Check the bot logs.');
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('volume')
      .setDescription('Set the stream volume.')
      .setDefaultMemberPermissions(operatorPermission)
      .addIntegerOption((option) =>
        option
          .setName('level')
          .setDescription('Volume level from 0 to 100.')
          .setMinValue(0)
          .setMaxValue(100)
          .setRequired(true),
      ),
    async execute(interaction, manager) {
      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.reply('This command can only be used in a server.');
        return;
      }

      const level = interaction.options.getInteger('level', true);
      try {
        manager.setVolume(guildId, level / 100);
        await interaction.reply(`Volume set to **${level}%**.`);
      } catch (error) {
        console.error('[commands] Volume change failed:', error);
        await interaction.reply('Failed to set the volume. Check the bot logs.');
      }
    },
  },
];
