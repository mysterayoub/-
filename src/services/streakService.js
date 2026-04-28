// src/services/streakService.js
// Handles all database operations for the streak system
 
export async function ensureStreakTables(client) {
    await client.db.query(`
        CREATE TABLE IF NOT EXISTS streaks (
            id SERIAL PRIMARY KEY,
            guild_id TEXT NOT NULL,
            user1_id TEXT NOT NULL,
            user2_id TEXT NOT NULL,
            streak_count INTEGER DEFAULT 1,
            highest_streak INTEGER DEFAULT 1,
            last_interaction BIGINT NOT NULL,
            user1_interacted_today BOOLEAN DEFAULT FALSE,
            user2_interacted_today BOOLEAN DEFAULT FALSE,
            freeze_pending BOOLEAN DEFAULT FALSE,
            freeze_pending_until BIGINT,
            created_at BIGINT NOT NULL,
            UNIQUE(guild_id, user1_id, user2_id)
        );
 
        CREATE TABLE IF NOT EXISTS streak_freezes (
            user_id TEXT NOT NULL,
            guild_id TEXT NOT NULL,
            freezes_available INTEGER DEFAULT 3,
            last_reset BIGINT NOT NULL,
            PRIMARY KEY (user_id, guild_id)
        );
 
        CREATE TABLE IF NOT EXISTS streak_interactions (
            id SERIAL PRIMARY KEY,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            target_id TEXT NOT NULL,
            timestamp BIGINT NOT NULL
        );
 
        CREATE TABLE IF NOT EXISTS breakstreak_requests (
            id SERIAL PRIMARY KEY,
            guild_id TEXT NOT NULL,
            streak_id INTEGER NOT NULL,
            requester_id TEXT NOT NULL,
            target_id TEXT NOT NULL,
            message_id TEXT,
            created_at BIGINT NOT NULL
        );
    `).catch(() => {}); // Tables may already exist
}
 
// Get streak between two users (order-independent)
export async function getStreak(client, guildId, userId1, userId2) {
    const [u1, u2] = [userId1, userId2].sort();
    const result = await client.db.query(
        `SELECT * FROM streaks WHERE guild_id = $1 AND user1_id = $2 AND user2_id = $3`,
        [guildId, u1, u2]
    );
    return result.rows[0] || null;
}
 
// Create a new streak between two users
export async function createStreak(client, guildId, userId1, userId2) {
    const [u1, u2] = [userId1, userId2].sort();
    const now = Date.now();
    const result = await client.db.query(
        `INSERT INTO streaks (guild_id, user1_id, user2_id, streak_count, highest_streak, last_interaction, user1_interacted_today, user2_interacted_today, created_at)
         VALUES ($1, $2, $3, 1, 1, $4, FALSE, FALSE, $4)
         ON CONFLICT (guild_id, user1_id, user2_id) DO NOTHING
         RETURNING *`,
        [guildId, u1, u2, now]
    );
    return result.rows[0] || null;
}
 
// Update streak after valid interaction
export async function updateStreakInteraction(client, guildId, userId1, userId2, actorId) {
    const [u1, u2] = [userId1, userId2].sort();
    const field = actorId === u1 ? 'user1_interacted_today' : 'user2_interacted_today';
    await client.db.query(
        `UPDATE streaks SET ${field} = TRUE, last_interaction = $1 WHERE guild_id = $2 AND user1_id = $3 AND user2_id = $4`,
        [Date.now(), guildId, u1, u2]
    );
}
 
// Increment streak count
export async function incrementStreak(client, guildId, userId1, userId2) {
    const [u1, u2] = [userId1, userId2].sort();
    await client.db.query(
        `UPDATE streaks
         SET streak_count = streak_count + 1,
             highest_streak = GREATEST(highest_streak, streak_count + 1),
             user1_interacted_today = FALSE,
             user2_interacted_today = FALSE
         WHERE guild_id = $1 AND user1_id = $2 AND user2_id = $3`,
        [guildId, u1, u2]
    );
}
 
// Reset streak to 0 (broken)
export async function breakStreak(client, guildId, userId1, userId2) {
    const [u1, u2] = [userId1, userId2].sort();
    await client.db.query(
        `UPDATE streaks SET streak_count = 0, user1_interacted_today = FALSE, user2_interacted_today = FALSE WHERE guild_id = $1 AND user1_id = $2 AND user2_id = $3`,
        [guildId, u1, u2]
    );
}
 
// Delete streak entirely (from /breakstreak command)
export async function deleteStreak(client, guildId, userId1, userId2) {
    const [u1, u2] = [userId1, userId2].sort();
    await client.db.query(
        `DELETE FROM streaks WHERE guild_id = $1 AND user1_id = $2 AND user2_id = $3`,
        [guildId, u1, u2]
    );
}
 
