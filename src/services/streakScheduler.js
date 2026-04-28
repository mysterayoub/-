// src/services/streakScheduler.js
// Runs at midnight Netherlands time (CET = UTC+1, CEST = UTC+2)
// Uses node-cron which is already in your dependencies
 
import cron from 'node-cron';
import {
    getAllActiveStreaks,
    breakStreak,
    incrementStreak,
    setFreezePending,
    getFreezesData,
    useFreeze,
    addFreezeBonus,
    clearFreezePending,
} from './streakService.js';
import { logger } from '../utils/logger.js';
 
// Netherlands timezone
const NL_TIMEZONE = 'Europe/Amsterdam';
 
// Streak roles config
const STREAK_ROLES = [
    { days: 100, name: 'Legend' },
    { days: 30, name: 'Consistent' },
    { days: 7, name: 'Active' },
];
 
async function assignStreakRoles(guild, userId, streakCount) {
    try {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return;
 
        for (const { days, name } of STREAK_ROLES) {
            const role = guild.roles.cache.find(r => r.name === name);
            if (!role) continue;
 
            if (streakCount >= days) {
                if (!member.roles.cache.has(role.id)) {
                    await member.roles.add(role).catch(() => {});
                }
            } else {
                if (member.roles.cache.has(role.id)) {
                    await member.roles.remove(role).catch(() => {});
                }
            }
        }
    } catch (err) {
        logger.error('Error assigning streak roles:', err);
    }
}
 
async function runMidnightCheck(client) {
    logger.info('Running midnight streak check (Netherlands time)...');
 
    for (const [guildId, guild] of client.guilds.cache) {
        try {
            const streaks = await getAllActiveStreaks(client, guildId);
            const alertChannel = guild.channels.cache.find(c => c.name === '✨・chat-general');
 
            for (const streak of streaks) {
                const { id, user1_id, user2_id, streak_count, highest_streak,
                        user1_interacted_today, user2_interacted_today } = streak;
 
                const bothInteracted = user1_interacted_today && user2_interacted_today;
 
                if (bothInteracted) {
                    // Increment streak
                    await incrementStreak(client, guildId, user1_id, user2_id);
                    const newCount = streak_count + 1;
 
                    // Assign roles to both users
                    await assignStreakRoles(guild, user1_id, newCount);
                    await assignStreakRoles(guild, user2_id, newCount);
 
                    // Give freeze bonuses at milestones
                    if (newCount === 30) {
                        await addFreezeBonus(client, guildId, user1_id, 1);
                        await addFreezeBonus(client, guildId, user2_id, 1);
                    }
                    if (newCount === 100) {
                        await addFreezeBonus(client, guildId, user1_id, 1);
                        await addFreezeBonus(client, guildId, user2_id, 1);
                    }
 
                    // Send warning at 2 hours before next midnight (22:00)
                    // This is handled by the 22:00 cron separately
 
                } else {
                    // Streak broken — post in chat-general with freeze button
                    await breakStreak(client, guildId, user1_id, user2_id);
 
                    // Set freeze pending for 24h
                    await setFreezePending(client, guildId, user1_id, user2_id);
 
                    // Remove streak roles
                    await assignStreakRoles(guild, user1_id, 0);
                    await assignStreakRoles(guild, user2_id, 0);
 
                    if (alertChannel) {
                        const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import('discord.js');
 
                        const freezeBtn = new ButtonBuilder()
                            .setCustomId(`freeze_streak_${user1_id}_${user2_id}`)
                            .setLabel('❄️ Use Freeze')
                            .setStyle(ButtonStyle.Primary);
 
                        const row = new ActionRowBuilder().addComponents(freezeBtn);
 
                        await alertChannel.send({
                            content:
                                `💔 <@${user1_id}> & <@${user2_id}> lost their 🔥 **${streak_count}** streak...\n` +
                                `> Highest ever: 🏆 **${highest_streak}**\n\n` +
                                `❄️ You have **24 hours** to use a freeze and save it!`,
                            components: [row],
                        }).catch(() => {});
                    }
                }
            }
        } catch (err) {
            logger.error(`Streak midnight check failed for guild ${guildId}:`, err);
        }
    }
}
 
