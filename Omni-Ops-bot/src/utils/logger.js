const { EmbedBuilder } = require("discord.js");
const { getWorkspace } = require("./workspace");

// Sends a log embed to the workspace's configured log channel
async function sendLog(client, guildId, title, description) {
  try {
    const settings = await getWorkspace(guildId).catch(() => null);
    const channelId = settings?.logChannelId;
    if (!channelId) return;

    const channel = await client.channels.fetch(channelId);
    if (!channel) return;

    const embed = new EmbedBuilder().setTitle(title).setDescription(description).setTimestamp();
    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("Log Error:", error.message);
  }
}
module.exports = { sendLog };
