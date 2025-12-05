require('dotenv').config();
const { Client, GatewayIntentBits, Collection, MessageFlags } = require("discord.js");
const fs = require("fs");
const path = require("path");
const http = require("http");
const url = require("url");
const axios = require("axios");

// Initialize bot
const bot = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

bot.commands = new Collection();

const LICENSES_FILE = path.join(__dirname, "licenses.json");
const API_PORT = process.env.API_PORT || 3000;

// ════════════════════════════════════════════════════════════
// 🎁 BAGIBAGI CONFIGURATION
// ════════════════════════════════════════════════════════════

const BAGIBAGI_CONFIG = {
    // Channel ID dimana BagiBagiAPP mengirim notifikasi
    CHANNEL_ID: process.env.BAGIBAGI_CHANNEL_ID || '',
    
    // VPS URL (ganti dengan IP VPS Anda)
    VPS_URL: process.env.VPS_URL || 'http://localhost:8080',
    
    // User Key untuk Roblox
    USER_KEY: process.env.BAGIBAGI_USER_KEY || '1PJQ-WNSE-ZAN7-OKNW',
    
    // Konversi koin ke IDR (1 Koin = 100 IDR)
    KOIN_TO_IDR: parseInt(process.env.KOIN_TO_IDR || '100'),
    
    // Enable/disable BagiBagi listener
    ENABLED: process.env.BAGIBAGI_ENABLED === 'true'
};

// ==================== HELPER FUNCTIONS ====================

// Read licenses.json
function readLicenses() {
    try {
        const data = fs.readFileSync(LICENSES_FILE, "utf8");
        return JSON.parse(data);
    } catch (err) {
        if (err.code === "ENOENT") {
            return { licenses: [] };
        }
        throw err;
    }
}

// Save licenses.json
function saveLicenses(data) {
    fs.writeFileSync(LICENSES_FILE, JSON.stringify(data, null, 2));
}

// ════════════════════════════════════════════════════════════
// 🎁 BAGIBAGI PARSER & SENDER
// ════════════════════════════════════════════════════════════

function parseBagiBagiMessage(content) {
    try {
        // Cek apakah pesan dari BagiBagiAPP
        if (!content.includes('Seseorang mengirim') && !content.includes('Koin')) {
            return null;
        }
        
        // Extract koin amount
        const koinMatch = content.match(/(\d{1,3}(?:,\d{3})*)\s*Koin/);
        if (!koinMatch) return null;
        
        const koinAmount = parseInt(koinMatch[1].replace(/,/g, ''));
        
        // Extract Transaction ID
        const idMatch = content.match(/Id Transaksi\s*`([^`]+)`/);
        const transactionId = idMatch ? idMatch[1] : 'unknown';
        
        // Extract Message
        const messageMatch = content.match(/Pesan\s*`([^`]*)`/);
        const donorMessage = messageMatch ? messageMatch[1] : '';
        
        return {
            platform: 'bagibagi',
            donor_name: 'BagiBagi Donor',
            amount: koinAmount * BAGIBAGI_CONFIG.KOIN_TO_IDR,
            koin: koinAmount,
            message: donorMessage,
            transaction_id: transactionId
        };
    } catch (error) {
        console.error('[BAGIBAGI] ❌ Parse error:', error.message);
        return null;
    }
}

async function sendToVPS(donation) {
    try {
        const url = `${BAGIBAGI_CONFIG.VPS_URL}/donation/${BAGIBAGI_CONFIG.USER_KEY}/webhook`;
        
        console.log(`[BAGIBAGI] 📤 Sending to VPS: ${url}`);
        
        const response = await axios.post(url, donation, {
            timeout: 5000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.log('[BAGIBAGI] ✅ Successfully sent to VPS');
        return true;
    } catch (error) {
        console.error('[BAGIBAGI] ❌ Failed to send to VPS:', error.message);
        return false;
    }
}

// ==================== HTTP API SERVER ====================

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    // Handle OPTIONS (preflight)
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // ✅ Validate License Endpoint (AUTO-DETECT OWNER ID)
    if (pathname === '/api/validate' && req.method === 'POST') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const { key, robloxId } = JSON.parse(body);

                // Validasi input - key wajib, robloxId optional (bisa auto-detect)
                if (!key) {
                    res.writeHead(400);
                    res.end(JSON.stringify({
                        success: false,
                        message: "Missing required field: key"
                    }));
                    return;
                }

                // Baca data license dari licenses.json
                const data = readLicenses();
                const license = data.licenses.find(l => l.key === key);

                // Check apakah key valid
                if (!license) {
                    res.writeHead(200);
                    res.end(JSON.stringify({
                        success: false,
                        message: "Invalid license key"
                    }));
                    console.log(`[API] ❌ Invalid key attempt: ${key}`);
                    return;
                }

                // Jika robloxId dikirim, check apakah cocok
                if (robloxId && robloxId !== "" && license.robloxId !== robloxId) {
                    res.writeHead(200);
                    res.end(JSON.stringify({
                        success: false,
                        message: "License key does not match Roblox ID"
                    }));
                    console.log(`[API] ❌ Roblox ID mismatch: ${key} | Expected: ${license.robloxId}, Got: ${robloxId}`);
                    return;
                }

                // Update last used timestamp
                license.lastUsed = new Date().toISOString();
                saveLicenses(data);

                // ✅ License valid! Return dengan robloxId dari database
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

                console.log(`[API] ✅ Validated: ${key} | Roblox ID: ${license.robloxId}`);

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

    // 404 Not Found
    res.writeHead(404);
    res.end(JSON.stringify({
        success: false,
        message: "Endpoint not found"
    }));
});