async function runWarningCheck(client) {
    logger.info('Running streak warning check (Netherlands time)...');
 
    for (const [guildId, guild] of client.guilds.cache) {
        try {
            const streaks = await getAllActiveStreaks(client, guildId);
            const alertChannel = guild.channels.cache.find(c => c.name === '✨・chat-general');
            if (!alertChannel) continue;
 
            for (const streak of streaks) {
                const { user1_id, user2_id, streak_count, user1_interacted_today, user2_interacted_today } = streak;
                const bothInteracted = user1_interacted_today && user2_interacted_today;
                if (bothInteracted) continue; // They're good, no warning needed
 
                await alertChannel.send({
                    content: `⚠️ <@${user1_id}> & <@${user2_id}> — your 🔥 **${streak_count}** streak ends in **2 hours!** Go interact!`,
                }).catch(() => {});
            }
        } catch (err) {
            logger.error(`Streak warning check failed for guild ${guildId}:`, err);
        }
    }
}
 
export function startStreakScheduler(client) {
    // Midnight Netherlands time
    cron.schedule('0 0 * * *', () => runMidnightCheck(client), {
        timezone: NL_TIMEZONE,
    });
 
    // 22:00 Netherlands time — 2 hour warning
    cron.schedule('0 22 * * *', () => runWarningCheck(client), {
        timezone: NL_TIMEZONE,
    });
 
    logger.info('Streak scheduler started (Netherlands timezone)');
}
 
// Handle freeze button interactions
export async function handleFreezeButton(interaction, client) {
    const parts = interaction.customId.split('_');
    // customId: freeze_streak_user1_user2
    const user1_id = parts[2];
    const user2_id = parts[3];
    const guildId = interaction.guild.id;
    const clickerId = interaction.user.id;
 
    // Only the two streak users can press this
    if (clickerId !== user1_id && clickerId !== user2_id) {
        return interaction.reply({ content: '❌ Only the two users in this streak can use a freeze.', ephemeral: true });
    }
 
    const streak = await import('./streakService.js').then(m => m.getStreak(client, guildId, user1_id, user2_id));
 
    if (!streak || !streak.freeze_pending) {
        return interaction.reply({ content: '❌ This streak is no longer available to freeze.', ephemeral: true });
    }
 
    if (streak.freeze_pending_until < Date.now()) {
        return interaction.reply({ content: '❌ The 24-hour freeze window has passed.', ephemeral: true });
    }
 
    // Try to use a freeze from the clicker
    const froze = await useFreeze(client, guildId, clickerId);
    if (!froze) {
        const freezeData = await getFreezesData(client, guildId, clickerId);
        return interaction.reply({
            content: `❌ You have no freezes left! You have **${freezeData.freezes_available}** freezes available.`,
            ephemeral: true,
        });
    }
 
    // Restore the streak
    const { default: db } = await import('../utils/database.js').catch(() => ({ default: null }));
    const [u1, u2] = [user1_id, user2_id].sort();
    await client.db.query(
        `UPDATE streaks SET streak_count = highest_streak, freeze_pending = FALSE, freeze_pending_until = NULL, user1_interacted_today = FALSE, user2_interacted_today = FALSE WHERE guild_id = $1 AND user1_id = $2 AND user2_id = $3`,
        [guildId, u1, u2]
    );
 
    const freezeData = await getFreezesData(client, guildId, clickerId);
 
    // Disable the button
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import('discord.js');
    const disabledBtn = new ButtonBuilder()
        .setCustomId(`freeze_streak_${user1_id}_${user2_id}`)
        .setLabel('❄️ Freeze Used')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true);
 
    await interaction.update({
        content:
            `❄️ <@${clickerId}> used a freeze to save the streak between <@${user1_id}> & <@${user2_id}>!\n` +
            `🔥 Streak restored! (${freezeData.freezes_available} freezes remaining)`,
        components: [new ActionRowBuilder().addComponents(disabledBtn)],
    });
}
