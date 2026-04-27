export default {
    name: 'messageDelete',
    async execute(message, client) {
        try {
            // Ignore bots and empty messages
            if (!message.guild || message.author?.bot) return;
            if (!message.content && message.attachments.size === 0) return;
 
            const channelId = message.channel.id;
 
            // Clean expired messages first
            cleanExpired(channelId);
 
            const entry = {
                content: message.content || null,
                attachmentUrl: message.attachments.first()?.url || null,
                authorId: message.author?.id || null,
                authorTag: message.author?.tag || 'Unknown User',
                authorAvatar: message.author?.displayAvatarURL({ dynamic: true }) || null,
                deletedAt: Date.now(),
            };
 
            const current = snipeCache.get(channelId) || [];
 
            // Add to top, cap at 10
            current.unshift(entry);
            if (current.length > MAX_MESSAGES) current.pop();
 
            snipeCache.set(channelId, current);
        } catch (error) {
            logger.error('messageDelete (snipe) error:', error);
        }
    },
};
