const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, AttachmentBuilder, ChannelType } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

// Constants
const SCRIPT_ID = "DONATE_PLATFORM";
const LICENSES_FILE = path.join(__dirname, "..", "licenses.json");
const BAGIBAGI_CUSTOMERS_FILE = path.join(__dirname, "..", "bagibagi-customers.json");
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

// Validate YouTube URL
function isValidYouTubeUrl(url) {
    if (!url) return false;
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)[\w-]{11}(\S*)?$/;
    return youtubeRegex.test(url);
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
async function saveLicense(robloxId, discordId, key, youtubeUrl = null) {
    const data = await readLicenses();
    
    const licenseData = {
        robloxId,
        discordId,
        key,
        createdAt: new Date().toISOString()
    };

    if (youtubeUrl) {
        licenseData.youtubeUrl = youtubeUrl;
    }

    data.licenses.push(licenseData);

    await fs.writeFile(LICENSES_FILE, JSON.stringify(data, null, 2));
}

// ════════════════════════════════════════════════════════════
// 🎁 BAGIBAGI CUSTOMER FUNCTIONS
// ════════════════════════════════════════════════════════════

// Read bagibagi-customers.json
async function readBagiBagiCustomers() {
    try {
        const data = await fs.readFile(BAGIBAGI_CUSTOMERS_FILE, "utf8");
        return JSON.parse(data);
    } catch (err) {
        if (err.code === "ENOENT") {
            return { customers: [] };
        }
        throw err;
    }
}

// Save BagiBagi customer
async function saveBagiBagiCustomer(customerName, userKey, channelId, koinRate) {
    const data = await readBagiBagiCustomers();
    
    // Check if customer already exists
    const existingIndex = data.customers.findIndex(c => c.userKey === userKey);
    
    if (existingIndex !== -1) {
        // Update existing customer
        data.customers[existingIndex] = {
            name: customerName,
            userKey: userKey,
            channelId: channelId,
            koinRate: koinRate,
            updatedAt: new Date().toISOString()
        };
    } else {
        // Add new customer
        data.customers.push({
            name: customerName,
            userKey: userKey,
            channelId: channelId,
            koinRate: koinRate,
            createdAt: new Date().toISOString()
        });
    }

    await fs.writeFile(BAGIBAGI_CUSTOMERS_FILE, JSON.stringify(data, null, 2));
}

