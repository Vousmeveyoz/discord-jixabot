const { SlashCommandBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuration - adjust these paths according to your setup
const PROMETHEUS_CONFIG = {
    // Path to Lua interpreter (lua, lua5.1, or luajit)
    LUA_PATH: process.env.LUA_PATH || 'lua',
    // Path to your Prometheus installation (containing prometheus.lua)
    PROMETHEUS_PATH: process.env.PROMETHEUS_PATH || path.join(__dirname, '..', 'prometheus'),
    // Temp directory for processing files
    TEMP_DIR: process.env.TEMP_DIR || path.join(__dirname, '..', 'temp'),
    // Maximum file size (in bytes) - 500KB default
    MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE) || 512000,
    // Timeout for obfuscation process (ms)
    TIMEOUT: parseInt(process.env.OBFUSCATE_TIMEOUT) || 60000
};

// Preset configurations
const PRESETS = {
    weak: 'Weak',
    medium: 'Medium',
    strong: 'Strong',
    minify: 'Minify'
};

// Ensure temp directory exists
if (!fs.existsSync(PROMETHEUS_CONFIG.TEMP_DIR)) {
    fs.mkdirSync(PROMETHEUS_CONFIG.TEMP_DIR, { recursive: true });
}

/**
 * Convert Luau/Roblox Lua syntax to standard Lua 5.1
 * This allows Prometheus to process Roblox scripts
 */
