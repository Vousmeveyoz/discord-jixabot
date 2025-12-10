require('dotenv').config();
const { Client, GatewayIntentBits, Collection, MessageFlags } = require("discord.js");
const fs = require("fs");
const path = require("path");
const http = require("http");
const url = require("url");
const axios = require("axios");

const bot = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

bot.commands = new Collection();

const LICENSES_FILE = path.join(__dirname, "licenses.json");
const BAGIBAGI_CUSTOMERS_FILE = path.join(__dirname, "bagibagi-customers.json");
const API_PORT = process.env.API_PORT || 3000;

const BAGIBAGI_CONFIG = {
    ENABLED: process.env.BAGIBAGI_ENABLED === 'true',
    VPS_URL: process.env.VPS_URL || 'https://donate.blokmarket.xyz'
};

const WEBHOOK_CONFIG = {
    SERVER_URL: process.env.WEBHOOK_SERVER_URL || 'http://localhost:8080',
    MASTER_KEY: process.env.WEBHOOK_MASTER_KEY || 'cf0019eebe678e7a47c87405e41e139c1e441c0ecac0eea06b54e52c6db2fa50'
};

function readLicenses() {
    try {
        const data = fs.readFileSync(LICENSES_FILE, "utf8");
        return JSON.parse(data);
    } catch (err) {
        if (err.code === "ENOENT") return { licenses: [] };
        throw err;
    }
}

function saveLicenses(data) {
    fs.writeFileSync(LICENSES_FILE, JSON.stringify(data, null, 2));
}

function readBagiBagiCustomers() {
    try {
        const data = fs.readFileSync(BAGIBAGI_CUSTOMERS_FILE, "utf8");
        return JSON.parse(data);
    } catch (err) {
        if (err.code === "ENOENT") return { customers: [] };
        throw err;
    }
}

function saveBagiBagiCustomers(data) {
    fs.writeFileSync(BAGIBAGI_CUSTOMERS_FILE, JSON.stringify(data, null, 2));
}

function findCustomerByChannel(channelId) {
    const data = readBagiBagiCustomers();
    return data.customers.find(c => c.channelId === channelId);
}

function parseBagiBagiMessage(content) {
    try {
        if (!content.includes('Seseorang mengirim') && !content.includes('Koin')) {
            return null;
        }
        
        const koinMatch = content.match(/(\d{1,3}(?:,\d{3})*)\s*Koin/);
        if (!koinMatch) return null;
        
        const koinAmount = parseInt(koinMatch[1].replace(/,/g, ''));
        const idMatch = content.match(/Id Transaksi\s*`([^`]+)`/);
        const transactionId = idMatch ? idMatch[1] : 'unknown';
        const messageMatch = content.match(/Pesan\s*`([^`]*)`/);
        const donorMessage = messageMatch ? messageMatch[1] : '';
        
        return { koinAmount, transactionId, donorMessage };
    } catch (error) {
        console.error('[BAGIBAGI] Parse error:', error.message);
        return null;
    }
}

async function sendToWebhookServer(customer, parsedData) {
    try {
        const donationData = {
            platform: 'bagibagi',
            donor_name: 'BagiBagi Donor',
            amount: parsedData.koinAmount * customer.koinRate,
            koin: parsedData.koinAmount,
            message: parsedData.donorMessage,
            transaction_id: parsedData.transactionId
        };
        
        const webhookUrl = `${BAGIBAGI_CONFIG.VPS_URL}/donation/${customer.userKey}/webhook`;
        
        const timestamp = Math.floor(Date.now() / 1000);
        const crypto = require('crypto');
        const signedPayload = `${timestamp}.${JSON.stringify(donationData)}`;
        
        const hmacSecret = customer.hmacSecret || 'default_secret';
        const signature = crypto
            .createHmac('sha256', hmacSecret)
            .update(signedPayload)
            .digest('hex');
        
        console.log(`[BAGIBAGI] Sending to: ${webhookUrl}`);
        
        const response = await axios.post(webhookUrl, donationData, {
            timeout: 5000,
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Signature': signature,
                'X-Webhook-Timestamp': timestamp.toString()
            }
        });
        
        console.log('[BAGIBAGI] Successfully sent to webhook server');
        return true;
    } catch (error) {
        console.error('[BAGIBAGI] Failed to send:', error.message);
        return false;
    }
}

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (pathname === '/api/validate' && req.method === 'POST') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const { key, robloxId } = JSON.parse(body);

                if (!key) {
                    res.writeHead(400);
                    res.end(JSON.stringify({
                        success: false,
                        message: "Missing required field: key"
                    }));
                    return;
                }

                const data = readLicenses();
                const license = data.licenses.find(l => l.key === key);

                if (!license) {
                    res.writeHead(200);
                    res.end(JSON.stringify({
                        success: false,
                        message: "Invalid license key"
                    }));
                    console.log(`[API] Invalid key attempt: ${key}`);
                    return;
                }

                if (robloxId && robloxId !== "" && license.robloxId !== robloxId) {
                    res.writeHead(200);
                    res.end(JSON.stringify({
                        success: false,
                        message: "License key does not match Roblox ID"
                    }));
                    console.log(`[API] Roblox ID mismatch: ${key}`);
                    return;
                }

                license.lastUsed = new Date().toISOString();
                saveLicenses(data);

                res.writeHead(200);
                res.end(JSON.stringify({
                    success: true,
                    message: "License validated successfully",
                    data: {
                        robloxId: license.robloxId,
                        discordId: license.discordId,
                        createdAt: license.createdAt,
                        lastUsed: license.lastUsed
                    }
                }));

                console.log(`[API] Validated: ${key} | Roblox ID: ${license.robloxId}`);

            } catch (err) {
                console.error("[API ERROR]", err);
                res.writeHead(500);
                res.end(JSON.stringify({
                    success: false,
                    message: "Internal server error"
                }));
            }
        });
        return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({
        success: false,
        message: "Endpoint not found"
    }));
});

