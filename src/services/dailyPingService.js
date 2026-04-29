// src/services/dailyPingService.js
import cron from 'node-cron';
import { logger } from '../utils/logger.js';
 
const USER_ID = '1117508136434155540';
const CHANNEL_NAME = '✨・chat-general';
const NL_TIMEZONE = 'Europe/Amsterdam';
 
export function startDailyPingScheduler(client) {
    // Every day at 13:00 Netherlands time
    cron.schedule('0 13 * * *', async () => {
        try {
            for (const [guildId, guild] of client.guilds.cache) {
                const channel = guild.channels.cache.find(c => c.name === CHANNEL_NAME);
                if (!channel) continue;
 
                await channel.send(`⏰ <@${USER_ID}> ping the bot!`).catch(() => {});
            }
        } catch (err) {
            logger.error('Daily ping error:', err);
        }
    }, {
        timezone: NL_TIMEZONE,
    });
 
    logger.info('Daily ping scheduler started (13:00 Netherlands time)');
}