function convertLuauToLua51(code) {
    let converted = code;
    
    // 1. Convert compound assignments: += -= *= /= %= ^= ..=
    // a += b  =>  a = a + b
    converted = converted.replace(/(\w+)\s*\+=\s*/g, '$1 = $1 + ');
    converted = converted.replace(/(\w+)\s*-=\s*/g, '$1 = $1 - ');
    converted = converted.replace(/(\w+)\s*\*=\s*/g, '$1 = $1 * ');
    converted = converted.replace(/(\w+)\s*\/=\s*/g, '$1 = $1 / ');
    converted = converted.replace(/(\w+)\s*%=\s*/g, '$1 = $1 % ');
    converted = converted.replace(/(\w+)\s*\^=\s*/g, '$1 = $1 ^ ');
    converted = converted.replace(/(\w+)\s*\.\.=\s*/g, '$1 = $1 .. ');
    
    // 2. Convert 'continue' to a goto pattern (basic support)
    // This is a simplified conversion - complex cases may need manual fixing
    // For now, we'll just comment it out with a note
    converted = converted.replace(/\bcontinue\b/g, '-- continue (not supported in Lua 5.1)');
    
    // 3. Type annotations: Remove them
    // local x: number = 5  =>  local x = 5
    // function foo(a: string, b: number): boolean  =>  function foo(a, b)
    converted = converted.replace(/:\s*\w+(\?)?(\s*[=,\)])/g, '$2');
    converted = converted.replace(/\)\s*:\s*\w+(\?)?(\s*[\n{])/g, ')$2');
    
    // 4. Remove type declarations
    // type MyType = { ... }  =>  (removed)
    converted = converted.replace(/^type\s+\w+\s*=\s*\{[^}]*\}\s*$/gm, '-- type declaration removed');
    converted = converted.replace(/^export\s+type\s+\w+\s*=\s*\{[^}]*\}\s*$/gm, '-- export type declaration removed');
    
    // 5. Convert if-then expressions (ternary-like) - basic support
    // This is complex, so we'll leave it for now
    
    // 6. String interpolation: `Hello {name}` => "Hello " .. name
    // Basic support - complex cases may need manual fixing
    converted = converted.replace(/`([^`]*)\{([^}]+)\}([^`]*)`/g, '"$1" .. $2 .. "$3"');
    
    return converted;
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
                .setName('preset')
                .setDescription('Obfuscation strength preset')
                .setRequired(false)
                .addChoices(
                    { name: '🟢 Weak - Fast, light obfuscation', value: 'weak' },
                    { name: '🟡 Medium - Balanced obfuscation', value: 'medium' },
                    { name: '🔴 Strong - Maximum protection (slower)', value: 'strong' },
                    { name: '📦 Minify - Only minification', value: 'minify' }
                )
        )
        .addStringOption(option =>
            option
                .setName('output_name')
                .setDescription('Custom output filename (without extension)')
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option
                .setName('luau_convert')
                .setDescription('Auto-convert Luau/Roblox syntax to Lua 5.1 (default: true)')
                .setRequired(false)
        ),

    async execute(interaction) {
        const attachment = interaction.options.getAttachment('file');
        const preset = interaction.options.getString('preset') || 'strong';
        const customOutputName = interaction.options.getString('output_name');
        const luauConvert = interaction.options.getBoolean('luau_convert') ?? true;

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
        const outputPath = path.join(PROMETHEUS_CONFIG.TEMP_DIR, `output_${sessionId}.lua`);
        const wrapperPath = path.join(PROMETHEUS_CONFIG.TEMP_DIR, `wrapper_${sessionId}.lua`);

        try {
            // Download the file
            const response = await fetch(attachment.url);
            if (!response.ok) {
                throw new Error('Failed to download file');
            }
            let code = await response.text();

            // Basic validation
            if (!code.trim()) {
                throw new Error('File is empty');
            }

            // Convert Luau syntax to Lua 5.1 if enabled
            let wasConverted = false;
            if (luauConvert) {
                const originalCode = code;
                code = convertLuauToLua51(code);
                wasConverted = (code !== originalCode);
            }

            // Save input file
            fs.writeFileSync(inputPath, code, 'utf8');

            // Create wrapper script to use Prometheus as library
            const wrapperScript = `
-- Prometheus Obfuscation Wrapper
package.path = "./?.lua;./prometheus/?.lua;" .. package.path

local success, Prometheus = pcall(require, "prometheus")
if not success then
    io.stderr:write("ERROR: Failed to load Prometheus: " .. tostring(Prometheus))
    os.exit(1)
end

-- Suppress console output
Prometheus.Logger.logLevel = Prometheus.Logger.LogLevel.Error

-- Read input file
local inputFile = io.open("${inputPath.replace(/\\/g, '/')}", "r")
if not inputFile then
    io.stderr:write("ERROR: Could not open input file")
    os.exit(1)
end
local code = inputFile:read("*all")
inputFile:close()

-- Create pipeline with selected preset
local presetName = "${PRESETS[preset]}"
local presetConfig = Prometheus.Presets[presetName]
if not presetConfig then
    io.stderr:write("ERROR: Invalid preset: " .. presetName)
    os.exit(1)
end

local pipeline = Prometheus.Pipeline:fromConfig(presetConfig)

-- Apply obfuscation
local success, result = pcall(function()
    return pipeline:apply(code)
end)

if not success then
    io.stderr:write("ERROR: Obfuscation failed: " .. tostring(result))
    os.exit(1)
end

-- Write output
local outputFile = io.open("${outputPath.replace(/\\/g, '/')}", "w")
if not outputFile then
    io.stderr:write("ERROR: Could not create output file")
    os.exit(1)
end
outputFile:write(result)
outputFile:close()

print("SUCCESS")
`;

            fs.writeFileSync(wrapperPath, wrapperScript, 'utf8');

            // Execute Prometheus from its directory
            const result = await new Promise((resolve, reject) => {
                const startTime = Date.now();
                
                const proc = spawn(PROMETHEUS_CONFIG.LUA_PATH, [wrapperPath], {
                    timeout: PROMETHEUS_CONFIG.TIMEOUT,
                    cwd: PROMETHEUS_CONFIG.PROMETHEUS_PATH  // Run from Prometheus directory
                });

                let stdout = '';
                let stderr = '';

                proc.stdout.on('data', (data) => {
                    stdout += data.toString();
                });

                proc.stderr.on('data', (data) => {
                    stderr += data.toString();
                });

                proc.on('close', (code) => {
                    const duration = Date.now() - startTime;
                    if (code === 0 && stdout.includes('SUCCESS')) {
                        resolve({ success: true, duration });
                    } else {
                        reject(new Error(stderr || `Process exited with code ${code}`));
                    }
                });

                proc.on('error', (err) => {
                    reject(new Error(`Failed to start Lua: ${err.message}`));
                });
            });

            // Read obfuscated output
            if (!fs.existsSync(outputPath)) {
                throw new Error('Output file was not created');
            }

            const obfuscatedCode = fs.readFileSync(outputPath, 'utf8');
            
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
                `🔒 **Preset:** ${getPresetEmoji(preset)} ${PRESETS[preset]}`,
                `⏱️ **Duration:** ${(result.duration / 1000).toFixed(2)}s`,
                `📊 **Size:** ${formatBytes(originalSize)} → ${formatBytes(obfuscatedSize)} (${sizeChangeStr})`
            ];

            if (wasConverted) {
                responseLines.push(`🔄 **Luau → Lua 5.1:** Auto-converted`);
            }

            responseLines.push(``, `*Powered by Prometheus Lua Obfuscator*`);

            // Send response
            await interaction.editReply({
                content: responseLines.join('\n'),
                files: [fileAttachment]
            });

            console.log(`[OBFUSCATE] Success | User: ${interaction.user.tag} | File: ${attachment.name} | Preset: ${preset} | Duration: ${result.duration}ms | Luau Convert: ${wasConverted}`);

        } catch (error) {
            console.error(`[OBFUSCATE] Error | User: ${interaction.user.tag} | File: ${attachment.name}:`, error);

            let errorMessage = 'An unexpected error occurred.';
            
            if (error.message.includes('Failed to load Prometheus')) {
                errorMessage = 'Prometheus is not properly installed. Please contact an administrator.';
            } else if (error.message.includes('Failed to start Lua')) {
                errorMessage = 'Lua interpreter not found. Please contact an administrator.';
            } else if (error.message.includes('syntax error') || error.message.includes('Parsing Error')) {
                errorMessage = 'Your Lua code contains syntax errors that could not be auto-fixed. Please check your code and try again.\n\n**Tip:** Some advanced Luau features may not be supported.';
            } else if (error.message.includes('timeout')) {
                errorMessage = 'Obfuscation timed out. Try using a weaker preset or smaller file.';
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
            [inputPath, outputPath, wrapperPath].forEach(file => {
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

function getPresetEmoji(preset) {
    const emojis = {
        weak: '🟢',
        medium: '🟡',
        strong: '🔴',
        minify: '📦'
    };
    return emojis[preset] || '⚪';
}
