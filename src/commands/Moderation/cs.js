import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { snipeCache, cleanExpired } from '../../events/messageDelete.js';
 
export default {
    data: new SlashCommandBuilder()
        .setName('cs')
        .setDescription('Clear saved deleted messages from this channel')
        .addStringOption((option) =>
            option
                .setName('target')
                .setDescription('Which to clear: a number (e.g. 3), or "all"'),
        ),
    category: 'moderation',
 
    async execute(interaction, config, client) {
        try {
            const staffRole = interaction.guild.roles.cache.find(r => r.name === 'Staff');
            const hasStaffRole = staffRole && interaction.member.roles.cache.has(staffRole.id);
            const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.ManageMessages);
 
            if (!hasStaffRole && !hasPermission) {
                await InteractionHelper.universalReply(interaction, {
                    content: '❌ You need the **Staff** role or **Manage Messages** permission to use this command.',
                    ephemeral: true,
                });
                return;
            }
 
            const channelId = interaction.channel.id;
            const target = interaction.options.getString('target') || '1';
 
            // Clean expired first
            cleanExpired(channelId);
 
            const messages = snipeCache.get(channelId);
 
            if (!messages || messages.length === 0) {
                await InteractionHelper.universalReply(interaction, {
                    content: '❌ There are no saved deleted messages in this channel.',
                    ephemeral: true,
                });
                return;
            }
 
            if (target.toLowerCase() === 'all') {
                snipeCache.delete(channelId);
                await InteractionHelper.universalReply(interaction, {
                    embeds: [successEmbed('🧹 Snipe Cache Cleared', 'All saved deleted messages in this channel have been removed.')],
                });
                return;
            }
 
            const index = parseInt(target) - 1;
 
            if (isNaN(index) || index < 0 || index >= messages.length) {
                await InteractionHelper.universalReply(interaction, {
                    content: `❌ Invalid number. There are currently **${messages.length}** saved message(s).`,
                    ephemeral: true,
                });
                return;
            }
 
            messages.splice(index, 1);
            if (messages.length === 0) {
                snipeCache.delete(channelId);
            } else {
                snipeCache.set(channelId, messages);
            }
 
            await InteractionHelper.universalReply(interaction, {
                embeds: [successEmbed('🧹 Message Cleared', `Deleted message **#${index + 1}** has been removed from the snipe cache.`)],
            });
        } catch (error) {
            logger.error('CS command error:', error);
            await handleInteractionError(interaction, error, { subtype: 'cs_failed' });
        }
    },
};
