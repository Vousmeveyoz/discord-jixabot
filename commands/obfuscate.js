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

// Log configuration on startup
console.log('[OBFUSCATE] Configuration:');
console.log('[OBFUSCATE]   LUA_PATH:', PROMETHEUS_CONFIG.LUA_PATH);
console.log('[OBFUSCATE]   PROMETHEUS_PATH:', PROMETHEUS_CONFIG.PROMETHEUS_PATH);
console.log('[OBFUSCATE]   TEMP_DIR:', PROMETHEUS_CONFIG.TEMP_DIR);

// Verify cli.lua exists on startup
const cliPath = path.join(PROMETHEUS_CONFIG.PROMETHEUS_PATH, 'cli.lua');
if (fs.existsSync(cliPath)) {
    console.log('[OBFUSCATE]   cli.lua: ✓ Found at', cliPath);
} else {
    console.error('[OBFUSCATE]   cli.lua: ✗ NOT FOUND at', cliPath);
    console.error('[OBFUSCATE]   Bot will not be able to obfuscate files!');
}

// Verify Prometheus CLI exists
function verifyPrometheusInstallation() {
    console.log('[OBFUSCATE] Verifying Prometheus installation...');
    console.log('[OBFUSCATE] PROMETHEUS_PATH:', PROMETHEUS_CONFIG.PROMETHEUS_PATH);
    
    // Try direct path first
    let cliPath = path.join(PROMETHEUS_CONFIG.PROMETHEUS_PATH, 'cli.lua');
    console.log('[OBFUSCATE] Checking for cli.lua at:', cliPath);
    
    if (fs.existsSync(cliPath)) {
        console.log('[OBFUSCATE] ✓ cli.lua found!');
        return true;
    }
    
    // Try src subfolder (in case user has different structure)
    const srcPath = path.join(PROMETHEUS_CONFIG.PROMETHEUS_PATH, 'src', 'cli.lua');
    console.log('[OBFUSCATE] Checking for cli.lua at:', srcPath);
    
    if (fs.existsSync(srcPath)) {
        console.log('[OBFUSCATE] ✓ cli.lua found in src folder!');
        return true;
    }
    
    // Try parent directory (in case path accidentally points to src)
    const parentPath = path.join(PROMETHEUS_CONFIG.PROMETHEUS_PATH, '..');
    const parentCliPath = path.join(parentPath, 'cli.lua');
    console.log('[OBFUSCATE] Checking for cli.lua at:', parentCliPath);
    
    if (fs.existsSync(parentCliPath)) {
        console.log('[OBFUSCATE] ✓ cli.lua found in parent directory!');
        // Update config to use correct path
        PROMETHEUS_CONFIG.PROMETHEUS_PATH = path.resolve(parentPath);
        console.log('[OBFUSCATE] Updated PROMETHEUS_PATH to:', PROMETHEUS_CONFIG.PROMETHEUS_PATH);
        return true;
    }
    
    console.error('[OBFUSCATE] ✗ cli.lua NOT FOUND in any expected location');
    console.error('[OBFUSCATE] Searched:');
    console.error('[OBFUSCATE]   -', cliPath);
    console.error('[OBFUSCATE]   -', srcPath);
    console.error('[OBFUSCATE]   -', parentCliPath);
    console.error('[OBFUSCATE] Please verify:');
    console.error('[OBFUSCATE]   1. Prometheus is downloaded/cloned');
    console.error('[OBFUSCATE]   2. PROMETHEUS_PATH in .env points to prometheus folder');
    console.error('[OBFUSCATE]   3. cli.lua file exists in that folder');
    
    // List directory contents for debugging
    try {
        const dirContents = fs.readdirSync(PROMETHEUS_CONFIG.PROMETHEUS_PATH);
        console.error('[OBFUSCATE] Contents of PROMETHEUS_PATH:', dirContents.join(', '));
    } catch (e) {
        console.error('[OBFUSCATE] Could not read directory:', e.message);
    }
    
    return false;
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

            // Create custom config file for Roblox-safe obfuscation
            const configPath = path.join(PROMETHEUS_CONFIG.TEMP_DIR, `config_${sessionId}.lua`);
            const configContent = `
return {
    LuaVersion = "${luaVersion}";
    VarNamePrefix = "";
    NameGenerator = "MangledShuffled";
    PrettyPrint = false;
    Seed = ${Math.floor(Math.random() * 1000000)};
    Steps = {
        {
            Name = "SplitStrings";
            Settings = {
                Treshold = 0.7;
                MinLength = 2;
                MaxLength = 5;
                ConcatenationType = "strcat";
            }
        };
        {
            Name = "ConstantArray";
            Settings = {
                StringsOnly = true;
                Treshold = 1;
                Shuffle = true;
                Rotate = false;
                LocalWrapperTreshold = 0.3;
                LocalWrapperCount = 1;
                LocalWrapperArgCount = 2;
                MaxWrapperOffset = 1000;
            }
        };
        {
            Name = "WrapInFunction";
            Settings = {
                Iterations = 1;
            }
        };
    }
}
`;
            fs.writeFileSync(configPath, configContent, 'utf8');

            // Execute Prometheus CLI
            // IMPORTANT: Prometheus CLI needs relative path from its working directory
            // We're running from prometheus dir, so we need to calculate relative path
            const relativeInputPath = path.relative(PROMETHEUS_CONFIG.PROMETHEUS_PATH, inputPath);
            const relativeConfigPath = path.relative(PROMETHEUS_CONFIG.PROMETHEUS_PATH, configPath);
            
            console.log(`[OBFUSCATE] Input path (absolute): ${inputPath}`);
            console.log(`[OBFUSCATE] Input path (relative): ${relativeInputPath}`);
            console.log(`[OBFUSCATE] Config path (relative): ${relativeConfigPath}`);
            
            const result = await new Promise((resolve, reject) => {
                const startTime = Date.now();
                
                // Build args: cli.lua --config ../temp/config_xxx.lua --nocolors ../temp/input_xxx.lua
                const args = [
                    'cli.lua',
                    '--config', relativeConfigPath,
                    '--nocolors',
                    relativeInputPath
                ];
                
                const commandStr = `${PROMETHEUS_CONFIG.LUA_PATH} ${args.join(' ')}`;
                console.log(`[OBFUSCATE] Executing: ${commandStr}`);
                console.log(`[OBFUSCATE] Working directory: ${PROMETHEUS_CONFIG.PROMETHEUS_PATH}`);
                
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
                        const actualObfuscatedPath = inputPath.replace('.lua', '.obfuscated.lua');
                        if (fs.existsSync(actualObfuscatedPath)) {
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

            // Read obfuscated output
            // Prometheus creates .obfuscated.lua in the SAME directory as input
            // Since input is ../temp/input_xxx.lua, output will be ../temp/input_xxx.obfuscated.lua
            const actualObfuscatedPath = inputPath.replace('.lua', '.obfuscated.lua');
            
            console.log(`[OBFUSCATE] Looking for output at: ${actualObfuscatedPath}`);
            
            if (!fs.existsSync(actualObfuscatedPath)) {
                console.error(`[OBFUSCATE] Output file not found at: ${actualObfuscatedPath}`);
                throw new Error('Obfuscated file was not created');
            }

            let obfuscatedCode = fs.readFileSync(actualObfuscatedPath, 'utf8');
            
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
                `🎯 **Preset:** Roblox-Safe (Custom)`,
                `⏱️ **Duration:** ${(result.duration / 1000).toFixed(2)}s`,
                `📈 **Size:** ${formatBytes(originalSize)} → ${formatBytes(obfuscatedSize)} (${sizeChangeStr})`,
                ``,
                `*Optimized for Roblox compatibility*`
            ];

            // Send response
            await interaction.editReply({
                content: responseLines.join('\n'),
                files: [fileAttachment]
            });

            console.log(`[OBFUSCATE] Success | User: ${interaction.user.tag} | File: ${attachment.name} | LuaVersion: ${luaVersion} | Duration: ${result.duration}ms`);

        } catch (error) {
            console.error(`[OBFUSCATE] Error | User: ${interaction.user.tag} | File: ${attachment.name}:`, error);
            console.error(`[OBFUSCATE] Error stack:`, error.stack);

            let errorMessage = 'An unexpected error occurred.';
            
            // Show actual error message for better debugging
            if (error.message.includes('ENOENT')) {
                errorMessage = `Command execution failed.\n\n**Error:** File or command not found\n**LUA_PATH:** \`${PROMETHEUS_CONFIG.LUA_PATH}\`\n**PROMETHEUS_PATH:** \`${PROMETHEUS_CONFIG.PROMETHEUS_PATH}\`\n\nMake sure Lua/LuaJIT is installed and accessible.`;
            } else if (error.message.includes('Failed to start')) {
                errorMessage = `Could not start obfuscation process.\n\n**Error:** ${error.message}\n**LUA_PATH:** \`${PROMETHEUS_CONFIG.LUA_PATH}\`\n\nMake sure Lua/LuaJIT is installed: \`${PROMETHEUS_CONFIG.LUA_PATH} -v\``;
            } else if (error.message.includes('No input file')) {
                errorMessage = `Prometheus error: No input file was specified.\n\nThis is a CLI argument issue. Please contact support with console logs.`;
            } else if (error.message.includes('syntax error') || error.message.includes('Parsing Error')) {
                errorMessage = `Your Lua code contains syntax errors.\n\n**Error:** ${error.message}\n\nPlease check your code and try again.`;
            } else if (error.message.includes('timeout')) {
                errorMessage = 'Obfuscation timed out. Try using a smaller file.';
            } else if (error.message.includes('Obfuscated file was not created')) {
                errorMessage = `Obfuscation completed but output file was not created.\n\nThis might be a Prometheus error. Check console logs for details.`;
            } else {
                // Show actual error message
                errorMessage = `${error.message}\n\n**Debug Info:**\n- LUA: \`${PROMETHEUS_CONFIG.LUA_PATH}\`\n- Path: \`${PROMETHEUS_CONFIG.PROMETHEUS_PATH}\`\n\nCheck console logs for more details.`;
            }

            await interaction.editReply({
                content: [
                    `❌ **Obfuscation Failed**`,
                    ``,
                    `**Error:** ${errorMessage}`,
                    ``,
                    `*Check console logs for detailed error information.*`
                ].join('\n')
            });

        } finally {
            // Cleanup temp files
            const actualObfuscatedPath = inputPath.replace('.lua', '.obfuscated.lua');
            const configPath = path.join(PROMETHEUS_CONFIG.TEMP_DIR, `config_${sessionId}.lua`);
            [inputPath, actualObfuscatedPath, configPath].forEach(file => {
                try {
                    if (fs.existsSync(file)) {
                        fs.unlinkSync(file);
                        console.log(`[OBFUSCATE] Cleaned up: ${file}`);
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
