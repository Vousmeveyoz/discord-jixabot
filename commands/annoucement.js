const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

const ALLOWED_GUILDS = ["1412700210852794400"];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Send an announcement to a channel')
        .addStringOption(option =>
            option
                .setName('message')
                .setDescription('Announcement message')
                .setRequired(true)
                .setMaxLength(2000)
        )
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('Channel to send announcement')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('url')
                .setDescription('URL/Link to include (optional)')
                .setRequired(false)
        )
        .addAttachmentOption(option =>
            option
                .setName('image')
                .setDescription('Image file to attach (optional)')
                .setRequired(false)
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

        const message = interaction.options.getString('message');
        const targetChannel = interaction.options.getChannel('channel');
        const urlLink = interaction.options.getString('url');
        const imageFile = interaction.options.getAttachment('image');
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

        try {
            // Validate URL if provided
            if (urlLink) {
                try {
                    new URL(urlLink);
                } catch (e) {
                    return await interaction.editReply({
                        content: "**Invalid URL!**\n> Please provide a valid URL (must start with http:// or https://)"
                    });
                }
            }

            // Validate image file if provided
            if (imageFile && !imageFile.contentType?.startsWith('image/')) {
                return await interaction.editReply({
                    content: "**Invalid file type!**\n> Please upload an image file (PNG, JPG, GIF, etc.)"
                });
            }

            // Files array for attachments
            const files = [];

            // Handle image attachment
            if (imageFile) {
                const response = await fetch(imageFile.url);
                const buffer = Buffer.from(await response.arrayBuffer());
                files.push({ attachment: buffer, name: imageFile.name });
            }

            // Build message content
            let content = '';
            if (pingRole) {
                content += `${pingRole}\n\n`;
            }
            content += message;
            if (urlLink) {
                content += `\n\n🔗 **Link:** ${urlLink}`;
            }

            // Send announcement
            await targetChannel.send({
                content: content,
                files: files.length > 0 ? files : undefined
            });

            // Success response
            await interaction.editReply({ 
                content: `**Announcement sent successfully!**\n> Sent to: ${targetChannel}` 
            });

            console.log(`[ANNOUNCE] ${interaction.user.tag} posted announcement to #${targetChannel.name}`);

        } catch (error) {
            console.error('[ERROR] Announce command failed:', error);

            let errorMsg = '**Failed to send announcement.**\n\n';
            
            if (error.code === 50013) {
                errorMsg += '> I don\'t have permission to send messages in that channel.';
            } else {
                errorMsg += `> Error: ${error.message || 'An unexpected error occurred.'}`;
            }

            try {
                await interaction.editReply({ content: errorMsg });
            } catch (replyError) {
                console.error('[ERROR] Failed to send error message:', replyError);
            }
        }
    }
};
