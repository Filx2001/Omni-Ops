const fs = require("fs");
const path = require("path");
const { Collection } = require("discord.js");

module.exports = (client) => {
  client.commands = new Collection();

  const commandsPath = path.join(__dirname, "../commands");

  const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith(".js"));

  for (const file of commandFiles) {
    const command = require(path.join(commandsPath, file));

    if (!command || !command.data) {
      console.log("❌ Error loading command file: Found a broken file in commands folder.");
      continue;
    }
    client.commands.set(command.data.name, command);

    console.log(`✅ Command Loaded: ${command.data.name}`);
  }
};
//
