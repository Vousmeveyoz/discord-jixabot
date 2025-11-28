const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

// Constants
const SCRIPT_ID = "DONATE_PLATFORM";
const LICENSES_FILE = path.join(__dirname, "..", "licenses.json");
const ATTACHMENTS_DIR = path.join(__dirname, "..", "attachments");
const KEY_LENGTH = 4;
const KEY_SECTIONS = 4;
const KEY_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const ALLOWED_GUILDS = [
    "1412700210852794400", 
];

// Generate License Key
function generateKey() {
    const section = () => 
        Array.from({ length: KEY_LENGTH }, () => 
            KEY_CHARS[Math.floor(Math.random() * KEY_CHARS.length)]
        ).join("");
    
    return Array.from({ length: KEY_SECTIONS }, section).join("-");
}

// Read licenses.json
async function readLicenses() {
    try {
        const data = await fs.readFile(LICENSES_FILE, "utf8");
        return JSON.parse(data);
    } catch (err) {
        if (err.code === "ENOENT") {
            return { licenses: [] };
        }
        throw err;
    }
}

// Save license to file
async function saveLicense(robloxId, discordId, key) {
    const data = await readLicenses();
    
    data.licenses.push({
        robloxId,
        discordId,
        key,
        createdAt: new Date().toISOString()
    });

    await fs.writeFile(LICENSES_FILE, JSON.stringify(data, null, 2));
}

// Get list of available files in attachments folder
async function getAvailableFiles() {
    try {
        const files = await fs.readdir(ATTACHMENTS_DIR);
        return files.filter(file => {
            // Filter out hidden files and directories
            return !file.startsWith('.');
        });
    } catch (err) {
        if (err.code === "ENOENT") {
            return [];
        }
        throw err;
    }
}

// Get specific attachments based on file names
async function getSpecificAttachments(fileNames) {
    const attachments = [];
    
    if (!fileNames || fileNames.length === 0) {
        return attachments;
    }

    // Split comma-separated file names
    const requestedFiles = fileNames.split(',').map(f => f.trim());

    for (const fileName of requestedFiles) {
        try {
            const filePath = path.join(ATTACHMENTS_DIR, fileName);
            
            // Check if file exists
            await fs.access(filePath);
            attachments.push(new AttachmentBuilder(filePath));
        } catch (err) {
            console.log(`[WARNING] File not found: ${fileName}`);
        }
    }

    return attachments;
}

// Create embed for channel
function createChannelEmbed(robloxId, discordId, key, fileCount) {
    return new EmbedBuilder()
        .setColor("#00FF87")
        .setTitle("LICENSE ACTIVATED")
        .addFields(
            { 
                name: "Package Information", 
                value: `\`\`\`yaml\nScript: ${SCRIPT_ID}\n\`\`\``,
                inline: false 
            },
            { 
                name: "Owner Details", 
                value: 
                    `**Roblox ID:** \`${robloxId}\`\n` +
                    `**Discord User:** <@${discordId}>`,
                inline: false 
            },
            {
                name: "Delivery Status",
                value: 
                    `\`\` License key sent via DM\n` +
                    `\`\` ${fileCount} file(s) delivered\n` +
                    `\`\` User notified successfully`,
                inline: false
            }
        )
        .setTimestamp()
        .setFooter({ text: "License System • BLOKMARKET" });
}

// Create embed for DM
function createDMEmbed(robloxId, key, fileCount) {
    return new EmbedBuilder()
        .setColor("#00FF87")
        .setTitle("YOUR LICENSE BLOKMARKET")
        .setDescription(
            `> lokmarket license has been activated.\n` +
            `> ${fileCount} file(s) are attached to this message.`
        )
        .addFields(
            { 
                name: "Your Assets", 
                value: `\`\`\`yaml\nScript: ${SCRIPT_ID}\n\`\`\``,
                inline: false 
            },
            { 
                name: "Roblox Account", 
                value: `**Owner Map ID:** \`${robloxId}\``,
                inline: false 
            },
            { 
                name: "Your License Key", 
                value: `\`\`\`${key}\`\`\``,
                inline: false 
            },
            {
                name: "How to Use",
                value: 
                    `\`1.\` Download all attached files below\n` +
                    `\`2.\` Copy your license key above\n` +
                    `\`3.\` Follow the setup instructions in the files\n` +
                    `\`4.\` Paste your key\n` +
                    `\`5.\` Enjoy your features blokmarket!\n\n` +
                    `**Keep this key private - do not share!**`,
                inline: false
            }
        )
        .setTimestamp()
        .setFooter({ text: "License System • blokmarket!" });
}

