const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, AttachmentBuilder, ChannelType } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

const SCRIPT_ID = "DONATE_PLATFORM";
const LICENSES_FILE = path.join(__dirname, "..", "licenses.json");
const BAGIBAGI_CUSTOMERS_FILE = path.join(__dirname, "..", "bagibagi-customers.json");
const ATTACHMENTS_DIR = path.join(__dirname, "..", "attachments");
const KEY_LENGTH = 4;
const KEY_SECTIONS = 4;
const KEY_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const WEBHOOK_SERVER_URL = process.env.WEBHOOK_SERVER_URL || "http://localhost:8080";
const WEBHOOK_MASTER_KEY = process.env.WEBHOOK_MASTER_KEY || "master_key_change_this";

const ALLOWED_GUILDS = ["1412700210852794400"];

function generateKey() {
    const section = () => 
        Array.from({ length: KEY_LENGTH }, () => 
            KEY_CHARS[Math.floor(Math.random() * KEY_CHARS.length)]
        ).join("");
    return Array.from({ length: KEY_SECTIONS }, section).join("-");
}

function isValidYouTubeUrl(url) {
    if (!url) return false;
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)[\w-]{11}(\S*)?$/;
    return youtubeRegex.test(url);
}

async function readLicenses() {
    try {
        const data = await fs.readFile(LICENSES_FILE, "utf8");
        return JSON.parse(data);
    } catch (err) {
        if (err.code === "ENOENT") return { licenses: [] };
        throw err;
    }
}

async function saveLicense(robloxId, discordId, key, youtubeUrl = null) {
    const data = await readLicenses();
    const licenseData = {
        robloxId,
        discordId,
        key,
        createdAt: new Date().toISOString()
    };
    if (youtubeUrl) licenseData.youtubeUrl = youtubeUrl;
    data.licenses.push(licenseData);
    await fs.writeFile(LICENSES_FILE, JSON.stringify(data, null, 2));
}

async function readBagiBagiCustomers() {
    try {
        const data = await fs.readFile(BAGIBAGI_CUSTOMERS_FILE, "utf8");
        return JSON.parse(data);
    } catch (err) {
        if (err.code === "ENOENT") return { customers: [] };
        throw err;
    }
}

