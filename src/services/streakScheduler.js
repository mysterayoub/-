// src/services/streakScheduler.js
import cron from 'node-cron';
import {
    getAllActiveStreaks,
    breakStreak,
    incrementStreak,
    getFreezesData,
    useFreeze,
    addFreezeBonus,
    getStreak,
    saveStreak,
} from './streakService.js';
import { logger } from '../utils/logger.js';
 
const NL_TIMEZONE = 'Europe/Amsterdam';
 
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
                const { user1_id, user2_id, streak_count, highest_streak,
                        user1_interacted_today, user2_interacted_today } = streak;
 
                const bothInteracted = user1_interacted_today && user2_interacted_today;
 
                if (bothInteracted) {
                    const updated = await incrementStreak(client, guildId, user1_id, user2_id);
                    const newCount = updated.streak_count;
 
                    await assignStreakRoles(guild, user1_id, newCount);
                    await assignStreakRoles(guild, user2_id, newCount);
 
                    if (newCount === 30) {
                        await addFreezeBonus(client, guildId, user1_id, 1);
                        await addFreezeBonus(client, guildId, user2_id, 1);
                    }
                    if (newCount === 100) {
                        await addFreezeBonus(client, guildId, user1_id, 1);
                        await addFreezeBonus(client, guildId, user2_id, 1);
                    }
                } else {
                    await breakStreak(client, guildId, user1_id, user2_id);
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
                                `❄️ Either of you can use a freeze within **24 hours** to save it!`,
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
    logger.info('Running streak warning check...');
 
    for (const [guildId, guild] of client.guilds.cache) {
        try {
            const streaks = await getAllActiveStreaks(client, guildId);
            const alertChannel = guild.channels.cache.find(c => c.name === '✨・chat-general');
            if (!alertChannel) continue;
 
            for (const streak of streaks) {
                const { user1_id, user2_id, streak_count, user1_interacted_today, user2_interacted_today } = streak;
                if (user1_interacted_today && user2_interacted_today) continue;
 
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
 
// ── Freeze button handler ─────────────────────────────────────────────────────
 
export async function handleFreezeButton(interaction, client) {
    const parts = interaction.customId.split('_');
    const user1_id = parts[2];
    const user2_id = parts[3];
    const guildId = interaction.guild.id;
    const clickerId = interaction.user.id;
 
    if (clickerId !== user1_id && clickerId !== user2_id) {
        return interaction.reply({ content: '❌ Only the two users in this streak can use a freeze.', ephemeral: true });
    }
 
    const streak = await getStreak(client, guildId, user1_id, user2_id);
 
    if (!streak || !streak.freeze_pending) {
        return interaction.reply({ content: '❌ This streak is no longer available to freeze.', ephemeral: true });
    }
 
    if (streak.freeze_pending_until < Date.now()) {
        return interaction.reply({ content: '❌ The 24-hour freeze window has passed.', ephemeral: true });
    }
 
    const froze = await useFreeze(client, guildId, clickerId);
    if (!froze) {
        const freezeData = await getFreezesData(client, guildId, clickerId);
        return interaction.reply({
            content: `❌ You have no freezes left! You currently have **${freezeData.freezes_available}** freezes.`,
            ephemeral: true,
        });
    }
 
    // Restore streak
    streak.streak_count = streak.highest_streak;
    streak.freeze_pending = false;
    streak.freeze_pending_until = null;
    streak.user1_interacted_today = false;
    streak.user2_interacted_today = false;
    await saveStreak(client, guildId, user1_id, user2_id, streak);
 
    const freezeData = await getFreezesData(client, guildId, clickerId);
 
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import('discord.js');
    const disabledBtn = new ButtonBuilder()
        .setCustomId(`freeze_streak_${user1_id}_${user2_id}`)
        .setLabel('❄️ Freeze Used')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true);
 
    await interaction.update({
        content:
            `❄️ <@${clickerId}> used a freeze to save the streak between <@${user1_id}> & <@${user2_id}>!\n` +
            `🔥 Streak restored! (**${freezeData.freezes_available}** freezes remaining)`,
        components: [new ActionRowBuilder().addComponents(disabledBtn)],
    });
}
