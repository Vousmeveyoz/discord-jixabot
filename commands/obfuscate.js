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
    TIMEOUT: parseInt(process.env.OBFUSCATE_TIMEOUT) || 60000,
    // Watermark settings
    WATERMARK: {
        url: 'https://blokmarket.store/'
    }
};

// Ensure temp directory exists
if (!fs.existsSync(PROMETHEUS_CONFIG.TEMP_DIR)) {
    fs.mkdirSync(PROMETHEUS_CONFIG.TEMP_DIR, { recursive: true });
}

/**
 * Convert configuration object to Lua table string
 */
function configToLuaTable(config, indent = 0) {
    const spaces = '    '.repeat(indent);
    const innerSpaces = '    '.repeat(indent + 1);
    
    if (typeof config !== 'object' || config === null) {
        if (typeof config === 'string') {
            return `"${config}"`;
        }
        return String(config);
    }
    
    if (Array.isArray(config)) {
        if (config.length === 0) return '{}';
        const items = config.map(item => 
            `${innerSpaces}${configToLuaTable(item, indent + 1)}`
        );
        return `{\n${items.join(',\n')}\n${spaces}}`;
    }
    
    const entries = Object.entries(config).map(([key, value]) => {
        const luaValue = configToLuaTable(value, indent + 1);
        return `${innerSpaces}${key} = ${luaValue}`;
    });
    
    return `{\n${entries.join(';\n')}\n${spaces}}`;
}

/**
 * Generate watermark header for obfuscated code
 */
function generateWatermark() {
    return `--[[ ${PROMETHEUS_CONFIG.WATERMARK.url} ]]\n\n`;
}

/**
 * Validate Lua code for common issues
 */
function validateLuaCode(code) {
    const warnings = [];
    
    // Check for malformed numbers
    const malformedHex = code.match(/0x[^0-9A-Fa-f\s;,)\]}\n]/g);
    if (malformedHex) {
        warnings.push('Detected potential malformed hexadecimal numbers');
    }
    
    // Check for invalid scientific notation
    const invalidScientific = code.match(/\d+\.?\d*[eE][+-]?[^\d]/g);
    if (invalidScientific) {
        warnings.push('Detected potential malformed scientific notation');
    }
    
    // Check for division by zero
    const divByZero = code.match(/\/\s*0\s*[^.0-9]/g);
    if (divByZero) {
        warnings.push('Detected potential division by zero');
    }
    
    // Check for very long numbers (might cause precision issues)
    const longNumbers = code.match(/\b\d{16,}\b/g);
    if (longNumbers && longNumbers.length > 0) {
        warnings.push('Detected very large numbers that might lose precision');
    }
    
    // Check for Unicode characters
    const hasUnicode = /[^\x00-\x7F]/.test(code);
    if (hasUnicode) {
        warnings.push('Detected non-ASCII characters (may cause issues in Roblox)');
    }
    
    // Check for empty statements
    const emptyStatements = code.match(/;{2,}/g);
    if (emptyStatements) {
        warnings.push('Detected multiple consecutive semicolons');
    }
    
    return warnings;
}

/**
 * Fix common Roblox/LuaU compatibility issues in obfuscated code
 */
function fixRobloxCompatibility(code) {
    let fixed = code;
    
    // 1. Fix malformed hexadecimal numbers
    // Replace 0x followed by invalid hex (common Prometheus issue)
    // Example: 0xGGGG or incomplete hex
    fixed = fixed.replace(/0x([0-9A-Fa-f]*[G-Zg-z][0-9A-Za-z]*)/g, (match, invalidHex) => {
        // Convert to decimal if possible, otherwise remove
        return '0';
    });
    
    // 2. Fix scientific notation edge cases
    // Ensure proper formatting: 1e5, 1.5e-3, etc.
    fixed = fixed.replace(/(\d+\.?\d*)[eE]([+-]?\d+)/g, (match, base, exp) => {
        try {
            const num = parseFloat(match);
            if (!isNaN(num) && isFinite(num)) {
                return num.toString();
            }
        } catch (e) {
            // Ignore
        }
        return match;
    });
    
    // 3. Fix binary literals (not supported in Lua 5.1 or older LuaU)
    // 0b10101 => decimal equivalent
    fixed = fixed.replace(/0b([01]+)/g, (match, binary) => {
        return parseInt(binary, 2).toString();
    });
    
    // 4. Fix octal literals (can cause issues)
    // 0o777 => decimal equivalent
    fixed = fixed.replace(/0o([0-7]+)/g, (match, octal) => {
        return parseInt(octal, 8).toString();
    });
    
    // 5. Fix number literal edge cases
    // Remove leading zeros from decimals (except for 0.x)
    fixed = fixed.replace(/\b0+(\d+)/g, '$1');
    fixed = fixed.replace(/\b0+(0\.\d+)/g, '$1');
    
    // 6. Fix very large numbers that might overflow
    // Convert to scientific notation if too large
    fixed = fixed.replace(/\b(\d{16,})\b/g, (match) => {
        try {
            const num = BigInt(match);
            if (num > BigInt(Number.MAX_SAFE_INTEGER)) {
                return Number(match).toExponential();
            }
        } catch (e) {
            // Ignore
        }
        return match;
    });
    
    // 7. Fix concatenation with numbers that might be ambiguous
    // Ensure spaces around number operations
    fixed = fixed.replace(/(\d)\.\.(\d)/g, '$1 .. $2');
    
    // 8. Fix hexadecimal that's too long (Lua has limits)
    fixed = fixed.replace(/0x([0-9A-Fa-f]{17,})/g, (match, hex) => {
        // Convert to decimal if possible
        try {
            return parseInt(hex, 16).toString();
        } catch (e) {
            return '0';
        }
    });
    
    // 9. Remove any Unicode characters that might cause issues
    // Roblox can be sensitive to certain characters
    fixed = fixed.replace(/[^\x00-\x7F]/g, '');
    
    // 10. Fix division by zero edge cases
    fixed = fixed.replace(/\/\s*0\s*([^.0-9]|$)/g, '/ 1$1');
    
    // 11. Ensure all numbers are valid Lua numbers
    // Find standalone numbers and validate them
    fixed = fixed.replace(/\b(\d+\.?\d*(?:[eE][+-]?\d+)?)\b/g, (match) => {
        const num = parseFloat(match);
        if (isNaN(num) || !isFinite(num)) {
            return '0';
        }
        return match;
    });
    
    return fixed;
}