// ==================== BOT COMMANDS ====================

// Load Commands
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

// ════════════════════════════════════════════════════════════
// 🎯 BOT EVENTS
// ════════════════════════════════════════════════════════════

// Event: Bot Ready
bot.once("ready", (client) => {
    console.log(`✅ Bot siap sebagai ${client.user.tag}`);
    console.log(`📊 Server count: ${client.guilds.cache.size}`);
    console.log(`⚡ Commands loaded: ${bot.commands.size}`);
    
    if (BAGIBAGI_CONFIG.ENABLED) {
        console.log(`\n🎁 BagiBagi Listener: ENABLED`);
        console.log(`   Channel ID: ${BAGIBAGI_CONFIG.CHANNEL_ID}`);
        console.log(`   VPS URL: ${BAGIBAGI_CONFIG.VPS_URL}`);
        console.log(`   User Key: ${BAGIBAGI_CONFIG.USER_KEY}`);
        console.log(`   Koin Rate: 1 Koin = ${BAGIBAGI_CONFIG.KOIN_TO_IDR} IDR\n`);
    } else {
        console.log(`\n🎁 BagiBagi Listener: DISABLED\n`);
    }
});

// Event: Message (BagiBagi Listener)
bot.on("messageCreate", async (message) => {
    // Skip if BagiBagi listener is disabled
    if (!BAGIBAGI_CONFIG.ENABLED) return;
    
    // Ignore non-bot messages or wrong channel
    if (!message.author.bot || message.channel.id !== BAGIBAGI_CONFIG.CHANNEL_ID) {
        return;
    }
    
    // Only listen to BagiBagiAPP
    if (message.author.username !== 'BagiBagiAPP') {
        return;
    }
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`[BAGIBAGI] 📨 New message from: ${message.author.username}`);
    console.log(`[BAGIBAGI] 🕒 ${new Date().toLocaleString()}`);
    
    // Parse BagiBagi message
    const donation = parseBagiBagiMessage(message.content);
    
    if (!donation) {
        console.log('[BAGIBAGI] ⚠️ Not a donation message');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        return;
    }
    
    console.log('[BAGIBAGI] ✅ Donation detected:');
    console.log(`   Koin: ${donation.koin.toLocaleString()}`);
    console.log(`   Amount: Rp ${donation.amount.toLocaleString('id-ID')}`);
    console.log(`   Message: ${donation.message || '(no message)'}`);
    console.log(`   Transaction: ${donation.transaction_id}`);
    
    // Send to VPS
    const success = await sendToVPS(donation);
    
    if (success) {
        try {
            await message.react('✅');
        } catch (e) {
            console.log('[BAGIBAGI] ⚠️ Could not react to message');
        }
    } else {
        try {
            await message.react('❌');
        } catch (e) {
            console.log('[BAGIBAGI] ⚠️ Could not react to message');
        }
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});

// Event: Interaction (Slash Commands)
bot.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = bot.commands.get(interaction.commandName);

    if (!command) {
        console.warn(`[WARNING] Unknown command: ${interaction.commandName}`);
        return;
    }

    try {
        await command.execute(interaction);
    } catch (err) {
        console.error(`[ERROR] Command '${interaction.commandName}' failed:`, err);

        const errorMsg = {
            content: "❌ Terjadi kesalahan saat menjalankan command.",
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

// Event: Bot Error
bot.on("error", (err) => {
    console.error("[BOT ERROR]", err);
});

// Event: Warning
bot.on("warn", (info) => {
    console.warn("[BOT WARNING]", info);
});

// ==================== INITIALIZATION ====================

(async () => {
    try {
        console.log("[INIT] Loading commands...");
        await loadCommands();

        console.log("[INIT] Starting HTTP API server...");
        server.listen(API_PORT, () => {
            console.log(`✅ API Server running on port ${API_PORT}`);
            console.log(`📡 Validation endpoint: http://localhost:${API_PORT}/api/validate`);
        });

        console.log("[INIT] Logging in to Discord...");
        await bot.login(process.env.DISCORD_TOKEN);

    } catch (err) {
        console.error("[FATAL] Failed to start bot:", err);
        process.exit(1);
    }
})();

// ==================== GRACEFUL SHUTDOWN ====================

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