async function loadCommands() {
    const commandsPath = path.join(__dirname, "commands");
    try {
        const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(".js"));

        for (const file of commandFiles) {
            const filePath = path.join(commandsPath, file);
            delete require.cache[require.resolve(filePath)];
            const command = require(filePath);

            if (command.data?.name) {
                bot.commands.set(command.data.name, command);
                console.log(`[COMMAND] Loaded: ${command.data.name}`);
            } else {
                console.warn(`[WARNING] Command file ${file} is missing data.name`);
            }
        }
    } catch (err) {
        if (err.code !== "ENOENT") {
            console.error("[ERROR] Failed to load commands:", err);
        }
    }
}

bot.once("ready", (client) => {
    console.log(`Bot ready as ${client.user.tag}`);
    console.log(`Servers: ${client.guilds.cache.size}`);
    console.log(`Commands: ${bot.commands.size}`);
    console.log(`Webhook Server: ${WEBHOOK_CONFIG.SERVER_URL}`);
    
    if (BAGIBAGI_CONFIG.ENABLED) {
        const customers = readBagiBagiCustomers();
        console.log(`BagiBagi Listener: ENABLED`);
        console.log(`VPS URL: ${BAGIBAGI_CONFIG.VPS_URL}`);
        console.log(`Registered customers: ${customers.customers.length}`);
    } else {
        console.log(`BagiBagi Listener: DISABLED`);
    }
});

bot.on("messageCreate", async (message) => {
    if (!BAGIBAGI_CONFIG.ENABLED) return;
    if (!message.author.bot) return;
    if (message.author.username !== 'BagiBagiAPP') return;
    
    const customer = findCustomerByChannel(message.channel.id);
    if (!customer) return;
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`[BAGIBAGI] Message from BagiBagiAPP`);
    console.log(`[BAGIBAGI] Customer: ${customer.name}`);
    console.log(`[BAGIBAGI] Key: ${customer.userKey}`);
    
    const parsedData = parseBagiBagiMessage(message.content);
    if (!parsedData) {
        console.log('[BAGIBAGI] Not a donation message');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        return;
    }
    
    console.log('[BAGIBAGI] Donation detected:');
    console.log(`   Koin: ${parsedData.koinAmount.toLocaleString()}`);
    console.log(`   Rate: 1 Koin = ${customer.koinRate} IDR`);
    console.log(`   Amount: Rp ${(parsedData.koinAmount * customer.koinRate).toLocaleString('id-ID')}`);
    console.log(`   Message: ${parsedData.donorMessage || '(no message)'}`);
    console.log(`   Transaction: ${parsedData.transactionId}`);
    
    const success = await sendToWebhookServer(customer, parsedData);
    
    try {
        await message.react(success ? '✅' : '❌');
    } catch (e) {
        console.log('[BAGIBAGI] Could not react to message');
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});

bot.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = bot.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (err) {
        console.error(`[ERROR] Command '${interaction.commandName}' failed:`, err);

        const errorMsg = {
            content: "Error executing command.",
            flags: MessageFlags.Ephemeral
        };

        try {
            if (interaction.deferred) {
                await interaction.editReply(errorMsg);
            } else if (interaction.replied) {
                await interaction.followUp(errorMsg);
            } else {
                await interaction.reply(errorMsg);
            }
        } catch (replyErr) {
            console.error("[ERROR] Failed to send error message:", replyErr.message);
        }
    }
});

bot.on("error", (err) => {
    console.error("[BOT ERROR]", err);
});

bot.on("warn", (info) => {
    console.warn("[BOT WARNING]", info);
});

(async () => {
    try {
        console.log("[INIT] Loading commands...");
        await loadCommands();

        console.log("[INIT] Starting HTTP API server...");
        server.listen(API_PORT, () => {
            console.log(`API Server running on port ${API_PORT}`);
            console.log(`Validation endpoint: http://localhost:${API_PORT}/api/validate`);
        });

        console.log("[INIT] Logging in to Discord...");
        await bot.login(process.env.DISCORD_TOKEN);

    } catch (err) {
        console.error("[FATAL] Failed to start bot:", err);
        process.exit(1);
    }
})();

process.on("SIGINT", () => {
    console.log("\n[SHUTDOWN] Closing connections...");
    server.close(() => {
        console.log("[SHUTDOWN] HTTP server closed");
    });
    bot.destroy();
    process.exit(0);
});

process.on("unhandledRejection", (error) => {
    console.error("[UNHANDLED REJECTION]", error);
});

process.on("uncaughtException", (error) => {
    console.error("[UNCAUGHT EXCEPTION]", error);
    process.exit(1);
});
