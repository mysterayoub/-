import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getLevelingConfig, getUserLevelData } from '../services/leveling.js';
import { addXp } from '../services/xpSystem.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
 
const MESSAGE_XP_RATE_LIMIT_ATTEMPTS = 12;
const MESSAGE_XP_RATE_LIMIT_WINDOW_MS = 10000;
 
// ── Automod ──────────────────────────────────────────────────────────────────
 
// Normalise the message before checking — strips zero-width chars, repeated
// punctuation used as spacers, and lowercases everything.
function normalise(str) {
    return str
        .toLowerCase()
        // Remove zero-width / invisible unicode characters
        .replace(/[\u200B-\u200D\uFEFF\u00AD\u034F\u2060\u180E]/g, '')
        // Remove common spacer characters people put between letters
        .replace(/[\s\-_.*,|\\\/'"`;:~^]+/g, '')
        // Collapse repeated special chars
        .replace(/[^a-z0-9]/g, c => c);
}
 
// Each pattern is tested against the normalised string.
// We block "nigger" and all its variants but NOT "nigga" or "niggas".
const BLOCKED_PATTERNS = [
    // Core word and leet-speak substitutions
    // n + i variants + gg variants + e variants + r variants
    /n[i!1|ï¡ì í î ïɪ]+[g9q6][g9q6][e3€3ëèéê]+[r|]/,
 
    // Shortened: "nger", "ng3r", "n9er", etc. (missing the i)
    /n[g9][g9]?[e3€]+[r|]/,
 
    // "ngr" (fully stripped vowels)
    /n[g9][g9]?[r|]/,
 
    // "nigg" without the "er" ending (people just posting the slur cut short)
    /n[i!1|ï]+[g9q6][g9q6]/,
 
    // "n-word" written literally
    /n[\-–—]+w[o0]rd/,
 
    // Asterisk/symbol masks like n***er, n**ger, n*gger
    /n[\*#@!?]{1,4}[e3]?[r|]?/,
 
    // Spaced out: n i g g e r
    /n\s+[i!1]\s+[g9]\s+[g9]\s+[e3]\s+[r|]/,
 
    // Hard r written as separate word after "nigga": "nigga r"
    /nigg[a@4][^\w]?[r|]/,
];
 
function isBlocked(content) {
    const norm = normalise(content);
 
    // Whitelist: pure "nigga" or "niggas" — do not block these
    // We strip them out before checking so they don't accidentally match
    const withoutAllowed = norm.replace(/nigga[sz]?/g, '');
 
    return BLOCKED_PATTERNS.some(p => p.test(withoutAllowed));
}
 
async function handleAutomod(message) {
    try {
        if (!message.content) return false;
 
        // Check if user has the "Automod bypass" role
        const bypassRole = message.guild.roles.cache.find(r => r.name === 'Automod bypass');
        if (bypassRole && message.member.roles.cache.has(bypassRole.id)) return false;
 
        if (!isBlocked(message.content)) return false;
 
        // Delete the offending message
        await message.delete().catch(() => {});
 
        // Find staff-chat channel
        const staffChannel = message.guild.channels.cache.find(
            c => c.name === '✨・staff-chat'
        );
        if (!staffChannel) {
            logger.warn('Automod: Could not find ✨・staff-chat channel');
            return true;
        }
 
        // Find Staff role
        const staffRole = message.guild.roles.cache.find(r => r.name === 'Staff');
        const staffMention = staffRole ? staffRole.toString() : '@Staff';
 
        await staffChannel.send(
            `${staffMention}\n` +
            `⚠️ **Automod triggered** in ${message.channel.toString()}\n\n` +
            `**User:** ${message.author.tag} (${message.author.toString()} | ID: \`${message.author.id}\`)\n` +
            `**Message:** \`${message.content}\`\n` +
            `**Channel:** ${message.channel.toString()} (\`${message.channel.id}\`)\n` +
            `**Time:** <t:${Math.floor(Date.now() / 1000)}:F>`
        );
 
        logger.info(`Automod: Deleted message from ${message.author.tag} in ${message.guild.name}`);
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
