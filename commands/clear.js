const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');

const ALLOWED_GUILDS = [
    "1412700210852794400",
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Clear messages in the channel')
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('Number of messages to delete (1-100)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100)
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('Only delete messages from this user (optional)')
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDMPermission(false),

    async execute(interaction) {
        // ⚡ IMPORTANT: Defer immediately to prevent timeout
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // Check if command is used in a server
        if (!interaction.guild) {
            return await interaction.editReply({
                content: "**This command can only be used in a server!**"
            });
        }

        // 🔒 SECURITY: Check if server is whitelisted
        if (!ALLOWED_GUILDS.includes(interaction.guild.id)) {
            console.log(`[SECURITY ALERT] Unauthorized /clear attempt!`);
            console.log(`Server: ${interaction.guild.name} (${interaction.guild.id})`);
            console.log(`User: ${interaction.user.tag} (${interaction.user.id})`);
            
            return await interaction.editReply({
                content: 
                    "**ACCESS DENIED**\n\n" +
                    "This bot is **private** and not authorized for this server.\n" +
                    "> This incident has been logged and reported."
            });
        }

        // Check if user has Manage Messages permission
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return await interaction.editReply({
                content: "**You don't have permission to use this command!**\n> Required: Manage Messages"
            });
        }

        // Check if bot has permission to delete messages
        if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return await interaction.editReply({
                content: "**I don't have permission to delete messages!**\n> Required: Manage Messages"
            });
        }

        const amount = interaction.options.getInteger('amount');
        const targetUser = interaction.options.getUser('user');

        try {

            // Fetch messages
            const fetchedMessages = await interaction.channel.messages.fetch({ 
                limit: 100 
            });

            let messagesToDelete;

            // Filter by user if specified
            if (targetUser) {
                messagesToDelete = fetchedMessages.filter(msg => msg.author.id === targetUser.id).first(amount);
            } else {
                messagesToDelete = Array.from(fetchedMessages.values()).slice(0, amount);
            }

            // Check if there are messages to delete
            if (messagesToDelete.length === 0) {
                return await interaction.editReply({
                    content: targetUser 
                        ? `No messages found from ${targetUser} in the last 100 messages.`
                        : "No messages found to delete."
                });
            }

            // Filter out messages older than 14 days
            const now = Date.now();
            const twoWeeks = 14 * 24 * 60 * 60 * 1000;
            const validMessages = messagesToDelete.filter(msg => 
                (now - msg.createdTimestamp) < twoWeeks
            );

            if (validMessages.length === 0) {
                return await interaction.editReply({
                    content: "All selected messages are older than 14 days and cannot be bulk deleted."
                });
            }

            // Delete messages
            const deleted = await interaction.channel.bulkDelete(validMessages, true);

            // Create success embed
            const embed = new EmbedBuilder()
                .setColor(0x00FF87)
                .setTitle("Messages Cleared")
                .setDescription(
                    `Successfully deleted **${deleted.size}** message(s)` +
                    (targetUser ? ` from ${targetUser}` : '') +
                    ` in ${interaction.channel}`
                )
                .addFields(
                    { 
                        name: "Details", 
                        value: 
                            `**Requested:** ${amount} message(s)\n` +
                            `**Deleted:** ${deleted.size} message(s)\n` +
                            `**Channel:** ${interaction.channel}\n` +
                            (targetUser ? `**Target User:** ${targetUser}\n` : '') +
                            `**Moderator:** ${interaction.user}`,
                        inline: false 
                    }
                )
                .setTimestamp()
                .setFooter({ text: `Cleared by ${interaction.user.tag}` });

            await interaction.editReply({
                embeds: [embed]
            });

            // Log to console
            console.log(`[CLEAR] ${interaction.user.tag} deleted ${deleted.size} messages in #${interaction.channel.name}` +
                (targetUser ? ` from ${targetUser.tag}` : ''));

            // Optional: Send log to a specific channel
            // Uncomment and configure if you want public logs
            /*
            const logChannelId = "YOUR_LOG_CHANNEL_ID";
            const logChannel = interaction.guild.channels.cache.get(logChannelId);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setColor("#FF6B6B")
                    .setTitle("🗑️ Messages Cleared")
                    .addFields(
                        { name: "Moderator", value: `${interaction.user} (${interaction.user.tag})`, inline: true },
                        { name: "Channel", value: `${interaction.channel}`, inline: true },
                        { name: "Amount", value: `${deleted.size} message(s)`, inline: true },
                        targetUser ? { name: "Target User", value: `${targetUser} (${targetUser.tag})`, inline: true } : null
                    )
                    .setTimestamp();
                
                await logChannel.send({ embeds: [logEmbed] });
            }
            */

        } catch (error) {
            console.error('[ERROR] Clear command failed:', error);
            
            let errorMsg = '**Failed to delete messages.**\n\n';
            
            if (error.code === 50013) {
                errorMsg += '> I don\'t have permission to delete messages.';
            } else if (error.message.includes('14 days')) {
                errorMsg += '> Messages older than 14 days cannot be bulk deleted.';
            } else {
                errorMsg += '> An unexpected error occurred. Please try again.';
            }
            
            try {
                await interaction.editReply({ content: errorMsg });
            } catch (replyError) {
                console.error('[ERROR] Failed to send error message:', replyError);
            }
        }
    }
};