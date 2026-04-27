import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { snipeCache, cleanExpired } from '../../events/messageDelete.js';
 
export default {
    data: new SlashCommandBuilder()
        .setName('snipe')
        .setDescription('View a recently deleted message in this channel')
        .addIntegerOption((option) =>
            option
                .setName('number')
                .setDescription('Which deleted message to view (1 = most recent, up to 10)')
                .setMinValue(1)
                .setMaxValue(10),
        ),
    category: 'utility',
 
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
            const index = (interaction.options.getInteger('number') || 1) - 1;
 
            // Clean expired before showing
            cleanExpired(channelId);
 
            const messages = snipeCache.get(channelId);
 
            if (!messages || messages.length === 0 || !messages[index]) {
                await InteractionHelper.universalReply(interaction, {
                    content: `❌ There's no deleted message at position **#${index + 1}** in this channel.`,
                    ephemeral: true,
                });
                return;
            }
 
            const msg = messages[index];
            const deletedAgo = Math.floor((Date.now() - msg.deletedAt) / 1000);
 
            const embed = new EmbedBuilder()
                .setColor(0x2b2d31)
                .setAuthor({
                    name: msg.authorTag,
                    iconURL: msg.authorAvatar || undefined,
                })
                .setDescription(msg.content || '*No text content*')
                .setFooter({ text: `Deleted ${deletedAgo}s ago • Message ${index + 1} of ${messages.length}` })
                .setTimestamp(msg.deletedAt);
 
            if (msg.attachmentUrl) {
                embed.setImage(msg.attachmentUrl);
            }
 
            await InteractionHelper.universalReply(interaction, { embeds: [embed] });
        } catch (error) {
            logger.error('Snipe command error:', error);
            await handleInteractionError(interaction, error, { subtype: 'snipe_failed' });
        }
    },
};
