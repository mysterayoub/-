// src/commands/Community/streak.js
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { getStreak, getFreezesData } from '../../services/streakService.js';
 
export default {
    data: new SlashCommandBuilder()
        .setName('streak')
        .setDescription('View your streak with another user')
        .addUserOption(option =>
            option.setName('user').setDescription('The user to check your streak with').setRequired(true)
        ),
    category: 'community',
 
    async execute(interaction, config, client) {
        try {
            const target = interaction.options.getUser('user');
            const guildId = interaction.guild.id;
            const userId = interaction.user.id;
 
            if (target.id === userId) {
                return InteractionHelper.universalReply(interaction, {
                    content: "❌ You can't check a streak with yourself.",
                    ephemeral: true,
                });
            }
 
            if (target.bot) {
                return InteractionHelper.universalReply(interaction, {
                    content: "❌ You can't have a streak with a bot.",
                    ephemeral: true,
                });
            }
 
            const streak = await getStreak(client, guildId, userId, target.id);
            const freezeData = await getFreezesData(client, guildId, userId);
 
            if (!streak || streak.streak_count === 0) {
                return InteractionHelper.universalReply(interaction, {
                    content: `🔥 You have no active streak with ${target.toString()} yet. Reply to or mention them in <#${interaction.guild.channels.cache.find(c => c.name === '✨・chat-general')?.id}> to start one!`,
                    ephemeral: true,
                });
            }
 
            // Time left until midnight Amsterdam
            const now = new Date();
            const midnight = new Date();
            midnight.setTimeZone?.('Europe/Amsterdam');
            midnight.setHours(24, 0, 0, 0);
            const msLeft = midnight - now;
            const hoursLeft = Math.floor(msLeft / 3600000);
            const minsLeft = Math.floor((msLeft % 3600000) / 60000);
 
            const [u1, u2] = [userId, target.id].sort();
            const userInteracted = userId === u1 ? streak.user1_interacted_today : streak.user2_interacted_today;
            const targetInteracted = target.id === u1 ? streak.user1_interacted_today : streak.user2_interacted_today;
 
            const embed = new EmbedBuilder()
                .setColor(0xff6b00)
                .setTitle(`🔥 Streak with ${target.username}`)
                .addFields(
                    { name: '🔥 Current Streak', value: `${streak.streak_count} days`, inline: true },
                    { name: '🏆 Highest Streak', value: `${streak.highest_streak} days`, inline: true },
                    { name: '⏳ Time Left Today', value: `${hoursLeft}h ${minsLeft}m`, inline: true },
                    { name: '✅ Your Status', value: userInteracted ? 'Interacted today ✅' : 'Not yet ❌', inline: true },
                    { name: `✅ ${target.username}'s Status`, value: targetInteracted ? 'Interacted today ✅' : 'Not yet ❌', inline: true },
                    { name: '❄️ Your Freezes', value: `${freezeData.freezes_available} available`, inline: true },
                )
                .setTimestamp();
 
            await InteractionHelper.universalReply(interaction, { embeds: [embed] });
        } catch (error) {
            logger.error('Streak command error:', error);
            await handleInteractionError(interaction, error, { subtype: 'streak_failed' });
        }
    },
};
