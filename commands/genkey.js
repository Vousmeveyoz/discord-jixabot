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
const WEBHOOK_MASTER_KEY = process.env.WEBHOOK_MASTER_KEY || "cf0019eebe678e7a47c87405e41e139c1e441c0ecac0eea06b54e52c6db2fa50";

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

async function saveLicense(robloxId, discordId, key, youtubeUrl = null, webhookData = null) {
    const data = await readLicenses();
    const licenseData = {
        robloxId,
        discordId,
        key,
        createdAt: new Date().toISOString()
    };
    if (youtubeUrl) licenseData.youtubeUrl = youtubeUrl;
    if (webhookData) {
        licenseData.webhookUserKey = webhookData.userKey;
        licenseData.webhookApiKey = webhookData.apiKey;
        licenseData.webhookUrl = webhookData.webhookUrl;
    }
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
        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`[WEBHOOK] Registration Starting...`);
        console.log(`[WEBHOOK] URL: ${WEBHOOK_SERVER_URL}/admin/users/register`);
        console.log(`[WEBHOOK] Roblox ID: ${robloxId}`);
        console.log(`[WEBHOOK] Discord: ${discordUsername} (${discordId})`);
        
        const response = await fetch(`${WEBHOOK_SERVER_URL}/admin/users/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': WEBHOOK_MASTER_KEY
            },
            body: JSON.stringify({ 
                robloxId, 
                discordId, 
                discordUsername 
            })
        });

        const responseText = await response.text();
        console.log(`[WEBHOOK] Response Status: ${response.status}`);
        
        if (!response.ok) {
            console.log(`[WEBHOOK] Registration Failed`);
            console.log(`[WEBHOOK] Error: ${responseText}`);
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
            throw new Error(`HTTP ${response.status}: ${responseText}`);
        }
        
        const data = JSON.parse(responseText);
        
        console.log(`[WEBHOOK] Registration Successful`);
        console.log(`[WEBHOOK] User Key: ${data.userKey}`);
        console.log(`[WEBHOOK] Webhook URL: ${data.webhookUrl}`);
        console.log(`[WEBHOOK] API Key: ${data.apiKey.substring(0, 20)}...`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
        
        return {
            success: true,
            userKey: data.userKey,
            webhookUrl: data.webhookUrl,
            apiKey: data.apiKey
        };
    } catch (err) {
        console.error('[WEBHOOK] Registration Error:', err.message);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
        return { 
            success: false, 
            error: err.message 
        };
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
            name: "Webhook Server Integration",
            value: 
                `**Status:** Successfully Registered\n` +
                `**User Key:** \`${webhookInfo.userKey}\`\n` +
                `**Webhook URL:**\n\`\`\`${webhookInfo.webhookUrl}\`\`\`\n` +
                `**API Key:** \`${webhookInfo.apiKey.substring(0, 25)}...\``,
            inline: false
        });
    } else if (webhookInfo && !webhookInfo.success) {
        embed.addFields({
            name: "Webhook Server Integration",
            value: 
                `**Status:** Registration Failed\n` +
                `**Error:** ${webhookInfo.error || 'Server unreachable'}\n` +
                `\nUser can still use license, but webhook features won't work.`,
            inline: false
        });
    }

    if (bagiBagiEnabled && channelInfo) {
        const rateLabel = channelInfo.koinRate === 100 ? '(Production)' : '(Test Mode)';
        embed.addFields({
            name: "BagiBagi Integration",
            value: 
                `**Status:** Listener Registered\n` +
                `**Channel:** <#${channelInfo.channelId}>\n` +
                `**Exchange Rate:** 1 Koin = ${channelInfo.koinRate} IDR ${rateLabel}\n` +
                `**Linked Key:** \`${key}\``,
            inline: false
        });
    }

    embed.setTimestamp();
    embed.setFooter({ text: "License System - BLOKMARKET" });
    return embed;
}

