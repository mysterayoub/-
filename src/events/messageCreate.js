import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getLevelingConfig, getUserLevelData } from '../services/leveling.js';
import { addXp } from '../services/xpSystem.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
 
const MESSAGE_XP_RATE_LIMIT_ATTEMPTS = 12;
const MESSAGE_XP_RATE_LIMIT_WINDOW_MS = 10000;
 
// ── Automod ──────────────────────────────────────────────────────────────────
// Matches "nigger" and common bypasses (e.g. n1gg3r, nigg3r, n!gger, etc.)
// but does NOT match "nigga"
const BLOCKED_PATTERN = /n[i!1|][g9][g9][e3€][r|]+/gi;
 
async function handleAutomod(message) {
    try {
        if (!message.content) return false;
 
        const matched = message.content.match(BLOCKED_PATTERN);
        if (!matched) return false;
 
        // Delete the offending message
        await message.delete().catch(() => {});
 
        // Find the staff-chat channel
        const staffChannel = message.guild.channels.cache.find(
            c => c.name === '✨・staff-chat'
        );
        if (!staffChannel) {
            logger.warn('Automod: Could not find ✨・staff-chat channel');
            return true;
        }
 
        // Find the Staff role
        const staffRole = message.guild.roles.cache.find(r => r.name === 'Staff');
        const staffMention = staffRole ? staffRole.toString() : '@Staff';
 
        await staffChannel.send(
            `${staffMention}\n` +
            `⚠️ **Automod triggered** in ${message.channel.toString()}\n\n` +
            `**User:** ${message.author.tag} (${message.author.toString()} | ID: ${message.author.id})\n` +
            `**Message:** \`${message.content}\`\n` +
            `**Channel:** ${message.channel.toString()} (${message.channel.id})\n` +
            `**Time:** <t:${Math.floor(Date.now() / 1000)}:F>`
        );
 
        logger.info(`Automod: Deleted message from ${message.author.tag} in ${message.guild.name} — matched: ${matched.join(', ')}`);
        return true;
    } catch (error) {
        logger.error('Error in automod handler:', error);
        return false;
    }
}
// ────────────────────────────────────────────────────────────────────────────
 
export default {
    name: Events.MessageCreate,
    async execute(message, client) {
        try {
            if (message.author.bot || !message.guild) return;
 
            // Run automod first — if it triggered, still allow leveling to be skipped
            const blocked = await handleAutomod(message);
            if (blocked) return;
 
            await handleLeveling(message, client);
        } catch (error) {
            logger.error('Error in messageCreate event:', error);
        }
    }
};
 
async function handleLeveling(message, client) {
    try {
        const rateLimitKey = `xp-event:${message.guild.id}:${message.author.id}`;
        const canProcess = await checkRateLimit(rateLimitKey, MESSAGE_XP_RATE_LIMIT_ATTEMPTS, MESSAGE_XP_RATE_LIMIT_WINDOW_MS);
        if (!canProcess) return;
 
        const levelingConfig = await getLevelingConfig(client, message.guild.id);
        if (!levelingConfig?.enabled) return;
        if (levelingConfig.ignoredChannels?.includes(message.channel.id)) return;
 
        if (levelingConfig.ignoredRoles?.length > 0) {
            const member = await message.guild.members.fetch(message.author.id).catch(() => null);
            if (member && member.roles.cache.some(role => levelingConfig.ignoredRoles.includes(role.id))) return;
        }
 
        if (levelingConfig.blacklistedUsers?.includes(message.author.id)) return;
        if (!message.content || message.content.trim().length === 0) return;
 
        const userData = await getUserLevelData(client, message.guild.id, message.author.id);
 
        const cooldownTime = levelingConfig.xpCooldown || 60;
        const now = Date.now();
        const timeSinceLastMessage = now - (userData.lastMessage || 0);
        if (timeSinceLastMessage < cooldownTime * 1000) return;
 
        const minXP = levelingConfig.xpRange?.min || levelingConfig.xpPerMessage?.min || 15;
        const maxXP = levelingConfig.xpRange?.max || levelingConfig.xpPerMessage?.max || 25;
 
        const safeMinXP = Math.max(1, minXP);
        const safeMaxXP = Math.max(safeMinXP, maxXP);
 
        const xpToGive = Math.floor(Math.random() * (safeMaxXP - safeMinXP + 1)) + safeMinXP;
 
        let finalXP = xpToGive;
        if (levelingConfig.xpMultiplier && levelingConfig.xpMultiplier > 1) {
            finalXP = Math.floor(finalXP * levelingConfig.xpMultiplier);
        }
 
        const result = await addXp(client, message.guild, message.member, finalXP);
 
        if (result.success && result.leveledUp) {
            logger.info(`${message.author.tag} leveled up to level ${result.level} in ${message.guild.name}`);
        }
    } catch (error) {
        logger.error('Error handling leveling for message:', error);
    }
}