// Get list of available files in attachments folder
async function getAvailableFiles() {
    try {
        const files = await fs.readdir(ATTACHMENTS_DIR);
        return files.filter(file => {
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

    const requestedFiles = fileNames.split(',').map(f => f.trim());

    for (const fileName of requestedFiles) {
        try {
            const filePath = path.join(ATTACHMENTS_DIR, fileName);
            await fs.access(filePath);
            attachments.push(new AttachmentBuilder(filePath));
        } catch (err) {
            console.log(`[WARNING] File not found: ${fileName}`);
        }
    }

    return attachments;
}

// Create embed for channel
function createChannelEmbed(robloxId, discordId, key, fileCount, youtubeUrl, bagiBagiEnabled, channelInfo) {
    const embed = new EmbedBuilder()
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
                    `License key sent via DM\n` +
                    `${fileCount} file(s) delivered\n` +
                    `${youtubeUrl ? 'YouTube tutorial included\n' : ''}` +
                    `User notified successfully`,
                inline: false
            }
        );

    // Add BagiBagi info if enabled
    if (bagiBagiEnabled && channelInfo) {
        const rateLabel = channelInfo.koinRate === 100 ? '(Production Default)' : '(Test Mode)';
        embed.addFields({
            name: "BagiBagi Listener",
            value: 
                `Registered successfully\n` +
                `**Channel:** <#${channelInfo.channelId}>\n` +
                `**Rate:** 1 Koin = ${channelInfo.koinRate} IDR ${rateLabel}\n` +
                `**Key:** \`${key}\``,
            inline: false
        });
    }

    embed.setTimestamp();
    embed.setFooter({ text: "License System • BLOKMARKET" });

    return embed;
}

// Create embed for DM
function createDMEmbed(robloxId, key, fileCount, youtubeUrl, bagiBagiEnabled) {
    const embed = new EmbedBuilder()
        .setColor("#00FF87")
        .setTitle("YOUR LICENSE BLOKMARKET")
        .setDescription(
            `> Blokmarket license has been activated.\n` +
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
            }
        );

    // Add YouTube tutorial if provided
    if (youtubeUrl) {
        embed.addFields({
            name: "Tutorial Video",
            value: `Watch the setup guide:\n${youtubeUrl}`,
            inline: false
        });
    }

    embed.addFields({
        name: "How to Use",
        value: 
            `1. Download all attached files below\n` +
            `2. ${youtubeUrl ? 'Watch the tutorial video (optional)\n3. ' : ''}Copy your license key above\n` +
            `${youtubeUrl ? '4' : '3'}. Follow the setup instructions in the files\n` +
            `${youtubeUrl ? '5' : '4'}. Paste your key\n` +
            `${youtubeUrl ? '6' : '5'}. Enjoy your features blokmarket!\n\n` +
            `**Keep this key private - do not share!**`,
        inline: false
    });

    // Add BagiBagi notice if enabled
    if (bagiBagiEnabled) {
        embed.addFields({
            name: "BagiBagi Integration",
            value: `You're now connected to bagibagi.co!`,
            inline: false
        });
    }

    embed.setTimestamp();
    embed.setFooter({ text: "License System • blokmarket!" });

    return embed;
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
        .addStringOption(option =>
            option
                .setName('youtube_url')
                .setDescription('YouTube tutorial link (e.g: https://youtube.com/watch?v=xxxxx)')
                .setRequired(false)
        )
        .addChannelOption(option =>
            option
                .setName('bagibagi_channel')
                .setDescription('[OPTIONAL] Channel for BagiBagi webhook notifications')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option
                .setName('koin_rate')
                .setDescription('[TEST MODE ONLY] Koin to IDR rate (default: 100, production uses platform rate)')
                .setMinValue(1)
                .setMaxValue(10000)
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
        const youtubeUrl = interaction.options.getString('youtube_url');
        const bagiBagiChannel = interaction.options.getChannel('bagibagi_channel');
        const koinRate = interaction.options.getInteger('koin_rate') || 100;

        // Validate YouTube URL if provided
        if (youtubeUrl && !isValidYouTubeUrl(youtubeUrl)) {
            return await interaction.reply({
                content: 
                    "**Invalid YouTube URL!**\n\n" +
                    "Please provide a valid YouTube link, for example:\n" +
                    "• `https://youtube.com/watch?v=xxxxx`\n" +
                    "• `https://youtu.be/xxxxx`\n" +
                    "• `https://youtube.com/shorts/xxxxx`",
                ephemeral: true
            });
        }

        try {
            await interaction.deferReply();

            // Generate license
            const key = generateKey();
            await saveLicense(robloxId, discordUser.id, key, youtubeUrl);

            // ════════════════════════════════════════════════════════════
            // 🎁 BAGIBAGI REGISTRATION (if channel provided)
            // ════════════════════════════════════════════════════════════

            let bagiBagiRegistered = false;
            let bagiBagiInfo = null;

            if (bagiBagiChannel) {
                // Validate bot permissions in the channel
                const botMember = await interaction.guild.members.fetch(interaction.client.user.id);
                const permissions = bagiBagiChannel.permissionsFor(botMember);

                if (!permissions.has(PermissionFlagsBits.ViewChannel) || 
                    !permissions.has(PermissionFlagsBits.ReadMessageHistory) ||
                    !permissions.has(PermissionFlagsBits.AddReactions)) {
                    
                    console.log(`[WARNING] Bot doesn't have permission in channel ${bagiBagiChannel.id}`);
                    
                    await interaction.followUp({
                        content: 
                            `**BagiBagi channel registration skipped!**\n\n` +
                            `Bot needs these permissions in <#${bagiBagiChannel.id}>:\n` +
                            `• View Channel\n` +
                            `• Read Message History\n` +
                            `• Add Reactions\n\n` +
                            `License was still created successfully.`,
                        ephemeral: true
                    });
                } else {
                    // Save to bagibagi-customers.json
                    const customerName = discordUser.username;
                    await saveBagiBagiCustomer(customerName, key, bagiBagiChannel.id, koinRate);
                    
                    bagiBagiRegistered = true;
                    bagiBagiInfo = {
                        channelId: bagiBagiChannel.id,
                        koinRate: koinRate
                    };

                    console.log(`[BAGIBAGI] Registered customer: ${customerName}`);
                    console.log(`   Key: ${key}`);
                    console.log(`   Channel: ${bagiBagiChannel.name} (${bagiBagiChannel.id})`);
                    console.log(`   Rate: 1 Koin = ${koinRate} IDR`);
                }
            }

            // Get attachments
            const attachments = await getSpecificAttachments(fileNames);

            // Create embeds
            const channelEmbed = createChannelEmbed(
                robloxId, 
                discordUser.id, 
                key, 
                attachments.length,
                youtubeUrl,
                bagiBagiRegistered,
                bagiBagiInfo
            );
            const dmEmbed = createDMEmbed(robloxId, key, attachments.length, youtubeUrl, bagiBagiRegistered);

            // Send DM to user
            try {
                const dmMessage = {
                    embeds: [dmEmbed]
                };

                if (attachments.length > 0) {
                    dmMessage.files = attachments;
                }

                await discordUser.send(dmMessage);

                // Reply in channel
                let replyContent = `License successfully sent to ${discordUser}!`;
                if (youtubeUrl) {
                    replyContent += `\nYouTube tutorial included.`;
                }
                if (bagiBagiRegistered) {
                    replyContent += `\nBagiBagi listener registered to <#${bagiBagiChannel.id}>`;
                }

                await interaction.editReply({ 
                    embeds: [channelEmbed],
                    content: replyContent
                });

                console.log(`[LICENSE] Generated key for Roblox ID: ${robloxId}, Discord: ${discordUser.tag}`);
                console.log(`[DM] Sent license + ${attachments.length} file(s) to ${discordUser.tag}`);
                if (youtubeUrl) {
                    console.log(`[YOUTUBE] Tutorial link: ${youtubeUrl}`);
                }

            } catch (dmError) {
                console.error("[ERROR] Failed to send DM:", dmError);
                
                let errorContent = `**License generated but couldn't send DM!**\n\n` +
                             `${discordUser} has DMs disabled. Please send them the key manually:\n` +
                             `\`\`\`${key}\`\`\``;

                if (youtubeUrl) {
                    errorContent += `\n\nYouTube Tutorial: ${youtubeUrl}`;
                }

                if (bagiBagiRegistered) {
                    errorContent += `\nBagiBagi listener was registered successfully.`;
                }
                
                await interaction.editReply({ 
                    content: errorContent,
                    embeds: [channelEmbed]
                });
            }

        } catch (err) {
            console.error("[ERROR] Failed to generate license:", err);
            
            const errorMsg = `Failed to generate license. Please try again.\n\`\`\`${err.message}\`\`\``;
            
            if (interaction.deferred) {
                await interaction.editReply({ content: errorMsg });
            } else {
                await interaction.reply({ content: errorMsg, ephemeral: true });
            }
        }
    }
}