// Export command
module.exports = {
    data: new SlashCommandBuilder()
        .setName('genkey')
        .setDescription('Generate a premium license key and send to user')
        .addStringOption(option =>
            option
                .setName('roblox_id')
                .setDescription('Roblox User ID (Owner Map)')
                .setRequired(true)
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('Discord user who purchased the license')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('files')
                .setDescription('File names to attach (comma separated, e.g: script.lua,readme.txt)')
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false),

    async execute(interaction) {
        // Check if command is used in a server (guild)
        if (!interaction.guild) {
            return await interaction.reply({
                content: "**This command can only be used in a server!**",
                ephemeral: true
            });
        }

        // 🔒 SECURITY: Check if server is whitelisted
        if (!ALLOWED_GUILDS.includes(interaction.guild.id)) {
            console.log(`[SECURITY ALERT] Unauthorized /genkey attempt!`);
            console.log(`Server: ${interaction.guild.name} (${interaction.guild.id})`);
            console.log(`User: ${interaction.user.tag} (${interaction.user.id})`);
            
            return await interaction.reply({
                content: 
                    "**ACCESS DENIED**\n\n" +
                    "This bot is **private** and not authorized for this server.\n" +
                    "> This incident has been logged and reported.\n\n" +
                    "If you believe this is an error, contact the bot owner.",
                ephemeral: true
            });
        }

        // Check if user has Administrator permission
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return await interaction.reply({
                content: "**You don't have permission to use this command!**\n> Required: Administrator",
                ephemeral: true
            });
        }

        const robloxId = interaction.options.getString('roblox_id');
        const discordUser = interaction.options.getUser('user');
        const fileNames = interaction.options.getString('files');

        try {
            await interaction.deferReply();

            // Generate license
            const key = generateKey();
            await saveLicense(robloxId, discordUser.id, key);

            // Get specific attachments
            const attachments = await getSpecificAttachments(fileNames);

            // Create embeds
            const channelEmbed = createChannelEmbed(robloxId, discordUser.id, key, attachments.length);
            const dmEmbed = createDMEmbed(robloxId, key, attachments.length);

            // Send DM to user
            try {
                const dmMessage = {
                    embeds: [dmEmbed]
                };

                // Add files if exist
                if (attachments.length > 0) {
                    dmMessage.files = attachments;
                }

                await discordUser.send(dmMessage);

                // Reply in channel
                await interaction.editReply({ 
                    embeds: [channelEmbed],
                    content: `License successfully sent to ${discordUser}!`
                });

                console.log(`[LICENSE] Generated key for Roblox ID: ${robloxId}, Discord: ${discordUser.tag}`);
                console.log(`[DM] Sent license + ${attachments.length} file(s) to ${discordUser.tag}`);

            } catch (dmError) {
                // If DM fails (user has DMs closed)
                console.error("[ERROR] Failed to send DM:", dmError);
                
                await interaction.editReply({ 
                    content: `**License generated but couldn't send DM!**\n\n` +
                             `${discordUser} has DMs disabled. Please send them the key manually:\n` +
                             `\`\`\`${key}\`\`\``,
                    embeds: [channelEmbed]
                });
            }

        } catch (err) {
            console.error("[ERROR] Failed to generate license:", err);
            
            const errorMsg = "Failed to generate license. Please try again.";
            
            if (interaction.deferred) {
                await interaction.editReply({ content: errorMsg });
            } else {
                await interaction.reply({ content: errorMsg, ephemeral: true });
            }
        }
    }
};