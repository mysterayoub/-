import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import jailCommand from './jail.js';
 
const { jailedMembers } = jailCommand;
 
export default {
    data: new SlashCommandBuilder()
        .setName('unjail')
        .setDescription('Unjail a user and restore all their previous roles')
        .addUserOption((option) =>
            option
                .setName('target')
                .setDescription('The user to unjail')
                .setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    category: 'moderation',
 
    async execute(interaction, config, client) {
        try {
            const user = interaction.options.getUser('target');
            const member = await interaction.guild.members.fetch(user.id);
 
            const jailedRole = interaction.guild.roles.cache.find(r => r.name === 'jailed');
            if (!jailedRole) {
                throw new Error('Could not find a role named `jailed`. Please create it first.');
            }
 
            if (!member.roles.cache.has(jailedRole.id)) {
                throw new Error(`${user.tag} is not currently jailed.`);
            }
 
            // Remove jailed role
            await member.roles.remove(jailedRole, `Unjailed by ${interaction.user.tag}`);
 
            // Restore old roles if we have them saved
            if (jailedMembers.has(user.id)) {
                const savedRoleIds = jailedMembers.get(user.id);
                const rolesToRestore = savedRoleIds
                    .map(id => interaction.guild.roles.cache.get(id))
                    .filter(Boolean);
 
                if (rolesToRestore.length > 0) {
                    await member.roles.add(rolesToRestore, `Unjailed by ${interaction.user.tag}`);
                }
 
                jailedMembers.delete(user.id);
            }
 
            await InteractionHelper.universalReply(interaction, {
                embeds: [
                    successEmbed(
                        `🔓 **Unjailed** ${user.tag}`,
                        `${user} has been released and their roles have been restored.`,
                    ),
                ],
            });
        } catch (error) {
            logger.error('Unjail command error:', error);
            await handleInteractionError(interaction, error, { subtype: 'unjail_failed' });
        }
    },
};
 
