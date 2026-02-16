const { SlashCommandBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuration
const PROMETHEUS_CONFIG = {
    LUA_PATH: process.env.LUA_PATH || 'lua',
    // Path should point to the directory containing cli.lua
    PROMETHEUS_PATH: process.env.PROMETHEUS_PATH || path.join(__dirname, '..', 'prometheus'),
    TEMP_DIR: process.env.TEMP_DIR || path.join(__dirname, '..', 'temp'),
    MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE) || 512000,
    TIMEOUT: parseInt(process.env.OBFUSCATE_TIMEOUT) || 60000,
    WATERMARK: {
        url: 'https://blokmarket.store/'
    }
};

// Ensure temp directory exists
if (!fs.existsSync(PROMETHEUS_CONFIG.TEMP_DIR)) {
    fs.mkdirSync(PROMETHEUS_CONFIG.TEMP_DIR, { recursive: true });
}

// Verify Prometheus CLI exists
function verifyPrometheusInstallation() {
    // Try direct path first
    let cliPath = path.join(PROMETHEUS_CONFIG.PROMETHEUS_PATH, 'cli.lua');
    
    // If not found, try parent directory (in case path points to src folder)
    if (!fs.existsSync(cliPath)) {
        const parentPath = path.join(PROMETHEUS_CONFIG.PROMETHEUS_PATH, '..');
        cliPath = path.join(parentPath, 'cli.lua');
        
        if (fs.existsSync(cliPath)) {
            // Update config to use parent path
            PROMETHEUS_CONFIG.PROMETHEUS_PATH = path.resolve(parentPath);
            console.log('[OBFUSCATE] Found cli.lua in parent directory:', PROMETHEUS_CONFIG.PROMETHEUS_PATH);
            return true;
        }
    }
    
    if (!fs.existsSync(cliPath)) {
        console.error('[OBFUSCATE] ERROR: Prometheus cli.lua not found at:', cliPath);
        console.error('[OBFUSCATE] Please ensure PROMETHEUS_PATH points to the directory containing cli.lua');
        console.error('[OBFUSCATE] Current PROMETHEUS_PATH:', PROMETHEUS_CONFIG.PROMETHEUS_PATH);
        console.error('[OBFUSCATE] Expected cli.lua at:', path.join(PROMETHEUS_CONFIG.PROMETHEUS_PATH, 'cli.lua'));
        return false;
    }
    
    console.log('[OBFUSCATE] Prometheus CLI found at:', cliPath);
    return true;
}

/**
 * Generate watermark header
 */
