const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const Tesseract = require('tesseract.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ─── CONFIG ───────────────────────────────────────────────────────────
const TARGET_CHANNEL_ID = '1412737876747092008';
const CONCURRENCY_LIMIT = 3;          // turunkan dari 5 ke 3 supaya tidak terlalu berat
const OCR_TIMEOUT_MS = 30000;         // timeout 30 detik per image
const DOWNLOAD_TIMEOUT_MS = 30000;    // timeout 30 detik per download
const TEMP_DIR = path.join(__dirname, '..', 'temp_ocr');
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

// ─── HELPERS ──────────────────────────────────────────────────────────

/**
 * Fetch ALL messages from a channel using pagination (before cursor).
 */
async function fetchAllMessages(channel, statusCallback) {
    const allMessages = [];
    let lastId = null;
    let page = 0;

    while (true) {
        const options = { limit: 100 };
        if (lastId) options.before = lastId;

        const fetched = await channel.messages.fetch(options);
        if (fetched.size === 0) break;

        allMessages.push(...fetched.values());
        lastId = fetched.last().id;
        page++;

        if (statusCallback && page % 5 === 0) {
            await statusCallback(`📥 Fetching messages... (${allMessages.length} so far)`);
        }

        // Small delay to avoid rate-limits
        await sleep(300);
    }

    return allMessages;
}

/**
 * Download an image attachment to a temp file with timeout.
 */
async function downloadImage(url, filename) {
    if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

    const filePath = path.join(TEMP_DIR, filename);
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: DOWNLOAD_TIMEOUT_MS
    });
    fs.writeFileSync(filePath, response.data);
    return filePath;
}

/**
 * Run Tesseract OCR on an image file with timeout protection.
 */
async function ocrImage(filePath) {
    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`OCR timeout after ${OCR_TIMEOUT_MS / 1000}s`)), OCR_TIMEOUT_MS)
    );

    const ocr = Tesseract.recognize(filePath, 'ind+eng').then(({ data: { text } }) => text);

    return Promise.race([ocr, timeout]);
}

/**
 * Extract the most likely payment nominal from OCR text.
 */
function extractNominal(text) {
    if (!text || text.trim().length === 0) return null;

    const cleaned = text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ');

    const rpPattern = /(?:Rp\.?|IDR)\s*([\d.,]+)/gi;
    let match;
    const candidates = [];

    while ((match = rpPattern.exec(cleaned)) !== null) {
        const num = parseNominal(match[1]);
        if (num && num >= 1000) candidates.push({ value: num, priority: 2 });
    }

    const numPattern = /(?<!\d)([\d]{1,3}(?:[.,]\d{3})+|[\d]{4,})(?!\d)/g;
    while ((match = numPattern.exec(cleaned)) !== null) {
        const num = parseNominal(match[1]);
        if (num && num >= 1000) candidates.push({ value: num, priority: 1 });
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.priority - a.priority || b.value - a.value);
    return candidates[0].value;
}

/**
 * Turn a string like "25.000" or "1,500,000" or "25000" into a number.
 */
function parseNominal(str) {
    if (!str) return null;

    let cleaned = str.trim();

    if (/\.\d{3}$/.test(cleaned) && !/,\d{3}/.test(cleaned)) {
        cleaned = cleaned.replace(/\./g, '');
    } else if (/,\d{3}$/.test(cleaned)) {
        cleaned = cleaned.replace(/,/g, '');
        cleaned = cleaned.replace(/\./g, '');
    } else {
        cleaned = cleaned.replace(/[.,]/g, '');
    }

    const num = parseInt(cleaned, 10);
    return isNaN(num) ? null : num;
}

/**
 * Process items with limited concurrency.
 */
