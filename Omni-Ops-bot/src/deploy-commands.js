require("dotenv").config();
const { REST, Routes } = require("discord.js");
const fs = require("fs");
const path = require("path");
const commands = [];
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith(".js"));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (command.data) {
    commands.push(command.data.toJSON());
    console.log(`✅ Loaded command: ${command.data.name}`);
  }
}
const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
(async () => {
  try {
    console.log("Registering commands...");
    if (process.env.DEV_GUILD_ID) {
      // Development: register in one guild only (instant updates)
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.DEV_GUILD_ID),
        { body: commands }
      );
      console.log(`✅ ${commands.length} commands registered (DEV guild only).`);
    } else {
      // Production: register globally — anyone can invite the bot
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
      console.log(`✅ ${commands.length} commands registered GLOBALLY.`);
    }
  } catch (error) {
    console.error(error);
  }
})();