/**
 * Convert Luau/Roblox Lua syntax to standard Lua 5.1
 */
function convertLuauToLua51(code) {
    let converted = code;
    
    // 1. Convert compound assignments: += -= *= /= %= ^= ..=
    converted = converted.replace(/(\w+)\s*\+=\s*/g, '$1 = $1 + ');
    converted = converted.replace(/(\w+)\s*-=\s*/g, '$1 = $1 - ');
    converted = converted.replace(/(\w+)\s*\*=\s*/g, '$1 = $1 * ');
    converted = converted.replace(/(\w+)\s*\/=\s*/g, '$1 = $1 / ');
    converted = converted.replace(/(\w+)\s*%=\s*/g, '$1 = $1 % ');
    converted = converted.replace(/(\w+)\s*\^=\s*/g, '$1 = $1 ^ ');
    converted = converted.replace(/(\w+)\s*\.\.=\s*/g, '$1 = $1 .. ');
    
    // 2. Convert 'continue' to a goto pattern
    converted = converted.replace(/\bcontinue\b/g, '-- continue (not supported in Lua 5.1)');
    
    // 3. Type annotations: Remove them
    converted = converted.replace(/:\s*\w+(\?)?(\s*[=,\)])/g, '$2');
    converted = converted.replace(/\)\s*:\s*\w+(\?)?(\s*[\n{])/g, ')$2');
    
    // 4. Remove type declarations
    converted = converted.replace(/^type\s+\w+\s*=\s*\{[^}]*\}\s*$/gm, '-- type declaration removed');
    converted = converted.replace(/^export\s+type\s+\w+\s*=\s*\{[^}]*\}\s*$/gm, '-- export type declaration removed');
    
    // 5. String interpolation: `Hello {name}` => "Hello " .. name
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

            // Save input file
            fs.writeFileSync(inputPath, code, 'utf8');

            // Create wrapper script to use Prometheus presets
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

-- Use Strong preset from Prometheus
local pipeline = Prometheus.Pipeline:fromConfig(Prometheus.Presets.Strong)

-- Apply obfuscation
local success, result = pcall(function()
    return pipeline:apply(code, "${attachment.name}")
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
                    cwd: PROMETHEUS_CONFIG.PROMETHEUS_PATH
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

            let obfuscatedCode = fs.readFileSync(outputPath, 'utf8');
            
            // Post-process to fix common Roblox compatibility issues
            obfuscatedCode = fixRobloxCompatibility(obfuscatedCode);
            
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

            console.log(`[OBFUSCATE] Success | User: ${interaction.user.tag} | File: ${attachment.name} | Duration: ${result.duration}ms`);

        } catch (error) {
            console.error(`[OBFUSCATE] Error | User: ${interaction.user.tag} | File: ${attachment.name}:`, error);

            let errorMessage = 'An unexpected error occurred.';
            
            if (error.message.includes('Failed to load Prometheus')) {
                errorMessage = 'Prometheus is not properly installed. Please contact an administrator.';
            } else if (error.message.includes('Failed to start Lua')) {
                errorMessage = 'Lua interpreter not found. Please contact an administrator.';
            } else if (error.message.includes('syntax error') || error.message.includes('Parsing Error')) {
                errorMessage = 'Your Lua code contains syntax errors. Please check your code and try again.\n\n**Tip:** Some advanced Luau features may not be fully supported.';
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
