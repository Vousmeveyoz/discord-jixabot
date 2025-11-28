require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');

// Load all command files
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    
    if (command.data) {
        commands.push(command.data.toJSON());
        console.log(`✅ Loaded: ${command.data.name}`);
    }
}

// Deploy commands to Discord
const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log(`🔄 Started deploying ${commands.length} application (/) commands...`);

        const data = await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );

        console.log(`✅ Successfully deployed ${data.length} application (/) commands!`);
        console.log('\n📋 Deployed commands:');
        data.forEach(cmd => console.log(`   - /${cmd.name}`));
        
    } catch (error) {
        console.error('❌ Error deploying commands:', error);
    }
})();