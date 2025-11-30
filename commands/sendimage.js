const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder, MessageFlags } = require('discord.js');

const ALLOWED_GUILDS = ["1412700210852794400"];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sendimage')
        .setDescription('Send an image to a specific channel')
        .addAttachmentOption(option =>
            option
                .setName('file')
                .setDescription('Image file to send')
                .setRequired(true)
        )
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('Channel to send the image to')
                .setRequired(true)
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
            console.log(`[SECURITY] Unauthorized /sendimage - Server: ${interaction.guild.name} (${interaction.guild.id}) - User: ${interaction.user.tag}`);
            return await interaction.editReply({
                content: "**ACCESS DENIED**\n\nThis bot is **private** and not authorized for this server.\n> This incident has been logged and reported."
            });
        }

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return await interaction.editReply({
                content: "**You don't have permission to use this command!**\n> Required: Manage Messages"
            });
        }

        const file = interaction.options.getAttachment('file');
        const targetChannel = interaction.options.getChannel('channel');

        if (!file.contentType?.startsWith('image/')) {
            return await interaction.editReply({
                content: "**Invalid file type!**\n> Please upload an image file (PNG, JPG, GIF, etc.)"
            });
        }

        // Check if channel supports sending messages
        if (!targetChannel.send) {
            return await interaction.editReply({
                content: `**Cannot send messages to ${targetChannel}!**\n> This channel type doesn't support sending messages.`
            });
        }

        const botPermissions = targetChannel.permissionsFor(interaction.guild.members.me);
        if (!botPermissions || !botPermissions.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles])) {
            return await interaction.editReply({
                content: `**I don't have permission in ${targetChannel}!**\n> Required: Send Messages & Attach Files`
            });
        }

        try {
            const response = await fetch(file.url);
            const buffer = Buffer.from(await response.arrayBuffer());
            const attachment = new AttachmentBuilder(buffer, { name: file.name });

            await targetChannel.send({ files: [attachment] });
            await interaction.editReply({ content: `**Image sent successfully!**\n> Sent to: ${targetChannel}` });

            console.log(`[SENDIMAGE] ${interaction.user.tag} sent ${file.name} to #${targetChannel.name}`);

        } catch (error) {
            console.error('[ERROR] Sendimage failed:', error);

            const errorMessages = {
                50013: '> I don\'t have permission to send messages in that channel.',
                fetch: '> Failed to download the image file.',
                default: '> An unexpected error occurred. Please try again.'
            };

            const errorMsg = `**Failed to send image.**\n\n${
                error.code === 50013 ? errorMessages[50013] :
                error.message.includes('fetch') ? errorMessages.fetch :
                errorMessages.default
            }`;

            await interaction.editReply({ content: errorMsg }).catch(console.error);
        }
    }
};
