// src/commands/Community/streaks.js
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { getUserStreaks } from '../../services/streakService.js';
 
export default {
    data: new SlashCommandBuilder()
        .setName('streaks')
        .setDescription('View all your active streaks in this server'),
    category: 'community',
 
    async execute(interaction, config, client) {
        try {
            const guildId = interaction.guild.id;
            const userId = interaction.user.id;
 
            const streaks = await getUserStreaks(client, guildId, userId);
 
            if (streaks.length === 0) {
                return InteractionHelper.universalReply(interaction, {
                    content: "🔥 You have no active streaks yet! Start one by replying to or mentioning someone in <#" + interaction.guild.channels.cache.find(c => c.name === '✨・chat-general')?.id + ">.",
                    ephemeral: true,
                });
            }
 
            const lines = await Promise.all(streaks.map(async (s, i) => {
                const otherId = s.user1_id === userId ? s.user2_id : s.user1_id;
                const other = await interaction.guild.members.fetch(otherId).catch(() => null);
                const name = other ? other.displayName : `Unknown (${otherId})`;
                return `**${i + 1}.** 🔥 **${s.streak_count}** days with **${name}** (Best: ${s.highest_streak})`;
            }));
 
            const embed = new EmbedBuilder()
                .setColor(0xff6b00)
                .setTitle(`🔥 ${interaction.user.username}'s Active Streaks`)
                .setDescription(lines.join('\n'))
                .setFooter({ text: `${streaks.length}/10 streak slots used` })
                .setTimestamp();
 
            await InteractionHelper.universalReply(interaction, { embeds: [embed] });
        } catch (error) {
            logger.error('Streaks command error:', error);
            await handleInteractionError(interaction, error, { subtype: 'streaks_failed' });
        }
    },
};
