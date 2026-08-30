require("dotenv").config();
const { Client, GatewayIntentBits, Partials, Collection } = require("discord.js");
const loadCommands = require("./handlers/commandHandler");
const loadEvents = require("./handlers/eventHandler");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // Required for auto-role and welcome messages
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // Required for the AI assistant to read mentions and DMs
    GatewayIntentBits.DirectMessageReactions, // Required for AI confirmation reactions in DMs
    GatewayIntentBits.GuildMessageReactions, // Required if reactions are used in guild channels
  ],
  partials: [
    Partials.Channel, // Required to receive DMs
    Partials.Message, // Required to fetch partial messages
    Partials.Reaction, // Required to handle reactions on uncached messages
  ],
});

// Initialize the commands collection
client.commands = new Collection();

// Load all commands and events dynamically
loadCommands(client);
loadEvents(client);

// Start the internal Express server once the bot is ready
// This allows the backend API to notify the bot about external events (e.g. new WhatsApp leads)
client.once("ready", () => {
  const { startNotifyServer } = require("./server");
  startNotifyServer(client);
});

client.login(process.env.DISCORD_TOKEN);
