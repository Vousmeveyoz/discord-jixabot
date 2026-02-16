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

// Detailed Prometheus Configurations based on documentation
const PROMETHEUS_PRESETS = {
    weak: {
        LuaVersion: "Lua51",
        VarNamePrefix: "",
        NameGenerator: "MangledShuffled",
        PrettyPrint: false,
        Seed: 0,
        Steps: [
            {
                Name: "WrapInFunction",
                Settings: {
                    Iterations: 1
                }
            }
        ]
    },
    medium: {
        LuaVersion: "Lua51",
        VarNamePrefix: "",
        NameGenerator: "MangledShuffled",
        PrettyPrint: false,
        Seed: 0,
        Steps: [
            {
                Name: "SplitStrings",
                Settings: {
                    Treshold: 0.8,
                    MinLength: 2,
                    MaxLength: 5,
                    ConcatenationType: "table",
                    CustomFunctionType: "local",
                    CustomLocalFunctionsCount: 2
                }
            },
            {
                Name: "ConstantArray",
                Settings: {
                    StringsOnly: true,
                    Treshold: 1,
                    Shuffle: true,
                    Rotate: true,
                    LocalWrapperTreshold: 0.5,
                    LocalWrapperCount: 2,
                    LocalWrapperArgCount: 3,
                    MaxWrapperOffset: 50000
                }
            },
            {
                Name: "WrapInFunction",
                Settings: {
                    Iterations: 1
                }
            }
        ]
    },
    strong: {
        LuaVersion: "Lua51",
        VarNamePrefix: "",
        NameGenerator: "Il",
        PrettyPrint: false,
        Seed: 0,
        Steps: [
            {
                Name: "EncryptStrings",
                Settings: {}
            },
            {
                Name: "ProxifyLocals",
                Settings: {
                    LiteralType: "any"
                }
            },
            {
                Name: "SplitStrings",
                Settings: {
                    Treshold: 1,
                    MinLength: 1,
                    MaxLength: 3,
                    ConcatenationType: "custom",
                    CustomFunctionType: "local",
                    CustomLocalFunctionsCount: 3
                }
            },
            {
                Name: "ConstantArray",
                Settings: {
                    StringsOnly: false,
                    Treshold: 1,
                    Shuffle: true,
                    Rotate: true,
                    LocalWrapperTreshold: 0.8,
                    LocalWrapperCount: 3,
                    LocalWrapperArgCount: 5,
                    MaxWrapperOffset: 100000
                }
            },
            {
                Name: "WrapInFunction",
                Settings: {
                    Iterations: 2
                }
            }
        ]
    },
    minify: {
        LuaVersion: "Lua51",
        VarNamePrefix: "",
        NameGenerator: "MangledShuffled",
        PrettyPrint: false,
        Seed: 0,
        Steps: []
    },
    luau_weak: {
        LuaVersion: "LuaU",
        VarNamePrefix: "",
        NameGenerator: "MangledShuffled",
        PrettyPrint: false,
        Seed: 0,
        Steps: [
            {
                Name: "WrapInFunction",
                Settings: {
                    Iterations: 1
                }
            }
        ]
    },
    luau_medium: {
        LuaVersion: "LuaU",
        VarNamePrefix: "",
        NameGenerator: "MangledShuffled",
        PrettyPrint: false,
        Seed: 0,
        Steps: [
            {
                Name: "SplitStrings",
                Settings: {
                    Treshold: 0.8,
                    MinLength: 2,
                    MaxLength: 5,
                    ConcatenationType: "table",
                    CustomFunctionType: "local",
                    CustomLocalFunctionsCount: 2
                }
            },
            {
                Name: "ConstantArray",
                Settings: {
                    StringsOnly: true,
                    Treshold: 1,
                    Shuffle: true,
                    Rotate: true,
                    LocalWrapperTreshold: 0.5,
                    LocalWrapperCount: 2,
                    LocalWrapperArgCount: 3,
                    MaxWrapperOffset: 50000
                }
            },
            {
                Name: "WrapInFunction",
                Settings: {
                    Iterations: 1
                }
            }
        ]
    },
    luau_strong: {
        LuaVersion: "LuaU",
        VarNamePrefix: "",
        NameGenerator: "Il",
        PrettyPrint: false,
        Seed: 0,
        Steps: [
            {
                Name: "EncryptStrings",
                Settings: {}
            },
            {
                Name: "ProxifyLocals",
                Settings: {
                    LiteralType: "any"
                }
            },
            {
                Name: "SplitStrings",
                Settings: {
                    Treshold: 1,
                    MinLength: 1,
                    MaxLength: 3,
                    ConcatenationType: "custom",
                    CustomFunctionType: "local",
                    CustomLocalFunctionsCount: 3
                }
            },
            {
                Name: "ConstantArray",
                Settings: {
                    StringsOnly: false,
                    Treshold: 1,
                    Shuffle: true,
                    Rotate: true,
                    LocalWrapperTreshold: 0.8,
                    LocalWrapperCount: 3,
                    LocalWrapperArgCount: 5,
                    MaxWrapperOffset: 100000
                }
            },
            {
                Name: "WrapInFunction",
                Settings: {
                    Iterations: 2
                }
            }
        ]
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
        .addStringOption(option =>
            option
                .setName('lua_version')
                .setDescription('Lua version (auto-detect by default)')
                .setRequired(false)
                .addChoices(
                    { name: 'Auto-detect', value: 'auto' },
                    { name: 'Lua 5.1 (Standard Lua)', value: 'lua51' },
                    { name: 'Luau (Roblox)', value: 'luau' }
                )
        ),

    async execute(interaction) {
        const attachment = interaction.options.getAttachment('file');
        const presetChoice = interaction.options.getString('preset') || 'strong';
        const customOutputName = interaction.options.getString('output_name');
        const luaVersionChoice = interaction.options.getString('lua_version') || 'auto';

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

            // Detect Lua version if auto
            let isLuau = false;
            let shouldConvert = false;
            
            if (luaVersionChoice === 'auto') {
                // Auto-detect based on code patterns
                const luauPatterns = [
                    /\+=|-=|\*=|\/=|%=|\^=|\.\.=/,  // Compound assignments
                    /\bcontinue\b/,                  // continue keyword
                    /:\s*\w+\s*[=,\)]/,              // Type annotations
                    /^type\s+\w+\s*=/m,              // Type declarations
                    /`[^`]*\{[^}]+\}[^`]*`/          // String interpolation
                ];
                isLuau = luauPatterns.some(pattern => pattern.test(code));
                shouldConvert = isLuau; // If detected as Luau, convert to Lua51
            } else if (luaVersionChoice === 'luau') {
                isLuau = true;
                shouldConvert = false; // Use LuaU preset
            } else {
                isLuau = false;
                shouldConvert = false; // Use Lua51 preset
            }

            // Convert Luau syntax to Lua 5.1 if needed
            let wasConverted = false;
            if (shouldConvert) {
                const originalCode = code;
                code = convertLuauToLua51(code);
                wasConverted = (code !== originalCode);
            }

            // Select the appropriate preset
            let preset = presetChoice;
            if (isLuau && !shouldConvert) {
                // Use LuaU version of presets
                preset = `luau_${presetChoice}`;
            }

            // Get configuration
            const config = PROMETHEUS_PRESETS[preset];
            if (!config) {
                throw new Error(`Invalid preset: ${preset}`);
            }

            // Generate random seed for this obfuscation
            config.Seed = Math.floor(Math.random() * 1000000);

            // Save input file
            fs.writeFileSync(inputPath, code, 'utf8');

            // Create wrapper script to use Prometheus with config
            const configLua = configToLuaTable(config);
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

-- Configuration
local config = ${configLua}

-- Create pipeline from config
local pipeline = Prometheus.Pipeline:fromConfig(config)

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
                `🔒 **Preset:** ${getPresetEmoji(presetChoice)} ${capitalizeFirst(presetChoice)}`,
                `🔧 **Version:** ${config.LuaVersion}`,
                `🎲 **Seed:** ${config.Seed}`,
                `📊 **Steps:** ${config.Steps.length}`,
                `⏱️ **Duration:** ${(result.duration / 1000).toFixed(2)}s`,
                `📈 **Size:** ${formatBytes(originalSize)} → ${formatBytes(obfuscatedSize)} (${sizeChangeStr})`
            ];

            if (wasConverted) {
                responseLines.push(`🔄 **Auto-converted:** Luau → Lua 5.1`);
            }

            if (config.Steps.length > 0) {
                const stepNames = config.Steps.map(s => s.Name).join(', ');
                responseLines.push(`🛠️ **Steps Applied:** ${stepNames}`);
            }

            responseLines.push(``, `*Powered by Prometheus Lua Obfuscator*`);

            // Send response
            await interaction.editReply({
                content: responseLines.join('\n'),
                files: [fileAttachment]
            });

            console.log(`[OBFUSCATE] Success | User: ${interaction.user.tag} | File: ${attachment.name} | Preset: ${preset} | Duration: ${result.duration}ms | Steps: ${config.Steps.length} | Converted: ${wasConverted}`);

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

function getPresetEmoji(preset) {
    const emojis = {
        weak: '🟢',
        medium: '🟡',
        strong: '🔴',
        minify: '📦'
    };
    return emojis[preset] || '⚪';
}

function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
