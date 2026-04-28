// src/services/streakDetector.js
import {
    getStreak,
    createStreak,
    updateStreakInteraction,
    countUserStreaks,
    checkInteractionCooldown,
    recordInteraction,
} from './streakService.js';
import { logger } from '../utils/logger.js';
 
const STREAK_CHANNELS = ['✨・chat-general'];
const MIN_MSG_LENGTH = 5;
 
function isValidStreakChannel(channelName) {
    return STREAK_CHANNELS.includes(channelName);
}
 
function isValidMessage(content) {
    if (!content) return false;
    return content.trim().length >= MIN_MSG_LENGTH;
}
 
function detectTarget(message) {
    // Reply to someone
    if (message.reference?.messageId) {
        const repliedTo = message.channel.messages.cache.get(message.reference.messageId);
        if (repliedTo && repliedTo.author && !repliedTo.author.bot && repliedTo.author.id !== message.author.id) {
            return repliedTo.author.id;
        }
    }
 
    // Mention someone
    const mentions = message.mentions.users.filter(u => !u.bot && u.id !== message.author.id);
    if (mentions.size === 1) {
        return mentions.first().id;
    }
 
    return null;
}
 
export async function handleStreakInteraction(message, client) {
    try {
        if (!message.guild) return;
        if (message.author.bot) return;
        if (!isValidStreakChannel(message.channel.name)) return;
        if (!isValidMessage(message.content)) return;
 
        const targetId = detectTarget(message);
        if (!targetId) return;
 
        const userId = message.author.id;
        const guildId = message.guild.id;
 
        const canInteract = await checkInteractionCooldown(client, guildId, userId, targetId);
        if (!canInteract) return;
 
        await recordInteraction(client, guildId, userId, targetId);
 
        const existing = await getStreak(client, guildId, userId, targetId);
 
        if (!existing || existing.streak_count === 0) {
            const userCount = await countUserStreaks(client, guildId, userId);
            const targetCount = await countUserStreaks(client, guildId, targetId);
            if (userCount >= 10 || targetCount >= 10) return;
 
            await createStreak(client, guildId, userId, targetId);
 
            const botChannel = message.guild.channels.cache.find(c => c.name === '🤖・bot-commands');
            if (botChannel) {
                await botChannel.send(
                    `🔥 <@${userId}> & <@${targetId}> just started a streak! Keep interacting daily to grow it!`
                ).catch(() => {});
            }
        } else {
            await updateStreakInteraction(client, guildId, userId, targetId, userId);
        }
    } catch (err) {
        logger.error('Error in streak interaction handler:', err);
    }
}