async function saveBagiBagiCustomer(customerName, userKey, channelId, koinRate) {
    const data = await readBagiBagiCustomers();
    const existingIndex = data.customers.findIndex(c => c.userKey === userKey);
    
    if (existingIndex !== -1) {
        data.customers[existingIndex] = {
            name: customerName,
            userKey: userKey,
            channelId: channelId,
            koinRate: koinRate,
            updatedAt: new Date().toISOString()
        };
    } else {
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

async function getSpecificAttachments(fileNames) {
    const attachments = [];
    if (!fileNames || fileNames.length === 0) return attachments;

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

async function registerToWebhookServer(robloxId, discordId, discordUsername) {
    try {
        const response = await fetch(`${WEBHOOK_SERVER_URL}/admin/users/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': WEBHOOK_MASTER_KEY
            },
            body: JSON.stringify({ robloxId, discordId, discordUsername })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        
        return {
            success: true,
            userKey: data.userKey,
            webhookUrl: data.webhookUrl,
            apiKey: data.apiKey,
            hmacSecret: data.hmacSecret
        };
    } catch (err) {
        console.error('[WEBHOOK] Registration failed:', err.message);
        return { success: false, error: err.message };
    }
}

function createChannelEmbed(robloxId, discordId, key, fileCount, youtubeUrl, bagiBagiEnabled, channelInfo, webhookInfo) {
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
                value: `**Roblox ID:** \`${robloxId}\`\n**Discord User:** <@${discordId}>`,
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

    if (webhookInfo && webhookInfo.success) {
        embed.addFields({
            name: "Webhook Server",
            value: 
                `Auto-registered successfully\n` +
                `**Key:** \`${webhookInfo.userKey}\`\n` +
                `**URL:** \`${webhookInfo.webhookUrl}\``,
            inline: false
        });
    }

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

function createDMEmbed(robloxId, key, fileCount, youtubeUrl, bagiBagiEnabled, webhookInfo) {
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

    if (youtubeUrl) {
        embed.addFields({
            name: "Tutorial Video",
            value: `Watch the setup guide:\n${youtubeUrl}`,
            inline: false
        });
    }

    if (webhookInfo && webhookInfo.success) {
        embed.addFields({
            name: "Webhook Integration",
            value: 
                `Your donation webhook is ready!\n` +
                `**Webhook URL:**\n\`\`\`${webhookInfo.webhookUrl}\`\`\`\n` +
                `**API Key:**\n\`\`\`${webhookInfo.apiKey}\`\`\`\n` +
                `Configure this in your donation platform.`,
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
                .setDescription('[TEST MODE ONLY] Koin to IDR rate (default: 100)')
                .setMinValue(1)
                .setMaxValue(10000)
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false),

    async execute(interaction) {
        if (!interaction.guild) {
            return await interaction.reply({
                content: "**This command can only be used in a server!**",
                ephemeral: true
            });
        }

        if (!ALLOWED_GUILDS.includes(interaction.guild.id)) {
            console.log(`[SECURITY] Unauthorized /genkey attempt`);
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

            const key = generateKey();
            await saveLicense(robloxId, discordUser.id, key, youtubeUrl);

            const webhookResult = await registerToWebhookServer(
                robloxId,
                discordUser.id,
                discordUser.username
            );

            if (webhookResult.success) {
                console.log(`[WEBHOOK] Registered: ${webhookResult.userKey}`);
                console.log(`[WEBHOOK] URL: ${webhookResult.webhookUrl}`);
            } else {
                console.log(`[WEBHOOK] Registration failed (server offline)`);
            }

            let bagiBagiRegistered = false;
            let bagiBagiInfo = null;

            if (bagiBagiChannel) {
                const botMember = await interaction.guild.members.fetch(interaction.client.user.id);
                const permissions = bagiBagiChannel.permissionsFor(botMember);

                if (!permissions.has(PermissionFlagsBits.ViewChannel) || 
                    !permissions.has(PermissionFlagsBits.ReadMessageHistory) ||
                    !permissions.has(PermissionFlagsBits.AddReactions)) {
                    
                    console.log(`[WARNING] Missing permissions in channel ${bagiBagiChannel.id}`);
                    
                    await interaction.followUp({
                        content: 
                            `**BagiBagi channel registration skipped!**\n\n` +
                            `Bot needs these permissions in <#${bagiBagiChannel.id}>:\n` +
                            `• View Channel\n• Read Message History\n• Add Reactions\n\n` +
                            `License was still created successfully.`,
                        ephemeral: true
                    });
                } else {
                    const customerName = discordUser.username;
                    await saveBagiBagiCustomer(customerName, key, bagiBagiChannel.id, koinRate);
                    
                    bagiBagiRegistered = true;
                    bagiBagiInfo = {
                        channelId: bagiBagiChannel.id,
                        koinRate: koinRate
                    };

                    console.log(`[BAGIBAGI] Registered: ${customerName}`);
                    console.log(`[BAGIBAGI] Key: ${key}`);
                    console.log(`[BAGIBAGI] Channel: ${bagiBagiChannel.name} (${bagiBagiChannel.id})`);
                    console.log(`[BAGIBAGI] Rate: 1 Koin = ${koinRate} IDR`);
                }
            }

            const attachments = await getSpecificAttachments(fileNames);
            const channelEmbed = createChannelEmbed(
                robloxId, 
                discordUser.id, 
                key, 
                attachments.length,
                youtubeUrl,
                bagiBagiRegistered,
                bagiBagiInfo,
                webhookResult
            );
            const dmEmbed = createDMEmbed(
                robloxId, 
                key, 
                attachments.length, 
                youtubeUrl, 
                bagiBagiRegistered,
                webhookResult
            );

            try {
                const dmMessage = { embeds: [dmEmbed] };
                if (attachments.length > 0) dmMessage.files = attachments;
                await discordUser.send(dmMessage);

                let replyContent = `License successfully sent to ${discordUser}!`;
                if (youtubeUrl) replyContent += `\nYouTube tutorial included.`;
                if (bagiBagiRegistered) replyContent += `\nBagiBagi listener registered to <#${bagiBagiChannel.id}>`;
                if (webhookResult.success) replyContent += `\nWebhook server registered.`;

                await interaction.editReply({ 
                    embeds: [channelEmbed],
                    content: replyContent
                });

                console.log(`[LICENSE] Generated for Roblox: ${robloxId}, Discord: ${discordUser.tag}`);
                console.log(`[DM] Sent license + ${attachments.length} file(s) to ${discordUser.tag}`);
                if (youtubeUrl) console.log(`[YOUTUBE] ${youtubeUrl}`);

            } catch (dmError) {
                console.error("[ERROR] Failed to send DM:", dmError);
                
                let errorContent = 
                    `**License generated but couldn't send DM!**\n\n` +
                    `${discordUser} has DMs disabled. Please send them the key manually:\n` +
                    `\`\`\`${key}\`\`\``;

                if (youtubeUrl) errorContent += `\n\nYouTube Tutorial: ${youtubeUrl}`;
                if (bagiBagiRegistered) errorContent += `\nBagiBagi listener was registered successfully.`;
                if (webhookResult.success) {
                    errorContent += `\n\n**Webhook Details:**\n\`\`\`${webhookResult.webhookUrl}\`\`\``;
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
