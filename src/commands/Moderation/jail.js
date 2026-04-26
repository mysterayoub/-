import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
 
// In-memory store for saved roles: { userId: [roleId, roleId, ...] }
const jailedMembers = new Map();
 
export default {
    data: new SlashCommandBuilder()
        .setName('jail')
        .setDescription('Jail a user by removing all their roles and assigning the jailed role')
        .addUserOption((option) =>
            option
                .setName('target')
                .setDescription('The user to jail')
                .setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    category: 'moderation',
 
    async execute(interaction, config, client) {
        try {
            const user = interaction.options.getUser('target');
            const member = await interaction.guild.members.fetch(user.id);
 
            if (user.id === interaction.user.id) {
                throw new Error('You cannot jail yourself.');
            }
            if (user.id === client.user.id) {
                throw new Error('You cannot jail the bot.');
            }
 
            const jailedRole = interaction.guild.roles.cache.find(r => r.name === 'jailed');
            if (!jailedRole) {
                throw new Error('Could not find a role named `jailed`. Please create it first.');
            }
 
            if (member.roles.cache.has(jailedRole.id)) {
                throw new Error(`${user.tag} is already jailed.`);
            }
 
            // Save all roles except @everyone
            const rolesToRemove = member.roles.cache
                .filter(r => r.id !== interaction.guild.id)
                .map(r => r.id);
 
            jailedMembers.set(user.id, rolesToRemove);
 
            // Remove all roles then add jailed
            await member.roles.set([jailedRole], `Jailed by ${interaction.user.tag}`);
 
            await InteractionHelper.universalReply(interaction, {
                embeds: [
                    successEmbed(
                        `🔒 **Jailed** ${user.tag}`,
                        `${user} has had their roles removed and has been jailed.`,
                    ),
                ],
            });
        } catch (error) {
            logger.error('Jail command error:', error);
            await handleInteractionError(interaction, error, { subtype: 'jail_failed' });
        }
    },
 
    // Export the map so unjail.js can access it
    jailedMembers,
};