// Get all active streaks for a user
export async function getUserStreaks(client, guildId, userId) {
    const result = await client.db.query(
        `SELECT * FROM streaks WHERE guild_id = $1 AND (user1_id = $2 OR user2_id = $2) AND streak_count > 0 ORDER BY streak_count DESC`,
        [guildId, userId]
    );
    return result.rows;
}
 
// Count active streaks for a user
export async function countUserStreaks(client, guildId, userId) {
    const result = await client.db.query(
        `SELECT COUNT(*) FROM streaks WHERE guild_id = $1 AND (user1_id = $2 OR user2_id = $2) AND streak_count > 0`,
        [guildId, userId]
    );
    return parseInt(result.rows[0].count);
}
 
// Get top streaks in server
export async function getTopStreaks(client, guildId, limit = 10) {
    const result = await client.db.query(
        `SELECT * FROM streaks WHERE guild_id = $1 AND streak_count > 0 ORDER BY streak_count DESC LIMIT $2`,
        [guildId, limit]
    );
    return result.rows;
}
 
// Get all streaks due for midnight check
export async function getAllActiveStreaks(client, guildId) {
    const result = await client.db.query(
        `SELECT * FROM streaks WHERE guild_id = $1 AND streak_count > 0`,
        [guildId]
    );
    return result.rows;
}
 
// Freeze management
export async function getFreezesData(client, guildId, userId) {
    const now = Date.now();
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
 
    let result = await client.db.query(
        `SELECT * FROM streak_freezes WHERE user_id = $1 AND guild_id = $2`,
        [userId, guildId]
    );
 
    if (!result.rows[0]) {
        result = await client.db.query(
            `INSERT INTO streak_freezes (user_id, guild_id, freezes_available, last_reset) VALUES ($1, $2, 3, $3) RETURNING *`,
            [userId, guildId, now]
        );
    }
 
    const data = result.rows[0];
 
    // Reset freezes if it's a new month
    if (data.last_reset < startOfMonth.getTime()) {
        result = await client.db.query(
            `UPDATE streak_freezes SET freezes_available = 3, last_reset = $1 WHERE user_id = $2 AND guild_id = $3 RETURNING *`,
            [now, userId, guildId]
        );
        return result.rows[0];
    }
 
    return data;
}
 
export async function useFreeze(client, guildId, userId) {
    const data = await getFreezesData(client, guildId, userId);
    if (data.freezes_available <= 0) return false;
 
    await client.db.query(
        `UPDATE streak_freezes SET freezes_available = freezes_available - 1 WHERE user_id = $1 AND guild_id = $2`,
        [userId, guildId]
    );
    return true;
}
 
export async function addFreezeBonus(client, guildId, userId, amount) {
    await client.db.query(
        `UPDATE streak_freezes SET freezes_available = freezes_available + $1 WHERE user_id = $2 AND guild_id = $3`,
        [amount, userId, guildId]
    );
}
 
// Interaction cooldown check (15 seconds)
export async function checkInteractionCooldown(client, guildId, userId, targetId) {
    const [u1, u2] = [userId, targetId].sort();
    const fifteenSecondsAgo = Date.now() - 15000;
    const result = await client.db.query(
        `SELECT * FROM streak_interactions WHERE guild_id = $1 AND ((user_id = $2 AND target_id = $3) OR (user_id = $3 AND target_id = $2)) AND timestamp > $4 ORDER BY timestamp DESC LIMIT 1`,
        [guildId, u1, u2, fifteenSecondsAgo]
    );
    return result.rows.length === 0; // true = can interact
}
 
export async function recordInteraction(client, guildId, userId, targetId) {
    await client.db.query(
        `INSERT INTO streak_interactions (guild_id, user_id, target_id, timestamp) VALUES ($1, $2, $3, $4)`,
        [guildId, userId, targetId, Date.now()]
    );
 
    // Clean up old interactions older than 24h
    await client.db.query(
        `DELETE FROM streak_interactions WHERE timestamp < $1`,
        [Date.now() - 86400000]
    );
}
 
// Set freeze pending on a broken streak (for the button)
export async function setFreezePending(client, guildId, userId1, userId2) {
    const [u1, u2] = [userId1, userId2].sort();
    const until = Date.now() + 86400000; // 24 hours
    await client.db.query(
        `UPDATE streaks SET freeze_pending = TRUE, freeze_pending_until = $1 WHERE guild_id = $2 AND user1_id = $3 AND user2_id = $4`,
        [until, guildId, u1, u2]
    );
}
 
export async function clearFreezePending(client, guildId, userId1, userId2) {
    const [u1, u2] = [userId1, userId2].sort();
    await client.db.query(
        `UPDATE streaks SET freeze_pending = FALSE, freeze_pending_until = NULL WHERE guild_id = $1 AND user1_id = $2 AND user2_id = $3`,
        [guildId, u1, u2]
    );
}