function generateWatermark() {
    return `--[[ ${PROMETHEUS_CONFIG.WATERMARK.url} ]]\n\n`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('obfuscate')
        .setDescription('Obfuscate Lua code using Prometheus')
        .addAttachmentOption(option =>
            option
                .setName('file')
                .setDescription('Lua file to obfuscate (.lua)')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('output_name')
                .setDescription('Custom output filename (without extension)')
                .setRequired(false)
        ),

    async execute(interaction) {
        const attachment = interaction.options.getAttachment('file');
        const customOutputName = interaction.options.getString('output_name');

        // Verify Prometheus installation first
        if (!verifyPrometheusInstallation()) {
            return interaction.reply({
                content: [
                    '❌ **Prometheus Not Configured**',
                    '',
                    'The Prometheus obfuscator is not properly installed or configured.',
                    '',
                    '**Setup Instructions:**',
                    '1. Download Prometheus from GitHub',
                    '2. Extract to a folder (e.g., `/path/to/prometheus`)',
                    '3. Set environment variable:',
                    '   `PROMETHEUS_PATH=/path/to/prometheus`',
                    '',
                    `**Current Path:** \`${PROMETHEUS_CONFIG.PROMETHEUS_PATH}\``,
                    `**Looking for:** \`cli.lua\``,
                    '',
                    '*Contact your administrator for help.*'
                ].join('\n'),
                flags: MessageFlags.Ephemeral
            });
        }

        // Validate file extension
        if (!attachment.name.endsWith('.lua')) {
            return interaction.reply({
                content: '❌ **Error:** Please upload a `.lua` file.',
                flags: MessageFlags.Ephemeral
            });
        }

        // Validate file size
        if (attachment.size > PROMETHEUS_CONFIG.MAX_FILE_SIZE) {
            const maxSizeMB = (PROMETHEUS_CONFIG.MAX_FILE_SIZE / 1024 / 1024).toFixed(2);
            return interaction.reply({
                content: `❌ **Error:** File too large. Maximum size is ${maxSizeMB}MB.`,
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply();

        const sessionId = crypto.randomBytes(8).toString('hex');
        const inputPath = path.join(PROMETHEUS_CONFIG.TEMP_DIR, `input_${sessionId}.lua`);
        const obfuscatedPath = path.join(PROMETHEUS_CONFIG.TEMP_DIR, `input_${sessionId}.obfuscated.lua`);

        try {
            // Download the file
            const response = await fetch(attachment.url);
            if (!response.ok) {
                throw new Error('Failed to download file');
            }
            const code = await response.text();

            // Basic validation
            if (!code.trim()) {
                throw new Error('File is empty');
            }

            // Auto-detect Lua version (LuaU vs Lua51)
            const luauPatterns = [
                /\+=|-=|\*=|\/=|%=|\^=|\.\.=/,
                /\bcontinue\b/,
                /:\s*\w+[\?]?\s*[=,\)]/,
                /^type\s+\w+\s*=/m,
                /`[^`]*\{[^}]+\}[^`]*`/,
                /\bexport\s+type\b/
            ];
            const isLuaU = luauPatterns.some(pattern => pattern.test(code));
            const luaVersion = isLuaU ? "LuaU" : "Lua51";

            // Save input file
            fs.writeFileSync(inputPath, code, 'utf8');

            // Execute Prometheus CLI
            // Command: lua ./cli.lua --preset Medium --LuaVersion LuaU --nocolors input.lua
            const result = await new Promise((resolve, reject) => {
                const startTime = Date.now();
                
                const args = [
                    path.join(PROMETHEUS_CONFIG.PROMETHEUS_PATH, 'cli.lua'),
                    '--preset', 'Medium',
                    '--LuaVersion', luaVersion,
                    '--nocolors',
                    inputPath
                ];
                
                console.log(`[OBFUSCATE] Executing: ${PROMETHEUS_CONFIG.LUA_PATH} ${args.join(' ')}`);
                
                const proc = spawn(PROMETHEUS_CONFIG.LUA_PATH, args, {
                    timeout: PROMETHEUS_CONFIG.TIMEOUT,
                    cwd: PROMETHEUS_CONFIG.PROMETHEUS_PATH
                });

                let stdout = '';
                let stderr = '';

                proc.stdout.on('data', (data) => {
                    const output = data.toString();
                    stdout += output;
                    console.log(`[OBFUSCATE] stdout: ${output}`);
                });

                proc.stderr.on('data', (data) => {
                    const output = data.toString();
                    stderr += output;
                    console.error(`[OBFUSCATE] stderr: ${output}`);
                });

                proc.on('close', (code) => {
                    const duration = Date.now() - startTime;
                    console.log(`[OBFUSCATE] Process exited with code ${code} in ${duration}ms`);
                    
                    if (code === 0) {
                        resolve({ success: true, duration, stdout });
                    } else {
                        // Check if it's just a warning/info message
                        if (fs.existsSync(obfuscatedPath)) {
                            console.log('[OBFUSCATE] Output file exists despite non-zero exit code, treating as success');
                            resolve({ success: true, duration, stdout });
                        } else {
                            reject(new Error(stderr || stdout || `Process exited with code ${code}`));
                        }
                    }
                });

                proc.on('error', (err) => {
                    console.error(`[OBFUSCATE] Process error:`, err);
                    reject(new Error(`Failed to start Lua: ${err.message}`));
                });
            });

            // Read obfuscated output (Prometheus creates .obfuscated.lua file)
            if (!fs.existsSync(obfuscatedPath)) {
                throw new Error('Obfuscated file was not created');
            }

            let obfuscatedCode = fs.readFileSync(obfuscatedPath, 'utf8');
            
            // Add watermark
            const watermark = generateWatermark();
            obfuscatedCode = watermark + obfuscatedCode;
            
            // Prepare output filename
            const originalName = path.basename(attachment.name, '.lua');
            const outputFileName = customOutputName 
                ? `${customOutputName}.lua`
                : `${originalName}_obfuscated.lua`;

            // Create attachment
            const buffer = Buffer.from(obfuscatedCode, 'utf8');
            const fileAttachment = new AttachmentBuilder(buffer, { name: outputFileName });

            // Calculate stats
            const originalSize = Buffer.byteLength(code, 'utf8');
            const obfuscatedSize = buffer.length;
            const sizeChange = ((obfuscatedSize - originalSize) / originalSize * 100).toFixed(1);
            const sizeChangeStr = sizeChange > 0 ? `+${sizeChange}%` : `${sizeChange}%`;

            // Build response message
            const responseLines = [
                `✅ **Obfuscation Complete!**`,
                ``,
                `📄 **File:** \`${attachment.name}\``,
                `🔧 **Lua Version:** ${luaVersion}`,
                `🎯 **Preset:** Medium`,
                `⏱️ **Duration:** ${(result.duration / 1000).toFixed(2)}s`,
                `📈 **Size:** ${formatBytes(originalSize)} → ${formatBytes(obfuscatedSize)} (${sizeChangeStr})`,
                ``,
                `*Powered by Prometheus Lua Obfuscator*`
            ];

            // Send response
            await interaction.editReply({
                content: responseLines.join('\n'),
                files: [fileAttachment]
            });

            console.log(`[OBFUSCATE] Success | User: ${interaction.user.tag} | File: ${attachment.name} | LuaVersion: ${luaVersion} | Duration: ${result.duration}ms`);

        } catch (error) {
            console.error(`[OBFUSCATE] Error | User: ${interaction.user.tag} | File: ${attachment.name}:`, error);

            let errorMessage = 'An unexpected error occurred.';
            
            if (error.message.includes('Failed to start Lua')) {
                errorMessage = `Lua interpreter not found.\n\n**Current LUA_PATH:** \`${PROMETHEUS_CONFIG.LUA_PATH}\`\n\nPlease set the correct path in your .env file.`;
            } else if (error.message.includes('cli.lua')) {
                errorMessage = `Prometheus CLI not found.\n\n**Current PROMETHEUS_PATH:** \`${PROMETHEUS_CONFIG.PROMETHEUS_PATH}\`\n\nPlease verify Prometheus is installed correctly.`;
            } else if (error.message.includes('syntax error') || error.message.includes('Parsing Error')) {
                errorMessage = 'Your Lua code contains syntax errors. Please check your code and try again.';
            } else if (error.message.includes('timeout')) {
                errorMessage = 'Obfuscation timed out. Try using a smaller file.';
            } else if (error.message.includes('ENOENT')) {
                errorMessage = `File not found error.\n\n**Prometheus Path:** \`${PROMETHEUS_CONFIG.PROMETHEUS_PATH}\`\n**Lua Path:** \`${PROMETHEUS_CONFIG.LUA_PATH}\`\n\nPlease check your configuration.`;
            } else if (error.message) {
                errorMessage = error.message;
            }

            await interaction.editReply({
                content: [
                    `❌ **Obfuscation Failed**`,
                    ``,
                    `**Error:** ${errorMessage}`,
                    ``,
                    `*If this issue persists, please contact support.*`
                ].join('\n')
            });

        } finally {
            // Cleanup temp files
            [inputPath, obfuscatedPath].forEach(file => {
                try {
                    if (fs.existsSync(file)) {
                        fs.unlinkSync(file);
                    }
                } catch (e) {
                    console.error(`[OBFUSCATE] Failed to cleanup ${file}:`, e.message);
                }
            });
        }
    }
};

// Helper functions
function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}
