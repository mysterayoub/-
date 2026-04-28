// src/commands/Community/topstreaks.js
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { getTopStreaks } from '../../services/streakService.js';
 
export default {
    data: new SlashCommandBuilder()
        .setName('topstreaks')
        .setDescription('View the top streaks leaderboard for this server'),
    category: 'community',
 
    async execute(interaction, config, client) {
        try {
            const guildId = interaction.guild.id;
            const top = await getTopStreaks(client, guildId, 10);
 
            if (top.length === 0) {
                return InteractionHelper.universalReply(interaction, {
                    content: '🔥 No active streaks in this server yet!',
                    ephemeral: true,
                });
            }
 
            const medals = ['🥇', '🥈', '🥉'];
 
            const lines = await Promise.all(top.map(async (s, i) => {
                const u1 = await interaction.guild.members.fetch(s.user1_id).catch(() => null);
                const u2 = await interaction.guild.members.fetch(s.user2_id).catch(() => null);
                const name1 = u1 ? u1.displayName : 'Unknown';
                const name2 = u2 ? u2.displayName : 'Unknown';
                const medal = medals[i] || `**#${i + 1}**`;
                return `${medal} 🔥 **${s.streak_count}** — ${name1} & ${name2}`;
            }));
 
            const embed = new EmbedBuilder()
                .setColor(0xff6b00)
                .setTitle('🏆 Top Streaks Leaderboard')
                .setDescription(lines.join('\n'))
                .setTimestamp();
 
            await InteractionHelper.universalReply(interaction, { embeds: [embed] });
        } catch (error) {
            logger.error('Topstreaks command error:', error);
            await handleInteractionError(interaction, error, { subtype: 'topstreaks_failed' });
        }
    },
};
 
