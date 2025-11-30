const { SlashCommandBuilder, AttachmentBuilder } = require("discord.js");
const fs = require("fs");
const path = require("path");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("sendimage")
        .setDescription("Mengirim gambar langsung melalui bot")
        .addAttachmentOption(option =>
            option.setName("file")
                .setDescription("Gambar yang ingin dikirim")
                .setRequired(true)
        ),

    async execute(interaction) {
        const file = interaction.options.getAttachment("file");

        await interaction.deferReply();

        try {
            // Download attachment jika perlu
            const response = await fetch(file.url);
            const buffer = Buffer.from(await response.arrayBuffer());

            const attachment = new AttachmentBuilder(buffer, {
                name: file.name
            });

            await interaction.editReply({
                content: `📤 Mengirim gambar **${file.name}**`,
                files: [attachment]
            });

        } catch (err) {
            console.error("UPLOAD ERROR:", err);
            await interaction.editReply("❌ Gagal mengirim gambar.");
        }
    }
};
