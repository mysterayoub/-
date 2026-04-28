// src/commands/Community/breakstreak.js
import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { getStreak, deleteStreak } from '../../services/streakService.js';
 
const pendingBreaks = new Map();
 
export default {
    data: new SlashCommandBuilder()
        .setName('breakstreak')
        .setDescription('Request to permanently end a streak with someone')
        .addUserOption(option =>
            option.setName('user').setDescription('The user to break the streak with').setRequired(true)
        ),
    category: 'community',
 
    async execute(interaction, config, client) {
        try {
            const target = interaction.options.getUser('user');
            const guildId = interaction.guild.id;
            const userId = interaction.user.id;
 
            if (target.id === userId) {
                return InteractionHelper.universalReply(interaction, {
                    content: "❌ You can't break a streak with yourself.",
                    ephemeral: true,
                });
            }
 
            const streak = await getStreak(client, guildId, userId, target.id);
 
            if (!streak || streak.streak_count === 0) {
                return InteractionHelper.universalReply(interaction, {
                    content: `❌ You don't have an active streak with ${target.toString()}.`,
                    ephemeral: true,
                });
            }
 
            const [u1, u2] = [userId, target.id].sort();
            const key = `${guildId}_${u1}_${u2}`;
 
            pendingBreaks.set(key, {
                requesterId: userId,
                targetId: target.id,
                accepted: new Set([userId]),
                streakCount: streak.streak_count,
            });
 
            setTimeout(() => pendingBreaks.delete(key), 600000);
 
            const acceptBtn = new ButtonBuilder()
                .setCustomId(`breakstreak_accept_${u1}_${u2}`)
                .setLabel('✅ Accept Break')
                .setStyle(ButtonStyle.Danger);
 
            const cancelBtn = new ButtonBuilder()
                .setCustomId(`breakstreak_cancel_${u1}_${u2}`)
                .setLabel('❌ Cancel')
                .setStyle(ButtonStyle.Secondary);
 
            const row = new ActionRowBuilder().addComponents(acceptBtn, cancelBtn);
 
            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('💔 Streak Break Request')
                .setDescription(
                    `<@${userId}> wants to permanently end their 🔥 **${streak.streak_count}** day streak with <@${target.id}>.\n\n` +
                    `<@${target.id}> — do you accept? This **cannot be undone**.\n` +
                    `Both users must accept. This request expires in 10 minutes.`
                );
 
            await InteractionHelper.universalReply(interaction, { embeds: [embed], components: [row] });
        } catch (error) {
            logger.error('Breakstreak command error:', error);
            await handleInteractionError(interaction, error, { subtype: 'breakstreak_failed' });
        }
    },
};
 
export async function handleBreakStreakButton(interaction, client) {
    const parts = interaction.customId.split('_');
    const action = parts[1];
    const u1 = parts[2];
    const u2 = parts[3];
    const guildId = interaction.guild.id;
    const key = `${guildId}_${u1}_${u2}`;
    const clickerId = interaction.user.id;
 
    const pending = pendingBreaks.get(key);
 
    if (!pending) {
        return interaction.reply({ content: '❌ This request has expired.', ephemeral: true });
    }
 
    if (clickerId !== u1 && clickerId !== u2) {
        return interaction.reply({ content: '❌ Only the two users in this streak can respond.', ephemeral: true });
    }
 
    if (action === 'cancel') {
        pendingBreaks.delete(key);
        const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('bs_done').setLabel('Cancelled').setStyle(ButtonStyle.Secondary).setDisabled(true)
        );
        return interaction.update({
            content: `❌ <@${clickerId}> cancelled the streak break request.`,
            embeds: [],
            components: [disabledRow],
        });
    }
 
    if (action === 'accept') {
        pending.accepted.add(clickerId);
 
        if (pending.accepted.size >= 2) {
            await deleteStreak(client, guildId, u1, u2);
            pendingBreaks.delete(key);
 
            const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('bs_done').setLabel('Streak Ended').setStyle(ButtonStyle.Secondary).setDisabled(true)
            );
 
            return interaction.update({
                content:
                    `💔 <@${u1}> & <@${u2}> have mutually ended their 🔥 **${pending.streakCount}** day streak.\n` +
                    `The streak slot is now free again.`,
                embeds: [],
                components: [disabledRow],
            });
        } else {
            const otherId = clickerId === u1 ? u2 : u1;
            return interaction.reply({
                content: `✅ You accepted. Waiting for <@${otherId}> to also accept...`,
                ephemeral: true,
            });
        }
    }
}