function createDMEmbed(robloxId, key, fileCount, youtubeUrl, bagiBagiEnabled, webhookInfo) {
    const embed = new EmbedBuilder()
        .setColor("#00FF87")
        .setTitle("YOUR BLOKMARKET LICENSE")
        .setDescription(
            `Your Blokmarket license has been activated!\n` +
            `${fileCount} file(s) are attached to this message.`
        )
        .addFields(
            { 
                name: "Your Assets", 
                value: `\`\`\`yaml\nScript: ${SCRIPT_ID}\n\`\`\``,
                inline: false 
            },
            { 
                name: "Roblox Account", 
                value: `**Owner ID:** \`${robloxId}\``,
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
            name: "Webhook Integration (AUTO-CONFIGURED)",
            value: 
                `Your donation webhook is ready to use!\n\n` +
                `**Webhook URL:**\n\`\`\`${webhookInfo.webhookUrl}\`\`\`\n` +
                `**API Key:**\n\`\`\`${webhookInfo.apiKey}\`\`\`\n\n` +
                `**Setup Instructions:**\n` +
                `1. Go to your donation platform (Saweria/Sociabuzz/Trakteer)\n` +
                `2. Find "Webhook" or "Callback URL" settings\n` +
                `3. Paste the Webhook URL above\n` +
                `4. Use the API Key for authenticated requests\n` +
                `5. Start receiving donations!\n\n` +
                `**IMPORTANT:** Keep these credentials private - never share!`,
            inline: false
        });
    } else if (webhookInfo && !webhookInfo.success) {
        embed.addFields({
            name: "Webhook Integration (Setup Required)",
            value: 
                `Automatic webhook setup failed.\n` +
                `**Error:** ${webhookInfo.error || 'Unknown error'}\n\n` +
                `You can still use your license, but you'll need to contact support for manual webhook configuration.`,
            inline: false
        });
    }

    let stepCounter = 1;
    let instructions = `${stepCounter++}. Download all attached files below\n`;
    if (youtubeUrl) instructions += `${stepCounter++}. Watch the tutorial video (recommended)\n`;
    instructions += `${stepCounter++}. Copy your license key above\n`;
    instructions += `${stepCounter++}. Follow setup instructions in the files\n`;
    if (webhookInfo?.success) instructions += `${stepCounter++}. Configure webhook URL in your donation platform\n`;
    instructions += `${stepCounter++}. Enjoy your Blokmarket features!\n\n`;
    instructions += `**Keep these credentials private - never share!**`;

    embed.addFields({
        name: "How to Use",
        value: instructions,
        inline: false
    });

    if (bagiBagiEnabled) {
        embed.addFields({
            name: "BagiBagi Integration",
            value: `You're now connected to BagiBagi!\nDonations will be forwarded automatically.`,
            inline: false
        });
    }

    embed.setTimestamp();
    embed.setFooter({ text: "License System - BLOKMARKET" });
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
                .setDescription('[TEST MODE] Koin to IDR rate (default: 100 for production)')
                .setMinValue(1)
                .setMaxValue(10000)
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false),

    async execute(interaction) {
        if (!interaction.guild) {
            return await interaction.reply({
                content: "This command can only be used in a server!",
                ephemeral: true
            });
        }

        if (!ALLOWED_GUILDS.includes(interaction.guild.id)) {
            console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`[SECURITY] Unauthorized /genkey attempt`);
            console.log(`[SERVER] ${interaction.guild.name} (${interaction.guild.id})`);
            console.log(`[USER] ${interaction.user.tag} (${interaction.user.id})`);
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
            
            return await interaction.reply({
                content: 
                    "**ACCESS DENIED**\n\n" +
                    "This bot is **private** and not authorized for this server.\n" +
                    "This incident has been logged and reported.\n\n" +
                    "If you believe this is an error, contact the bot owner.",
                ephemeral: true
            });
        }

        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return await interaction.reply({
                content: "Insufficient Permissions - Required: Administrator",
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
                    "**Invalid YouTube URL**\n\n" +
                    "Please provide a valid YouTube link:\n" +
                    "- https://youtube.com/watch?v=xxxxx\n" +
                    "- https://youtu.be/xxxxx\n" +
                    "- https://youtube.com/shorts/xxxxx",
                ephemeral: true
            });
        }

        try {
            await interaction.deferReply();

            const key = generateKey();
            
            console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`[LICENSE] Generating License...`);
            console.log(`[LICENSE] Key: ${key}`);
            console.log(`[LICENSE] User: ${discordUser.username} (${discordUser.id})`);
            console.log(`[LICENSE] Roblox ID: ${robloxId}`);

            // Register to webhook server
            const webhookResult = await registerToWebhookServer(
                robloxId,
                discordUser.id,
                discordUser.username
            );

            // Save license with webhook data
            await saveLicense(
                robloxId, 
                discordUser.id, 
                key, 
                youtubeUrl,
                webhookResult.success ? webhookResult : null
            );

            let bagiBagiRegistered = false;
            let bagiBagiInfo = null;

            if (bagiBagiChannel) {
                const botMember = await interaction.guild.members.fetch(interaction.client.user.id);
                const permissions = bagiBagiChannel.permissionsFor(botMember);

                if (!permissions.has(PermissionFlagsBits.ViewChannel) || 
                    !permissions.has(PermissionFlagsBits.ReadMessageHistory) ||
                    !permissions.has(PermissionFlagsBits.AddReactions)) {
                    
                    console.log(`[BAGIBAGI] Missing permissions in ${bagiBagiChannel.name}`);
                    
                    await interaction.followUp({
                        content: 
                            `**BagiBagi Setup Incomplete**\n\n` +
                            `Bot needs these permissions in <#${bagiBagiChannel.id}>:\n` +
                            `- View Channel\n- Read Message History\n- Add Reactions\n\n` +
                            `License was created successfully, but BagiBagi won't work.`,
                        ephemeral: true
                    });
                } else {
                    if (webhookResult.success) {
                        await saveBagiBagiCustomer(
                            discordUser.username,
                            webhookResult.userKey,
                            bagiBagiChannel.id,
                            koinRate
                        );
                        
                        bagiBagiRegistered = true;
                        bagiBagiInfo = {
                            channelId: bagiBagiChannel.id,
                            koinRate: koinRate
                        };

                        console.log(`[BAGIBAGI] Registered`);
                        console.log(`[BAGIBAGI] Customer: ${discordUser.username}`);
                        console.log(`[BAGIBAGI] UserKey: ${webhookResult.userKey}`);
                        console.log(`[BAGIBAGI] Channel: ${bagiBagiChannel.name}`);
                        console.log(`[BAGIBAGI] Rate: 1 Koin = ${koinRate} IDR`);
                    } else {
                        console.log(`[BAGIBAGI] Skipped (webhook registration failed)`);
                    }
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

                let replyContent = `License delivered successfully!\n\n`;
                replyContent += `DM sent to ${discordUser}\n`;
                replyContent += `${attachments.length} file(s) attached\n`;
                if (youtubeUrl) replyContent += `YouTube tutorial included\n`;
                if (webhookResult.success) {
                    replyContent += `Webhook server: Registered\n`;
                } else {
                    replyContent += `Webhook server: Failed (${webhookResult.error})\n`;
                }
                if (bagiBagiRegistered) {
                    replyContent += `BagiBagi: Listening on <#${bagiBagiChannel.id}>`;
                }

                await interaction.editReply({ 
                    embeds: [channelEmbed],
                    content: replyContent
                });

                console.log(`[DM] Sent to ${discordUser.tag}`);
                console.log(`[FILES] ${attachments.length} attachment(s)`);
                if (youtubeUrl) console.log(`[YOUTUBE] ${youtubeUrl}`);
                console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

            } catch (dmError) {
                console.error("[DM] Failed:", dmError.message);
                
                let errorContent = 
                    `**License created but DM failed!**\n\n` +
                    `${discordUser} has DMs disabled or blocked the bot.\n\n` +
                    `**Manual delivery required:**\n` +
                    `\`\`\`${key}\`\`\``;

                if (webhookResult.success) {
                    errorContent += `\n**Webhook Credentials:**\n`;
                    errorContent += `URL: \`${webhookResult.webhookUrl}\`\n`;
                    errorContent += `API Key: \`${webhookResult.apiKey}\``;
                }
                if (youtubeUrl) errorContent += `\n\nTutorial: ${youtubeUrl}`;
                
                await interaction.editReply({ 
                    content: errorContent,
                    embeds: [channelEmbed]
                });
                
                console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
            }

        } catch (err) {
            console.error("[ERROR] License generation failed:", err);
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
            
            const errorMsg = `**Failed to generate license**\n\`\`\`${err.message}\`\`\``;
            
            if (interaction.deferred) {
                await interaction.editReply({ content: errorMsg });
            } else {
                await interaction.reply({ content: errorMsg, ephemeral: true });
            }
        }
    }
}