async function asyncPool(limit, items, fn) {
    const results = [];
    const executing = new Set();

    for (const [index, item] of items.entries()) {
        const p = Promise.resolve().then(() => fn(item, index));
        results.push(p);
        executing.add(p);

        const clean = () => executing.delete(p);
        p.then(clean, clean);

        if (executing.size >= limit) {
            await Promise.race(executing);
        }
    }

    return Promise.allSettled(results);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function getMonthKey(timestamp) {
    const d = new Date(timestamp);
    const months = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

function formatRupiah(num) {
    return `Rp ${num.toLocaleString('id-ID')}`;
}

function cleanupTemp() {
    try {
        if (fs.existsSync(TEMP_DIR)) {
            fs.rmSync(TEMP_DIR, { recursive: true, force: true });
        }
    } catch (_) { /* ignore */ }
}

// ─── COMMAND ──────────────────────────────────────────────────────────

module.exports = {
    data: new SlashCommandBuilder()
        .setName('totalincome')
        .setDescription('Hitung total pendapatan dari channel proof-of-purchase via OCR')
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('Channel proof-of-purchase (opsional, default: auto-detect)')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply();

        // ── 1. Resolve target channel ────────────────────────────────
        let targetChannel = interaction.options.getChannel('channel');

        if (!targetChannel) {
            targetChannel = interaction.guild.channels.cache.get(TARGET_CHANNEL_ID);
        }

        if (!targetChannel) {
            return interaction.editReply({
                content: `❌ Channel <#${TARGET_CHANNEL_ID}> tidak ditemukan. Pastikan bot memiliki akses ke channel tersebut, atau pilih channel secara manual.`
            });
        }

        const perms = targetChannel.permissionsFor(interaction.guild.members.me);
        if (!perms || !perms.has('ViewChannel') || !perms.has('ReadMessageHistory')) {
            return interaction.editReply({
                content: '❌ Bot tidak memiliki izin untuk membaca message di channel tersebut.'
            });
        }

        await interaction.editReply(`⏳ Memulai proses... Mengambil semua message dari <#${targetChannel.id}>`);

        try {
            // ── 2. Fetch all messages ────────────────────────────────
            const allMessages = await fetchAllMessages(targetChannel, async (status) => {
                try { await interaction.editReply(status); } catch (_) {}
            });

            await interaction.editReply(`📥 Total message: **${allMessages.length}**. Memfilter gambar...`);

            // ── 3. Collect image attachments ─────────────────────────
            const imageItems = [];
            for (const msg of allMessages) {
                for (const att of msg.attachments.values()) {
                    const ext = path.extname(att.name || '').toLowerCase();
                    if (IMAGE_EXTENSIONS.includes(ext) || (att.contentType && att.contentType.startsWith('image/'))) {
                        imageItems.push({
                            url: att.url,
                            filename: `${msg.id}_${att.id}${ext || '.png'}`,
                            timestamp: msg.createdTimestamp,
                            messageId: msg.id
                        });
                    }
                }
            }

            if (imageItems.length === 0) {
                cleanupTemp();
                return interaction.editReply('⚠️ Tidak ada gambar yang ditemukan di channel tersebut.');
            }

            await interaction.editReply(
                `🖼️ Ditemukan **${imageItems.length}** gambar. Memulai OCR (concurrency: ${CONCURRENCY_LIMIT})...`
            );

            // ── 4. Download + OCR with limited concurrency ──────────
            let processed = 0;
            let ocrErrors = 0;

            const results = await asyncPool(CONCURRENCY_LIMIT, imageItems, async (item) => {
                let filePath = null;
                try {
                    filePath = await downloadImage(item.url, item.filename);
                    const text = await ocrImage(filePath);
                    const nominal = extractNominal(text);

                    processed++;
                    if (processed % 10 === 0) {
                        try {
                            await interaction.editReply(
                                `🔍 OCR Progress: **${processed}/${imageItems.length}** ` +
                                `(errors: ${ocrErrors})`
                            );
                        } catch (_) {}
                    }

                    return {
                        messageId: item.messageId,
                        timestamp: item.timestamp,
                        nominal: nominal,
                        ocrText: text ? text.substring(0, 200) : '',
                        success: true
                    };
                } catch (err) {
                    ocrErrors++;
                    processed++;
                    console.error(`[TOTALINCOME] OCR failed for ${item.filename}:`, err.message);

                    // Update progress juga saat error supaya tidak stuck
                    if (processed % 10 === 0) {
                        try {
                            await interaction.editReply(
                                `🔍 OCR Progress: **${processed}/${imageItems.length}** ` +
                                `(errors: ${ocrErrors})`
                            );
                        } catch (_) {}
                    }

                    return {
                        messageId: item.messageId,
                        timestamp: item.timestamp,
                        nominal: null,
                        ocrText: '',
                        success: false,
                        error: err.message
                    };
                } finally {
                    if (filePath && fs.existsSync(filePath)) {
                        try { fs.unlinkSync(filePath); } catch (_) {}
                    }
                }
            });

            // ── 5. Aggregate results ─────────────────────────────────
            let totalIncome = 0;
            const monthlyTotals = {};
            let successCount = 0;
            let failedCount = 0;
            let noNominalCount = 0;

            for (const result of results) {
                const r = result.status === 'fulfilled' ? result.value : null;
                if (!r || !r.success) {
                    failedCount++;
                    continue;
                }

                if (r.nominal === null) {
                    noNominalCount++;
                    continue;
                }

                successCount++;
                totalIncome += r.nominal;

                const monthKey = getMonthKey(r.timestamp);
                if (!monthlyTotals[monthKey]) monthlyTotals[monthKey] = 0;
                monthlyTotals[monthKey] += r.nominal;
            }

            const sortedMonths = Object.entries(monthlyTotals).sort((a, b) => {
                const monthOrder = [
                    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
                    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
                ];
                const [mA, yA] = a[0].split(' ');
                const [mB, yB] = b[0].split(' ');
                if (yA !== yB) return parseInt(yA) - parseInt(yB);
                return monthOrder.indexOf(mA) - monthOrder.indexOf(mB);
            });

            // ── 6. Build embed response ──────────────────────────────
            const monthlyLines = sortedMonths.map(
                ([month, total]) => `**${month}:** ${formatRupiah(total)}`
            ).join('\n');

            const embed = new EmbedBuilder()
                .setTitle('💰 Total Income Report')
                .setColor(0x00C853)
                .setDescription(`Hasil scan OCR dari <#${targetChannel.id}>`)
                .addFields(
                    {
                        name: '💵 Total Pendapatan',
                        value: `### ${formatRupiah(totalIncome)}`,
                        inline: false
                    },
                    {
                        name: '📅 Rekap Bulanan',
                        value: monthlyLines || 'Tidak ada data',
                        inline: false
                    },
                    {
                        name: '📊 Statistik',
                        value: [
                            `Total message: **${allMessages.length}**`,
                            `Total gambar: **${imageItems.length}**`,
                            `Berhasil dibaca: **${successCount}**`,
                            `Nominal tidak ditemukan: **${noNominalCount}**`,
                            `OCR gagal: **${failedCount}**`
                        ].join('\n'),
                        inline: false
                    }
                )
                .setFooter({ text: 'Powered by Tesseract.js OCR' })
                .setTimestamp();

            await interaction.editReply({ content: null, embeds: [embed] });

        } catch (err) {
            console.error('[TOTALINCOME] Fatal error:', err);
            await interaction.editReply(`❌ Terjadi error: ${err.message}`);
        } finally {
            cleanupTemp();
        }
    }
};
