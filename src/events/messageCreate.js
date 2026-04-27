import { Events, AttachmentBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getLevelingConfig, getUserLevelData } from '../services/leveling.js';
import { addXp } from '../services/xpSystem.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import https from 'https';
import http from 'http';
import { URL } from 'url';
 
const MESSAGE_XP_RATE_LIMIT_ATTEMPTS = 12;
const MESSAGE_XP_RATE_LIMIT_WINDOW_MS = 10000;
 
// ── TikTok Downloader ────────────────────────────────────────────────────────
 
const TIKTOK_REGEX = /https?:\/\/(www\.|vm\.|vt\.)?tiktok\.com\/[^\s]+/gi;
 
async function fetchBuffer(url, redirects = 5) {
    return new Promise((resolve, reject) => {
        if (redirects === 0) return reject(new Error('Too many redirects'));
        const parsed = new URL(url);
        const lib = parsed.protocol === 'https:' ? https : http;
        const req = lib.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            }
        }, (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                return resolve(fetchBuffer(res.headers.location, redirects - 1));
            }
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] }));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timed out')); });
    });
}
 
async function getTikTokVideo(url) {
    const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;
    const { buffer } = await fetchBuffer(apiUrl);
    const json = JSON.parse(buffer.toString());
 
    if (!json || json.code !== 0 || !json.data?.play) {
        throw new Error('Could not extract TikTok video');
    }
 
    const duration = json.data.duration || 0;
    if (duration > 180) throw new Error('VIDEO_TOO_LONG');
 
    const { buffer: videoBuffer } = await fetchBuffer(json.data.play);
    if (videoBuffer.byteLength > 24 * 1024 * 1024) throw new Error('VIDEO_TOO_LARGE');
 
    return { videoBuffer };
}
 
async function handleTikTok(message) {
    try {
        const matches = message.content.match(TIKTOK_REGEX);
        if (!matches) return;
 
        await message.channel.sendTyping();
 
        const textWithoutLinks = message.content.replace(TIKTOK_REGEX, '').trim();
 
        try {
            const { videoBuffer } = await getTikTokVideo(matches[0]);
            const attachment = new AttachmentBuilder(videoBuffer, { name: 'tiktok.mp4' });
 
            // Delete the original message
            await message.delete().catch(() => {});
 
            // Create a fresh webhook
            const webhook = await message.channel.createWebhook({
                name: message.member?.displayName || message.author.username,
                reason: 'TikTok video downloader',
            });
 
            // Send as the user
            await webhook.send({
                username: message.member?.displayName || message.author.username,
                avatarURL: message.author.displayAvatarURL({ dynamic: true }),
                content: textWithoutLinks || null,
                files: [attachment],
            });
 
            // Delete the webhook immediately after sending
            await webhook.delete('TikTok webhook cleanup').catch(() => {});
 
        } catch (err) {
            if (err.message === 'VIDEO_TOO_LONG') {
                await message.channel.send({ content: `⚠️ That TikTok is too long to upload (max 3 minutes).` });
            } else if (err.message === 'VIDEO_TOO_LARGE') {
                await message.channel.send({ content: `⚠️ That TikTok is too large to upload (max 25MB).` });
            } else {
                logger.warn(`TikTok download failed for ${matches[0]}:`, err.message);
            }
        }
    } catch (error) {
        logger.error('Error in TikTok handler:', error);
    }
}
 
// ── Automod ──────────────────────────────────────────────────────────────────
 
function normalise(str) {
    return str
        .toLowerCase()
        .replace(/[\u200B-\u200D\uFEFF\u00AD\u034F\u2060\u180E]/g, '')
        .replace(/[\s\-_.*,|\\\/'"`;:~^]+/g, '')
        .replace(/[^a-z0-9]/g, c => c);
}
 
const BLOCKED_PATTERNS = [
    /n[i!1|ï¡ì í î ïɪ]+[g9q6][g9q6][e3€3ëèéê]+[r|]/,
    /n[g9][g9]?[e3€]+[r|]/,
    /n[g9][g9]?[r|]/,
    /n[i!1|ï]+[g9q6][g9q6]/,
    /n[\-–—]+w[o0]rd/,
    /n[\*#@!?]{1,4}[e3]?[r|]?/,
    /n\s+[i!1]\s+[g9]\s+[g9]\s+[e3]\s+[r|]/,
    /nigg[a@4][^\w]?[r|]/,
];
 
function isBlocked(content) {
    const norm = normalise(content);
    const withoutAllowed = norm.replace(/nigga[sz]?/g, '');
    return BLOCKED_PATTERNS.some(p => p.test(withoutAllowed));
}
 
async function handleAutomod(message) {
    try {
        if (!message.content) return false;
 
        const bypassRole = message.guild.roles.cache.find(r => r.name === 'Automod bypass');
        if (bypassRole && message.member.roles.cache.has(bypassRole.id)) return false;
 
        if (!isBlocked(message.content)) return false;
 
        await message.delete().catch(() => {});
 
        const staffChannel = message.guild.channels.cache.find(c => c.name === '✨・staff-chat');
        if (!staffChannel) {
            logger.warn('Automod: Could not find ✨・staff-chat channel');
            return true;
        }
 
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
 
            handleTikTok(message).catch(err => logger.error('TikTok handler error:', err));
 
            await handleLeveling(message, client);
        } catch (error) {
            logger.error('Error in messageCreate event:', error);
        }
    }
};
 
// ── Leveling (unchanged) ─────────────────────────────────────────────────────
 
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
 
