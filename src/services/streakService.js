// src/services/streakService.js
import { logger } from '../utils/logger.js';
 
// Key helpers
const streakKey = (guildId, u1, u2) => {
    const [a, b] = [u1, u2].sort();
    return `streaks:${guildId}:${a}:${b}`;
};
const freezeKey = (guildId, userId) => `streak-freezes:${guildId}:${userId}`;
const cooldownKey = (guildId, u1, u2) => {
    const [a, b] = [u1, u2].sort();
    return `streak-cooldown:${guildId}:${a}:${b}`;
};
const userIndexKey = (guildId, userId) => `streak-index:${guildId}:${userId}`;
const guildIndexKey = (guildId) => `streak-guild-index:${guildId}`;
 
// ── Streak CRUD ───────────────────────────────────────────────────────────────
 
export async function getStreak(client, guildId, userId1, userId2) {
    const [u1, u2] = [userId1, userId2].sort();
    return await client.db.get(streakKey(guildId, u1, u2)) || null;
}
 
export async function createStreak(client, guildId, userId1, userId2) {
    const [u1, u2] = [userId1, userId2].sort();
    const key = streakKey(guildId, u1, u2);
    const now = Date.now();
 
    const existing = await client.db.get(key);
    if (existing) return existing;
 
    const streak = {
        guildId,
        user1_id: u1,
        user2_id: u2,
        streak_count: 1,
        highest_streak: 1,
        user1_interacted_today: false,
        user2_interacted_today: false,
        freeze_pending: false,
        freeze_pending_until: null,
        created_at: now,
        last_interaction: now,
    };
 
    await client.db.set(key, streak);
 
    // Add to user indexes
    await addToUserIndex(client, guildId, u1, key);
    await addToUserIndex(client, guildId, u2, key);
    await addToGuildIndex(client, guildId, key);
 
    return streak;
}
 
export async function saveStreak(client, guildId, userId1, userId2, data) {
    const [u1, u2] = [userId1, userId2].sort();
    await client.db.set(streakKey(guildId, u1, u2), data);
}
 
export async function deleteStreak(client, guildId, userId1, userId2) {
    const [u1, u2] = [userId1, userId2].sort();
    const key = streakKey(guildId, u1, u2);
    await client.db.delete(key);
    await removeFromUserIndex(client, guildId, u1, key);
    await removeFromUserIndex(client, guildId, u2, key);
    await removeFromGuildIndex(client, guildId, key);
}
 
export async function updateStreakInteraction(client, guildId, userId1, userId2, actorId) {
    const streak = await getStreak(client, guildId, userId1, userId2);
    if (!streak) return;
 
    const [u1] = [userId1, userId2].sort();
    if (actorId === u1) {
        streak.user1_interacted_today = true;
    } else {
        streak.user2_interacted_today = true;
    }
    streak.last_interaction = Date.now();
 
    await saveStreak(client, guildId, userId1, userId2, streak);
}
 
export async function incrementStreak(client, guildId, userId1, userId2) {
    const streak = await getStreak(client, guildId, userId1, userId2);
    if (!streak) return;
 
    streak.streak_count += 1;
    streak.highest_streak = Math.max(streak.highest_streak, streak.streak_count);
    streak.user1_interacted_today = false;
    streak.user2_interacted_today = false;
 
    await saveStreak(client, guildId, userId1, userId2, streak);
    return streak;
}
 
export async function breakStreak(client, guildId, userId1, userId2) {
    const streak = await getStreak(client, guildId, userId1, userId2);
    if (!streak) return;
 
    streak.streak_count = 0;
    streak.user1_interacted_today = false;
    streak.user2_interacted_today = false;
    streak.freeze_pending = true;
    streak.freeze_pending_until = Date.now() + 86400000; // 24h
 
    await saveStreak(client, guildId, userId1, userId2, streak);
    return streak;
}
 
export async function getUserStreaks(client, guildId, userId) {
    const index = await client.db.get(userIndexKey(guildId, userId)) || [];
    const streaks = [];
 
    for (const key of index) {
        const s = await client.db.get(key);
        if (s && s.streak_count > 0) streaks.push(s);
    }
 
    return streaks.sort((a, b) => b.streak_count - a.streak_count);
}
 
export async function countUserStreaks(client, guildId, userId) {
    const streaks = await getUserStreaks(client, guildId, userId);
    return streaks.length;
}
 
export async function getAllActiveStreaks(client, guildId) {
    const index = await client.db.get(guildIndexKey(guildId)) || [];
    const streaks = [];
 
    for (const key of index) {
        const s = await client.db.get(key);
        if (s && s.streak_count > 0) streaks.push(s);
    }
 
    return streaks;
}
 
export async function getTopStreaks(client, guildId, limit = 10) {
    const streaks = await getAllActiveStreaks(client, guildId);
    return streaks.sort((a, b) => b.streak_count - a.streak_count).slice(0, limit);
}
 
// ── Index helpers ─────────────────────────────────────────────────────────────
 
async function addToUserIndex(client, guildId, userId, key) {
    const index = await client.db.get(userIndexKey(guildId, userId)) || [];
    if (!index.includes(key)) {
        index.push(key);
        await client.db.set(userIndexKey(guildId, userId), index);
    }
}
 
async function removeFromUserIndex(client, guildId, userId, key) {
    const index = await client.db.get(userIndexKey(guildId, userId)) || [];
    const updated = index.filter(k => k !== key);
    await client.db.set(userIndexKey(guildId, userId), updated);
}
 
async function addToGuildIndex(client, guildId, key) {
    const index = await client.db.get(guildIndexKey(guildId)) || [];
    if (!index.includes(key)) {
        index.push(key);
        await client.db.set(guildIndexKey(guildId), index);
    }
}
 
async function removeFromGuildIndex(client, guildId, key) {
    const index = await client.db.get(guildIndexKey(guildId)) || [];
    const updated = index.filter(k => k !== key);
    await client.db.set(guildIndexKey(guildId), updated);
}
 
// ── Freeze management ─────────────────────────────────────────────────────────
 
export async function getFreezesData(client, guildId, userId) {
    const key = freezeKey(guildId, userId);
    const now = Date.now();
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
 
    let data = await client.db.get(key);
 
    if (!data) {
        data = { freezes_available: 3, last_reset: now };
        await client.db.set(key, data);
        return data;
    }
 
    // Reset if new month
    if (data.last_reset < startOfMonth.getTime()) {
        data.freezes_available = 3;
        data.last_reset = now;
        await client.db.set(key, data);
    }
 
    return data;
}
 
export async function useFreeze(client, guildId, userId) {
    const data = await getFreezesData(client, guildId, userId);
    if (data.freezes_available <= 0) return false;
 
    data.freezes_available -= 1;
    await client.db.set(freezeKey(guildId, userId), data);
    return true;
}
 
export async function addFreezeBonus(client, guildId, userId, amount) {
    const data = await getFreezesData(client, guildId, userId);
    data.freezes_available += amount;
    await client.db.set(freezeKey(guildId, userId), data);
}
 
// ── Interaction cooldown (15 seconds) ────────────────────────────────────────
 
export async function checkInteractionCooldown(client, guildId, userId, targetId) {
    const key = cooldownKey(guildId, userId, targetId);
    const last = await client.db.get(key);
    if (!last) return true;
    return Date.now() - last > 15000;
}
 
export async function recordInteraction(client, guildId, userId, targetId) {
    const key = cooldownKey(guildId, userId, targetId);
    await client.db.set(key, Date.now());
}
 
