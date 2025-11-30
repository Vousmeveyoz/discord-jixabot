const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags } = require('discord.js');

const ALLOWED_GUILDS = ["1412700210852794400"];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Send a modern announcement to a channel')
        .addStringOption(option =>
            option
                .setName('title')
                .setDescription('Announcement title')
                .setRequired(true)
                .setMaxLength(256)
        )
        .addStringOption(option =>
            option
                .setName('message')
                .setDescription('Announcement message')
                .setRequired(true)
                .setMaxLength(4000)
        )
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('Channel to send announcement')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('type')
                .setDescription('Announcement type/style')
                .setRequired(false)
                .addChoices(
                    { name: '📢 General', value: 'general' },
                    { name: '🎉 Event', value: 'event' },
                    { name: '⚠️ Important', value: 'important' },
                    { name: '🔔 Update', value: 'update' },
                    { name: '🎁 Giveaway', value: 'giveaway' },
                    { name: '🚨 Alert', value: 'alert' }
                )
        )
        .addStringOption(option =>
            option
                .setName('image')
                .setDescription('Image URL (optional)')
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('thumbnail')
                .setDescription('Thumbnail URL (optional)')
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('footer')
                .setDescription('Footer text (optional)')
                .setRequired(false)
                .setMaxLength(2048)
        )
        .addRoleOption(option =>
            option
                .setName('ping')
                .setDescription('Role to ping (optional)')
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDMPermission(false),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!interaction.guild) {
            return await interaction.editReply({
                content: "**This command can only be used in a server!**"
            });
        }

        if (!ALLOWED_GUILDS.includes(interaction.guild.id)) {
            console.log(`[SECURITY] Unauthorized /announce - Server: ${interaction.guild.name} (${interaction.guild.id}) - User: ${interaction.user.tag}`);
            return await interaction.editReply({
                content: "**ACCESS DENIED**\n\nThis bot is **private** and not authorized for this server.\n> This incident has been logged and reported."
            });
        }

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return await interaction.editReply({
                content: "**You don't have permission to use this command!**\n> Required: Manage Messages"
            });
        }

        const title = interaction.options.getString('title');
        const message = interaction.options.getString('message');
        const targetChannel = interaction.options.getChannel('channel');
        const type = interaction.options.getString('type') || 'general';
        const imageUrl = interaction.options.getString('image');
        const thumbnailUrl = interaction.options.getString('thumbnail');
        const footerText = interaction.options.getString('footer');
        const pingRole = interaction.options.getRole('ping');

        if (!targetChannel.send) {
            return await interaction.editReply({
                content: `**Cannot send messages to ${targetChannel}!**\n> This channel type doesn't support sending messages.`
            });
        }

        const botPermissions = targetChannel.permissionsFor(interaction.guild.members.me);
        if (!botPermissions || !botPermissions.has(PermissionFlagsBits.SendMessages)) {
            return await interaction.editReply({
                content: `**I don't have permission in ${targetChannel}!**\n> Required: Send Messages`
            });
        }

        // Style configuration based on type
        const styles = {
            general: { color: 0x5865F2, emoji: '📢', label: 'General Announcement' },
            event: { color: 0xFEE75C, emoji: '🎉', label: 'Event Announcement' },
            important: { color: 0xED4245, emoji: '⚠️', label: 'Important Notice' },
            update: { color: 0x57F287, emoji: '🔔', label: 'Update Notice' },
            giveaway: { color: 0xEB459E, emoji: '🎁', label: 'Giveaway' },
            alert: { color: 0xFF6B6B, emoji: '🚨', label: 'Alert' }
        };

        const style = styles[type];

        try {
            // Create modern embed
            const embed = new EmbedBuilder()
                .setColor(style.color)
                .setTitle(`${style.emoji} ${title}`)
                .setDescription(message)
                .setTimestamp()
                .setFooter({ 
                    text: footerText || `${style.label} • Posted by ${interaction.user.tag}`,
                    iconURL: interaction.user.displayAvatarURL()
                });

            if (imageUrl) {
                embed.setImage(imageUrl);
            }

            if (thumbnailUrl) {
                embed.setThumbnail(thumbnailUrl);
            }

            // Create button row (optional interactive elements)
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('announce_react')
                        .setLabel('✓ Acknowledged')
                        .setStyle(ButtonStyle.Success)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setLabel('View Server')
                        .setStyle(ButtonStyle.Link)
                        .setURL(`https://discord.com/channels/${interaction.guild.id}`)
                );

            // Send announcement
            const content = pingRole ? `${pingRole}` : null;
            
            await targetChannel.send({
                content: content,
                embeds: [embed],
                components: [row]
            });

            // Success response
            const successEmbed = new EmbedBuilder()
                .setColor(0x57F287)
                .setTitle('Announcement Sent Successfully!')
                .setDescription(`Your announcement has been posted to ${targetChannel}`)
                .addFields(
                    { name: 'Title', value: title, inline: false },
                    { name: 'Type', value: style.label, inline: true },
                    { name: 'Channel', value: `${targetChannel}`, inline: true }
                )
                .setTimestamp();

            await interaction.editReply({ embeds: [successEmbed] });

            console.log(`[ANNOUNCE] ${interaction.user.tag} posted "${title}" to #${targetChannel.name}`);

        } catch (error) {
            console.error('[ERROR] Announce command failed:', error);

            const errorMsg = `**Failed to send announcement.**\n\n${
                error.code === 50013 
                    ? '> I don\'t have permission to send messages in that channel.' 
                    : '> An unexpected error occurred. Please try again.'
            }`;

            await interaction.editReply({ content: errorMsg }).catch(console.error);
        }
    }
};
